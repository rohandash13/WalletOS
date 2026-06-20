# WalletOS

# WalletOS

> **A private banker for the 99%.** Talk to your money in plain English — and an AI agent actually moves it, saves it, invests it, and automates it, under rules you set.

---

## The problem

The wealthy have CFOs, wealth managers, and information advantages. Everyone else gets a balance screen and a "good luck."

That gap is an **economic-opportunity gap**: people who are underbanked, living paycheck-to-paycheck, or sending money home pay the most and get the least from the financial system — not because the knowledge doesn't exist, but because the *help* was never accessible.

**WalletOS closes that gap** by giving everyone an agentic financial team in their pocket — for free.

## What it does

You talk to your money (by text or voice). An AI agent powered by **Claude** understands your goals, then *acts* on them through real, auditable tools:

- **Chat** — "Send money home to my mom every month, keep rent safe, and invest the rest low-risk — I'm a 3 out of 10 on risk." Claude parses the intent and executes it.
- **Automations** — recurring rules ("send $50 on the 1st," "protect 3 months of rent") that run on their own.
- **Agent marketplace** — specialized sub-agents (Stable-Invest, Savings, Bill-Pay) you connect, gated by a **risk score**, that transact on your behalf.

Every action is explained back to you in plain English — so it teaches financial literacy as it works.

## Demo

> 🎙️ *"I get paid \$2k on the 1st. Send money home to my mom every month, keep rent safe, and invest the rest low-risk — I'm a 3 out of 10 on risk."*

1. Claude parses the request and sets up the automations.
2. It executes a **real on-chain USDC transfer** on Base Sepolia — verifiable live on a block explorer.
3. It routes the remainder to the Stable-Invest agent based on the risk score.
4. The portfolio updates in real time, and Claude explains *why* it did what it did.
5. *"Actually, I need \$200 back"* → it pulls from the right bucket and confirms.

## How it works

```
  Web app (Next.js + TypeScript)
   Chat · Automations · Marketplace ──► Realtime events (Redis pub/sub)
            │
            ▼
   Agent brain: Claude (tool-use / MCP-style tools)
     get_balance · send_payment · set_policy · create_automation · route_to_agent · explain_decision
            │
            ├──► Money rail: Coinbase CDP Wallet API — server wallet on Base Sepolia (test USDC)
            ├──► Agent marketplace: Fetch AI uAgents (agent-to-agent payments)
            └──► Automations: durable recurring workflows
```

Claude is the reasoning layer. It only ever acts through explicit, auditable **tools** — each one enforces a spending policy, records a transaction, and publishes a realtime event to the UI.

## Tech stack

| Layer | Tech |
|---|---|
| Agent / reasoning | **Claude** (Anthropic) — tool-use, MCP-style tools |
| Money rail | **Coinbase CDP Wallet API** — server wallet on **Base Sepolia** testnet, programmatic faucet |
| Agent marketplace | **Fetch AI** uAgents — agent-to-agent payments |
| Realtime state | **Redis** (Upstash) — pub/sub + portfolio ledger |
| Frontend | **Next.js (App Router) + TypeScript + Tailwind** |
| Voice *(stretch)* | **Deepgram** — speech in/out |
| Recurring workflows *(stretch)* | **Orkes Conductor** |
| Eval & monitoring *(stretch)* | **Arize**, **Sentry** |

## Getting started

### Prerequisites
- Node.js 20+
- A **Coinbase CDP** account → Secret API Key + Wallet Secret ([portal.cdp.coinbase.com](https://portal.cdp.coinbase.com))
- An **Anthropic API key**
- An **Upstash Redis** instance (free tier)

### 1. Install
```bash
git clone https://github.com/<you>/WalletOS.git
cd WalletOS
npm install
```

### 2. Configure `.env.local`
```bash
ANTHROPIC_API_KEY=
CDP_API_KEY_ID=
CDP_API_KEY_SECRET=
CDP_WALLET_SECRET=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

### 3. Create & fund the testnet wallet (no website faucet needed)
```bash
npx tsx scripts/setup-wallet.ts
```
This creates a named CDP server wallet and funds it on **Base Sepolia** with test ETH (gas) + test USDC via the CDP faucet, then prints the address and explorer links.

### 4. Run
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) and talk to your money.

## Project structure

```
app/
  api/            # chat, balance, payment, agent, automations, events routes
  components/     # Chat · Automations · Marketplace · PortfolioPanel
lib/
  wallet.ts       # CDP WalletService (balance, transfer, faucet, spending policy)
  tools.ts        # Claude tool definitions + dispatch (only code that moves money)
  agent.ts        # Claude tool-use loop
  marketplace.ts  # Fetch uAgent registry, risk gating, /route caller
  redis.ts        # realtime events + bucket ledger (Upstash or in-memory)
  types.ts        # shared API/domain shapes
agent-service/    # Fetch AI uAgent marketplace (Python): stable-invest / savings / bill-pay
scripts/
  setup-wallet.ts # one-time testnet wallet creation + funding + transfer proof
  seed-demo.ts    # seed the demo paycheck via the running server
```

## Status & roadmap

- [x] CDP server wallet on Base Sepolia + programmatic faucet funding
- [x] Real on-chain USDC transfer, verifiable on `sepolia.basescan.org`
- [x] Claude tool loop: parse intent → execute → explain
- [x] Risk-score routing + realtime portfolio events
- [x] Fetch AI uAgent marketplace (Stable-Invest / Savings / Bill-Pay) + on-chain agent-to-agent payments, ASI:One discoverable
- [ ] Recurring automations via Orkes *(create_automation works in-process; Orkes is the durable-workflow upgrade)*
- [ ] Deepgram voice interface

## ⚠️ Disclaimer

WalletOS runs entirely on the **Base Sepolia testnet** using **test USDC** (free, no monetary value). It moves no real funds, provides **no real financial advice**, and is a hackathon prototype — not a regulated financial product. The architecture is one config flip (`base-sepolia` → `base`) from production rails.

## Team

- **Rohan Dash** — agent & money backend
- **Rishabh Abhishetty** — frontend, realtime & demo

## License

MIT
