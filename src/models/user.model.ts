import { randomUUID } from "crypto";
import type { Database } from "bun:sqlite";

export type UserRole = "member" | "admin";
export type UserStatus = "active" | "suspended";

export type PublicUser = {
  id: string;
  username: string;
  full_name: string | null;
  bio: string | null;
  avatar_path: string | null;
  role: UserRole;
  status: UserStatus;
};

/** Row shape for the admin user list (includes moderation columns). */
export type AdminUserRow = PublicUser & {
  created_at: string;
  suspended_at: string | null;
  suspended_reason: string | null;
  karya_count: number;
};

/**
 * Precomputed argon2 hash of a random password, used only to keep
 * `verifyPassword` timing constant when the username does not exist.
 */
const DUMMY_HASH =
  "$argon2id$v=19$m=65536,t=2,p=1$wlQas72+XrrSOA60slXZnFgVs9NupG2G8D0Hn9AAogw$8yFIZ3q5XU+vLlU7CbQINxFqH1TyCD7hEW+dB1irSP8";

/** Model: users table — app auth. */
export class UserModel {
  constructor(private db: Database) {}

  /** Find full user (incl. password_hash) by username — for login. */
  findByUsername(username: string) {
    return this.db
      .query("SELECT id, username, password_hash, role, status FROM users WHERE username = ?")
      .get(username) as
      | {
          id: string;
          username: string;
          password_hash: string;
          role: UserRole;
          status: UserStatus;
        }
      | null;
  }

  /** True if a username is taken, ignoring case ("Admin" matches "admin"). */
  usernameExists(username: string): boolean {
    const row = this.db
      .query("SELECT 1 FROM users WHERE lower(username) = lower(?)")
      .get(username);
    return row !== null;
  }

  /** Public user data by id (no password). */
  findPublic(id: string): PublicUser | null {
    return this.db
      .query(
        "SELECT id, username, full_name, bio, avatar_path, role, status FROM users WHERE id = ?"
      )
      .get(id) as PublicUser | null;
  }

  /** Public user data by username (for profile page). */
  findByUsernamePublic(username: string): PublicUser | null {
    return this.db
      .query(
        "SELECT id, username, full_name, bio, avatar_path, role, status FROM users WHERE username = ?"
      )
      .get(username) as PublicUser | null;
  }

  /** Update profile fields (full name, bio). */
  updateProfile(id: string, data: { fullName: string; bio: string }) {
    this.db
      .query("UPDATE users SET full_name = ?, bio = ? WHERE id = ?")
      .run(data.fullName || null, data.bio || null, id);
  }

  /** Replace avatar path (returns the previous path for file cleanup). */
  setAvatar(id: string, path: string | null): string | null {
    const row = this.db
      .query("SELECT avatar_path FROM users WHERE id = ?")
      .get(id) as { avatar_path: string | null } | null;
    this.db.query("UPDATE users SET avatar_path = ? WHERE id = ?").run(path, id);
    return row?.avatar_path ?? null;
  }

  /** Register: hash password, save user, return id. */
  async create(
    username: string,
    password: string,
    fullName?: string
  ): Promise<string> {
    const id = randomUUID();
    const hash = await Bun.password.hash(password);
    this.db
      .query(
        "INSERT INTO users (id, username, full_name, password_hash) VALUES (?, ?, ?, ?)"
      )
      .run(id, username, fullName ?? null, hash);
    return id;
  }

  // --- admin / moderation ---

  /** Role + status only (cheap lookup for middleware). */
  findAccess(id: string): { role: UserRole; status: UserStatus } | null {
    return this.db
      .query("SELECT role, status FROM users WHERE id = ?")
      .get(id) as { role: UserRole; status: UserStatus } | null;
  }

  /** True when the user exists and has role = 'admin'. */
  isAdmin(id: string): boolean {
    const row = this.findAccess(id);
    return row?.role === "admin";
  }

  /** True when the user is active (not suspended). */
  isActive(id: string): boolean {
    const row = this.findAccess(id);
    return row?.status === "active";
  }

  /** Admin list: every user with karya count, newest first. */
  listForAdmin(filter?: { status?: UserStatus; q?: string }): AdminUserRow[] {
    const where: string[] = [];
    const params: string[] = [];
    if (filter?.status) {
      where.push("u.status = ?");
      params.push(filter.status);
    }
    if (filter?.q) {
      where.push("(u.username LIKE ? OR u.full_name LIKE ?)");
      params.push(`%${filter.q}%`, `%${filter.q}%`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    return this.db
      .query(
        `SELECT u.id, u.username, u.full_name, u.bio, u.avatar_path, u.role, u.status,
                u.created_at, u.suspended_at, u.suspended_reason,
                (SELECT COUNT(*) FROM karya k WHERE k.user_id = u.id) AS karya_count
         FROM users u
         ${whereSql}
         ORDER BY u.created_at DESC`
      )
      .all(...params) as AdminUserRow[];
  }

  /** Admin detail by id (includes moderation columns). */
  findForAdmin(id: string): AdminUserRow | null {
    return this.db
      .query(
        `SELECT u.id, u.username, u.full_name, u.bio, u.avatar_path, u.role, u.status,
                u.created_at, u.suspended_at, u.suspended_reason,
                (SELECT COUNT(*) FROM karya k WHERE k.user_id = u.id) AS karya_count
         FROM users u WHERE u.id = ?`
      )
      .get(id) as AdminUserRow | null;
  }

  /** Suspend a user: blocks login and hides their published works. */
  suspend(id: string, reason: string) {
    this.db
      .query(
        "UPDATE users SET status = 'suspended', suspended_at = datetime('now'), suspended_reason = ? WHERE id = ?"
      )
      .run(reason || null, id);
  }

  /** Reactivate a suspended user. */
  reactivate(id: string) {
    this.db
      .query(
        "UPDATE users SET status = 'active', suspended_at = NULL, suspended_reason = NULL WHERE id = ?"
      )
      .run(id);
  }

  /** Promote to admin or demote to member. */
  setRole(id: string, role: UserRole) {
    this.db.query("UPDATE users SET role = ? WHERE id = ?").run(role, id);
  }

  /** Find a user id by username (CLI helper). */
  idByUsername(username: string): string | null {
    const row = this.db
      .query("SELECT id FROM users WHERE lower(username) = lower(?)")
      .get(username) as { id: string } | null;
    return row?.id ?? null;
  }

  /** Verify login: return userId if password matches, null otherwise. */
  async verifyPassword(
    username: string,
    password: string
  ): Promise<string | null> {
    const row = this.findByUsername(username);
    // Always run a verify (even for unknown users) against a dummy hash so the
    // response time doesn't reveal whether the username exists (timing attack).
    const hash = row?.password_hash ?? DUMMY_HASH;
    const ok = await Bun.password.verify(password, hash);
    return row && ok ? row.id : null;
  }
}