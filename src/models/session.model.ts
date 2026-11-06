import { randomUUID } from "crypto";
import type { Database } from "bun:sqlite";

/** Session lifetime (days) — keep in sync with the `sid` cookie maxAge. */
export const SESSION_TTL_DAYS = 7;
const TTL = `-${SESSION_TTL_DAYS} days`;

/** Model: tabel sessions — session cookie. */
export class SessionModel {
  constructor(private db: Database) {}

  /** Buat session baru (sekaligus buang session kedaluwarsa), return sid. */
  create(userId: string): string {
    this.db
      .query("DELETE FROM sessions WHERE created_at <= datetime('now', ?)")
      .run(TTL);
    const sid = randomUUID();
    this.db
      .query("INSERT INTO sessions (id, user_id) VALUES (?, ?)")
      .run(sid, userId);
    return sid;
  }

  /** Cari userId dari sid (null kalau tidak ada / sudah kedaluwarsa). */
  findBySid(sid: string): string | null {
    const row = this.db
      .query(
        "SELECT user_id FROM sessions WHERE id = ? AND created_at > datetime('now', ?)"
      )
      .get(sid, TTL) as { user_id: string } | null;
    return row?.user_id ?? null;
  }

  /** Hapus session (logout). */
  delete(sid: string) {
    this.db.query("DELETE FROM sessions WHERE id = ?").run(sid);
  }
}
