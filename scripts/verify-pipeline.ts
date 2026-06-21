/**
 * scripts/verify-pipeline.ts — hermetic verification of the money math + agent
 * routing, WITHOUT touching the CDP wallet or the testnet faucet.
 *
 * It forces the in-memory Redis store (by clearing any Upstash env) and exercises
 * the REAL code paths that don't settle on-chain:
 *   - the bucket ledger (adjustBucket / moveBetweenBuckets / getPortfolio)
 *   - the real non-chain tool handlers (create_automation protect, rebalance_funds)
 *   - the real agent selector (selectAgent) + scale math (toChainUsdc/toDemoUsd)
 *
 * On-chain settlement (payday payroll transfer, send_payment, route_to_agent
 * transfer) is intentionally simulated at the ledger layer using the exact same
 * operations the real handlers apply, so no faucet quota is consumed.
 *
 * Run: npx tsx scripts/verify-pipeline.ts
 */

// Force the memory store: never talk to real Upstash from a test.
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

let failures = 0;
let checks = 0;

function approx(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-6;
}

function assert(label: string, cond: boolean, detail?: string) {
  checks += 1;
  if (cond) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${label}${detail ? `  — ${detail}` : ""}`);
  }
}

function eq(label: string, actual: number, expected: number) {
  assert(label, approx(actual, expected), `got ${actual}, expected ${expected}`);
}

async function main() {
  const {
    setBucket,
    getPortfolio,
    adjustBucket,
    moveBetweenBuckets,
    addPendingApproval,
    listPendingApprovals,
    removePendingApproval,
  } = await import("../lib/redis");
  const { executeTool } = await import("../lib/tools");
  const { selectAgent, resolveAgent } = await import("../lib/marketplace");
  const { toChainUsdc, toDemoUsd } = await import("../lib/money");

  /* ---------------------------------------------------------------- scale -- */
  console.log("\n[scale] 1 test USDC = $1,000");
  eq("$2,000 paycheck -> 2 USDC on-chain", toChainUsdc(2000), 2);
  eq("$50 send -> 0.05 USDC on-chain", toChainUsdc(50), 0.05);
  eq("$750 invest -> 0.75 USDC on-chain", toChainUsdc(750), 0.75);
  eq("2 USDC -> $2,000 USD-eq", toDemoUsd(2), 2000);

  /* ------------------------------------------------ user's worked example -- */
  console.log("\n[ledger] user's payday example (Available 5000 start)");
  // Start: Available = 5000
  await setBucket("available", 5000);
  await setBucket("rent", 0);
  await setBucket("stable_invest", 0);
  await setBucket("savings", 0);
  eq("start Available", (await getPortfolio()).available, 5000);

  // Paycheck: +2000 (payday.ts credits Available by the gross amount)
  await adjustBucket("available", 2000);
  eq("after paycheck Available", (await getPortfolio()).available, 7000);

  // Send sister $50 (send_payment debits the from-bucket by the demo amount)
  await adjustBucket("available", -50);
  eq("after sister Available", (await getPortfolio()).available, 6950);

  // Move to Protected $1200 — REAL protect handler (immediate ledger move).
  const protect = await executeTool("create_automation", {
    type: "protect_bucket",
    bucket: "rent",
    amount: 1200,
  });
  assert("protect handler ok", protect.ok);
  {
    const p = await getPortfolio();
    eq("after protect Available", p.available, 5750);
    eq("after protect Protected(rent)", p.rent, 1200);
  }

  // Move to Invested $750 (route_to_agent applies this exact ledger move).
  await moveBetweenBuckets("available", "stable_invest", 750);
  {
    const p = await getPortfolio();
    eq("final Available", p.available, 5000);
    eq("final Protected(rent)", p.rent, 1200);
    eq("final Invested(stable_invest)", p.stable_invest, 750);
    const total = p.available + p.rent + p.stable_invest + p.savings;
    eq("final Total portfolio", total, 6950);
  }

  /* --------------------------------------------- rebalance: "I need $200 back" */
  console.log('\n[ledger] rebalance — "I need $200 back" (real handler)');
  const reb = await executeTool("rebalance_funds", { amount: 200 });
  assert("rebalance ok", reb.ok);
  {
    const p = await getPortfolio();
    eq("rebalance Available", p.available, 5200);
    eq("rebalance Invested pulled from", p.stable_invest, 550);
    eq("rebalance left Protected untouched", p.rent, 1200);
  }

  /* ----------------------------------------- protect guard: insufficient avail */
  console.log("\n[guard] protect more than Available is refused");
  await setBucket("available", 100);
  const overProtect = await executeTool("create_automation", {
    type: "protect_bucket",
    bucket: "rent",
    amount: 1000,
  });
  assert("over-protect refused", overProtect.ok === false, JSON.stringify(overProtect.result));

  /* ----------------------------------------------------- agent selection ---- */
  console.log("\n[agents] correct agent per risk score + amount");
  const pick = (risk: number, amount: number) => selectAgent(risk, amount).id;

  eq2("risk 1 -> savings", pick(1, 100), "savings");
  eq2("risk 2 -> savings", pick(2, 100), "savings");
  eq2("risk 3 -> stable_invest", pick(3, 100), "stable_invest");
  eq2("risk 4 -> stable_invest", pick(4, 750), "stable_invest");
  eq2("risk 5 -> balanced_growth", pick(5, 100), "balanced_growth");
  eq2("risk 6 -> balanced_growth", pick(6, 100), "balanced_growth");
  eq2("risk 7 + $500 -> growth", pick(7, 500), "growth");
  eq2("risk 8 + $500 -> growth", pick(8, 500), "growth");
  eq2("risk 9 + $1000 -> high_yield", pick(9, 1000), "high_yield");
  eq2("risk 10 + $2000 -> high_yield", pick(10, 2000), "high_yield");

  console.log("\n[agents] min-amount gating + step-down");
  eq2("risk 7 + $499 steps down -> balanced_growth", pick(7, 499), "balanced_growth");
  eq2("risk 9 + $999 steps down -> growth", pick(9, 999), "growth");
  eq2("risk 9 + $400 steps down -> balanced_growth", pick(9, 400), "balanced_growth");
  eq2("risk 10 + $50 steps down -> balanced_growth", pick(10, 50), "balanced_growth");

  console.log("\n[agents] resolve by display name (not just id)");
  eq2("'Stable-Invest' -> stable_invest", (await resolveAgent("Stable-Invest"))?.id ?? "?", "stable_invest");
  eq2("'balanced growth' -> balanced_growth", (await resolveAgent("balanced growth"))?.id ?? "?", "balanced_growth");
  eq2("'High-Yield' -> high_yield", (await resolveAgent("High-Yield"))?.id ?? "?", "high_yield");
  eq2("raw id still resolves", (await resolveAgent("savings"))?.id ?? "?", "savings");
  eq2("'Savings Agent' (UI label) -> savings", (await resolveAgent("Savings Agent"))?.id ?? "?", "savings");
  eq2("'balanced growth agent' -> balanced_growth", (await resolveAgent("balanced growth agent"))?.id ?? "?", "balanced_growth");

  console.log("\n[approvals] pending-approval store add/list/remove");
  await addPendingApproval({
    id: "appr_test",
    kind: "transfer",
    amount: 30,
    to: "0xabc",
    note: "phone bill",
    createdAt: Date.now(),
  });
  eq("one pending after add", (await listPendingApprovals()).length, 1);
  eq2("removed returns the item", (await removePendingApproval("appr_test"))?.id ?? "?", "appr_test");
  eq("none pending after remove", (await listPendingApprovals()).length, 0);

  /* -------------------------------------------------------------- summary --- */
  console.log(
    `\n${failures === 0 ? "PASS" : "FAIL"} — ${checks - failures}/${checks} checks passed`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

function eq2(label: string, actual: string, expected: string) {
  checks += 1;
  if (actual === expected) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${label}  — got ${actual}, expected ${expected}`);
  }
}

main().catch((err) => {
  console.error("verify-pipeline crashed:", err);
  process.exit(1);
});
