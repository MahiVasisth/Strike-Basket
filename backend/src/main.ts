import { loadConfig } from "./config.js";
import { loadAllBaskets, loadBasket } from "./core/basket.js";
import { Store } from "./db/db.js";
import { EventBus } from "./engine/events.js";
import { BasketEngine } from "./engine/engine.js";
import { buildServer } from "./api/server.js";
import { StrikeClient } from "./strike/client.js";
import { PersonalManager } from "./personal/manager.js";

const cfg = loadConfig();
const basket = loadBasket(cfg.BASKET_ID);
const store = new Store(cfg.DB_PATH);
const bus = new EventBus(store);
const client = new StrikeClient(cfg);
const engine = new BasketEngine(cfg, client, store, bus, basket);
const personal = new PersonalManager(cfg, client, store, new Map(loadAllBaskets().map((b) => [b.id, b])));
const app = await buildServer(engine, bus, personal);

if (!cfg.ADMIN_TOKEN) app.log.warn("ADMIN_TOKEN not set: admin routes (pause, rebalance, flatten) are disabled");
app.log.info(
  { env: cfg.STRIKE_ENV, mode: cfg.EXECUTION_MODE, basket: `${basket.id}@v${basket.version}`, vault: cfg.STRIKE_VAULT_ID ?? "(paper)" },
  "strike-baskets starting",
);

await app.listen({ port: cfg.PORT, host: cfg.HOST });
engine.start().catch((err) => app.log.error({ err }, "engine start failed"));
personal
  .start((userId, err) => app.log.warn({ userId, err: (err as Error).message }, "personal account skipped at startup: the user must reconnect"))
  .catch((err) => app.log.error({ err }, "personal mode start failed"));
if (personal.enabled) app.log.info({ builderCode: cfg.BUILDER_CODE, feeBps: cfg.BUILDER_FEE_BPS }, "personal mode enabled");

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    engine.stop();
    personal.stop();
    await app.close();
    process.exit(0);
  });
}
