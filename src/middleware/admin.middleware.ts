import type { Context, Next } from "hono";
import type { Db } from "../db";
import type { AppEnv } from "../view";
import { UserModel } from "../models/user.model";
import { getUserId, destroySession } from "./auth.middleware";

/**
 * Middleware: suspend gate for logged-in users.
 * A suspended account loses its session immediately and is sent back to login.
 */
export function requireActiveAccount(db: Db) {
  return async (c: Context<AppEnv>, next: Next) => {
    const userId = getUserId(c, db);
    if (!userId || !db.sqlite) return next();
    const users = new UserModel(db.sqlite);
    if (!users.isActive(userId)) {
      destroySession(c, db);
      return c.redirect("/studio/login", 302);
    }
    return next();
  };
}

/**
 * Middleware: admin only.
 * Guests are sent to login (redirect back, not a dead end); logged-in
 * non-admins get a plain 403 page — never a silent redirect.
 */
export function requireAdmin(db: Db) {
  return async (c: Context<AppEnv>, next: Next) => {
    const userId = getUserId(c, db);
    if (!userId) return c.redirect("/studio/login", 302);
    if (!db.sqlite) return c.text("supabase mode not implemented", 501);
    const users = new UserModel(db.sqlite);
    if (!users.isActive(userId)) {
      destroySession(c, db);
      return c.redirect("/studio/login", 302);
    }
    if (!users.isAdmin(userId)) return c.text("403 Forbidden — admin only", 403);
    c.set("userId", userId);
    await next();
  };
}
