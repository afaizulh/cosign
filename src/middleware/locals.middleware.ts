import type { Context, Next } from "hono";
import type { Db } from "../db";
import type { AppEnv } from "../view";
import { UserModel, type PublicUser } from "../models/user.model";
import { getUserId } from "./auth.middleware";
import { consumeFlash, type Flash } from "../view";

/**
 * Locals middleware (Laravel-like): resolve logged-in user + flash message
 * for every web request, stored on the context so `view()` can use them.
 */
export function injectLocals(db: Db) {
  return async (c: Context<AppEnv>, next: Next) => {
    let user: PublicUser | null = null;
    const userId = getUserId(c, db);
    if (userId && db.sqlite) {
      user = new UserModel(db.sqlite).findPublic(userId);
    }
    const flash: Flash = consumeFlash(c);
    c.set("user", user);
    c.set("flash", flash);
    await next();
  };
}