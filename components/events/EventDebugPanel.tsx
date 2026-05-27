"use client";

import { useSyncExternalStore } from "react";
import { getEventDefinition } from "@/components/events/registry";
import type { ActiveEvent } from "@/lib/events/types";

type Props = {
  activeEvent: ActiveEvent | null;
  nextFireAt: number | null;
  paused: boolean;
};

function getRemainingSeconds(nextFireAt: number | null): number | null {
  if (nextFireAt === null) return null;
  return Math.max(0, Math.ceil((nextFireAt - Date.now()) / 1000));
}

function useRemainingSeconds(nextFireAt: number | null): number | null {
  return useSyncExternalStore(
    (onStoreChange) => {
      if (nextFireAt === null) return () => {};
      const id = window.setInterval(onStoreChange, 250);
      return () => window.clearInterval(id);
    },
    () => getRemainingSeconds(nextFireAt),
    () => null,
  );
}

/** デバッグ ON 時だけ、イベントの状態を表示する */
export function EventDebugPanel({ activeEvent, nextFireAt, paused }: Props) {
  const remaining = useRemainingSeconds(paused ? null : nextFireAt);

  const status = paused
    ? "paused"
    : activeEvent
      ? "active"
      : "waiting";

  const statusLabel =
    status === "paused"
      ? "停止中"
      : status === "active"
        ? "発生中"
        : "待機中";

  const eventLabel = activeEvent
    ? getEventDefinition(activeEvent.type).label
    : "—";

  return (
    <aside className="event-debug" aria-live="polite">
      <div className="event-debug-head">
        <span className="event-debug-badge">debug</span>
        <span className={`event-debug-status event-debug-status--${status}`}>
          {statusLabel}
        </span>
      </div>
      <dl className="event-debug-body">
        <div className="event-debug-row">
          <dt>event</dt>
          <dd>{eventLabel}</dd>
        </div>
        {status === "waiting" && remaining !== null && (
          <div className="event-debug-row">
            <dt>next</dt>
            <dd>{remaining}s</dd>
          </div>
        )}
        {activeEvent && (
          <div className="event-debug-row">
            <dt>id</dt>
            <dd>{activeEvent.instanceId.slice(0, 8)}</dd>
          </div>
        )}
      </dl>
    </aside>
  );
}
