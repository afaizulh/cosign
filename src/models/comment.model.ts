import { randomUUID } from "crypto";
import type { Database } from "bun:sqlite";

export type Comment = {
  id: string;
  karya_id: string;
  user_id: string;
  body: string;
  created_at: string;
};

export type CommentWithAuthor = Comment & {
  username: string;
  avatar_path: string | null;
};

/** Model: comments table — discussion on a karya. */
export class CommentModel {
  constructor(private db: Database) {}

  /** List comments of one karya (oldest first) with author info. */
  byKarya(karyaId: string): CommentWithAuthor[] {
    return this.db
      .query(
        `SELECT c.*, u.username, u.avatar_path
         FROM comments c
         JOIN users u ON u.id = c.user_id
         WHERE c.karya_id = ?
         ORDER BY c.created_at ASC, c.id ASC`
      )
      .all(karyaId) as CommentWithAuthor[];
  }

  /** Add a comment, return id. */
  create(karyaId: string, userId: string, body: string): string {
    const id = randomUUID();
    this.db
      .query("INSERT INTO comments (id, karya_id, user_id, body) VALUES (?, ?, ?, ?)")
      .run(id, karyaId, userId, body);
    return id;
  }

  /** Find one comment (for delete permission check). */
  findById(id: string): Comment | null {
    return this.db.query("SELECT * FROM comments WHERE id = ?").get(id) as Comment | null;
  }

  /** Delete one comment. */
  delete(id: string) {
    this.db.query("DELETE FROM comments WHERE id = ?").run(id);
  }

  /** Delete every comment on a karya (when the karya is deleted). */
  deleteByKarya(karyaId: string) {
    this.db.query("DELETE FROM comments WHERE karya_id = ?").run(karyaId);
  }
}
