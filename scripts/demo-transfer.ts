/**
 * scripts/demo-transfer.ts — fire a single send_payment to the demo recipient,
 * exercising the SAME code path recurring_transfer automations use on payday.
 * Settles real (scaled) test USDC on-chain from the user wallet — no faucet.
 *
 * Run: npx tsx scripts/demo-transfer.ts            (defaults: $50 -> demo recipient)
 *      DEMO_TRANSFER_AMOUNT=25 npx tsx scripts/demo-transfer.ts
 */
import { config } from "dotenv";

config({ path: ".env.local" });

async function main() {
  const { getWallet } = await import("../lib/wallet");
  const { setBucket } = await import("../lib/redis");
  const { executeTool } = await import("../lib/tools");

  const wallet = getWallet();
  const to =
    process.env.DEMO_RECIPIENT_ADDRESS ??
    (await wallet.resolveAddress(
      process.env.DEMO_RECIPIENT_ACCOUNT_NAME ?? "walletos-demo-recipient",
    ));
  const amount = Number(process.env.DEMO_TRANSFER_AMOUNT ?? 50);

  // Seed the (in-process) ledger so the bucket guard passes; the on-chain send is real.
  await setBucket("available", 5000);

  console.log(`Sending $${amount} to ${to} ...`);
  const outcome = await executeTool("send_payment", { to, amount, note: "Demo automation transfer" });
  console.log(JSON.stringify(outcome, null, 2));
}

main().catch((err) => {
  console.error("demo-transfer failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
