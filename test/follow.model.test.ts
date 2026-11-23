import { describe, expect, test } from "bun:test";
import { UserModel } from "../src/models/user.model";
import { KaryaModel } from "../src/models/karya.model";
import { FollowModel } from "../src/models/follow.model";
import { createTestDb } from "./helpers";

describe("FollowModel", () => {
  test("toggle follow, isFollowing, follower/following counts", async () => {
    const db = createTestDb();
    const users = new UserModel(db);
    const follows = new FollowModel(db);
    const alice = await users.create("alice", "rahasia123");
    const bob = await users.create("bob", "rahasia123");

    expect(follows.isFollowing(alice, bob)).toBe(false);
    expect(follows.toggle(alice, bob)).toBe(true);
    expect(follows.isFollowing(alice, bob)).toBe(true);
    expect(follows.followerCount(bob)).toBe(1);
    expect(follows.followingCount(alice)).toBe(1);
    expect(follows.followerCount(alice)).toBe(0);

    expect(follows.toggle(alice, bob)).toBe(false);
    expect(follows.isFollowing(alice, bob)).toBe(false);
    expect(follows.followerCount(bob)).toBe(0);
  });

  test("feed only returns works from followed creators", async () => {
    const db = createTestDb();
    const users = new UserModel(db);
    const karya = new KaryaModel(db);
    const follows = new FollowModel(db);
    const fan = await users.create("fan", "rahasia123");
    const followed = await users.create("followed", "rahasia123");
    const stranger = await users.create("stranger", "rahasia123");

    karya.create({ userId: followed, judul: "Followed Work", deskripsi: "", kategori: "design" });
    karya.create({ userId: stranger, judul: "Stranger Work", deskripsi: "", kategori: "design" });
    karya.create({ userId: fan, judul: "Own Work", deskripsi: "", kategori: "design" });

    follows.toggle(fan, followed);
    const feed = follows.feed(fan) as Array<{ judul: string; username: string }>;
    expect(feed).toHaveLength(1);
    expect(feed[0].judul).toBe("Followed Work");
    expect(feed[0].username).toBe("followed");

    follows.toggle(fan, followed);
    expect(follows.feed(fan)).toHaveLength(0);
  });
});
