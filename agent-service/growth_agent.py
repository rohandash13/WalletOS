"""Growth — blue-chip crypto + DeFi liquidity for higher growth (risk 7-8)."""
from common import build_agent

agent = build_agent(
    name="growth",
    port=8005,
    seed="walletos-growth-seed-v1",
    agent_type="growth",
    title="Growth",
    blurb="Blue-chip crypto and DeFi liquidity for higher returns and more volatility.",
)

if __name__ == "__main__":
    agent.run()
