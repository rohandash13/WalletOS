/**
 * lib/wallet-types.ts — backend (ledger/wallet) domain shapes.
 *
 * These are the INTERNAL types for the real backend: the logical bucket ledger on
 * top of the single CDP wallet, the tx log, the event stream, and automations.
 * The UI-facing JSON contract lives in lib/types.ts (Person B's frontend types);
 * lib/adapter.ts maps these internal shapes onto that contract.
 */

export const USER_ID = "demo" as const;

/** Logical money buckets layered on top of the one CDP wallet. */
export type BucketId = "available" | "rent" | "savings" | "stable_invest";

export const BUCKETS: BucketId[] = ["available", "rent", "savings", "stable_invest"];

export const BUCKET_LABELS: Record<BucketId, string> = {
  available: "Available",
  rent: "Rent (protected)",
  savings: "Savings",
  stable_invest: "Stable-Invest",
};

/** Portfolio = per-bucket USDC balances (off-chain accounting). */
export type Portfolio = Record<BucketId, number>;

export interface TxRecord {
  id: string;
  /** on_chain = real USDC moved; internal = bucket-to-bucket ledger move. */
  kind: "on_chain" | "internal";
  type: "send_payment" | "route_to_agent" | "automation" | "faucet" | "rebalance";
  amount: number;
  token: "usdc";
  from: string;
  to: string;
  fromBucket?: BucketId;
  toBucket?: BucketId;
  txHash?: string;
  explorerUrl?: string;
  note?: string;
  status: "pending" | "confirmed" | "failed";
  ts: number;
}

export type EventType =
  | "tx"
  | "portfolio"
  | "policy"
  | "automation"
  | "agent"
  | "message";

export interface AppEvent {
  id: number;
  type: EventType;
  ts: number;
  /** Human-readable one-liner for the UI feed. */
  summary: string;
  data?: unknown;
}

export interface Automation {
  id: string;
  /** recurring_transfer + protect_bucket move money; "rule" is a recorded plan. */
  type: "recurring_transfer" | "protect_bucket" | "rule";
  /** Friendly template, e.g. bill, family, auto_save, recurring_invest, roundup,
   *  smart_card, paycheck_split, low_balance_alert, subscription_watch. */
  category?: string;
  amount?: number;
  /** For percentage-based rules (e.g. "save 20% of each paycheck"). */
  percent?: number;
  /** For alerts / smart payments (e.g. balance threshold). */
  threshold?: number;
  to?: string;
  /** e.g. "monthly", "weekly", "monthly:1" (1st of month). Free-form for the MVP. */
  schedule?: string;
  bucket?: BucketId;
  note?: string;
  active: boolean;
  createdAt: number;
}

/** Risk score 1 (most conservative) .. 10 (most aggressive). */
export type RiskScore = number;
