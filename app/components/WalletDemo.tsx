"use client";

import {
  ArrowRightLeft,
  BadgeCheck,
  Bot,
  CalendarClock,
  Check,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  ExternalLink,
  LockKeyhole,
  MessageSquareText,
  Mic,
  PiggyBank,
  Play,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  WalletCards,
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
  Portfolio,
  WalletEvent,
} from "@/lib/types";

type Tab = "chat" | "automations" | "marketplace";

type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

const DEMO_USER_ID = process.env.NEXT_PUBLIC_DEMO_USER_ID ?? "demo-user";

const PRIMARY_PROMPT =
  "I get paid $2k on the 1st. Send my sister $50 every month, keep rent safe, and invest the rest low-risk - I'm a 3 out of 10 on risk.";

const SECOND_PROMPT = "Actually, I need $200 back.";

const progressCopy = [
  "Understanding your plan",
  "Saving your safety rules",
  "Creating monthly payment",
  "Sending $50 to sister",
  "Protecting rent",
  "Routing leftover funds to Stable-Invest",
];

const recoveryProgressCopy = [
  "Reading your cash request",
  "Checking protected rent",
  "Finding flexible funds",
  "Moving $200 back to checking",
  "Explaining the safeguard",
];

const initialBuckets: Bucket[] = [
  { name: "Checking", key: "checking", balance: 2000, protected: false },
  { name: "Rent Safe", key: "rent_safe", balance: 0, protected: true },
  { name: "Family Payment", key: "family_payment", balance: 0, protected: false },
  { name: "Stable-Invest", key: "stable_invest", balance: 0, protected: false },
];

const initialPortfolio: Portfolio = {
  checking: 2000,
  rent_safe: 0,
  family_payment: 0,
  stable_invest: 0,
};

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function actionLabel(action: Action) {
  if (action.type === "send_payment") return "Payment sent";
  if (action.type === "route_to_agent") return "Stable-Invest routed";
  if (action.type === "rebalance_funds") return "Money moved back";
  if (action.type === "policy_updated") return "Policy saved";
  if (action.type === "automation_created") return "Automation created";
  return "Action completed";
}

function actionDescription(action: Action) {
  if (action.type === "rebalance_funds" && action.amount) {
    return `${money.format(action.amount)} returned to checking`;
  }

  if (action.agentName) {
    return `${action.agentName} ${
      action.amount ? `received ${money.format(action.amount)}` : "selected"
    }`;
  }

  if (action.amount) {
    return `${money.format(action.amount)} ${action.asset ?? "demo funds"}`;
  }

  return "Rule prepared for demo execution";
}

function statusTone(status: string) {
  if (["confirmed", "completed", "active", "ready"].includes(status)) {
    return "good";
  }
  if (["pending", "created"].includes(status)) {
    return "pending";
  }
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
  const [activeTab, setActiveTab] = useState<Tab>("chat");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      text:
        "Tell me what should happen when payday arrives. I will keep the plan plain-English, visible, and safe.",
    },
  ]);
  const [portfolio, setPortfolio] = useState<Portfolio>(initialPortfolio);
  const [buckets, setBuckets] = useState<Bucket[]>(initialBuckets);
  const [events, setEvents] = useState<WalletEvent[]>([]);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [riskScore, setRiskScore] = useState<number | null>(null);
  const [why, setWhy] = useState(
    "No money movement yet. Once you set a rule, WalletOS will explain what happened and which money stayed protected.",
  );
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [progress, setProgress] = useState<string[]>([]);
  const [executionSteps, setExecutionSteps] = useState(progressCopy);
  const [activeProgressIndex, setActiveProgressIndex] = useState(-1);
  const [isSending, setIsSending] = useState(false);

  const total = useMemo(
    () =>
      portfolio.checking +
      portfolio.rent_safe +
      portfolio.family_payment +
      portfolio.stable_invest,
    [portfolio],
  );

  const refreshLiveData = useCallback(async () => {
    try {
      const [balanceResponse, eventsResponse, automationsResponse] =
        await Promise.all([
          fetch(`/api/balance?userId=${DEMO_USER_ID}`, { cache: "no-store" }),
          fetch(`/api/events?userId=${DEMO_USER_ID}`, { cache: "no-store" }),
          fetch(`/api/automations?userId=${DEMO_USER_ID}`, {
            cache: "no-store",
          }),
        ]);

      if (balanceResponse.ok) {
        const balance = (await balanceResponse.json()) as BalanceResponse;
        setBuckets(balance.buckets);
        setPortfolio({
          checking:
            balance.buckets.find((bucket) => bucket.key === "checking")
              ?.balance ?? 0,
          rent_safe:
            balance.buckets.find((bucket) => bucket.key === "rent_safe")
              ?.balance ?? 0,
          family_payment:
            balance.buckets.find((bucket) => bucket.key === "family_payment")
              ?.balance ?? 0,
          stable_invest:
            balance.buckets.find((bucket) => bucket.key === "stable_invest")
              ?.balance ?? 0,
        });
      }

      if (eventsResponse.ok) {
        const body = (await eventsResponse.json()) as {
          events: WalletEvent[];
        };
        setEvents(body.events);
      }

      if (automationsResponse.ok) {
        const body = (await automationsResponse.json()) as {
          automations: Automation[];
        };
        setAutomations(body.automations);
      }
    } catch {
      // The demo still works from local state if the backend is mid-build.
    }
  }, []);

  useEffect(() => {
    void refreshLiveData();
    const interval = window.setInterval(refreshLiveData, 1600);
    return () => window.clearInterval(interval);
  }, [refreshLiveData]);

  async function submitMessage(message: string) {
    const cleanMessage = message.trim();
    if (!cleanMessage || isSending) return;

    const isRecovery = cleanMessage.toLowerCase().includes("200 back");
    const steps = isRecovery ? recoveryProgressCopy : progressCopy;

    setIsSending(true);
    setInput("");
    setExecutionSteps(steps);
    setMessages((current) => [
      ...current,
      { id: `user_${Date.now()}`, role: "user", text: cleanMessage },
    ]);
    setProgress([]);
    setActiveProgressIndex(-1);
    setActions(
      isRecovery
        ? [{ type: "rebalance_funds", status: "pending", amount: 200 }]
        : [
            { type: "policy_updated", status: "pending" },
            { type: "automation_created", status: "pending" },
            { type: "send_payment", status: "pending", amount: 50 },
          ],
    );

    for (let index = 0; index < steps.length; index += 1) {
      setProgress((current) => [...current, steps[index]]);
      setActiveProgressIndex(index);
      await delay(index === 0 ? 260 : 340);
    }

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: DEMO_USER_ID,
          message: cleanMessage,
          mode: "text",
        }),
      });

      if (!response.ok) {
        throw new Error("Chat request failed");
      }

      const body = (await response.json()) as ChatResponse;
      setMessages((current) => [
        ...current,
        {
          id: `assistant_${Date.now()}`,
          role: "assistant",
          text: body.assistantMessage,
        },
      ]);
      setActions(body.actions);
      setPortfolio(body.portfolio);
      setEvents(body.events);
      setAutomations(body.automations ?? automations);
      setRiskScore(body.riskScore ?? riskScore);
      setWhy(body.why ?? why);
      if (body.actions.some((action) => action.agentName === "Stable-Invest")) {
        setSelectedAgent("Stable-Invest");
      }
    } catch {
      setMessages((current) => [
        ...current,
        {
          id: `assistant_error_${Date.now()}`,
          role: "assistant",
          text:
            "I could not reach the backend yet, so I kept the demo state unchanged. The UI is ready for the API contract when it is available.",
        },
      ]);
    } finally {
      setIsSending(false);
      setActiveProgressIndex(-1);
      void refreshLiveData();
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitMessage(input);
  }

  async function resetDemo() {
    await fetch("/api/reset", { method: "POST" });
    setActiveTab("chat");
    setInput("");
    setMessages([
      {
        id: "welcome",
        role: "assistant",
        text:
          "Tell me what should happen when payday arrives. I will keep the plan plain-English, visible, and safe.",
      },
    ]);
    setPortfolio(initialPortfolio);
    setBuckets(initialBuckets);
    setEvents([]);
    setAutomations([]);
    setActions([]);
    setRiskScore(null);
    setWhy(
      "No money movement yet. Once you set a rule, WalletOS will explain what happened and which money stayed protected.",
    );
    setSelectedAgent(null);
    setProgress([]);
    setExecutionSteps(progressCopy);
    setActiveProgressIndex(-1);
  }

  return (
    <main className="app">
      <div className="app-shell">
        <header className="topbar">
          <div className="brand-lockup">
            <div className="brand-mark">
              <WalletCards size={22} />
            </div>
            <div>
              <p className="eyebrow">WalletOS</p>
              <h1>Private Banker for the 99%</h1>
            </div>
          </div>
          <div className="safety-banner">
            <ShieldCheck size={16} />
            <span>Demo only · Testnet USDC · Not financial advice</span>
          </div>
        </header>

        <section className="mission-strip">
          <div>
            <p className="mission-kicker">Financial copilot</p>
            <p>The wealthy have CFOs. Now everyone does.</p>
          </div>
          <button
            className="secondary-action"
            type="button"
            onClick={() => void resetDemo()}
          >
            <RotateCcw size={16} />
            Reset demo
          </button>
        </section>

        <nav className="tabs" aria-label="WalletOS views">
          <TabButton
            active={activeTab === "chat"}
            icon={<MessageSquareText size={16} />}
            label="Chat"
            onClick={() => setActiveTab("chat")}
          />
          <TabButton
            active={activeTab === "automations"}
            icon={<CalendarClock size={16} />}
            label="Automations"
            onClick={() => setActiveTab("automations")}
          />
          <TabButton
            active={activeTab === "marketplace"}
            icon={<Bot size={16} />}
            label="Agent Marketplace"
            onClick={() => setActiveTab("marketplace")}
          />
        </nav>

        <div className="workspace">
          <section className="primary-pane">
            {activeTab === "chat" && (
              <ChatPanel
                input={input}
                isSending={isSending}
                messages={messages}
                progress={progress}
                executionSteps={executionSteps}
                activeProgressIndex={activeProgressIndex}
                actions={actions}
                onInputChange={setInput}
                onSubmit={handleSubmit}
                onPrompt={() => void submitMessage(PRIMARY_PROMPT)}
                onSecondPrompt={() => void submitMessage(SECOND_PROMPT)}
              />
            )}

            {activeTab === "automations" && (
              <AutomationsPanel automations={automations} />
            )}

            {activeTab === "marketplace" && (
              <MarketplacePanel
                selectedAgent={selectedAgent}
                riskScore={riskScore}
                stableInvestBalance={portfolio.stable_invest}
                events={events}
              />
            )}
          </section>

          <aside className="insights-pane">
            <PortfolioSummary
              buckets={buckets}
              total={total}
              riskScore={riskScore}
            />
            <WhyPanel why={why} />
            <EventFeed events={events} />
          </aside>
        </div>
      </div>
    </main>
  );
}

function TabButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`tab-button ${active ? "active" : ""}`}
      type="button"
      onClick={onClick}
      aria-pressed={active}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function ChatPanel({
  input,
  isSending,
  messages,
  progress,
  executionSteps,
  activeProgressIndex,
  actions,
  onInputChange,
  onSubmit,
  onPrompt,
  onSecondPrompt,
}: {
  input: string;
  isSending: boolean;
  messages: Message[];
  progress: string[];
  executionSteps: string[];
  activeProgressIndex: number;
  actions: Action[];
  onInputChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onPrompt: () => void;
  onSecondPrompt: () => void;
}) {
  const messageStackRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const stack = messageStackRef.current;
    if (!stack) return;
    stack.scrollTo({ top: stack.scrollHeight, behavior: "smooth" });
  }, [messages]);

  return (
    <div className="chat-layout">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Chat</p>
          <h2>Tell WalletOS what payday should do</h2>
        </div>
        <button className="demo-prompt" type="button" onClick={onPrompt}>
          <Play size={15} />
          Run demo prompt
        </button>
      </div>

      <div className="message-stack" aria-live="polite" ref={messageStackRef}>
        {messages.map((message) => (
          <div
            className={`message-row ${message.role}`}
            key={message.id}
          >
            <div className="avatar">
              {message.role === "assistant" ? (
                <Sparkles size={15} />
              ) : (
                <CircleDollarSign size={15} />
              )}
            </div>
            <p className="message-bubble">{message.text}</p>
          </div>
        ))}
      </div>

      {(progress.length > 0 || actions.length > 0) && (
        <div className="execution-grid">
          <div className="progress-panel">
            <div className="section-title-row">
              <p className="section-title">Execution</p>
              {isSending ? (
                <span className="pulse-chip">Working</span>
              ) : (
                <span className="status-chip good">Ready</span>
              )}
            </div>
            <div className="progress-list">
              {executionSteps.map((step, index) => {
                const isDone = progress.includes(step) && index < activeProgressIndex;
                const isActive = index === activeProgressIndex;
                const wasShown = progress.includes(step);
                return (
                  <div
                    className={`progress-item ${
                      isDone || (!isSending && wasShown) ? "done" : ""
                    } ${isActive ? "current" : ""}`}
                    key={step}
                  >
                    <span className="progress-icon">
                      {isDone || (!isSending && wasShown) ? (
                        <Check size={13} />
                      ) : (
                        <Clock3 size={13} />
                      )}
                    </span>
                    <span>{step}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="action-stack">
            {actions.map((action, index) => (
              <ActionCard action={action} key={`${action.type}_${index}`} />
            ))}
          </div>
        </div>
      )}

      <form className="chat-composer" onSubmit={onSubmit}>
        <button
          className="icon-button"
          type="button"
          aria-label="Voice input unavailable in MVP"
          title="Voice input stretch"
        >
          <Mic size={18} />
        </button>
        <input
          aria-label="Message WalletOS"
          value={input}
          onChange={(event) => onInputChange(event.target.value)}
          placeholder="Ask WalletOS to move, protect, or route demo funds..."
        />
        <button className="send-button" type="submit" disabled={isSending}>
          <ChevronRight size={18} />
        </button>
      </form>

      <button
        className="plain-command"
        type="button"
        onClick={onSecondPrompt}
        disabled={isSending}
      >
        Try recovery prompt: Actually, I need $200 back.
      </button>
    </div>
  );
}

function ActionCard({ action }: { action: Action }) {
  const tone = statusTone(action.status);
  return (
    <article className="action-card">
      <div className={`action-icon ${tone}`}>
        {action.type === "send_payment" ? (
          <ArrowRightLeft size={17} />
        ) : action.type === "rebalance_funds" ? (
          <ArrowRightLeft size={17} />
        ) : action.type === "route_to_agent" ? (
          <PiggyBank size={17} />
        ) : (
          <BadgeCheck size={17} />
        )}
      </div>
      <div>
        <div className="action-title-row">
          <h3>{actionLabel(action)}</h3>
          <span className={`status-chip ${tone}`}>{action.status}</span>
        </div>
        <p>{actionDescription(action)}</p>
        {action.explorerUrl && (
          <a className="proof-link" href={action.explorerUrl} target="_blank">
            View proof
            <ExternalLink size={13} />
          </a>
        )}
      </div>
    </article>
  );
}

function AutomationsPanel({ automations }: { automations: Automation[] }) {
  return (
    <div className="panel-flow">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Automations</p>
          <h2>Rules that keep working after the chat</h2>
        </div>
        <span className="count-chip">{automations.length || 0} active</span>
      </div>

      {automations.length === 0 ? (
        <div className="empty-state">
          <CalendarClock size={28} />
          <h3>No automations yet</h3>
          <p>
            Run the demo prompt in Chat to create the sister payment, rent
            protection, and Stable-Invest routing rules.
          </p>
        </div>
      ) : (
        <div className="automation-list">
          {automations.map((automation) => (
            <article className="automation-card" key={automation.id}>
              <div className="automation-leading">
                <div className="automation-icon">
                  <CalendarClock size={18} />
                </div>
                <div>
                  <h3>{automation.name}</h3>
                  <p>{automation.explanation}</p>
                </div>
              </div>
              <div className="automation-meta">
                <span className={`status-chip ${statusTone(automation.status)}`}>
                  {automation.status}
                </span>
                <span>Next run {formatDate(automation.nextRunAt)}</span>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function MarketplacePanel({
  selectedAgent,
  riskScore,
  stableInvestBalance,
  events,
}: {
  selectedAgent: string | null;
  riskScore: number | null;
  stableInvestBalance: number;
  events: WalletEvent[];
}) {
  const agentEvents = events.filter((event) => event.type === "agent_routed");

  return (
    <div className="panel-flow">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Agent Marketplace</p>
          <h2>Specialized money helpers</h2>
        </div>
        <RiskScoreBadge score={riskScore} />
      </div>

      <div className="agent-grid">
        <article className={`agent-card selected`}>
          <div className="agent-topline">
            <div className="agent-icon">
              <PiggyBank size={21} />
            </div>
            <span className="status-chip good">
              {selectedAgent === "Stable-Invest" ? "Connected" : "Recommended"}
            </span>
          </div>
          <h3>Stable-Invest Agent</h3>
          <p>
            Routes flexible funds into a low-risk demo strategy after protected
            expenses are handled.
          </p>
          <div className="risk-range">
            <span>Best for risk 1-3</span>
            <div className="risk-dots" aria-hidden="true">
              <i className="active" />
              <i className="active" />
              <i className="active" />
              <i />
              <i />
            </div>
          </div>
          <div className="agent-balance">
            <span>Current balance</span>
            <strong>{money.format(stableInvestBalance)}</strong>
          </div>
        </article>

        <LockedAgent
          name="Savings Agent"
          copy="Builds emergency buffers before optional growth."
          range="Best for risk 1-4"
        />
        <LockedAgent
          name="Bill-Pay Agent"
          copy="Coordinates predictable bills while preserving cash flow."
          range="Connect after backend policy checks"
        />
      </div>

      <div className="agent-events">
        <p className="section-title">Agent events</p>
        {agentEvents.length === 0 ? (
          <p className="muted-text">
            Stable-Invest routing will appear here after the chat flow.
          </p>
        ) : (
          agentEvents.map((event) => (
            <div className="agent-event" key={event.id}>
              <BadgeCheck size={15} />
              <span>{event.message}</span>
              <time>{formatDate(event.createdAt)}</time>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function LockedAgent({
  name,
  copy,
  range,
}: {
  name: string;
  copy: string;
  range: string;
}) {
  return (
    <article className="agent-card locked">
      <div className="agent-topline">
        <div className="agent-icon muted">
          <LockKeyhole size={20} />
        </div>
        <span className="status-chip neutral">Preview</span>
      </div>
      <h3>{name}</h3>
      <p>{copy}</p>
      <div className="risk-range">
        <span>{range}</span>
      </div>
    </article>
  );
}

function PortfolioSummary({
  buckets,
  total,
  riskScore,
}: {
  buckets: Bucket[];
  total: number;
  riskScore: number | null;
}) {
  const maxBalance = Math.max(...buckets.map((bucket) => bucket.balance), 1);

  return (
    <section className="side-section">
      <div className="section-title-row">
        <div>
          <p className="eyebrow">Portfolio</p>
          <h2>{money.format(total)}</h2>
        </div>
        <RiskScoreBadge score={riskScore} />
      </div>

      <div className="bucket-list">
        {buckets.map((bucket) => (
          <article className="bucket-row" key={bucket.key}>
            <div className="bucket-top">
              <span>{bucket.name}</span>
              <strong>{money.format(bucket.balance)}</strong>
            </div>
            <div className="bar-track">
              <span
                className={`bar-fill ${bucket.key}`}
                style={{
                  width: `${Math.max((bucket.balance / maxBalance) * 100, bucket.balance ? 8 : 0)}%`,
                }}
              />
            </div>
            {bucket.protected && (
              <span className="protected-note">
                <ShieldCheck size={12} />
                Protected first
              </span>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function RiskScoreBadge({ score }: { score: number | null }) {
  return (
    <div className={`risk-badge ${score ? "set" : ""}`}>
      <span>Risk</span>
      <strong>{score ? `${score}/10` : "Not set"}</strong>
    </div>
  );
}

function WhyPanel({ why }: { why: string }) {
  return (
    <section className="side-section why-panel">
      <div className="section-title-row">
        <p className="section-title">Why this happened</p>
        <Sparkles size={15} />
      </div>
      <p>{why}</p>
    </section>
  );
}

function EventFeed({ events }: { events: WalletEvent[] }) {
  return (
    <section className="side-section event-feed">
      <div className="section-title-row">
        <p className="section-title">Live activity</p>
        <span className="live-dot" />
      </div>

      {events.length === 0 ? (
        <p className="muted-text">
          Events will stream here as payments, rules, and agent routes complete.
        </p>
      ) : (
        <div className="event-list">
          {events.map((event) => (
            <article className="event-row" key={event.id}>
              <div className={`event-dot ${statusTone(event.status)}`} />
              <div>
                <div className="event-copy">
                  <p>{event.message}</p>
                  <span>{formatDate(event.createdAt)}</span>
                </div>
                {event.explorerUrl && (
                  <a className="proof-link" href={event.explorerUrl} target="_blank">
                    View transaction
                    <ExternalLink size={12} />
                  </a>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
