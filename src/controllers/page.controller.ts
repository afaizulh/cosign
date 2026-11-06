import { Hono } from "hono";
import type { Db } from "../db";
import { UserModel } from "../models/user.model";
import { KaryaModel } from "../models/karya.model";
import { view, redirect, flashError, type AppEnv } from "../view";
import { withComposition } from "../composition";

/** Fixed list of work categories (used for filters & forms). */
export const KATEGORI_LIST = ["desain", "ilustrasi", "fotografi", "motion", "lainnya"];

/** Controller: public pages — homepage explore & profile. */
export function pageController(db: Db) {
  const app = new Hono<AppEnv>();

  app.get("/", (c) => {
    if (!db.sqlite) return c.text("supabase mode not implemented", 501);
    const karya = new KaryaModel(db.sqlite);
    const kategori = c.req.query("kategori") || undefined;
    const items = withComposition(karya.list(kategori), karya);
    return view(c, "homepage/index", {
      karya: items,
      kategoriList: KATEGORI_LIST,
      aktif: kategori ?? "",
    });
  });

  app.get("/profil/:username", (c) => {
    if (!db.sqlite) return c.text("supabase mode not implemented", 501);
    const users = new UserModel(db.sqlite);
    const user = users.findByUsernamePublic(c.req.param("username"));
    if (!user) {
      flashError(c, "User not found.");
      return redirect(c, "/");
    }
    const karya = new KaryaModel(db.sqlite);
    const items = withComposition(karya.byUser(user.id), karya);
    return view(c, "homepage/profil", { profil: user, karya: items });
  });

  return app;
}