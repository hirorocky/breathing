import AudioOut from 'embedded:io/audio/out'
import { resumeCapture, suspendCapture } from 'breath/mic'
import Preference from 'preference'
import Time from 'time'
import Timer from 'timer'

/**
 * v1.1.0 Loop A — デバイス側鳴き声シンセ（murmur/sigh/startle/touch）。
 *
 * DSP・レシピ JSON スキーマは `overlay/tools/cry/synth.py`（Mac プロトタイプ）が原本。
 * 変更する場合は両方直す。差分は主に2つ:
 *   - device 側は Math.random() を直接使う（Mac 側の --seed 再現性は不要）
 *   - generate-ahead のためチャンク分割（64 サンプル/tick）した状態機械で render する
 *
 * 音名ごとに完成済みバッファを1個キャッシュする。起動時（initCry）に全音を
 * 順次生成し、再生（playCry）で消費したら次の変奏を裏で生成し直す。
 * startle は「グループ」— 複数パターンから再生ごとにランダムに1つ選び、
 * 選んだパターン自身の jitter を適用する。
 *
 * 再生は `embedded:io/audio/out`（M5StackCoreS3AudioOut 経由でアンプの
 * sampleRate を同期する正しい経路。`pins/audioout`＝robot.tone はこれを
 * バイパスするので使わない — Phase 0 調査結果）。I2S TX は1本のみのため、
 * open が例外を投げたら（robot.tone 等と衝突）黙ってスキップして trace する。
 * Promise は使わない（コールバックのみ）— unhandled rejection で XS abort
 * させないため。
 */

const SAMPLE_RATE = 8000
const CHUNK_SAMPLES = 64
const CHUNK_TICK_MS = 4
const TARGET_PEAK_DBFS = -3.0
const VIBRATO_FADE_SEC = 0.12
const TARGET_PEAK_LINEAR = 10 ** (TARGET_PEAK_DBFS / 20)

export const CRY_NAMES = ['murmur', 'sigh', 'startle', 'touch'] as const
export type CryName = (typeof CRY_NAMES)[number]

type Point = [number, number]
interface Jitter {
  f0?: number
  durationMs?: number
  harmonics?: number
  noiseMix?: number
  noiseCutoff?: number
  vibratoHz?: number
  vibratoCents?: number
  tremoloHz?: number
  tremoloDepth?: number
  ampGain?: number
}

interface Recipe {
  name: string
  durationMs: number
  pitch: Point[]
  harmonics?: number[]
  vibrato?: { hz: number; cents: number; onset?: number }
  tremolo?: { hz: number; depth: number }
  amp: Point[]
  noise?: { mix: number; cutoff?: number; cutoffEnd?: number }
  jitter?: Jitter
}

interface Recipes {
  murmur: Recipe
  sigh: Recipe
  startle: Recipe[]
  touch: Recipe
}

interface CacheEntry {
  pcm: Int16Array
  patternName: string | null
}

type ClosableAudioOut = AudioOut & { close(): void }

type JobStage = 'tonal' | 'mix' | 'quantize'

interface GenerationJob {
  name: CryName
  patternName: string | null
  pitchPoints: Point[]
  ampPoints: Point[]
  harmonics: number[]
  harmonicsNorm: number
  vibrato: Recipe['vibrato'] | null
  tremolo: Recipe['tremolo'] | null
  noiseMix: number
  noiseCutoffPoints: Point[] | null
  n: number
  stage: JobStage
  i: number
  phase: number
  noisePrev: number
  noisePeak: number
  outPeak: number
  scale: number
  buf: Float32Array
  noiseRaw: Float32Array | null
  pcm: Int16Array | null
  startedAt: number
}

function isCryName(value: string): value is CryName {
  return (CRY_NAMES as readonly string[]).includes(value)
}

function isRecipe(value: unknown): value is Recipe {
  if (typeof value !== 'object' || value === null) return false
  return 'pitch' in value && Array.isArray(value.pitch) && 'amp' in value && Array.isArray(value.amp)
}

const PREF_DOMAIN = 'breath'
const PREF_KEYS = {
  murmur: 'cryRecipeMurmur',
  sigh: 'cryRecipeSigh',
  startle: 'cryRecipeStartle',
  touch: 'cryRecipeTouch',
}

// ---------------------------------------------------------------------------
// 既定レシピ（synth.py の PRESETS と同一。startle はグループ = パターン配列）
// ---------------------------------------------------------------------------

const DEFAULT_RECIPES: Recipes = {
  murmur: {
    name: 'murmur',
    durationMs: 420,
    pitch: [
      [0.0, 226],
      [0.5, 208],
      [1.0, 188],
    ],
    harmonics: [1.0, 0.3, 0.1],
    vibrato: { hz: 4.5, cents: 10, onset: 0.1 },
    tremolo: { hz: 5.0, depth: 0.05 },
    amp: [
      [0.0, 0.0],
      [0.25, 0.9],
      [0.7, 0.55],
      [1.0, 0.0],
    ],
    noise: { mix: 0.4, cutoff: 1500, cutoffEnd: 900 },
    jitter: {
      f0: 0.05,
      durationMs: 0.15,
      harmonics: 0.1,
      noiseMix: 0.2,
      noiseCutoff: 0.15,
      vibratoHz: 0.1,
      vibratoCents: 0.2,
      tremoloHz: 0.1,
      tremoloDepth: 0.2,
      ampGain: 0.08,
    },
  },
  sigh: {
    name: 'sigh',
    durationMs: 1000,
    pitch: [
      [0.0, 175],
      [1.0, 150],
    ],
    harmonics: [1.0, 0.15],
    vibrato: { hz: 3.5, cents: 6, onset: 0.3 },
    tremolo: { hz: 4.0, depth: 0.12 },
    amp: [
      [0.0, 0.0],
      [0.08, 0.7],
      [0.4, 0.55],
      [1.0, 0.0],
    ],
    noise: { mix: 0.88, cutoff: 1200, cutoffEnd: 400 },
    jitter: {
      f0: 0.04,
      durationMs: 0.15,
      harmonics: 0.15,
      noiseMix: 0.08,
      noiseCutoff: 0.2,
      vibratoHz: 0.1,
      vibratoCents: 0.25,
      tremoloHz: 0.15,
      tremoloDepth: 0.25,
      ampGain: 0.1,
    },
  },
  touch: {
    name: 'touch',
    durationMs: 300,
    pitch: [
      [0.0, 252],
      [0.5, 268],
      [1.0, 250],
    ],
    harmonics: [1.0, 0.25],
    vibrato: { hz: 5.0, cents: 8, onset: 0.05 },
    tremolo: { hz: 6.0, depth: 0.06 },
    amp: [
      [0.0, 0.0],
      [0.35, 0.55],
      [0.65, 0.55],
      [1.0, 0.0],
    ],
    noise: { mix: 0.3, cutoff: 1800, cutoffEnd: 1400 },
    jitter: {
      f0: 0.05,
      durationMs: 0.15,
      harmonics: 0.12,
      noiseMix: 0.2,
      noiseCutoff: 0.15,
      vibratoHz: 0.1,
      vibratoCents: 0.2,
      tremoloHz: 0.1,
      tremoloDepth: 0.2,
      ampGain: 0.1,
    },
  },
  startle: [
    {
      name: 'startle-yelp',
      durationMs: 200,
      pitch: [
        [0.0, 320],
        [0.35, 520],
        [0.7, 480],
        [1.0, 380],
      ],
      harmonics: [1.0, 0.5, 0.25, 0.12],
      vibrato: { hz: 18, cents: 30, onset: 0.02 },
      amp: [
        [0.0, 0.0],
        [0.08, 1.0],
        [0.5, 0.8],
        [1.0, 0.0],
      ],
      noise: { mix: 0.3, cutoff: 2200, cutoffEnd: 1200 },
      jitter: { f0: 0.06, durationMs: 0.12, noiseMix: 0.15, vibratoCents: 0.25 },
    },
    {
      name: 'startle-kyu',
      durationMs: 160,
      pitch: [
        [0.0, 380],
        [0.4, 470],
        [1.0, 300],
      ],
      harmonics: [1.0, 0.35, 0.1],
      vibrato: { hz: 14, cents: 20, onset: 0.0 },
      amp: [
        [0.0, 0.0],
        [0.12, 0.9],
        [0.6, 0.6],
        [1.0, 0.0],
      ],
      noise: { mix: 0.42, cutoff: 1800, cutoffEnd: 1000 },
      jitter: { f0: 0.06, durationMs: 0.12, noiseMix: 0.15, vibratoCents: 0.25 },
    },
    {
      name: 'startle-double',
      durationMs: 260,
      pitch: [
        [0.0, 340],
        [0.25, 500],
        [0.45, 430],
        [0.6, 490],
        [1.0, 360],
      ],
      harmonics: [1.0, 0.45, 0.2],
      vibrato: { hz: 16, cents: 25, onset: 0.02 },
      amp: [
        [0.0, 0.0],
        [0.1, 1.0],
        [0.4, 0.15],
        [0.55, 0.85],
        [1.0, 0.0],
      ],
      noise: { mix: 0.32, cutoff: 2000, cutoffEnd: 1100 },
      jitter: { f0: 0.06, durationMs: 0.12, noiseMix: 0.15, vibratoCents: 0.25 },
    },
  ],
}

// 現在有効なレシピ（Preference からの復元・PUT /cry/recipes で書き換え可能）
const recipes = deepClone(DEFAULT_RECIPES)

// name -> { pcm: Int16Array, patternName: string|null } | null（未生成/消費済み）
const cache: Record<CryName, CacheEntry | null> = {
  murmur: null,
  sigh: null,
  startle: null,
  touch: null,
}

const queue: CryName[] = [] // 生成待ちの name（FIFO、重複なし）
let currentJob: GenerationJob | null = null
let started = false

// ---------------------------------------------------------------------------
// 補間ヘルパー（synth.py の interp_linear / interp_log と同一のセマンティクス）
// ---------------------------------------------------------------------------

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function interpLinear(t: number, points: Point[]): number {
  const first = points[0] ?? [0, 0]
  if (t <= first[0]) return first[1]
  const last = points[points.length - 1] ?? first
  if (t >= last[0]) return last[1]
  for (let k = 0; k < points.length - 1; k++) {
    const [t0, v0] = points[k] ?? first
    const [t1, v1] = points[k + 1] ?? last
    if (t >= t0 && t <= t1) {
      if (t1 === t0) return v1
      const frac = (t - t0) / (t1 - t0)
      return v0 + (v1 - v0) * frac
    }
  }
  return last[1]
}

function interpLog(t: number, points: Point[]): number {
  const EPS = 1e-6
  const first = points[0] ?? [0, EPS]
  if (t <= first[0]) return Math.max(first[1], EPS)
  const last = points[points.length - 1] ?? first
  if (t >= last[0]) return Math.max(last[1], EPS)
  for (let k = 0; k < points.length - 1; k++) {
    const [t0, initialV0] = points[k] ?? first
    const [t1, initialV1] = points[k + 1] ?? last
    let v0 = initialV0
    let v1 = initialV1
    if (t >= t0 && t <= t1) {
      if (t1 === t0) return Math.max(v1, EPS)
      const frac = (t - t0) / (t1 - t0)
      v0 = Math.max(v0, EPS)
      v1 = Math.max(v1, EPS)
      return v0 * (v1 / v0) ** frac
    }
  }
  return Math.max(last[1], EPS)
}

// ---------------------------------------------------------------------------
// ゆらぎ（jitter）適用 — synth.py apply_jitter の乗算的・キーごとの移植
// ---------------------------------------------------------------------------

function jitterFactor(jitter: Jitter, key: keyof Jitter): number {
  const spread = jitter[key] || 0
  if (!spread) return 1
  return 1 + (Math.random() * 2 - 1) * spread
}

function applyJitter(recipe: Recipe): Recipe {
  const r = deepClone(recipe)
  const j = recipe.jitter || {}

  const f0Factor = jitterFactor(j, 'f0')
  r.pitch = r.pitch.map(([t, hz]) => [t, hz * f0Factor])

  r.durationMs = recipe.durationMs * jitterFactor(j, 'durationMs')

  const spreadH = j.harmonics || 0
  if (spreadH && r.harmonics) {
    r.harmonics = r.harmonics.map((g) => Math.max(0, g * (1 + (Math.random() * 2 - 1) * spreadH)))
  }

  if (r.noise) {
    r.noise.mix = clamp01(r.noise.mix * jitterFactor(j, 'noiseMix'))
    const cutoffFactor = jitterFactor(j, 'noiseCutoff')
    r.noise.cutoff = (r.noise.cutoff ?? 1000) * cutoffFactor
    r.noise.cutoffEnd = (r.noise.cutoffEnd ?? r.noise.cutoff) * cutoffFactor
  }

  if (r.vibrato) {
    r.vibrato.hz = r.vibrato.hz * jitterFactor(j, 'vibratoHz')
    r.vibrato.cents = r.vibrato.cents * jitterFactor(j, 'vibratoCents')
  }

  if (r.tremolo) {
    r.tremolo.hz = r.tremolo.hz * jitterFactor(j, 'tremoloHz')
    r.tremolo.depth = clamp01(r.tremolo.depth * jitterFactor(j, 'tremoloDepth'))
  }

  const spreadA = j.ampGain || 0
  if (spreadA) {
    r.amp = r.amp.map(([t, g]) => (g === 0 ? [t, 0] : [t, clamp01(g * (1 + (Math.random() * 2 - 1) * spreadA))]))
  }

  return r
}

// ---------------------------------------------------------------------------
// 生成ジョブ（generate-ahead、64 サンプル/tick のチャンク分割状態機械）
//
// synth.py render() + write_wav() を3ステージに分割して忠実に移植する:
//   'tonal'    倍音加算合成（位相積分・ビブラート）+ 一次ローパスノイズ（ピーク追跡）
//   'mix'      ノイズ自己正規化 + トーン/ノイズミックス + 振幅エンベロープ + トレモロ
//              （出力ピークを追跡。buf をその場で上書きして再利用する）
//   'quantize' -3dBFS ピーク正規化 + Int16 量子化
// ---------------------------------------------------------------------------

function buildJob(name: CryName): GenerationJob {
  let recipe: Recipe
  let patternName: string | null = null
  if (name === 'startle') {
    const patterns = recipes.startle
    const chosen = patterns[Math.floor(Math.random() * patterns.length)] ?? patterns[0]
    if (!chosen) throw new Error('empty startle recipe')
    patternName = chosen.name
    recipe = applyJitter(chosen)
  } else {
    recipe = applyJitter(recipes[name])
  }

  const pitchPoints = [...recipe.pitch].sort((a, b) => a[0] - b[0])
  const ampPoints = [...recipe.amp].sort((a, b) => a[0] - b[0])
  const harmonics = recipe.harmonics?.length ? recipe.harmonics : [1.0]
  let harmonicsNorm = 0
  for (const g of harmonics) harmonicsNorm += Math.abs(g)
  if (!harmonicsNorm) harmonicsNorm = 1.0

  let noiseMix = 0
  let noiseCutoffPoints: Point[] | null = null
  if (recipe.noise && recipe.noise.mix > 0) {
    noiseMix = clamp01(recipe.noise.mix)
    const c0 = Math.max(1, recipe.noise.cutoff ?? 1000)
    const c1 = Math.max(1, recipe.noise.cutoffEnd ?? recipe.noise.cutoff ?? 1000)
    noiseCutoffPoints = [
      [0, c0],
      [1, c1],
    ] as Point[]
  }

  const n = Math.max(1, Math.round((recipe.durationMs / 1000) * SAMPLE_RATE))

  return {
    name,
    patternName,
    pitchPoints,
    ampPoints,
    harmonics,
    harmonicsNorm,
    vibrato: recipe.vibrato ?? null,
    tremolo: recipe.tremolo ?? null,
    noiseMix,
    noiseCutoffPoints,
    n,
    stage: 'tonal',
    i: 0,
    phase: 0,
    noisePrev: 0,
    noisePeak: 0,
    outPeak: 0,
    scale: 1,
    buf: new Float32Array(n), // tonal 段では乾いたトーン、mix 段で最終サンプルに上書きされる
    noiseRaw: noiseMix > 0 ? new Float32Array(n) : null,
    pcm: null,
    startedAt: Time.ticks,
  }
}

function stepTonal(job: GenerationJob, end: number): void {
  for (; job.i < end; job.i++) {
    const i = job.i
    const t = job.n > 1 ? i / (job.n - 1) : 0
    let f0 = interpLog(t, job.pitchPoints)

    if (job.vibrato?.cents) {
      const timeS = i / SAMPLE_RATE
      const onset = job.vibrato.onset ?? 0
      let vibEnv: number
      if (timeS <= onset) {
        vibEnv = 0
      } else {
        const x = Math.min(1, (timeS - onset) / VIBRATO_FADE_SEC)
        vibEnv = x * x * (3 - 2 * x) // smoothstep
      }
      const lfo = Math.sin(2 * Math.PI * (job.vibrato.hz ?? 5.0) * timeS)
      f0 = f0 * 2 ** ((job.vibrato.cents / 1200) * vibEnv * lfo)
    }

    job.phase += (2 * Math.PI * f0) / SAMPLE_RATE
    let acc = 0
    for (let k = 0; k < job.harmonics.length; k++) {
      const g = job.harmonics[k]
      if (g) acc += g * Math.sin(job.phase * (k + 1))
    }
    job.buf[i] = acc / job.harmonicsNorm

    if (job.noiseMix > 0) {
      const fc = Math.min(interpLog(t, job.noiseCutoffPoints ?? [[0, 1000]]), SAMPLE_RATE * 0.45)
      const a = 1 - Math.exp((-2 * Math.PI * fc) / SAMPLE_RATE)
      const white = Math.random() * 2 - 1
      job.noisePrev = job.noisePrev + a * (white - job.noisePrev)
      if (job.noiseRaw) job.noiseRaw[i] = job.noisePrev
      const abs = Math.abs(job.noisePrev)
      if (abs > job.noisePeak) job.noisePeak = abs
    }
  }
}

function stepMix(job: GenerationJob, end: number): void {
  const mix = job.noiseMix
  const invNoisePeak = mix > 0 && job.noisePeak > 1e-9 ? 1 / job.noisePeak : 0
  for (; job.i < end; job.i++) {
    const i = job.i
    const t = job.n > 1 ? i / (job.n - 1) : 0
    const ampEnv = interpLinear(t, job.ampPoints)
    const noiseNorm = mix > 0 ? (job.noiseRaw?.[i] ?? 0) * invNoisePeak : 0
    let sample = (1 - mix) * (job.buf[i] ?? 0) + mix * noiseNorm

    if (job.tremolo?.depth) {
      const timeS = i / SAMPLE_RATE
      const trem = 1 - (job.tremolo.depth * (1 - Math.cos(2 * Math.PI * (job.tremolo.hz ?? 5.0) * timeS))) / 2
      sample *= trem
    }

    sample *= ampEnv
    job.buf[i] = sample
    const abs = Math.abs(sample)
    if (abs > job.outPeak) job.outPeak = abs
  }
}

function stepQuantize(job: GenerationJob, end: number): void {
  for (; job.i < end; job.i++) {
    let v = (job.buf[job.i] ?? 0) * job.scale
    if (v > 1) v = 1
    else if (v < -1) v = -1
    if (job.pcm) job.pcm[job.i] = Math.round(v * 32767)
  }
}

function stepChunk(): void {
  const job = currentJob
  if (!job) return
  const end = Math.min(job.n, job.i + CHUNK_SAMPLES)

  if (job.stage === 'tonal') {
    stepTonal(job, end)
    if (job.i >= job.n) {
      job.stage = 'mix'
      job.i = 0
    }
  } else if (job.stage === 'mix') {
    stepMix(job, end)
    if (job.i >= job.n) {
      job.stage = 'quantize'
      job.i = 0
      job.noiseRaw = null // このジョブでは使い終わり。次の chunk 前に解放してピークメモリを下げる
      job.pcm = new Int16Array(job.n)
      job.scale = job.outPeak > 1e-9 ? TARGET_PEAK_LINEAR / job.outPeak : 1
    }
  } else if (job.stage === 'quantize') {
    stepQuantize(job, end)
    if (job.i >= job.n) {
      finishJob(job)
      return
    }
  }

  Timer.set(stepChunk, CHUNK_TICK_MS)
}

function finishJob(job: GenerationJob): void {
  if (!job.pcm) throw new Error('generation finished without PCM')
  const elapsedMs = Time.ticks - job.startedAt
  cache[job.name] = { pcm: job.pcm, patternName: job.patternName }
  const label = job.patternName ? `${job.name}/${job.patternName}` : job.name
  trace(`[cry] gen ${label} done ${elapsedMs}ms\n`)
  currentJob = null
  pump()
}

function pump(): void {
  if (currentJob || !queue.length) return
  const name = queue.shift()
  try {
    if (!name) return
    currentJob = buildJob(name)
  } catch (error) {
    trace(`[cry] gen ${name} failed: ${error}\n`)
    currentJob = null
    Timer.set(pump, 0)
    return
  }
  Timer.set(stepChunk, CHUNK_TICK_MS)
}

function enqueueGeneration(name: CryName): void {
  if (currentJob && currentJob.name === name) return
  if (queue.includes(name)) return
  queue.push(name)
  pump()
}

// ---------------------------------------------------------------------------
// 再生 — embedded:io/audio/out（M5StackCoreS3AudioOut 経由でアンプの
// sampleRate を同期する）。open -> onWritable(write) -> stop/close の形の
// 純コールバック（setup-target.js のスタートアップサウンド実装を基にする）。
//
// 注意: setup-target.js の実装は「書き切ったら即 stop/close」だが、これは
// 総 DMA バッファ（dma_buf_size * (dma_desc_num-1) ≈ 20460 bytes ≈ 1.28s@8kHz）
// より音源が大きい（bflatmajor.maud は 21078 bytes）前提でしか安全に動かない。
// cry の鳴き声は全て 20460 bytes 未満（最長の sigh でも jitter 込みで
// 18400 bytes 程度）なので、start() 直後の最初の onWritable で全バイトを
// 書き切ってしまい、そこで即 stop/close すると実際にはまだ DMA から音が
// 出ていない（ハードウェア再生が追いついていない）うちに音を切ってしまう
// （実機で確認: sigh が ~1000ms のはずが play→play done が 206ms だった）。
// そのため close は「書き込み終わったこと」ではなく「音源の実時間分の
// 再生が経過したこと」で判定する（Timer ベース）。
// ---------------------------------------------------------------------------

const PLAYBACK_CLOSE_MARGIN_MS = 200 // DMA プリロード・Timer 遅延の余裕
const BYTES_PER_SAMPLE = 2 // bitsPerSample:16, channels:1

// v1.1.0 Phase 3a 追記 — CoreS3 はスピーカー(AudioOut)とマイク(AudioIn)が I2S
// クロックピン(BCK/LR)を共有しており、AudioOut を open している間 mic 入力が
// 全ゼロになり close 後も自然復旧しない(実機確認: capture の stop/start でのみ
// 復活)。そのため open 直前に breath/mic の suspendCapture()、close 後は
// +500ms 遅らせて resumeCapture() を呼ぶ(残響の尻尾を拾わない後方ゲートも兼ねる)。
// resume 漏れ = mic 永久停止になるため、全終了経路(正常完了・open 失敗・
// start 失敗・再生中の例外)で必ず呼ばれるようにしている。
const MIC_RESUME_DELAY_MS = 500
// closeOut の「まだ書き切っていない」待機に無限に留まらないための上限
// (書き込みエラーが続く異常系でも resumeCapture が確実に呼ばれることを保証する)。
const CLOSE_FORCE_GRACE_MS = 2000

function startPlayback(name: CryName, pcm: Int16Array, patternName: string | null): boolean {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)
  const total = bytes.byteLength
  let position = 0
  let closed = false
  const label = patternName ? `${name}/${patternName}` : name

  // AudioOut を open する直前に capture を止める。open が失敗しても
  // resumeCapture() で必ず戻す(下の catch 参照)。
  try {
    suspendCapture()
  } catch (error) {
    trace(`[cry] suspendCapture failed: ${error}\n`)
  }

  let out: ClosableAudioOut
  try {
    out = new AudioOut({
      sampleRate: SAMPLE_RATE,
      bitsPerSample: 16,
      channels: 1,
      onWritable(size: number) {
        if (closed) return
        try {
          const use = Math.min(size, total - position)
          if (use > 0) {
            this.write(bytes.subarray(position, position + use))
            position += use
          }
        } catch (error) {
          trace(`[cry] play error ${label}: ${error}\n`)
          closeOut()
        }
      },
    }) as ClosableAudioOut
  } catch {
    // I2S TX は1本のみ。robot.tone 等と衝突していれば開けない — 黙ってスキップする。
    // AudioOut は一度も open されていないので mic は即座に戻してよい。
    trace('[cry] busy, skipped\n')
    try {
      resumeCapture()
    } catch (resumeError) {
      trace(`[cry] resumeCapture (busy path) failed: ${resumeError}\n`)
    }
    return false
  }

  const closeDeadline =
    Time.ticks + (total / BYTES_PER_SAMPLE / SAMPLE_RATE) * 1000 + PLAYBACK_CLOSE_MARGIN_MS + CLOSE_FORCE_GRACE_MS

  function closeOut(): void {
    if (closed) return
    if (position < total && Time.ticks < closeDeadline) {
      // まだ書き切っていない（Timer 遅延等）。少し待って再確認する。
      // ただし closeDeadline を過ぎたら異常系とみなし強制的に閉じる
      // (resumeCapture が呼ばれないまま mic が永久停止するのを防ぐ)。
      Timer.set(closeOut, 50)
      return
    }
    closed = true
    try {
      out.stop()
    } catch (_stopError) {
      // 握りつぶす。abort させない。
    }
    try {
      out.close()
    } catch (_closeError) {
      // 握りつぶす。
    }
    trace(`[cry] play done ${label}\n`)
    Timer.set(() => {
      try {
        resumeCapture()
      } catch (error) {
        trace(`[cry] resumeCapture (close path) failed: ${error}\n`)
      }
    }, MIC_RESUME_DELAY_MS)
  }

  try {
    out.start()
  } catch (error) {
    trace(`[cry] start failed ${label}: ${error}\n`)
    closed = true
    try {
      out.close()
    } catch (_closeError) {
      // 握りつぶす。
    }
    Timer.set(() => {
      try {
        resumeCapture()
      } catch (resumeError) {
        trace(`[cry] resumeCapture (start-failed path) failed: ${resumeError}\n`)
      }
    }, MIC_RESUME_DELAY_MS)
    return false
  }

  const playbackMs = (total / BYTES_PER_SAMPLE / SAMPLE_RATE) * 1000
  Timer.set(closeOut, playbackMs + PLAYBACK_CLOSE_MARGIN_MS)

  trace(`[cry] play ${label}\n`)
  return true
}

// ---------------------------------------------------------------------------
// 公開 API
// ---------------------------------------------------------------------------

/** 起動時に一度呼ぶ。全音の初回生成をキューに積む（自動発火はしない）。 */
export function initCry(): void {
  if (started) return
  started = true
  loadPersistedRecipes()
  for (const name of CRY_NAMES) enqueueGeneration(name)
  trace('[cry] init, queued generation for all voices\n')
}

function loadPersistedRecipes(): void {
  for (const name of CRY_NAMES) {
    try {
      const raw = Preference.get(PREF_DOMAIN, PREF_KEYS[name])
      if (!raw) continue
      const saved = JSON.parse(String(raw)) as unknown
      if (name === 'startle') {
        if (Array.isArray(saved) && saved.length > 0 && saved.every(isRecipe)) recipes.startle = saved
      } else if (isRecipe(saved)) {
        recipes[name] = saved
      }
    } catch (error) {
      trace(`[cry] recipe restore failed for ${name}: ${error}\n`)
    }
  }
}

/** 現在有効なレシピ（GET /cry/recipes）。startle は配列。 */
export function getRecipes() {
  return recipes
}

/**
 * レシピ差し替え（PUT /cry/recipes）。渡された名前だけ置き換え、
 * Preference へ永続化し、該当キャッシュを無効化して再生成を積む。
 * 戻り値は実際に更新できた name の配列。
 */
export function setRecipes(partial: unknown): CryName[] {
  const updated: CryName[] = []
  if (!partial || typeof partial !== 'object') return updated
  const candidates = partial as Record<string, unknown>

  for (const name of Object.keys(candidates)) {
    if (!isCryName(name)) continue
    const value = candidates[name]

    if (name === 'startle') {
      if (!Array.isArray(value) || !value.length) continue
      if (!value.every(isRecipe)) continue
      recipes.startle = value
    } else {
      if (!isRecipe(value)) continue
      recipes[name] = value
    }

    try {
      Preference.set(PREF_DOMAIN, PREF_KEYS[name], JSON.stringify(value))
    } catch (error) {
      trace(`[cry] recipe persist failed for ${name}: ${error}\n`)
    }
    cache[name] = null
    enqueueGeneration(name)
    updated.push(name)
  }

  return updated
}

/**
 * 試し鳴き（POST /cry/<name>）。キャッシュ済みバッファを即再生し、次の変奏を
 * 裏で生成し直す。キャッシュ未完成・再生不可（I2S busy）の場合は ok:false。
 */
export function playCry(name: string) {
  if (!isCryName(name)) return { ok: false, name, error: 'unknown_name' }

  const entry = cache[name]
  if (!entry) {
    const generating = (currentJob && currentJob.name === name) || queue.includes(name)
    return { ok: false, name, status: generating ? 'generating' : 'empty' }
  }

  const played = startPlayback(name, entry.pcm, entry.patternName)
  if (!played) return { ok: false, name, error: 'busy' }

  cache[name] = null
  enqueueGeneration(name)
  return { ok: true, name, pattern: entry.patternName ?? undefined }
}
