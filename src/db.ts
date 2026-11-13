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
  `);

  // Migrate old karya schema (media_path/media_type column) → karya_parts
  const cols = db.query("PRAGMA table_info(karya)").all() as { name: string }[];
  if (cols.some((c) => c.name === "media_path")) {
    db.exec(
      "ALTER TABLE karya DROP COLUMN media_path; ALTER TABLE karya DROP COLUMN media_type;"
    );
  }
}
