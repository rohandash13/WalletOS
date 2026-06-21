"""
register.py — publish ALL marketplace agents to Agentverse so they appear under
"My Agents" and are discoverable + chat-queryable on ASI:One. Uses AGENTVERSE_API_KEY.

    python register.py

Each agent is registered against the Agentverse **mailbox** endpoint — the same thing
the agent Inspector's "Connect" button does — so a locally-running mailbox agent
(`mailbox=True`, which our *_agent.py files use) receives messages relayed from ASI:One.

Run the agents alongside this (`python run_all.py`) and keep them running so chat works.
Registration itself is a signed API call and is safe to re-run.
"""

import os

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

from uagents_core.config import AgentverseConfig  # noqa: E402
from uagents_core.utils.registration import (  # noqa: E402
    RegistrationRequestCredentials,
    register_chat_agent,
)

# (seed, title, description) — seeds MUST match the *_agent.py files: the seed derives
# the agent's identity/address, so registering with a different seed would register a
# different agent than the one you run.
AGENTS = [
    (
        "walletos-stable-invest-seed-v1",
        "Stable-Invest",
        "Low-volatility stablecoin yield and tokenized T-bills for conservative growth.",
    ),
    (
        "walletos-savings-seed-v1",
        "Savings",
        "Liquid, capital-preserving savings with no lockup.",
    ),
    (
        "walletos-bill-pay-seed-v1",
        "Bill-Pay",
        "A liquid reserve that guarantees your scheduled bills never bounce.",
    ),
    (
        "walletos-balanced-growth-seed-v1",
        "Balanced-Growth",
        "A balanced mix of stablecoin yield and blue-chip staking for steady growth.",
    ),
    (
        "walletos-growth-seed-v1",
        "Growth",
        "Blue-chip crypto and DeFi liquidity for higher returns and more volatility.",
    ),
    (
        "walletos-high-yield-seed-v1",
        "High-Yield",
        "Aggressive DeFi yield farming and a momentum basket. High risk, high potential.",
    ),
]


def main() -> None:
    api_key = os.getenv("AGENTVERSE_API_KEY")
    if not api_key:
        raise SystemExit("Set AGENTVERSE_API_KEY in agent-service/.env first.")

    # The mailbox submit endpoint Agentverse relays chat to; the local agent (mailbox=True) picks it up.
    endpoint = AgentverseConfig().mailbox_endpoint
    print(f"Registering {len(AGENTS)} agents against mailbox endpoint: {endpoint}\n")

    readme_path = os.path.join(os.path.dirname(__file__), "README.md")
    readme = open(readme_path, encoding="utf-8").read() if os.path.exists(readme_path) else None

    ok_count = 0
    for seed, title, desc in AGENTS:
        creds = RegistrationRequestCredentials(
            agentverse_api_key=api_key, agent_seed_phrase=seed
        )
        try:
            ok = register_chat_agent(
                name=title,
                endpoint=endpoint,
                active=True,
                credentials=creds,
                description=desc,
                readme=readme,
            )
            print(f"  {title}: {'OK — on Agentverse' if ok else 'returned False'}")
            ok_count += int(bool(ok))
        except Exception as e:  # never hard-fail the whole batch
            print(f"  {title}: ERROR -> {e}")

    print(f"\n{ok_count}/{len(AGENTS)} registered. Run `python run_all.py` and keep it running for ASI:One chat.")


if __name__ == "__main__":
    main()
