import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { existsSync } from "fs";
import type { Db } from "../db";
import { UserModel } from "../models/user.model";
import { requireAuth } from "../middleware/auth.middleware";
import { view, redirect, flashSuccess, flashError, type AppEnv } from "../view";
import { saveImage, removeUpload, MAX_UPLOAD_BODY } from "../uploads";

const MAX_FULL_NAME = 80;
const MAX_BIO = 500;

/**
 * Controller: edit own profile (full name, bio, avatar).
 * Mounted at /admin → /admin/profil*.
 */
export function profilController(db: Db) {
  const app = new Hono<AppEnv>();

  if (!db.sqlite) {
    app.all("*", (c) => c.text("supabase mode not implemented", 501));
    return app;
  }

  const users = new UserModel(db.sqlite);

  // GET /admin/profil — edit form
  app.get("/profil", requireAuth(db), (c) => {
    return view(c, "admin/profil/edit", { profil: users.findPublic(c.get("userId")) });
  });

  // POST /admin/profil — update full name & bio
  app.post("/profil", requireAuth(db), async (c) => {
    const body = await c.req.parseBody();
    const fullName = String(body.full_name ?? "").trim();
    const bio = String(body.bio ?? "").trim();

    if (fullName.length > MAX_FULL_NAME) {
      flashError(c, `Full name is too long (max ${MAX_FULL_NAME} characters).`);
      return redirect(c, "/admin/profil");
    }
    if (bio.length > MAX_BIO) {
      flashError(c, `Bio is too long (max ${MAX_BIO} characters).`);
      return redirect(c, "/admin/profil");
    }

    users.updateProfile(c.get("userId"), { fullName, bio });
    flashSuccess(c, "Profile updated.");
    return redirect(c, "/admin/profil");
  });

  // POST /admin/profil/avatar — upload / replace avatar
  app.post(
    "/profil/avatar",
    requireAuth(db),
    bodyLimit({
      maxSize: MAX_UPLOAD_BODY,
      onError: (c) => {
        flashError(c, "Upload too large. Max 20MB.");
        return redirect(c, "/admin/profil");
      },
    }),
    async (c) => {
      const body = await c.req.parseBody();
      const file = body.avatar;
      if (!(file instanceof File)) {
        flashError(c, "Choose an image file to upload.");
        return redirect(c, "/admin/profil");
      }
      const saved = saveImage(file);
      if (!saved.ok) {
        flashError(c, saved.error);
        return redirect(c, "/admin/profil");
      }
      await Bun.write(saved.path, file);
      if (!existsSync(saved.path)) {
        flashError(c, "Failed to save the image on the server.");
        return redirect(c, "/admin/profil");
      }
      const previous = users.setAvatar(c.get("userId"), saved.path);
      removeUpload(previous);
      flashSuccess(c, "Avatar updated.");
      return redirect(c, "/admin/profil");
    }
  );

  // POST /admin/profil/avatar/delete — remove avatar
  app.post("/profil/avatar/delete", requireAuth(db), (c) => {
    const previous = users.setAvatar(c.get("userId"), null);
    removeUpload(previous);
    flashSuccess(c, "Avatar removed.");
    return redirect(c, "/admin/profil");
  });

  return app;
}
