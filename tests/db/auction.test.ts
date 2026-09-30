// Integration tests for the SQL auction functions and access rules.
// Needs a local Postgres: TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres
// (a fresh "auction_test" database is created from the migrations).
import { execFileSync } from "node:child_process";
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
  });

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    await q("select auction_reset('test')");
    await q("delete from players");
    await q("update pool_config set purse = 1000, min_squad = 8, max_squad = 12, base_price_a = 50, base_price_b = 30, base_price_c = 20, increment_tiers = '[{\"from\":0,\"step\":5}]' where pool = 'men'");
    await q("update team_pool_limits set purse = null, min_squad = null, max_squad = null");
    await q("update auction_state set current_pool = 'men'");
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
        "update auction_state set current_bid = 999",
        "insert into bids (player_id, pool, round, team_id, amount, placed_by_role) select id, 'men', 1, (select id from teams limit 1), 5, 'admin' from players limit 1",
        "update pool_config set purse = 1",
        "update teams set name = 'hacked'",
        "select * from owners",
        "insert into owners (email, team_id) select 'x@y.z', id from teams limit 1",
        "select * from user_sessions",
        "select * from audit_log",
        "select auction_sell('x', gen_random_uuid())",
        "select auction_place_bid('x', 'admin', null, gen_random_uuid(), gen_random_uuid(), 1)",
        "select auction_reset('x')",
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
