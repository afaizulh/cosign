import type { Database } from "bun:sqlite";

/** Model: follows table — social graph + personal feed. */
export class FollowModel {
  constructor(private db: Database) {}

  /** Whether followerId follows followeeId. */
  isFollowing(followerId: string, followeeId: string): boolean {
    return !!this.db
      .query("SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?")
      .get(followerId, followeeId);
  }

  /** Toggle follow: return true if now following, false if unfollowed. */
  toggle(followerId: string, followeeId: string): boolean {
    if (this.isFollowing(followerId, followeeId)) {
      this.db
        .query("DELETE FROM follows WHERE follower_id = ? AND followee_id = ?")
        .run(followerId, followeeId);
      return false;
    }
    this.db
      .query("INSERT INTO follows (follower_id, followee_id) VALUES (?, ?)")
      .run(followerId, followeeId);
    return true;
  }

  /** Number of users following this user. */
  followerCount(userId: string): number {
    const row = this.db
      .query("SELECT COUNT(*) AS n FROM follows WHERE followee_id = ?")
      .get(userId) as { n: number };
    return row.n;
  }

  /** Number of users this user follows. */
  followingCount(userId: string): number {
    const row = this.db
      .query("SELECT COUNT(*) AS n FROM follows WHERE follower_id = ?")
      .get(userId) as { n: number };
    return row.n;
  }

  /** Works from active creators the user follows, newest first. */
  feed(userId: string) {
    return this.db
      .query(
        `SELECT k.*, u.username, COUNT(l.user_id) AS like_count
         FROM follows f
         JOIN karya k ON k.user_id = f.followee_id
         JOIN users u ON u.id = k.user_id
         LEFT JOIN likes l ON l.karya_id = k.id
         WHERE f.follower_id = ? AND k.status = 'published' AND u.status = 'active'
         GROUP BY k.id
         ORDER BY k.created_at DESC`
      )
      .all(userId);
  }
}
