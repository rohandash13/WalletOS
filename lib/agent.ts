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
- You move REAL test USDC on the Base Sepolia testnet. Treat every transfer as real money. Demo scale: 1 test USDC represents $1,000 in the user-facing app, so a $50 payment settles as 0.05 test USDC on-chain.
- Always call get_balance before moving money so you know what's actually available.
- To pay a person, use send_payment with their 0x address. NEVER invent or guess an address — if the user hasn't given one, ask for it. EXCEPTION (demo): if the user refers to a family member (e.g. "sister", "mom", "family") without an address, use the demo family recipient 0xC7c2EBcC545034d4Bc25F92b5444c064bDE806b9 and proceed.
- "I need $X back" / "move some back to checking/available" → call rebalance_funds with amount X. It pulls from stable_invest by default; do NOT pull from protected rent unless the user explicitly insists.
- If the user frames money as future income ("I get paid", "every paycheck", "on payday", "on the 1st"), create automations only. Do NOT spend, protect, or invest the current balance immediately. Those rules run when payday is generated.
- "Keep rent safe" / "protect X" in a paycheck/payday context → create_automation with type protect_bucket, bucket rent, schedule "payday". If no rent amount is given, assume $1,200/month, and note the assumption.
- "Protect X now" / "move X to rent now" outside a paycheck context → create_automation with type protect_bucket, bucket rent, without schedule "payday".
- "Send $X every month" → create_automation with type recurring_transfer. Send immediately with send_payment only if the user explicitly says to send it now.
- "Move/save X% of every paycheck to savings" → create_automation with type rule, category auto_save, percent X, schedule "payday". Do not move money until payday lands.
- "Invest X% of every paycheck" → create_automation with type rule, category recurring_invest, percent X, schedule "payday". Do not move money until payday lands.
- "Invest the rest" for a stated paycheck amount → compute the remainder after protected amounts and recurring transfers, then create_automation with type rule, category recurring_invest, amount remainder, schedule "payday". Do not route_to_agent until payday lands.
- Payday/income is processed by /api/payday, which sends scaled real test USDC from a CDP payroll wallet into the user's wallet and then executes payday automations.
- "Invest the rest, I'm a N out of 10 on risk" → call route_to_agent with ONLY amount and riskScore N. Do NOT pass the agent field — the system auto-gates by risk AND amount across tiers: Savings/Stable-Invest (low risk), Balanced-Growth (mid), Growth (high risk, needs ≥$500), High-Yield (very high risk, needs ≥$1000). A high risk score with too small an amount steps down to the best affordable tier. Pass an explicit agent id only if the user names a specific strategy (incl. a user-created agent). Reserve protected buckets (e.g. rent) BEFORE routing the remainder, so the routed amount fits Available.
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

export function resetConversation(userId: string = USER_ID): void {
  histories.delete(userId);
}

export async function runAgent(
  userText: string,
  userId: string = USER_ID,
): Promise<AgentTurn> {
  await hydratePolicy(userId);
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

  const history = histories.get(userId) ?? [];
  history.push({ role: "user", content: userText });

  const cursor = await getEventCursor(userId);
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
        { userId },
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
  const events = await getEventsSince(cursor, 100, userId);
  return { reply, toolCalls, events };
}
