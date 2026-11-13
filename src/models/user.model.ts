import { randomUUID } from "crypto";
import type { Database } from "bun:sqlite";

export type PublicUser = {
  id: string;
  username: string;
  full_name: string | null;
  bio: string | null;
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
    // Always run a verify (even for unknown users) against a dummy hash so the
    // response time doesn't reveal whether the username exists (timing attack).
    const hash = row?.password_hash ?? DUMMY_HASH;
    const ok = await Bun.password.verify(password, hash);
    return row && ok ? row.id : null;
  }
}