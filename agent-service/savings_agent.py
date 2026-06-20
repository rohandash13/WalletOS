"""Savings — liquid, capital-preserving stablecoin savings, instant access (risk 1-3)."""
from common import build_agent

agent = build_agent(
    name="savings",
    port=8002,
    seed="walletos-savings-seed-v1",
    agent_type="savings",
    title="Savings",
    blurb="Liquid, capital-preserving savings with no lockup.",
)

if __name__ == "__main__":
    agent.run()
