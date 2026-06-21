"""Balanced-Growth — stable yield + blue-chip staking for steady growth (risk 5-6)."""
from common import build_agent

agent = build_agent(
    name="balanced-growth",
    port=8004,
    seed="walletos-balanced-growth-seed-v1",
    agent_type="balanced_growth",
    title="Balanced-Growth",
    blurb="A balanced mix of stablecoin yield and blue-chip staking for steady growth.",
)

if __name__ == "__main__":
    agent.run()
