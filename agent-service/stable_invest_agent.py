"""Stable-Invest — low-volatility stablecoin yield + tokenized T-bills (risk 1-5)."""
from common import build_agent

agent = build_agent(
    name="stable-invest",
    port=8001,
    seed="walletos-stable-invest-seed-v1",
    agent_type="stable_invest",
    title="Stable-Invest",
    blurb="Low-volatility stablecoin yield and tokenized T-bills for conservative growth.",
)

if __name__ == "__main__":
    agent.run()
