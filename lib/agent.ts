/**
 * lib/agent.ts — the Claude tool-use loop ("the brain").
 *
 * Claude reasons about the user's request and acts ONLY through the tools in
 * lib/tools.ts (which are the only code that touches the wallet/Redis). This is
 * a manual agentic loop: call the Messages API, run any requested tools, feed the
 * results back, and repeat until Claude ends its turn.
 *
 * Model: claude-opus-4-8 with adaptive thinking (the brain plans, then acts).
 */

import Anthropic from "@anthropic-ai/sdk";
import { tools, executeTool, hydratePolicy } from "./tools";
import { getEventCursor, getEventsSince } from "./redis";
import { USER_ID, type AppEvent } from "./wallet-types";

const MODEL = "claude-opus-4-8";
const MAX_TOOL_ROUNDS = 8;

const SYSTEM = `You are WalletOS — a calm, plain-spoken private banker for everyday people. \
You help the user move, save, and invest their money by ACTING through tools, then explaining what you did in plain English so they learn.

Operating rules:
- You move REAL test USDC on the Base Sepolia testnet. Treat every transfer as real money.
- Always call get_balance before moving money so you know what's actually available.
- To pay a person, use send_payment with their 0x address. NEVER invent or guess an address — if the user hasn't given one, ask for it.
- "Keep rent safe" / "protect X" → create_automation with type protect_bucket (reserves into a protected bucket).
- "Send $X every month" → create_automation with type recurring_transfer.
- "Invest the rest, I'm a N out of 10 on risk" → call route_to_agent with ONLY amount and riskScore N. Do NOT pass the agent field — the system risk-gates to the right investing agent (Stable-Invest for moderate risk). Pass agent:"savings" ONLY if the user literally says "save"/"savings", and agent:"bill_pay" only for a bills reserve. Reserve protected buckets (e.g. rent) BEFORE routing the remainder, so the routed amount fits Available.
- After you finish acting, ALWAYS call explain_decision with a short, warm, plain-English summary of what you did and why. No jargon, no "crypto".
- Be concise. Don't narrate routine steps; act, then explain at the end.
- The spending policy enforces a per-transaction limit. If a tool returns a policy_violation, explain it kindly and suggest set_policy or a smaller amount.`;

export interface AgentToolCall {
  name: string;
  input: unknown;
  result: unknown;
  ok: boolean;
}

export interface AgentTurn {
  reply: string;
  toolCalls: AgentToolCall[];
  /** Realtime events published during this turn (for the UI feed). */
  events: AppEvent[];
}

// In-process conversation history (single-user demo). Survives within a process.
const histories = new Map<string, Anthropic.MessageParam[]>();

export function resetConversation(userId = USER_ID): void {
  histories.delete(userId);
}

export async function runAgent(userText: string, userId = USER_ID): Promise<AgentTurn> {
  await hydratePolicy();
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

  const history = histories.get(userId) ?? [];
  history.push({ role: "user", content: userText });

  const cursor = await getEventCursor();
  const toolCalls: AgentToolCall[] = [];
  let reply = "";

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system: SYSTEM,
      tools,
      messages: history,
    });

    // Preserve the full assistant turn (incl. thinking + tool_use blocks).
    history.push({ role: "assistant", content: res.content });

    if (res.stop_reason !== "tool_use") {
      reply = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      break;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of res.content) {
      if (block.type !== "tool_use") continue;
      const outcome = await executeTool(
        block.name,
        block.input as Record<string, unknown>,
      );
      toolCalls.push({
        name: block.name,
        input: block.input,
        result: outcome.result,
        ok: outcome.ok,
      });
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: JSON.stringify(outcome.result),
        is_error: !outcome.ok,
      });
    }
    history.push({ role: "user", content: toolResults });
  }

  histories.set(userId, history);
  const events = await getEventsSince(cursor);
  return { reply, toolCalls, events };
}
