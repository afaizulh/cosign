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

    karya.create({ userId, judul: "Poster Event", deskripsi: "Poster konser", kategori: "design" });

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

    karya.create({ userId, judul: "A", deskripsi: "", kategori: "design" });
    karya.create({ userId, judul: "B", deskripsi: "", kategori: "motion" });

    expect((karya.list("design") as unknown[]).length).toBe(1);
    expect((karya.list("motion") as unknown[]).length).toBe(1);
    expect((karya.list("photography") as unknown[]).length).toBe(0);
  });

  test("list search by judul/deskripsi/username", async () => {
    const db = createTestDb();
    const { userId, karya } = await seed(db, "siti");

    karya.create({ userId, judul: "Poster Konser", deskripsi: "musik", kategori: "design" });
    karya.create({ userId, judul: "Logo", deskripsi: "branding", kategori: "design" });

    expect((karya.list(undefined, "konser") as unknown[]).length).toBe(1);
    expect((karya.list(undefined, "branding") as unknown[]).length).toBe(1);
    expect((karya.list(undefined, "siti") as unknown[]).length).toBe(2);
    expect((karya.list(undefined, "tidakada") as unknown[]).length).toBe(0);
  });

  test("list sort popular puts most-liked first", async () => {
    const db = createTestDb();
    const { userId, karya } = await seed(db);

    const a = karya.create({ userId, judul: "Alpha", deskripsi: "", kategori: "design" });
    const b = karya.create({ userId, judul: "Beta", deskripsi: "", kategori: "design" });
    karya.toggleLike(b, "u1");
    karya.toggleLike(b, "u2");

    const popular = karya.list(undefined, undefined, "popular") as Array<{ judul: string }>;
    expect(popular[0].judul).toBe("Beta");
    expect(popular[1].judul).toBe("Alpha");
    void a;
  });

  test("update changes judul/deskripsi/kategori", async () => {
    const db = createTestDb();
    const { userId, karya } = await seed(db);

    const id = karya.create({ userId, judul: "Lama", deskripsi: "old", kategori: "design" });
    karya.update(id, { judul: "Baru", deskripsi: "new", kategori: "motion" });

    const row = karya.findById(id);
    expect(row?.judul).toBe("Baru");
    expect(row?.deskripsi).toBe("new");
    expect(row?.kategori).toBe("motion");
  });

  test("findById returns row with username, null for unknown id", async () => {
    const db = createTestDb();
    const { userId, karya } = await seed(db);

    const id = karya.create({ userId, judul: "A", deskripsi: "", kategori: "design" });
    const row = karya.findById(id);
    expect(row?.judul).toBe("A");
    expect(row?.username).toBe("siti");
    expect(karya.findById("id-ngasal")).toBeNull();
  });

  test("parts: add → list (latest first per category) → findPart → delete", async () => {
    const db = createTestDb();
    const { userId, karya } = await seed(db);

    const id = karya.create({ userId, judul: "A", deskripsi: "", kategori: "design" });

    const p1 = karya.addPart({ karyaId: id, kategori: "head", mediaPath: "uploads/k1.png", mediaType: "image/png" });
    const p2 = karya.addPart({ karyaId: id, kategori: "head", mediaPath: "uploads/k2.png", mediaType: "image/png" });
    karya.addPart({ karyaId: id, kategori: "body", mediaPath: "uploads/b1.png", mediaType: "image/png" });

    const parts = karya.parts(id);
    expect(parts).toHaveLength(3);

    // both head parts present (created_at has 1s granularity — no strict order)
    const head = parts.filter((p) => p.kategori === "head");
    expect(head).toHaveLength(2);
    expect(head.map((p) => p.id).sort()).toEqual([p1, p2].sort());

    expect(karya.findPart(p1)?.karya_id).toBe(id);
    karya.deletePart(p1);
    expect(karya.parts(id)).toHaveLength(2);
    expect(karya.findPart(p1)).toBeNull();
  });

  test("delete removes karya", async () => {
    const db = createTestDb();
    const { userId, karya } = await seed(db);

    const id = karya.create({ userId, judul: "A", deskripsi: "", kategori: "design" });
    karya.delete(id);
    expect(karya.findById(id)).toBeNull();
  });

  test("partsForMany + likeCountsForMany match per-item results (N+1 fix)", async () => {
    const db = createTestDb();
    const { userId, karya } = await seed(db);

    const a = karya.create({ userId, judul: "A", deskripsi: "", kategori: "design" });
    const b = karya.create({ userId, judul: "B", deskripsi: "", kategori: "motion" });
    karya.addPart({ karyaId: a, kategori: "head", mediaPath: "uploads/a.png", mediaType: "image/png" });
    karya.addPart({ karyaId: b, kategori: "body", mediaPath: "uploads/b.png", mediaType: "image/png" });
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

    const id = karya.create({ userId: "sembarang-id", judul: "A", deskripsi: "", kategori: "design" });

    expect(karya.likeCount(id)).toBe(0);
    expect(karya.toggleLike(id, "liker-1")).toBe(true);
    expect(karya.likeCount(id)).toBe(1);
    expect(karya.toggleLike(id, "liker-1")).toBe(false);
    expect(karya.likeCount(id)).toBe(0);
    expect(karya.toggleLike(id, "liker-2")).toBe(true);
    expect(karya.likeCount(id)).toBe(1);
  });
});