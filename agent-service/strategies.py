"""
strategies.py — risk-aware allocation logic shared by the marketplace uAgents.

risk_score is 1 (most conservative) .. 10 (most aggressive). Each agent turns an
amount + risk score into a concrete allocation, a projected APY, and a plain-English
explanation the Claude brain can relay to the user.

This is intentionally simple, deterministic math — a hackathon "investment policy",
not financial advice. Everything runs on Base Sepolia testnet.
"""

from __future__ import annotations


def _clamp_risk(risk_score: int) -> int:
    return max(1, min(10, int(risk_score)))


def _round_alloc(alloc: dict[str, float]) -> dict[str, float]:
    """Round to 2dp and fix any rounding drift so weights sum to 1.0."""
    out = {k: round(v, 2) for k, v in alloc.items()}
    drift = round(1.0 - sum(out.values()), 2)
    if out and abs(drift) >= 0.01:
        first = next(iter(out))
        out[first] = round(out[first] + drift, 2)
    return out


def allocate(agent_type: str, amount: float, risk_score: int) -> dict:
    """Return {strategy, allocation, apy, explanation} for the given agent."""
    r = _clamp_risk(risk_score)

    if agent_type == "stable_invest":
        # Mostly safe holdings with a little steady growth.
        safe = max(0.50, 1.00 - r * 0.08)
        allocation = _round_alloc({
            "safe_savings": safe,
            "steady_growth": 1 - safe,
        })
        apy = round(3.5 + r * 0.55, 2)
        strategy = "Steady, low-risk growth that beats a regular savings account."
        explanation = (
            "I put {amount} USDC into Stable-Invest — mostly safe holdings with a little "
            "steady growth. Low ups and downs, about {apy}% a year."
        )

    elif agent_type == "savings":
        # Safe and easy to reach, earning a little extra.
        allocation = _round_alloc({
            "safe_savings": 0.9,
            "steady_growth": 0.1,
        })
        apy = round(3.0 + r * 0.15, 2)
        strategy = "Keeps your money safe and easy to reach, earning a little extra."
        explanation = (
            "I put {amount} USDC into Savings — safe, easy to access, earning about "
            "{apy}% a year with no lock-up."
        )

    elif agent_type == "balanced_growth":
        # A balanced mix of safe and growing money.
        safe = max(0.30, 0.55 - r * 0.03)
        allocation = _round_alloc({
            "safe_savings": safe,
            "steady_growth": (1 - safe) * 0.7,
            "higher_growth": (1 - safe) * 0.3,
        })
        apy = round(6.0 + r * 0.8, 2)
        strategy = "A balanced mix of safe and growing money for steady progress."
        explanation = (
            "I put {amount} USDC into Balanced-Growth — a mix of safe and growing money "
            "for steady progress. About {apy}% a year, with some ups and downs."
        )

    elif agent_type == "growth":
        # Aims for higher growth over time.
        higher = min(0.60, 0.30 + r * 0.04)
        allocation = _round_alloc({
            "higher_growth": higher,
            "steady_growth": (1 - higher) * 0.7,
            "safe_savings": (1 - higher) * 0.3,
        })
        apy = round(9.0 + r * 1.2, 2)
        strategy = "Aims for higher growth over time, with more ups and downs."
        explanation = (
            "I put {amount} USDC into Growth — aiming for higher returns over time. "
            "Expect more ups and downs. About {apy}% a year."
        )

    elif agent_type == "high_yield":
        # The most aggressive option.
        allocation = _round_alloc({
            "higher_growth": 0.8,
            "steady_growth": 0.2,
        })
        apy = round(12.0 + r * 1.6, 2)
        strategy = "The highest growth potential — higher risk and bigger swings."
        explanation = (
            "I put {amount} USDC into High-Yield — the most aggressive option, aiming for "
            "the highest growth. Big swings, so keep only money you won't need soon here. "
            "About {apy}% a year."
        )

    elif agent_type == "bill_pay":
        # Money set aside, fully available, to cover bills.
        allocation = _round_alloc({
            "cash_reserve": 1.0,
        })
        apy = 0.0
        strategy = "Sets aside money so your bills are always covered."
        explanation = (
            "I set aside {amount} USDC with Bill-Pay so your scheduled bills are always "
            "covered and never bounce."
        )

    else:
        allocation = _round_alloc({"safe_savings": 1.0})
        apy = round(3.0 + r * 0.4, 2)
        strategy = "Keeps your money safe and earning a little."
        explanation = "I put {amount} USDC into a safe, steady savings strategy."

    return {
        "strategy": strategy,
        "allocation": allocation,
        "apy": apy,
        "explanation": explanation,
    }


def describe(agent_type: str, title: str, blurb: str) -> str:
    """A one-paragraph self-description for ASI:One / chat queries."""
    sample = allocate(agent_type, 100.0, 3)
    alloc = ", ".join(f"{int(v * 100)}% {k.replace('_', ' ')}" for k, v in sample["allocation"].items())
    return (
        f"{title} — {blurb} "
        f"Strategy: {sample['strategy']}. "
        f"At a 3/10 risk on $100 I'd allocate {alloc} for a projected {sample['apy']}% APY. "
        f"Send me a route request (amount + risk score 1-10) and I'll invest on your behalf."
    )


def answer(agent_type: str, title: str, blurb: str, query: str) -> str:
    """Lightweight natural-language responder for the ASI:One chat protocol."""
    q = (query or "").lower()
    if any(w in q for w in ("apy", "yield", "return", "interest")):
        s = allocate(agent_type, 100.0, 5)
        return f"{title} targets roughly {s['apy']}% APY at a 5/10 risk level. {s['strategy']}."
    if any(w in q for w in ("strategy", "how", "allocate", "invest", "risk")):
        return describe(agent_type, title, blurb)
    if any(w in q for w in ("hi", "hello", "hey", "what", "who")):
        return describe(agent_type, title, blurb)
    return describe(agent_type, title, blurb)
