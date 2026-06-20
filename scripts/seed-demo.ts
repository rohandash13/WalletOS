/**
 * scripts/seed-demo.ts — seed the demo paycheck against a RUNNING dev server.
 *
 *   npm run dev            # in one terminal
 *   npm run seed:demo      # in another
 *
 * It POSTs to /api/demo/seed so the seed lands in the same process that serves the
 * API (important when using the in-memory store — a separate script process has its
 * own memory). Override with env: SEED_AMOUNT, SEED_RESET=1, BASE_URL.
 */

import { config } from "dotenv";

config({ path: ".env.local" });

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const amount = Number(process.env.SEED_AMOUNT ?? 2000);
const reset = process.env.SEED_RESET === "1";

async function main() {
  const res = await fetch(`${BASE_URL}/api/demo/seed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount, reset }),
  });
  if (!res.ok) {
    throw new Error(`seed failed (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  console.log(`✅ Seeded ${amount} USDC paycheck (reset=${reset}).`);
  console.log("   portfolio:", JSON.stringify(data.portfolio));
}

main().catch((err) => {
  console.error("❌ seed-demo failed:", err.message);
  console.error("   Is the dev server running? (npm run dev)");
  process.exit(1);
});
