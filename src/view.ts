import { Eta } from "eta";
import path from "path";
import { env } from "bun";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Context } from "hono";
import type { PublicUser } from "./models/user.model";

/** Eta instance — template engine (Blade/EJS-like). Views in `views/`. */
const eta = new Eta({
  views: path.join(import.meta.dir, "..", "views"),
  defaultExtension: ".eta.html",
  // Cache compiled templates in production only; dev keeps hot-reload behaviour.
  cache: env.NODE_ENV === "production",
  autoEscape: true,
});

export type Flash = { type: "success" | "error"; message: string } | null;

/** Hono context variables set by middleware (typed `c.get`). */
export type AppEnv = {
  Variables: {
    user: PublicUser | null;
    flash: Flash;
    userId: string;
  };
};

/** Render Eta template → HTML response. Laravel-like `return view(...)`. */
export function view(
  c: Context<AppEnv>,
  template: string,
  data: Record<string, unknown> = {}
) {
  const user = c.get("user");
  const flash = c.get("flash");
  return c.html(
    eta.render(template, {
      user,
      flash,
      path: c.req.path,
      ...data,
    })
  );
}

/** Redirect (PRG — Post/Redirect/Get). */
export function redirect(c: Context, to: string, status: 301 | 302 = 302) {
  return c.redirect(to, status);
}

/** Set flash message via cookie (read once, then deleted). */
function setFlash(c: Context, type: "success" | "error", message: string) {
  setCookie(c, "flash", JSON.stringify({ type, message }), {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 60,
  });
}

export function flashSuccess(c: Context, message: string) {
  setFlash(c, "success", message);
}

export function flashError(c: Context, message: string) {
  setFlash(c, "error", message);
}

/** Read + delete flash from cookie (called in locals middleware). */
export function consumeFlash(c: Context): Flash {
  const raw = getCookie(c, "flash");
  if (!raw) return null;
  deleteCookie(c, "flash");
  try {
    const parsed = JSON.parse(raw);
    return parsed.type && parsed.message ? parsed : null;
  } catch {
    return null;
  }
}