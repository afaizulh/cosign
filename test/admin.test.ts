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

  test("studio shows an Admin panel shortcut for admins AND superadmins", async () => {
    const sqlite = createTestDb();
    const users = new UserModel(sqlite);
    const app = createApp({ driver: "sqlite", sqlite, supabase: null });

    const cookie = await registerUser(app, "member1");
    const asMember = await (await app.request("/studio", { headers: { cookie } })).text();
    expect(asMember).not.toContain('href="/admin"');

    // Both privileged roles must see the shortcut (regression: superadmin was missed).
    for (const role of ["admin", "superadmin"] as const) {
      users.setRole(users.idByUsername("member1")!, role);
      const html = await (await app.request("/studio", { headers: { cookie } })).text();
      expect(html).toContain('href="/admin"');
      expect(html).toContain("Admin panel");
    }
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

describe("Admin — pagination, filter & search", () => {
  /** superadmin app + N works owned by one author. */
  async function seed(works: number, users: number) {
    const sqlite = createTestDb();
    const model = new UserModel(sqlite);
    const app = createApp({ driver: "sqlite", sqlite, supabase: null });

    const bossCookie = await registerUser(app, "boss");
    model.setRole(model.idByUsername("boss")!, "superadmin");

    const authorCookie = await registerUser(app, "author");
    for (let i = 1; i <= works; i++) {
      await app.request("/studio/publications", {
        method: "POST",
        headers: { cookie: authorCookie, ...formPostHeaders },
        body: new URLSearchParams({
          judul: `Work ${String(i).padStart(2, "0")}`,
          deskripsi: "",
          kategori: "design",
        }).toString(),
      });
    }
    // Straight to the DB: the auth rate limiter caps HTTP registrations at 10/window.
    const insert = sqlite.query(
      "INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)"
    );
    for (let i = 1; i <= users; i++) {
      insert.run(`extra-${i}`, `extra${String(i).padStart(2, "0")}`, "x");
    }
    return { app, sqlite, model, bossCookie };
  }

  test("works: 12 per page + pager keeps filter and search", async () => {
    const { app, bossCookie } = await seed(14, 0);

    const p1 = await (await app.request("/admin/works", { headers: { cookie: bossCookie } })).text();
    expect(p1).toContain("Showing");
    expect(p1).toContain("1–12");
    expect(p1).toContain("14</span>");

    const p2 = await (
      await app.request("/admin/works?page=2", { headers: { cookie: bossCookie } })
    ).text();
    expect(p2).toContain("13–14");
    // A filter survives page 2
    const filtered = await (
      await app.request("/admin/works?status=published&page=2", { headers: { cookie: bossCookie } })
    ).text();
    expect(filtered).toContain("13–14");
    expect(filtered).toContain("status=published");

    // Out-of-range page clamps to the last page instead of showing nothing
    const clamped = await (
      await app.request("/admin/works?page=99", { headers: { cookie: bossCookie } })
    ).text();
    expect(clamped).toContain("13–14");
  });

  test("works: search narrows the result set and pages", async () => {
    const { app, bossCookie } = await seed(14, 0);

    const search = await (
      await app.request("/admin/works?q=Work%2003", { headers: { cookie: bossCookie } })
    ).text();
    expect(search).toContain("1–1");
    expect(search).toContain("Work 03");
    expect(search).not.toContain("Work 04");

    const none = await (
      await app.request("/admin/works?q=zzzz", { headers: { cookie: bossCookie } })
    ).text();
    expect(none).toContain("No works match this filter.");
    expect(none).toContain("Clear filters");
  });

  test("works: filter by status", async () => {
    const { app, sqlite, bossCookie } = await seed(3, 0);
    sqlite.query("UPDATE karya SET status = 'taken_down' WHERE judul = ?").run("Work 02");

    const hidden = await (
      await app.request("/admin/works?status=taken_down", { headers: { cookie: bossCookie } })
    ).text();
    expect(hidden).toContain("Work 02");
    expect(hidden).not.toContain("Work 01");

    const live = await (
      await app.request("/admin/works?status=published", { headers: { cookie: bossCookie } })
    ).text();
    expect(live).toContain("Work 01");
    expect(live).not.toContain("Work 02");
  });

  test("users: 12 per page + search and status filter", async () => {
    const { app, bossCookie } = await seed(0, 14);

    const p1 = await (await app.request("/admin/users", { headers: { cookie: bossCookie } })).text();
    expect(p1).toContain("1–12");

    const p2 = await (
      await app.request("/admin/users?page=2", { headers: { cookie: bossCookie } })
    ).text();
    // 14 extras + boss + author = 16 accounts → page 2 holds 13–16
    expect(p2).toContain("13–16");

    const search = await (
      await app.request("/admin/users?q=extra13", { headers: { cookie: bossCookie } })
    ).text();
    expect(search).toContain("@extra13");
    expect(search).not.toContain("@extra12");

    const none = await (
      await app.request("/admin/users?status=suspended", { headers: { cookie: bossCookie } })
    ).text();
    expect(none).toContain("No users match this filter.");
  });
});

describe("Admin — activity log (pagination & filters)", () => {
  /** Table rows only — the filter dropdowns intentionally list every option. */
  const body = (html: string) => {
    const start = html.indexOf("<tbody");
    const end = html.indexOf("</tbody>");
    return start === -1 || end === -1 ? "" : html.slice(start, end);
  };
  async function seedLog(rows: number) {
    const sqlite = createTestDb();
    const model = new UserModel(sqlite);
    const app = createApp({ driver: "sqlite", sqlite, supabase: null });

    const bossCookie = await registerUser(app, "boss");
    const bossId = model.idByUsername("boss")!;
    model.setRole(bossId, "superadmin");

    const otherCookie = await registerUser(app, "other");
    const otherId = model.idByUsername("other")!;
    model.setRole(otherId, "admin");

    const insert = sqlite.query(
      "INSERT INTO moderation_log (id, admin_id, action, target_type, target_id, reason) VALUES (?, ?, ?, ?, ?, ?)"
    );
    const actions = ["karya.takedown", "karya.restore", "user.suspend"];
    for (let i = 1; i <= rows; i++) {
      insert.run(
        `log-${i}`,
        i % 2 === 0 ? bossId : otherId,
        actions[i % actions.length],
        "karya",
        `target-${i}`,
        `reason ${i}`
      );
    }
    return { app, sqlite, bossCookie, bossId, otherId };
  }

  test("12 per page with a working pager", async () => {
    const { app, bossCookie } = await seedLog(20);

    const p1 = await (await app.request("/admin/log", { headers: { cookie: bossCookie } })).text();
    expect(p1).toContain("Showing");
    expect(p1).toContain("1–12");
    expect(p1).toContain("20</span>");
    expect(p1).toContain('href="/admin/log?page=2"');

    const p2 = await (
      await app.request("/admin/log?page=2", { headers: { cookie: bossCookie } })
    ).text();
    expect(p2).toContain("13–20");

    const clamped = await (
      await app.request("/admin/log?page=99", { headers: { cookie: bossCookie } })
    ).text();
    expect(clamped).toContain("13–20");
  });

  test("filter by action", async () => {
    const { app, bossCookie } = await seedLog(20);

    const filtered = await (
      await app.request("/admin/log?action=karya.restore", { headers: { cookie: bossCookie } })
    ).text();
    expect(body(filtered)).toContain("karya.restore");
    expect(body(filtered)).not.toContain("user.suspend");
    // dropdown still offers the other actions
    expect(filtered).toContain('value="user.suspend"');
    // the pager link keeps the filter
    expect(filtered).toContain("action=karya.restore");
  });

  test("filter by admin", async () => {
    const { app, bossCookie, bossId, otherId } = await seedLog(20);

    const mine = await (
      await app.request("/admin/log?admin=boss", { headers: { cookie: bossCookie } })
    ).text();
    expect(body(mine)).toContain("@boss");
    expect(body(mine)).not.toContain("@other");

    const theirs = await (
      await app.request("/admin/log?admin=other", { headers: { cookie: bossCookie } })
    ).text();
    expect(body(theirs)).toContain("@other");
    expect(body(theirs)).not.toContain("@boss");
    // selected option reflects the username-based filter
    expect(theirs).toContain('<option value="other" selected>');

    // legacy UUID links still resolve
    const byId = await (
      await app.request(`/admin/log?admin=${otherId}`, { headers: { cookie: bossCookie } })
    ).text();
    expect(body(byId)).toContain("@other");
    expect(body(byId)).not.toContain("@boss");
  });

  test("admin + action filters combine, and empty results show a clear state", async () => {
    const { app, bossCookie, bossId } = await seedLog(20);

    const combined = await (
      await app.request("/admin/log?admin=boss&action=user.suspend", {
        headers: { cookie: bossCookie },
      })
    ).text();
    expect(body(combined)).toContain("user.suspend");
    expect(body(combined)).toContain("@boss");
    expect(body(combined)).not.toContain("@other");

    const none = await (
      await app.request("/admin/log?action=user.promote", { headers: { cookie: bossCookie } })
    ).text();
    expect(none).toContain("No activity matches these filters.");
    expect(none).toContain("Clear");
  });

  test("dropdowns list only admins/actions present in the log", async () => {
    const { app, bossCookie } = await seedLog(9);

    const html = await (await app.request("/admin/log", { headers: { cookie: bossCookie } })).text();
    expect(html).toContain("All admins");
    expect(html).toContain("All actions");
    expect(html).toContain("@boss");
    expect(html).toContain("@other");
    expect(html).toContain("karya.takedown");
    // never logged → not offered
    expect(html).not.toContain('value="user.promote"');
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
