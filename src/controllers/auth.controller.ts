import { Hono } from "hono";
import type { Db } from "../db";
import { UserModel } from "../models/user.model";
import {
  createSession,
  destroySession,
  redirectIfAuthenticated,
  requireAuth,
} from "../middleware/auth.middleware";
import { view, redirect, flashSuccess, flashError, type AppEnv } from "../view";

/** Controller: /admin/auth — register, login, logout (form POST). */
export function authController(db: Db) {
  const app = new Hono<AppEnv>();

  if (!db.sqlite) {
    app.all("*", (c) => c.text("supabase mode not implemented", 501));
    return app;
  }

  const users = new UserModel(db.sqlite);

  app.get("/login", redirectIfAuthenticated(db), (c) =>
    view(c, "admin/auth/login", { errors: null, old: {} })
  );

  app.post("/login", redirectIfAuthenticated(db), async (c) => {
    const body = await c.req.parseBody();
    const username = String(body.username ?? "").trim();
    const password = String(body.password ?? "");

    const id = await users.verifyPassword(username, password);
    if (!id) {
      return view(c, "admin/auth/login", {
        errors: ["Invalid username or password."],
        old: { username },
      });
    }

    await createSession(c, db, id);
    flashSuccess(c, "Welcome back!");
    return redirect(c, "/admin/karya");
  });

  app.get("/register", redirectIfAuthenticated(db), (c) =>
    view(c, "admin/auth/register", { errors: null, old: {} })
  );

  app.post("/register", redirectIfAuthenticated(db), async (c) => {
    const body = await c.req.parseBody();
    const username = String(body.username ?? "").trim();
    const password = String(body.password ?? "");
    const fullName = String(body.full_name ?? "").trim();

    const errors: string[] = [];
    // URL-safe only: profiles live at /profil/:username
    if (!/^[a-z0-9_-]{3,20}$/.test(username)) {
      errors.push(
        "Username must be 3–20 characters: lowercase letters, numbers, underscore or hyphen."
      );
    }
    if (!password || password.length < 6) {
      errors.push("Password must be at least 6 characters.");
    }
    if (username && users.usernameExists(username)) {
      errors.push("That username is already taken.");
    }

    if (errors.length) {
      return view(c, "admin/auth/register", {
        errors,
        old: { username, full_name: fullName },
      });
    }

    const id = await users.create(username, password, fullName || undefined);
    await createSession(c, db, id);
    flashSuccess(c, "Account created. Welcome to CoSign!");
    return redirect(c, "/admin/karya");
  });

  app.post("/logout", requireAuth(db), (c) => {
    destroySession(c, db);
    flashSuccess(c, "Signed out.");
    return redirect(c, "/");
  });

  return app;
}