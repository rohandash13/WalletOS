import { config } from "dotenv";

config({ path: ".env.local" });

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const amount = Number(process.env.PAYDAY_AMOUNT ?? 2000);

async function main() {
  const res = await fetch(`${BASE_URL}/api/payday`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount, autoFundPayroll: true }),
  });
  if (!res.ok) throw new Error(`payday failed (${res.status}): ${await res.text()}`);
  console.log(JSON.stringify(await res.json(), null, 2));
}

main().catch((err) => {
  console.error("payday failed:", err.message);
  process.exit(1);
});
