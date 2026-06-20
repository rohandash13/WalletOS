/**
 * lib/agent-factory.ts — create a marketplace agent on the fly.
 *
 * A "dynamic agent" is a STRATEGY SPEC, not a new process: Claude turns a
 * plain-English goal into a structured strategy (name, thesis, asset allocation,
 * risk band, projected APY), which we persist in the registry (lib/redis) and serve
 * with the shared local strategy engine (lib/marketplace). This is why creation is
 * fast and cheap — one structured LLM call, no per-agent server/port/Almanac
 * registration. See the marketplace docs for the routing path.
 */

import Anthropic from "@anthropic-ai/sdk";
import { saveDynamicAgent, type StoredAgent } from "./redis";

const MODEL = "claude-opus-4-8";

const EMIT_TOOL: Anthropic.Tool = {
  name: "emit_agent",
  description: "Emit a structured marketplace investing-agent spec.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short product name, e.g. 'Yield Hunter'" },
      description: {
        type: "string",
        description: "One sentence on what this agent does and who it's for.",
      },
      strategy: { type: "string", description: "One-line strategy thesis." },
      allocation: {
        type: "object",
        description:
          "Asset weights that sum to ~1.0, keys snake_case (e.g. stablecoin_yield, blue_chip_staking, defi_liquidity, defi_yield_farming, momentum_basket).",
        additionalProperties: { type: "number" },
      },
      riskLow: { type: "number", description: "Lowest risk score served (1-10)." },
      riskHigh: { type: "number", description: "Highest risk score served (1-10)." },
      minAmount: { type: "number", description: "Minimum USDC to unlock (0 if none)." },
      projectedApy: { type: "number", description: "Projected annual yield %, realistic for the risk." },
    },
    required: [
      "title",
      "description",
      "strategy",
      "allocation",
      "riskLow",
      "riskHigh",
      "minAmount",
      "projectedApy",
    ],
  },
};

const SYSTEM = `You design specialized crypto-investing "agents" for a testnet wallet app. \
Given a user's goal, produce ONE realistic strategy spec via the emit_agent tool. \
Keep APY realistic for the risk (conservative 3-5%, balanced 7-10%, aggressive 12-25%). \
Higher risk → more volatile allocation (DeFi/momentum); lower risk → stablecoin yield / T-bills. \
Allocation weights must sum to about 1.0.`;

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 24) || "agent"
  );
}

function clampRisk(n: number): number {
  return Math.max(1, Math.min(10, Math.round(n)));
}

/** Generate + persist a dynamic agent from a plain-English goal. Returns the spec. */
export async function createAgentFromGoal(goal: string): Promise<StoredAgent> {
  const client = new Anthropic();
  // Forced tool_choice requires thinking to be off (a single structured emit, so
  // no reasoning budget needed) — this also keeps creation fast (~2-5s).
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1200,
    system: SYSTEM,
    tools: [EMIT_TOOL],
    tool_choice: { type: "tool", name: "emit_agent" },
    messages: [{ role: "user", content: `Create an investing agent for: ${goal}` }],
  });

  const block = res.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "emit_agent",
  );
  if (!block) throw new Error("Agent generation failed: no spec returned");
  const spec = block.input as {
    title: string;
    description: string;
    strategy: string;
    allocation: Record<string, number>;
    riskLow: number;
    riskHigh: number;
    minAmount: number;
    projectedApy: number;
  };

  const lo = clampRisk(spec.riskLow);
  const hi = Math.max(lo, clampRisk(spec.riskHigh));
  const agent: StoredAgent = {
    id: `dyn_${slugify(spec.title)}_${Math.random().toString(36).slice(2, 6)}`,
    title: spec.title.trim(),
    description: spec.description.trim(),
    riskBand: [lo, hi],
    minAmount: Math.max(0, Number(spec.minAmount) || 0),
    kind: "invest",
    strategy: spec.strategy.trim(),
    allocation: spec.allocation ?? {},
    projectedApy: Math.round((Number(spec.projectedApy) || 0) * 100) / 100,
    createdAt: Date.now(),
  };
  await saveDynamicAgent(agent);
  return agent;
}
