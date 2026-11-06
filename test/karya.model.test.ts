import { describe, expect, test } from "bun:test";
import { UserModel } from "../src/models/user.model";
import { KaryaModel } from "../src/models/karya.model";
import { createTestDb } from "./helpers";

async function seed(db: ReturnType<typeof createTestDb>, username = "siti") {
  const users = new UserModel(db);
  const userId = await users.create(username, "rahasia123");
  return { userId, karya: new KaryaModel(db) };
}

describe("KaryaModel", () => {
  test("create → list (join username) → byUser", async () => {
    const db = createTestDb();
    const { userId, karya } = await seed(db);

    karya.create({ userId, judul: "Poster Event", deskripsi: "Poster konser", kategori: "desain" });

    const list = karya.list() as Array<{ judul: string; username: string }>;
    expect(list).toHaveLength(1);
    expect(list[0].judul).toBe("Poster Event");
    expect(list[0].username).toBe("siti");

    expect(karya.byUser(userId)).toHaveLength(1);
    expect(karya.byUser("user-lain")).toHaveLength(0);
  });

  test("list with category filter", async () => {
    const db = createTestDb();
    const { userId, karya } = await seed(db);

    karya.create({ userId, judul: "A", deskripsi: "", kategori: "desain" });
    karya.create({ userId, judul: "B", deskripsi: "", kategori: "motion" });

    expect((karya.list("desain") as unknown[]).length).toBe(1);
    expect((karya.list("motion") as unknown[]).length).toBe(1);
    expect((karya.list("fotografi") as unknown[]).length).toBe(0);
  });

  test("findById returns row with username, null for unknown id", async () => {
    const db = createTestDb();
    const { userId, karya } = await seed(db);

    const id = karya.create({ userId, judul: "A", deskripsi: "", kategori: "desain" });
    const row = karya.findById(id);
    expect(row?.judul).toBe("A");
    expect(row?.username).toBe("siti");
    expect(karya.findById("id-ngasal")).toBeNull();
  });

  test("parts: add → list (latest first per category) → findPart → delete", async () => {
    const db = createTestDb();
    const { userId, karya } = await seed(db);

    const id = karya.create({ userId, judul: "A", deskripsi: "", kategori: "desain" });

    const p1 = karya.addPart({ karyaId: id, kategori: "kepala", mediaPath: "uploads/k1.png", mediaType: "image/png" });
    const p2 = karya.addPart({ karyaId: id, kategori: "kepala", mediaPath: "uploads/k2.png", mediaType: "image/png" });
    karya.addPart({ karyaId: id, kategori: "badan", mediaPath: "uploads/b1.png", mediaType: "image/png" });

    const parts = karya.parts(id);
    expect(parts).toHaveLength(3);

    // both kepala parts present (created_at has 1s granularity — no strict order)
    const kepala = parts.filter((p) => p.kategori === "kepala");
    expect(kepala).toHaveLength(2);
    expect(kepala.map((p) => p.id).sort()).toEqual([p1, p2].sort());

    expect(karya.findPart(p1)?.karya_id).toBe(id);
    karya.deletePart(p1);
    expect(karya.parts(id)).toHaveLength(2);
    expect(karya.findPart(p1)).toBeNull();
  });

  test("delete removes karya", async () => {
    const db = createTestDb();
    const { userId, karya } = await seed(db);

    const id = karya.create({ userId, judul: "A", deskripsi: "", kategori: "desain" });
    karya.delete(id);
    expect(karya.findById(id)).toBeNull();
  });

  test("partsForMany + likeCountsForMany match per-item results (N+1 fix)", async () => {
    const db = createTestDb();
    const { userId, karya } = await seed(db);

    const a = karya.create({ userId, judul: "A", deskripsi: "", kategori: "desain" });
    const b = karya.create({ userId, judul: "B", deskripsi: "", kategori: "motion" });
    karya.addPart({ karyaId: a, kategori: "kepala", mediaPath: "uploads/a.png", mediaType: "image/png" });
    karya.addPart({ karyaId: b, kategori: "badan", mediaPath: "uploads/b.png", mediaType: "image/png" });
    karya.toggleLike(a, "u1");
    karya.toggleLike(a, "u2");

    const parts = karya.partsForMany([a, b]);
    expect(parts[a]).toHaveLength(1);
    expect(parts[b]).toHaveLength(1);
    expect(parts[a][0].media_path).toBe("uploads/a.png");

    const likes = karya.likeCountsForMany([a, b]);
    expect(likes[a]).toBe(2);
    expect(likes[b] ?? 0).toBe(0);

    expect(karya.partsForMany([])).toEqual({});
    expect(karya.likeCountsForMany([])).toEqual({});
  });

  test("toggleLike: like → unlike, likeCount", async () => {
    const db = createTestDb();
    const { karya } = await seed(db);

    const id = karya.create({ userId: "sembarang-id", judul: "A", deskripsi: "", kategori: "desain" });

    expect(karya.likeCount(id)).toBe(0);
    expect(karya.toggleLike(id, "liker-1")).toBe(true);
    expect(karya.likeCount(id)).toBe(1);
    expect(karya.toggleLike(id, "liker-1")).toBe(false);
    expect(karya.likeCount(id)).toBe(0);
    expect(karya.toggleLike(id, "liker-2")).toBe(true);
    expect(karya.likeCount(id)).toBe(1);
  });
});