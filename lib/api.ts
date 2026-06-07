import type { ApiMode, PresenceResponse } from "@/lib/constants";

const STATIC_ONLY_HEADER = "static-only";

function apiUrl(base: string, path: string): string {
  const normalized = base.replace(/\/$/, "");
  return normalized ? `${normalized}${path}` : path;
}

function parseMode(
  status: number,
  headerMode: string | null,
  body: { mode?: string; online?: boolean },
): ApiMode {
  if (
    status === 503 ||
    headerMode === STATIC_ONLY_HEADER ||
    body.mode === "static_only" ||
    body.online === false
  ) {
    return "static_only";
  }
  return body.mode === "online" ? "online" : "offline";
}

export async function fetchPresence(apiBase: string): Promise<PresenceResponse> {
  try {
    const res = await fetch(apiUrl(apiBase, "/api/presence"), {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });

    const headerMode = res.headers.get("X-Breathing-Mode");
    let body: { mode?: string; online?: boolean; count?: number; reason?: string } =
      {};
    try {
      body = await res.json();
    } catch {
      /* empty */
    }

    const mode = parseMode(res.status, headerMode, body);
    if (mode === "static_only") {
      return {
        online: false,
        mode: "static_only",
        reason: body.reason ?? "budget_exceeded",
      };
    }

    if (!res.ok) {
      return { online: false, mode: "offline" };
    }

    return {
      online: true,
      mode: "online",
      count: typeof body.count === "number" ? body.count : 0,
    };
  } catch {
    return { online: false, mode: "offline" };
  }
}

export async function submitWord(
  apiBase: string,
  text: string,
): Promise<{ ok: boolean; mode: ApiMode }> {
  try {
    const res = await fetch(apiUrl(apiBase, "/api/words"), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    const headerMode = res.headers.get("X-Breathing-Mode");
    let body: { mode?: string; online?: boolean; ok?: boolean } = {};
    try {
      body = await res.json();
    } catch {
      /* empty */
    }

    const mode = parseMode(res.status, headerMode, body);
    if (mode === "static_only") {
      return { ok: false, mode: "static_only" };
    }

    return { ok: res.ok && body.ok === true, mode: res.ok ? "online" : "offline" };
  } catch {
    return { ok: false, mode: "offline" };
  }
}
