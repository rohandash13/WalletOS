"use client";

import { SignOutButton } from "@clerk/nextjs";
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
  type ReactNode,
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
import type { AuthUser, WalletOSProfile } from "@/lib/profiles";

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

type AgentInvestment = {
  agentId: string;
  title: string;
  invested: number;
  txCount: number;
  lastRoutedAt: number;
  onChainUsdc: number;
  onChainValue: number;
  projectedApy: number;
  projectedAnnualGrowth: number;
  currentValue: number;
  gain: number;
  gainPct: number;
  agentAddress: string;
  explorerUrl: string;
};

const PRIMARY_PROMPT =
  "I get paid $2k on the 1st. Send my sister $50 every month, keep rent safe, and invest the rest low-risk - I'm a 3 out of 10 on risk.";
const RECOVERY_PROMPT = "Actually, I need $200 back.";

const WELCOME =
  "Tell me what should happen with your money and I'll set it up — moving, saving, protecting, and growing it in plain English.";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** Inline markdown → React: **bold**, *italic*, `code`. Safe (no raw HTML). */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const regex = /\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1] != null) nodes.push(<strong key={`${keyPrefix}-b${i}`}>{m[1]}</strong>);
    else if (m[2] != null) nodes.push(<em key={`${keyPrefix}-i${i}`}>{m[2]}</em>);
    else if (m[3] != null) nodes.push(<code key={`${keyPrefix}-c${i}`}>{m[3]}</code>);
    last = m.index + m[0].length;
    i += 1;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/**
 * Render the assistant's reply as light markdown: paragraphs, bullet/numbered
 * lists, and inline bold/italic/code — so "**bold**" and "- item" look polished
 * instead of showing raw asterisks.
 */
function FormattedMessage({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let items: string[] = [];
  let listType: "ul" | "ol" | null = null;

  const flushPara = () => {
    if (!para.length) return;
    const key = `p${blocks.length}`;
    blocks.push(<p key={key}>{renderInline(para.join(" "), key)}</p>);
    para = [];
  };
  const flushList = () => {
    if (!items.length) return;
    const key = `l${blocks.length}`;
    const lis = items.map((it, i) => <li key={`${key}-${i}`}>{renderInline(it, `${key}-${i}`)}</li>);
    blocks.push(listType === "ol" ? <ol key={key}>{lis}</ol> : <ul key={key}>{lis}</ul>);
    items = [];
    listType = null;
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      flushPara();
      flushList();
      continue;
    }
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    const numbered = line.match(/^\d+[.)]\s+(.*)$/);
    if (bullet) {
      flushPara();
      if (listType === "ol") flushList();
      listType = "ul";
      items.push(bullet[1]);
    } else if (numbered) {
      flushPara();
      if (listType === "ul") flushList();
      listType = "ol";
      items.push(numbered[1]);
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();

  return <div className="md">{blocks}</div>;
}

/** Display an agent's name with an explicit "Agent" suffix (no double "Agent"). */
function agentName(title: string): string {
  const t = title.trim();
  return /agent$/i.test(t) ? t : `${t} Agent`;
}

function actionLabel(a: Action) {
  if (a.type === "send_payment") return "Payment sent";
  if (a.type === "route_to_agent") return "Money invested";
  if (a.type === "rebalance_funds") return "Funds moved back";
  if (a.type === "policy_updated") return "Limit updated";
  if (a.type === "automation_created") return "Automation created";
  return "Done";
}

function actionDescription(a: Action) {
  if (a.type === "rebalance_funds" && a.amount)
    return `${money.format(a.amount)} moved back to Available`;
  if (a.agentName) return `${a.agentName}${a.amount ? ` · ${money.format(a.amount)}` : ""}`;
  if (a.amount) return money.format(a.amount);
  return "Rule prepared";
}

function ActionIcon({ type }: { type: string }) {
  if (type === "send_payment" || type === "rebalance_funds") return <ArrowLeftRight size={15} />;
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

export function WalletDemo({
  authUser,
}: {
  authUser: AuthUser;
  profile: WalletOSProfile;
}) {
  const [tab, setTab] = useState<Tab>("chat");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    { id: "welcome", role: "assistant", text: WELCOME },
  ]);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [events, setEvents] = useState<WalletEvent[]>([]);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [agents, setAgents] = useState<MarketAgent[]>([]);
  const [investments, setInvestments] = useState<AgentInvestment[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  // Undecided until the user picks a risk score in the chat onboarding.
  const [riskScore, setRiskScore] = useState<number | null>(null);
  // Two-step onboarding: pick risk, then an approve-before-moving-money threshold.
  const [setupStage, setSetupStage] = useState<"risk" | "approval" | "done">("risk");
  const [approvalThreshold, setApprovalThreshold] = useState<number | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isPaydayRunning, setIsPaydayRunning] = useState(false);
  const refreshInFlight = useRef(false);
  const seedAttempted = useRef(false);

  const total = useMemo(() => buckets.reduce((s, b) => s + b.balance, 0), [buckets]);
  const available = useMemo(
    () => buckets.find((b) => b.key === "checking")?.balance ?? 0,
    [buckets],
  );
  const authHeaders = useMemo(
    () => ({ "x-walletos-user-id": authUser.userId }),
    [authUser.userId],
  );

  const refreshLiveData = useCallback(async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 5000);
    try {
      const [bal, ev, au] = await Promise.all([
        fetch(`/api/balance?userId=${authUser.userId}`, {
          cache: "no-store",
          headers: authHeaders,
          signal: controller.signal,
        }),
        fetch(`/api/events?userId=${authUser.userId}`, {
          cache: "no-store",
          headers: authHeaders,
          signal: controller.signal,
        }),
        fetch(`/api/automations?userId=${authUser.userId}`, {
          cache: "no-store",
          headers: authHeaders,
          signal: controller.signal,
        }),
      ]);
      if (bal.ok) {
        let balance = (await bal.json()) as BalanceResponse;
        const totalBalance = balance.buckets.reduce((sum, bucket) => sum + bucket.balance, 0);
        if (totalBalance === 0 && !seedAttempted.current) {
          seedAttempted.current = true;
          const seeded = await fetch("/api/demo/seed", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeaders },
            body: JSON.stringify({ amount: 5000, reset: true }),
            signal: controller.signal,
          });
          if (seeded.ok) {
            balance = {
              ...balance,
              walletBalance: 5000,
              buckets: [
                { name: "Available", key: "checking", balance: 5000, protected: false },
                { name: "Savings", key: "savings", balance: 0, protected: false },
                { name: "Protected", key: "rent_safe", balance: 0, protected: true },
                { name: "Invested", key: "stable_invest", balance: 0, protected: false },
              ],
            };
          }
        }
        setBuckets(balance.buckets);
      }
      if (ev.ok) setEvents(((await ev.json()) as { events: WalletEvent[] }).events);
      if (au.ok)
        setAutomations(((await au.json()) as { automations: Automation[] }).automations);
    } catch {
      /* keep last state */
    } finally {
      window.clearTimeout(timer);
      refreshInFlight.current = false;
    }
  }, [authHeaders, authUser.userId]);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch("/api/marketplace", {
        cache: "no-store",
        headers: authHeaders,
      });
      if (res.ok) setAgents(((await res.json()) as { agents: MarketAgent[] }).agents);
    } catch {
      /* ignore */
    }
  }, [authHeaders]);

  const fetchInvestments = useCallback(async () => {
    try {
      const res = await fetch("/api/investments", {
        cache: "no-store",
        headers: authHeaders,
      });
      if (res.ok)
        setInvestments(((await res.json()) as { agents: AgentInvestment[] }).agents);
    } catch {
      /* ignore */
    }
  }, [authHeaders]);

  const didBootstrap = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const onLocalhost =
      typeof window !== "undefined" &&
      ["localhost", "127.0.0.1"].includes(window.location.hostname);

    async function bootstrap() {
      // On localhost, start every page load from a clean demo state (fresh $5,000
      // seed for the authed user). Guarded so it runs once, never in prod.
      if (onLocalhost && !didBootstrap.current) {
        didBootstrap.current = true;
        try {
          await fetch("/api/reset", { method: "POST", headers: authHeaders });
          if (!cancelled) {
            setTab("chat");
            setInput("");
            setMessages([{ id: "welcome", role: "assistant", text: WELCOME }]);
            setActions([]);
            setRiskScore(null);
            setSetupStage("risk");
            setApprovalThreshold(null);
            setWhy(null);
          }
        } catch {
          /* ignore — fall back to whatever state the backend has */
        }
      }
      if (!cancelled) void refreshLiveData();
    }

    void bootstrap();
    const interval = window.setInterval(refreshLiveData, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [refreshLiveData, authHeaders]);

  useEffect(() => {
    if (tab === "marketplace") {
      void fetchAgents();
      void fetchInvestments();
    }
  }, [tab, fetchAgents, fetchInvestments]);

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
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ userId: authUser.userId, message: msg, mode: "text" }),
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
      setRiskScore((prev) => body.riskScore ?? prev);
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

  function pickRisk(n: number) {
    if (isSending) return;
    setRiskScore(n);
    setSetupStage("approval");
  }

  async function finishSetup(threshold: number) {
    if (isSending) return;
    setApprovalThreshold(threshold);
    setSetupStage("done");
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ approvalThreshold: threshold }),
      });
    } catch {
      /* setting is best-effort; agent still works without it */
    }
    // Now ask the agent to SUGGEST matching agents (no money moved) for this score.
    void submitMessage(
      `I'm a ${riskScore} out of 10 on risk, and I want to approve anything over $${threshold} before it moves. Don't move any money yet — just suggest how I could invest and which agents fit me.`,
    );
  }

  async function resetDemo() {
    await fetch("/api/reset", { method: "POST", headers: authHeaders });
    setTab("chat");
    setInput("");
    setMessages([{ id: "welcome", role: "assistant", text: WELCOME }]);
    setActions([]);
    setRiskScore(null);
    setSetupStage("risk");
    setApprovalThreshold(null);
    setWhy(null);
    void refreshLiveData();
  }

  async function generatePaycheck() {
    if (isPaydayRunning) return;
    setIsPaydayRunning(true);
    try {
      const res = await fetch("/api/payday", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ amount: 2000, autoFundPayroll: true }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "payday failed");
      }
      const body = (await res.json()) as { explorerUrl?: string };
      setMessages((c) => [
        ...c,
        {
          id: `payday_${Date.now()}`,
          role: "assistant",
          text: body.explorerUrl
            ? "Your paycheck landed and WalletOS ran your active automations."
            : "Your paycheck landed and WalletOS ran your active automations.",
        },
      ]);
    } catch (err) {
      setMessages((c) => [
        ...c,
        {
          id: `payday_err_${Date.now()}`,
          role: "assistant",
          text:
            err instanceof Error
              ? err.message
              : "I couldn't generate the paycheck right now.",
        },
      ]);
    } finally {
      setIsPaydayRunning(false);
      void refreshLiveData();
    }
  }

  return (
    <main className="app">
      <div className="shell">
        <nav className="card nav">
          <div className="brand">
            <div className="logo">
              <Wallet size={18} />
            </div>
            <div className="brand-text">
              <span className="brand-name">WalletOS</span>
              <span className="brand-tag">Your private banker</span>
            </div>
          </div>

          <div className="nav-tabs">
            <button
              className={`nav-tab ${tab === "chat" ? "active" : ""}`}
              onClick={() => setTab("chat")}
            >
              <MessageSquareText size={16} />
              Chat
            </button>
            <button
              className={`nav-tab ${tab === "automations" ? "active" : ""}`}
              onClick={() => setTab("automations")}
            >
              <CalendarClock size={16} />
              Automations
            </button>
            <button
              className={`nav-tab ${tab === "marketplace" ? "active" : ""}`}
              onClick={() => setTab("marketplace")}
            >
              <Bot size={16} />
              Agents
            </button>
          </div>

          <div className="nav-spacer" />

          <div className="nav-bottom">
            <div className="user-chip">
              {authUser.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={authUser.imageUrl} alt="" />
              ) : (
                <User size={14} />
              )}
              <span>{authUser.name ?? authUser.email}</span>
            </div>
            <span className="pill">
              <ShieldCheck size={13} />
              Base Sepolia USDC
            </span>
            {approvalThreshold != null && (
              <span className="pill" title="You'll be asked to approve moves above this amount">
                <Lock size={13} />
                Approve &gt; {money.format(approvalThreshold)}
              </span>
            )}
            <button
              className="btn btn-primary"
              type="button"
              onClick={() => void generatePaycheck()}
              disabled={isPaydayRunning}
            >
              <CalendarClock size={14} />
              {isPaydayRunning ? "Generating..." : "Generate paycheck"}
            </button>
            <SignOutButton redirectUrl="/">
              <button className="btn btn-ghost" type="button">
                Sign out
              </button>
            </SignOutButton>
            <button className="btn btn-ghost" type="button" onClick={() => void resetDemo()}>
              <RotateCcw size={14} />
              Reset
            </button>
          </div>
        </nav>

        <div className="main-col">
          {tab === "chat" && (
            <ChatPanel
              input={input}
              isSending={isSending}
              messages={messages}
              actions={actions}
              setupStage={setupStage}
              onPickRisk={pickRisk}
              onFinishSetup={finishSetup}
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
                  headers: { "Content-Type": "application/json", ...authHeaders },
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
              investments={investments}
              riskScore={riskScore}
              available={available}
              onCreate={async (goal) => {
                await fetch("/api/marketplace", {
                  method: "POST",
                  headers: { "Content-Type": "application/json", ...authHeaders },
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
    </main>
  );
}

function ChatPanel({
  input,
  isSending,
  messages,
  actions,
  setupStage,
  onPickRisk,
  onFinishSetup,
  onInputChange,
  onSubmit,
  onDemo,
  onRecovery,
}: {
  input: string;
  isSending: boolean;
  messages: Message[];
  actions: Action[];
  setupStage: "risk" | "approval" | "done";
  onPickRisk: (n: number) => void;
  onFinishSetup: (threshold: number) => void;
  onInputChange: (v: string) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  onDemo: () => void;
  onRecovery: () => void;
}) {
  const onboarding = setupStage !== "done";
  const stackRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    stackRef.current?.scrollTo({ top: stackRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, actions, isSending]);

  return (
    <div className="panel chat">
      <div className="messages" ref={stackRef}>
        {messages.map((m) => (
          <div className={`msg ${m.role}`} key={m.id}>
            <div className="msg-avatar">
              {m.role === "assistant" ? <Sparkles size={14} /> : <User size={14} />}
            </div>
            <div className="bubble">
              {m.role === "assistant" ? <FormattedMessage text={m.text} /> : m.text}
            </div>
          </div>
        ))}

        {onboarding && (
          <OnboardingCard
            stage={setupStage}
            disabled={isSending}
            onPickRisk={onPickRisk}
            onFinish={onFinishSetup}
          />
        )}

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
          placeholder="Ask WalletOS to move, save, protect, or grow your money…"
        />
        <button className="send" type="submit" disabled={isSending}>
          <Send size={16} />
        </button>
      </form>

      {!onboarding && (
        <div className="suggestions">
          <button className="chip" type="button" onClick={onDemo} disabled={isSending}>
            ▶ Try an example: payday plan
          </button>
          <button className="chip" type="button" onClick={onRecovery} disabled={isSending}>
            I need $200 back
          </button>
        </div>
      )}
    </div>
  );
}

const RISK_WORD = ["", "very safe", "very safe", "cautious", "cautious", "balanced", "balanced", "growth-leaning", "growth-leaning", "aggressive", "aggressive"];
const APPROVAL_PRESETS = [25, 100, 250];

/**
 * First-run onboarding: pick a risk score (slider 1–10), then an "approve before
 * moving money" threshold. Both must happen before the user starts chatting.
 */
function OnboardingCard({
  stage,
  disabled,
  onPickRisk,
  onFinish,
}: {
  stage: "risk" | "approval" | "done";
  disabled: boolean;
  onPickRisk: (n: number) => void;
  onFinish: (threshold: number) => void;
}) {
  const [risk, setRisk] = useState(5);
  const [threshold, setThreshold] = useState(100);

  if (stage === "approval") {
    return (
      <div className="risk-picker">
        <div className="risk-picker-head">
          <ShieldCheck size={14} />
          <span>Approve before moving money</span>
        </div>
        <p className="risk-picker-sub">
          Pick a safety threshold. Moves <strong>at or below</strong> this auto-run from your
          automations and investments; anything <strong>above</strong> it, I&apos;ll ask you to
          approve first.
        </p>
        <div className="threshold-value">
          Auto-approve up to <strong>{money.format(threshold)}</strong>
        </div>
        <input
          className="slider"
          type="range"
          min={0}
          max={500}
          step={25}
          value={threshold}
          disabled={disabled}
          onChange={(e) => setThreshold(Number(e.target.value))}
        />
        <div className="risk-scale-labels">
          <span>Ask about everything</span>
          <span>$500+</span>
        </div>
        <div className="preset-row">
          {APPROVAL_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              className={`chip ${threshold === p ? "chip-active" : ""}`}
              disabled={disabled}
              onClick={() => setThreshold(p)}
            >
              Ask above {money.format(p)}
            </button>
          ))}
        </div>
        <button
          className="btn btn-primary onboard-cta"
          type="button"
          disabled={disabled}
          onClick={() => onFinish(threshold)}
        >
          Finish setup
        </button>
      </div>
    );
  }

  return (
    <div className="risk-picker">
      <div className="risk-picker-head">
        <Sparkles size={14} />
        <span>First, how do you feel about risk?</span>
      </div>
      <p className="risk-picker-sub">
        Slide to where you sit — <strong>1</strong> means play it very safe, <strong>10</strong>{" "}
        means go for maximum growth. I&apos;ll suggest agents that fit you.
      </p>
      <div className="threshold-value">
        <strong>{risk}</strong> / 10 · {RISK_WORD[risk]}
      </div>
      <input
        className="slider"
        type="range"
        min={1}
        max={10}
        step={1}
        value={risk}
        disabled={disabled}
        onChange={(e) => setRisk(Number(e.target.value))}
      />
      <div className="risk-scale-labels">
        <span>Safer</span>
        <span>Riskier</span>
      </div>
      <button
        className="btn btn-primary onboard-cta"
        type="button"
        disabled={disabled}
        onClick={() => onPickRisk(risk)}
      >
        Continue
      </button>
    </div>
  );
}

type AutoPayload = Record<string, unknown>;

const TEMPLATES: {
  key: string;
  label: string;
  needs: ("amount" | "to" | "schedule" | "threshold")[];
}[] = [
  { key: "bill", label: "Pay a bill (rent, utilities, phone…)", needs: ["amount", "to", "schedule"] },
  { key: "family", label: "Send money to family / allowance", needs: ["amount", "to", "schedule"] },
  { key: "auto_save", label: "Auto-save from each paycheck", needs: ["amount", "schedule"] },
  { key: "protect", label: "Set aside money (protect it first)", needs: ["amount"] },
  { key: "recurring_invest", label: "Invest on a schedule", needs: ["amount", "schedule"] },
  { key: "roundup", label: "Round up purchases into savings", needs: [] },
  { key: "smart_card", label: "Pay credit card in full (smart)", needs: ["threshold"] },
  { key: "paycheck_split", label: "Split my paycheck into accounts", needs: [] },
  { key: "low_balance_alert", label: "Low-balance alert", needs: ["threshold"] },
  { key: "subscription_watch", label: "Watch for unused subscriptions", needs: [] },
];

function AutomationsPanel({
  automations,
  onCreate,
}: {
  automations: Automation[];
  onCreate: (payload: AutoPayload) => Promise<void>;
}) {
  const [cat, setCat] = useState(TEMPLATES[0].key);
  const [amount, setAmount] = useState("");
  const [to, setTo] = useState("");
  const [schedule, setSchedule] = useState("monthly");
  const [threshold, setThreshold] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const tmpl = TEMPLATES.find((t) => t.key === cat)!;
  const needs = (f: string) => tmpl.needs.includes(f as never);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (needs("amount") && !(Number(amount) > 0)) return;
    if (needs("to") && !/^0x[a-fA-F0-9]{40}$/.test(to.trim())) return;
    if (needs("threshold") && !(Number(threshold) >= 0)) return;

    const payload: AutoPayload = { category: cat, note: note.trim() || undefined };
    if (cat === "protect") {
      payload.type = "protect_bucket";
      payload.bucket = "rent";
      payload.amount = Number(amount);
    } else if (cat === "bill" || cat === "family") {
      payload.type = "recurring_transfer";
      payload.amount = Number(amount);
      payload.to = to.trim();
      payload.schedule = schedule;
    } else {
      payload.type = "rule";
      if (needs("amount")) payload.amount = Number(amount);
      if (needs("schedule")) payload.schedule = schedule;
      if (needs("threshold")) payload.threshold = Number(threshold);
    }

    setBusy(true);
    try {
      await onCreate(payload);
      setAmount("");
      setTo("");
      setThreshold("");
      setNote("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>Automations</h2>
          <p className="sub">Set up the everyday money moves that run on their own.</p>
        </div>
        <span className="tag neutral">{automations.length} active</span>
      </div>

      <div className="scroll">
        <form className="auto-form" onSubmit={submit}>
          <div className="field full">
            <label>What to automate</label>
            <select value={cat} onChange={(e) => setCat(e.target.value)}>
              {TEMPLATES.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          {needs("amount") && (
            <div className="field">
              <label>Amount ($)</label>
              <input
                type="number"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="50"
              />
            </div>
          )}
          {needs("threshold") && (
            <div className="field">
              <label>Threshold ($)</label>
              <input
                type="number"
                min="0"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                placeholder="100"
              />
            </div>
          )}
          {needs("schedule") && (
            <div className="field">
              <label>How often</label>
              <select value={schedule} onChange={(e) => setSchedule(e.target.value)}>
                <option value="monthly">Monthly</option>
                <option value="weekly">Weekly</option>
                <option value="monthly:1">Monthly (1st)</option>
                <option value="biweekly">Every 2 weeks</option>
              </select>
            </div>
          )}
          {needs("to") && (
            <div className="field full">
              <label>Recipient address</label>
              <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="0x…" />
            </div>
          )}
          <div className="field full">
            <label>Note (optional)</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. rent to landlord, Netflix, gym…"
            />
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
            <p>Add one above, or just ask in chat — e.g. “send my sister $50 every month”.</p>
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
    </div>
  );
}

function MarketplacePanel({
  agents,
  events,
  investments,
  riskScore,
  available,
  onCreate,
}: {
  agents: MarketAgent[];
  events: WalletEvent[];
  investments: AgentInvestment[];
  riskScore: number | null;
  available: number;
  onCreate: (goal: string) => Promise<void>;
}) {
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const agentEvents = events.filter((e) => e.type === "agent_routed");
  const totalValue = investments.reduce((s, a) => s + a.currentValue, 0);
  const totalGain = investments.reduce((s, a) => s + a.gain, 0);

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
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>Financial Agents</h2>
          <p className="sub">Specialized agents that grow your money, matched to your goals.</p>
        </div>
        <RiskBadge score={riskScore} />
      </div>

      <div className="scroll">
        <form className="create-agent" onSubmit={create}>
          <input
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder='Describe a goal to create an agent, e.g. "save for a house in 3 years" or "grow my money but keep it safe"'
          />
          <button className="btn btn-primary" type="submit" disabled={busy}>
            <Plus size={15} />
            {busy ? "Creating…" : "Create"}
          </button>
        </form>

        <div className="agent-grid">
          {agents.map((a) => {
            const lockedByAmount = available < a.minAmount;
            const inBand =
              riskScore == null || (riskScore >= a.riskBand[0] && riskScore <= a.riskBand[1]);
            const unlocked = !lockedByAmount && inBand;
            return (
              <div className={`agent ${unlocked ? "unlocked" : "locked"}`} key={a.id}>
                <div className="agent-top">
                  <span className={`agent-dot ${a.online ? "online" : ""}`}>
                    <i />
                    {a.online ? "Active" : "Offline"}
                  </span>
                  {a.dynamic ? (
                    <span className="tag good">Custom</span>
                  ) : a.kind === "reserve" ? (
                    <span className="tag neutral">Reserve</span>
                  ) : inBand && riskScore != null ? (
                    <span className="tag good">Matched</span>
                  ) : null}
                </div>
                <h3>{agentName(a.title)}</h3>
                <p className="desc">{a.strategy ?? a.description}</p>
                <div className="agent-foot">
                  <span>
                    Risk {a.riskBand[0]}–{a.riskBand[1]}
                    {a.minAmount > 0 && (
                      <>
                        {" · "}
                        {lockedByAmount ? (
                          <span style={{ color: "var(--warn)" }}>
                            <Lock size={10} style={{ verticalAlign: "-1px" }} />{" "}
                            {money.format(a.minAmount)}+
                          </span>
                        ) : (
                          `${money.format(a.minAmount)}+`
                        )}
                      </>
                    )}
                  </span>
                  {a.kind === "invest" && (
                    <span className="apy" title="Estimated growth per year">
                      <TrendingUp size={11} style={{ verticalAlign: "-1px" }} />{" "}
                      {a.projectedApy ? `≈${a.projectedApy}%/yr` : "—"}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
          {agents.length === 0 && <p className="muted">Loading agents…</p>}
        </div>

        {investments.length > 0 && (
          <>
            <div className="divider" />
            <div className="panel-head" style={{ marginBottom: 8 }}>
              <p className="section-label">Invested funds</p>
              <span className="tag good">
                {money.format(totalValue)}
                {totalGain > 0 ? ` · +${money.format(totalGain)}` : " working"}
              </span>
            </div>
            <div className="list">
              {investments.map((inv) => (
                <div className="row-card" key={inv.agentId}>
                  <div className="row-icon">
                    <PiggyBank size={17} />
                  </div>
                  <div className="row-main">
                    <h3>{agentName(inv.title)}</h3>
                    <p>
                      Now worth <strong>{money.format(inv.currentValue)}</strong>
                      {inv.gain > 0 && (
                        <span className="apy">
                          {" "}
                          <TrendingUp size={11} style={{ verticalAlign: "-1px" }} /> +
                          {money.format(inv.gain)} ({inv.gainPct}%)
                        </span>
                      )}
                    </p>
                    <p className="sub">
                      {money.format(inv.invested)} invested
                      {inv.projectedApy > 0 && <> · ≈{inv.projectedApy}%/yr</>}
                      {inv.onChainUsdc > 0 && <> · {inv.onChainUsdc} USDC on-chain</>}
                    </p>
                  </div>
                  <div className="row-meta">
                    {inv.explorerUrl && (
                      <a className="proof" href={inv.explorerUrl} target="_blank" rel="noreferrer">
                        wallet <ExternalLink size={11} />
                      </a>
                    )}
                    <span className="when">
                      {inv.txCount} {inv.txCount === 1 ? "deposit" : "deposits"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="divider" />
        <p className="section-label">Agent activity</p>
        {agentEvents.length === 0 ? (
          <p className="muted" style={{ marginTop: 8 }}>
            Activity will appear here after you put money to work.
          </p>
        ) : (
          <div className="list" style={{ marginTop: 10 }}>
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
    <div className="panel" style={{ flex: "none" }}>
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
    <div className="panel activity-card">
      <div className="panel-head" style={{ marginBottom: 0 }}>
        <p className="section-label">Live activity</p>
        <span className="live-dot" />
      </div>
      {events.length === 0 ? (
        <p className="muted" style={{ marginTop: 12 }}>
          Payments, rules, and money moves will stream here.
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
