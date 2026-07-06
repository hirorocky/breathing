import Preference from 'preference'

/**
 * v1.1.0 Phase 3a — `liveliness.js` の mergeValidated / sanitizeParams / Preference
 * 永続化パターンを汎用化した共有モジュール(domain は固定 'breath'、key はモジュールごと)。
 *
 * `liveliness.js` 自体はここでは変更しない(動作中のコードに触らない。移行は別の機会)。
 * 以下の実装は `liveliness.js` の同名関数と意味的に同一
 * (壊れた入力では変更しない `mergeValidated`、範囲外はクランプする `sanitizeParams`)。
 * 例外は全て握って trace のみ(再スローしない) — Promise は使わない。
 */

const PREF_DOMAIN = 'breath'

export function deepClone(value) {
  return JSON.parse(JSON.stringify(value))
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * `base` の形(キー・型・配列長)だけを信頼して `patch` を再帰的に反映する。
 * 未知のキー・型不一致・長さ不一致は黒く無視して `base` 側の値を残す
 * (「壊れた入力では変更しない」方針)。
 */
export function mergeValidated(base, patch) {
  if (Array.isArray(base)) {
    if (!Array.isArray(patch) || patch.length !== base.length) return base
    return patch.map((value, i) => (typeof value === typeof base[i] && typeof value !== 'object' ? value : base[i]))
  }
  if (isPlainObject(base)) {
    if (!isPlainObject(patch)) return base
    const merged = { ...base }
    for (const key of Object.keys(patch)) {
      if (!(key in base)) continue
      merged[key] = mergeValidated(base[key], patch[key])
    }
    return merged
  }
  return typeof patch === typeof base ? patch : base
}

/**
 * `clampRanges` は `{ 'section.key': [min, max] }` 形式。`target` を書き換えて返す
 * (`liveliness.js` の CLAMP_RANGES と同じ形式だが、呼び出し側が渡す引数になった点だけが違う)。
 */
export function sanitizeParams(target, clampRanges) {
  for (const path of Object.keys(clampRanges)) {
    const [section, key] = path.split('.')
    const [min, max] = clampRanges[path]
    const value = target[section]?.[key]
    if (typeof value === 'number') {
      target[section][key] = Math.min(max, Math.max(min, value))
    }
  }
  return target
}

/**
 * Preference から復元する。無ければ `defaults` の deep clone。
 * 壊れていれば trace して `defaults` の deep clone にフォールバックする(例外は投げない)。
 */
export function loadParams(key, defaults, clampRanges) {
  try {
    const raw = Preference.get(PREF_DOMAIN, key)
    if (!raw) return deepClone(defaults)
    const saved = JSON.parse(raw)
    const restored = sanitizeParams(mergeValidated(defaults, saved), clampRanges)
    trace(`[param-store] restored '${key}' from Preference\n`)
    return restored
  } catch (error) {
    trace(`[param-store] restore failed for '${key}': ${error}\n`)
    return deepClone(defaults)
  }
}

/** Preference へ保存する。失敗しても例外は投げない(trace のみ)。 */
export function persistParams(key, params) {
  try {
    Preference.set(PREF_DOMAIN, key, JSON.stringify(params))
  } catch (error) {
    trace(`[param-store] persist failed for '${key}': ${error}\n`)
  }
}
