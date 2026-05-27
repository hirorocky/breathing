"use client";

import { getEventDefinition } from "@/components/events/registry";
import type { ActiveEvent } from "@/lib/events/types";

type Props = {
  activeEvent: ActiveEvent | null;
  onComplete: () => void;
};

/** 現在アクティブなランダムイベントを 1 つだけ描画する */
export function EventLayer({ activeEvent, onComplete }: Props) {
  if (!activeEvent) return null;

  const { Component } = getEventDefinition(activeEvent.type);

  return (
    <Component
      key={activeEvent.instanceId}
      seed={activeEvent.seed}
      onComplete={onComplete}
    />
  );
}
