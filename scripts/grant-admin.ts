import { env } from "bun";
import { Database } from "bun:sqlite";
import { migrate } from "../src/db";
import { UserModel } from "../src/models/user.model";

/**
 * Manage privileged roles from the command line.
 *
 *   bun run admin:grant <username>       → admin
 *   bun run superadmin:grant <username>  → superadmin (highest role)
 *   bun run admin:revoke <username>      → member
 *
 * Privileged accounts can only be created/removed here — there is no
 * self-service path, and a superadmin account cannot be changed from the
 * admin panel at all.
 */
const [command, username] = process.argv.slice(2);

const USAGE = [
  "Usage:",
  "  bun run admin:grant <username>       → role admin",
  "  bun run superadmin:grant <username>  → role superadmin",
  "  bun run admin:revoke <username>      → role member",
].join("\n");

if (!username || !command || !["grant", "revoke", "superadmin"].includes(command)) {
  console.error(USAGE);
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

const role = command === "grant" ? "admin" : command === "superadmin" ? "superadmin" : "member";
users.setRole(id, role);
console.log(`✔ @${username} is now ${role}.`);
db.close();
