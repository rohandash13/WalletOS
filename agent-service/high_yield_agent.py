"""High-Yield — aggressive DeFi yield farming + momentum (risk 9-10)."""
from common import build_agent

agent = build_agent(
    name="high-yield",
    port=8006,
    seed="walletos-high-yield-seed-v1",
    agent_type="high_yield",
    title="High-Yield",
    blurb="Aggressive DeFi yield farming and a momentum basket. High risk, high potential.",
)

if __name__ == "__main__":
    agent.run()
