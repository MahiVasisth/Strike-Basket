import type { Config } from "../config.js";
import { authHeaders, loadApiWallet, type ApiWallet } from "./sign.js";
import type {
  AccountRaw,
  BatchOrderResponse,
  BookTickerRaw,
  CreateOrder,
  MarkPriceRaw,
  PositionRaw,
  SymbolFilters,
  TwapRequest,
  VaultRaw,
} from "./types.js";

export class StrikeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
    readonly path: string,
  ) {
    super(message);
  }
}

export class MainnetWriteBlocked extends Error {
  constructor(what: string) {
    super(`${what} blocked: mainnet is read-only (set ALLOW_MAINNET_WRITES=yes to allow writes)`);
  }
}

/** Order-creating paths that carry X-Builder-Fee-Bps in personal mode. */
const BUILDER_FEE_PATHS = new Set(["/v2/order", "/v2/orders/batch", "/v2/order/strategy", "/v2/algo/twap"]);

export interface ClientOptions {
  /** Trade as this API wallet instead of the one in config (personal mode). */
  wallet?: ApiWallet;
  /** Builder fee sent on order requests; only valid for Builder Connect accounts. */
  builderFeeBps?: number;
}

export interface BuilderConnectChallenge {
  nonce: string;
  message_to_sign: string;
}

export interface BuilderConnectResult {
  account_id: string;
  builder_code: string;
  fee_share_bps: number;
  api_wallet_id: number | string;
  api_wallet_public_key: string;
  api_wallet_created_at?: string;
}

type Query = Record<string, string | number | boolean | undefined>;

function qs(query?: Query): string {
  if (!query) return "";
  const entries = Object.entries(query).filter(([, v]) => v !== undefined) as [string, string | number | boolean][];
  if (!entries.length) return "";
  return "?" + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString();
}

export class StrikeClient {
  private wallet: ApiWallet | null;
  private clockOffsetMs = 0;

  private builderFeeBps: number | undefined;

  constructor(
    readonly cfg: Config,
    private fetchImpl: typeof fetch = fetch,
    opts: ClientOptions = {},
  ) {
    this.wallet =
      opts.wallet ??
      (cfg.STRIKE_API_PUBLIC_KEY && cfg.STRIKE_API_PRIVATE_KEY ? loadApiWallet(cfg.STRIKE_API_PUBLIC_KEY, cfg.STRIKE_API_PRIVATE_KEY) : null);
    this.builderFeeBps = opts.builderFeeBps;
  }

  /** A client for another account (personal mode) sharing this one's clock offset. */
  forWallet(wallet: ApiWallet, builderFeeBps?: number): StrikeClient {
    const c = new StrikeClient(this.cfg, this.fetchImpl, { wallet, builderFeeBps });
    c.clockOffsetMs = this.clockOffsetMs;
    return c;
  }

  get hasAuth(): boolean {
    return this.wallet !== null;
  }

  get vaultId(): string | undefined {
    return this.cfg.STRIKE_VAULT_ID;
  }

  /** Signatures carry a seconds timestamp; align with the server clock once at startup. */
  async syncClock(): Promise<number> {
    const t0 = Date.now();
    const { serverTime } = await this.get<{ serverTime: number }>("/v2/time");
    this.clockOffsetMs = serverTime - Math.round((t0 + Date.now()) / 2);
    return this.clockOffsetMs;
  }

  now(): number {
    return Date.now() + this.clockOffsetMs;
  }

  // ---------- transport ----------

  private async request<T>(
    base: "rest" | "price",
    method: string,
    path: string,
    opts: { query?: Query; body?: unknown; auth?: boolean; retries?: number } = {},
  ): Promise<T> {
    if (method !== "GET" && this.cfg.STRIKE_ENV === "mainnet" && !this.cfg.ALLOW_MAINNET_WRITES) {
      throw new MainnetWriteBlocked(`${method} ${path}`);
    }
    const search = qs(opts.query);
    const url = `${this.cfg.urls[base]}${path}${search}`;
    const body = opts.body === undefined ? "" : JSON.stringify(opts.body);
    const retries = opts.retries ?? (method === "GET" ? 2 : 0);

    for (let attempt = 0; ; attempt++) {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (opts.auth) {
        if (!this.wallet) throw new Error(`${method} ${path} needs API wallet keys`);
        const signedPath = this.cfg.SIGN_PATH_WITH_QUERY ? path + search : path;
        Object.assign(headers, authHeaders(this.wallet, method, signedPath, body, this.now()));
      }
      if (this.builderFeeBps !== undefined && method === "POST" && BUILDER_FEE_PATHS.has(path)) {
        headers["X-Builder-Fee-Bps"] = String(this.builderFeeBps);
      }
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method,
          headers,
          body: body || undefined,
          signal: AbortSignal.timeout(15_000),
        });
      } catch (err) {
        if (attempt < retries) {
          await sleep(500 * 2 ** attempt);
          continue;
        }
        throw err;
      }
      const text = await res.text();
      let parsed: unknown = text;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        /* non-JSON body, keep text */
      }
      if (res.ok) return parsed as T;
      if (res.status >= 500 && attempt < retries) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      const msg = typeof parsed === "object" && parsed && "message" in parsed ? String((parsed as any).message) : text;
      throw new StrikeError(`${method} ${path} → ${res.status}: ${msg.slice(0, 300)}`, res.status, parsed, path);
    }
  }

  get<T>(path: string, query?: Query, auth = false) {
    return this.request<T>("rest", "GET", path, { query, auth });
  }
  private post<T>(path: string, body: unknown, auth = true) {
    return this.request<T>("rest", "POST", path, { body, auth });
  }
  private del<T>(path: string, body?: unknown) {
    return this.request<T>("rest", "DELETE", path, { body, auth: true });
  }
  private price<T>(path: string, query?: Query) {
    return this.request<T>("price", "GET", path, { query });
  }

  // ---------- public market data ----------

  async exchangeFilters(): Promise<Map<string, SymbolFilters>> {
    const info = await this.price<{ symbols: any[] }>("/v2/exchangeInfo");
    const out = new Map<string, SymbolFilters>();
    for (const s of info.symbols) {
      const f = Object.fromEntries((s.filters as any[]).map((x) => [x.filterType, x]));
      out.set(s.symbol, {
        symbol: s.symbol,
        status: s.status,
        tickSize: f.PRICE_FILTER?.tickSize ?? "0.01",
        stepSize: f.LOT_SIZE?.stepSize ?? "0.01",
        minQty: f.LOT_SIZE?.minQty ?? "0",
        maxQty: f.LOT_SIZE?.maxQty ?? "1e12",
        marketMaxQty: f.MARKET_LOT_SIZE?.maxQty ?? f.LOT_SIZE?.maxQty ?? "1e12",
        minNotional: f.MIN_NOTIONAL?.notional ?? "0",
      });
    }
    return out;
  }

  async markPrices(): Promise<Map<string, MarkPriceRaw>> {
    const rows = await this.price<MarkPriceRaw[]>("/v2/markPrice");
    return new Map(rows.map((r) => [r.s, r]));
  }

  async bookTickers(): Promise<Map<string, BookTickerRaw>> {
    const rows = await this.price<BookTickerRaw[]>("/v2/ticker/bookTicker");
    return new Map(rows.map((r) => [r.symbol, r]));
  }

  ticker24h(symbol: string) {
    return this.price<Record<string, string>>("/v2/ticker/24hr", { symbol });
  }

  // ---------- vault / account (public when vault_id is given) ----------

  vault(vaultId: string) {
    return this.get<VaultRaw>(`/v2/vault/${vaultId}`);
  }

  vaults(query: Query = {}) {
    return this.get<{ count: number; vaults: VaultRaw[] }>("/v2/vaults", query);
  }

  account(vaultId?: string) {
    return this.get<AccountRaw>("/v2/account", { vault_id: vaultId }, !vaultId);
  }

  async positions(vaultId?: string): Promise<PositionRaw[]> {
    const r = await this.get<{ positions: PositionRaw[] | null }>("/v2/positions", { vault_id: vaultId }, !vaultId);
    return r.positions ?? [];
  }

  openOrders(vaultId?: string, symbol?: string) {
    return this.get<unknown>("/v2/openOrders", { vault_id: vaultId, symbol }, true);
  }

  getOrder(symbol: string, clientOrderId: string, vaultId?: string) {
    return this.get<Record<string, unknown>>(
      "/v2/order",
      { symbol, client_order_id: clientOrderId, vault_id: vaultId },
      true,
    );
  }

  // ---------- Builder Connect (public; testnet only while mainnet is write-locked) ----------

  builderRequestSignature(req: { address: string; chain: string; code: string; fee_share_bps: number; public_key: string }) {
    return this.post<BuilderConnectChallenge>("/auth/builder/request-signature", req, false);
  }

  builderVerifySignature(req: { address: string; chain: string; nonce: string; wallet_signature: string }) {
    return this.post<BuilderConnectResult>("/auth/builder/verify-signature", req, false);
  }

  // ---------- trading (vault leader: vault_id in body; omitted for personal accounts) ----------

  setLeverage(symbol: string, leverage: number, vaultId?: string) {
    return this.post<unknown>("/v2/leverage", { symbol, leverage, vault_id: vaultId });
  }

  setMarginMode(symbol: string, marginMode: "cross" | "isolated", vaultId?: string) {
    return this.post<unknown>("/v2/marginMode", { symbol, marginMode, vault_id: vaultId });
  }

  createOrder(order: CreateOrder, vaultId?: string) {
    return this.post<Record<string, unknown>>("/v2/order", { ...order, vault_id: vaultId });
  }

  batchOrders(orders: CreateOrder[], vaultId?: string) {
    return this.post<BatchOrderResponse>("/v2/orders/batch", { orders, vault_id: vaultId });
  }

  cancelAll(symbol: string, vaultId?: string) {
    return this.del<unknown>("/v2/order/cancel-all", { symbol, vault_id: vaultId });
  }

  createTwap(req: TwapRequest) {
    return this.post<Record<string, unknown>>("/v2/algo/twap", req);
  }

  getTwap(id: string) {
    return this.get<Record<string, unknown>>(`/v2/algo/twap/${id}`, undefined, true);
  }

  cancelTwap(id: string) {
    return this.del<unknown>(`/v2/algo/twap/${id}`);
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
