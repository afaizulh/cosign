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
 * Controller: account settings (full name, bio, avatar, public profile link).
 * Mounted at /studio → /studio/settings*.
 */
export function settingsController(db: Db) {
  const app = new Hono<AppEnv>();

  if (!db.sqlite) {
    app.all("*", (c) => c.text("supabase mode not implemented", 501));
    return app;
  }

  const users = new UserModel(db.sqlite);

  // GET /studio/settings — settings page (profile + public profile + account)
  app.get("/settings", requireAuth(db), (c) => {
    return view(c, "studio/settings", { profil: users.findPublic(c.get("userId")) });
  });

  // Legacy: settings used to live at /studio/profil
  app.get("/profil", (c) => c.redirect("/studio/settings", 301));

  // POST /studio/settings — update full name & bio
  app.post("/settings", requireAuth(db), async (c) => {
    const body = await c.req.parseBody();
    const fullName = String(body.full_name ?? "").trim();
    const bio = String(body.bio ?? "").trim();

    if (fullName.length > MAX_FULL_NAME) {
      flashError(c, `Full name is too long (max ${MAX_FULL_NAME} characters).`);
      return redirect(c, "/studio/settings");
    }
    if (bio.length > MAX_BIO) {
      flashError(c, `Bio is too long (max ${MAX_BIO} characters).`);
      return redirect(c, "/studio/settings");
    }

    users.updateProfile(c.get("userId"), { fullName, bio });
    flashSuccess(c, "Profile updated.");
    return redirect(c, "/studio/settings");
  });

  // POST /studio/settings/avatar — upload / replace avatar
  app.post(
    "/settings/avatar",
    requireAuth(db),
    bodyLimit({
      maxSize: MAX_UPLOAD_BODY,
      onError: (c) => {
        flashError(c, "Upload too large. Max 20MB.");
        return redirect(c, "/studio/settings");
      },
    }),
    async (c) => {
      const body = await c.req.parseBody();
      const file = body.avatar;
      if (!(file instanceof File)) {
        flashError(c, "Choose an image file to upload.");
        return redirect(c, "/studio/settings");
      }
      const saved = saveImage(file);
      if (!saved.ok) {
        flashError(c, saved.error);
        return redirect(c, "/studio/settings");
      }
      await Bun.write(saved.path, file);
      if (!existsSync(saved.path)) {
        flashError(c, "Failed to save the image on the server.");
        return redirect(c, "/studio/settings");
      }
      const previous = users.setAvatar(c.get("userId"), saved.path);
      removeUpload(previous);
      flashSuccess(c, "Avatar updated.");
      return redirect(c, "/studio/settings");
    }
  );

  // POST /studio/settings/avatar/delete — remove avatar
  app.post("/settings/avatar/delete", requireAuth(db), (c) => {
    const previous = users.setAvatar(c.get("userId"), null);
    removeUpload(previous);
    flashSuccess(c, "Avatar removed.");
    return redirect(c, "/studio/settings");
  });

  return app;
}
