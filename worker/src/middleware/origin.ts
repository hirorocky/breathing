import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { isOriginAllowed } from "../security";
import type { AppEnv } from "../types";

export const originGuard = createMiddleware<AppEnv>(async (c, next) => {
  if (!isOriginAllowed(c.req.raw, c.env)) {
    throw new HTTPException(403, {
      message: "forbidden_origin",
      res: c.json({ error: "forbidden_origin" }, 403),
    });
  }
  await next();
});
