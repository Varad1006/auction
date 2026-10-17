// Integration tests for the SQL auction functions and access rules.
// Needs a local Postgres: TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres
// (a fresh "auction_test" database is created from the migrations).
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const ADMIN_URL = process.env.TEST_DATABASE_URL;
const DB_NAME = "auction_test";

type Row = Record<string, unknown>;

describe.skipIf(!ADMIN_URL)("auction database", () => {
  let pool: pg.Pool;
  let teams: { id: string; name: string }[];

  async function q<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
    const res = await pool.query(sql, params);
    return res.rows as T[];
  }

  async function state() {
    return (await q("select * from auction_state where id = 1"))[0];
  }

  async function errorOf(p: Promise<unknown>): Promise<{ hint?: string; message: string }> {
    try {
      await p;
    } catch (e) {
      return e as { hint?: string; message: string };
    }
    throw new Error("expected an error");
  }

  const bid = (teamId: string, playerId: string, amount: number, role = "admin", actorTeam: string | null = null) =>
    q("select * from auction_place_bid($1, $2, $3, $4, $5, $6)", [
      "test@example.com", role, actorTeam, teamId, playerId, amount,
    ]);

  async function addPlayer(name: string, pool: "men" | "women" = "men", base = 20) {
    const rows = await q<{ id: string }>(
      "insert into players (name, pool, role, grade, base_price) values ($1, $2, 'Batter', 'C', $3) returning id",
      [name, pool, base],
    );
    return rows[0].id;
  }

  async function putOnBlock(playerId: string) {
    await q("select auction_select_player('a', $1)", [playerId]);
    await q("select auction_open_bidding('a')");
  }

  beforeAll(() => {
    execFileSync("bash", ["scripts/db-local.sh", DB_NAME], {
      env: { ...process.env, DATABASE_URL: ADMIN_URL },
      stdio: "pipe",
    });
    pool = new pg.Pool({ connectionString: ADMIN_URL!.replace(/\/[^/]*$/, `/${DB_NAME}`), max: 20 });
    // Hosted Supabase loads pg-safeupdate for API requests (UPDATE/DELETE
    // need a WHERE clause). Emulate it when the extension can be loaded, e.g.
    // TEST_DATABASE_URL=postgres://supabase_admin:postgres@127.0.0.1:54322/postgres
    // (the database from `supabase start`).
    pool.on("connect", (c) => {
      c.query("load 'safeupdate'").catch(() => {});
    });
  });

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    await q("select auction_reset('test')");
    await q("delete from players where true");
    await q("update pool_config set purse = 1000, min_squad = 8, max_squad = 12, base_price_a = 50, base_price_b = 30, base_price_c = 20, increment_tiers = '[{\"from\":0,\"step\":5}]' where pool = 'men'");
    await q("update team_pool_limits set purse = null, min_squad = null, max_squad = null where true");
    await q("update auction_state set current_pool = 'men' where id = 1");
    teams = await q("select id, name from teams order by sort_order");
  });

  describe("access rules", () => {
    async function asRole<T>(role: string, fn: (c: pg.PoolClient) => Promise<T>) {
      const c = await pool.connect();
      try {
        await c.query("begin");
        await c.query(`set local role ${role}`);
        return await fn(c);
      } finally {
        await c.query("rollback");
        c.release();
      }
    }

    it("lets anon and authenticated read public tables", async () => {
      await addPlayer("Reader Test");
      for (const role of ["anon", "authenticated"]) {
        const rows = await asRole(role, (c) => c.query("select name from players"));
        expect(rows.rows).toHaveLength(1);
        await asRole(role, (c) => c.query("select * from auction_state, teams, bids, results, pool_config, team_pool_limits"));
      }
    });

    it.each(["anon", "authenticated"])("blocks %s from every write and private table", async (role) => {
      const playerId = await addPlayer("Write Test");
      const denied = [
        "insert into players (name, pool, role, grade, base_price) values ('x', 'men', 'Batter', 'C', 1)",
        `update players set sold_price = 1 where id = '${playerId}'`,
        `delete from players where id = '${playerId}'`,
        "update auction_state set current_bid = 999 where id = 1",
        "insert into bids (player_id, pool, round, team_id, amount, placed_by_role) select id, 'men', 1, (select id from teams limit 1), 5, 'admin' from players limit 1",
        "update pool_config set purse = 1 where pool = 'men'",
        "update teams set name = 'hacked' where true",
        "select * from owners",
        "insert into owners (email, team_id) select 'x@y.z', id from teams limit 1",
        "select * from user_sessions",
        "select * from audit_log",
        "select auction_sell('x', gen_random_uuid())",
        "select auction_place_bid('x', 'admin', null, gen_random_uuid(), gen_random_uuid(), 1)",
        "select auction_reset('x')",
        "select admin_delete_player('x', gen_random_uuid())",
        "select admin_delete_team('x', gen_random_uuid())",
        "select * from player_insights",
        `insert into player_insights (player_id, summary) values ('${playerId}', 'x')`,
        "select * from past_prices",
        "select * from ai_status",
        "select claim_insight_notes(array[]::uuid[], 0)",
        "insert into past_prices (season, pool, name, price) values (1, 'men', 'x', 1)",
        "select admin_sign_player('x', gen_random_uuid(), gen_random_uuid(), 'star', 0)",
        "select admin_set_waitlist('x', gen_random_uuid(), true)",
      ];
      for (const sql of denied) {
        const err = await errorOf(asRole(role, (c) => c.query(sql)));
        expect(err.message, sql).toMatch(/permission denied/);
      }
    });
  });

  describe("bidding rules", () => {
    it("runs spin -> bid -> sell and updates derived purse", async () => {
      const p1 = await addPlayer("Alpha");
      await addPlayer("Beta");
      const spun = (await q("select * from auction_spin('a', 3000)"))[0];
      expect(spun.phase).toBe("spinning");
      expect(spun.spin_candidates).toHaveLength(2);
      expect(spun.spin_candidates).toContain(spun.current_player_id);

      await q("select auction_select_player('a', $1)", [p1]);
      await q("select auction_open_bidding('a')");
      await bid(teams[0].id, p1, 20);
      await bid(teams[1].id, p1, 25);
      await bid(teams[0].id, p1, 40); // jump bids are allowed
      const s = await state();
      expect(s).toMatchObject({ current_bid: 40, leading_team_id: teams[0].id, bid_count: 3 });

      await q("select auction_sell('a', $1)", [p1]);
      const player = (await q("select * from players where id = $1", [p1]))[0];
      expect(player).toMatchObject({ status: "sold", sold_team_id: teams[0].id, sold_price: 40, decided_round: 1 });
      const st = (await q("select * from team_pool_status($1, 'men')", [teams[0].id]))[0];
      expect(st).toMatchObject({ purse: 1000, spent: 40, squad_count: 1 });
      expect((await state()).phase).toBe("sold");
    });

    it("rejects low bids, self-outbids and stale players", async () => {
      const p1 = await addPlayer("Gamma", "men", 30);
      const p2 = await addPlayer("Delta");
      await putOnBlock(p1);
      expect((await errorOf(bid(teams[0].id, p1, 25))).hint).toBe("too_low");
      await bid(teams[0].id, p1, 30);
      expect((await errorOf(bid(teams[1].id, p1, 30))).hint).toBe("outbid");
      expect((await errorOf(bid(teams[1].id, p1, 34))).hint).toBe("too_low");
      expect((await errorOf(bid(teams[0].id, p1, 35))).hint).toBe("already_leading");
      expect((await errorOf(bid(teams[1].id, p2, 35))).hint).toBe("stale");
    });

    it("stops owners bidding for another team", async () => {
      const p1 = await addPlayer("Owner Test");
      await putOnBlock(p1);
      expect((await errorOf(bid(teams[1].id, p1, 20, "owner", teams[0].id))).hint).toBe("forbidden");
      expect((await errorOf(bid(teams[1].id, p1, 20, "viewer", null))).hint).toBe("forbidden");
      await bid(teams[0].id, p1, 20, "owner", teams[0].id);
    });

    it("rejects bids when bidding is not open", async () => {
      const p1 = await addPlayer("Closed");
      await q("select auction_select_player('a', $1)", [p1]);
      expect((await errorOf(bid(teams[0].id, p1, 20))).hint).toBe("not_bidding");
    });

    it("enforces max squad size", async () => {
      await q("update team_pool_limits set max_squad = 1, min_squad = 0 where team_id = $1 and pool = 'men'", [teams[0].id]);
      const p1 = await addPlayer("First");
      const p2 = await addPlayer("Second");
      await putOnBlock(p1);
      await bid(teams[0].id, p1, 20);
      await q("select auction_sell('a', $1)", [p1]);
      await putOnBlock(p2);
      expect((await errorOf(bid(teams[0].id, p2, 20))).hint).toBe("squad_full");
    });

    it("enforces the purse and the minimum-squad reserve", async () => {
      // purse 100, min squad 3, cheapest base 20 -> must keep 2*20 = 40 for the
      // two remaining slots, so the first buy can be at most 60.
      await q("update team_pool_limits set purse = 100, min_squad = 3 where team_id = $1 and pool = 'men'", [teams[0].id]);
      const p1 = await addPlayer("Reserve");
      await putOnBlock(p1);
      await bid(teams[1].id, p1, 55);
      expect((await errorOf(bid(teams[0].id, p1, 65))).hint).toBe("reserve");
      await bid(teams[0].id, p1, 60);
      expect((await errorOf(bid(teams[0].id, p1, 105))).hint).toBe("already_leading");
      await bid(teams[1].id, p1, 65);
      expect((await errorOf(bid(teams[0].id, p1, 150))).hint).toBe("insufficient_purse");
    });

    it("uses tiered increments", async () => {
      await q(`update pool_config set increment_tiers = '[{"from":0,"step":5},{"from":100,"step":20}]' where pool = 'men'`);
      const p1 = await addPlayer("Tiered");
      await putOnBlock(p1);
      await bid(teams[0].id, p1, 95);
      await bid(teams[1].id, p1, 100);
      expect((await errorOf(bid(teams[0].id, p1, 110))).hint).toBe("too_low");
      await bid(teams[0].id, p1, 120);
    });
  });

  describe("undo", () => {
    it("undoes the last bid and restores the previous leader", async () => {
      const p1 = await addPlayer("Undo Bid");
      await putOnBlock(p1);
      await bid(teams[0].id, p1, 20);
      await bid(teams[1].id, p1, 25);
      await q("select auction_undo_bid('a')");
      expect(await state()).toMatchObject({ current_bid: 20, leading_team_id: teams[0].id, bid_count: 1 });
      await q("select auction_undo_bid('a')");
      expect(await state()).toMatchObject({ current_bid: null, leading_team_id: null, bid_count: 0 });
      expect((await errorOf(q("select auction_undo_bid('a')"))).hint).toBe("nothing_to_undo");
      const bids = await q("select voided_at from bids where player_id = $1", [p1]);
      expect(bids).toHaveLength(2); // soft-voided, not deleted
      expect(bids.every((b) => b.voided_at !== null)).toBe(true);
    });

    it("undoes a sale: player back on the block with the last bid restored", async () => {
      const p1 = await addPlayer("Undo Sale");
      await putOnBlock(p1);
      await bid(teams[0].id, p1, 20);
      await bid(teams[1].id, p1, 30);
      await q("select auction_sell('a', $1)", [p1]);
      await q("select auction_undo_result('a')");
      expect(await state()).toMatchObject({
        phase: "bidding", current_player_id: p1, current_bid: 30, leading_team_id: teams[1].id, bid_count: 2,
      });
      const player = (await q("select * from players where id = $1", [p1]))[0];
      expect(player).toMatchObject({ status: "pool", sold_team_id: null, sold_price: null });
      const results = await q("select undone_at from results");
      expect(results).toHaveLength(1);
      expect(results[0].undone_at).not.toBeNull();
      // Bidding continues from the restored state.
      await bid(teams[0].id, p1, 35);
    });

    it("undoes an unsold result", async () => {
      const p1 = await addPlayer("Undo Unsold");
      await putOnBlock(p1);
      await q("select auction_mark_unsold('a', $1)", [p1]);
      expect((await q("select status from players where id = $1", [p1]))[0].status).toBe("unsold");
      await q("select auction_undo_result('a')");
      expect(await state()).toMatchObject({ phase: "bidding", current_player_id: p1, bid_count: 0 });
    });

    it("refuses to undo a result while another player has bids", async () => {
      const p1 = await addPlayer("Sold One");
      const p2 = await addPlayer("On Block");
      await putOnBlock(p1);
      await bid(teams[0].id, p1, 20);
      await q("select auction_sell('a', $1)", [p1]);
      await putOnBlock(p2);
      await bid(teams[1].id, p2, 20);
      expect((await errorOf(q("select auction_undo_result('a')"))).hint).toBe("block_busy");
      // Nothing changed.
      expect((await q("select status from players where id = $1", [p1]))[0].status).toBe("sold");
    });

    it("cannot mark unsold with active bids", async () => {
      const p1 = await addPlayer("Has Bids");
      await putOnBlock(p1);
      await bid(teams[0].id, p1, 20);
      expect((await errorOf(q("select auction_mark_unsold('a', $1)", [p1]))).hint).toBe("has_bids");
    });
  });

  describe("rounds", () => {
    it("carries unsold players into the next round and the wheel skips decided players", async () => {
      const sold = await addPlayer("Sold");
      const unsold = await addPlayer("Unsold");
      const waiting = await addPlayer("Waiting");
      await putOnBlock(sold);
      await bid(teams[0].id, sold, 20);
      await q("select auction_sell('a', $1)", [sold]);
      await putOnBlock(unsold);
      await q("select auction_mark_unsold('a', $1)", [unsold]);

      for (let i = 0; i < 10; i++) {
        const s = (await q("select * from auction_spin('a')"))[0];
        expect(s.spin_candidates).toEqual([waiting]);
        expect(s.current_player_id).toBe(waiting);
      }
      expect((await errorOf(q("select auction_advance_round('a', 'men')"))).hint).toBe("block_busy");
      await q("select auction_mark_unsold('a', $1)", [waiting]);

      await q("select auction_advance_round('a', 'men')");
      expect((await q("select current_round from pool_config where pool = 'men'"))[0].current_round).toBe(2);
      const pool = await q("select id from players where status = 'pool' order by name");
      expect(pool.map((p) => p.id).sort()).toEqual([unsold, waiting].sort());
      // Round-1 results can no longer be undone.
      expect((await errorOf(q("select auction_undo_result('a')"))).hint).toBe("round_advanced");
    });

    it("will not advance while players remain in the pool", async () => {
      await addPlayer("Still Here");
      expect((await errorOf(q("select auction_advance_round('a', 'men')"))).hint).toBe("pool_not_empty");
    });
  });

  describe("admin edits", () => {
    it("protects sold and on-block players from deletion", async () => {
      const sold = await addPlayer("Sold Delete");
      const onBlock = await addPlayer("Block Delete");
      const free = await addPlayer("Free Delete");
      await putOnBlock(sold);
      await bid(teams[0].id, sold, 20);
      await q("select auction_sell('a', $1)", [sold]);
      expect((await errorOf(q("select admin_delete_player('a', $1)", [sold]))).hint).toBe("player_sold");
      await putOnBlock(onBlock);
      expect((await errorOf(q("select admin_delete_player('a', $1)", [onBlock]))).hint).toBe("on_block");
      await q("select admin_delete_player('a', $1)", [free]);
      expect(await q("select id from players where id = $1", [free])).toHaveLength(0);
    });

    it("refuses to delete a team that bought players", async () => {
      const p1 = await addPlayer("Team Delete");
      await putOnBlock(p1);
      await bid(teams[5].id, p1, 20);
      await q("select auction_sell('a', $1)", [p1]);
      expect((await errorOf(q("select admin_delete_team('a', $1)", [teams[5].id]))).hint).toBe("team_has_players");
      await q("select auction_undo_result('a')");
      expect((await errorOf(q("select admin_delete_team('a', $1)", [teams[5].id]))).hint).toBe("team_bidding");
    });

    it("applies grade base prices to undecided players only", async () => {
      const sold = await addPlayer("Keep Price", "men", 99);
      const waiting = await addPlayer("New Price", "men", 99);
      await putOnBlock(sold);
      await bid(teams[0].id, sold, 99);
      await q("select auction_sell('a', $1)", [sold]);
      const n = (await q<{ n: number }>("select admin_apply_base_prices('a', 'men') as n"))[0].n;
      expect(n).toBe(1);
      expect((await q("select base_price from players where id = $1", [waiting]))[0].base_price).toBe(20);
      expect((await q("select base_price from players where id = $1", [sold]))[0].base_price).toBe(99);
    });

    it("deletes every player for a fresh start, but not mid-bidding", async () => {
      const sold = await addPlayer("Fresh Sold");
      const waiting = await addPlayer("Fresh Waiting");
      await putOnBlock(sold);
      await bid(teams[0].id, sold, 20);
      expect((await errorOf(q("select admin_delete_all_players('a')"))).hint).toBe("block_busy");
      await q("select auction_sell('a', $1)", [sold]);
      await q("insert into wishlist (team_id, player_id, added_by) values ($1, $2, 'o')", [teams[1].id, waiting]);
      const reg = await q<{ id: string }>(
        `insert into registrations (full_name, email, phone, flat_number, age, gender, role, photo_path, declaration, status, player_id)
         values ('Reg', 'reg@example.com', '9999999999', 'A-1', 30, 'men', 'Batter', 'x/photo.jpg', true, 'approved', $1) returning id`,
        [waiting],
      );
      const n = (await q<{ n: number }>("select admin_delete_all_players('a') as n"))[0].n;
      expect(n).toBe(2);
      for (const table of ["players", "bids", "results", "wishlist"]) {
        expect(await q(`select 1 from ${table}`)).toHaveLength(0);
      }
      const s = await state();
      expect(s.phase).toBe("idle");
      expect(s.current_player_id).toBeNull();
      const r = (await q("select status, player_id from registrations where id = $1", [reg[0].id]))[0];
      expect(r).toEqual({ status: "pending", player_id: null });
      await q("delete from registrations where true");
    });
  });

  describe("waitlist", () => {
    const setWaitlist = (id: string, on: boolean) => q("select * from admin_set_waitlist('a', $1, $2)", [id, on]);

    it("keeps waitlisted players off the wheel, the block and manual assignment", async () => {
      const inPool = await addPlayer("In Pool");
      const waiting = await addPlayer("Waiting");
      const [row] = await setWaitlist(waiting, true);
      expect(row).toMatchObject({ status: "waitlist" });
      expect(row.waitlisted_at).not.toBeNull();

      for (let i = 0; i < 5; i++) {
        const s = (await q("select * from auction_spin('a')"))[0];
        expect(s.current_player_id).toBe(inPool);
        expect(s.spin_candidates).toEqual([inPool]);
        await q("select auction_return_to_pool('a')");
      }
      expect((await errorOf(q("select auction_select_player('a', $1)", [waiting]))).hint).toBe("not_in_pool");
      expect((await errorOf(q("select auction_assign_player('a', $1, $2, 20)", [waiting, teams[0].id]))).hint).toBe("waitlisted");

      // Not counted as left in the round either.
      await putOnBlock(inPool);
      await q("select auction_mark_unsold('a', $1)", [inPool]);
      await q("select auction_advance_round('a', 'men')");
      expect((await q("select status from players where id = $1", [waiting]))[0].status).toBe("waitlist");
    });

    it("moves players between the waitlist and the auction", async () => {
      const p = await addPlayer("Mover");
      await setWaitlist(p, true);
      expect((await setWaitlist(p, true))[0].status).toBe("waitlist"); // idempotent
      const [back] = await setWaitlist(p, false);
      expect(back).toMatchObject({ status: "pool", waitlisted_at: null });
      expect((await errorOf(setWaitlist(p, false))).hint).toBe("not_waitlisted");
      expect((await q("select action from audit_log where details->>'player_id' = $1 order by id", [p])).map((r) => r.action)).toEqual([
        "waitlist_add",
        "waitlist_remove",
      ]);
    });

    it("won't waitlist a player on the block or already auctioned", async () => {
      const onBlock = await addPlayer("On Block");
      await q("select auction_select_player('a', $1)", [onBlock]);
      expect((await errorOf(setWaitlist(onBlock, true))).hint).toBe("on_block");
      await q("select auction_open_bidding('a')");
      await q("select auction_mark_unsold('a', $1)", [onBlock]);
      expect((await errorOf(setWaitlist(onBlock, true))).hint).toBe("already_auctioned");
    });

    it("drops a waitlisted player from the last spin's candidates", async () => {
      const a = await addPlayer("Cand A");
      const b = await addPlayer("Cand B");
      const s = (await q("select * from auction_spin('a')"))[0];
      const other = s.current_player_id === a ? b : a;
      await q("select auction_return_to_pool('a')");
      await q("update auction_state set spin_candidates = $1 where id = 1", [[a, b]]);
      await setWaitlist(other, true);
      expect((await state()).spin_candidates).not.toContain(other);
    });

    it("leaves the waitlist alone when the auction is reset", async () => {
      const sold = await addPlayer("Reset Sold");
      const waiting = await addPlayer("Reset Waiting");
      await setWaitlist(waiting, true);
      await putOnBlock(sold);
      await bid(teams[0].id, sold, 20);
      await q("select auction_sell('a', $1)", [sold]);
      await q("select auction_reset('a')");
      const rows = await q<{ id: string; status: string }>("select id, status from players order by name");
      expect(rows).toEqual([
        { id: sold, status: "pool" },
        { id: waiting, status: "waitlist" },
      ]);
    });

    it("approves a registration onto the waitlist in registration order", async () => {
      const reg = await q<{ id: string; created_at: Date }>(
        `insert into registrations (full_name, email, phone, flat_number, age, gender, role, photo_path, declaration, created_at)
         values ('Late Reg', 'late@example.com', '9999999998', 'A-2', 30, 'men', 'Bowler', 'x/photo.jpg', true, now() - interval '2 days')
         returning id, created_at`,
      );
      const id = (await q<{ id: string }>("select admin_approve_registration('a', $1, 'B', null, null, p_waitlist => true) as id", [reg[0].id]))[0].id;
      const pl = (await q("select status, waitlisted_at, base_price from players where id = $1", [id]))[0];
      expect(pl.status).toBe("waitlist");
      expect((pl.waitlisted_at as Date).toISOString()).toBe(reg[0].created_at.toISOString());
      expect(pl.base_price).toBe(30);
      // The old 5-argument call still adds straight to the auction.
      const reg2 = await q<{ id: string }>(
        `insert into registrations (full_name, email, phone, flat_number, age, gender, role, photo_path, declaration)
         values ('On Time', 'ontime@example.com', '9999999997', 'A-3', 30, 'men', 'Batter', 'x/photo.jpg', true) returning id`,
      );
      const id2 = (await q<{ id: string }>("select admin_approve_registration('a', $1, 'C', null, null) as id", [reg2[0].id]))[0].id;
      expect((await q("select status from players where id = $1", [id2]))[0].status).toBe("pool");
      await q("delete from registrations where true");
    });
  });

  describe("owners and star players", () => {
    const sign = (id: string, team: string, signing: string, price: number) =>
      q("select * from admin_sign_player('a', $1, $2, $3, $4)", [id, team, signing, price]);
    const status = async (team: string) => (await q("select * from team_pool_status($1, 'men')", [team]))[0];

    it("takes their price from the purse without using squad places", async () => {
      await q("update pool_config set max_squad = 1, min_squad = 1 where pool = 'men'");
      const owner = await addPlayer("Owner One");
      const star = await addPlayer("Star One");
      const buy = await addPlayer("Auction Buy");
      const [row] = await sign(owner, teams[0].id, "owner", 300);
      expect(row).toMatchObject({ status: "sold", signing: "owner", sold_team_id: teams[0].id, sold_price: 300, decided_round: null });
      await sign(star, teams[0].id, "star", 500);
      expect(await status(teams[0].id)).toMatchObject({ spent: 800, squad_count: 0 });
      // Max squad 1 still leaves room for one auction buy; 200 of 1000 left.
      await putOnBlock(buy);
      expect((await errorOf(bid(teams[0].id, buy, 205))).hint).toBe("insufficient_purse");
      await bid(teams[0].id, buy, 200);
      await q("select auction_sell('a', $1)", [buy]);
      expect(await status(teams[0].id)).toMatchObject({ spent: 1000, squad_count: 1 });
      // No results for owners or stars: only the auction sale.
      expect((await q("select player_id from results")).map((r) => r.player_id)).toEqual([buy]);
    });

    it("allows one star per team and changes prices within the purse", async () => {
      const a = await addPlayer("Star A");
      const b = await addPlayer("Star B");
      await sign(a, teams[0].id, "star", 100);
      expect((await errorOf(sign(b, teams[0].id, "star", 100))).hint).toBe("star_taken");
      await sign(b, teams[1].id, "star", 100);
      // Re-signing changes the price; the player's own old price is freed first.
      expect((await sign(a, teams[0].id, "star", 1000))[0].sold_price).toBe(1000);
      expect((await errorOf(sign(a, teams[0].id, "star", 1001))).hint).toBe("insufficient_purse");
      expect((await errorOf(sign(a, teams[0].id, "captain", 10))).hint).toBe("bad_signing");
      // Moving to another team checks that team's purse and star.
      expect((await errorOf(sign(a, teams[1].id, "star", 10))).hint).toBe("star_taken");
      await sign(a, teams[1].id, "owner", 10);
      expect(await status(teams[0].id)).toMatchObject({ spent: 0 });
      expect(await status(teams[1].id)).toMatchObject({ spent: 110, squad_count: 0 });
    });

    it("turns a manual assignment into an owner but not an auction sale", async () => {
      const assigned = await addPlayer("Assigned Owner");
      const bought = await addPlayer("Bought");
      await q("select auction_assign_player('a', $1, $2, 400)", [assigned, teams[0].id]);
      await putOnBlock(bought);
      await bid(teams[1].id, bought, 20);
      await q("select auction_sell('a', $1)", [bought]);
      expect((await errorOf(sign(bought, teams[1].id, "owner", 0))).hint).toBe("sold_in_auction");

      await sign(assigned, teams[0].id, "owner", 0);
      const results = await q<{ id: string; player_id: string }>("select id, player_id from results where undone_at is null");
      expect(results.map((r) => r.player_id)).toEqual([bought]);
      expect(String((await state()).last_result_id)).toBe(String(results[0].id));
      expect(await status(teams[0].id)).toMatchObject({ spent: 0, squad_count: 0 });
      // Undo now reaches the auction sale, not the owner.
      await q("select auction_undo_result('a')");
      expect((await q("select status, signing from players where id = $1", [assigned]))[0]).toEqual({ status: "sold", signing: "owner" });
    });

    it("can be taken off a team, and survives an auction reset", async () => {
      const owner = await addPlayer("Kept Owner");
      const star = await addPlayer("Released Star");
      await sign(owner, teams[0].id, "owner", 250);
      await sign(star, teams[0].id, "star", 400);
      expect((await errorOf(q("select admin_delete_player('a', $1)", [owner]))).hint).toBe("player_sold");
      const [released] = await q("select * from admin_release_signing('a', $1)", [star]);
      expect(released).toMatchObject({ status: "pool", signing: null, sold_team_id: null, sold_price: null });
      expect((await errorOf(q("select admin_release_signing('a', $1)", [star]))).hint).toBe("not_signed");
      await q("select auction_reset('a')");
      expect((await q("select status, signing, sold_price from players where id = $1", [owner]))[0]).toEqual({ status: "sold", signing: "owner", sold_price: 250 });
      expect((await errorOf(q("update players set status = 'pool', sold_team_id = null, sold_price = null where id = $1", [owner]))).message).toMatch(/signing_needs_team/);
    });

    it("won't sign the player on the block", async () => {
      const p = await addPlayer("Blocked");
      await q("select auction_select_player('a', $1)", [p]);
      expect((await errorOf(sign(p, teams[0].id, "owner", 0))).hint).toBe("on_block");
    });
  });

  describe("AI insights", () => {
    it("are removed with their player and keep prices non-negative", async () => {
      const p = await addPlayer("Insight Player");
      await q("insert into player_insights (player_id, stats, price_fair, tier) values ($1, '{\"seasons\": []}', 12000, 'solid')", [p]);
      expect((await errorOf(q("update player_insights set price_fair = -1 where player_id = $1", [p]))).message).toMatch(/check constraint/);
      expect((await errorOf(q("update player_insights set tier = 'legend' where player_id = $1", [p]))).message).toMatch(/check constraint/);
      await q("update player_insights set valuation = $2 where player_id = $1", [p, JSON.stringify({ fair: 12000, history: [] })]);
      await q("select admin_delete_player('a', $1)", [p]);
      expect(await q("select 1 from player_insights where player_id = $1", [p])).toHaveLength(0);
    });

    it("are claimed by one request at a time, at a pace, and not while paused", async () => {
      const a = await addPlayer("Claim A");
      const b = await addPlayer("Claim B");
      await q("update ai_status set last_call_at = null, blocked_until = null where id = 1");
      const claim = async (ids: string[], gap: number) =>
        (await q<{ id: string }>("select claim_insight_notes($1::uuid[], $2) as id", [ids, gap])).map((r) => r.id).sort();
      expect(await claim([a], 30)).toEqual([a]);
      // Within the gap: nothing, even for another player. Without a gap: only players not already claimed.
      expect(await claim([b], 30)).toEqual([]);
      expect(await claim([a, b], 0)).toEqual([b]);
      // A player with a note is never claimed; a stale claim can be taken over.
      await q("update player_insights set summary = 'Done.' where player_id = $1", [b]);
      await q("update player_insights set note_claimed_at = now() - interval '5 minutes' where player_id = $1", [a]);
      expect(await claim([a, b], 0)).toEqual([a]);
      await q("update player_insights set note_claimed_at = null where player_id = $1", [a]);
      await q("update ai_status set blocked_until = now() + interval '1 minute' where id = 1");
      expect(await claim([a], 0)).toEqual([]);
      await q("update ai_status set last_call_at = null, blocked_until = null where id = 1");
      // Deleted players are skipped, not an error.
      expect(await claim([randomUUID()], 0)).toEqual([]);
    });

    it("keep previous prices sane", async () => {
      await q("insert into past_prices (season, pool, name, team, price) values (2, 'women', 'Old Player', null, 0)");
      expect((await errorOf(q("insert into past_prices (season, pool, name, price) values (2, 'men', 'x', -5)"))).message).toMatch(/check constraint/);
      expect((await errorOf(q("insert into past_prices (season, pool, name, price) values (0, 'men', 'x', 5)"))).message).toMatch(/check constraint/);
      expect((await errorOf(q("insert into past_prices (season, pool, name, price) values (2, 'men', '', 5)"))).message).toMatch(/check constraint/);
      await q("delete from past_prices where true");
    });
  });

  describe("concurrency", () => {
    it("accepts exactly one of many simultaneous identical bids", async () => {
      const p1 = await addPlayer("Race");
      await putOnBlock(p1);
      const outcomes = await Promise.allSettled(teams.map((t) => bid(t.id, p1, 20)));
      const ok = outcomes.filter((o) => o.status === "fulfilled");
      expect(ok).toHaveLength(1);
      for (const o of outcomes) {
        if (o.status === "rejected") expect(["outbid", "already_leading"]).toContain(o.reason.hint);
      }
      expect((await q("select count(*)::int as n from bids where player_id = $1", [p1]))[0].n).toBe(1);
    });

    it("keeps a strictly increasing, consistent bid chain under sustained contention", async () => {
      const p1 = await addPlayer("Contention");
      await q("update pool_config set purse = 100000 where pool = 'men'");
      await putOnBlock(p1);

      // Each team repeatedly reads the state and bids current + 5, like an
      // owner hammering the bid button on a phone.
      const bidder = async (teamId: string) => {
        let accepted = 0;
        for (let i = 0; i < 25; i++) {
          const s = await state();
          const amount = s.current_bid === null ? 20 : (s.current_bid as number) + 5;
          try {
            await bid(teamId, p1, amount);
            accepted++;
          } catch (e) {
            expect(["outbid", "already_leading"]).toContain((e as { hint: string }).hint);
          }
        }
        return accepted;
      };
      const accepted = (await Promise.all(teams.map((t) => bidder(t.id)))).reduce((a, b) => a + b, 0);

      const chain = await q<{ amount: number; team_id: string }>(
        "select amount, team_id from bids where player_id = $1 order by id", [p1]);
      expect(chain.length).toBe(accepted);
      for (let i = 1; i < chain.length; i++) {
        expect(chain[i].amount).toBeGreaterThanOrEqual(chain[i - 1].amount + 5);
        expect(chain[i].team_id).not.toBe(chain[i - 1].team_id);
      }
      const s = await state();
      expect(s.current_bid).toBe(chain.at(-1)!.amount);
      expect(s.leading_team_id).toBe(chain.at(-1)!.team_id);
      expect(s.bid_count).toBe(chain.length);
    });

    it("never accepts a bid after the player is sold", async () => {
      const p1 = await addPlayer("Sell Race");
      await putOnBlock(p1);
      await bid(teams[0].id, p1, 20);
      const results = await Promise.allSettled([
        q("select auction_sell('a', $1)", [p1]),
        ...teams.slice(1).map((t) => bid(t.id, p1, 25)),
      ]);
      const player = (await q("select * from players where id = $1", [p1]))[0];
      const accepted = await q<{ amount: number; team_id: string }>(
        "select amount, team_id from bids where player_id = $1 and voided_at is null order by id desc limit 1", [p1]);
      // Whatever order they ran in, the sale price equals the last accepted bid.
      expect(results[0].status).toBe("fulfilled");
      expect(player.sold_price).toBe(accepted[0].amount);
      expect(player.sold_team_id).toBe(accepted[0].team_id);
    });
  });
});
