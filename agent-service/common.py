"""
common.py — shared uAgent factory for the WalletOS marketplace.

Each marketplace agent (Stable-Invest, Savings, Bill-Pay) is a Fetch uAgent that:
  - exposes a REST endpoint  POST /route   the Next.js backend calls to route funds
  - exposes a REST endpoint  GET  /health  for liveness + its on-chain identity
  - speaks the ASI:One chat protocol so it's discoverable/queryable on Agentverse

Run an agent directly (e.g. `python stable_invest_agent.py`) or all of them via
`python run_all.py`.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from uuid import uuid4

from dotenv import load_dotenv

# Load agent-service/.env so AGENTVERSE_API_KEY (and friends) are available.
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

from uagents import Agent, Context, Model, Protocol
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    TextContent,
    chat_protocol_spec,
)

from strategies import allocate, answer, describe


# ----- REST contract (must match lib/marketplace.ts on the backend) -----------

class RouteRequest(Model):
    amount: float
    risk_score: int
    user_id: str = "demo"


class RouteResponse(Model):
    accepted: bool
    agent: str
    strategy: str
    allocation: dict
    projected_apy: float
    explanation: str


class HealthResponse(Model):
    status: str
    agent: str
    title: str
    address: str


def build_agent(*, name: str, port: int, seed: str, agent_type: str,
                title: str, blurb: str) -> Agent:
    # mailbox=True connects to Agentverse for ASI:One discoverability when an
    # AGENTVERSE_API_KEY is present; otherwise the agent runs purely locally.
    use_mailbox = bool(os.getenv("AGENTVERSE_API_KEY"))
    readme = os.path.join(os.path.dirname(__file__), "README.md")
    agent = Agent(
        name=name,
        port=port,
        seed=seed,
        mailbox=use_mailbox,
        # Publish identity + capabilities to Agentverse (powers ASI:One discovery).
        publish_agent_details=use_mailbox,
        description=blurb,
        readme_path=readme if os.path.exists(readme) else None,
    )

    @agent.on_event("startup")
    async def _startup(ctx: Context):
        ctx.logger.info(f"{title} live on :{port} | address={agent.address}")

    @agent.on_rest_post("/route", RouteRequest, RouteResponse)
    async def _route(ctx: Context, req: RouteRequest) -> RouteResponse:
        plan = allocate(agent_type, req.amount, req.risk_score)
        ctx.logger.info(
            f"route: {req.amount} USDC @ risk {req.risk_score} -> {plan['strategy']}"
        )
        return RouteResponse(
            accepted=True,
            agent=name,
            strategy=plan["strategy"],
            allocation=plan["allocation"],
            projected_apy=plan["apy"],
            explanation=plan["explanation"].format(
                amount=req.amount, risk=req.risk_score, apy=plan["apy"]
            ),
        )

    @agent.on_rest_get("/health", HealthResponse)
    async def _health(ctx: Context) -> HealthResponse:
        return HealthResponse(
            status="ok", agent=name, title=title, address=str(agent.address)
        )

    # ASI:One chat protocol — lets users discover & query the agent in natural language.
    chat = Protocol(spec=chat_protocol_spec)

    @chat.on_message(ChatMessage)
    async def _on_chat(ctx: Context, sender: str, msg: ChatMessage):
        await ctx.send(
            sender,
            ChatAcknowledgement(
                timestamp=datetime.now(timezone.utc), acknowledged_msg_id=msg.msg_id
            ),
        )
        text = " ".join(c.text for c in msg.content if isinstance(c, TextContent))
        reply = answer(agent_type, title, blurb, text)
        await ctx.send(
            sender,
            ChatMessage(
                timestamp=datetime.now(timezone.utc),
                msg_id=uuid4(),
                content=[TextContent(type="text", text=reply)],
            ),
        )

    @chat.on_message(ChatAcknowledgement)
    async def _on_ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
        pass

    agent.include(chat, publish_manifest=True)
    return agent
