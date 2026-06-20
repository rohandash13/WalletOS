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
        # Conservative core (stablecoin yield) shrinks as risk rises; a growth
        # sleeve (blue-chip / staking) grows with risk.
        stable = max(0.40, 1.00 - r * 0.06)          # r=3 -> 0.82
        tbills = (1 - stable) * 0.5
        growth = (1 - stable) * 0.5
        allocation = _round_alloc({
            "stablecoin_yield": stable,
            "tokenized_tbills": tbills,
            "blue_chip_staking": growth,
        })
        apy = round(3.5 + r * 0.55, 2)               # ~4.1% .. 9.0%
        strategy = "Capital-preservation core with a small risk-scaled growth sleeve"
        explanation = (
            "I placed {amount} USDC with Stable-Invest. At a {risk}/10 risk level, "
            "most of it sits in low-volatility stablecoin yield and tokenized T-bills, "
            "with a small slice in blue-chip staking for upside. Projected ~{apy}% APY."
        )

    elif agent_type == "savings":
        # Pure preservation — risk barely moves the needle.
        allocation = _round_alloc({
            "stablecoin_yield": 0.85,
            "tokenized_tbills": 0.15,
        })
        apy = round(3.0 + r * 0.15, 2)               # ~3.1% .. 4.5%
        strategy = "Liquid preservation — instant-access stablecoin savings"
        explanation = (
            "I moved {amount} USDC into Savings — a liquid, capital-preserving bucket "
            "earning ~{apy}% with no lockup, so you can pull it back any time."
        )

    elif agent_type == "balanced_growth":
        # Balanced mix: stable yield core + blue-chip staking + a little DeFi.
        stable = max(0.35, 0.70 - r * 0.04)
        allocation = _round_alloc({
            "stablecoin_yield": stable,
            "blue_chip_staking": (1 - stable) * 0.6,
            "defi_liquidity": (1 - stable) * 0.4,
        })
        apy = round(6.0 + r * 0.8, 2)                 # ~10% .. 14%
        strategy = "Balanced stable yield + blue-chip staking for steady growth"
        explanation = (
            "I placed {amount} USDC with Balanced-Growth at {risk}/10 risk — a blend of "
            "stablecoin yield and blue-chip staking with a small DeFi sleeve. ~{apy}% APY."
        )

    elif agent_type == "growth":
        # Growth-tilted: blue-chip crypto + DeFi liquidity, more volatility.
        blue = min(0.60, 0.30 + r * 0.04)
        allocation = _round_alloc({
            "blue_chip_staking": blue,
            "defi_liquidity": (1 - blue) * 0.6,
            "stablecoin_yield": (1 - blue) * 0.4,
        })
        apy = round(9.0 + r * 1.2, 2)                 # ~17% .. 21%
        strategy = "Blue-chip crypto + DeFi liquidity for higher growth"
        explanation = (
            "I placed {amount} USDC with Growth at {risk}/10 risk — majority blue-chip "
            "crypto and DeFi liquidity for higher returns and more volatility. ~{apy}% APY."
        )

    elif agent_type == "high_yield":
        # Aggressive: DeFi yield farming + momentum basket.
        allocation = _round_alloc({
            "defi_yield_farming": 0.55,
            "momentum_basket": 0.30,
            "blue_chip_staking": 0.15,
        })
        apy = round(12.0 + r * 1.6, 2)                # ~25% .. 28%
        strategy = "Aggressive DeFi yield farming + momentum basket"
        explanation = (
            "I placed {amount} USDC with High-Yield at {risk}/10 risk — aggressive DeFi "
            "yield farming and a momentum basket. High risk, high potential ~{apy}% APY."
        )

    elif agent_type == "bill_pay":
        # Reserve held fully liquid to cover upcoming obligations.
        allocation = _round_alloc({
            "liquid_reserve": 1.0,
        })
        apy = 0.0
        strategy = "Liquid reserve earmarked for scheduled bills"
        explanation = (
            "I reserved {amount} USDC with Bill-Pay to cover your scheduled "
            "obligations. It's held fully liquid so payments never bounce."
        )

    else:
        allocation = _round_alloc({"stablecoin_yield": 1.0})
        apy = round(3.0 + r * 0.4, 2)
        strategy = "Default stablecoin yield"
        explanation = "I placed {amount} USDC in a default stablecoin-yield strategy."

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
