// End-to-end Builder Connect check on testnet with a throwaway Ethereum wallet (no funds involved):
// request challenge → sign it (EIP-191) → verify → call Strike with the linked API wallet.
//
//   PERSONAL_MODE=yes BUILDER_CODE=StrikeBasket PERSONAL_SECRET=<hex> pnpm connect-test

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { loadConfig } from "../config.js";
import { loadAllBaskets } from "../core/basket.js";
import { Store, UserStore } from "../db/db.js";
import { PersonalManager } from "../personal/manager.js";
import { decryptSecret } from "../personal/secrets.js";
import { StrikeClient } from "../strike/client.js";
import { loadApiWallet } from "../strike/sign.js";

const cfg = loadConfig({ ...process.env, STRIKE_ENV: "testnet", EXECUTION_MODE: "shadow", PERSONAL_MODE: "yes" });
const client = new StrikeClient(cfg);
const store = new Store(":memory:");
const pm = new PersonalManager(cfg, client, store, new Map(loadAllBaskets().map((b) => [b.id, b])));
await client.syncClock();

const account = privateKeyToAccount(generatePrivateKey());
console.log(`throwaway wallet ${account.address}`);

const req = await pm.requestConnect({ address: account.address, chain: "ethereum", basketId: "crypto-majors", budgetUsd: 500 });
console.log("1. challenge received");
const signature = await account.signMessage({ message: req.messageToSign });
const { user } = await pm.confirmConnect({ connectId: req.connectId, signature });
console.log(`2. Strike verified the signature and linked our key → account ${user.accountId}`);

const row = new UserStore(store).activeByAddress("ethereum", account.address)!;
const wallet = loadApiWallet(row.api_pubkey, decryptSecret(row.api_secret_enc!, cfg.PERSONAL_SECRET!));
const acct = await client.forWallet(wallet, cfg.BUILDER_FEE_BPS).account();
console.log(`3. authenticated as the user with the linked API wallet → account ${acct.account_id}, equity $${acct.margin_balance}`);
console.log("\nBuilder Connect works end to end. (Empty wallet, so no trades.)");
process.exit(0);
