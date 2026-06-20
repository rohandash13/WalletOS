# BUILD_LOG — WalletOS (Person A backend)

Built at Cal Hacks AI Hackathon 2026 with **Claude Code**. This log is the build
evidence: what was created, in what order, and how each piece was verified.

## Stack
- Next.js 16 (App Router) + TypeScript + Tailwind
- Coinbase **CDP SDK** — server wallet on Base Sepolia (test USDC), programmatic faucet
- **Claude** (`claude-opus-4-8`, adaptive thinking) — tool-use agent loop
- **Fetch AI uAgents** (Python) — Stable-Invest / Savings / Bill-Pay marketplace, ASI:One discoverable
- Redis (Upstash) for realtime events + ledger, with an in-memory fallback

## What was built

### 1. Scaffold + money rail
- Scaffolded Next.js into the existing repo (preserving README/docs/.git).
- [lib/wallet.ts](lib/wallet.ts): `WalletService` over the CDP SDK — `getUsdcBalance`,
  `getEthBalance`, `sendUsdc`, `requestFaucet`, `resolveAddress`, `explorerUrl`, and a
  mutable `SpendingPolicy` guard (per-tx cap + optional allowlist).
- [scripts/setup-wallet.ts](scripts/setup-wallet.ts): creates the CDP wallet, funds via
  faucet, and proves a **real on-chain USDC transfer**.
- ✅ Verified: real transfer on Base Sepolia —
  [tx](https://sepolia.basescan.org/tx/0x889a0b135e28fa528a94ddb5e7e272536a7b0e836a9b24dbc6fb52545c62e958),
  recipient balance 0 → 0.5 USDC.

### 2. State + events
- [lib/redis.ts](lib/redis.ts): Upstash client with in-memory fallback; bucket ledger,
  tx log, event stream + `publishEvent`, demo paycheck seed.

### 3. Brain (Claude tool-use loop)
- [lib/tools.ts](lib/tools.ts): the 6 MCP-style tools — `get_balance`, `send_payment`,
  `set_policy`, `create_automation`, `route_to_agent`, `explain_decision`. The only code
  that touches the wallet/Redis; each money action enforces policy → writes `TxRecord` →
  publishes an event.
- [lib/agent.ts](lib/agent.ts): manual Claude tool-use loop (verified tool-use shape via
  the `claude-api` skill).

### 4. Fetch AI uAgent marketplace
- [agent-service/](agent-service/): three real Fetch uAgents (Stable-Invest :8001,
  Savings :8002, Bill-Pay :8003) sharing risk-aware allocation logic. Each exposes a REST
  `/route` + `/health` and speaks the **ASI:One chat protocol** (manifest publishes on boot;
  mailbox/Agentverse registration when `AGENTVERSE_API_KEY` is set).
- [lib/marketplace.ts](lib/marketplace.ts): registry + risk gating + HTTP call into a
  uAgent's `/route`, with a local-strategy fallback so the backend never breaks.
- `route_to_agent` now calls the live uAgent and makes a **real on-chain agent-to-agent
  USDC transfer** to the agent's CDP wallet.
- ✅ Verified: `POST /route {amount:2000, risk:3}` → Stable-Invest returns allocation +
  5.15% APY; chat manifest published to Agentverse.

### 5. API routes
- `POST /api/chat`, `GET /api/balance`, `POST /api/payment/send`, `POST /api/agent/route`,
  `GET|POST /api/automations`, `GET /api/events`, `GET /api/marketplace`, `POST /api/demo/seed`.

## How to run
```bash
# 1. backend
npm install
npm run setup:wallet      # one-time: create + fund wallet, prove transfer
npm run dev

# 2. marketplace agents (separate terminal)
cd agent-service && pip install -r requirements.txt && python run_all.py

# 3. seed the demo paycheck
npm run seed:demo
```

## MVP definition of done

## 2026-06-20 Codex handoff verification
- Git currently tracks only `README.md`; the Next.js app/backend files are working-tree additions in this checkout.
- Removed the Google Fonts build dependency from the root layout so `next build` works without network font fetches.
- `npm.cmd run lint` passed.
- `npm.cmd run build` passed.
- Fresh `npm.cmd run setup:wallet` proof succeeded:
  - wallet: `0x867E6c16efB528990F69F167802ecCC7d93473Ef`
  - recipient: `0xC7c2EBcC545034d4Bc25F92b5444c064bDE806b9`
  - proof USDC tx: https://sepolia.basescan.org/tx/0x12e4f5f40163549551ff694969ed3e76e88ed2eecb26e4e1de12ba54a2797cff
- Current backend progress tracker: `docs/BACKEND_STATUS.md`.

- [x] `POST /api/payment/send` performs a real Base Sepolia USDC transfer (explorer-verifiable)
- [x] A chat message makes Claude call `send_payment` and move funds
- [x] Risk score → `route_to_agent` calls a Fetch uAgent + updates the bucket
- [x] Portfolio/tx events publish; `GET /api/balance` + `GET /api/events` return spec JSON
