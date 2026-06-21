# WalletOS

> **A private banker for the 99%.** Talk to your money in plain English — and an AI agent actually moves it, saves it, invests it, and automates it, under rules you set.

---

## The problem

The wealthy have CFOs, wealth managers, and information advantages. Everyone else gets a balance screen and a "good luck."

That gap is an **economic-opportunity gap**: people who are underbanked, living paycheck-to-paycheck, or sending money home pay the most and get the least from the financial system — not because the knowledge doesn't exist, but because the *help* was never accessible.

**WalletOS closes that gap** by giving everyone an agentic financial team in their pocket — for free.

## What it does

You talk to your money in plain English. An AI agent powered by **Claude** understands your goals, then *acts* on them through real, auditable tools:

- **Onboarding** — first you set a **risk score (1–10)** and an **"approve before moving money" limit**, so the agent never assumes your preferences or moves large amounts without you.
- **Chat** — "I get paid $2k on the 1st. Send my sister $50 every month, keep rent safe, and invest the rest low-risk." Claude parses the intent and sets it up. You can change your risk score or approval limit any time, just by saying so.
- **Automations** — recurring rules ("send $50 on payday," "protect rent first," "invest the leftover") that run when income lands. Anything over your approval limit waits for your OK.
- **Financial agents** — specialized investing agents (Savings, Stable-Invest, Balanced-Growth, Growth, High-Yield, Bill-Pay), auto-matched to your risk score, plus **create-your-own** agents from a plain-English goal. They make real on-chain agent-to-agent transfers and are discoverable on **Fetch AI's ASI:One**.
- **Fund tracking** — once money is invested, an "Invested funds" view shows each agent's principal, real on-chain balance, and simulated growth over time.

Every action is explained back to you in plain English — so it teaches financial literacy as it works.

## Demo

> *"I get paid \$2k on the 1st. Send my sister \$50 every month, keep rent safe, and invest the rest low-risk — I'm a 3 out of 10 on risk."*

1. You pick a risk score and approval limit in onboarding; Claude suggests agents that fit.
2. Claude parses the request and sets up the payday automations.
3. **Generate paycheck** lands \$2,000 (a **real, scaled on-chain USDC transfer** on Base Sepolia, verifiable on a block explorer) and runs the automations.
4. The remainder routes to the matched investing agent; moves over your limit pause for approval.
5. The portfolio updates in real time, and Claude explains *why* it did what it did.
6. *"Actually, I need \$200 back"* → it pulls from the right bucket and confirms.

## How it works

```
  Web app (Next.js + TypeScript + Tailwind), gated by Clerk auth
   Chat · Automations · Agents · Portfolio ──► Realtime events (in-memory store; optional Upstash Redis)
            │
            ▼
   Agent brain: Claude (tool-use / MCP-style tools)
     get_balance · send_payment · set_policy · create_automation · route_to_agent · rebalance_funds · explain_decision
            │
            ├──► Money rail: Coinbase CDP Wallet API — server wallet on Base Sepolia (test USDC)
            ├──► Financial agents: Fetch AI uAgents (agent-to-agent payments, ASI:One discoverable)
            └──► Automations: recurring payday rules + an approval queue
```

Claude is the reasoning layer. It only ever acts through explicit, auditable **tools** — each one enforces the spending/approval policy, records a transaction, and publishes a realtime event to the UI.

**Demo economy:** the app shows relatable dollars while settling scaled test USDC on-chain (default `1 test USDC = $1,000`, configurable via `DEMO_USD_PER_TEST_USDC`), so a \$50 payment settles as 0.05 test USDC.

## Tech stack

| Layer | Tech |
|---|---|
| Agent / reasoning | **Claude** (Anthropic) — tool-use, MCP-style tools |
| Money rail | **Coinbase CDP Wallet API** — server wallet on **Base Sepolia** testnet, programmatic faucet |
| Financial agents | **Fetch AI** uAgents — agent-to-agent payments, ASI:One / Agentverse discoverable |
| Auth | **Clerk** — sign-in, per-user state |
| State | **In-memory store** by default; **optional Upstash Redis** (set `UPSTASH_*` to use it) |
| Frontend | **Next.js (App Router) + TypeScript + Tailwind** |

## Getting started

### Prerequisites
- Node.js 20+
- An **Anthropic API key**
- A **Coinbase CDP** account → API Key ID + Secret + Wallet Secret ([portal.cdp.coinbase.com](https://portal.cdp.coinbase.com))
- **Clerk** keys (publishable + secret) for auth ([clerk.com](https://clerk.com))
- *(Optional)* an **Upstash Redis** instance — only if you want shared/persistent state instead of the in-memory store
- *(Optional)* an **Agentverse API key** — only to publish the Python financial agents to ASI:One

### 1. Install
```bash
git clone https://github.com/<you>/WalletOS.git
cd WalletOS
npm install
```

### 2. Configure `.env.local`
```bash
# Required
ANTHROPIC_API_KEY=
CDP_API_KEY_ID=
CDP_API_KEY_SECRET=
CDP_WALLET_SECRET=
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=

# Optional
# UPSTASH_REDIS_REST_URL=          # use Upstash instead of the in-memory store
# UPSTASH_REDIS_REST_TOKEN=
# DEMO_USD_PER_TEST_USDC=1000      # demo scale (default 1000)
# CDP_PAYROLL_ACCOUNT_NAME=walletos-payroll
```

### 3. Create & fund the testnet wallet (no website faucet needed)
```bash
npm run setup:wallet
```
This creates a named CDP server wallet and funds it on **Base Sepolia** with test ETH (gas) + test USDC via the CDP faucet, then prints the address and explorer links. `npm run balance` shows balances anytime.

### 4. Run
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000), sign in, complete onboarding, and talk to your money.

### 5. (Optional) Financial agents on ASI:One
```bash
cd agent-service
pip install -r requirements.txt
cp .env.example .env        # add AGENTVERSE_API_KEY
python register.py          # publish all 6 agents to your Agentverse account
python run_all.py           # keep running so ASI:One can reach them via mailbox
```

## Project structure

```
app/
  api/            # chat, balance, payday, reset, demo/{seed,reset}, automations,
                  # events, marketplace, agent/route, payment/send, investments,
                  # approvals, settings
  components/     # WalletDemo (chat · automations · agents · portfolio · onboarding)
  chat/ sign-in/ sign-up/   # Clerk-gated app shell
lib/
  wallet.ts       # CDP WalletService (balance, transfer, faucet, spending policy)
  tools.ts        # Claude tool definitions + dispatch (only code that moves money)
  agent.ts        # Claude tool-use loop (+ activity context, approval rule)
  agent-factory.ts# create-your-own agents from a plain-English goal
  marketplace.ts  # Fetch uAgent registry, risk gating, /route caller
  payday.ts       # paycheck simulation + payday automations + approval queue
  investments.ts  # post-investment fund tracking (principal, on-chain, growth)
  redis.ts        # realtime events + bucket ledger (in-memory or Upstash)
  adapter.ts      # backend shapes -> frontend JSON contract
  money.ts        # demo USD <-> test USDC scaling
  auth.ts profiles.ts   # Clerk auth + per-user profiles
  types.ts wallet-types.ts   # shared API/domain shapes
agent-service/    # Fetch AI uAgents (Python): savings / stable-invest / balanced-growth
                  # / growth / high-yield / bill-pay  (+ register.py, run_all.py)
scripts/
  setup-wallet.ts # one-time testnet wallet creation + funding + transfer proof
  seed-demo.ts    # seed a demo paycheck via the running server
  faucet.ts balance.ts payday.ts            # wallet/faucet/payday helpers
  demo-recipient.ts demo-transfer.ts        # demo transfer target + send proof
  verify-pipeline.ts                        # hermetic checks: math + agent routing
```

## Status

- [x] Clerk auth + per-user state; risk-score + approval-limit onboarding
- [x] CDP server wallet on Base Sepolia + programmatic faucet funding
- [x] Real (scaled) on-chain USDC transfers, verifiable on `sepolia.basescan.org`
- [x] Claude tool loop: parse intent → execute → explain; dynamic risk/limit changes
- [x] Payday simulation + automations with an approval queue for over-limit moves
- [x] Fetch AI uAgent marketplace (6 agents) + create-your-own; ASI:One discoverable
- [x] Post-investment fund tracking with simulated growth

## ⚠️ Disclaimer

WalletOS runs entirely on the **Base Sepolia testnet** using **test USDC** (free, no monetary value). It moves no real funds, provides **no real financial advice**, and is a hackathon prototype — not a regulated financial product. The architecture is one config flip (`base-sepolia` → `base`) from production rails.

## Team

- **Rohan Dash** — agent & money backend
- **Rishabh Abhishetty** — frontend, realtime & demo

## License

MIT
