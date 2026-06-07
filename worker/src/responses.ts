import type { SecurityEnv } from "./security";
import { corsHeadersForRequest } from "./security";

export function json(
  request: Request,
  env: SecurityEnv,
  data: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeadersForRequest(request, env),
      ...extraHeaders,
    },
  });
}

export function staticOnlyResponse(
  request: Request,
  env: SecurityEnv,
  reason: string,
  extra: Record<string, unknown> = {},
): Response {
  return json(
    request,
    env,
    {
      online: false,
      mode: "static_only",
      reason,
      ...extra,
    },
    503,
    {
      "X-Breathing-Mode": "static-only",
      "Retry-After": "3600",
    },
  );
}

export function corsPreflight(
  request: Request,
  env: SecurityEnv,
): Response {
  const cors = corsHeadersForRequest(request, env);
  return new Response(null, {
    status: 204,
    headers: {
      ...cors,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
    },
  });
}
