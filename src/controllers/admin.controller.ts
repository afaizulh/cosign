import { Hono } from "hono";
import type { Context } from "hono";
import type { Db } from "../db";
import { UserModel, type UserStatus } from "../models/user.model";
import { KaryaModel } from "../models/karya.model";
import { CommentModel } from "../models/comment.model";
import { ModerationModel } from "../models/moderation.model";
import { requireAdmin } from "../middleware/admin.middleware";
import { view, redirect, flashSuccess, flashError, type AppEnv } from "../view";
import { withComposition } from "../composition";

/**
 * Admin controller (mounted at /admin): moderation & management.
 * All mutations are form POST + redirect (PRG) — no JSON API.
 */
export function adminController(db: Db) {
  const app = new Hono<AppEnv>();

  if (!db.sqlite) {
    app.all("*", (c) => c.text("supabase mode not implemented", 501));
    return app;
  }

  const users = new UserModel(db.sqlite);
  const karya = new KaryaModel(db.sqlite);
  const comments = new CommentModel(db.sqlite);
  const log = new ModerationModel(db.sqlite);

  app.use("*", requireAdmin(db));

  /** Role of the admin performing the request. */
  function actorRole(c: Context<AppEnv>): "admin" | "superadmin" {
    return users.isSuperAdmin(c.get("userId") as string) ? "superadmin" : "admin";
  }

  /**
   * Who may moderate whom:
   *   - nobody touches their own account
   *   - a superadmin can act on members and admins
   *   - an admin can act on members only
   *   - a superadmin account can never be touched from the panel (CLI only)
   */
  function canActOn(
    c: Context<AppEnv>,
    target: { id: string; role: "member" | "admin" | "superadmin" }
  ): { ok: true } | { ok: false; message: string } {
    if (target.id === c.get("userId")) {
      return { ok: false, message: "You cannot moderate your own account." };
    }
    if (target.role === "superadmin") {
      return {
        ok: false,
        message: "Superadmin accounts can only be changed from the CLI (bun run admin:revoke).",
      };
    }
    if (target.role === "admin" && actorRole(c) !== "superadmin") {
      return { ok: false, message: "Only a superadmin can moderate another admin." };
    }
    return { ok: true };
  }

  /** Rows per page in the admin tables (kept small enough to scan). */
  const PER_PAGE = 12;

  /** Parse ?page= safely and clamp it to the available range. */
  function pager(c: Context<AppEnv>, total: number) {
    const pages = Math.max(1, Math.ceil(total / PER_PAGE));
    const raw = Number.parseInt(c.req.query("page") ?? "1", 10);
    const page = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), pages) : 1;
    return {
      page,
      pages,
      total,
      perPage: PER_PAGE,
      offset: (page - 1) * PER_PAGE,
      from: total === 0 ? 0 : (page - 1) * PER_PAGE + 1,
      to: Math.min(page * PER_PAGE, total),
    };
  }

  // GET /admin — dashboard
  app.get("/", (c) => {
    const allUsers = users.listForAdmin();
    const allKarya = karya.listForAdmin();
    const counts = {
      users: allUsers.length,
      suspended: allUsers.filter((u) => u.status === "suspended").length,
      admins: allUsers.filter((u) => u.role === "admin").length,
      works: allKarya.length,
      takenDown: allKarya.filter((k) => k.status === "taken_down").length,
      comments: comments.countAll(),
    };
    return view(c, "admin/dashboard", {
      counts,
      actorRole: actorRole(c),
      recentLog: log.recent(8),
      recentTakedowns: allKarya.filter((k) => k.status === "taken_down").slice(0, 5),
    });
  });

  // GET /admin/works — all works with status filter
  app.get("/works", (c) => {
    const status = c.req.query("status") ?? "";
    const q = c.req.query("q")?.trim() ?? "";
    const filter = {
      status: status === "taken_down" || status === "published" ? status : undefined,
      q: q || undefined,
    };
    const meta = pager(c, karya.countForAdmin(filter));
    const rows = karya.listForAdminPage(filter, PER_PAGE, meta.offset);
    return view(c, "admin/works/index", {
      karya: rows,
      aktif: status,
      q,
      meta,
    });
  });

  // GET /admin/works/:id — preview + moderation panel
  app.get("/works/:id", (c) => {
    const item = karya.findById(c.req.param("id")!);
    if (!item) {
      flashError(c, "Work not found.");
      return redirect(c, "/admin/works");
    }
    const rows = withComposition([item], karya) as Array<
      Record<string, unknown> & { parts: Record<string, string>; like_count: number }
    >;
    const withComp = rows[0];
    return view(c, "admin/works/show", {
      karya: withComp,
      raw: item,
      author: users.findForAdmin(item.user_id),
      history: log.forTarget("karya", item.id),
      comments: comments.byKarya(item.id),
    });
  });

  // POST /admin/works/:id/takedown — soft delete with a reason
  app.post("/works/:id/takedown", async (c) => {
    const id = c.req.param("id")!;
    const item = karya.findById(id);
    if (!item) {
      flashError(c, "Work not found.");
      return redirect(c, "/admin/works");
    }
    const body = await c.req.parseBody();
    const reason = String(body.reason ?? "").trim();
    if (!reason) {
      flashError(c, "A reason is required to take a work down.");
      return redirect(c, `/admin/works/${id}`);
    }
    karya.takedown(id, c.get("userId") as string, reason);
    log.log({
      adminId: c.get("userId") as string,
      action: "karya.takedown",
      targetType: "karya",
      targetId: id,
      reason,
    });
    flashSuccess(c, `"${item.judul}" is now hidden from the public site.`);
    return redirect(c, `/admin/works/${id}`);
  });

  // POST /admin/works/:id/restore — undo a takedown
  app.post("/works/:id/restore", (c) => {
    const id = c.req.param("id")!;
    const item = karya.findById(id);
    if (!item) {
      flashError(c, "Work not found.");
      return redirect(c, "/admin/works");
    }
    karya.restore(id);
    log.log({
      adminId: c.get("userId") as string,
      action: "karya.restore",
      targetType: "karya",
      targetId: id,
    });
    flashSuccess(c, `"${item.judul}" is public again.`);
    return redirect(c, `/admin/works/${id}`);
  });

  // GET /admin/users — all accounts with status filter
  app.get("/users", (c) => {
    const status = c.req.query("status") ?? "";
    const q = c.req.query("q")?.trim() ?? "";
    const filter = {
      status: status === "active" || status === "suspended" ? (status as UserStatus) : undefined,
      q: q || undefined,
    };
    const meta = pager(c, users.countForAdmin(filter));
    const rows = users.listForAdminPage(filter, PER_PAGE, meta.offset);
    return view(c, "admin/users/index", {
      users: rows,
      aktif: status,
      q,
      meta,
      actorRole: actorRole(c),
    });
  });

  // GET /admin/users/:id — account detail + moderation panel
  app.get("/users/:id", (c) => {
    const target = users.findForAdmin(c.req.param("id")!);
    if (!target) {
      flashError(c, "User not found.");
      return redirect(c, "/admin/users");
    }
    return view(c, "admin/users/show", {
      target,
      actorRole: actorRole(c),
      isSelf: target.id === c.get("userId"),
      works: karya.listForAdmin().filter((k) => k.user_id === target.id),
      history: log.forTarget("user", target.id),
    });
  });

  // POST /admin/users/:id/suspend — deactivate + kill all sessions
  app.post("/users/:id/suspend", async (c) => {
    const id = c.req.param("id")!;
    const target = users.findForAdmin(id);
    if (!target) {
      flashError(c, "User not found.");
      return redirect(c, "/admin/users");
    }
    const allowed = canActOn(c, target);
    if (!allowed.ok) {
      flashError(c, allowed.message);
      return redirect(c, `/admin/users/${id}`);
    }
    const body = await c.req.parseBody();
    const reason = String(body.reason ?? "").trim();
    if (!reason) {
      flashError(c, "A reason is required to suspend an account.");
      return redirect(c, `/admin/users/${id}`);
    }
    users.suspend(id, reason);
    // Suspension is immediate: drop every session so no tab stays logged in.
    db.sqlite!.query("DELETE FROM sessions WHERE user_id = ?").run(id);
    log.log({
      adminId: c.get("userId") as string,
      action: "user.suspend",
      targetType: "user",
      targetId: id,
      reason,
    });
    flashSuccess(c, `@${target.username} is suspended. Their works are hidden.`);
    return redirect(c, `/admin/users/${id}`);
  });

  // POST /admin/users/:id/reactivate
  app.post("/users/:id/reactivate", (c) => {
    const id = c.req.param("id")!;
    const target = users.findForAdmin(id);
    if (!target) {
      flashError(c, "User not found.");
      return redirect(c, "/admin/users");
    }
    const allowed = canActOn(c, target);
    if (!allowed.ok) {
      flashError(c, allowed.message);
      return redirect(c, `/admin/users/${id}`);
    }
    users.reactivate(id);
    log.log({
      adminId: c.get("userId") as string,
      action: "user.reactivate",
      targetType: "user",
      targetId: id,
    });
    flashSuccess(c, `@${target.username} is active again.`);
    return redirect(c, `/admin/users/${id}`);
  });

  // POST /admin/users/:id/role — superadmin only
  app.post("/users/:id/role", async (c) => {
    const id = c.req.param("id")!;
    const target = users.findForAdmin(id);
    if (!target) {
      flashError(c, "User not found.");
      return redirect(c, "/admin/users");
    }
    if (id === c.get("userId")) {
      flashError(c, "You cannot change your own role.");
      return redirect(c, `/admin/users/${id}`);
    }
    if (actorRole(c) !== "superadmin") {
      flashError(c, "Only a superadmin can change roles.");
      return redirect(c, `/admin/users/${id}`);
    }
    if (target.role === "superadmin") {
      flashError(c, "Superadmin accounts can only be changed from the CLI (bun run admin:revoke).");
      return redirect(c, `/admin/users/${id}`);
    }
    const body = await c.req.parseBody();
    const role = String(body.role ?? "");
    if (role !== "admin" && role !== "member") {
      flashError(c, "Invalid role.");
      return redirect(c, `/admin/users/${id}`);
    }
    users.setRole(id, role);
    log.log({
      adminId: c.get("userId") as string,
      action: role === "admin" ? "user.promote" : "user.demote",
      targetType: "user",
      targetId: id,
    });
    flashSuccess(
      c,
      role === "admin" ? `@${target.username} is now an admin.` : `@${target.username} is now a member.`
    );
    return redirect(c, `/admin/users/${id}`);
  });

  // GET /admin/log — audit trail (paginated, filter by admin & action)
  app.get("/log", (c) => {
    const adminFilter = c.req.query("admin") ?? "";
    const action = c.req.query("action") ?? "";
    const filter = {
      admin: adminFilter || undefined,
      action: action || undefined,
    };
    const meta = pager(c, log.count(filter));
    const entries = log.list(filter, PER_PAGE, meta.offset);
    return view(c, "admin/log", {
      entries,
      meta,
      aktifAdmin: adminFilter,
      aktifAction: action,
      adminOptions: log.adminOptions(),
      actionOptions: log.actionOptions(),
    });
  });

  return app;
}
