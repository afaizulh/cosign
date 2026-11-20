import { randomUUID } from "crypto";
import type { Database } from "bun:sqlite";

export type ModerationAction =
  | "karya.takedown"
  | "karya.restore"
  | "user.suspend"
  | "user.reactivate"
  | "user.promote"
  | "user.demote";

export type ModerationEntry = {
  id: string;
  admin_id: string;
  admin_username: string;
  action: ModerationAction;
  target_type: "karya" | "user";
  target_id: string;
  reason: string | null;
  created_at: string;
};

/** Model: moderation_log — audit trail for every admin action. */
export class ModerationModel {
  constructor(private db: Database) {}

  /** Append one entry. Never throws for a missing admin row (FK not enforced). */
  log(data: {
    adminId: string;
    action: ModerationAction;
    targetType: "karya" | "user";
    targetId: string;
    reason?: string | null;
  }) {
    this.db
      .query(
        `INSERT INTO moderation_log (id, admin_id, action, target_type, target_id, reason)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        data.adminId,
        data.action,
        data.targetType,
        data.targetId,
        data.reason?.trim() || null
      );
  }

  /** Recent entries, newest first (admin log page). */
  recent(limit = 100): ModerationEntry[] {
    return this.db
      .query(
        `SELECT m.*, COALESCE(u.username, '(deleted)') AS admin_username
         FROM moderation_log m
         LEFT JOIN users u ON u.id = m.admin_id
         ORDER BY m.created_at DESC, m.rowid DESC
         LIMIT ?`
      )
      .all(limit) as ModerationEntry[];
  }

  /** Entries for one target (shown on the karya/user detail pages). */
  forTarget(targetType: "karya" | "user", targetId: string): ModerationEntry[] {
    return this.db
      .query(
        `SELECT m.*, COALESCE(u.username, '(deleted)') AS admin_username
         FROM moderation_log m
         LEFT JOIN users u ON u.id = m.admin_id
         WHERE m.target_type = ? AND m.target_id = ?
         ORDER BY m.created_at DESC, m.rowid DESC`
      )
      .all(targetType, targetId) as ModerationEntry[];
  }

  /** Count per action — dashboard summary. */
  counts(): Record<string, number> {
    const rows = this.db
      .query("SELECT action, COUNT(*) AS n FROM moderation_log GROUP BY action")
      .all() as Array<{ action: string; n: number }>;
    const out: Record<string, number> = {};
    for (const r of rows) out[r.action] = r.n;
    return out;
  }
}
