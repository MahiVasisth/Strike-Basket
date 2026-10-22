// Shapes observed on the live API (2026-10-22). Where they differ from the skill docs, the live shape wins.
// Numbers arrive as strings; we keep them as strings at the boundary and convert in core/.

export interface SymbolFilters {
  symbol: string;
  status: string;
  tickSize: string;
  stepSize: string;
  minQty: string;
  maxQty: string;
  marketMaxQty: string;
  minNotional: string;
}

/** GET /price/v2/markPrice (no symbol) returns WS-style objects. */
export interface MarkPriceRaw {
  e: string;
  E: number;
  s: string;
  p: string; // mark
  i: string; // index
  r: string; // funding rate (8h basis)
  T: number; // next funding time
}

export interface BookTickerRaw {
  symbol: string;
  bidPrice: string;
  bidQty: string;
  askPrice: string;
  askQty: string;
  time: number;
}

/** GET /v2/positions?vault_id= (live shape; docs show PascalCase fields that are not returned). */
export interface PositionRaw {
  id: number;
  account_id: string;
  symbol: string;
  margin_mode: string;
  leverage: number;
  size: string; // signed: negative = short
  entry_price: string;
  upnl: string;
  accumulated_funding_fees?: string;
  liquidation_price?: string;
}

export interface AccountRaw {
  account_id: string;
  wallet_balance: string;
  available_balance: string;
  unrealized_pnl: string;
  margin_balance: string;
  default_margin_mode?: string;
  default_leverage?: number;
  symbol_settings?: Record<string, { margin_mode: string; leverage: number }>;
}

export interface VaultRaw {
  vault_id: string;
  type: string;
  name: string;
  description?: string;
  account_id: string;
  leader_account_id: string;
  leader_commission_bps: number;
  total_shares: string;
  share_price: string;
  equity: string;
  status: string;
  min_deposit?: string;
  lockup_days?: number;
  depositors?: number;
  created_at?: number;
}

export type Side = "buy" | "sell";

export interface CreateOrder {
  symbol: string;
  side: Side;
  type: "market" | "limit";
  size: string;
  price?: string;
  time_in_force?: "GTC" | "IOC" | "FOK";
  reduce_only?: boolean;
  slippage?: string;
  client_order_id?: string;
}

export interface BatchOrderResponse {
  successful?: Array<Record<string, unknown> & { client_order_id?: string }>;
  failed?: Array<{ index: number; error: string }>;
}

export interface TwapRequest {
  symbol: string;
  side: "BUY" | "SELL";
  total_size: string;
  duration_sec: number;
  limit_price?: string;
  reduce_only?: boolean;
  randomize?: boolean;
  vault_id?: string;
}
