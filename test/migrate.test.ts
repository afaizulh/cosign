import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { migrate } from "../src/db";

describe("migrate: legacy karya media columns", () => {
  test("copies media into karya_parts before dropping columns", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE karya (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        judul TEXT NOT NULL,
        deskripsi TEXT,
        kategori TEXT,
        media_path TEXT,
        media_type TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      INSERT INTO karya (id, user_id, judul, media_path, media_type)
      VALUES ('k1', 'u1', 'Old work', 'uploads/old.png', 'image/png');
    `);

    migrate(db);

    const cols = db.query("PRAGMA table_info(karya)").all() as { name: string }[];
    expect(cols.some((c) => c.name === "media_path")).toBe(false);
    expect(cols.some((c) => c.name === "media_type")).toBe(false);

    const parts = db
      .query("SELECT karya_id, kategori, media_path, media_type FROM karya_parts")
      .all() as { karya_id: string; kategori: string; media_path: string; media_type: string }[];
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({
      karya_id: "k1",
      kategori: "background",
      media_path: "uploads/old.png",
      media_type: "image/png",
    });
  });

  test("is idempotent (safe to run again)", () => {
    const db = new Database(":memory:");
    migrate(db);
    expect(() => migrate(db)).not.toThrow();
  });
});
