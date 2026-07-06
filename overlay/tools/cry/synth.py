#!/usr/bin/env python3
"""overlay/tools/cry/synth.py

StackChan の鳴き声（cry）デザイン用パラメトリックシンセ（Mac プロトタイプ）。

目的:
  - 「レシピ JSON」を鳴らして afplay で試聴し、シンセのトポロジーとプリセットの
    方向性を Mac 上で高速に探索する（実機 OTA なしで音作りを試す）。
  - ここで確定するレシピ JSON スキーマは、後で実機側シンセ
    （overlay/mods/breath/cry.js、Phase 1）に**そのまま**持っていく想定。
    そのためこのファイルは Python 標準ライブラリのみで書く
    （DSP コアは wave / math / random / struct のみを使用。
    CLI 部分は argparse / json / os / sys のみ）。

出力仕様:
  - WAV, 16-bit mono, 8000 Hz 固定（デバイスと同じ帯域で試聴するため）

===========================================================================
レシピ JSON スキーマ（cry.js と共通にする想定 — 変更する場合は両方直す）
===========================================================================

{
  "name": "murmur",            // 省略時はプリセット名 or ファイル名を使う
  "durationMs": 420,            // 発音の長さ（ミリ秒）

  // ピッチカーブ（= 時間変化する基本周波数 f0）。
  // [[t0, hz0], [t1, hz1], ...] の配列。t は 0..1 に正規化した時間。
  // 先頭は t=0、末尾は t=1 を含めること。点の間は対数補間（周波数なので）。
  "pitch": [[0.0, 220], [1.0, 180]],

  // 倍音ゲイン配列。index 0 が基音（f0 * 1）、index 1 が 2 倍音（f0 * 2）...
  // サイン加算合成。合計値で正規化してから使うので絶対値は気にしなくてよい。
  "harmonics": [1.0, 0.4],

  // ビブラート（省略可）。基本周波数を FM 的に揺らす。
  // onset 秒までは深さ 0、そこから 0.12 秒でフェードインして cents に達する。
  "vibrato": {"hz": 5.0, "cents": 12, "onset": 0.15},

  // トレモロ（任意）。振幅を 1.0 〜 (1-depth) の間で正弦波状に揺らす。
  "tremolo": {"hz": 5.5, "depth": 0.08},

  // 振幅エンベロープ。[[t, gain], ...] を線形補間。
  // 端（t=0 と t=1）は 0 にする（クリックノイズ防止のソフトアタック/ディケイ）。
  "amp": [[0.0, 0.0], [0.2, 1.0], [0.75, 0.55], [1.0, 0.0]],

  // ノイズ成分（息っぽさ）。白色ノイズ→一次ローパスフィルタ。
  // mix は 0..1 のクロスフェード比（0=トーンのみ, 1=ノイズのみ）。
  // cutoff→cutoffEnd は時間で対数補間（呼気が抜けるほどこもる、等の表現に使う）。
  // ノイズは振幅エンベロープ（amp）に従う（別エンベロープは持たない）。
  "noise": {"mix": 0.4, "cutoff": 1500, "cutoffEnd": 900},

  // ゆらぎ幅。再生（生成）ごとに各パラメータへ相対的なランダム量を乗せる。
  // 値は相対幅（例 0.05 = ±5%）。キーを省略 or 0 ならそのパラメータは揺らさない。
  // 対応キー:
  //   f0            ピッチカーブ全体に掛かる乗数（カーブの形は保ったまま上下）
  //   durationMs    発音の長さ全体
  //   harmonics     各倍音ゲインに独立に適用
  //   noiseMix      noise.mix
  //   noiseCutoff   noise.cutoff と noise.cutoffEnd に同じ乗数（形を保つ）
  //   vibratoHz     vibrato.hz
  //   vibratoCents  vibrato.cents
  //   tremoloHz     tremolo.hz
  //   tremoloDepth  tremolo.depth
  //   ampGain       amp の各点の gain に独立に適用（0 の端点は 0 のまま揺らさない）
  "jitter": {
    "f0": 0.05,
    "durationMs": 0.15,
    "harmonics": 0.1,
    "noiseMix": 0.2,
    "noiseCutoff": 0.15,
    "vibratoHz": 0.1,
    "vibratoCents": 0.2,
    "tremoloHz": 0.1,
    "tremoloDepth": 0.2,
    "ampGain": 0.08
  }
}

===========================================================================
CLI
===========================================================================

  python3 overlay/tools/cry/synth.py <preset|recipe.json> [--out DIR]
      [--variants 3] [--seed N] [--dump-recipe]

  preset は murmur / sigh / touch / startle-yelp / startle-kyu / startle-double
  のいずれか、または上記スキーマに従う recipe.json へのパス。
  startle は実機（cry.js）ではグループ（3 パターンから再生ごとにランダム選択）
  として扱うが、この Mac プロトタイプでは個別プリセットとして直接試聴する。

  --dump-recipe : 使用したレシピ JSON（ゆらぎ適用前のベース）を stdout へ出力する
  --variants K  : K 個の変奏 WAV を生成する（既定 1）
  --seed N      : ベースシード。省略時はランダムに決めて stderr に表示する
                  （後で --seed に渡せば同じ変奏群を再現できる）
  --out DIR     : 出力ディレクトリ（既定はこの調査セッションのスクラッチ領域。
                  実運用では明示的に --out を指定すること）

  出力ファイル名: <name>-<seed>.wav （seed はその変奏に実際に使ったシード）
"""

import argparse
import copy
import json
import math
import os
import random
import struct
import sys
import wave

SAMPLE_RATE = 8000
TARGET_PEAK_DBFS = -3.0
VIBRATO_FADE_SEC = 0.12

DEFAULT_OUT_DIR = (
    "/private/tmp/claude-501/-Users-hiro-dev-hobby-breathing/"
    "a3c99517-f83f-4d0f-abf3-21e56a226d08/scratchpad/cry"
)  # この調査セッションのスクラッチ領域。実運用では --out を明示する。


# ---------------------------------------------------------------------------
# プリセット（4 種）
# ---------------------------------------------------------------------------

PRESETS = {
    # 寝息・小さな「くぅ」。f0 220Hz 付近から緩やかに下降、倍音少なめ、
    # ノイズ 40% 前後、ソフトアタック。
    "murmur": {
        "name": "murmur",
        "durationMs": 420,
        "pitch": [[0.0, 226], [0.5, 208], [1.0, 188]],
        "harmonics": [1.0, 0.3, 0.1],
        "vibrato": {"hz": 4.5, "cents": 10, "onset": 0.1},
        "tremolo": {"hz": 5.0, "depth": 0.05},
        "amp": [[0.0, 0.0], [0.25, 0.9], [0.7, 0.55], [1.0, 0.0]],
        "noise": {"mix": 0.4, "cutoff": 1500, "cutoffEnd": 900},
        "jitter": {
            "f0": 0.05,
            "durationMs": 0.15,
            "harmonics": 0.1,
            "noiseMix": 0.2,
            "noiseCutoff": 0.15,
            "vibratoHz": 0.1,
            "vibratoCents": 0.2,
            "tremoloHz": 0.1,
            "tremoloDepth": 0.2,
            "ampGain": 0.08,
        },
    },
    # 吐息。ほぼノイズ、カットオフが下降、ゆっくり減衰。
    "sigh": {
        "name": "sigh",
        "durationMs": 1000,
        "pitch": [[0.0, 175], [1.0, 150]],
        "harmonics": [1.0, 0.15],
        "vibrato": {"hz": 3.5, "cents": 6, "onset": 0.3},
        "tremolo": {"hz": 4.0, "depth": 0.12},
        "amp": [[0.0, 0.0], [0.08, 0.7], [0.4, 0.55], [1.0, 0.0]],
        "noise": {"mix": 0.88, "cutoff": 1200, "cutoffEnd": 400},
        "jitter": {
            "f0": 0.04,
            "durationMs": 0.15,
            "harmonics": 0.15,
            "noiseMix": 0.08,
            "noiseCutoff": 0.2,
            "vibratoHz": 0.1,
            "vibratoCents": 0.25,
            "tremoloHz": 0.15,
            "tremoloDepth": 0.25,
            "ampGain": 0.1,
        },
    },
    # 短い「びくっ」。startle はグループ — 3 パターンから実機では再生ごとに
    # ランダムに1つ選ぶ（cry.js 側）。Mac プロトタイプでは個別プリセットとして
    # 直接試聴できるようにトップレベルへ展開する。
    "startle-yelp": {
        "name": "startle-yelp",
        "durationMs": 200,
        "pitch": [[0.0, 320], [0.35, 520], [0.7, 480], [1.0, 380]],
        "harmonics": [1.0, 0.5, 0.25, 0.12],
        "vibrato": {"hz": 18, "cents": 30, "onset": 0.02},
        "amp": [[0.0, 0.0], [0.08, 1.0], [0.5, 0.8], [1.0, 0.0]],
        "noise": {"mix": 0.3, "cutoff": 2200, "cutoffEnd": 1200},
        "jitter": {
            "f0": 0.06,
            "durationMs": 0.12,
            "noiseMix": 0.15,
            "vibratoCents": 0.25,
        },
    },
    "startle-kyu": {
        "name": "startle-kyu",
        "durationMs": 160,
        "pitch": [[0.0, 380], [0.4, 470], [1.0, 300]],
        "harmonics": [1.0, 0.35, 0.1],
        "vibrato": {"hz": 14, "cents": 20, "onset": 0.0},
        "amp": [[0.0, 0.0], [0.12, 0.9], [0.6, 0.6], [1.0, 0.0]],
        "noise": {"mix": 0.42, "cutoff": 1800, "cutoffEnd": 1000},
        "jitter": {
            "f0": 0.06,
            "durationMs": 0.12,
            "noiseMix": 0.15,
            "vibratoCents": 0.25,
        },
    },
    "startle-double": {
        "name": "startle-double",
        "durationMs": 260,
        "pitch": [[0.0, 340], [0.25, 500], [0.45, 430], [0.6, 490], [1.0, 360]],
        "harmonics": [1.0, 0.45, 0.2],
        "vibrato": {"hz": 16, "cents": 25, "onset": 0.02},
        "amp": [[0.0, 0.0], [0.1, 1.0], [0.4, 0.15], [0.55, 0.85], [1.0, 0.0]],
        "noise": {"mix": 0.32, "cutoff": 2000, "cutoffEnd": 1100},
        "jitter": {
            "f0": 0.06,
            "durationMs": 0.12,
            "noiseMix": 0.15,
            "vibratoCents": 0.25,
        },
    },
    # 頭頂タッチへの応答。一番柔らかい。山なりのピッチ、全体に弱い。
    "touch": {
        "name": "touch",
        "durationMs": 300,
        "pitch": [[0.0, 252], [0.5, 268], [1.0, 250]],
        "harmonics": [1.0, 0.25],
        "vibrato": {"hz": 5.0, "cents": 8, "onset": 0.05},
        "tremolo": {"hz": 6.0, "depth": 0.06},
        "amp": [[0.0, 0.0], [0.35, 0.55], [0.65, 0.55], [1.0, 0.0]],
        "noise": {"mix": 0.3, "cutoff": 1800, "cutoffEnd": 1400},
        "jitter": {
            "f0": 0.05,
            "durationMs": 0.15,
            "harmonics": 0.12,
            "noiseMix": 0.2,
            "noiseCutoff": 0.15,
            "vibratoHz": 0.1,
            "vibratoCents": 0.2,
            "tremoloHz": 0.1,
            "tremoloDepth": 0.2,
            "ampGain": 0.1,
        },
    },
}


# ---------------------------------------------------------------------------
# 補間ヘルパー
# ---------------------------------------------------------------------------


def _clamp01(x):
    return max(0.0, min(1.0, x))


def interp_linear(t, points):
    """points = [[t, v], ...]（t 昇順）を線形補間する。"""
    if t <= points[0][0]:
        return points[0][1]
    if t >= points[-1][0]:
        return points[-1][1]
    for (t0, v0), (t1, v1) in zip(points, points[1:]):
        if t0 <= t <= t1:
            if t1 == t0:
                return v1
            frac = (t - t0) / (t1 - t0)
            return v0 + (v1 - v0) * frac
    return points[-1][1]


def interp_log(t, points):
    """points = [[t, v], ...]（t 昇順、v > 0）を対数補間する（周波数用）。"""
    if t <= points[0][0]:
        return max(points[0][1], 1e-6)
    if t >= points[-1][0]:
        return max(points[-1][1], 1e-6)
    for (t0, v0), (t1, v1) in zip(points, points[1:]):
        if t0 <= t <= t1:
            if t1 == t0:
                return max(v1, 1e-6)
            frac = (t - t0) / (t1 - t0)
            v0 = max(v0, 1e-6)
            v1 = max(v1, 1e-6)
            return v0 * ((v1 / v0) ** frac)
    return max(points[-1][1], 1e-6)


# ---------------------------------------------------------------------------
# ゆらぎ（jitter）適用
# ---------------------------------------------------------------------------


def apply_jitter(recipe, rng):
    """recipe に jitter 設定を適用したコピーを返す（recipe 自体は変更しない）。"""
    r = copy.deepcopy(recipe)
    j = recipe.get("jitter") or {}

    def factor(key):
        spread = j.get(key, 0.0)
        if not spread:
            return 1.0
        return 1.0 + rng.uniform(-spread, spread)

    f0_factor = factor("f0")
    r["pitch"] = [[t, hz * f0_factor] for t, hz in r["pitch"]]

    r["durationMs"] = recipe["durationMs"] * factor("durationMs")

    spread_h = j.get("harmonics", 0.0)
    if spread_h:
        r["harmonics"] = [
            max(0.0, g * (1.0 + rng.uniform(-spread_h, spread_h)))
            for g in r["harmonics"]
        ]

    if r.get("noise"):
        noise = dict(r["noise"])
        noise["mix"] = _clamp01(noise["mix"] * factor("noiseMix"))
        cutoff_factor = factor("noiseCutoff")
        noise["cutoff"] = noise["cutoff"] * cutoff_factor
        noise["cutoffEnd"] = noise.get("cutoffEnd", noise["cutoff"]) * cutoff_factor
        r["noise"] = noise

    if r.get("vibrato"):
        vibrato = dict(r["vibrato"])
        vibrato["hz"] = vibrato["hz"] * factor("vibratoHz")
        vibrato["cents"] = vibrato["cents"] * factor("vibratoCents")
        r["vibrato"] = vibrato

    if r.get("tremolo"):
        tremolo = dict(r["tremolo"])
        tremolo["hz"] = tremolo["hz"] * factor("tremoloHz")
        tremolo["depth"] = _clamp01(tremolo["depth"] * factor("tremoloDepth"))
        r["tremolo"] = tremolo

    spread_a = j.get("ampGain", 0.0)
    if spread_a:
        new_amp = []
        for t, g in r["amp"]:
            if g == 0.0:
                new_amp.append([t, 0.0])
            else:
                new_amp.append([t, _clamp01(g * (1.0 + rng.uniform(-spread_a, spread_a)))])
        r["amp"] = new_amp

    return r


# ---------------------------------------------------------------------------
# レンダリング（DSP コア）
# ---------------------------------------------------------------------------


def render(recipe, rng, sample_rate=SAMPLE_RATE):
    """recipe（ゆらぎ適用後）から float サンプル列（-1..1 目安）を生成する。"""
    n = max(1, int(round(recipe["durationMs"] / 1000.0 * sample_rate)))
    pitch_points = sorted(recipe["pitch"], key=lambda p: p[0])
    amp_points = sorted(recipe["amp"], key=lambda p: p[0])
    harmonics = recipe.get("harmonics") or [1.0]
    harmonics_norm = sum(abs(g) for g in harmonics) or 1.0
    vibrato = recipe.get("vibrato")
    tremolo = recipe.get("tremolo")
    noise_cfg = recipe.get("noise")

    dt = 1.0 / sample_rate

    # --- トーン成分（サイン加算 + ピッチカーブ + ビブラート）---
    # 周波数が時間変化するため、位相は毎サンプル積分して連続性を保つ
    # （k 倍音の位相は基音位相 * (k+1) で得られる：積分の線形性による）。
    tonal = [0.0] * n
    phase = 0.0
    for i in range(n):
        t = i / (n - 1) if n > 1 else 0.0
        f0 = interp_log(t, pitch_points)
        if vibrato and vibrato.get("cents"):
            time_s = i * dt
            onset = vibrato.get("onset", 0.0)
            if time_s <= onset:
                vib_env = 0.0
            else:
                x = min(1.0, (time_s - onset) / VIBRATO_FADE_SEC)
                vib_env = x * x * (3 - 2 * x)  # smoothstep
            lfo = math.sin(2 * math.pi * vibrato.get("hz", 5.0) * time_s)
            f0 = f0 * (2.0 ** (vibrato["cents"] / 1200.0 * vib_env * lfo))
        phase += 2 * math.pi * f0 * dt
        acc = 0.0
        for k, g in enumerate(harmonics):
            if g:
                acc += g * math.sin(phase * (k + 1))
        tonal[i] = acc / harmonics_norm

    # --- ノイズ成分（白色 → 一次ローパス、カットオフは時間で対数補間）---
    noise_buf = [0.0] * n
    mix = 0.0
    if noise_cfg and noise_cfg.get("mix", 0.0) > 0:
        mix = _clamp01(noise_cfg["mix"])
        cutoff_points = [
            [0.0, max(1.0, noise_cfg.get("cutoff", 1000.0))],
            [1.0, max(1.0, noise_cfg.get("cutoffEnd", noise_cfg.get("cutoff", 1000.0)))],
        ]
        prev = 0.0
        for i in range(n):
            t = i / (n - 1) if n > 1 else 0.0
            fc = min(interp_log(t, cutoff_points), sample_rate * 0.45)
            a = 1.0 - math.exp(-2 * math.pi * fc / sample_rate)
            white = rng.uniform(-1.0, 1.0)
            prev = prev + a * (white - prev)
            noise_buf[i] = prev
        peak = max((abs(x) for x in noise_buf), default=0.0)
        if peak > 1e-9:
            noise_buf = [x / peak for x in noise_buf]

    # --- ミックス + 振幅エンベロープ + トレモロ ---
    out = [0.0] * n
    for i in range(n):
        t = i / (n - 1) if n > 1 else 0.0
        amp_env = interp_linear(t, amp_points)
        sample = (1.0 - mix) * tonal[i] + mix * noise_buf[i]
        if tremolo and tremolo.get("depth"):
            time_s = i * dt
            trem = 1.0 - tremolo["depth"] * (
                1 - math.cos(2 * math.pi * tremolo.get("hz", 5.0) * time_s)
            ) / 2.0
            sample *= trem
        out[i] = sample * amp_env

    return out


# ---------------------------------------------------------------------------
# WAV 書き出し（クリッピング防止の正規化を含む）
# ---------------------------------------------------------------------------


def write_wav(path, samples, sample_rate=SAMPLE_RATE):
    peak = max((abs(x) for x in samples), default=0.0)
    target = 10 ** (TARGET_PEAK_DBFS / 20.0)
    scale = (target / peak) if peak > 1e-9 else 1.0

    ints = []
    for x in samples:
        v = max(-1.0, min(1.0, x * scale))
        ints.append(int(round(v * 32767)))

    data = struct.pack("<%dh" % len(ints), *ints)
    with wave.open(path, "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(sample_rate)
        f.writeframes(data)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def load_recipe(spec):
    """spec がプリセット名ならそれを、そうでなければ JSON ファイルとして読む。"""
    if spec in PRESETS:
        return copy.deepcopy(PRESETS[spec]), spec
    with open(spec, "r", encoding="utf-8") as f:
        recipe = json.load(f)
    name = recipe.get("name") or os.path.splitext(os.path.basename(spec))[0]
    return recipe, name


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="StackChan 鳴き声レシピのシンセ（Mac プロトタイプ、8kHz WAV 出力）"
    )
    parser.add_argument("recipe", help="プリセット名（murmur/sigh/startle/touch）または recipe.json のパス")
    parser.add_argument("--out", default=DEFAULT_OUT_DIR, help="出力ディレクトリ")
    parser.add_argument("--variants", type=int, default=1, help="生成する変奏数")
    parser.add_argument("--seed", type=int, default=None, help="ベースシード（省略時はランダム）")
    parser.add_argument(
        "--dump-recipe",
        action="store_true",
        help="使用したレシピ JSON（ゆらぎ適用前のベース）を stdout へ出力する",
    )
    args = parser.parse_args(argv)

    recipe, name = load_recipe(args.recipe)

    if args.dump_recipe:
        print(json.dumps(recipe, indent=2, ensure_ascii=False))

    base_seed = args.seed
    if base_seed is None:
        base_seed = random.SystemRandom().randrange(0, 2**31)
        print(f"# seed base not given, using {base_seed} (--seed {base_seed} で再現可能)", file=sys.stderr)

    os.makedirs(args.out, exist_ok=True)

    output_paths = []
    for i in range(max(1, args.variants)):
        variant_seed = base_seed + i
        rng = random.Random(variant_seed)
        jittered = apply_jitter(recipe, rng)
        samples = render(jittered, rng)
        path = os.path.join(args.out, f"{name}-{variant_seed}.wav")
        write_wav(path, samples)
        output_paths.append(path)

    for path in output_paths:
        print(path)

    return 0


if __name__ == "__main__":
    sys.exit(main())
