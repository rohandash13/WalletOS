# Build Plan — "Private Banker for the 99%" (Person A backend bootstrap + MVP core)

## Context
Cal Hacks AI Hackathon 2026 is underway (hacking window open). The strategy, demo script, and full
backend spec already exist (`Cal-Hacks-2026-Plan.docx` and `Person A SPEC - viem.md`; its payment-rail section is now superseded — use Coinbase CDP, not viem). This plan covers
the immediate next step: **stand up the project and build the backend MVP core loop** — the single
most important proof, "a chat message moves real testnet USDC on Base Sepolia." Payment rail = **Coinbase CDP SDK**
(CDP access now works; gives managed server wallets + a programmatic testnet faucet). Scope here is Person A (agent + money backend); the frontend (Person B) builds against
the same API shapes in parallel.

## Assumptions (correct me if wrong before approving)
- Project lives in a **new repo at `C:\Users\rohid\WalletOS`** (separate from `ctrl-tower`).
- Single TypeScript Next.js app; the Fetch uAgent is a small Python service added later (H6+).
- Demo is single-user (`userId = "demo"`); Base Sepolia testnet only.

## Step 1 — Bootstrap the project
- `mkdir C:\Users\rohid\WalletOS`, `git init`, scaffold `npx create-next-app@latest . --ts --tailwind --app --eslint`.
- Install deps: `npm i @coinbase/cdp-sdk @anthropic-ai/sdk ioredis` (optionally `@coinbase/agentkit`).
- Copy the two spec/strategy docs into the repo (`SPEC.md`, `docs/`), add `BUILD_LOG.md` (Claude Code prize evidence), and a `.env.local` with the CDP keys (`CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET`). Ensure `.env*` is gitignored.

## Step 2 — CDP WalletService (`lib/wallet.ts`)
Wrap the Coinbase CDP SDK behind a small interface: `getUsdcBalance()`, `sendUsdc(to, amount)`, `explorerUrl(hash)`,
and a `SpendingPolicy` guard (so the wallet stays swappable). Create/load a CDP **server wallet on `base-sepolia`**
(auth via the Secret API key + Wallet Secret). **Fund it programmatically with the CDP SDK faucet** (`requestFaucet`
for testnet ETH + USDC) — no manual faucet step. USDC transfers and gas are handled through the CDP SDK.

## Step 3 — Redis state + events (`lib/redis.ts`)
Upstash client. Keys/channel per spec §6/§8 (`portfolio:demo`, `tx:demo`, `channel:events:demo`).
`publishEvent()` + a bucket ledger. Provide `GET /api/events` (SSE or 1–2s polling fallback).

## Step 4 — Claude tool layer + agent loop (`lib/tools.ts`, `lib/agent.ts`)
Define the MCP-style tools from spec §5 (`get_balance`, `send_payment`, `set_policy`,
`create_automation`, `route_to_agent`, `explain_decision`). Tool handlers are the ONLY code that touches
the wallet/Redis; each money action enforces policy, writes a `TxRecord`, and publishes an event.
Run the Claude tool-use loop (opus for planning). Confirm exact tool-use request shape via the `claude-api` skill.

## Step 5 — API routes
`POST /api/chat` (agent loop), `GET /api/balance`, `POST /api/payment/send` (direct rail test),
`POST /api/agent/route`, `POST /api/automations`, `GET /api/events` — matching spec §4 JSON shapes exactly
so Person B is unblocked.

## MVP definition of done (this plan)
1. `POST /api/payment/send` performs a **real Base Sepolia USDC transfer**; tx hash opens on `sepolia.basescan.org`.
2. A chat message through `POST /api/chat` makes Claude call `send_payment` and move funds.
3. Risk score 3 → `route_to_agent` updates the `stable_invest` bucket (stubbed service ok for first pass).
4. Portfolio/tx events publish; `GET /api/balance` and `GET /api/events` return spec-shaped JSON.

## Deferred (not in this pass)
Fetch uAgent Python service (real a2a), Orkes automations, Deepgram voice, Arize/Sentry — all stretch per
the spec timeline (H6+). Frontend tabs are Person B.

## Verification
- Rail: `curl POST /api/payment/send` → confirm tx on the explorer + recipient balance changes.
- Agent: send the demo-script message to `/api/chat`; confirm Claude calls `send_payment` then `route_to_agent`.
- Events: hit `/api/events` and watch a money action appear without manual refresh.
- Run the full demo-script chat end-to-end ≥3 times with no manual intervention.
