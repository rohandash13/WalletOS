/**
 * scripts/faucet.ts — top up the demo wallet with testnet ETH (gas) + USDC.
 *
 *   npm run faucet
 *
 * Useful to refill between demo runs (on-chain test USDC gets consumed by real
 * settlements). The CDP faucet is rate-limited per token, so this is best-effort.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { getWallet } from "../lib/wallet";

async function main() {
  const wallet = getWallet();
  const address = await wallet.getAddress();
  console.log("wallet:", address);

  for (const token of ["eth", "usdc"] as const) {
    try {
      const tx = await wallet.requestFaucet(token);
      console.log(`  faucet ${token.toUpperCase()} → ${wallet.explorerUrl(tx)}`);
    } catch (err) {
      console.log(`  faucet ${token.toUpperCase()} skipped: ${(err as Error).message}`);
    }
  }

  // Give the deposits a few seconds to confirm, then report balances.
  await new Promise((r) => setTimeout(r, 6000));
  console.log(`  balances: ETH=${await wallet.getEthBalance()} USDC=${await wallet.getUsdcBalance()}`);
}

main().catch((e) => {
  console.error("faucet failed:", e);
  process.exit(1);
});
