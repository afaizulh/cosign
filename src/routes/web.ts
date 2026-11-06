import { Hono } from "hono";
import type { Db } from "../db";
import type { AppEnv } from "../view";
import { injectLocals } from "../middleware/locals.middleware";
import { authController } from "../controllers/auth.controller";
import { pageController } from "../controllers/page.controller";
import {
  karyaAdminController,
  karyaPublicController,
} from "../controllers/karya.controller";

/** Web router: all browser pages (server-rendered, form POST). */
export function web(db: Db) {
  const app = new Hono<AppEnv>();

  // Locals: logged-in user + flash message for every page
  app.use("*", injectLocals(db));

  app.route("/", pageController(db)); // homepage + profile
  app.route("/admin", authController(db)); // /admin/login, /admin/register, /admin/logout
  app.route("/admin", karyaAdminController(db)); // /admin/karya*
  app.route("/", karyaPublicController(db)); // /karya/:id + like

  return app;
}