import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Context, Next } from "hono";
import { env } from "bun";
import type { Db } from "../db";
import type { AppEnv } from "../view";
import { SessionModel, SESSION_TTL_DAYS } from "../models/session.model";

/**
 * Only allow same-origin relative paths as post-login targets.
 * Blocks open redirects (`//evil.com`, `https://evil.com`, backslash tricks).
 */
export function safeNext(raw: unknown): string | null {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return null;
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//") || value.startsWith("/\\")) return null;
  if (value.includes("://")) return null;
  return value;
}

/** Login URL that remembers the page the user was trying to open. */
export function loginUrl(c: Context<AppEnv>): string {
  const url = new URL(c.req.url);
  const next = url.pathname + url.search;
  if (next === "/" || next === "/studio") return "/studio/login";
  return `/studio/login?next=${encodeURIComponent(next)}`;
}

/** Cookie `secure` only over HTTPS — http://localhost dev must still work. */
const COOKIE_SECURE = (env.APP_URL || "").startsWith("https://");

function sessions(db: Db) {
  return new SessionModel(db.sqlite!);
}

/** Get userId from session cookie (null if not logged in). */
export function getUserId(c: Context<AppEnv>, db: Db): string | null {
  const sid = getCookie(c, "sid");
  if (!sid || !db.sqlite) return null;
  return sessions(db).findBySid(sid);
}

/** Create new session (httpOnly cookie, 7 days). */
export async function createSession(c: Context<AppEnv>, db: Db, userId: string) {
  if (!db.sqlite) return;
  const sid = sessions(db).create(userId);
  setCookie(c, "sid", sid, {
    httpOnly: true,
    sameSite: "Lax",
    secure: COOKIE_SECURE,
    path: "/",
    maxAge: 60 * 60 * 24 * SESSION_TTL_DAYS,
  });
}

/** Delete session from DB + cookie. */
export function destroySession(c: Context<AppEnv>, db: Db) {
  const sid = getCookie(c, "sid");
  if (sid && db.sqlite) sessions(db).delete(sid);
  deleteCookie(c, "sid");
}

/** Middleware: require login. Sets c.set("userId"). Redirects to login. */
export function requireAuth(db: Db) {
  return async (c: Context<AppEnv>, next: Next) => {
    const userId = getUserId(c, db);
    if (!userId) return c.redirect(loginUrl(c), 302);
    c.set("userId", userId);
    await next();
  };
}

/**
 * Middleware guest: for login/register pages.
 * Logged-in users are sent to `?next=` when present, otherwise /studio.
 */
export function redirectIfAuthenticated(db: Db) {
  return async (c: Context<AppEnv>, next: Next) => {
    const userId = getUserId(c, db);
    if (userId) {
      const target = safeNext(c.req.query("next")) ?? "/studio";
      return c.redirect(target, 302);
    }
    await next();
  };
}