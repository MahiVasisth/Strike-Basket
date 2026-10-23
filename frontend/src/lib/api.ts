// One client per backend instance. Both instances serve the same API (docs/FRONTEND.md §3);
// money and quantities arrive as strings and are parsed for display only.

export type Env = "mainnet" | "testnet";
export type Mode = "shadow" | "live";
export type Source = "vault" | "paper";
export type Trigger = "initial" | "drift" | "stray" | "force" | "flatten";
export type RunStatus =
  | "noop" | "paused" | "gated" | "cooldown" | "busy" | "nothing_tradable"
  | "shadow" | "executing" | "done" | "partial" | "failed";

export interface Health {
  ok: boolean; env: Env; mode: Mode; source: Source; paused: boolean;
  lastTickAt: number | null; nextTickAt: number | null; cycleSeconds: number; lastError: string | null;
}

export interface Constituent { symbol: string; name: string; weight: number }

export interface Basket {
  id: string; version: number; name: string; tagline: string; env: Env; mode: Mode; source: Source;
  constituents: Constituent[];
  /** Our vault as Strike lists it; terms come from Strike's public vault record. All null in paper mode except listUrl. */
  vault: {
    id: string | null; url: string | null; listUrl: string; name: string | null; status: string | null;
    minDepositUsd: string | null; lockupDays: number | null; leaderCommissionBps: number | null;
    depositors: number | null; sharePrice: string | null; equity: string | null;
  };
  rules: {
    grossExposure: number; driftThresholdBps: number; marginMode: string; symbolLeverage: number;
    maxLegNotionalUsd: number; maxRunNotionalUsd: number; cooldownMin: number; cycleSeconds: number;
    gates: { maxSpreadBps: number; maxMarkMidDeviationBps: number; maxBookAgeSec: number };
  };
}

export interface BasketListing { id: string; name: string; tagline: string; status: "live" | "coming_soon"; constituents: Constituent[] }

export interface WeightRow {
  symbol: string; inBasket: boolean; targetWeight: number; currentWeight: number; driftBps: number;
  mark: string; currentQty: string; currentNotional: string; targetQty: string; targetNotional: string;
}

export interface Gate {
  symbol: string; ok: boolean; spreadBps: number | null; markMidDeviationBps: number | null; bookAgeSec: number | null;
  failures: string[]; warnings: string[];
}

export interface State {
  ts: number; source: Source; equity: string; costs: { fees: string; funding: string } | null;
  sharePrice: string | null; totalShares: string | null; depositors: number | null; bookNotional: string;
  maxDriftBps: number; driftThresholdBps: number; pendingTrigger: Trigger | null; paused: boolean;
  warnings: string[]; weights: WeightRow[]; gates: Gate[];
}

export interface Snapshot { ts: number; equity: string; share_price: string | null; total_shares: string | null; depositors: number | null; max_drift_bps: number }

export interface RunSummary {
  id: string; createdAt: number; finishedAt: number | null; env: Env; mode: "live" | "paper" | "shadow";
  basketId: string; basketVersion: number; trigger: Trigger; status: RunStatus; equity: string;
  maxDriftBps: number; legCount: number; error: string | null;
}

export interface Leg {
  idx: number; symbol: string; side: "buy" | "sell"; qty: string; notionalEst: string; mark: string;
  reduceOnly: boolean; method: "batch" | "twap"; clientOrderId: string; strikeOrderId: string | null;
  twapId: string | null; status: string; filledQty: string | null; avgPrice: string | null; error: string | null; updatedAt: number;
}

export interface RunDetail extends RunSummary {
  plan: {
    equity: string; bookNotional: string; rows: WeightRow[]; maxDriftBps: number; trigger: Trigger;
    legs: { symbol: string; side: string; qty: string; notional: string; reduceOnly: boolean; reason: string }[];
    skipped: { symbol: string; deltaQty: string; deltaNotional: string; reason: string }[];
    warnings: string[];
  };
  gates: Gate[];
  legs: Leg[];
}

export interface PlanResult {
  runId: string | null; status: RunStatus; trigger?: Trigger | null;
  legs: RunDetail["plan"]["legs"]; skipped?: RunDetail["plan"]["skipped"]; warnings?: string[];
}

export interface PersonalBaskets {
  builderFeeBps: number;
  baskets: { id: string; name: string; available: boolean; minBudgetUsd: number | null; reason?: string }[];
}

export interface PersonalUser {
  address: string; chain: string; accountId: string | null; basketId: string; budgetUsd: number;
  builderFeeBps: number; status: "active" | "paused"; connectedAt: number;
}

export interface MeView {
  user: PersonalUser;
  health: { lastTickAt: number | null; lastError: string | null; cycleSeconds: number };
  state: null | {
    ts: number; basketEquity: string; bookNotional: string; maxDriftBps: number; driftThresholdBps: number;
    pendingTrigger: Trigger | null; weights: WeightRow[]; gates: Gate[]; warnings: string[];
  };
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export class Api {
  constructor(public readonly base: string, private token?: string) {}

  withToken(token: string | undefined) {
    return new Api(this.base, token);
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const res = await fetch(this.base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new ApiError(res.status, data?.error ?? res.statusText);
    return data as T;
  }

  get = <T>(path: string) => this.req<T>("GET", path);
  post = <T>(path: string, body: unknown = {}) => this.req<T>("POST", path, body);
  put = <T>(path: string, body: unknown) => this.req<T>("PUT", path, body);
  del = <T>(path: string) => this.req<T>("DELETE", path);

  health = () => this.get<Health>("/api/health");
  basket = () => this.get<Basket>("/api/basket");
  baskets = () => this.get<BasketListing[]>("/api/baskets");
  state = () => this.get<State>("/api/state");
  snapshots = (since: number) => this.get<Snapshot[]>(`/api/snapshots?since=${since}&limit=2000`);
  rebalances = (limit = 50) => this.get<RunSummary[]>(`/api/rebalances?limit=${limit}`);
  rebalance = (id: string) => this.get<RunDetail>(`/api/rebalances/${encodeURIComponent(id)}`);
  streamUrl = () => `${this.base}/api/stream`;
}

const strip = (s: string | undefined) => (s ? s.replace(/\/+$/, "") : undefined);

export const HERO_URL = strip(import.meta.env.VITE_API_URL) ?? "http://localhost:8787";
export const TESTNET_URL = strip(import.meta.env.VITE_TESTNET_API_URL);

export const heroApi = new Api(HERO_URL);
export const testnetApi = TESTNET_URL ? new Api(TESTNET_URL) : null;

/** One client factory, reused for both backend instances. */
export const createApi = (baseUrl: string, token?: string) => new Api(baseUrl, token);
