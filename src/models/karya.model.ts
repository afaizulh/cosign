import { randomUUID } from "crypto";
import type { Database } from "bun:sqlite";

export type KaryaPart = {
  id: string;
  karya_id: string;
  kategori: string; // 'head' | 'body' | 'background'
  media_path: string;
  media_type: string | null;
  created_at: string;
};

export type KaryaAsset = {
  id: string;
  karya_id: string;
  nama: string | null;
  media_path: string;
  media_type: string | null;
  created_at: string;
};

/** Model: karya + karya_parts + likes. */
export class KaryaModel {
  constructor(private db: Database) {}

  /** List published karya from active creators (explore), optional filter/search/sort. */
  list(kategori?: string, q?: string, sort?: string) {
    // Moderation: taken-down works and suspended authors never hit the explore page.
    const where: string[] = ["k.status = 'published'", "u.status = 'active'"];
    const params: string[] = [];
    if (kategori) {
      where.push("k.kategori = ?");
      params.push(kategori);
    }
    if (q) {
      where.push("(k.judul LIKE ? OR k.deskripsi LIKE ? OR u.username LIKE ?)");
      const like = `%${q}%`;
      params.push(like, like, like);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const orderSql =
      sort === "popular"
        ? "ORDER BY like_count DESC, k.created_at DESC"
        : sort === "oldest"
          ? "ORDER BY k.created_at ASC"
          : "ORDER BY k.created_at DESC";
    return this.db
      .query(
        `SELECT k.*, u.username, COUNT(l.user_id) AS like_count
         FROM karya k
         JOIN users u ON u.id = k.user_id
         LEFT JOIN likes l ON l.karya_id = k.id
         ${whereSql}
         GROUP BY k.id
         ${orderSql}`
      )
      .all(...params);
  }

  /** List karya owned by one user (includes username + like count for public cards). */
  byUser(userId: string) {
    return this.db
      .query(
        `SELECT k.*, u.username, COUNT(l.user_id) AS like_count
         FROM karya k
         JOIN users u ON u.id = k.user_id
         LEFT JOIN likes l ON l.karya_id = k.id
         WHERE k.user_id = ?
         GROUP BY k.id
         ORDER BY k.created_at DESC`
      )
      .all(userId);
  }

  /** List published karya of one user (public profile page). */
  byUserPublic(userId: string) {
    return this.db
      .query(
        `SELECT k.*, u.username, COUNT(l.user_id) AS like_count
         FROM karya k
         JOIN users u ON u.id = k.user_id
         LEFT JOIN likes l ON l.karya_id = k.id
         WHERE k.user_id = ? AND k.status = 'published'
         GROUP BY k.id
         ORDER BY k.created_at DESC`
      )
      .all(userId);
  }

  /** Admin list: every karya regardless of status, with author + like count. */
  listForAdmin(filter?: { status?: string; q?: string }) {
    const where: string[] = [];
    const params: string[] = [];
    if (filter?.status) {
      where.push("k.status = ?");
      params.push(filter.status);
    }
    if (filter?.q) {
      where.push("(k.judul LIKE ? OR u.username LIKE ?)");
      params.push(`%${filter.q}%`, `%${filter.q}%`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    return this.db
      .query(
        `SELECT k.*, u.username, u.status AS author_status,
                COUNT(l.user_id) AS like_count
         FROM karya k
         JOIN users u ON u.id = k.user_id
         LEFT JOIN likes l ON l.karya_id = k.id
         ${whereSql}
         GROUP BY k.id
         ORDER BY k.created_at DESC`
      )
      .all(...params) as Array<Record<string, unknown>>;
  }

  /** Soft delete: hide a work from the public site but keep the data. */
  takedown(id: string, adminId: string, reason: string) {
    this.db
      .query(
        "UPDATE karya SET status = 'taken_down', takedown_reason = ?, takedown_by = ?, takedown_at = datetime('now') WHERE id = ?"
      )
      .run(reason || null, adminId, id);
  }

  /** Undo a takedown. */
  restore(id: string) {
    this.db
      .query(
        "UPDATE karya SET status = 'published', takedown_reason = NULL, takedown_by = NULL, takedown_at = NULL WHERE id = ?"
      )
      .run(id);
  }

  /** Find one karya by id. */
  findById(id: string) {
    return this.db
      .query("SELECT k.*, u.username FROM karya k JOIN users u ON u.id = k.user_id WHERE k.id = ?")
      .get(id) as
      | { id: string; user_id: string; judul: string; deskripsi: string | null; kategori: string | null; tipe: string; username: string }
      | null;
  }

  /** Create new karya (no media — parts/assets are added separately), return id. */
  create(data: {
    userId: string;
    judul: string;
    deskripsi: string;
    kategori: string;
    tipe?: string;
  }): string {
    const id = randomUUID();
    this.db
      .query(
        "INSERT INTO karya (id, user_id, judul, deskripsi, kategori, tipe) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(id, data.userId, data.judul, data.deskripsi, data.kategori, data.tipe ?? "2d");
    return id;
  }

  /** Update karya metadata (title, description, category). */
  update(
    id: string,
    data: { judul: string; deskripsi: string; kategori: string }
  ) {
    this.db
      .query("UPDATE karya SET judul = ?, deskripsi = ?, kategori = ? WHERE id = ?")
      .run(data.judul, data.deskripsi, data.kategori, id);
  }

  /** Delete karya. */
  delete(id: string) {
    this.db.query("DELETE FROM karya WHERE id = ?").run(id);
  }

  // --- parts ---

  /** List parts of one karya (latest first per kategori). */
  parts(karyaId: string): KaryaPart[] {
    return this.db
      .query(
        "SELECT * FROM karya_parts WHERE karya_id = ? ORDER BY kategori, created_at DESC, id DESC"
      )
      .all(karyaId) as KaryaPart[];
  }

  /** Add a part image to a karya, return id. */
  addPart(data: {
    karyaId: string;
    kategori: string;
    mediaPath: string;
    mediaType: string;
  }): string {
    const id = randomUUID();
    this.db
      .query(
        "INSERT INTO karya_parts (id, karya_id, kategori, media_path, media_type) VALUES (?, ?, ?, ?, ?)"
      )
      .run(id, data.karyaId, data.kategori, data.mediaPath, data.mediaType);
    return id;
  }

  /** Find one part (for delete + file cleanup). */
  findPart(partId: string): KaryaPart | null {
    return this.db
      .query("SELECT * FROM karya_parts WHERE id = ?")
      .get(partId) as KaryaPart | null;
  }

  /** Delete one part. */
  deletePart(partId: string) {
    this.db.query("DELETE FROM karya_parts WHERE id = ?").run(partId);
  }

  // --- 3D assets ---

  /** List 3D assets of one karya (newest first). */
  assets(karyaId: string): KaryaAsset[] {
    return this.db
      .query("SELECT * FROM karya_assets WHERE karya_id = ? ORDER BY created_at DESC, id DESC")
      .all(karyaId) as KaryaAsset[];
  }

  /** Add a 3D asset to a karya, return id. */
  addAsset(data: {
    karyaId: string;
    nama: string;
    mediaPath: string;
    mediaType: string;
  }): string {
    const id = randomUUID();
    this.db
      .query(
        "INSERT INTO karya_assets (id, karya_id, nama, media_path, media_type) VALUES (?, ?, ?, ?, ?)"
      )
      .run(id, data.karyaId, data.nama, data.mediaPath, data.mediaType);
    return id;
  }

  /** Find one asset (for delete + file cleanup). */
  findAsset(assetId: string): KaryaAsset | null {
    return this.db
      .query("SELECT * FROM karya_assets WHERE id = ?")
      .get(assetId) as KaryaAsset | null;
  }

  /** Delete one asset. */
  deleteAsset(assetId: string) {
    this.db.query("DELETE FROM karya_assets WHERE id = ?").run(assetId);
  }

  // --- likes ---

  /** Toggle like: return true if liked, false if unliked. */
  toggleLike(karyaId: string, userId: string): boolean {
    const exists = this.db
      .query("SELECT 1 FROM likes WHERE karya_id = ? AND user_id = ?")
      .get(karyaId, userId);
    if (exists) {
      this.db
        .query("DELETE FROM likes WHERE karya_id = ? AND user_id = ?")
        .run(karyaId, userId);
      return false;
    }
    this.db
      .query("INSERT INTO likes (karya_id, user_id) VALUES (?, ?)")
      .run(karyaId, userId);
    return true;
  }

  /** Whether a user has liked a karya. */
  hasLiked(karyaId: string, userId: string): boolean {
    return !!this.db
      .query("SELECT 1 FROM likes WHERE karya_id = ? AND user_id = ?")
      .get(karyaId, userId);
  }

  /** Number of likes on one karya. */
  likeCount(karyaId: string): number {
    const row = this.db
      .query("SELECT COUNT(*) AS n FROM likes WHERE karya_id = ?")
      .get(karyaId) as { n: number };
    return row.n;
  }

  // --- batch queries (avoid N+1 on list pages) ---

  /** Parts for many karya in one query, grouped by karya_id. */
  partsForMany(karyaIds: string[]): Record<string, KaryaPart[]> {
    const map: Record<string, KaryaPart[]> = {};
    if (karyaIds.length === 0) return map;
    const placeholders = karyaIds.map(() => "?").join(",");
    const rows = this.db
      .query(
        `SELECT * FROM karya_parts WHERE karya_id IN (${placeholders}) ORDER BY kategori, created_at DESC, id DESC`
      )
      .all(...karyaIds) as KaryaPart[];
    for (const p of rows) (map[p.karya_id] ??= []).push(p);
    return map;
  }

  /** 3D asset counts for many karya in one query, keyed by karya_id. */
  assetCountsForMany(karyaIds: string[]): Record<string, number> {
    const map: Record<string, number> = {};
    if (karyaIds.length === 0) return map;
    const placeholders = karyaIds.map(() => "?").join(",");
    const rows = this.db
      .query(
        `SELECT karya_id, COUNT(*) AS n FROM karya_assets WHERE karya_id IN (${placeholders}) GROUP BY karya_id`
      )
      .all(...karyaIds) as { karya_id: string; n: number }[];
    for (const r of rows) map[r.karya_id] = r.n;
    return map;
  }

  /** Like counts for many karya in one query, keyed by karya_id. */
  likeCountsForMany(karyaIds: string[]): Record<string, number> {
    const map: Record<string, number> = {};
    if (karyaIds.length === 0) return map;
    const placeholders = karyaIds.map(() => "?").join(",");
    const rows = this.db
      .query(
        `SELECT karya_id, COUNT(*) AS n FROM likes WHERE karya_id IN (${placeholders}) GROUP BY karya_id`
      )
      .all(...karyaIds) as { karya_id: string; n: number }[];
    for (const r of rows) map[r.karya_id] = r.n;
    return map;
  }
}