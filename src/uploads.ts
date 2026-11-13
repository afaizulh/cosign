import { randomUUID } from "crypto";
import { unlinkSync } from "fs";

export const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB
// Request body cap: file limit + headroom for multipart boundaries/fields.
export const MAX_UPLOAD_BODY = MAX_IMAGE_SIZE + 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const UPLOAD_DIR = "uploads"; // must stay in sync with serveStatic /uploads/* in app.ts

/** Validate an uploaded image file. */
export function saveImage(
  file: File
): { ok: true; path: string } | { ok: false; error: string } {
  if (!IMAGE_TYPES.includes(file.type)) {
    return { ok: false, error: "Only image files are allowed (JPG, PNG, GIF, WEBP)." };
  }
  if (file.size > MAX_IMAGE_SIZE) {
    return { ok: false, error: "Image size limit is 20MB." };
  }
  const ext = (file.name.split(".").pop() ?? "bin").toLowerCase();
  return { ok: true, path: `${UPLOAD_DIR}/${randomUUID()}.${ext}` };
}

/** Delete a stored upload, ignoring an already-missing file. */
export function removeUpload(path: string | null) {
  if (!path) return;
  try {
    unlinkSync(path);
  } catch {
    // file already gone — ignore
  }
}
