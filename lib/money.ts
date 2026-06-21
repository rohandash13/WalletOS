export const DEMO_USD_PER_TEST_USDC = Number(process.env.DEMO_USD_PER_TEST_USDC ?? 1000);

export function toChainUsdc(demoUsd: number): number {
  if (!Number.isFinite(demoUsd) || demoUsd <= 0) return 0;
  return Math.round((demoUsd / DEMO_USD_PER_TEST_USDC) * 1e6) / 1e6;
}

export function toDemoUsd(chainUsdc: number): number {
  if (!Number.isFinite(chainUsdc) || chainUsdc <= 0) return 0;
  return Math.round(chainUsdc * DEMO_USD_PER_TEST_USDC * 100) / 100;
}

export function scaleLabel(): string {
  return `1 test USDC = $${DEMO_USD_PER_TEST_USDC.toLocaleString("en-US")} USD equivalent`;
}
