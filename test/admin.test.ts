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
      expect(res.headers.get("location")).toBe(
        "/studio/login?next=" + encodeURIComponent(path)
      );
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

describe("Admin — login round-trip", () => {
  test("login form carries next and lands back on /admin", async () => {
    const sqlite = createTestDb();
    const users = new UserModel(sqlite);
    const app = createApp({ driver: "sqlite", sqlite, supabase: null });
    await registerUser(app, "boss");
    users.setRole(users.idByUsername("boss")!, "admin");

    // Guest hits /admin → login URL remembers the target
    const guard = await app.request("/admin/works");
    expect(guard.headers.get("location")).toBe("/studio/login?next=%2Fadmin%2Fworks");

    // Login page embeds next in the form
    const page = await (
      await app.request("/studio/login?next=%2Fadmin%2Fworks")
    ).text();
    expect(page).toContain('name="next" value="/admin/works"');

    // Successful login → straight to the admin page
    const login = await app.request("/studio/login?next=%2Fadmin%2Fworks", {
      method: "POST",
      headers: formPostHeaders,
      body: new URLSearchParams({
        username: "boss",
        password: "rahasia123",
        next: "/admin/works",
      }).toString(),
    });
    expect(login.status).toBe(302);
    expect(login.headers.get("location")).toBe("/admin/works");
  });

  test("off-site next values are ignored (no open redirect)", async () => {
    const app = createTestApp();
    await registerUser(app, "boss");

    for (const evil of ["//evil.com", "https://evil.com", "/\\evil.com"]) {
      const res = await app.request("/studio/login", {
        method: "POST",
        headers: formPostHeaders,
        body: new URLSearchParams({
          username: "boss",
          password: "rahasia123",
          next: evil,
        }).toString(),
      });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/studio");
    }
  });

  test("already-logged-in admin opening /studio/login?next=/admin goes straight there", async () => {
    const sqlite = createTestDb();
    const users = new UserModel(sqlite);
    const app = createApp({ driver: "sqlite", sqlite, supabase: null });
    const cookie = await registerUser(app, "boss");
    users.setRole(users.idByUsername("boss")!, "admin");

    const res = await app.request("/studio/login?next=%2Fadmin", { headers: { cookie } });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin");
  });

  test("studio shows an Admin panel shortcut only for admins", async () => {
    const sqlite = createTestDb();
    const users = new UserModel(sqlite);
    const app = createApp({ driver: "sqlite", sqlite, supabase: null });

    const memberCookie = await registerUser(app, "member1");
    const memberHtml = await (await app.request("/studio", { headers: { cookie: memberCookie } })).text();
    expect(memberHtml).not.toContain('href="/admin"');

    users.setRole(users.idByUsername("member1")!, "admin");
    const adminHtml = await (await app.request("/studio", { headers: { cookie: memberCookie } })).text();
    expect(adminHtml).toContain('href="/admin"');
    expect(adminHtml).toContain("Admin panel");
  });
});

describe("Superadmin — the highest role", () => {
  /** boss = superadmin, mid = admin, plain = member. */
  async function fixture() {
    const sqlite = createTestDb();
    const users = new UserModel(sqlite);
    const app = createApp({ driver: "sqlite", sqlite, supabase: null });

    const superCookie = await registerUser(app, "boss");
    const superId = users.idByUsername("boss")!;
    users.setRole(superId, "superadmin");

    const adminCookie = await registerUser(app, "mid");
    const adminId = users.idByUsername("mid")!;
    users.setRole(adminId, "admin");

    const memberCookie = await registerUser(app, "plain");
    const memberId = users.idByUsername("plain")!;

    return { app, users, superCookie, superId, adminCookie, adminId, memberCookie, memberId };
  }

  test("superadmin can open /admin like any admin", async () => {
    const { app, superCookie } = await fixture();
    expect((await app.request("/admin", { headers: { cookie: superCookie } })).status).toBe(200);
  });

  test("an admin cannot demote or suspend another admin", async () => {
    const { app, users, adminCookie, superId } = await fixture();
    const otherAdmin = await registerUser(app, "mid2");
    void otherAdmin;
    const otherId = users.idByUsername("mid2")!;
    users.setRole(otherId, "admin");

    // demote attempt
    await app.request(`/admin/users/${otherId}/role`, {
      method: "POST",
      headers: { cookie: adminCookie, ...formPostHeaders },
      body: new URLSearchParams({ role: "member" }).toString(),
    });
    expect(users.roleOf(otherId)).toBe("admin");

    // suspend attempt
    await app.request(`/admin/users/${otherId}/suspend`, {
      method: "POST",
      headers: { cookie: adminCookie, ...formPostHeaders },
      body: new URLSearchParams({ reason: "power trip" }).toString(),
    });
    expect(users.findAccess(otherId)!.status).toBe("active");

    // and certainly not the superadmin
    await app.request(`/admin/users/${superId}/suspend`, {
      method: "POST",
      headers: { cookie: adminCookie, ...formPostHeaders },
      body: new URLSearchParams({ reason: "coup" }).toString(),
    });
    expect(users.findAccess(superId)!.status).toBe("active");
  });

  test("superadmin can promote and demote an admin", async () => {
    const { app, users, superCookie, memberId } = await fixture();

    await app.request(`/admin/users/${memberId}/role`, {
      method: "POST",
      headers: { cookie: superCookie, ...formPostHeaders },
      body: new URLSearchParams({ role: "admin" }).toString(),
    });
    expect(users.roleOf(memberId)).toBe("admin");

    await app.request(`/admin/users/${memberId}/role`, {
      method: "POST",
      headers: { cookie: superCookie, ...formPostHeaders },
      body: new URLSearchParams({ role: "member" }).toString(),
    });
    expect(users.roleOf(memberId)).toBe("member");
  });

  test("nobody can touch a superadmin account from the panel", async () => {
    const { app, users, superCookie, superId } = await fixture();

    const suspend = await app.request(`/admin/users/${superId}/suspend`, {
      method: "POST",
      headers: { cookie: superCookie, ...formPostHeaders },
      body: new URLSearchParams({ reason: "self harm" }).toString(),
    });
    expect(suspend.status).toBe(302);
    expect(users.findAccess(superId)!.status).toBe("active");
    expect(users.roleOf(superId)).toBe("superadmin");
  });

  test("superadmin cannot demote themselves", async () => {
    const { app, users, superCookie, superId } = await fixture();
    await app.request(`/admin/users/${superId}/role`, {
      method: "POST",
      headers: { cookie: superCookie, ...formPostHeaders },
      body: new URLSearchParams({ role: "member" }).toString(),
    });
    expect(users.roleOf(superId)).toBe("superadmin");
  });

  test("UI hides the role form from plain admins", async () => {
    const { app, adminCookie, memberId } = await fixture();

    const asAdmin = await (
      await app.request(`/admin/users/${memberId}`, { headers: { cookie: adminCookie } })
    ).text();
    expect(asAdmin).toContain("Only a superadmin can change roles.");
    expect(asAdmin).not.toContain('action="/admin/users/' + memberId + '/role"');
  });

  test("UI shows the role form to a superadmin", async () => {
    const { app, superCookie, memberId } = await fixture();

    const asSuper = await (
      await app.request(`/admin/users/${memberId}`, { headers: { cookie: superCookie } })
    ).text();
    expect(asSuper).toContain('action="/admin/users/' + memberId + '/role"');
    expect(asSuper).toContain("Update role");
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
    // Role changes are superadmin-only, so the actor here is a superadmin.
    users.setRole(users.idByUsername("boss")!, "superadmin");
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
