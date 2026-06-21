/**
 * scripts/demo-recipient.ts — print a dedicated demo recipient wallet address.
 *
 * Resolves (create-or-load) a CDP account you can paste into recurring_transfer
 * automations, so payday transfers settle to a wallet you can watch on BaseScan.
 *
 * Run: npx tsx scripts/demo-recipient.ts
 */
import { config } from "dotenv";
import { getWallet } from "../lib/wallet";
import { toDemoUsd, scaleLabel } from "../lib/money";

config({ path: ".env.local" });

const NAME = process.env.DEMO_RECIPIENT_ACCOUNT_NAME ?? "walletos-demo-recipient";

async function main() {
  const wallet = getWallet();
  const address = await wallet.resolveAddress(NAME);
  const usdc = await wallet.getUsdcBalanceForAccount(NAME);

  console.log("Demo recipient wallet");
  console.log(`  account: ${NAME}`);
  console.log(`  address: ${address}`);
  console.log(`  USDC:    ${usdc}  (USD eq: ${toDemoUsd(usdc)} — ${scaleLabel()})`);
  console.log(`  explorer: ${wallet.addressUrl(address)}`);
}

main().catch((err) => {
  console.error("demo-recipient failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
