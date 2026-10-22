// Generate an Ed25519 API wallet keypair for Strike.
// Register the public key as an API wallet on your Strike account, then put both in .env.
// The private key never leaves this machine; API wallets can trade but cannot withdraw.

import { generateApiWallet } from "../strike/sign.js";

const { publicKeyHex, privateKeyHex } = generateApiWallet();
console.log(`STRIKE_API_PUBLIC_KEY=${publicKeyHex}`);
console.log(`STRIKE_API_PRIVATE_KEY=${privateKeyHex}`);
