import { describe, expect, test } from "bun:test";
import {
  cookieFrom,
  createTestApp,
  createTestDb,
  formHeaders,
  formPostHeaders,
  registerUser,
} from "./helpers";
import { UserModel } from "../src/models/user.model";
import { createApp } from "../src/app";

describe("Admin — access control", () => {
  test("guest → 302 /studio/login for every admin page", async () => {
    const app = createTestApp();
    for (const path of ["/admin", "/admin/works", "/admin/users", "/admin/log"]) {
      const res = await app.request(path);
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/studio/login");
    }
  });

  test("member → 403 (never a silent redirect)", async () => {
    const app = createTestApp();
    const cookie = await registerUser(app, "member1");

    for (const path of ["/admin", "/admin/works", "/admin/users", "/admin/log"]) {
      const res = await app.request(path, { headers: { cookie } });
      expect(res.status).toBe(403);
    }
  });

  test("admin → 200 on every admin page", async () => {
    // Build app + DB by hand so we can promote the admin in the same DB.
    const sqlite = createTestDb();
    const users = new UserModel(sqlite);
    const app = createApp({ driver: "sqlite", sqlite, supabase: null });

    const cookie = await registerUser(app, "boss");
    const id = users.idByUsername("boss")!;
    users.setRole(id, "admin");

    for (const path of ["/admin", "/admin/works", "/admin/users", "/admin/log"]) {
      const res = await app.request(path, { headers: { cookie } });
      expect(res.status).toBe(200);
    }

    const dash = await (await app.request("/admin", { headers: { cookie } })).text();
    expect(dash).toContain("Overview");
    expect(dash).toContain("Works");
    expect(dash).toContain("Users");
  });
});

describe("Admin — takedown & restore", () => {
  /** Shared fixture: an admin, an author, one published work. */
  async function fixture() {
    const sqlite = createTestDb();
    const users = new UserModel(sqlite);
    const app = createApp({ driver: "sqlite", sqlite, supabase: null });

    const adminCookie = await registerUser(app, "boss");
    users.setRole(users.idByUsername("boss")!, "admin");

    const authorCookie = await registerUser(app, "author");
    const authorId = users.idByUsername("author")!;

    const create = await app.request("/studio/publications", {
      method: "POST",
      headers: { cookie: authorCookie, ...formPostHeaders },
      body: new URLSearchParams({ judul: "Naughty Poster", deskripsi: "", kategori: "design" }).toString(),
    });
    const karyaId = create.headers.get("location")!.split("/").pop()!;

    return { app, sqlite, users, adminCookie, authorCookie, authorId, karyaId };
  }

  test("takedown hides the work from explore, profile and public page", async () => {
    const { app, adminCookie, authorCookie, karyaId } = await fixture();

    // Visible before moderation
    expect(await (await app.request("/")).text()).toContain("Naughty Poster");
    expect(await (await app.request(`/karya/${karyaId}`)).text()).toContain("Naughty Poster");

    const res = await app.request(`/admin/works/${karyaId}/takedown`, {
      method: "POST",
      headers: { cookie: adminCookie, ...formPostHeaders },
      body: new URLSearchParams({ reason: "Inappropriate imagery" }).toString(),
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/admin/works/${karyaId}`);

    // Gone from public surfaces
    expect(await (await app.request("/")).text()).not.toContain("Naughty Poster");
    expect(await (await app.request("/profil/author")).text()).not.toContain("Naughty Poster");
    const detail = await app.request(`/karya/${karyaId}`);
    expect(detail.status).toBe(302);
    expect(detail.headers.get("location")).toBe("/");

    // Owner still sees it in their studio (soft delete = data intact)
    expect(
      await (await app.request("/studio/publications", { headers: { cookie: authorCookie } })).text()
    ).toContain("Naughty Poster");
  });

  test("takedown without a reason is rejected", async () => {
    const { app, adminCookie, karyaId } = await fixture();
    const res = await app.request(`/admin/works/${karyaId}/takedown`, {
      method: "POST",
      headers: { cookie: adminCookie, ...formPostHeaders },
      body: new URLSearchParams({ reason: "   " }).toString(),
    });
    expect(res.status).toBe(302);
    // Carry only the redirect's flash cookie (the admin cookie still holds the
    // stale "Account created" flash from registration, which would win).
    const sid = adminCookie.split(";")[0];
    const page = await (
      await app.request(`/admin/works/${karyaId}`, {
        headers: { cookie: `${sid}; ${cookieFrom(res)}` },
      })
    ).text();
    expect(page).toContain("A reason is required");
    // Still public — nothing happened
    expect(await (await app.request("/")).text()).toContain("Naughty Poster");
  });

  test("restore makes the work public again", async () => {
    const { app, adminCookie, karyaId } = await fixture();
    await app.request(`/admin/works/${karyaId}/takedown`, {
      method: "POST",
      headers: { cookie: adminCookie, ...formPostHeaders },
      body: new URLSearchParams({ reason: "Test" }).toString(),
    });
    const res = await app.request(`/admin/works/${karyaId}/restore`, {
      method: "POST",
      headers: { cookie: adminCookie, ...formHeaders },
    });
    expect(res.status).toBe(302);
    expect(await (await app.request("/")).text()).toContain("Naughty Poster");
    expect((await app.request(`/karya/${karyaId}`)).status).toBe(200);
  });

  test("member cannot take a work down (403)", async () => {
    const { app, authorCookie, karyaId } = await fixture();
    const res = await app.request(`/admin/works/${karyaId}/takedown`, {
      method: "POST",
      headers: { cookie: authorCookie, ...formPostHeaders },
      body: new URLSearchParams({ reason: "self-serve" }).toString(),
    });
    expect(res.status).toBe(403);
    expect(await (await app.request("/")).text()).toContain("Naughty Poster");
  });
});

describe("Admin — suspend & reactivate", () => {
  async function fixture() {
    const sqlite = createTestDb();
    const users = new UserModel(sqlite);
    const app = createApp({ driver: "sqlite", sqlite, supabase: null });

    const adminCookie = await registerUser(app, "boss");
    users.setRole(users.idByUsername("boss")!, "admin");

    const userCookie = await registerUser(app, "troll");
    const userId = users.idByUsername("troll")!;

    const create = await app.request("/studio/publications", {
      method: "POST",
      headers: { cookie: userCookie, ...formPostHeaders },
      body: new URLSearchParams({ judul: "Troll Work", deskripsi: "", kategori: "design" }).toString(),
    });
    const karyaId = create.headers.get("location")!.split("/").pop()!;

    return { app, users, adminCookie, userCookie, userId, karyaId };
  }

  test("suspend kills the session, blocks login and hides their works", async () => {
    const { app, users, adminCookie, userCookie, userId } = await fixture();

    // Works before suspension
    expect(await (await app.request("/")).text()).toContain("Troll Work");

    const res = await app.request(`/admin/users/${userId}/suspend`, {
      method: "POST",
      headers: { cookie: adminCookie, ...formPostHeaders },
      body: new URLSearchParams({ reason: "Harassment" }).toString(),
    });
    expect(res.status).toBe(302);

    expect(users.findAccess(userId)!.status).toBe("suspended");

    // Existing session is dead
    const afterSuspend = await app.request("/studio", { headers: { cookie: userCookie } });
    expect(afterSuspend.status).toBe(302);
    expect(afterSuspend.headers.get("location")).toBe("/studio/login");

    // Login is refused
    const login = await app.request("/studio/login", {
      method: "POST",
      headers: formPostHeaders,
      body: new URLSearchParams({ username: "troll", password: "rahasia123" }).toString(),
    });
    expect(login.status).toBe(200);
    expect(await login.text()).toContain("suspended");

    // Their content disappears from the public site
    expect(await (await app.request("/")).text()).not.toContain("Troll Work");
    const profil = await app.request("/profil/troll");
    expect(profil.status).toBe(302);
  });

  test("reactivate restores access and content", async () => {
    const { app, users, adminCookie, userId } = await fixture();
    await app.request(`/admin/users/${userId}/suspend`, {
      method: "POST",
      headers: { cookie: adminCookie, ...formPostHeaders },
      body: new URLSearchParams({ reason: "Test" }).toString(),
    });

    const res = await app.request(`/admin/users/${userId}/reactivate`, {
      method: "POST",
      headers: { cookie: adminCookie, ...formHeaders },
    });
    expect(res.status).toBe(302);
    expect(users.findAccess(userId)!.status).toBe("active");

    expect(await (await app.request("/")).text()).toContain("Troll Work");

    const login = await app.request("/studio/login", {
      method: "POST",
      headers: formPostHeaders,
      body: new URLSearchParams({ username: "troll", password: "rahasia123" }).toString(),
    });
    expect(login.headers.get("location")).toBe("/studio");
  });

  test("an admin cannot suspend their own account", async () => {
    const { app, users, adminCookie } = await fixture();
    const adminId = users.idByUsername("boss")!;
    const res = await app.request(`/admin/users/${adminId}/suspend`, {
      method: "POST",
      headers: { cookie: adminCookie, ...formPostHeaders },
      body: new URLSearchParams({ reason: "oops" }).toString(),
    });
    expect(res.status).toBe(302);
    expect(users.findAccess(adminId)!.status).toBe("active");
  });
});

describe("Admin — roles & audit log", () => {
  async function fixture() {
    const sqlite = createTestDb();
    const users = new UserModel(sqlite);
    const app = createApp({ driver: "sqlite", sqlite, supabase: null });

    const adminCookie = await registerUser(app, "boss");
    users.setRole(users.idByUsername("boss")!, "admin");
    const plainCookie = await registerUser(app, "plain");
    const plainId = users.idByUsername("plain")!;

    return { app, sqlite, users, adminCookie, plainCookie, plainId };
  }

  test("promote → the new admin can open /admin; demote → 403 again", async () => {
    const { app, adminCookie, plainCookie, plainId } = await fixture();

    expect((await app.request("/admin", { headers: { cookie: plainCookie } })).status).toBe(403);

    await app.request(`/admin/users/${plainId}/role`, {
      method: "POST",
      headers: { cookie: adminCookie, ...formPostHeaders },
      body: new URLSearchParams({ role: "admin" }).toString(),
    });
    expect((await app.request("/admin", { headers: { cookie: plainCookie } })).status).toBe(200);

    await app.request(`/admin/users/${plainId}/role`, {
      method: "POST",
      headers: { cookie: adminCookie, ...formPostHeaders },
      body: new URLSearchParams({ role: "member" }).toString(),
    });
    expect((await app.request("/admin", { headers: { cookie: plainCookie } })).status).toBe(403);
  });

  test("invalid role value is rejected", async () => {
    const { app, users, adminCookie, plainId } = await fixture();
    await app.request(`/admin/users/${plainId}/role`, {
      method: "POST",
      headers: { cookie: adminCookie, ...formPostHeaders },
      body: new URLSearchParams({ role: "superuser" }).toString(),
    });
    expect(users.findAccess(plainId)!.role).toBe("member");
  });

  test("every moderation action lands in the audit log", async () => {
    const { app, sqlite, users, adminCookie, plainId } = await fixture();
    const adminId = users.idByUsername("boss")!;

    const create = await app.request("/studio/publications", {
      method: "POST",
      headers: { cookie: adminCookie, ...formPostHeaders },
      body: new URLSearchParams({ judul: "Own Work", deskripsi: "", kategori: "design" }).toString(),
    });
    const karyaId = create.headers.get("location")!.split("/").pop()!;

    await app.request(`/admin/works/${karyaId}/takedown`, {
      method: "POST",
      headers: { cookie: adminCookie, ...formPostHeaders },
      body: new URLSearchParams({ reason: "Rule violation" }).toString(),
    });
    await app.request(`/admin/works/${karyaId}/restore`, {
      method: "POST",
      headers: { cookie: adminCookie, ...formHeaders },
    });
    await app.request(`/admin/users/${plainId}/suspend`, {
      method: "POST",
      headers: { cookie: adminCookie, ...formPostHeaders },
      body: new URLSearchParams({ reason: "Spam" }).toString(),
    });

    const rows = sqlite
      .query("SELECT action, admin_id, reason FROM moderation_log ORDER BY rowid")
      .all() as Array<{ action: string; admin_id: string; reason: string | null }>;

    expect(rows.map((r) => r.action)).toEqual([
      "karya.takedown",
      "karya.restore",
      "user.suspend",
    ]);
    expect(rows.every((r) => r.admin_id === adminId)).toBe(true);
    expect(rows[0].reason).toBe("Rule violation");

    const logPage = await (await app.request("/admin/log", { headers: { cookie: adminCookie } })).text();
    expect(logPage).toContain("karya.takedown");
    expect(logPage).toContain("user.suspend");
    expect(logPage).toContain("@boss");
  });
});

describe("Admin — CLI helper", () => {
  test("idByUsername + setRole is what the grant script relies on", () => {
    const sqlite = createTestDb();
    const users = new UserModel(sqlite);
    sqlite
      .query("INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)")
      .run("u1", "someone", "x");

    const id = users.idByUsername("someone")!;
    expect(users.isAdmin(id)).toBe(false);
    users.setRole(id, "admin");
    expect(users.isAdmin(id)).toBe(true);
    expect(users.idByUsername("missing")).toBeNull();
  });
});
