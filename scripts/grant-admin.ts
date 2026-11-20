import { env } from "bun";
import { Database } from "bun:sqlite";
import { migrate } from "../src/db";
import { UserModel } from "../src/models/user.model";

/**
 * Grant (or revoke) the admin role from the command line.
 *
 *   bun run admin:grant <username>     → promote to admin
 *   bun run admin:revoke <username>    → demote to member
 *
 * The first admin has to be created this way: there is no self-service path,
 * which keeps a public deploy from bootstrapping an admin by accident.
 */
const [command, username] = process.argv.slice(2);

if (!username || !command || !["grant", "revoke"].includes(command)) {
  console.error("Usage: bun run admin:grant <username> | bun run admin:revoke <username>");
  process.exit(1);
}

const db = new Database(env.DB_FILE || "data/app.db", { create: true });
migrate(db);

const users = new UserModel(db);
const id = users.idByUsername(username);

if (!id) {
  console.error(`✖ User "${username}" not found. Register the account first, then run this again.`);
  process.exit(1);
}

const role = command === "grant" ? "admin" : "member";
users.setRole(id, role);
console.log(`✔ @${username} is now ${role}.`);
db.close();
