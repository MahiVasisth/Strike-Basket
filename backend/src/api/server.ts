import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { vaultUrl } from "../config.js";
import { loadAllBaskets } from "../core/basket.js";
import type { BasketEngine } from "../engine/engine.js";
import type { EventBus } from "../engine/events.js";
import type { RunRow, Store } from "../db/db.js";
import { MainnetWriteBlocked } from "../strike/client.js";
import { CHAINS, PersonalError, type PersonalManager } from "../personal/manager.js";

// Public, read-only API for the web app, plus a few admin routes behind ADMIN_TOKEN.
// The contract is documented in docs/FRONTEND.md; keep the two in sync.

function runSummary(r: RunRow) {
  const plan = JSON.parse(r.plan_json);
  return {
    id: r.id,
    createdAt: r.created_at,
    finishedAt: r.finished_at,
    env: r.env,
    mode: r.mode,
    basketId: r.basket_id,
    basketVersion: r.basket_version,
    trigger: r.trigger,
    status: r.status,
    equity: r.equity,
    maxDriftBps: r.max_drift_bps,
    legCount: plan.legs.length,
    error: r.error,
  };
}

function runDetail(store: Store, r: RunRow) {
  return {
    ...runSummary(r),
    plan: JSON.parse(r.plan_json),
    gates: JSON.parse(r.gates_json),
    legs: store.legsForRun(r.id).map((l) => ({
      idx: l.idx,
      symbol: l.symbol,
      side: l.side,
      qty: l.qty,
      notionalEst: l.notional_est,
      mark: l.mark,
      reduceOnly: l.reduce_only === 1,
      method: l.method,
      clientOrderId: l.client_order_id,
      strikeOrderId: l.strike_order_id,
      twapId: l.twap_id,
      status: l.status,
      filledQty: l.filled_qty,
      avgPrice: l.avg_price,
      error: l.error,
      updatedAt: l.updated_at,
    })),
  };
}

/**
 * Where to invest: our vault as Strike lists it, so users can find exactly this vault on Strike.
 * Terms come from Strike's public vault record (refreshed every cycle), never typed by hand.
 */
function vaultInfo(engine: BasketEngine) {
  const { cfg } = engine;
  const v = engine.lastVault;
  return {
    id: cfg.STRIKE_VAULT_ID ?? null,
    url: vaultUrl(cfg),
    /** Strike's vault list, for "Strike → Vaults → search <name>". */
    listUrl: `${cfg.urls.app}/vaults`,
    name: v?.name ?? null,
    status: v?.status ?? null,
    minDepositUsd: v?.min_deposit ?? null,
    lockupDays: v?.lockup_days ?? null,
    leaderCommissionBps: v?.leader_commission_bps ?? null,
    depositors: v?.depositors ?? null,
    sharePrice: v?.share_price ?? null,
    equity: v?.equity ?? null,
  };
}

export async function buildServer(engine: BasketEngine, bus: EventBus, personal?: PersonalManager) {
  const { cfg, store, basket } = engine;
  const app = Fastify({ logger: { level: cfg.LOG_LEVEL } });
  await app.register(cors, { origin: cfg.CORS_ORIGIN === "*" ? true : cfg.CORS_ORIGIN.split(",") });

  const requireAdmin = async (req: FastifyRequest, reply: FastifyReply) => {
    const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    const expected = cfg.ADMIN_TOKEN;
    const ok = !!expected && token.length === expected.length && timingSafeEqual(Buffer.from(token), Buffer.from(expected));
    if (!ok) return reply.code(401).send({ error: "unauthorized" });
  };

  app.get("/api/health", async () => ({
    ok: engine.lastError === null,
    env: cfg.STRIKE_ENV,
    mode: cfg.EXECUTION_MODE,
    source: engine.source,
    paused: store.isPaused(),
    lastTickAt: engine.lastTickAt,
    nextTickAt: engine.nextTickAt,
    cycleSeconds: cfg.CYCLE_SECONDS,
    lastError: engine.lastError,
  }));

  app.get("/api/basket", async () => ({
    id: basket.id,
    version: basket.version,
    name: basket.name,
    tagline: basket.tagline,
    env: cfg.STRIKE_ENV,
    mode: cfg.EXECUTION_MODE,
    source: engine.source,
    constituents: basket.constituents,
    vault: vaultInfo(engine),
    rules: {
      grossExposure: cfg.GROSS_EXPOSURE,
      driftThresholdBps: cfg.DRIFT_THRESHOLD_BPS,
      marginMode: cfg.MARGIN_MODE,
      symbolLeverage: cfg.SYMBOL_LEVERAGE,
      maxLegNotionalUsd: cfg.MAX_LEG_NOTIONAL_USD,
      maxRunNotionalUsd: cfg.MAX_RUN_NOTIONAL_USD,
      cooldownMin: cfg.REBALANCE_COOLDOWN_MIN,
      cycleSeconds: cfg.CYCLE_SECONDS,
      gates: {
        maxSpreadBps: cfg.MAX_SPREAD_BPS,
        maxMarkMidDeviationBps: cfg.MAX_MARK_MID_DEVIATION_BPS,
        maxBookAgeSec: cfg.MAX_BOOK_AGE_SEC,
      },
    },
  }));

  app.get("/api/baskets", async () =>
    loadAllBaskets().map((b) => ({
      id: b.id,
      name: b.name,
      tagline: b.tagline,
      status: b.id === basket.id ? "live" : "coming_soon",
      constituents: b.constituents,
    })),
  );

  app.get("/api/state", async (_req, reply) => {
    const s = engine.lastSnapshot;
    if (!s) return reply.code(503).send({ error: "no snapshot yet" });
    return {
      ts: s.ts,
      source: s.source,
      equity: s.equity,
      costs: s.costs,
      sharePrice: s.sharePrice,
      totalShares: s.totalShares,
      depositors: s.depositors,
      bookNotional: s.plan.bookNotional,
      maxDriftBps: s.plan.maxDriftBps,
      driftThresholdBps: cfg.DRIFT_THRESHOLD_BPS,
      pendingTrigger: s.plan.trigger,
      weights: s.plan.rows,
      gates: s.gates,
      warnings: s.plan.warnings,
      paused: store.isPaused(),
    };
  });

  app.get("/api/snapshots", async (req) => {
    const q = z
      .object({ since: z.coerce.number().default(Date.now() - 7 * 86_400_000), limit: z.coerce.number().max(5000).default(2000) })
      .parse(req.query);
    return store.listSnapshots(q.since, q.limit);
  });

  app.get("/api/rebalances", async (req) => {
    const q = z.object({ limit: z.coerce.number().max(500).default(50), all: z.coerce.boolean().default(false) }).parse(req.query);
    return store.listRuns({ limit: q.limit, actionsOnly: !q.all }).map(runSummary);
  });

  app.get("/api/rebalances/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = store.getRun(id);
    // Personal runs are private: only the owner sees them, via /api/me/rebalances/:id.
    if (!r || r.scope !== "main") return reply.code(404).send({ error: "not found" });
    return runDetail(store, r);
  });

  app.get("/api/events", async (req) => {
    const q = z.object({ limit: z.coerce.number().max(500).default(100) }).parse(req.query);
    return store.listEvents(q.limit);
  });

  // Server-sent events: snapshot, run.*, leg.updated, paused, resumed, error.
  app.get("/api/stream", (req, reply) => {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": (reply.getHeader("access-control-allow-origin") as string) ?? "*",
    });
    reply.raw.write(`retry: 3000\n\n`);
    const unsub = bus.subscribe((e) => reply.raw.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
    const ping = setInterval(() => reply.raw.write(`: ping\n\n`), 20_000);
    req.raw.on("close", () => {
      clearInterval(ping);
      unsub();
    });
  });

  // ---------- admin ----------
  app.post("/api/admin/pause", { preHandler: requireAdmin }, async () => {
    store.setPaused(true);
    bus.emit("paused", { by: "admin" });
    return { paused: true };
  });

  app.post("/api/admin/resume", { preHandler: requireAdmin }, async () => {
    store.setPaused(false);
    bus.emit("resumed", { by: "admin" });
    return { paused: false };
  });

  app.post("/api/admin/rebalance", { preHandler: requireAdmin }, async (req) => {
    const body = z.object({ force: z.boolean().default(false), dryRun: z.boolean().default(false) }).parse(req.body ?? {});
    const r = await engine.tick(body);
    return { runId: r.runId, status: r.status, trigger: r.plan.trigger, legs: r.plan.legs, skipped: r.plan.skipped, warnings: r.plan.warnings };
  });

  app.post("/api/admin/flatten", { preHandler: requireAdmin }, async (_req, reply) => {
    if (!store.isPaused()) return reply.code(409).send({ error: "pause first" });
    const r = await engine.tick({ flatten: true });
    return { runId: r.runId, status: r.status, legs: r.plan.legs };
  });

  if (personal?.enabled) registerPersonalRoutes(app, store, personal);

  return app;
}

// ---------- personal mode (Builder Connect) ----------

function registerPersonalRoutes(app: FastifyInstance, store: Store, pm: PersonalManager) {
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof PersonalError) return reply.code(err.status).send({ error: err.message });
    if (err instanceof z.ZodError) return reply.code(400).send({ error: "invalid request", issues: err.issues });
    if (err instanceof MainnetWriteBlocked) return reply.code(403).send({ error: "personal mode is testnet-only: mainnet is read-only" });
    const status = (err as { status?: number }).status;
    // Strike rejected the connect (bad signature, unknown builder code…): pass its message through.
    if (typeof status === "number" && status >= 400 && status < 500) return reply.code(400).send({ error: (err as Error).message });
    app.log.error({ err }, "request failed");
    return reply.code(500).send({ error: "internal error" });
  });

  const me = (req: FastifyRequest) => pm.authenticate((req.headers.authorization ?? "").replace(/^Bearer\s+/i, "") || undefined);

  app.get("/api/personal/baskets", async () => ({ builderFeeBps: pm.builderFeeBps, baskets: await pm.eligibility() }));

  app.post("/api/personal/connect/request", async (req) => {
    const body = z
      .object({
        address: z.string().min(10).max(200),
        chain: z.enum(CHAINS),
        basketId: z.string(),
        budgetUsd: z.number().positive(),
      })
      .parse(req.body);
    return pm.requestConnect(body);
  });

  app.post("/api/personal/connect/confirm", async (req) => {
    const body = z.object({ connectId: z.string().uuid(), signature: z.string().min(10).max(4000) }).parse(req.body);
    return pm.confirmConnect(body);
  });

  app.get("/api/me", async (req) => pm.view(me(req)));

  app.put("/api/me", async (req) => {
    const body = z.object({ basketId: z.string().optional(), budgetUsd: z.number().positive().optional() }).parse(req.body ?? {});
    return pm.update(me(req), body);
  });

  app.post("/api/me/pause", async (req) => pm.setPaused(me(req), true));
  app.post("/api/me/resume", async (req) => pm.setPaused(me(req), false));

  app.post("/api/me/rebalance", async (req) => {
    const body = z.object({ force: z.boolean().default(false), dryRun: z.boolean().default(false) }).parse(req.body ?? {});
    const r = await pm.rebalance(me(req), body);
    return { runId: r.runId, status: r.status, trigger: r.plan.trigger, legs: r.plan.legs, skipped: r.plan.skipped, warnings: r.plan.warnings };
  });

  app.post("/api/me/flatten", async (req) => {
    const r = await pm.flatten(me(req));
    return { runId: r.runId, status: r.status, legs: r.plan.legs };
  });

  app.delete("/api/me", async (req) => {
    pm.revoke(me(req));
    return {
      revoked: true,
      note: "Trading stopped and our key was deleted. Your positions stay in your Strike account. You can also remove the API wallet in Strike's settings.",
    };
  });

  app.get("/api/me/rebalances", async (req) => {
    const q = z.object({ limit: z.coerce.number().max(200).default(50) }).parse(req.query);
    return pm.runs(me(req), q.limit).map(runSummary);
  });

  app.get("/api/me/rebalances/:id", async (req, reply) => {
    const u = me(req);
    const r = store.getRun((req.params as { id: string }).id);
    if (!r || r.scope !== u.id) return reply.code(404).send({ error: "not found" });
    return runDetail(store, r);
  });
}
