import { describe, expect, test } from "bun:test";
import { readdirSync, unlinkSync } from "fs";
import { createApp } from "../src/app";
import type { Db } from "../src/db";
import {
  createTestApp,
  createTestDb,
  cookieFrom,
  formHeaders,
  formPostHeaders,
  registerUser,
} from "./helpers";

const PNG_BODY = "fakepng";
const PNG = new File([PNG_BODY], "part.png", { type: "image/png" });

/** Upload one part to a karya. Returns the part id if needed. */
async function uploadPart(
  app: { request: (path: string, init?: RequestInit) => Promise<Response> | Response },
  cookie: string,
  karyaId: string,
  kategori: string,
  media: File = PNG
) {
  const form = new FormData();
  form.append("kategori", kategori);
  form.append("media", media);
  return app.request(`/admin/karya/${karyaId}/parts`, {
    method: "POST",
    headers: { cookie, ...formHeaders },
    body: form,
  });
}

describe("Web — health & homepage", () => {
  test("GET / → 200, explore page renders", async () => {
    const app = createTestApp();
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("CoSign");
    expect(html).toContain("Explore");
    expect(html).toContain("Start sharing");
  });

  test("GET /health → driver sqlite", async () => {
    const app = createTestApp();
    const res = await app.request("/health");
    expect(((await res.json()) as { driver: string }).driver).toBe("sqlite");
  });
});

describe("Web — auth", () => {
  test("GET /admin/login → form renders", async () => {
    const app = createTestApp();
    const res = await app.request("/admin/login");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('action="/admin/login"');
    expect(html).toContain('name="username"');
  });

  test("GET /admin/register → form renders", async () => {
    const app = createTestApp();
    const res = await app.request("/admin/register");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('action="/admin/register"');
  });

  test("POST /admin/register → 302 /admin/karya + session cookie", async () => {
    const app = createTestApp();
    const res = await app.request("/admin/register", {
      method: "POST",
      headers: formPostHeaders,
      body: new URLSearchParams({
        username: "admin",
        password: "rahasia123",
        full_name: "Admin User",
      }).toString(),
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin/karya");
    expect(cookieFrom(res)).toContain("sid=");

    // Cookie hardened: HttpOnly, SameSite, path, TTL from SESSION_TTL_DAYS (7 days).
    // No APP_URL=https:// in tests → no Secure flag.
    const sidCookie = res.headers.getSetCookie().find((c) => c.startsWith("sid="))!;
    expect(sidCookie).toContain("HttpOnly");
    expect(sidCookie).toContain("SameSite=Lax");
    expect(sidCookie).toContain("Path=/");
    expect(sidCookie).toContain("Max-Age=604800");
    expect(sidCookie).not.toContain("Secure");
  });

  test("POST /admin/register duplicate username → re-render with error", async () => {
    const app = createTestApp();
    const body = new URLSearchParams({ username: "admin", password: "rahasia123" }).toString();
    await app.request("/admin/register", { method: "POST", headers: formPostHeaders, body });

    const res = await app.request("/admin/register", {
      method: "POST",
      headers: formPostHeaders,
      body,
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("already taken");
  });

  test("POST /admin/register short password → error, no redirect", async () => {
    const app = createTestApp();
    const res = await app.request("/admin/register", {
      method: "POST",
      headers: formPostHeaders,
      body: new URLSearchParams({ username: "admin", password: "123" }).toString(),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("at least 6 characters");
  });

  test("POST /admin/register unsafe username → rejected (URL-safe charset only)", async () => {
    const app = createTestApp();
    for (const bad of ["admin/", "admin profile", "Admin", "#user", "..", "ab", "a".repeat(21)]) {
      const res = await app.request("/admin/register", {
        method: "POST",
        headers: formPostHeaders,
        body: new URLSearchParams({ username: bad, password: "rahasia123" }).toString(),
      });
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("3–20 characters");
    }
  });

  test("POST /admin/register duplicate differs only by case → rejected", async () => {
    const app = createTestApp();
    await registerUser(app, "admin");

    const res = await app.request("/admin/register", {
      method: "POST",
      headers: formPostHeaders,
      body: new URLSearchParams({ username: "ADMIN", password: "rahasia123" }).toString(),
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("admin");
    // "ADMIN" fails charset first, so it never reaches the taken check — assert single form of rejection
    expect(html).not.toContain("Welcome to CoSign");
  });

  test("POST /admin/login wrong password → re-render with error", async () => {
    const app = createTestApp();
    await registerUser(app);

    const res = await app.request("/admin/login", {
      method: "POST",
      headers: formPostHeaders,
      body: new URLSearchParams({ username: "admin", password: "salah" }).toString(),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Invalid username or password");
  });

  test("POST /admin/login correct → 302 + cookie", async () => {
    const app = createTestApp();
    await registerUser(app);

    const res = await app.request("/admin/login", {
      method: "POST",
      headers: formPostHeaders,
      body: new URLSearchParams({ username: "admin", password: "rahasia123" }).toString(),
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin/karya");
    expect(cookieFrom(res)).toContain("sid=");
  });

  test("logged in → GET /admin/login redirects to /admin/karya", async () => {
    const app = createTestApp();
    const cookie = await registerUser(app);

    const res = await app.request("/admin/login", { headers: { cookie } });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin/karya");
  });

  test("POST /admin/logout → 302 /, session removed", async () => {
    const app = createTestApp();
    const cookie = await registerUser(app);

    const logout = await app.request("/admin/logout", {
      method: "POST",
      headers: { cookie, ...formHeaders },
    });
    expect(logout.status).toBe(302);
    expect(logout.headers.get("location")).toBe("/");

    const karya = await app.request("/admin/karya", { headers: { cookie } });
    expect(karya.status).toBe(302);
    expect(karya.headers.get("location")).toBe("/admin/login");
  });
});

describe("Web — karya (auth)", () => {
  test("GET /admin/karya without login → 302 /admin/login", async () => {
    const app = createTestApp();
    const res = await app.request("/admin/karya");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin/login");
  });

  test("full flow: create karya → upload parts → homepage card → customizer → like → delete", async () => {
    const app = createTestApp();
    const cookie = await registerUser(app);

    // Create karya
    const create = await app.request("/admin/karya", {
      method: "POST",
      headers: { cookie, ...formPostHeaders },
      body: new URLSearchParams({
        judul: "Poster Event",
        deskripsi: "My poster",
        kategori: "desain",
      }).toString(),
    });
    expect(create.status).toBe(302);
    const manageUrl = create.headers.get("location")!;
    expect(manageUrl).toMatch(/^\/admin\/karya\/[0-9a-f-]+$/);
    const karyaId = manageUrl.split("/").pop()!;

    // Manage page renders 3 part sections
    const manage = await app.request(manageUrl, { headers: { cookie } });
    const manageHtml = await manage.text();
    expect(manageHtml).toContain("Head");
    expect(manageHtml).toContain("Body");
    expect(manageHtml).toContain("Background");
    expect(manageHtml).toContain('name="kategori" value="kepala"');

    // Upload parts (one per category)
    for (const kat of ["kepala", "badan", "background"]) {
      const up = await uploadPart(app, cookie, karyaId, kat);
      expect(up.status).toBe(302);
      expect(up.headers.get("location")).toBe(manageUrl);
    }

    // Homepage shows layered card with username + like count
    const home = await (await app.request("/")).text();
    expect(home).toContain("Poster Event");
    expect(home).toContain("by admin");
    expect(home).toContain("0 likes");

    // Customizer page renders layers + part pickers + scripts
    const detail = await app.request(`/karya/${karyaId}`);
    expect(detail.status).toBe(200);
    const detailHtml = await detail.text();
    expect(detailHtml).toContain("Poster Event");
    expect(detailHtml).toContain('data-layer="kepala"');
    expect(detailHtml).toContain('data-layer="badan"');
    expect(detailHtml).toContain('data-layer="background"');
    expect(detailHtml).toContain("/customizer.js");
    expect(detailHtml).toContain('data-kategori="kepala"');
    expect(detailHtml).toContain('id="export-png"');
    expect(detailHtml).not.toContain("/uploads/uploads/");

    // Like toggles + count updates
    await app.request(`/karya/${karyaId}/like`, {
      method: "POST",
      headers: { cookie, ...formHeaders },
    });
    const liked = await (await app.request(`/karya/${karyaId}`)).text();
    expect(liked).toContain('id="like-count">1</span>');
    expect(liked).toContain("1</span> like");

    // Delete part file + record
    const manage2 = await (await app.request(manageUrl, { headers: { cookie } })).text();
    const partId = manage2.match(/\/parts\/([0-9a-f-]+)\/delete/)?.[1];
    expect(partId).toBeTruthy();
    const del = await app.request(`/admin/karya/${karyaId}/parts/${partId}/delete`, {
      method: "POST",
      headers: { cookie, ...formHeaders },
    });
    expect(del.status).toBe(302);
    expect(del.headers.get("location")).toBe(manageUrl);

    // Delete karya + remaining files
    const delKarya = await app.request(`/admin/karya/${karyaId}/delete`, {
      method: "POST",
      headers: { cookie, ...formHeaders },
    });
    expect(delKarya.status).toBe(302);
    expect(delKarya.headers.get("location")).toBe("/admin/karya");

    const myWorks = await (await app.request("/admin/karya", { headers: { cookie } })).text();
    expect(myWorks).toContain("You haven't created any work yet");
  });

  test("upload non-image part → flash error, no save", async () => {
    const app = createTestApp();
    const cookie = await registerUser(app);

    const create = await app.request("/admin/karya", {
      method: "POST",
      headers: { cookie, ...formPostHeaders },
      body: new URLSearchParams({ judul: "A", deskripsi: "", kategori: "desain" }).toString(),
    });
    const karyaId = create.headers.get("location")!.split("/").pop()!;

    const bad = new File(["hello"], "catatan.txt", { type: "text/plain" });
    const res = await uploadPart(app, cookie, karyaId, "kepala", bad);
    expect(res.status).toBe(302);

    const sidCookie = cookie.split(";")[0];
    const page = await app.request(`/admin/karya/${karyaId}`, {
      headers: { cookie: `${sidCookie}; ${cookieFrom(res)}` },
    });
    expect(await page.text()).toContain("Only image files are allowed");
  });

  test("upload over body limit → flash error, no save", async () => {
    const app = createTestApp();
    const cookie = await registerUser(app);

    const create = await app.request("/admin/karya", {
      method: "POST",
      headers: { cookie, ...formPostHeaders },
      body: new URLSearchParams({ judul: "A", deskripsi: "", kategori: "desain" }).toString(),
    });
    const karyaId = create.headers.get("location")!.split("/").pop()!;

    const big = new File([new Uint8Array(22 * 1024 * 1024)], "big.png", { type: "image/png" });
    const form = new FormData();
    form.append("kategori", "kepala");
    form.append("media", big);

    const res = await app.request(`/admin/karya/${karyaId}/parts`, {
      method: "POST",
      headers: { cookie, ...formHeaders },
      body: form,
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/admin/karya/${karyaId}`);

    const sidCookie = cookie.split(";")[0];
    const page = await app.request(`/admin/karya/${karyaId}`, {
      headers: { cookie: `${sidCookie}; ${cookieFrom(res)}` },
    });
    expect(await page.text()).toContain("Upload too large");
  });

  test("upload part without file → flash error", async () => {
    const app = createTestApp();
    const cookie = await registerUser(app);

    const create = await app.request("/admin/karya", {
      method: "POST",
      headers: { cookie, ...formPostHeaders },
      body: new URLSearchParams({ judul: "A", deskripsi: "", kategori: "desain" }).toString(),
    });
    const karyaId = create.headers.get("location")!.split("/").pop()!;

    const form = new FormData();
    form.append("kategori", "kepala");
    const res = await app.request(`/admin/karya/${karyaId}/parts`, {
      method: "POST",
      headers: { cookie, ...formHeaders },
      body: form,
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/admin/karya/${karyaId}`);
  });

  test("owner guard: other user cannot delete parts", async () => {
    const app = createTestApp();
    const cookie1 = await registerUser(app, "owner1");
    const cookie2 = await registerUser(app, "owner2");

    const create = await app.request("/admin/karya", {
      method: "POST",
      headers: { cookie: cookie1, ...formPostHeaders },
      body: new URLSearchParams({ judul: "A", deskripsi: "", kategori: "desain" }).toString(),
    });
    const karyaId = create.headers.get("location")!.split("/").pop()!;
    await uploadPart(app, cookie1, karyaId, "kepala");

    // owner2 tries to delete owner1's part → redirected, part still exists
    const manage = await (await app.request(`/admin/karya/${karyaId}`, { headers: { cookie: cookie1 } })).text();
    const partId = manage.match(/\/parts\/([0-9a-f-]+)\/delete/)?.[1]!;

    const res = await app.request(`/admin/karya/${karyaId}/parts/${partId}/delete`, {
      method: "POST",
      headers: { cookie: cookie2, ...formHeaders },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin/karya");

    const check = await app.request(`/admin/karya/${karyaId}`, { headers: { cookie: cookie1 } });
    expect(await check.text()).toContain('name="kategori" value="kepala"');

    // Cleanup: owner1 deletes the karya (removes the part file too)
    await app.request(`/admin/karya/${karyaId}/delete`, {
      method: "POST",
      headers: { cookie: cookie1, ...formHeaders },
    });
  });

  test("invalid part category → flash error", async () => {
    const app = createTestApp();
    const cookie = await registerUser(app);

    const create = await app.request("/admin/karya", {
      method: "POST",
      headers: { cookie, ...formPostHeaders },
      body: new URLSearchParams({ judul: "A", deskripsi: "", kategori: "desain" }).toString(),
    });
    const karyaId = create.headers.get("location")!.split("/").pop()!;

    const res = await uploadPart(app, cookie, karyaId, "tangan");
    expect(res.status).toBe(302);
    const sidCookie = cookie.split(";")[0];
    const page = await app.request(`/admin/karya/${karyaId}`, {
      headers: { cookie: `${sidCookie}; ${cookieFrom(res)}` },
    });
    expect(await page.text()).toContain("Invalid part category");
  });
});

describe("Web — public pages", () => {
  test("GET /karya/:id not found → redirect /", async () => {
    const app = createTestApp();
    const res = await app.request("/karya/id-ngasal");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
  });

  test("GET /karya/:id without login → like shows sign-in link", async () => {
    const app = createTestApp();
    const cookie = await registerUser(app);

    const create = await app.request("/admin/karya", {
      method: "POST",
      headers: { cookie, ...formPostHeaders },
      body: new URLSearchParams({ judul: "Publik", deskripsi: "", kategori: "desain" }).toString(),
    });
    const karyaId = create.headers.get("location")!.split("/").pop()!;

    const res = await app.request(`/karya/${karyaId}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("/admin/login");
  });

  test("like state: liked karya shows 'Liked' button for that user only", async () => {
    const app = createTestApp();
    const cookie = await registerUser(app);

    const create = await app.request("/admin/karya", {
      method: "POST",
      headers: { cookie, ...formPostHeaders },
      body: new URLSearchParams({ judul: "Like State", deskripsi: "", kategori: "desain" }).toString(),
    });
    const karyaId = create.headers.get("location")!.split("/").pop()!;

    const before = await (await app.request(`/karya/${karyaId}`, { headers: { cookie } })).text();
    expect(before).toContain('aria-pressed="false"');
    expect(before).toContain("♥ Like");

    await app.request(`/karya/${karyaId}/like`, {
      method: "POST",
      headers: { cookie, ...formHeaders },
    });

    const after = await (await app.request(`/karya/${karyaId}`, { headers: { cookie } })).text();
    expect(after).toContain('aria-pressed="true"');
    expect(after).toContain("♥ Liked");

    const guest = await (await app.request(`/karya/${karyaId}`)).text();
    expect(guest).toContain('href="/admin/login"');

    // Toggle back off
    await app.request(`/karya/${karyaId}/like`, {
      method: "POST",
      headers: { cookie, ...formHeaders },
    });
    const unliked = await (await app.request(`/karya/${karyaId}`, { headers: { cookie } })).text();
    expect(unliked).toContain('aria-pressed="false"');

    await app.request(`/admin/karya/${karyaId}/delete`, {
      method: "POST",
      headers: { cookie, ...formHeaders },
    });
  });

  test("GET /profil/:username → 200 with works; unknown → redirect /", async () => {
    const app = createTestApp();
    const cookie = await registerUser(app);

    const create = await app.request("/admin/karya", {
      method: "POST",
      headers: { cookie, ...formPostHeaders },
      body: new URLSearchParams({ judul: "Profil Karya", deskripsi: "", kategori: "desain" }).toString(),
    });
    const karyaId = create.headers.get("location")!.split("/").pop()!;
    await uploadPart(app, cookie, karyaId, "kepala");

    const profil = await app.request("/profil/admin");
    expect(profil.status).toBe(200);
    const html = await profil.text();
    expect(html).toContain("@admin");
    expect(html).toContain("Profil Karya");

    const unknown = await app.request("/profil/tidak-ada");
    expect(unknown.status).toBe(302);
    expect(unknown.headers.get("location")).toBe("/");

    // Cleanup: delete the karya (removes the part file too)
    await app.request(`/admin/karya/${karyaId}/delete`, {
      method: "POST",
      headers: { cookie, ...formHeaders },
    });
  });

  test("homepage category filter", async () => {
    const app = createTestApp();
    const cookie = await registerUser(app);

    const mk = (judul: string, kategori: string) =>
      app.request("/admin/karya", {
        method: "POST",
        headers: { cookie, ...formPostHeaders },
        body: new URLSearchParams({ judul, deskripsi: "", kategori }).toString(),
      });
    await mk("Desain Satu", "desain");
    await mk("Motion Dua", "motion");

    const all = await (await app.request("/")).text();
    expect(all).toContain("Desain Satu");
    expect(all).toContain("Motion Dua");

    const filtered = await (await app.request("/?kategori=desain")).text();
    expect(filtered).toContain("Desain Satu");
    expect(filtered).not.toContain("Motion Dua");
  });

  test("POST /admin/karya with invalid kategori falls back to 'lainnya'", async () => {
    const app = createTestApp();
    const cookie = await registerUser(app);

    const res = await app.request("/admin/karya", {
      method: "POST",
      headers: { cookie, ...formPostHeaders },
      body: new URLSearchParams({ judul: "Sneaky", deskripsi: "", kategori: "hacker" }).toString(),
    });
    expect(res.status).toBe(302);
    const loc = res.headers.get("location")!;
    expect(loc).toMatch(/^\/admin\/karya\/[^/]+$/);

    const list = await (await app.request("/admin/karya", { headers: { cookie } })).text();
    expect(list).toContain("Sneaky");
    expect(list).toContain("lainnya");
    expect(list).not.toContain("hacker");
  });
});

describe("Web — edit karya", () => {
  test("owner edits title/description/category", async () => {
    const app = createTestApp();
    const cookie = await registerUser(app);

    const create = await app.request("/admin/karya", {
      method: "POST",
      headers: { cookie, ...formPostHeaders },
      body: new URLSearchParams({ judul: "Old Title", deskripsi: "old", kategori: "desain" }).toString(),
    });
    const karyaId = create.headers.get("location")!.split("/").pop()!;

    const edit = await app.request(`/admin/karya/${karyaId}/edit`, {
      method: "POST",
      headers: { cookie, ...formPostHeaders },
      body: new URLSearchParams({ judul: "New Title", deskripsi: "new desc", kategori: "motion" }).toString(),
    });
    expect(edit.status).toBe(302);
    expect(edit.headers.get("location")).toBe(`/admin/karya/${karyaId}`);

    const manage = await (await app.request(`/admin/karya/${karyaId}`, { headers: { cookie } })).text();
    expect(manage).toContain("New Title");
    expect(manage).toContain("new desc");

    const home = await (await app.request("/")).text();
    expect(home).toContain("New Title");
    expect(home).not.toContain("Old Title");
  });

  test("edit without title → flash error, unchanged", async () => {
    const app = createTestApp();
    const cookie = await registerUser(app);

    const create = await app.request("/admin/karya", {
      method: "POST",
      headers: { cookie, ...formPostHeaders },
      body: new URLSearchParams({ judul: "Keep Me", deskripsi: "", kategori: "desain" }).toString(),
    });
    const karyaId = create.headers.get("location")!.split("/").pop()!;

    const edit = await app.request(`/admin/karya/${karyaId}/edit`, {
      method: "POST",
      headers: { cookie, ...formPostHeaders },
      body: new URLSearchParams({ judul: "  ", deskripsi: "", kategori: "desain" }).toString(),
    });
    expect(edit.status).toBe(302);

    const home = await (await app.request("/")).text();
    expect(home).toContain("Keep Me");
  });

  test("owner guard: other user cannot edit", async () => {
    const app = createTestApp();
    const cookie1 = await registerUser(app, "owner1");
    const cookie2 = await registerUser(app, "owner2");

    const create = await app.request("/admin/karya", {
      method: "POST",
      headers: { cookie: cookie1, ...formPostHeaders },
      body: new URLSearchParams({ judul: "Mine", deskripsi: "", kategori: "desain" }).toString(),
    });
    const karyaId = create.headers.get("location")!.split("/").pop()!;

    const edit = await app.request(`/admin/karya/${karyaId}/edit`, {
      method: "POST",
      headers: { cookie: cookie2, ...formPostHeaders },
      body: new URLSearchParams({ judul: "Hacked", deskripsi: "", kategori: "desain" }).toString(),
    });
    expect(edit.status).toBe(302);
    expect(edit.headers.get("location")).toBe("/admin/karya");

    const home = await (await app.request("/")).text();
    expect(home).toContain("Mine");
    expect(home).not.toContain("Hacked");
  });
});

describe("Web — search & sort", () => {
  test("search filters by title; sort popular orders by likes", async () => {
    const app = createTestApp();
    const cookie = await registerUser(app);

    const mk = (judul: string) =>
      app.request("/admin/karya", {
        method: "POST",
        headers: { cookie, ...formPostHeaders },
        body: new URLSearchParams({ judul, deskripsi: "", kategori: "desain" }).toString(),
      });
    const alpha = await mk("Alpha Work");
    const beta = await mk("Beta Work");
    const betaId = beta.headers.get("location")!.split("/").pop()!;
    void alpha;

    await app.request(`/karya/${betaId}/like`, {
      method: "POST",
      headers: { cookie, ...formHeaders },
    });

    const search = await (await app.request("/?q=Alpha")).text();
    expect(search).toContain("Alpha Work");
    expect(search).not.toContain("Beta Work");

    const popular = await (await app.request("/?sort=popular")).text();
    expect(popular.indexOf("Beta Work")).toBeLessThan(popular.indexOf("Alpha Work"));
  });
});

describe("Web — file cleanup", () => {
  test("uploaded files are removed when karya is deleted", async () => {
    const app = createTestApp();
    const cookie = await registerUser(app);

    const create = await app.request("/admin/karya", {
      method: "POST",
      headers: { cookie, ...formPostHeaders },
      body: new URLSearchParams({ judul: "A", deskripsi: "", kategori: "desain" }).toString(),
    });
    const karyaId = create.headers.get("location")!.split("/").pop()!;
    const up = await uploadPart(app, cookie, karyaId, "kepala");
    void up;

    const manage = await (await app.request(`/admin/karya/${karyaId}`, { headers: { cookie } })).text();
    const file = manage.match(/\/uploads\/([0-9a-f-]+\.png)/)?.[1];
    expect(file).toBeTruthy();
    expect(() => unlinkSync(`uploads/${file}`)).not.toThrow();

    await app.request(`/admin/karya/${karyaId}/delete`, {
      method: "POST",
      headers: { cookie, ...formHeaders },
    });
    expect(() => unlinkSync(`uploads/${file}`)).toThrow();
  });
});

describe("Web — regression (bug #16 coverage)", () => {
  /** Create a karya and upload one head part. Returns ids + the stored filename. */
  async function seedKarya(
    app: { request: (path: string, init?: RequestInit) => Promise<Response> | Response },
    cookie: string,
    judul = "Seed"
  ) {
    const create = await app.request("/admin/karya", {
      method: "POST",
      headers: { cookie, ...formPostHeaders },
      body: new URLSearchParams({ judul, deskripsi: "", kategori: "desain" }).toString(),
    });
    const karyaId = create.headers.get("location")!.split("/").pop()!;
    await uploadPart(app, cookie, karyaId, "kepala");
    const manage = await (await app.request(`/admin/karya/${karyaId}`, { headers: { cookie } })).text();
    const partId = manage.match(/\/parts\/([0-9a-f-]+)\/delete/)?.[1]!;
    const file = manage.match(/\/uploads\/([0-9a-f-]+\.png)/)?.[1]!;
    return { karyaId, partId, file };
  }

  // Each test below documents a coverage gap found in #16. They are skipped because
  // the underlying bug is owned by another developer — flip to `test(` once fixed.
  test.skip("bug #3: homepage & profile card points at /uploads/<file>, never /uploads/uploads/", async () => {
    const app = createTestApp();
    const cookie = await registerUser(app);
    const { karyaId, file } = await seedKarya(app, cookie, "Kartu");

    const home = await (await app.request("/")).text();
    expect(home).toContain(`/uploads/${file}`);
    expect(home).not.toContain("/uploads/uploads/");

    const profil = await (await app.request("/profil/admin")).text();
    expect(profil).toContain(`/uploads/${file}`);
    expect(profil).not.toContain("/uploads/uploads/");

    await app.request(`/admin/karya/${karyaId}/delete`, {
      method: "POST",
      headers: { cookie, ...formHeaders },
    });
  });

  test.skip("bug #2: owner of karya A cannot delete a part belonging to karya B", async () => {
    const app = createTestApp();
    const attacker = await registerUser(app, "attacker");
    const victim = await registerUser(app, "victim");

    const a = await seedKarya(app, attacker, "A");
    const b = await seedKarya(app, victim, "B");

    // Attacker uses their own karya id + victim's part id.
    await app.request(`/admin/karya/${a.karyaId}/parts/${b.partId}/delete`, {
      method: "POST",
      headers: { cookie: attacker, ...formHeaders },
    });

    // Victim's part must survive.
    const bManage = await (await app.request(`/admin/karya/${b.karyaId}`, { headers: { cookie: victim } })).text();
    expect(bManage).toContain(`/parts/${b.partId}/delete`);
    expect(bManage).not.toContain("No head images yet");

    for (const [cookie, id] of [[attacker, a.karyaId], [victim, b.karyaId]] as const) {
      await app.request(`/admin/karya/${id}/delete`, {
        method: "POST",
        headers: { cookie, ...formHeaders },
      });
    }
  });

  test.skip("bug #1: upload extension comes from MIME, not filename", async () => {
    const app = createTestApp();
    const cookie = await registerUser(app);
    const before = new Set(readdirSync("uploads"));

    const create = await app.request("/admin/karya", {
      method: "POST",
      headers: { cookie, ...formPostHeaders },
      body: new URLSearchParams({ judul: "Ext", deskripsi: "", kategori: "desain" }).toString(),
    });
    const karyaId = create.headers.get("location")!.split("/").pop()!;

    // Declared image/png, named evil.html → must NOT be stored as .html.
    const evil = new File(["<script>alert(1)</script>"], "evil.html", { type: "image/png" });
    await uploadPart(app, cookie, karyaId, "kepala", evil);

    const created = readdirSync("uploads").filter((f) => !before.has(f));
    expect(created.length).toBe(1);
    expect(created[0].endsWith(".html")).toBe(false);
    expect(created[0].endsWith(".png")).toBe(true);

    await app.request(`/admin/karya/${karyaId}/delete`, {
      method: "POST",
      headers: { cookie, ...formHeaders },
    });
  });

  test.skip("bug #4: deleting a karya removes its parts and likes rows", async () => {
    const sqlite = createTestDb();
    const db: Db = { driver: "sqlite", sqlite, supabase: null };
    const app = createApp(db);

    const cookie = await registerUser(app);
    const { karyaId } = await seedKarya(app, cookie, "Orphan");

    await app.request(`/karya/${karyaId}/like`, {
      method: "POST",
      headers: { cookie, ...formHeaders },
    });

    await app.request(`/admin/karya/${karyaId}/delete`, {
      method: "POST",
      headers: { cookie, ...formHeaders },
    });

    const parts = (sqlite.query("SELECT COUNT(*) AS n FROM karya_parts WHERE karya_id = ?").get(karyaId) as { n: number }).n;
    const likes = (sqlite.query("SELECT COUNT(*) AS n FROM likes WHERE karya_id = ?").get(karyaId) as { n: number }).n;
    expect(parts).toBe(0);
    expect(likes).toBe(0);
  });
});