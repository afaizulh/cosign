import { describe, expect, test } from "bun:test";
import { createTestApp, registerUser, formPostHeaders } from "./helpers";

describe("Rate limit — login/register", () => {
  test("11th login attempt from same IP → 429", async () => {
    const app = createTestApp();
    const attempt = () =>
      app.request("/admin/login", {
        method: "POST",
        headers: formPostHeaders,
        body: new URLSearchParams({ username: "nobody", password: "wrong" }).toString(),
      });

    for (let i = 0; i < 10; i++) {
      const res = await attempt();
      expect(res.status).toBe(200); // invalid creds re-render form
    }
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
  });

  test("register is also rate limited", async () => {
    const app = createTestApp();
    const attempt = (username: string) =>
      app.request("/admin/register", {
        method: "POST",
        headers: formPostHeaders,
        body: new URLSearchParams({ username, password: "rahasia123" }).toString(),
      });

    for (let i = 0; i < 10; i++) {
      const res = await attempt(`user${i}`);
      expect(res.status).toBe(302);
    }
    expect((await attempt("userX")).status).toBe(429);
  });
});

describe("injectLocals — static assets skip DB", () => {
  test("serves /style.css even when DB would throw", async () => {
    const { createApp } = await import("../src/app");
    const throwingDb = {
      driver: "sqlite" as const,
      sqlite: {
        query() {
          throw new Error("DB should not be touched for static assets");
        },
      } as never,
      supabase: null,
    };
    const app = createApp(throwingDb);

    const res = await app.request("/style.css", {
      headers: { cookie: "sid=whatever" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/css");
  });
});
