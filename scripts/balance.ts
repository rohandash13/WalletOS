import { config } from "dotenv";
import { getWallet } from "../lib/wallet";
import { toDemoUsd, scaleLabel } from "../lib/money";

config({ path: ".env.local" });

const payrollAccount = process.env.CDP_PAYROLL_ACCOUNT_NAME ?? "walletos-payroll";

async function main() {
  const wallet = getWallet();
  const address = await wallet.getAddress();
  const [userUsdc, userEth, payrollAddress, payrollUsdc] = await Promise.all([
    wallet.getUsdcBalance(),
    wallet.getEthBalance(),
    wallet.resolveAddress(payrollAccount),
    wallet.getUsdcBalanceForAccount(payrollAccount),
  ]);

  console.log("User wallet");
  console.log(`  address: ${address}`);
  console.log(`  ETH:     ${userEth}`);
  console.log(`  USDC:    ${userUsdc}`);
  console.log(`  USD eq:  ${toDemoUsd(userUsdc)} (${scaleLabel()})`);
  console.log(`  explorer: ${wallet.addressUrl(address)}`);

  console.log("\nPayroll wallet");
  console.log(`  name:    ${payrollAccount}`);
  console.log(`  address: ${payrollAddress}`);
  console.log(`  USDC:    ${payrollUsdc}`);
  console.log(`  USD eq:  ${toDemoUsd(payrollUsdc)} (${scaleLabel()})`);
  console.log(`  explorer: ${wallet.addressUrl(payrollAddress)}`);
}

main().catch((err) => {
  console.error("balance check failed:", err.message);
  process.exit(1);
});
