import { Hono } from "hono";
import type { Db } from "../db";
import { UserModel } from "../models/user.model";
import { KaryaModel } from "../models/karya.model";
import { view, redirect, flashError, type AppEnv } from "../view";
import { withComposition } from "../composition";

/** Fixed list of work categories (used for filters & forms). */
export const KATEGORI_LIST = ["design", "illustration", "photography", "motion", "other"];

/** Old Indonesian slugs → English, so bookmarks and in-flight forms keep working. */
export const KATEGORI_ALIASES: Record<string, string> = {
  desain: "design",
  ilustrasi: "illustration",
  fotografi: "photography",
  motion: "motion",
  lainnya: "other",
};

/** Normalise a category slug (accepts legacy Indonesian values). */
export function normalizeKategori(raw: string | undefined | null): string | undefined {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value) return undefined;
  const mapped = KATEGORI_ALIASES[value] ?? value;
  return KATEGORI_LIST.includes(mapped) ? mapped : undefined;
}

/** Controller: public pages — homepage explore & profile. */
export function pageController(db: Db) {
  const app = new Hono<AppEnv>();

  app.get("/", (c) => {
    if (!db.sqlite) return c.text("supabase mode not implemented", 501);
    const karya = new KaryaModel(db.sqlite);
    const kategori = normalizeKategori(c.req.query("category") ?? c.req.query("kategori"));
    const q = c.req.query("q")?.trim() || undefined;
    const sort = c.req.query("sort") || "newest";
    const items = withComposition(karya.list(kategori, q, sort), karya);
    return view(c, "homepage/index", {
      karya: items,
      kategoriList: KATEGORI_LIST,
      aktif: kategori ?? "",
      q: q ?? "",
      sort,
    });
  });

  app.get("/profil/:username", (c) => {
    if (!db.sqlite) return c.text("supabase mode not implemented", 501);
    const users = new UserModel(db.sqlite);
    const user = users.findByUsernamePublic(c.req.param("username"));
    // Suspended accounts are invisible to the public.
    if (!user || user.status !== "active") {
      flashError(c, "User not found.");
      return redirect(c, "/");
    }
    const karya = new KaryaModel(db.sqlite);
    const items = withComposition(karya.byUserPublic(user.id), karya);
    return view(c, "homepage/profil", { profil: user, karya: items });
  });

  return app;
}