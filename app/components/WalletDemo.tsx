"use client";

import {
  ArrowLeftRight,
  Bot,
  CalendarClock,
  ExternalLink,
  Lock,
  MessageSquareText,
  PiggyBank,
  Plus,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  User,
  Wallet,
} from "lucide-react";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  Action,
  Automation,
  BalanceResponse,
  Bucket,
  ChatResponse,
  WalletEvent,
} from "@/lib/types";

type Tab = "chat" | "automations" | "marketplace";

type Message = { id: string; role: "user" | "assistant"; text: string };

type MarketAgent = {
  id: string;
  title: string;
  description: string;
  riskBand: [number, number];
  minAmount: number;
  kind: "invest" | "reserve";
  dynamic: boolean;
  strategy?: string;
  projectedApy?: number;
  online: boolean;
};

const DEMO_USER_ID = process.env.NEXT_PUBLIC_DEMO_USER_ID ?? "demo-user";

const PRIMARY_PROMPT =
  "I get paid $2k on the 1st. Send my sister $50 every month, keep rent safe, and invest the rest low-risk - I'm a 3 out of 10 on risk.";
const RECOVERY_PROMPT = "Actually, I need $200 back.";

const WELCOME =
  "Tell me what should happen with your money and I'll set it up — moving, protecting, and investing in plain English.";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function actionLabel(a: Action) {
  if (a.type === "send_payment") return "Payment sent";
  if (a.type === "route_to_agent") return "Routed to agent";
  if (a.type === "rebalance_funds") return "Funds moved back";
  if (a.type === "policy_updated") return "Policy updated";
  if (a.type === "automation_created") return "Automation created";
  return "Done";
}

function actionDescription(a: Action) {
  if (a.type === "rebalance_funds" && a.amount) {
    return `${money.format(a.amount)} moved back to Available`;
  }
  if (a.agentName) {
    return `${a.agentName}${a.amount ? ` · ${money.format(a.amount)}` : ""}`;
  }
  if (a.amount) return money.format(a.amount);
  return "Rule prepared";
}

function ActionIcon({ type }: { type: string }) {
  if (type === "send_payment" || type === "rebalance_funds")
    return <ArrowLeftRight size={15} />;
  if (type === "route_to_agent") return <PiggyBank size={15} />;
  return <CalendarClock size={15} />;
}

function tone(status: string) {
  if (["confirmed", "completed", "active", "ready"].includes(status)) return "good";
  if (["pending", "created"].includes(status)) return "pending";
  if (status === "failed") return "bad";
  return "neutral";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function WalletDemo() {
  const [tab, setTab] = useState<Tab>("chat");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    { id: "welcome", role: "assistant", text: WELCOME },
  ]);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [events, setEvents] = useState<WalletEvent[]>([]);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [agents, setAgents] = useState<MarketAgent[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [riskScore, setRiskScore] = useState<number | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  const total = useMemo(
    () => buckets.reduce((sum, b) => sum + b.balance, 0),
    [buckets],
  );
  const available = useMemo(
    () => buckets.find((b) => b.key === "checking")?.balance ?? 0,
    [buckets],
  );

  const refreshLiveData = useCallback(async () => {
    try {
      const [bal, ev, au] = await Promise.all([
        fetch(`/api/balance?userId=${DEMO_USER_ID}`, { cache: "no-store" }),
        fetch(`/api/events?userId=${DEMO_USER_ID}`, { cache: "no-store" }),
        fetch(`/api/automations?userId=${DEMO_USER_ID}`, { cache: "no-store" }),
      ]);
      if (bal.ok) setBuckets(((await bal.json()) as BalanceResponse).buckets);
      if (ev.ok) setEvents(((await ev.json()) as { events: WalletEvent[] }).events);
      if (au.ok)
        setAutomations(((await au.json()) as { automations: Automation[] }).automations);
    } catch {
      /* keep last state if the backend is briefly unavailable */
    }
  }, []);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch("/api/marketplace", { cache: "no-store" });
      if (res.ok) setAgents(((await res.json()) as { agents: MarketAgent[] }).agents);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refreshLiveData();
    const interval = window.setInterval(refreshLiveData, 1600);
    return () => window.clearInterval(interval);
  }, [refreshLiveData]);

  useEffect(() => {
    if (tab === "marketplace") void fetchAgents();
  }, [tab, fetchAgents]);

  async function submitMessage(text: string) {
    const msg = text.trim();
    if (!msg || isSending) return;
    setIsSending(true);
    setInput("");
    setActions([]);
    setMessages((c) => [...c, { id: `u_${Date.now()}`, role: "user", text: msg }]);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: DEMO_USER_ID, message: msg, mode: "text" }),
      });
      if (!res.ok) throw new Error("chat failed");
      const body = (await res.json()) as ChatResponse;
      setMessages((c) => [
        ...c,
        { id: `a_${Date.now()}`, role: "assistant", text: body.assistantMessage },
      ]);
      setActions(body.actions ?? []);
      if (body.buckets) setBuckets(body.buckets);
      setEvents(body.events ?? events);
      setAutomations(body.automations ?? automations);
      setRiskScore(body.riskScore ?? riskScore);
      setWhy(body.why ?? why);
    } catch {
      setMessages((c) => [
        ...c,
        {
          id: `err_${Date.now()}`,
          role: "assistant",
          text: "I couldn't reach the backend just now — please try again.",
        },
      ]);
    } finally {
      setIsSending(false);
      void refreshLiveData();
    }
  }

  async function resetDemo() {
    await fetch("/api/reset", { method: "POST" });
    setTab("chat");
    setInput("");
    setMessages([{ id: "welcome", role: "assistant", text: WELCOME }]);
    setActions([]);
    setRiskScore(null);
    setWhy(null);
    void refreshLiveData();
  }

  return (
    <main className="app">
      <div className="shell">
        <header className="topbar">
          <div className="brand">
            <div className="logo">
              <Wallet size={19} />
            </div>
            <div className="brand-text">
              <span className="brand-name">WalletOS</span>
              <span className="brand-tag">Your private banker</span>
            </div>
          </div>
          <div className="topbar-right">
            <span className="pill">
              <ShieldCheck size={13} />
              Testnet USDC
            </span>
            <button className="btn btn-ghost" type="button" onClick={() => void resetDemo()}>
              <RotateCcw size={14} />
              Reset
            </button>
          </div>
        </header>

        <div className="layout">
          <div className="main-col">
            <nav className="tabs">
              <button
                className={`tab ${tab === "chat" ? "active" : ""}`}
                onClick={() => setTab("chat")}
              >
                <MessageSquareText size={15} />
                Chat
              </button>
              <button
                className={`tab ${tab === "automations" ? "active" : ""}`}
                onClick={() => setTab("automations")}
              >
                <CalendarClock size={15} />
                Automations
              </button>
              <button
                className={`tab ${tab === "marketplace" ? "active" : ""}`}
                onClick={() => setTab("marketplace")}
              >
                <Bot size={15} />
                Agents
              </button>
            </nav>

            {tab === "chat" && (
              <ChatPanel
                input={input}
                isSending={isSending}
                messages={messages}
                actions={actions}
                onInputChange={setInput}
                onSubmit={(e) => {
                  e.preventDefault();
                  void submitMessage(input);
                }}
                onDemo={() => void submitMessage(PRIMARY_PROMPT)}
                onRecovery={() => void submitMessage(RECOVERY_PROMPT)}
              />
            )}

            {tab === "automations" && (
              <AutomationsPanel
                automations={automations}
                onCreate={async (payload) => {
                  await fetch("/api/automations", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                  });
                  void refreshLiveData();
                }}
              />
            )}

            {tab === "marketplace" && (
              <MarketplacePanel
                agents={agents}
                events={events}
                riskScore={riskScore}
                available={available}
                onCreate={async (goal) => {
                  await fetch("/api/marketplace", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ goal }),
                  });
                  await fetchAgents();
                }}
              />
            )}
          </div>

          <aside className="side-col">
            <PortfolioCard buckets={buckets} total={total} riskScore={riskScore} why={why} />
            <ActivityCard events={events} />
          </aside>
        </div>
      </div>
    </main>
  );
}

function ChatPanel({
  input,
  isSending,
  messages,
  actions,
  onInputChange,
  onSubmit,
  onDemo,
  onRecovery,
}: {
  input: string;
  isSending: boolean;
  messages: Message[];
  actions: Action[];
  onInputChange: (v: string) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  onDemo: () => void;
  onRecovery: () => void;
}) {
  const stackRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    stackRef.current?.scrollTo({ top: stackRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, actions]);

  return (
    <div className="card panel chat">
      <div className="messages" ref={stackRef}>
        {messages.map((m) => (
          <div className={`msg ${m.role}`} key={m.id}>
            <div className="msg-avatar">
              {m.role === "assistant" ? <Sparkles size={14} /> : <User size={14} />}
            </div>
            <div className="bubble">{m.text}</div>
          </div>
        ))}

        {actions.length > 0 && (
          <div className="actions">
            {actions.map((a, i) => (
              <div className="action" key={`${a.type}_${i}`}>
                <div className="action-icon">
                  <ActionIcon type={a.type} />
                </div>
                <div className="action-body">
                  <h4>{actionLabel(a)}</h4>
                  <p>{actionDescription(a)}</p>
                  {a.explorerUrl && (
                    <a className="proof" href={a.explorerUrl} target="_blank" rel="noreferrer">
                      View on-chain proof <ExternalLink size={12} />
                    </a>
                  )}
                </div>
                <span className={`tag ${tone(a.status)}`}>{a.status}</span>
              </div>
            ))}
          </div>
        )}

        {isSending && (
          <div className="working">
            <span className="spinner" />
            Working on it…
          </div>
        )}
      </div>

      <form className="composer" onSubmit={onSubmit}>
        <input
          aria-label="Message WalletOS"
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          placeholder="Ask WalletOS to move, protect, or invest your money…"
        />
        <button className="send" type="submit" disabled={isSending}>
          <Send size={16} />
        </button>
      </form>

      <div className="suggestions">
        <button className="chip" type="button" onClick={onDemo} disabled={isSending}>
          ▶ Run example: payday plan
        </button>
        <button className="chip" type="button" onClick={onRecovery} disabled={isSending}>
          I need $200 back
        </button>
      </div>
    </div>
  );
}

type AutoPayload =
  | { type: "recurring_transfer"; amount: number; to: string; schedule: string; note?: string }
  | { type: "protect_bucket"; amount: number; bucket: "rent"; note?: string };

function AutomationsPanel({
  automations,
  onCreate,
}: {
  automations: Automation[];
  onCreate: (payload: AutoPayload) => Promise<void>;
}) {
  const [type, setType] = useState<"recurring_transfer" | "protect_bucket">(
    "recurring_transfer",
  );
  const [amount, setAmount] = useState("");
  const [to, setTo] = useState("");
  const [schedule, setSchedule] = useState("monthly");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const amt = Number(amount);
    if (!amt || amt <= 0 || busy) return;
    if (type === "recurring_transfer" && !/^0x[a-fA-F0-9]{40}$/.test(to.trim())) return;
    setBusy(true);
    try {
      await onCreate(
        type === "recurring_transfer"
          ? { type, amount: amt, to: to.trim(), schedule, note: note.trim() || undefined }
          : { type: "protect_bucket", amount: amt, bucket: "rent", note: note.trim() || undefined },
      );
      setAmount("");
      setTo("");
      setNote("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card panel">
      <div className="panel-head">
        <div>
          <h2>Automations</h2>
          <p className="sub">Rules that keep working after the chat.</p>
        </div>
        <span className="tag neutral">{automations.length} active</span>
      </div>

      <form className="auto-form" onSubmit={submit}>
        <div className="field">
          <label>Type</label>
          <select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
            <option value="recurring_transfer">Recurring transfer</option>
            <option value="protect_bucket">Protect funds</option>
          </select>
        </div>
        <div className="field">
          <label>Amount (USDC)</label>
          <input
            type="number"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="50"
          />
        </div>
        {type === "recurring_transfer" ? (
          <>
            <div className="field full">
              <label>Recipient address</label>
              <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="0x…" />
            </div>
            <div className="field">
              <label>Schedule</label>
              <select value={schedule} onChange={(e) => setSchedule(e.target.value)}>
                <option value="monthly">Monthly</option>
                <option value="weekly">Weekly</option>
                <option value="monthly:1">Monthly (1st)</option>
              </select>
            </div>
          </>
        ) : (
          <div className="field">
            <label>Protected as</label>
            <input value="Rent / safe reserve" disabled />
          </div>
        )}
        <div className="field full">
          <label>Note (optional)</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. rent to landlord" />
        </div>
        <div className="field full">
          <button className="btn btn-primary" type="submit" disabled={busy}>
            <Plus size={15} />
            {busy ? "Adding…" : "Add automation"}
          </button>
        </div>
      </form>

      {automations.length === 0 ? (
        <div className="empty">
          <CalendarClock size={26} />
          <h3>No automations yet</h3>
          <p>Add one above, or ask in chat — e.g. “send my sister $50 every month”.</p>
        </div>
      ) : (
        <div className="list">
          {automations.map((a) => (
            <div className="row-card" key={a.id}>
              <div className="row-icon">
                <CalendarClock size={17} />
              </div>
              <div className="row-main">
                <h3>{a.name}</h3>
                <p>{a.explanation}</p>
              </div>
              <div className="row-meta">
                <span className={`tag ${tone(a.status)}`}>{a.status}</span>
                <span className="when">Next {formatDate(a.nextRunAt)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MarketplacePanel({
  agents,
  events,
  riskScore,
  available,
  onCreate,
}: {
  agents: MarketAgent[];
  events: WalletEvent[];
  riskScore: number | null;
  available: number;
  onCreate: (goal: string) => Promise<void>;
}) {
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const agentEvents = events.filter((e) => e.type === "agent_routed");

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!goal.trim() || busy) return;
    setBusy(true);
    try {
      await onCreate(goal.trim());
      setGoal("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card panel">
      <div className="panel-head">
        <div>
          <h2>Agent Marketplace</h2>
          <p className="sub">Specialized investing agents, matched to your risk.</p>
        </div>
        <RiskBadge score={riskScore} />
      </div>

      <form className="create-agent" onSubmit={create}>
        <input
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="Describe a strategy to spin up an agent, e.g. “ETH staking with downside protection”"
        />
        <button className="btn btn-primary" type="submit" disabled={busy}>
          <Plus size={15} />
          {busy ? "Creating…" : "Create"}
        </button>
      </form>

      <div className="agent-grid">
        {agents.map((a) => {
          const lockedByAmount = available < a.minAmount;
          const inBand = riskScore == null || (riskScore >= a.riskBand[0] && riskScore <= a.riskBand[1]);
          const unlocked = !lockedByAmount && inBand;
          return (
            <div className={`agent ${unlocked ? "unlocked" : "locked"}`} key={a.id}>
              <div className="agent-top">
                <span className={`agent-dot ${a.online ? "online" : ""}`}>
                  <i />
                  {a.online ? "Online" : "Offline"}
                </span>
                {a.dynamic ? (
                  <span className="tag good">Custom</span>
                ) : a.kind === "reserve" ? (
                  <span className="tag neutral">Reserve</span>
                ) : inBand && riskScore != null ? (
                  <span className="tag good">Matched</span>
                ) : null}
              </div>
              <h3>{a.title}</h3>
              <p className="desc">{a.strategy ?? a.description}</p>
              <div className="agent-foot">
                <span>
                  Risk {a.riskBand[0]}–{a.riskBand[1]}
                  {a.minAmount > 0 && (
                    <>
                      {" · "}
                      {lockedByAmount ? (
                        <span style={{ color: "var(--warn)" }}>
                          <Lock size={10} style={{ verticalAlign: "-1px" }} /> {money.format(a.minAmount)}+
                        </span>
                      ) : (
                        `${money.format(a.minAmount)}+`
                      )}
                    </>
                  )}
                </span>
                {a.kind === "invest" && (
                  <span className="apy">
                    <TrendingUp size={11} style={{ verticalAlign: "-1px" }} />{" "}
                    {a.projectedApy ? `${a.projectedApy}%` : "—"}
                  </span>
                )}
              </div>
            </div>
          );
        })}
        {agents.length === 0 && <p className="muted">Loading agents…</p>}
      </div>

      <div className="divider" />
      <p className="section-label">Agent activity</p>
      {agentEvents.length === 0 ? (
        <p className="muted" style={{ marginTop: 8 }}>
          Routing activity will appear here after you invest.
        </p>
      ) : (
        <div className="activity" style={{ marginTop: 10 }}>
          {agentEvents.map((e) => (
            <div className="event" key={e.id}>
              <span className="dot" />
              <div className="event-body">
                <p>{e.message}</p>
                <time>{formatDate(e.createdAt)}</time>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PortfolioCard({
  buckets,
  total,
  riskScore,
  why,
}: {
  buckets: Bucket[];
  total: number;
  riskScore: number | null;
  why: string | null;
}) {
  const max = Math.max(...buckets.map((b) => b.balance), 1);
  return (
    <div className="card panel">
      <div className="panel-head" style={{ marginBottom: 4 }}>
        <div>
          <p className="eyebrow">Portfolio</p>
          <div className="total">{money.format(total)}</div>
        </div>
        <RiskBadge score={riskScore} />
      </div>

      <div className="buckets">
        {buckets.map((b) => (
          <div className="bucket" key={b.key}>
            <div className="bucket-top">
              <span>{b.name}</span>
              <strong>{money.format(b.balance)}</strong>
            </div>
            <div className="bar">
              <span
                className={b.key}
                style={{ width: `${Math.max((b.balance / max) * 100, b.balance ? 6 : 0)}%` }}
              />
            </div>
            {b.protected && (
              <span className="protected-note">
                <ShieldCheck size={11} /> Protected first
              </span>
            )}
          </div>
        ))}
        {buckets.length === 0 && <p className="muted">Loading balance…</p>}
      </div>

      {why && (
        <div className="why">
          <div className="why-head">
            <Sparkles size={13} color="var(--warn)" />
            <span>Why this happened</span>
          </div>
          <p>{why}</p>
        </div>
      )}
    </div>
  );
}

function RiskBadge({ score }: { score: number | null }) {
  return (
    <div className={`risk-badge ${score ? "set" : ""}`}>
      <span className="lbl">Risk</span>
      <span className="val">{score ? `${score}/10` : "Not set"}</span>
    </div>
  );
}

function ActivityCard({ events }: { events: WalletEvent[] }) {
  return (
    <div className="card panel">
      <div className="panel-head" style={{ marginBottom: 4 }}>
        <p className="section-label">Live activity</p>
        <span className="live-dot" />
      </div>
      {events.length === 0 ? (
        <p className="muted" style={{ marginTop: 10 }}>
          Payments, rules, and agent routes will stream here.
        </p>
      ) : (
        <div className="activity">
          {events.map((e) => (
            <div className="event" key={e.id}>
              <span className={`dot ${tone(e.status)}`} />
              <div className="event-body">
                <p>{e.message}</p>
                <time>{formatDate(e.createdAt)}</time>
                {e.explorerUrl && (
                  <>
                    {" · "}
                    <a className="proof" href={e.explorerUrl} target="_blank" rel="noreferrer">
                      proof <ExternalLink size={11} />
                    </a>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
