import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import { adminRoutes } from "./routes/admin";
import { publicRoutes } from "./routes/public";
import { runVisitMaintenance } from "./scheduled";
import {
  isLocalDevOrigin,
  isLocalDevRequest,
  parseAllowedOrigins,
} from "./security";
import type { AppEnv, Env } from "./types";

const app = new Hono<AppEnv>();

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: (origin, c) => {
      const allowed = parseAllowedOrigins(c.env.ALLOWED_ORIGINS);
      if (origin && isLocalDevRequest(c.req.raw) && isLocalDevOrigin(origin)) {
        return origin;
      }
      if (allowed.length === 0) return origin ?? "*";
      return origin && allowed.includes(origin) ? origin : "";
    },
    credentials: true,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  }),
);

app.route("/api/admin", adminRoutes);
app.route("/api", publicRoutes);

app.notFound((c) => c.json({ error: "not_found" }, 404));

app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  console.error(err);
  return c.json({ error: "internal_error" }, 500);
});

export default {
  fetch: app.fetch,
  scheduled(
    _event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext,
  ): void {
    ctx.waitUntil(runVisitMaintenance(env));
  },
};
