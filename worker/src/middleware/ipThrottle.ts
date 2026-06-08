import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { routeIdFromPath } from "../db/routes";
import { checkIpThrottle, hashIp } from "../security";
import type { AppEnv } from "../types";

export const ipThrottleGuard = createMiddleware<AppEnv>(async (c, next) => {
  const ipHash = await hashIp(c.req.raw);
  c.set("ipHash", ipHash);

  const throttle = await checkIpThrottle(
    c.env,
    ipHash,
    routeIdFromPath(c.req.path),
  );

  if (!throttle.allowed) {
    throw new HTTPException(429, {
      message: "rate_limited",
      res: c.json(
        { error: "rate_limited" },
        429,
        throttle.retryAfterSec
          ? { "Retry-After": String(throttle.retryAfterSec) }
          : {},
      ),
    });
  }

  await next();
});
