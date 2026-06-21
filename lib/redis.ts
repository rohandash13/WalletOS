/**
 * lib/redis.ts — realtime state + event stream.
 *
 * Uses Upstash Redis when UPSTASH_REDIS_REST_URL/TOKEN are set; otherwise falls
 * back to an in-process memory store so the backend runs locally with zero infra.
 * (The memory store is per-process — fine for `next dev`, not for serverless prod,
 * but the demo is single-process.)
 *
 * Keys (per user; the demo user is "demo", real users are their auth id):
 *   portfolio:<user>   hash   bucket -> usdc balance
 *   tx:<user>          list   newest-first TxRecord JSON
 *   events:<user>      list   AppEvent JSON, id from events:seq:<user>
 *   policy:<user>      json   SpendingPolicy overrides
 *   automations:<user> list   Automation JSON
 */

import { Redis } from "@upstash/redis";
import {
  USER_ID,
  BUCKETS,
  type Portfolio,
  type BucketId,
  type TxRecord,
  type AppEvent,
  type EventType,
  type Automation,
} from "./wallet-types";
import { toDemoUsd, scaleLabel } from "./money";

/* ----------------------------- low-level store ---------------------------- */

interface KV {
  hgetall(key: string): Promise<Record<string, string> | null>;
  hset(key: string, field: string, value: string): Promise<void>;
  lpush(key: string, value: string): Promise<void>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  incr(key: string): Promise<number>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
}

class MemoryKV implements KV {
  private h = new Map<string, Map<string, string>>();
  private l = new Map<string, string[]>();
  private s = new Map<string, string>();

  async hgetall(key: string) {
    const m = this.h.get(key);
    return m ? Object.fromEntries(m) : null;
  }
  async hset(key: string, field: string, value: string) {
    if (!this.h.has(key)) this.h.set(key, new Map());
    this.h.get(key)!.set(field, value);
  }
  async lpush(key: string, value: string) {
    if (!this.l.has(key)) this.l.set(key, []);
    this.l.get(key)!.unshift(value);
  }
  async lrange(key: string, start: number, stop: number) {
    const arr = this.l.get(key) ?? [];
    // emulate Redis inclusive stop + negative indices
    const end = stop < 0 ? arr.length + stop + 1 : stop + 1;
    return arr.slice(start, end);
  }
  async incr(key: string) {
    // Store in the same map `get` reads from, so the counter is observable.
    const v = (Number(this.s.get(key) ?? 0)) + 1;
    this.s.set(key, String(v));
    return v;
  }
  async get(key: string) {
    return this.s.get(key) ?? null;
  }
  async set(key: string, value: string) {
    this.s.set(key, value);
  }
  async del(key: string) {
    this.h.delete(key);
    this.l.delete(key);
    this.s.delete(key);
  }
}

class UpstashKV implements KV {
  constructor(private redis: Redis) {}
  async hgetall(key: string) {
    return this.redis.hgetall<Record<string, string>>(key);
  }
  async hset(key: string, field: string, value: string) {
    await this.redis.hset(key, { [field]: value });
  }
  async lpush(key: string, value: string) {
    await this.redis.lpush(key, value);
  }
  async lrange(key: string, start: number, stop: number) {
    // Upstash deserializes JSON-looking strings; force string form.
    const raw = await this.redis.lrange<unknown>(key, start, stop);
    return raw.map((v) => (typeof v === "string" ? v : JSON.stringify(v)));
  }
  async incr(key: string) {
    return this.redis.incr(key);
  }
  async get(key: string) {
    const v = await this.redis.get<unknown>(key);
    if (v == null) return null;
    return typeof v === "string" ? v : JSON.stringify(v);
  }
  async set(key: string, value: string) {
    await this.redis.set(key, value);
  }
  async del(key: string) {
    await this.redis.del(key);
  }
}

function makeStore(): { kv: KV; backend: "upstash" | "memory" } {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    return { kv: new UpstashKV(new Redis({ url, token })), backend: "upstash" };
  }
  return { kv: new MemoryKV(), backend: "memory" };
}

// Reuse one store across hot-reloads in dev.
const globalForStore = globalThis as unknown as {
  __walletosStore?: ReturnType<typeof makeStore>;
};
const store = (globalForStore.__walletosStore ??= makeStore());
const kv = store.kv;

export const redisBackend = store.backend;

/* -------------------------------- keys ------------------------------------ */

const k = {
  portfolio: (u: string = USER_ID) => `portfolio:${u}`,
  tx: (u: string = USER_ID) => `tx:${u}`,
  events: (u: string = USER_ID) => `events:${u}`,
  eventsSeq: (u: string = USER_ID) => `events:seq:${u}`,
  policy: (u: string = USER_ID) => `policy:${u}`,
  automations: (u: string = USER_ID) => `automations:${u}`,
  agents: () => `agents:dynamic`,
};

/* ------------------------------ portfolio --------------------------------- */

const EMPTY_PORTFOLIO: Portfolio = {
  available: 0,
  rent: 0,
  savings: 0,
  stable_invest: 0,
};

export async function getPortfolio(userId: string = USER_ID): Promise<Portfolio> {
  const raw = (await kv.hgetall(k.portfolio(userId))) ?? {};
  const out = { ...EMPTY_PORTFOLIO };
  for (const b of BUCKETS) {
    const v = raw[b];
    if (v != null) out[b] = Number(v) || 0;
  }
  return out;
}

export async function setBucket(
  bucket: BucketId,
  amount: number,
  userId: string = USER_ID,
): Promise<void> {
  await kv.hset(k.portfolio(userId), bucket, String(amount));
}

/** Add (or subtract, if negative) to a bucket. Returns the new balance. */
export async function adjustBucket(
  bucket: BucketId,
  delta: number,
  userId: string = USER_ID,
): Promise<number> {
  const p = await getPortfolio(userId);
  const next = Math.round((p[bucket] + delta) * 1e6) / 1e6;
  await setBucket(bucket, next, userId);
  return next;
}

/** Move funds between buckets (logical ledger). */
export async function moveBetweenBuckets(
  from: BucketId,
  to: BucketId,
  amount: number,
  userId: string = USER_ID,
): Promise<void> {
  await adjustBucket(from, -amount, userId);
  await adjustBucket(to, amount, userId);
}

/* ---------------------------------- tx ------------------------------------ */

export async function addTx(tx: TxRecord, userId: string = USER_ID): Promise<void> {
  await kv.lpush(k.tx(userId), JSON.stringify(tx));
}

export async function listTxs(limit = 50, userId: string = USER_ID): Promise<TxRecord[]> {
  const raw = await kv.lrange(k.tx(userId), 0, limit - 1);
  return raw.map((r) => JSON.parse(r) as TxRecord);
}

/* -------------------------------- events ---------------------------------- */

export async function publishEvent(
  type: EventType,
  summary: string,
  data?: unknown,
  userId: string = USER_ID,
): Promise<AppEvent> {
  const id = await kv.incr(k.eventsSeq(userId));
  const event: AppEvent = { id, type, ts: Date.now(), summary, data };
  await kv.lpush(k.events(userId), JSON.stringify(event));
  return event;
}

/** Current event sequence value (id of the most recent event, 0 if none). */
export async function getEventCursor(userId: string = USER_ID): Promise<number> {
  const v = await kv.get(k.eventsSeq(userId));
  return v ? Number(v) : 0;
}

/** Return events with id > sinceId, oldest-first, for incremental polling/SSE. */
export async function getEventsSince(
  sinceId = 0,
  limit = 100,
  userId: string = USER_ID,
): Promise<AppEvent[]> {
  const raw = await kv.lrange(k.events(userId), 0, limit - 1);
  const events = raw.map((r) => JSON.parse(r) as AppEvent);
  return events.filter((e) => e.id > sinceId).sort((a, b) => a.id - b.id);
}

/* -------------------------------- policy ---------------------------------- */

export interface StoredPolicy {
  maxUsdcPerTx?: number;
  allowlist?: string[];
}

export async function getStoredPolicy(userId: string = USER_ID): Promise<StoredPolicy | null> {
  const raw = await kv.get(k.policy(userId));
  return raw ? (JSON.parse(raw) as StoredPolicy) : null;
}

export async function setStoredPolicy(
  policy: StoredPolicy,
  userId: string = USER_ID,
): Promise<void> {
  await kv.set(k.policy(userId), JSON.stringify(policy));
}

/* ----------------------------- automations -------------------------------- */

export async function addAutomation(
  a: Automation,
  userId: string = USER_ID,
): Promise<void> {
  await kv.lpush(k.automations(userId), JSON.stringify(a));
}

export async function listAutomations(
  limit = 50,
  userId: string = USER_ID,
): Promise<Automation[]> {
  const raw = await kv.lrange(k.automations(userId), 0, limit - 1);
  return raw.map((r) => JSON.parse(r) as Automation);
}

/**
 * Reset the demo ledger to mirror the actual CDP wallet's on-chain balance,
 * expressed in USD-equivalent using the configured testnet scale (1 USDC = $1,000).
 * This is the on-chain-mirroring reset path; seedDemoPaycheck is the fixed-amount one.
 */
export async function syncLedgerToOnChainBalance(
  usdcBalance: number,
  userId: string = USER_ID,
): Promise<Portfolio> {
  for (const b of BUCKETS) await setBucket(b, 0, userId);
  await kv.del(k.tx(userId));
  await kv.del(k.events(userId));
  await kv.del(k.eventsSeq(userId));
  await kv.del(k.automations(userId));
  await kv.del(k.policy(userId));

  const amount = toDemoUsd(usdcBalance);
  if (amount > 0) await setBucket("available", amount, userId);
  const portfolio = await getPortfolio(userId);

  const tx: TxRecord = {
    id: `tx_sync_${Date.now().toString(36)}`,
    kind: "internal",
    type: "deposit",
    amount,
    token: "usdc",
    from: "on_chain_wallet",
    to: "available",
    toBucket: "available",
    note: `Synced ledger from wallet balance (${scaleLabel()})`,
    status: "confirmed",
    ts: Date.now(),
  };
  await addTx(tx, userId);
  await publishEvent(
    "portfolio",
    `Balance refreshed`,
    { bucket: "available", balance: amount, onChainUsdc: usdcBalance, scale: scaleLabel() },
    userId,
  );
  return portfolio;
}

/* ------------------------------ demo seed --------------------------------- */

/**
 * Seed the demo "paycheck": credit the Available bucket so the demo starts from a
 * believable opening balance ($5,000). The on-chain wallet still only holds scarce
 * test USDC — buckets are the logical portfolio; real transfers settle the scaled
 * amount. Payday (/api/payday) is the separate recurring +$2,000 income.
 */
export async function seedDemoPaycheck(
  amount = 5000,
  reset = false,
  userId: string = USER_ID,
): Promise<Portfolio> {
  if (reset) {
    for (const b of BUCKETS) await setBucket(b, 0, userId);
    // Full demo restart: clear the tx log, event stream, automations, and policy.
    await kv.del(k.tx(userId));
    await kv.del(k.events(userId));
    await kv.del(k.eventsSeq(userId));
    await kv.del(k.automations(userId));
    await kv.del(k.policy(userId));
  }
  await adjustBucket("available", amount, userId);
  const portfolio = await getPortfolio(userId);

  const tx: TxRecord = {
    id: `tx_seed_${Date.now().toString(36)}`,
    kind: "internal",
    type: "faucet",
    amount,
    token: "usdc",
    from: "paycheck",
    to: "available",
    toBucket: "available",
    note: "Simulated paycheck deposit",
    status: "confirmed",
    ts: Date.now(),
  };
  await addTx(tx, userId);
  await publishEvent(
    "portfolio",
    `Paycheck deposit: +${amount} USDC to Available`,
    { bucket: "available", delta: amount },
    userId,
  );
  return portfolio;
}

/* --------------------- dynamic (user-created) agents ---------------------- */

/** A marketplace agent created at runtime (persisted JSON). */
export interface StoredAgent {
  id: string;
  title: string;
  description: string;
  riskBand: [number, number];
  minAmount: number;
  kind: "invest" | "reserve";
  strategy: string;
  allocation: Record<string, number>;
  projectedApy: number;
  createdAt: number;
}

export async function saveDynamicAgent(agent: StoredAgent): Promise<void> {
  await kv.lpush(k.agents(), JSON.stringify(agent));
}

export async function listDynamicAgents(limit = 50): Promise<StoredAgent[]> {
  const raw = await kv.lrange(k.agents(), 0, limit - 1);
  return raw.map((r) => JSON.parse(r) as StoredAgent);
}
