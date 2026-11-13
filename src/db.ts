import { Database } from "bun:sqlite";
import { env } from "bun";
import { mkdirSync } from "fs";

export type Driver = "sqlite" | "supabase";

export interface Db {
  driver: Driver;
  sqlite: Database | null;
  supabase: any; // dari @supabase/supabase-js (opsional, null di mode sqlite)
}

/**
 * Init database berdasarkan env DB_DRIVER:
 * - "sqlite" (default)  → bun:sqlite, file di DB_FILE
 * - "supabase"          → @supabase/supabase-js (jalankan `bun add @supabase/supabase-js`)
 */
export async function initDb(): Promise<Db> {
  const driver = (env.DB_DRIVER || "sqlite") as Driver;

  if (driver === "supabase") {
    // Optional dependency — install with `bun add @supabase/supabase-js` before using this driver.
    // @ts-expect-error optional module, absent in sqlite-only installs
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(env.SUPABASE_URL!, env.SUPABASE_ANON_KEY!);
    return { driver, sqlite: null, supabase };
  }

  // default: SQLite
  mkdirSync("data", { recursive: true });
  mkdirSync("uploads", { recursive: true });
  const sqlite = new Database(env.DB_FILE || "data/app.db", { create: true });
  sqlite.exec("PRAGMA journal_mode = WAL;");
  migrate(sqlite);
  return { driver, sqlite, supabase: null };
}

export function migrate(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      full_name TEXT,
      bio TEXT,
      avatar_path TEXT,
      password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS karya (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      judul TEXT NOT NULL,
      deskripsi TEXT,
      kategori TEXT,
      tipe TEXT NOT NULL DEFAULT '2d',   -- '2d' | '3d'
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS karya_parts (
      id TEXT PRIMARY KEY,
      karya_id TEXT NOT NULL,
      kategori TEXT NOT NULL,      -- 'kepala' | 'badan' | 'background'
      media_path TEXT NOT NULL,
      media_type TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS likes (
      karya_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      PRIMARY KEY (karya_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      karya_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_comments_karya ON comments(karya_id, created_at);

    CREATE TABLE IF NOT EXISTS karya_assets (
      id TEXT PRIMARY KEY,
      karya_id TEXT NOT NULL,
      nama TEXT,
      media_path TEXT NOT NULL,
      media_type TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Add `tipe` to existing karya tables created before the 2D/3D split.
  const karyaCols = db.query("PRAGMA table_info(karya)").all() as { name: string }[];
  if (!karyaCols.some((c) => c.name === "tipe")) {
    db.exec("ALTER TABLE karya ADD COLUMN tipe TEXT NOT NULL DEFAULT '2d';");
  }

  // Migrate old karya schema (media_path/media_type columns on karya) → karya_parts.
  // Copy existing media into karya_parts FIRST, then drop the old columns —
  // dropping without copying would destroy legacy images. Wrapped in a
  // transaction so a failure leaves the old columns/data intact.
  const cols = db.query("PRAGMA table_info(karya)").all() as { name: string }[];
  if (cols.some((c) => c.name === "media_path")) {
    db.transaction(() => {
      const hasMediaType = cols.some((c) => c.name === "media_type");
      db.exec(`
        INSERT INTO karya_parts (id, karya_id, kategori, media_path, media_type, created_at)
        SELECT lower(hex(randomblob(16))), id, 'background', media_path,
               ${hasMediaType ? "media_type" : "NULL"}, created_at
        FROM karya
        WHERE media_path IS NOT NULL AND media_path != ''
      `);
      db.exec("ALTER TABLE karya DROP COLUMN media_path;");
      if (hasMediaType) db.exec("ALTER TABLE karya DROP COLUMN media_type;");
    })();
  }
}
