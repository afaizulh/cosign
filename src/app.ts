import { Hono } from "hono";
import { env } from "bun";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { csrf } from "hono/csrf";
import { serveStatic } from "hono/bun";
import type { Db } from "./db";
import type { AppEnv } from "./view";
import { web } from "./routes/web";

/** Build the full Hono app from a DB instance — used by server & unit tests. */
export function createApp(db: Db) {
  const app = new Hono<AppEnv>();

  // --- middleware ---
  app.use("*", logger());
  app.use("*", secureHeaders());
  const origin = env.CSRF_ORIGIN || "http://localhost:3000";
  app.use("*", csrf({ origin: [origin] }));

  // --- health check ---
  app.get("/health", (c) => c.json({ ok: true, driver: db.driver }));

  // --- web routes (server-rendered, form POST) ---
  app.route("/", web(db));

  // --- static files ---
  app.use(
    "/uploads/*",
    serveStatic({ root: "./", rewriteRequestPath: (p) => p.replace(/^\/uploads/, "uploads") })
  );
  app.use("*", serveStatic({ root: "./public" }));

  return app;
}