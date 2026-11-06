import { describe, expect, test } from "bun:test";
import { UserModel } from "../src/models/user.model";
import { createTestDb } from "./helpers";

describe("UserModel", () => {
  test("create + verifyPassword benar → return userId", async () => {
    const db = createTestDb();
    const users = new UserModel(db);

    const id = await users.create("fajar", "rahasia123", "Fajar Ramadhan");
    expect(await users.verifyPassword("fajar", "rahasia123")).toBe(id);
  });

  test("verifyPassword salah → null", async () => {
    const db = createTestDb();
    const users = new UserModel(db);
    await users.create("fajar", "rahasia123");

    expect(await users.verifyPassword("fajar", "salah")).toBeNull();
    expect(await users.verifyPassword("siapa", "rahasia123")).toBeNull();
  });

  test("verifyPassword tetap jalankan hash untuk user tak ada (anti timing leak)", async () => {
    const db = createTestDb();
    const users = new UserModel(db);
    await users.create("fajar", "rahasia123");

    const t0 = performance.now();
    await users.verifyPassword("fajar", "salah");
    const known = performance.now() - t0;

    const t1 = performance.now();
    await users.verifyPassword("tidak-ada-user", "salah");
    const unknown = performance.now() - t1;

    expect(await users.verifyPassword("tidak-ada-user", "salah")).toBeNull();
    // unknown-user path must also pay the argon2 cost (not an instant return).
    // generous bound to avoid flakiness on slow CI.
    expect(unknown).toBeGreaterThan(known * 0.2);
  });

  test("findByUsername mendeteksi username duplikat", async () => {
    const db = createTestDb();
    const users = new UserModel(db);
    await users.create("fajar", "rahasia123");

    expect(users.findByUsername("fajar")).not.toBeNull();
    expect(users.findByUsername("orang-lain")).toBeNull();
  });

  test("findPublic tidak membocorkan password_hash", async () => {
    const db = createTestDb();
    const users = new UserModel(db);

    const id = await users.create("fajar", "rahasia123");
    const pub = users.findPublic(id) as Record<string, unknown>;
    expect(pub.username).toBe("fajar");
    expect(pub.password_hash).toBeUndefined();
  });
});
