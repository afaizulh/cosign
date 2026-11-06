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

  test("usernameExists abaikan kapital", async () => {
    const db = createTestDb();
    const users = new UserModel(db);
    await users.create("fajar", "rahasia123");

    expect(users.usernameExists("fajar")).toBe(true);
    expect(users.usernameExists("Fajar")).toBe(true);
    expect(users.usernameExists("FAJAR")).toBe(true);
    expect(users.usernameExists("fajar2")).toBe(false);
  });
});
