import { CONFIG, ONLINE, type ApiMode } from "@/lib/constants";
import { seededRandom } from "@/lib/random";

/** presence 連動時の orb 数上限（にぎわり圧力を抑える） */
export const ORB_LIMITS = {
  min: 3,
  max: 7,
} as const;

/**
 * orb 表示数の目標値。
 * - オンライン + 連動 ON: presence 実数（1〜7、最後の 1 つが you）
 * - それ以外: 演出 fallback（3〜5、上限 7）
 */
export function resolveOrbTarget(
  apiMode: ApiMode,
  livePresence: number | null,
  sessionSeed: number,
): number {
  if (!ONLINE.enabled || !ONLINE.orbLinkEnabled) {
    return CONFIG.orbCount;
  }

  if (apiMode === "online" && livePresence !== null) {
    return Math.min(
      ORB_LIMITS.max,
      Math.max(1, livePresence),
    );
  }

  const fallback = 3 + Math.floor(seededRandom(sessionSeed + 11) * 3);
  return Math.min(ORB_LIMITS.max, Math.max(ORB_LIMITS.min, fallback));
}
