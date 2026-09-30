import "server-only";

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { parsePlayerImport } from "@/lib/import";
import { photoUrlFrom } from "@/lib/photos";
import { REG_BUCKET } from "./registration";
import { basePriceFor } from "@/lib/rules";
import { GRADES, PLAYER_ROLES, POOLS, type Me, type PoolConfig, type Role } from "@/lib/types";

// Every write in the app is one of these actions. /api/actions/[action]
// checks `roles` against the caller's server-resolved role before `run` is
// called, and validates the body against `input`. `run` uses the
// service-role client, so nothing here may trust client-supplied identity.

export class ActionError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

interface Ctx {
  me: Me & { email: string };
  db: SupabaseClient;
}

interface ActionDef<S extends z.ZodType> {
  roles: Exclude<Role, "viewer">[];
  input: S;
  run: (ctx: Ctx, input: z.infer<S>) => Promise<unknown>;
}

function action<S extends z.ZodType>(def: ActionDef<S>): ActionDef<S> {
  return def;
}

function fromPostgrest(error: PostgrestError): ActionError {
  if (error.code === "P0001") return new ActionError(409, error.hint || "rejected", error.message);
  if (error.code === "23505") return new ActionError(409, "duplicate", "That already exists");
  if (error.code === "23503") return new ActionError(409, "in_use", "It is still referenced by other records");
  if (error.code === "23514") return new ActionError(400, "invalid", "A value is out of range");
  console.error("Database error", error);
  return new ActionError(500, "db_error", "Database error");
}

async function rpc<T = unknown>(db: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw fromPostgrest(error);
  return data as T;
}

async function must<T>(p: PromiseLike<{ data: T; error: PostgrestError | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw fromPostgrest(error);
  return data;
}

async function mustOne<T>(p: PromiseLike<{ data: T | null; error: PostgrestError | null }>): Promise<T> {
  const data = await must(p);
  if (data === null) throw new ActionError(404, "not_found", "Not found");
  return data;
}

async function audit(db: SupabaseClient, actor: string, act: string, details: Record<string, unknown>) {
  await db.from("audit_log").insert({ actor, action: act, details });
}

const uuid = z.uuid();
const pool = z.enum(POOLS);
const money = z.number().int().min(0).max(10_000_000);
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Colour must look like #1a2b3c");
const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email());

const playerFields = z.object({
  name: z.string().trim().min(1).max(80),
  pool,
  role: z.enum(PLAYER_ROLES),
  grade: z.enum(GRADES),
  batting_style: optText(40),
  bowling_style: optText(40),
  base_price: money.nullish(),
  notes: optText(500),
  details: z
    .array(z.object({ label: z.string().trim().min(1).max(60), value: z.string().trim().min(1).max(300) }))
    .max(20)
    .optional(),
  // A pasted image or Google Drive link (uploads use /api/admin/photo).
  photo_link: z.string().trim().max(500).nullish(),
});

async function poolConfig(db: SupabaseClient, p: string): Promise<PoolConfig> {
  return mustOne<PoolConfig>(db.from("pool_config").select("*").eq("pool", p).single());
}

export const actions = {
  // ---- Bidding --------------------------------------------------------------
  "bid.place": action({
    roles: ["owner", "admin"],
    input: z.object({ playerId: uuid, amount: money, teamId: uuid.optional() }),
    run: ({ me, db }, i) => {
      // Owners always bid for their own team, whatever the request says.
      const teamId = me.role === "owner" ? me.teamId : i.teamId;
      if (!teamId) throw new ActionError(400, "team_required", "Choose a team");
      return rpc(db, "auction_place_bid", {
        p_actor: me.email,
        p_actor_role: me.role,
        p_actor_team: me.teamId,
        p_team_id: teamId,
        p_player_id: i.playerId,
        p_amount: i.amount,
      });
    },
  }),
  "bid.undo": action({
    roles: ["admin"],
    input: z.object({}),
    run: ({ me, db }) => rpc(db, "auction_undo_bid", { p_actor: me.email }),
  }),

  // ---- Running the auction ---------------------------------------------------
  "auction.spin": action({
    roles: ["admin"],
    input: z.object({ durationMs: z.number().int().min(1000).max(15000).default(6000) }),
    run: ({ me, db }, i) => rpc(db, "auction_spin", { p_actor: me.email, p_duration_ms: i.durationMs }),
  }),
  "auction.select": action({
    roles: ["admin"],
    input: z.object({ playerId: uuid }),
    run: ({ me, db }, i) => rpc(db, "auction_select_player", { p_actor: me.email, p_player_id: i.playerId }),
  }),
  "auction.openBidding": action({
    roles: ["admin"],
    input: z.object({}),
    run: ({ me, db }) => rpc(db, "auction_open_bidding", { p_actor: me.email }),
  }),
  "auction.sell": action({
    roles: ["admin"],
    input: z.object({ playerId: uuid }),
    run: ({ me, db }, i) => rpc(db, "auction_sell", { p_actor: me.email, p_player_id: i.playerId }),
  }),
  "auction.unsold": action({
    roles: ["admin"],
    input: z.object({ playerId: uuid }),
    run: ({ me, db }, i) => rpc(db, "auction_mark_unsold", { p_actor: me.email, p_player_id: i.playerId }),
  }),
  "auction.returnToPool": action({
    roles: ["admin"],
    input: z.object({}),
    run: ({ me, db }) => rpc(db, "auction_return_to_pool", { p_actor: me.email }),
  }),
  "auction.undoResult": action({
    roles: ["admin"],
    input: z.object({}),
    run: ({ me, db }) => rpc(db, "auction_undo_result", { p_actor: me.email }),
  }),
  "auction.setPool": action({
    roles: ["admin"],
    input: z.object({ pool }),
    run: ({ me, db }, i) => rpc(db, "auction_set_pool", { p_actor: me.email, p_pool: i.pool }),
  }),
  "auction.advanceRound": action({
    roles: ["admin"],
    input: z.object({ pool }),
    run: ({ me, db }, i) => rpc(db, "auction_advance_round", { p_actor: me.email, p_pool: i.pool }),
  }),
  "auction.assign": action({
    roles: ["admin"],
    input: z.object({ playerId: uuid, teamId: uuid, price: money }),
    run: ({ me, db }, i) =>
      rpc(db, "auction_assign_player", {
        p_actor: me.email,
        p_player_id: i.playerId,
        p_team_id: i.teamId,
        p_price: i.price,
      }),
  }),
  "auction.reset": action({
    roles: ["admin"],
    input: z.object({ confirm: z.literal("RESET") }),
    run: ({ me, db }) => rpc(db, "auction_reset", { p_actor: me.email }),
  }),

  // ---- Players ---------------------------------------------------------------
  "player.create": action({
    roles: ["admin"],
    input: playerFields,
    run: async ({ me, db }, i) => {
      const cfg = await poolConfig(db, i.pool);
      const { photo_link, ...fields } = i;
      const row = {
        ...fields,
        base_price: i.base_price ?? basePriceFor(cfg, i.grade),
        ...(photo_link ? { photo_url: photoUrlFrom(photo_link) } : {}),
      };
      const player = await must(db.from("players").insert(row).select().single());
      await audit(db, me.email, "create_player", { player_id: player.id, name: i.name });
      return player;
    },
  }),
  "player.update": action({
    roles: ["admin"],
    input: playerFields.partial().extend({ id: uuid }),
    run: async ({ me, db }, { id, ...fields }) => {
      const current = await must(db.from("players").select("status, pool").eq("id", id).maybeSingle());
      if (!current) throw new ActionError(404, "not_found", "Player not found");
      if (fields.pool && fields.pool !== current.pool && current.status === "sold") {
        throw new ActionError(409, "player_sold", "Can't move a sold player to another pool");
      }
      const { photo_link, ...rest } = fields;
      const patch: Record<string, unknown> = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
      if (patch.base_price === null) delete patch.base_price;
      if (photo_link) {
        const url = photoUrlFrom(photo_link);
        if (!url) throw new ActionError(400, "bad_photo", "Photo link must be an https image or Google Drive link");
        patch.photo_url = url;
      }
      const player = await must(db.from("players").update(patch).eq("id", id).select().single());
      await audit(db, me.email, "update_player", { player_id: id, fields: Object.keys(patch) });
      return player;
    },
  }),
  "player.delete": action({
    roles: ["admin"],
    input: z.object({ id: uuid }),
    run: ({ me, db }, i) => rpc(db, "admin_delete_player", { p_actor: me.email, p_player_id: i.id }),
  }),
  "player.removePhoto": action({
    roles: ["admin"],
    input: z.object({ id: uuid }),
    run: async ({ me, db }, i) => {
      const player = await mustOne<{ photo_url: string | null }>(db.from("players").select("photo_url").eq("id", i.id).maybeSingle());
      await must(db.from("players").update({ photo_url: null }).eq("id", i.id).select("id").single());
      await removeStoredPhoto(db, player.photo_url);
      await audit(db, me.email, "remove_photo", { player_id: i.id });
      return null;
    },
  }),
  "player.import": action({
    roles: ["admin"],
    input: z.object({ text: z.string().max(200_000), pool, dryRun: z.boolean().default(false) }),
    run: async ({ me, db }, i) => {
      const parsed = parsePlayerImport(i.text, i.pool);
      if (parsed.players.length > 500) throw new ActionError(400, "too_many", "Import at most 500 players at once");
      const configs = new Map<string, PoolConfig>();
      for (const p of new Set(parsed.players.map((x) => x.pool))) configs.set(p, await poolConfig(db, p));
      const rows = parsed.players.map((p) => ({
        ...p,
        base_price: p.base_price ?? basePriceFor(configs.get(p.pool)!, p.grade),
      }));
      if (i.dryRun || parsed.errors.length > 0 || rows.length === 0) {
        return { imported: 0, preview: rows, errors: parsed.errors, columns: parsed.columns };
      }
      await must(db.from("players").insert(rows).select("id"));
      await audit(db, me.email, "import_players", { count: rows.length });
      return { imported: rows.length, preview: rows, errors: [], columns: parsed.columns };
    },
  }),
  "player.applyBasePrices": action({
    roles: ["admin"],
    input: z.object({ pool }),
    run: ({ me, db }, i) => rpc(db, "admin_apply_base_prices", { p_actor: me.email, p_pool: i.pool }),
  }),

  // ---- Teams & settings ------------------------------------------------------
  "team.create": action({
    roles: ["admin"],
    input: z.object({
      name: z.string().trim().min(1).max(40),
      short_name: z.string().trim().min(1).max(5),
      color,
      sort_order: z.number().int().default(0),
    }),
    run: async ({ me, db }, i) => {
      const team = await must(db.from("teams").insert(i).select().single());
      await audit(db, me.email, "create_team", { team_id: team.id, name: i.name });
      return team;
    },
  }),
  "team.update": action({
    roles: ["admin"],
    input: z.object({
      id: uuid,
      name: z.string().trim().min(1).max(40).optional(),
      short_name: z.string().trim().min(1).max(5).optional(),
      color: color.optional(),
      sort_order: z.number().int().optional(),
    }),
    run: async ({ me, db }, { id, ...patch }) => {
      const team = await must(db.from("teams").update(patch).eq("id", id).select().single());
      await audit(db, me.email, "update_team", { team_id: id, fields: Object.keys(patch) });
      return team;
    },
  }),
  "team.delete": action({
    roles: ["admin"],
    input: z.object({ id: uuid }),
    run: ({ me, db }, i) => rpc(db, "admin_delete_team", { p_actor: me.email, p_team_id: i.id }),
  }),
  "team.limits": action({
    roles: ["admin"],
    input: z.object({
      teamId: uuid,
      pool,
      purse: money.nullable(),
      min_squad: z.number().int().min(0).max(100).nullable(),
      max_squad: z.number().int().min(1).max(100).nullable(),
    }),
    run: async ({ me, db }, { teamId, pool: p, ...limits }) => {
      if (limits.min_squad !== null && limits.max_squad !== null && limits.max_squad < limits.min_squad) {
        throw new ActionError(400, "invalid", "Max squad must be at least min squad");
      }
      const row = await must(
        db.from("team_pool_limits").upsert({ team_id: teamId, pool: p, ...limits }).select().single(),
      );
      await audit(db, me.email, "team_limits", { team_id: teamId, pool: p, ...limits });
      return row;
    },
  }),
  "pool.update": action({
    roles: ["admin"],
    input: z
      .object({
        pool,
        label: z.string().trim().min(1).max(30),
        purse: money,
        min_squad: z.number().int().min(0).max(100),
        max_squad: z.number().int().min(1).max(100),
        base_price_a: money,
        base_price_b: money,
        base_price_c: money,
        increment_tiers: z
          .array(z.object({ from: money, step: z.number().int().min(1).max(1_000_000) }))
          .min(1)
          .max(20),
      })
      .refine((v) => v.max_squad >= v.min_squad, { message: "Max squad must be at least min squad" }),
    run: async ({ me, db }, { pool: p, ...cfg }) => {
      const tiers = [...cfg.increment_tiers].sort((a, b) => a.from - b.from);
      if (tiers[0].from !== 0) tiers.unshift({ from: 0, step: tiers[0].step });
      const row = await must(
        db.from("pool_config").update({ ...cfg, increment_tiers: tiers }).eq("pool", p).select().single(),
      );
      await audit(db, me.email, "pool_config", { pool: p, ...cfg });
      return row;
    },
  }),

  // ---- Registrations ---------------------------------------------------------
  "registration.approve": action({
    roles: ["admin"],
    input: z.object({ id: uuid, grade: z.enum(GRADES), basePrice: money.nullish() }),
    run: async ({ me, db }, i) => {
      const reg = await mustOne<{ photo_path: string; status: string }>(
        db.from("registrations").select("photo_path, status").eq("id", i.id).maybeSingle(),
      );
      if (reg.status !== "pending") throw new ActionError(409, "not_pending", `Registration is already ${reg.status}`);
      // Copy the private photo into the public player-photos bucket.
      let photoUrl: string | null = null;
      let copiedPath: string | null = null;
      const file = await db.storage.from(REG_BUCKET).download(reg.photo_path);
      if (file.data) {
        const ext = reg.photo_path.split(".").pop() ?? "jpg";
        copiedPath = `reg-${i.id}/${Date.now()}.${ext}`;
        const up = await db.storage
          .from(PHOTO_BUCKET)
          .upload(copiedPath, await file.data.arrayBuffer(), { contentType: file.data.type || "image/jpeg", cacheControl: "31536000" });
        if (!up.error) photoUrl = db.storage.from(PHOTO_BUCKET).getPublicUrl(copiedPath).data.publicUrl;
      }
      try {
        return await rpc(db, "admin_approve_registration", {
          p_actor: me.email,
          p_id: i.id,
          p_grade: i.grade,
          p_base_price: i.basePrice ?? null,
          p_photo_url: photoUrl,
        });
      } catch (e) {
        if (copiedPath) await db.storage.from(PHOTO_BUCKET).remove([copiedPath]);
        throw e;
      }
    },
  }),
  "registration.setStatus": action({
    roles: ["admin"],
    input: z.object({ id: uuid, status: z.enum(["pending", "rejected"]) }),
    run: async ({ me, db }, i) => {
      const row = await mustOne(
        db
          .from("registrations")
          .update({ status: i.status, reviewed_by: me.email, reviewed_at: new Date().toISOString() })
          .eq("id", i.id)
          .neq("status", "approved")
          .select("id")
          .maybeSingle(),
      );
      await audit(db, me.email, "registration_status", { id: i.id, status: i.status });
      return row;
    },
  }),
  "registration.delete": action({
    roles: ["admin"],
    input: z.object({ id: uuid }),
    run: async ({ me, db }, i) => {
      const reg = await mustOne<{ photo_path: string; receipt_path: string | null }>(
        db.from("registrations").delete().eq("id", i.id).select("photo_path, receipt_path").maybeSingle(),
      );
      await db.storage.from(REG_BUCKET).remove([reg.photo_path, ...(reg.receipt_path ? [reg.receipt_path] : [])]);
      await audit(db, me.email, "registration_delete", { id: i.id });
      return null;
    },
  }),
  "registration.settings": action({
    roles: ["admin"],
    input: z.object({
      is_open: z.boolean(),
      title: z.string().trim().min(1).max(80),
      intro: z.string().trim().max(2000),
      payment_instructions: z.string().trim().max(1000),
      receipt_required: z.boolean(),
      availability_question: z.string().trim().min(1).max(150),
      availability_options: z.array(z.string().trim().min(1).max(60)).max(20),
      declaration_text: z.string().trim().min(1).max(2000),
    }),
    run: async ({ me, db }, i) => {
      const row = await must(db.from("registration_settings").upsert({ id: 1, ...i }).select().single());
      await audit(db, me.email, "registration_settings", { is_open: i.is_open });
      return row;
    },
  }),

  // ---- Owner mappings --------------------------------------------------------
  "owner.upsert": action({
    roles: ["admin"],
    input: z.object({ email, teamId: uuid, label: optText(60) }),
    run: async ({ me, db }, i) => {
      const row = await must(
        db
          .from("owners")
          .upsert({ email: i.email, team_id: i.teamId, label: i.label })
          .select()
          .single(),
      );
      await audit(db, me.email, "owner_upsert", { email: i.email, team_id: i.teamId });
      return row;
    },
  }),
  "owner.delete": action({
    roles: ["admin"],
    input: z.object({ email }),
    run: async ({ me, db }, i) => {
      await must(db.from("owners").delete().eq("email", i.email).select("email"));
      await audit(db, me.email, "owner_delete", { email: i.email });
      return null;
    },
  }),
} satisfies Record<string, ActionDef<z.ZodType>>;

export type ActionName = keyof typeof actions;
export type ActionInput<N extends ActionName> = z.input<(typeof actions)[N]["input"]>;

export const PHOTO_BUCKET = "player-photos";

export async function removeStoredPhoto(db: SupabaseClient, url: string | null | undefined) {
  const marker = `/${PHOTO_BUCKET}/`;
  if (!url || !url.includes(marker)) return;
  const path = url.slice(url.indexOf(marker) + marker.length).split("?")[0];
  await db.storage.from(PHOTO_BUCKET).remove([path]);
}
