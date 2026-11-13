import { randomUUID } from "crypto";
import type { Database } from "bun:sqlite";

export type PublicUser = {
  id: string;
  username: string;
  full_name: string | null;
  bio: string | null;
};

/** Model: users table — app auth. */
export class UserModel {
  constructor(private db: Database) {}

  /** Find full user (incl. password_hash) by username — for login. */
  findByUsername(username: string) {
    return this.db
      .query("SELECT id, username, password_hash FROM users WHERE username = ?")
      .get(username) as { id: string; username: string; password_hash: string } | null;
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
      .query("SELECT id, username, full_name, bio FROM users WHERE id = ?")
      .get(id) as PublicUser | null;
  }

  /** Public user data by username (for profile page). */
  findByUsernamePublic(username: string): PublicUser | null {
    return this.db
      .query("SELECT id, username, full_name, bio FROM users WHERE username = ?")
      .get(username) as PublicUser | null;
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

  /** Verify login: return userId if password matches, null otherwise. */
  async verifyPassword(
    username: string,
    password: string
  ): Promise<string | null> {
    const row = this.findByUsername(username);
    if (!row) return null;
    const ok = await Bun.password.verify(password, row.password_hash);
    return ok ? row.id : null;
  }
}