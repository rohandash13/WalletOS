/**
 * scripts/setup-wallet.ts
 *
 * One-time testnet bootstrap + end-to-end rail proof. Run with:
 *   npx tsx scripts/setup-wallet.ts
 *
 * What it does:
 *   1. Loads CDP keys from .env.local
 *   2. Creates (or loads) the named CDP server wallet on Base Sepolia
 *   3. Funds it programmatically via the CDP faucet (ETH for gas + USDC)
 *   4. Waits for the faucet deposits to confirm
 *   5. Sends a REAL on-chain USDC transfer to a second account and prints the
 *      explorer link so you can verify it on sepolia.basescan.org
 *
 * No website faucet, no manual steps.
 */

import { config } from "dotenv";
import { CdpClient } from "@coinbase/cdp-sdk";

// Load .env.local explicitly (tsx scripts don't get Next.js env loading).
config({ path: ".env.local" });

const NETWORK = "base-sepolia" as const;
const USDC_DECIMALS = 6;
const TX = "https://sepolia.basescan.org/tx/";
const ADDR = "https://sepolia.basescan.org/address/";

const MAIN_ACCOUNT = process.env.CDP_ACCOUNT_NAME ?? "walletos-demo";
const RECIPIENT_ACCOUNT = `${MAIN_ACCOUNT}-recipient`;
/** USDC to move in the proof transfer. */
const PROOF_AMOUNT_USDC = 0.5;

function formatUnits(atomic: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const whole = atomic / base;
  const frac = (atomic % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

function parseUsdc(amount: number): bigint {
  // Avoid floating-point drift: scale via string math at 6 decimals.
  const [whole, frac = ""] = amount.toString().split(".");
  const fracPadded = (frac + "000000").slice(0, USDC_DECIMALS);
  return BigInt(whole) * 10n ** BigInt(USDC_DECIMALS) + BigInt(fracPadded || "0");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Account = Awaited<ReturnType<CdpClient["evm"]["getOrCreateAccount"]>>;

async function balances(account: Account) {
  const { balances } = await account.listTokenBalances({ network: NETWORK });
  const get = (sym: string) =>
    balances.find((b) => b.token.symbol?.toLowerCase() === sym.toLowerCase());
  const usdc = get("usdc");
  const eth = get("eth");
  return {
    usdc: usdc ? Number(formatUnits(usdc.amount.amount, usdc.amount.decimals)) : 0,
    eth: eth ? Number(formatUnits(eth.amount.amount, eth.amount.decimals)) : 0,
  };
}

/** Poll until a balance predicate is satisfied, or time out. */
async function waitFor(
  account: Account,
  label: string,
  predicate: (b: { usdc: number; eth: number }) => boolean,
  { timeoutMs = 90_000, intervalMs = 3_000 } = {},
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const b = await balances(account);
    if (predicate(b)) {
      console.log(`   ✓ ${label}: ETH=${b.eth} USDC=${b.usdc}`);
      return;
    }
    await sleep(intervalMs);
  }
  const b = await balances(account);
  throw new Error(
    `Timed out waiting for ${label}. Current: ETH=${b.eth} USDC=${b.usdc}`,
  );
}

async function fund(account: Account, token: "eth" | "usdc") {
  try {
    const { transactionHash } = await account.requestFaucet({ network: NETWORK, token });
    console.log(`   faucet ${token.toUpperCase()} requested → ${TX}${transactionHash}`);
  } catch (err) {
    // Faucet rate-limits per token; if we're already funded that's fine.
    console.log(`   faucet ${token.toUpperCase()} skipped: ${(err as Error).message}`);
  }
}

async function main() {
  for (const k of ["CDP_API_KEY_ID", "CDP_API_KEY_SECRET", "CDP_WALLET_SECRET"]) {
    if (!process.env[k]) {
      throw new Error(`Missing ${k} in .env.local`);
    }
  }

  const cdp = new CdpClient();

  console.log("\n=== 1. Wallet ===");
  const wallet = await cdp.evm.getOrCreateAccount({ name: MAIN_ACCOUNT });
  console.log(`   name:    ${MAIN_ACCOUNT}`);
  console.log(`   address: ${wallet.address}`);
  console.log(`   explorer: ${ADDR}${wallet.address}`);

  const recipient = await cdp.evm.getOrCreateAccount({ name: RECIPIENT_ACCOUNT });
  console.log(`   recipient (${RECIPIENT_ACCOUNT}): ${recipient.address}`);

  console.log("\n=== 2. Fund via CDP faucet ===");
  const before = await balances(wallet);
  console.log(`   before: ETH=${before.eth} USDC=${before.usdc}`);
  await fund(wallet, "eth");
  await fund(wallet, "usdc");

  console.log("\n=== 3. Wait for confirmation ===");
  await waitFor(wallet, "gas funded", (b) => b.eth > 0);
  await waitFor(wallet, "usdc funded", (b) => b.usdc >= PROOF_AMOUNT_USDC);

  console.log("\n=== 4. Proof transfer (real on-chain USDC) ===");
  console.log(`   sending ${PROOF_AMOUNT_USDC} USDC → ${recipient.address}`);
  const { transactionHash } = await wallet.transfer({
    to: recipient.address,
    amount: parseUsdc(PROOF_AMOUNT_USDC),
    token: "usdc",
    network: NETWORK,
  });
  console.log(`   tx hash: ${transactionHash}`);
  console.log(`   verify:  ${TX}${transactionHash}`);

  console.log("\n=== 5. Confirm recipient received funds ===");
  await waitFor(recipient, "recipient credited", (b) => b.usdc >= PROOF_AMOUNT_USDC);

  const senderAfter = await balances(wallet);
  console.log(`\n   sender after:    ETH=${senderAfter.eth} USDC=${senderAfter.usdc}`);
  console.log("\n✅ Done. Real Base Sepolia USDC transfer verified.\n");
}

main().catch((err) => {
  console.error("\n❌ setup-wallet failed:\n", err);
  process.exit(1);
});
