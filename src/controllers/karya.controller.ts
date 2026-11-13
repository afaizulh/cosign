import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { randomUUID } from "crypto";
import { unlinkSync, existsSync } from "fs";
import type { Db } from "../db";
import { KaryaModel } from "../models/karya.model";
import { CommentModel } from "../models/comment.model";
import { requireAuth } from "../middleware/auth.middleware";
import { view, redirect, flashSuccess, flashError, type AppEnv } from "../view";
import { partsByCategory, latestParts } from "../composition";
import { saveImage, MAX_UPLOAD_BODY } from "../uploads";
import { KATEGORI_LIST } from "./page.controller";

export const PART_KATEGORI = ["kepala", "badan", "background"];
export const TIPE_LIST = ["2d", "3d"];
const ASSET_EXTS = ["glb", "gltf", "obj", "fbx", "stl", "usdz"];
const MAX_ASSET_SIZE = 50 * 1024 * 1024; // 50MB
const UPLOAD_DIR = "uploads"; // must stay in sync with serveStatic /uploads/* in app.ts

function isOwner(item: { user_id: string }, userId: string) {
  return item.user_id === userId;
}

/** Validate an uploaded 3D asset file (extension whitelist — MIME is unreliable). */
function saveAsset(
  file: File
): { ok: true; path: string; ext: string } | { ok: false; error: string } {
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  if (!ASSET_EXTS.includes(ext)) {
    return { ok: false, error: "Only 3D files are allowed (GLB, GLTF, OBJ, FBX, STL, USDZ)." };
  }
  if (file.size > MAX_ASSET_SIZE) {
    return { ok: false, error: "3D file size limit is 50MB." };
  }
  return { ok: true, path: `${UPLOAD_DIR}/${randomUUID()}.${ext}`, ext };
}
/**
 * Admin controller (mounted at /admin): manage karya & parts.
 * Internal paths are relative — mount at "/admin" → /admin/karya*.
 */
export function karyaAdminController(db: Db) {
  const app = new Hono<AppEnv>();

  if (!db.sqlite) {
    app.all("*", (c) => c.text("supabase mode not implemented", 501));
    return app;
  }

  const karya = new KaryaModel(db.sqlite);

  // GET /admin/karya — my works + create form
  app.get("/karya", requireAuth(db), (c) => {
    const userId = c.get("userId");
    const rows = karya.byUser(userId) as Array<Record<string, unknown>>;
    // One batch query for all part counts instead of one per karya (N+1).
    const ids = rows.map((k) => String(k.id));
    const partsByKarya = karya.partsForMany(ids);
    const assetsByKarya = karya.assetCountsForMany(ids);
    const items = rows.map((k) => ({
      ...k,
      part_count: (partsByKarya[String(k.id)] ?? []).length,
      asset_count: assetsByKarya[String(k.id)] ?? 0,
    }));
    return view(c, "admin/karya/index", { karya: items, kategoriList: KATEGORI_LIST });
  });

  // POST /admin/karya — create work (parts added later)
  app.post("/karya", requireAuth(db), async (c) => {
    const body = await c.req.parseBody();
    const judul = String(body.judul ?? "").trim();
    const deskripsi = String(body.deskripsi ?? "").trim();
    let kategori = String(body.kategori ?? "lainnya").trim();
    if (!KATEGORI_LIST.includes(kategori)) {
      kategori = "lainnya";
    }
    let tipe = String(body.tipe ?? "2d").trim();
    if (!TIPE_LIST.includes(tipe)) {
      tipe = "2d";
    }
    if (!judul) {
      flashError(c, "Title is required.");
      return redirect(c, "/admin/karya");
    }
    const id = karya.create({
      userId: c.get("userId") as string,
      judul,
      deskripsi,
      kategori,
      tipe,
    });
    if (tipe === "3d") {
      flashSuccess(c, "Work created. Now upload your 3D assets.");
      return redirect(c, `/admin/karya/${id}/3d`);
    }
    flashSuccess(c, "Work created. Now add head, body & background images.");
    return redirect(c, `/admin/karya/${id}`);
  });

  // GET /admin/karya/:id — manage parts (upload per category, delete part)
  app.get("/karya/:id", requireAuth(db), (c) => {
    const item = karya.findById(c.req.param("id")!);
    if (!item || !isOwner(item, c.get("userId") as string)) {
      flashError(c, "Work not found.");
      return redirect(c, "/admin/karya");
    }
    if (item.tipe === "3d") {
      return redirect(c, `/admin/karya/${item.id}/3d`);
    }
    const parts = karya.parts(item.id);
    return view(c, "admin/karya/show", {
      karya: item,
      byCategory: partsByCategory(parts),
      kategoriList: PART_KATEGORI,
      workKategoriList: KATEGORI_LIST,
    });
  });

  // GET /admin/karya/:id/3d — manage 3D assets
  app.get("/karya/:id/3d", requireAuth(db), (c) => {
    const item = karya.findById(c.req.param("id")!);
    if (!item || !isOwner(item, c.get("userId") as string)) {
      flashError(c, "Work not found.");
      return redirect(c, "/admin/karya");
    }
    if (item.tipe !== "3d") {
      return redirect(c, `/admin/karya/${item.id}`);
    }
    return view(c, "admin/karya/show3d", {
      karya: item,
      assets: karya.assets(item.id),
      workKategoriList: KATEGORI_LIST,
    });
  });

  // POST /admin/karya/:id/3d — upload a 3D asset
  app.post("/karya/:id/3d", requireAuth(db), async (c) => {
    const id = c.req.param("id")!;
    const item = karya.findById(id);
    if (!item || !isOwner(item, c.get("userId") as string)) {
      flashError(c, "Work not found.");
      return redirect(c, "/admin/karya");
    }
    if (item.tipe !== "3d") {
      return redirect(c, `/admin/karya/${item.id}`);
    }
    const body = await c.req.parseBody();
    const nama = String(body.nama ?? "").trim();
    const file = body.media;

    if (!(file instanceof File)) {
      flashError(c, "Choose a 3D file to upload.");
      return redirect(c, `/admin/karya/${id}/3d`);
    }
    const saved = saveAsset(file);
    if (!saved.ok) {
      flashError(c, saved.error);
      return redirect(c, `/admin/karya/${id}/3d`);
    }
    await Bun.write(saved.path, file);
    if (!existsSync(saved.path)) {
      flashError(c, "Failed to save the file on the server.");
      return redirect(c, `/admin/karya/${id}/3d`);
    }
    karya.addAsset({
      karyaId: id,
      nama: nama || file.name,
      mediaPath: saved.path,
      mediaType: file.type || saved.ext,
    });
    flashSuccess(c, "3D asset uploaded.");
    return redirect(c, `/admin/karya/${id}/3d`);
  });

  // POST /admin/karya/:id/3d/:aid/delete — remove one 3D asset
  app.post("/karya/:id/3d/:aid/delete", requireAuth(db), (c) => {
    const id = c.req.param("id")!;
    const item = karya.findById(id);
    if (!item || !isOwner(item, c.get("userId") as string)) {
      flashError(c, "Work not found.");
      return redirect(c, "/admin/karya");
    }
    const asset = karya.findAsset(c.req.param("aid")!);
    if (!asset || asset.karya_id !== id) {
      flashError(c, "Asset not found.");
      return redirect(c, `/admin/karya/${id}/3d`);
    }
    karya.deleteAsset(asset.id);
    try {
      unlinkSync(asset.media_path);
    } catch {
      // file already gone — ignore
    }
    flashSuccess(c, "3D asset deleted.");
    return redirect(c, `/admin/karya/${id}/3d`);
  });

  // POST /admin/karya/:id/edit — update title, description & category
  app.post("/karya/:id/edit", requireAuth(db), async (c) => {
    const id = c.req.param("id")!;
    const item = karya.findById(id);
    if (!item || !isOwner(item, c.get("userId") as string)) {
      flashError(c, "Work not found.");
      return redirect(c, "/admin/karya");
    }
    const body = await c.req.parseBody();
    const judul = String(body.judul ?? "").trim();
    const deskripsi = String(body.deskripsi ?? "").trim();
    let kategori = String(body.kategori ?? "lainnya").trim();
    if (!KATEGORI_LIST.includes(kategori)) {
      kategori = "lainnya";
    }
    if (!judul) {
      flashError(c, "Title is required.");
      return redirect(c, `/admin/karya/${id}`);
    }
    karya.update(id, { judul, deskripsi, kategori });
    flashSuccess(c, "Work updated.");
    return redirect(c, `/admin/karya/${id}`);
  });

  // POST /admin/karya/:id/parts — upload a part image
  app.post(
    "/karya/:id/parts",
    requireAuth(db),
    // Cap the body before parseBody() buffers it into memory.
    bodyLimit({
      maxSize: MAX_UPLOAD_BODY,
      onError: (c) => {
        flashError(c, "Upload too large. Max 20MB.");
        return redirect(c, `/admin/karya/${c.req.param("id")!}`);
      },
    }),
    async (c) => {
    const id = c.req.param("id")!;
    const item = karya.findById(id);
    if (!item || !isOwner(item, c.get("userId") as string)) {
      flashError(c, "Work not found.");
      return redirect(c, "/admin/karya");
    }
    const body = await c.req.parseBody();
    const kategori = String(body.kategori ?? "").trim();
    const file = body.media;

    if (!PART_KATEGORI.includes(kategori)) {
      flashError(c, "Invalid part category.");
      return redirect(c, `/admin/karya/${id}`);
    }
    if (!(file instanceof File)) {
      flashError(c, "Choose an image file to upload.");
      return redirect(c, `/admin/karya/${id}`);
    }
    const saved = saveImage(file);
    if (!saved.ok) {
      flashError(c, saved.error);
      return redirect(c, `/admin/karya/${id}`);
    }
    await Bun.write(saved.path, file);
    if (!existsSync(saved.path)) {
      flashError(c, "Failed to save the image on the server.");
      return redirect(c, `/admin/karya/${id}`);
    }
    karya.addPart({
      karyaId: id,
      kategori,
      mediaPath: saved.path,
      mediaType: file.type,
    });
    flashSuccess(c, "Part added.");
    return redirect(c, `/admin/karya/${id}`);
  });

  // POST /admin/karya/:id/parts/:pid/delete — remove one part
  app.post("/karya/:id/parts/:pid/delete", requireAuth(db), (c) => {
    const id = c.req.param("id")!;
    const item = karya.findById(id);
    if (!item || !isOwner(item, c.get("userId") as string)) {
      flashError(c, "Work not found.");
      return redirect(c, "/admin/karya");
    }
    const part = karya.findPart(c.req.param("pid")!);
    if (!part) {
      flashError(c, "Part not found.");
      return redirect(c, `/admin/karya/${id}`);
    }
    karya.deletePart(part.id);
    try {
      unlinkSync(part.media_path);
    } catch {
      // file already gone — ignore
    }
    flashSuccess(c, "Part deleted.");
    return redirect(c, `/admin/karya/${id}`);
  });

  // POST /admin/karya/:id/delete — remove work + all part files
  app.post("/karya/:id/delete", requireAuth(db), (c) => {
    const id = c.req.param("id")!;
    const item = karya.findById(id);
    if (!item || !isOwner(item, c.get("userId") as string)) {
      flashError(c, "Work not found.");
      return redirect(c, "/admin/karya");
    }
    for (const p of karya.parts(id)) {
      try {
        unlinkSync(p.media_path);
      } catch {
        // ignore
      }
    }
    for (const a of karya.assets(id)) {
      try {
        unlinkSync(a.media_path);
      } catch {
        // ignore
      }
    }
    new CommentModel(db.sqlite!).deleteByKarya(id);
    karya.delete(id);
    flashSuccess(c, "Work deleted.");
    return redirect(c, "/admin/karya");
  });

  return app;
}

/**
 * Public controller (mounted at /): karya detail/customizer + like.
 * Internal paths are relative — mount at "/" → /karya*.
 */
export function karyaPublicController(db: Db) {
  const app = new Hono<AppEnv>();

  if (!db.sqlite) {
    app.all("*", (c) => c.text("supabase mode not implemented", 501));
    return app;
  }

  const karya = new KaryaModel(db.sqlite);
  const comments = new CommentModel(db.sqlite);

  // GET /karya/:id — public detail + customizer
  app.get("/karya/:id", (c) => {
    const item = karya.findById(c.req.param("id")!);
    if (!item) {
      flashError(c, "Work not found.");
      return redirect(c, "/");
    }
    const user = c.get("user" as never) as { id: string } | null;
    const like_count = karya.likeCount(item.id);
    const liked = user ? karya.hasLiked(item.id, user.id) : false;

    if (item.tipe === "3d") {
      return view(c, "homepage/karya-3d", {
        karya: { ...item, like_count, liked },
        assets: karya.assets(item.id),
      });
    }

    const parts = karya.parts(item.id);
    const data = {
      ...item,
      parts: latestParts(parts),
      like_count,
      liked,
    };
    return view(c, "homepage/karya", {
      karya: data,
      byCategory: partsByCategory(parts),
      kategoriList: PART_KATEGORI,
      comments: comments.byKarya(item.id),
    });
  });

  // POST /karya/:id/comments — add a comment
  app.post("/karya/:id/comments", requireAuth(db), async (c) => {
    const id = c.req.param("id")!;
    if (!karya.findById(id)) {
      flashError(c, "Work not found.");
      return redirect(c, "/");
    }
    const body = await c.req.parseBody();
    const text = String(body.body ?? "").trim();
    if (!text) {
      flashError(c, "Comment cannot be empty.");
      return redirect(c, `/karya/${id}`);
    }
    if (text.length > 1000) {
      flashError(c, "Comment is too long (max 1000 characters).");
      return redirect(c, `/karya/${id}`);
    }
    comments.create(id, c.get("userId") as string, text);
    flashSuccess(c, "Comment posted.");
    return redirect(c, `/karya/${id}`);
  });

  // POST /karya/:id/comments/:cid/delete — author or karya owner
  app.post("/karya/:id/comments/:cid/delete", requireAuth(db), (c) => {
    const id = c.req.param("id")!;
    const item = karya.findById(id);
    if (!item) {
      flashError(c, "Work not found.");
      return redirect(c, "/");
    }
    const comment = comments.findById(c.req.param("cid")!);
    if (!comment || comment.karya_id !== id) {
      flashError(c, "Comment not found.");
      return redirect(c, `/karya/${id}`);
    }
    const userId = c.get("userId") as string;
    if (comment.user_id !== userId && item.user_id !== userId) {
      flashError(c, "You cannot delete this comment.");
      return redirect(c, `/karya/${id}`);
    }
    comments.delete(comment.id);
    flashSuccess(c, "Comment deleted.");
    return redirect(c, `/karya/${id}`);
  });

  // POST /karya/:id/like — toggle like
  app.post("/karya/:id/like", requireAuth(db), (c) => {
    const id = c.req.param("id")!;
    if (!karya.findById(id)) {
      flashError(c, "Work not found.");
      return redirect(c, "/");
    }
    karya.toggleLike(id, c.get("userId") as string);
    return redirect(c, `/karya/${id}`);
  });

  return app;
}