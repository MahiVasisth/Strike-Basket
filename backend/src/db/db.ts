import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

// Strike is the source of truth for positions and balances. This store holds our own record:
// rebalance runs, the orders we sent, share-price snapshots, and the pause switch.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  finished_at INTEGER,
  env TEXT NOT NULL,
  mode TEXT NOT NULL,              -- live (vault) | paper | shadow (plan only)
  basket_id TEXT NOT NULL,
  basket_version INTEGER NOT NULL,
  trigger TEXT,                    -- initial | drift | stray | force | NULL (no action)
  status TEXT NOT NULL,            -- planned | gated | executing | done | partial | failed | shadow
  equity TEXT NOT NULL,
  max_drift_bps INTEGER NOT NULL,
  plan_json TEXT NOT NULL,
  gates_json TEXT NOT NULL,
  error TEXT
);
CREATE INDEX IF NOT EXISTS runs_created ON runs(created_at DESC);

CREATE TABLE IF NOT EXISTS legs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES runs(id),
  idx INTEGER NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  qty TEXT NOT NULL,
  notional_est TEXT NOT NULL,
  mark TEXT NOT NULL,
  reduce_only INTEGER NOT NULL,
  method TEXT NOT NULL,            -- batch | twap
  client_order_id TEXT NOT NULL UNIQUE,
  strike_order_id TEXT,
  twap_id TEXT,
  status TEXT NOT NULL,            -- pending | sent | filled | partial | rejected | failed | unknown
  filled_qty TEXT,
  avg_price TEXT,
  error TEXT,
  raw_json TEXT,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS legs_run ON legs(run_id);

CREATE TABLE IF NOT EXISTS snapshots (
  ts INTEGER PRIMARY KEY,
  equity TEXT NOT NULL,
  share_price TEXT,
  total_shares TEXT,
  depositors INTEGER,
  max_drift_bps INTEGER NOT NULL,
  weights_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- Personal mode: users who connected their own Strike account through Builder Connect.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  session_hash TEXT NOT NULL UNIQUE,  -- sha256 of the bearer token we gave the user
  address TEXT NOT NULL,
  chain TEXT NOT NULL,
  account_id TEXT NOT NULL,
  api_pubkey TEXT NOT NULL,
  api_secret_enc TEXT,                -- AES-256-GCM; NULL once revoked
  basket_id TEXT NOT NULL,
  budget_usd REAL NOT NULL,
  fee_bps INTEGER NOT NULL,
  status TEXT NOT NULL,               -- active | paused | revoked
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

// Columns added after the first deploy; applied idempotently so existing databases keep working.
const MIGRATIONS: Array<{ table: string; column: string; ddl: string }> = [
  { table: "runs", column: "scope", ddl: "ALTER TABLE runs ADD COLUMN scope TEXT NOT NULL DEFAULT 'main'" },
];

export interface RunRow {
  id: string;
  /** 'main' for the basket vault / paper book; a user id for personal mode. */
  scope: string;
  created_at: number;
  finished_at: number | null;
  env: string;
  mode: string;
  basket_id: string;
  basket_version: number;
  trigger: string | null;
  status: string;
  equity: string;
  max_drift_bps: number;
  plan_json: string;
  gates_json: string;
  error: string | null;
}

export interface LegRow {
  id: number;
  run_id: string;
  idx: number;
  symbol: string;
  side: string;
  qty: string;
  notional_est: string;
  mark: string;
  reduce_only: number;
  method: string;
  client_order_id: string;
  strike_order_id: string | null;
  twap_id: string | null;
  status: string;
  filled_qty: string | null;
  avg_price: string | null;
  error: string | null;
  raw_json: string | null;
  updated_at: number;
}

export type NewLeg = Omit<LegRow, "id" | "strike_order_id" | "twap_id" | "filled_qty" | "avg_price" | "error" | "raw_json" | "updated_at">;

export class Store {
  readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(SCHEMA);
    for (const m of MIGRATIONS) {
      const cols = this.db.prepare(`PRAGMA table_info(${m.table})`).all() as Array<{ name: string }>;
      if (!cols.some((c) => c.name === m.column)) this.db.exec(m.ddl);
    }
    this.db.exec("CREATE INDEX IF NOT EXISTS runs_scope ON runs(scope, created_at DESC)");
  }

  // ---------- kv / pause ----------
  getKv(key: string): string | undefined {
    const r = this.db.prepare("SELECT value FROM kv WHERE key = ?").get(key) as { value: string } | undefined;
    return r?.value;
  }
  setKv(key: string, value: string) {
    this.db.prepare("INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }
  isPaused(): boolean {
    return this.getKv("paused") === "1";
  }
  setPaused(paused: boolean) {
    this.setKv("paused", paused ? "1" : "0");
  }

  // ---------- runs ----------
  insertRun(r: RunRow) {
    this.db
      .prepare(
        `INSERT INTO runs(id, scope, created_at, finished_at, env, mode, basket_id, basket_version, trigger, status, equity, max_drift_bps, plan_json, gates_json, error)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(r.id, r.scope, r.created_at, r.finished_at, r.env, r.mode, r.basket_id, r.basket_version, r.trigger, r.status, r.equity, r.max_drift_bps, r.plan_json, r.gates_json, r.error);
  }
  finishRun(id: string, status: string, error: string | null = null) {
    this.db.prepare("UPDATE runs SET status = ?, error = ?, finished_at = ? WHERE id = ?").run(status, error, Date.now(), id);
  }
  setRunStatus(id: string, status: string) {
    this.db.prepare("UPDATE runs SET status = ? WHERE id = ?").run(status, id);
  }
  getRun(id: string): RunRow | undefined {
    return this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as RunRow | undefined;
  }
  listRuns(opts: { limit: number; actionsOnly: boolean; scope?: string }): RunRow[] {
    const actions = opts.actionsOnly ? "AND trigger IS NOT NULL" : "";
    return this.db
      .prepare(`SELECT * FROM runs WHERE scope = ? ${actions} ORDER BY created_at DESC LIMIT ?`)
      .all(opts.scope ?? "main", opts.limit) as unknown as RunRow[];
  }
  unfinishedLiveRuns(scope: string): RunRow[] {
    return this.db.prepare("SELECT * FROM runs WHERE scope = ? AND mode = 'live' AND status = 'executing'").all(scope) as unknown as RunRow[];
  }
  lastExecutedRunAt(scope: string): number | null {
    const r = this.db
      .prepare("SELECT MAX(created_at) AS t FROM runs WHERE scope = ? AND mode IN ('live','paper') AND status IN ('done','partial','executing')")
      .get(scope) as { t: number | null };
    return r.t;
  }

  // ---------- legs ----------
  insertLeg(l: NewLeg) {
    this.db
      .prepare(
        `INSERT INTO legs(run_id, idx, symbol, side, qty, notional_est, mark, reduce_only, method, client_order_id, status, updated_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(l.run_id, l.idx, l.symbol, l.side, l.qty, l.notional_est, l.mark, l.reduce_only, l.method, l.client_order_id, l.status, Date.now());
  }
  updateLeg(clientOrderId: string, patch: Partial<Pick<LegRow, "status" | "strike_order_id" | "twap_id" | "filled_qty" | "avg_price" | "error" | "raw_json">>) {
    const keys = Object.keys(patch) as (keyof typeof patch)[];
    if (!keys.length) return;
    const sets = keys.map((k) => `${k} = ?`).join(", ");
    const vals = keys.map((k) => (patch[k] ?? null) as string | null);
    this.db.prepare(`UPDATE legs SET ${sets}, updated_at = ? WHERE client_order_id = ?`).run(...vals, Date.now(), clientOrderId);
  }
  activeTwapLegs(scope: string): LegRow[] {
    return this.db
      .prepare(
        "SELECT legs.* FROM legs JOIN runs ON runs.id = legs.run_id WHERE runs.scope = ? AND legs.method = 'twap' AND legs.status IN ('pending','sent','unknown','partial')",
      )
      .all(scope) as unknown as LegRow[];
  }
  legsForRun(runId: string): LegRow[] {
    return this.db.prepare("SELECT * FROM legs WHERE run_id = ? ORDER BY idx").all(runId) as unknown as LegRow[];
  }

  // ---------- snapshots ----------
  insertSnapshot(s: { ts: number; equity: string; share_price: string | null; total_shares: string | null; depositors: number | null; max_drift_bps: number; weights_json: string }) {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO snapshots(ts, equity, share_price, total_shares, depositors, max_drift_bps, weights_json) VALUES(?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(s.ts, s.equity, s.share_price, s.total_shares, s.depositors, s.max_drift_bps, s.weights_json);
  }
  listSnapshots(sinceMs: number, limit: number) {
    return this.db
      .prepare("SELECT ts, equity, share_price, total_shares, depositors, max_drift_bps FROM snapshots WHERE ts >= ? ORDER BY ts ASC LIMIT ?")
      .all(sinceMs, limit);
  }

  // ---------- events ----------
  insertEvent(type: string, payload: unknown): number {
    const r = this.db.prepare("INSERT INTO events(ts, type, payload_json) VALUES(?, ?, ?)").run(Date.now(), type, JSON.stringify(payload));
    return Number(r.lastInsertRowid);
  }
  listEvents(limit: number) {
    return (this.db.prepare("SELECT * FROM events ORDER BY id DESC LIMIT ?").all(limit) as Array<{ id: number; ts: number; type: string; payload_json: string }>).map(
      (e) => ({ id: e.id, ts: e.ts, type: e.type, payload: JSON.parse(e.payload_json) }),
    );
  }
}

export interface UserRow {
  id: string;
  session_hash: string;
  address: string;
  chain: string;
  account_id: string;
  api_pubkey: string;
  api_secret_enc: string | null;
  basket_id: string;
  budget_usd: number;
  fee_bps: number;
  status: "active" | "paused" | "revoked";
  created_at: number;
  updated_at: number;
}

export class UserStore {
  constructor(private store: Store) {}

  private get db() {
    return this.store.db;
  }

  insert(u: UserRow) {
    this.db
      .prepare(
        `INSERT INTO users(id, session_hash, address, chain, account_id, api_pubkey, api_secret_enc, basket_id, budget_usd, fee_bps, status, created_at, updated_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(u.id, u.session_hash, u.address, u.chain, u.account_id, u.api_pubkey, u.api_secret_enc, u.basket_id, u.budget_usd, u.fee_bps, u.status, u.created_at, u.updated_at);
  }
  bySession(hash: string): UserRow | undefined {
    return this.db.prepare("SELECT * FROM users WHERE session_hash = ? AND status != 'revoked'").get(hash) as UserRow | undefined;
  }
  get(id: string): UserRow | undefined {
    return this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
  }
  /** A wallet reconnecting replaces its previous connection (Strike revokes the old API wallet too). */
  activeByAddress(chain: string, address: string): UserRow | undefined {
    return this.db.prepare("SELECT * FROM users WHERE chain = ? AND address = ? AND status != 'revoked'").get(chain, address) as UserRow | undefined;
  }
  running(): UserRow[] {
    return this.db.prepare("SELECT * FROM users WHERE status != 'revoked'").all() as unknown as UserRow[];
  }
  countActive(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM users WHERE status != 'revoked'").get() as { n: number }).n;
  }
  update(id: string, patch: Partial<Pick<UserRow, "basket_id" | "budget_usd" | "status" | "api_secret_enc">>) {
    const keys = Object.keys(patch) as (keyof typeof patch)[];
    if (!keys.length) return;
    const sets = keys.map((k) => `${k} = ?`).join(", ");
    this.db.prepare(`UPDATE users SET ${sets}, updated_at = ? WHERE id = ?`).run(...keys.map((k) => patch[k] ?? null), Date.now(), id);
  }
}
