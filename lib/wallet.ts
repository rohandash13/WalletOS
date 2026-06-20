/**
 * lib/wallet.ts — CDP WalletService
 *
 * Thin wrapper around the Coinbase CDP SDK so the rest of the app never touches
 * the SDK directly. This keeps the money rail swappable (CDP today, anything that
 * implements this surface tomorrow) and is the ONLY place a spending policy is
 * enforced before funds move.
 *
 * Network: Base Sepolia testnet. Test USDC, no real value.
 */

import { CdpClient, parseUnits } from "@coinbase/cdp-sdk";

export const NETWORK = "base-sepolia" as const;
export const USDC_DECIMALS = 6;
const EXPLORER_TX_BASE = "https://sepolia.basescan.org/tx/";
const EXPLORER_ADDR_BASE = "https://sepolia.basescan.org/address/";

/** Name of the CDP server account. `getOrCreateAccount` is idempotent on this. */
const ACCOUNT_NAME = process.env.CDP_ACCOUNT_NAME ?? "walletos-demo";

/**
 * SpendingPolicy — the guard every outbound transfer must pass.
 *
 * Deliberately small for the MVP: a per-transaction USDC ceiling and an optional
 * recipient allowlist. It lives here (not in the agent) so a policy can never be
 * bypassed by going around Claude and calling the rail directly.
 */
export interface SpendingPolicy {
  /** Maximum USDC allowed in a single transfer. */
  maxUsdcPerTx: number;
  /** If set, only these (lowercased) addresses may receive funds. */
  allowlist?: string[];
}

export const DEFAULT_POLICY: SpendingPolicy = {
  maxUsdcPerTx: 100,
};

export class PolicyViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyViolationError";
  }
}

export interface TransferResult {
  transactionHash: string;
  explorerUrl: string;
  amount: string;
  to: string;
}

/** Format an atomic (bigint) token amount as a human-readable decimal string. */
function formatUnits(atomic: bigint, decimals: number): string {
  const negative = atomic < 0n;
  const value = negative ? -atomic : atomic;
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const frac = (value % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  const out = frac ? `${whole}.${frac}` : `${whole}`;
  return negative ? `-${out}` : out;
}

export class WalletService {
  private cdp: CdpClient;
  private policy: SpendingPolicy;
  // Cache the resolved account so we don't re-fetch on every call.
  private accountPromise?: ReturnType<CdpClient["evm"]["getOrCreateAccount"]>;

  constructor(policy: SpendingPolicy = DEFAULT_POLICY) {
    // CdpClient reads CDP_API_KEY_ID / CDP_API_KEY_SECRET / CDP_WALLET_SECRET
    // from the environment automatically.
    this.cdp = new CdpClient();
    this.policy = policy;
  }

  /** Current spending policy (read-only copy). */
  getPolicy(): SpendingPolicy {
    return { ...this.policy };
  }

  /** Update the spending policy (merged). Used by the set_policy tool. */
  setPolicy(patch: Partial<SpendingPolicy>): SpendingPolicy {
    this.policy = { ...this.policy, ...patch };
    return this.getPolicy();
  }

  /** Resolve (and cache) the named CDP server account. Idempotent across runs. */
  private account() {
    if (!this.accountPromise) {
      this.accountPromise = this.cdp.evm.getOrCreateAccount({ name: ACCOUNT_NAME });
    }
    return this.accountPromise;
  }

  /** The wallet's on-chain address. */
  async getAddress(): Promise<string> {
    const account = await this.account();
    return account.address;
  }

  /**
   * Resolve (create-or-load) another named CDP account's address — e.g. a
   * marketplace agent's wallet, so we can make a real agent-to-agent transfer to it.
   */
  async resolveAddress(name: string): Promise<string> {
    const account = await this.cdp.evm.getOrCreateAccount({ name });
    return account.address;
  }

  explorerUrl(txHash: string): string {
    return `${EXPLORER_TX_BASE}${txHash}`;
  }

  addressUrl(address: string): string {
    return `${EXPLORER_ADDR_BASE}${address}`;
  }

  /** USDC balance as a human-readable number (e.g. 12.5). */
  async getUsdcBalance(): Promise<number> {
    const account = await this.account();
    const { balances } = await account.listTokenBalances({ network: NETWORK });
    const usdc = balances.find(
      (b) => b.token.symbol?.toLowerCase() === "usdc",
    );
    if (!usdc) return 0;
    return Number(formatUnits(usdc.amount.amount, usdc.amount.decimals));
  }

  /** ETH (gas) balance as a human-readable number. */
  async getEthBalance(): Promise<number> {
    const account = await this.account();
    const { balances } = await account.listTokenBalances({ network: NETWORK });
    const eth = balances.find(
      (b) => b.token.symbol?.toLowerCase() === "eth",
    );
    if (!eth) return 0;
    return Number(formatUnits(eth.amount.amount, eth.amount.decimals));
  }

  /**
   * Request testnet funds from the CDP faucet. No website faucet needed.
   * ETH covers gas; USDC is what we move in the demo.
   */
  async requestFaucet(token: "eth" | "usdc"): Promise<string> {
    const account = await this.account();
    const { transactionHash } = await account.requestFaucet({
      network: NETWORK,
      token,
    });
    return transactionHash;
  }

  /** Run the spending policy guard. Throws PolicyViolationError on failure. */
  private enforcePolicy(to: string, amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new PolicyViolationError(`Invalid transfer amount: ${amount}`);
    }
    if (amount > this.policy.maxUsdcPerTx) {
      throw new PolicyViolationError(
        `Transfer of ${amount} USDC exceeds per-tx limit of ${this.policy.maxUsdcPerTx} USDC`,
      );
    }
    if (this.policy.allowlist && !this.policy.allowlist.includes(to.toLowerCase())) {
      throw new PolicyViolationError(`Recipient ${to} is not on the allowlist`);
    }
  }

  /**
   * Move USDC on Base Sepolia. `amount` is human-readable USDC (e.g. 1.5).
   * Enforces the spending policy first, then submits a real on-chain transfer.
   */
  async sendUsdc(to: string, amount: number | string): Promise<TransferResult> {
    const amountNum = typeof amount === "string" ? Number(amount) : amount;
    this.enforcePolicy(to, amountNum);

    const account = await this.account();
    const atomic = parseUnits(String(amount), USDC_DECIMALS);

    const { transactionHash } = await account.transfer({
      to: to as `0x${string}`,
      amount: atomic,
      token: "usdc",
      network: NETWORK,
    });

    return {
      transactionHash,
      explorerUrl: this.explorerUrl(transactionHash),
      amount: String(amount),
      to,
    };
  }
}

/** Process-wide singleton so we share one account/client across requests. */
let _wallet: WalletService | undefined;

export function getWallet(): WalletService {
  if (!_wallet) _wallet = new WalletService();
  return _wallet;
}
