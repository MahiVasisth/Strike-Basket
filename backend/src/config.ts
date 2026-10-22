import "dotenv/config";
import { z } from "zod";

export const STRIKE_ENVS = {
  mainnet: {
    app: "https://app.strikefinance.org",
    rest: "https://api.strikefinance.org",
    price: "https://api.strikefinance.org/price",
    marketWs: "wss://api.strikefinance.org/ws/price",
    userWs: "wss://api.strikefinance.org/ws/user-api",
  },
  testnet: {
    app: "https://testnet.strikefinance.org",
    rest: "https://api-v2-testnet.strikefinance.org",
    price: "https://api-v2-testnet.strikefinance.org/price",
    marketWs: "wss://api-v2-testnet.strikefinance.org/ws/price",
    userWs: "wss://api-v2-testnet.strikefinance.org/ws/user-api",
  },
} as const;

export type StrikeEnv = keyof typeof STRIKE_ENVS;

const bool = z
  .string()
  .optional()
  .transform((v) => v === "1" || v?.toLowerCase() === "true" || v?.toLowerCase() === "yes");

const schema = z.object({
  STRIKE_ENV: z.enum(["mainnet", "testnet"]).default("testnet"),
  // shadow = compute and log plans, never send orders. live = trade the vault.
  EXECUTION_MODE: z.enum(["shadow", "live"]).default("shadow"),
  // Hard lock: unless set, the client refuses every non-GET request to mainnet (orders, leverage,
  // margin, TWAP, cancels) before it leaves the process. Mainnet stays read-only by default.
  ALLOW_MAINNET_WRITES: bool,

  STRIKE_API_PUBLIC_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/).optional(),
  STRIKE_API_PRIVATE_KEY: z.string().regex(/^([0-9a-fA-F]{64}|[0-9a-fA-F]{128})$/).optional(),
  STRIKE_VAULT_ID: z.string().optional(),
  // Defaults per env (both verified to resolve): app.strikefinance.org / testnet.strikefinance.org
  STRIKE_VAULT_URL_TEMPLATE: z.string().optional(),
  // The REST docs say PATH includes the query string. Flip this if `pnpm probe` says otherwise.
  SIGN_PATH_WITH_QUERY: z
    .string()
    .optional()
    .transform((v) => v !== "0" && v?.toLowerCase() !== "false"),

  BASKET_ID: z.string().default("crypto-majors"),
  // Used in shadow mode when there is no vault to read equity from.
  SHADOW_EQUITY_USD: z.coerce.number().positive().default(1000),
  // Strike tier-0 taker fee is 0.050% (docs fee schedule); charged on every paper fill.
  PAPER_TAKER_FEE_BPS: z.coerce.number().min(0).default(5),

  // Rebalancer
  GROSS_EXPOSURE: z.coerce.number().positive().max(1, "GROSS_EXPOSURE above 1 means leverage; refused").default(0.9),
  DRIFT_THRESHOLD_BPS: z.coerce.number().int().positive().default(500),
  MIN_NOTIONAL_BUFFER: z.coerce.number().min(1).default(1.2),
  MAX_LEG_NOTIONAL_USD: z.coerce.number().positive().default(2000),
  MAX_RUN_NOTIONAL_USD: z.coerce.number().positive().default(5000),
  REBALANCE_COOLDOWN_MIN: z.coerce.number().min(0).default(30),

  // Execution
  MARGIN_MODE: z.enum(["cross", "isolated"]).default("cross"),
  SYMBOL_LEVERAGE: z.coerce.number().int().min(1).max(5).default(2),
  MAX_SLIPPAGE: z.coerce.number().positive().max(0.05).default(0.01),
  EXECUTOR: z.enum(["batch", "twap"]).default("batch"),
  TWAP_MIN_NOTIONAL_USD: z.coerce.number().positive().default(500),
  TWAP_DURATION_SEC: z.coerce.number().int().min(300).max(86400).default(600),
  ORDER_CONFIRM_TIMEOUT_SEC: z.coerce.number().int().positive().default(30),

  // Market gates
  MAX_SPREAD_BPS: z.coerce.number().positive().default(50),
  MAX_MARK_MID_DEVIATION_BPS: z.coerce.number().positive().default(100),
  MAX_BOOK_AGE_SEC: z.coerce.number().positive().default(60),
  INDEX_FROZEN_MIN: z.coerce.number().positive().default(30),
  BLOCK_ON_FROZEN_INDEX: bool,

  // Personal mode (Builder Connect): users connect their own Strike account and the engine
  // rebalances it. Testnet only while mainnet is write-locked (Builder Connect is a POST).
  PERSONAL_MODE: bool,
  BUILDER_CODE: z.string().optional(),
  BUILDER_FEE_BPS: z.coerce.number().int().min(0).max(100).default(10),
  // 64 hex chars (32 bytes). Encrypts user API-wallet keys at rest. Losing it disconnects every user.
  PERSONAL_SECRET: z.string().regex(/^[0-9a-fA-F]{64}$/).optional(),
  PERSONAL_MAX_USERS: z.coerce.number().int().positive().default(50),
  PERSONAL_MAX_BUDGET_USD: z.coerce.number().positive().default(5000),

  // Service
  CYCLE_SECONDS: z.coerce.number().int().min(15).default(300),
  PORT: z.coerce.number().int().default(8787),
  HOST: z.string().default("0.0.0.0"),
  CORS_ORIGIN: z.string().default("*"),
  ADMIN_TOKEN: z.string().min(16).optional(),
  DB_PATH: z.string().default("data/baskets.db"),
  LOG_LEVEL: z.string().default("info"),
});

export type Config = z.infer<typeof schema> & { urls: (typeof STRIKE_ENVS)[StrikeEnv] };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  const c = parsed.data;
  if (c.EXECUTION_MODE === "live") {
    if (!c.STRIKE_API_PUBLIC_KEY || !c.STRIKE_API_PRIVATE_KEY || !c.STRIKE_VAULT_ID) {
      throw new Error("EXECUTION_MODE=live needs STRIKE_API_PUBLIC_KEY, STRIKE_API_PRIVATE_KEY and STRIKE_VAULT_ID");
    }
    if (c.STRIKE_ENV === "mainnet" && !c.ALLOW_MAINNET_WRITES) {
      throw new Error("Live trading on mainnet needs ALLOW_MAINNET_WRITES=yes (mainnet is read-only by default)");
    }
  }
  if (c.PERSONAL_MODE && (!c.BUILDER_CODE || !c.PERSONAL_SECRET)) {
    throw new Error("PERSONAL_MODE=yes needs BUILDER_CODE and PERSONAL_SECRET (openssl rand -hex 32)");
  }
  return { ...c, urls: STRIKE_ENVS[c.STRIKE_ENV] };
}

export function vaultUrl(c: Config): string | null {
  const template = c.STRIKE_VAULT_URL_TEMPLATE ?? `${c.urls.app}/vaults/{vaultId}`;
  return c.STRIKE_VAULT_ID ? template.replace("{vaultId}", c.STRIKE_VAULT_ID) : null;
}
