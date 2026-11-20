import { Hono } from "hono";
import type { Db } from "../db";
import type { AppEnv } from "../view";
import { injectLocals } from "../middleware/locals.middleware";
import { authController } from "../controllers/auth.controller";
import { settingsController } from "../controllers/settings.controller";
import { adminController } from "../controllers/admin.controller";
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
  app.route("/studio", authController(db)); // /studio/login, /studio/register, /studio/logout
  app.route("/studio", settingsController(db)); // /studio/settings*
  app.route("/studio", karyaAdminController(db)); // /studio/karya*
  app.route("/", karyaPublicController(db)); // /karya/:id + like
  app.route("/admin", adminController(db)); // /admin/* — moderation panel (admin only)

  return app;
}