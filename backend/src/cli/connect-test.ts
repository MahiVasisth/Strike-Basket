// End-to-end Builder Connect check on testnet with a throwaway wallet (no funds involved):
// request challenge → sign it → verify → call Strike with the linked API wallet.
//
//   BUILDER_CODE=StrikeBasket PERSONAL_SECRET=<hex> pnpm connect-test                    # Ethereum (EIP-191, like MetaMask)
//   BUILDER_CODE=StrikeBasket PERSONAL_SECRET=<hex> pnpm connect-test --chain cardano    # Cardano (CIP-30 signData, like Lace)

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { loadConfig } from "../config.js";
import { loadAllBaskets } from "../core/basket.js";
import { Store, UserStore } from "../db/db.js";
import { PersonalManager } from "../personal/manager.js";
import { decryptSecret } from "../personal/secrets.js";
import { StrikeClient } from "../strike/client.js";
import { loadApiWallet } from "../strike/sign.js";
import { TestCardanoWallet } from "./cardano-wallet.js";

const cfg = loadConfig({ ...process.env, STRIKE_ENV: "testnet", EXECUTION_MODE: "shadow", PERSONAL_MODE: "yes" });
const client = new StrikeClient(cfg);
const store = new Store(":memory:");
const pm = new PersonalManager(cfg, client, store, new Map(loadAllBaskets().map((b) => [b.id, b])));
await client.syncClock();

const chain = (process.argv.includes("--chain") ? process.argv[process.argv.indexOf("--chain") + 1] : undefined) ?? "ethereum";
let address: string;
let signMessage: (m: string) => Promise<string>;
if (chain === "cardano") {
  const w = new TestCardanoWallet();
  address = w.address;
  signMessage = async (m) => w.signData(m);
} else {
  const account = privateKeyToAccount(generatePrivateKey());
  address = account.address;
  signMessage = (m) => account.signMessage({ message: m });
}
console.log(`throwaway ${chain} wallet ${address}`);

const req = await pm.requestConnect({ address, chain: chain as "ethereum" | "cardano", basketId: "crypto-majors", budgetUsd: 500 });
console.log("1. challenge received");
const signature = await signMessage(req.messageToSign);
const { user } = await pm.confirmConnect({ connectId: req.connectId, signature });
console.log(`2. Strike verified the signature and linked our key → account ${user.accountId}`);

const row = new UserStore(store).activeByAddress(chain, address)!;
const wallet = loadApiWallet(row.api_pubkey, decryptSecret(row.api_secret_enc!, cfg.PERSONAL_SECRET!));
const acct = await client.forWallet(wallet, cfg.BUILDER_FEE_BPS).account();
console.log(`3. authenticated as the user with the linked API wallet → account ${acct.account_id}, equity $${acct.margin_balance}`);
console.log("\nBuilder Connect works end to end. (Empty wallet, so no trades.)");
process.exit(0);
