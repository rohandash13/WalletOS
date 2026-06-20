"""
register.py — programmatically publish the marketplace agents to Agentverse so
they're discoverable and chat-queryable on ASI:One. Uses your AGENTVERSE_API_KEY.

    python register.py

This is the programmatic alternative to clicking "Connect" in the agent Inspector.
Run it once (or whenever you change descriptions). Safe to re-run.
"""

import os

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

from uagents_core.utils.registration import (  # noqa: E402
    RegistrationRequestCredentials,
    register_chat_agent,
)

# (name, seed, port, title, description) — seeds MUST match the *_agent.py files.
AGENTS = [
    ("stable-invest", "walletos-stable-invest-seed-v1", 8001, "Stable-Invest",
     "Low-volatility stablecoin yield + tokenized T-bills with a small growth sleeve."),
    ("savings", "walletos-savings-seed-v1", 8002, "Savings",
     "Liquid, capital-preserving savings with no lockup."),
    ("bill-pay", "walletos-bill-pay-seed-v1", 8003, "Bill-Pay",
     "A liquid reserve that guarantees your scheduled bills never bounce."),
]


def main() -> None:
    api_key = os.getenv("AGENTVERSE_API_KEY")
    if not api_key:
        raise SystemExit("Set AGENTVERSE_API_KEY in agent-service/.env first.")

    readme_path = os.path.join(os.path.dirname(__file__), "README.md")
    readme = open(readme_path, encoding="utf-8").read() if os.path.exists(readme_path) else None

    for name, seed, port, title, desc in AGENTS:
        creds = RegistrationRequestCredentials(
            agentverse_api_key=api_key, agent_seed_phrase=seed
        )
        try:
            ok = register_chat_agent(
                name=name,
                endpoint=f"http://127.0.0.1:{port}/submit",
                active=True,
                credentials=creds,
                description=desc,
                readme=readme,
            )
            print(f"{title}: {'registered on Agentverse' if ok else 'registration returned False'}")
        except Exception as e:  # never hard-fail the whole batch
            print(f"{title}: registration error -> {e}")


if __name__ == "__main__":
    main()
