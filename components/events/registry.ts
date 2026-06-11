import { BreathWaveEvent } from "./BreathWaveEvent";
import { ShootingStarEvent } from "./ShootingStarEvent";
import { isDeepNightPhase } from "@/lib/dayCycle";
import type { EventDefinition, EventType } from "@/lib/events/types";

/** ここにイベントを追加していく */
export const EVENT_REGISTRY: EventDefinition[] = [
  {
    type: "shooting-star",
    label: "流れ星",
    weight: 2.5,
    durationMs: 3_200,
    Component: ShootingStarEvent,
  },
  {
    type: "breath-wave",
    label: "波",
    weight: 0.7,
    durationMs: 5_500,
    Component: BreathWaveEvent,
  },
];

const registryByType = new Map<EventType, EventDefinition>(
  EVENT_REGISTRY.map((def) => [def.type, def]),
);

export function getEventDefinition(type: EventType): EventDefinition {
  const def = registryByType.get(type);
  if (!def) throw new Error(`Unknown event type: ${type}`);
  return def;
}

export function isEventAllowed(type: EventType, phase: number): boolean {
  if (type === "shooting-star") return isDeepNightPhase(phase);
  return true;
}

/** weight に応じて 1 つ選ぶ（時間帯で候補を絞る） */
export function pickRandomEventType(phase: number): EventType {
  const candidates = EVENT_REGISTRY.filter((def) =>
    isEventAllowed(def.type, phase),
  );
  const pool = candidates.length > 0 ? candidates : EVENT_REGISTRY;

  const total = pool.reduce((sum, def) => sum + def.weight, 0);
  let roll = Math.random() * total;

  for (const def of pool) {
    roll -= def.weight;
    if (roll <= 0) return def.type;
  }

  return pool[pool.length - 1].type;
}
