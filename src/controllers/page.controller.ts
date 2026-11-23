import { Hono } from "hono";
import type { Db } from "../db";
import { UserModel } from "../models/user.model";
import { KaryaModel } from "../models/karya.model";
import { FollowModel } from "../models/follow.model";
import { requireAuth } from "../middleware/auth.middleware";
import { view, redirect, flashSuccess, flashError, type AppEnv } from "../view";
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
    const follows = new FollowModel(db.sqlite);
    const viewer = c.get("user");
    const items = withComposition(karya.byUserPublic(user.id), karya);
    return view(c, "homepage/profil", {
      profil: user,
      karya: items,
      isSelf: viewer?.id === user.id,
      isFollowing: viewer ? follows.isFollowing(viewer.id, user.id) : false,
      followerCount: follows.followerCount(user.id),
      followingCount: follows.followingCount(user.id),
    });
  });

  // POST /profil/:username/follow — toggle follow
  app.post("/profil/:username/follow", requireAuth(db), (c) => {
    if (!db.sqlite) return c.text("supabase mode not implemented", 501);
    const users = new UserModel(db.sqlite);
    const target = users.findByUsernamePublic(c.req.param("username")!);
    if (!target || target.status !== "active") {
      flashError(c, "User not found.");
      return redirect(c, "/");
    }
    const followerId = c.get("userId");
    if (followerId === target.id) {
      flashError(c, "You cannot follow yourself.");
      return redirect(c, `/profil/${target.username}`);
    }
    const nowFollowing = new FollowModel(db.sqlite).toggle(followerId, target.id);
    flashSuccess(
      c,
      nowFollowing ? `Now following @${target.username}.` : `Unfollowed @${target.username}.`
    );
    return redirect(c, `/profil/${target.username}`);
  });

  // GET /feed — works from creators the logged-in user follows
  app.get("/feed", requireAuth(db), (c) => {
    if (!db.sqlite) return c.text("supabase mode not implemented", 501);
    const karya = new KaryaModel(db.sqlite);
    const items = withComposition(new FollowModel(db.sqlite).feed(c.get("userId")), karya);
    return view(c, "homepage/feed", { karya: items });
  });

  return app;
}