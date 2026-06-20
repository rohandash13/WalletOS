# WalletOS — Agent Marketplace (Fetch AI uAgents)

Specialized sub-agents the Claude brain routes funds to. Each is a real
[Fetch AI uAgent](https://fetch.ai/docs/concepts/agents/agents): it exposes a REST
endpoint the Next.js backend calls, and speaks the **ASI:One chat protocol** so it's
discoverable and queryable on [Agentverse](https://agentverse.ai).

| Agent | Port | Risk band | Strategy |
|---|---|---|---|
| **Stable-Invest** | 8001 | 1–5 | Stablecoin yield + tokenized T-bills + small growth sleeve |
| **Savings** | 8002 | 1–3 | Liquid, capital-preserving savings, no lockup |
| **Bill-Pay** | 8003 | any | Liquid reserve earmarked for scheduled bills |

## How it fits the architecture

```
Claude brain (lib/agent.ts) ──route_to_agent tool──► lib/marketplace.ts
                                                          │  POST /route  (HTTP)
                                                          ▼
                                                 Fetch uAgent (this service)
                                                  ├─ returns allocation + APY + explanation
                                                  └─ ASI:One chat protocol (discoverable)
```

The backend's `route_to_agent` calls the chosen agent's `/route`, then performs a
**real on-chain USDC settlement** from the main CDP wallet to the agent's CDP wallet
(agent-to-agent payment, verifiable on Basescan) and updates the portfolio ledger.
If this service is down, the backend falls back to local strategy math so the demo
never breaks.

## Run it

```bash
cd agent-service
python -m venv .venv && .venv\Scripts\activate     # Windows (use source .venv/bin/activate on macOS/Linux)
pip install -r requirements.txt

# all three at once
python run_all.py
# or individually
python stable_invest_agent.py
```

> **Python version:** uAgents officially supports Python 3.10–3.12. On 3.13 you may
> need a recent `uagents` release; if install fails, create the venv with 3.12.

Each agent prints its address and serves:

- `POST /route`  → `{ amount, risk_score, user_id }` ⇒ `{ accepted, agent, strategy, allocation, projected_apy, explanation }`
- `GET /health`  → `{ status, agent, title, address }`

Point the backend at them with these (already defaulted in the backend):

```
STABLE_INVEST_AGENT_URL=http://127.0.0.1:8001
SAVINGS_AGENT_URL=http://127.0.0.1:8002
BILL_PAY_AGENT_URL=http://127.0.0.1:8003
```

## Make it discoverable on ASI:One

1. Create an account at [agentverse.ai](https://agentverse.ai) and grab an **API key**
   (Profile → API Keys).
2. Copy `.env.example` → `.env` and set `AGENTVERSE_API_KEY=...`.
3. Start an agent — it boots in **mailbox mode**, connects to Agentverse, and
   `publish_manifest=True` publishes its chat protocol.
4. In Agentverse, find the agent by the address it prints, add a README/description,
   and it becomes searchable and chat-queryable through **ASI:One** (try asking it
   "what's your strategy?").

Without an API key the agents still run locally and the backend reaches them over REST —
the Agentverse/ASI:One step is only needed for public discoverability (the Fetch prize).
