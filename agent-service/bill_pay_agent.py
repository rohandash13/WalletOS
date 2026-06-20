"""Bill-Pay — holds a liquid reserve earmarked for scheduled obligations (any risk)."""
from common import build_agent

agent = build_agent(
    name="bill-pay",
    port=8003,
    seed="walletos-bill-pay-seed-v1",
    agent_type="bill_pay",
    title="Bill-Pay",
    blurb="A liquid reserve that guarantees your scheduled bills never bounce.",
)

if __name__ == "__main__":
    agent.run()
