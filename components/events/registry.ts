import { CompanionBreathEvent } from "./CompanionBreathEvent";
import { ShootingStarEvent } from "./ShootingStarEvent";
import type { EventDefinition, EventType } from "@/lib/events/types";

/** ここにイベントを追加していく */
export const EVENT_REGISTRY: EventDefinition[] = [
  {
    type: "shooting-star",
    label: "流れ星",
    weight: 1,
    durationMs: 3_200,
    Component: ShootingStarEvent,
  },
  {
    type: "companion-breath",
    label: "一緒に呼吸",
    weight: 0.65,
    durationMs: 26_000,
    Component: CompanionBreathEvent,
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

/** weight に応じて 1 つ選ぶ */
export function pickRandomEventType(): EventType {
  const total = EVENT_REGISTRY.reduce((sum, def) => sum + def.weight, 0);
  let roll = Math.random() * total;

  for (const def of EVENT_REGISTRY) {
    roll -= def.weight;
    if (roll <= 0) return def.type;
  }

  return EVENT_REGISTRY[EVENT_REGISTRY.length - 1].type;
}
