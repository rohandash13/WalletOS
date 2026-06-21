export type BucketKey =
  | "checking"
  | "rent_safe"
  | "family_payment"
  | "stable_invest"
  | "emergency";

export type Bucket = {
  name: string;
  key: BucketKey;
  balance: number;
  protected: boolean;
};

export type Portfolio = {
  checking: number;
  rent_safe: number;
  family_payment: number;
  stable_invest: number;
};

export type Action = {
  type: string;
  status: "pending" | "confirmed" | "completed" | "failed";
  amount?: number;
  asset?: string;
  txHash?: string;
  explorerUrl?: string;
  agentName?: string;
  eventId?: string;
};

export type WalletEvent = {
  id: string;
  type:
    | "policy_updated"
    | "automation_created"
    | "payment_pending"
    | "payment_confirmed"
    | "agent_routed"
    | "portfolio_updated"
    | "explanation_ready";
  message: string;
  status: string;
  txHash?: string;
  explorerUrl?: string;
  createdAt: string;
};

export type Automation = {
  id: string;
  name: string;
  status: "active" | "paused" | "failed" | "pending" | "created";
  nextRunAt: string;
  explanation?: string;
};

export type ChatResponse = {
  assistantMessage: string;
  actions: Action[];
  portfolio: Portfolio;
  buckets?: Bucket[];
  events: WalletEvent[];
  automations?: Automation[];
  riskScore?: number;
  why?: string;
};

export type BalanceResponse = {
  walletAddress: string;
  network: string;
  asset: string;
  walletBalance: number;
  buckets: Bucket[];
  updatedAt: string;
};
