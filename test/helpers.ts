import { Database } from "bun:sqlite";
import { migrate } from "../src/db";
import { createApp } from "../src/app";
import type { Db } from "../src/db";

/** In-memory SQLite DB — never touches data/app.db. */
export function createTestDb(): Database {
  const db = new Database(":memory:");
  migrate(db);
  return db;
}

/** Full Hono app with in-memory DB. */
export function createTestApp() {
  const sqlite = createTestDb();
  const db: Db = { driver: "sqlite", sqlite, supabase: null };
  return createApp(db);
}

/** Join all cookies from a response ("sid=...; flash=..."). Skips empty (delete) cookies. */
export function cookieFrom(res: Response): string {
  const cookies =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : [res.headers.get("set-cookie") ?? ""].filter(Boolean);
  return cookies
    .map((c) => c.split(";")[0])
    .filter((c) => {
      const value = c.slice(c.indexOf("=") + 1);
      return value.length > 0;
    })
    .join("; ");
}

/** Base headers for form POSTs (origin required for csrf). */
export const formHeaders = {
  origin: "http://localhost:3000",
};

/** Full form POST headers (urlencoded). */
export const formPostHeaders = {
  ...formHeaders,
  "content-type": "application/x-www-form-urlencoded",
};

/** Register a user + return session cookie. */
export async function registerUser(
  app: { request: (path: string, init?: RequestInit) => Promise<Response> | Response },
  username = "admin",
  password = "rahasia123"
): Promise<string> {
  const res = await app.request("/admin/register", {
    method: "POST",
    headers: formPostHeaders,
    body: new URLSearchParams({ username, password }).toString(),
  });
  return cookieFrom(res);
}