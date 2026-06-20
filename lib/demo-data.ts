import type {
  Action,
  Automation,
  BalanceResponse,
  ChatResponse,
  Portfolio,
  WalletEvent,
} from "./types";

const now = () => new Date().toISOString();

const initialPortfolio: Portfolio = {
  checking: 2000,
  rent_safe: 0,
  family_payment: 0,
  stable_invest: 0,
};

const firstPlanPortfolio: Portfolio = {
  checking: 0,
  rent_safe: 1200,
  family_payment: 50,
  stable_invest: 750,
};

const moneyBackPortfolio: Portfolio = {
  checking: 200,
  rent_safe: 1200,
  family_payment: 50,
  stable_invest: 550,
};

type DemoState = {
  portfolio: Portfolio;
  riskScore: number | null;
  events: WalletEvent[];
  automations: Automation[];
  selectedAgent: "Stable-Invest" | null;
};

const demoState: DemoState = {
  portfolio: initialPortfolio,
  riskScore: null,
  events: [],
  automations: [],
  selectedAgent: null,
};

export function resetDemoState() {
  demoState.portfolio = initialPortfolio;
  demoState.riskScore = null;
  demoState.events = [];
  demoState.automations = [];
  demoState.selectedAgent = null;
}

export function getBalance(): BalanceResponse {
  const portfolio = demoState.portfolio;

  return {
    walletAddress: "0x9B2d...A71E",
    network: "base-sepolia",
    asset: "testnet USDC",
    walletBalance:
      portfolio.checking +
      portfolio.rent_safe +
      portfolio.family_payment +
      portfolio.stable_invest,
    buckets: [
      {
        name: "Checking",
        key: "checking",
        balance: portfolio.checking,
        protected: false,
      },
      {
        name: "Rent Safe",
        key: "rent_safe",
        balance: portfolio.rent_safe,
        protected: true,
      },
      {
        name: "Family Payment",
        key: "family_payment",
        balance: portfolio.family_payment,
        protected: false,
      },
      {
        name: "Stable-Invest",
        key: "stable_invest",
        balance: portfolio.stable_invest,
        protected: false,
      },
    ],
    updatedAt: now(),
  };
}

export function getEvents() {
  return [...demoState.events].sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export function getAutomations() {
  return demoState.automations;
}

export function getRiskScore() {
  return demoState.riskScore;
}

export function getSelectedAgent() {
  return demoState.selectedAgent;
}

function setEvents(events: WalletEvent[]) {
  demoState.events = [...events, ...demoState.events].slice(0, 12);
}

export function handleChat(message: string): ChatResponse {
  const normalized = message.toLowerCase();

  if (normalized.includes("200 back") || normalized.includes("$200 back")) {
    demoState.portfolio = moneyBackPortfolio;

    const events: WalletEvent[] = [
      {
        id: `evt_${Date.now()}_rebalance`,
        type: "portfolio_updated",
        message: "Moved $200 back to checking without touching rent.",
        status: "confirmed",
        createdAt: now(),
      },
      {
        id: `evt_${Date.now()}_why`,
        type: "explanation_ready",
        message: "Rent Safe stayed protected because it was marked essential.",
        status: "ready",
        createdAt: now(),
      },
    ];

    setEvents(events);

    return {
      assistantMessage:
        "I moved $200 back to checking and left rent untouched. I used the flexible Stable-Invest bucket because your rent-safe money is protected.",
      actions: [
        {
          type: "rebalance_funds",
          status: "confirmed",
          amount: 200,
          eventId: "evt_rebalance_200",
        },
      ],
      portfolio: moneyBackPortfolio,
      events,
      automations: demoState.automations,
      riskScore: demoState.riskScore ?? 3,
      why:
        "I avoided the rent-safe bucket first, then pulled from flexible funds. That keeps essential bills protected while still giving you cash back.",
    };
  }

  demoState.portfolio = firstPlanPortfolio;
  demoState.riskScore = 3;
  demoState.selectedAgent = "Stable-Invest";
  demoState.automations = [
    {
      id: "auto_sister_monthly",
      name: "Send sister $50 monthly",
      status: "active",
      nextRunAt: "2026-07-01T09:00:00-07:00",
      explanation:
        "WalletOS will send $50 on payday after income arrives and before flexible funds are routed.",
    },
    {
      id: "auto_rent_safe",
      name: "Protect rent first",
      status: "active",
      nextRunAt: "2026-07-01T09:01:00-07:00",
      explanation:
        "Your rent bucket is reserved before any optional payment or investment action happens.",
    },
    {
      id: "auto_stable_invest",
      name: "Route leftover funds to Stable-Invest",
      status: "active",
      nextRunAt: "2026-07-01T09:02:00-07:00",
      explanation:
        "Leftover funds go to a low-risk helper because your risk score is 3 out of 10.",
    },
  ];

  const txHash = "0x8b7f4c9a91f3d6e2a0b5c4d7e8f1029384756abc";
  const explorerUrl = "https://sepolia.basescan.org/tx/0x8b7f4c9a91f3d6e2a0b5c4d7e8f1029384756abc";

  const actions: Action[] = [
    {
      type: "send_payment",
      status: "confirmed",
      amount: 50,
      asset: "testnet USDC",
      txHash,
      explorerUrl,
    },
    {
      type: "route_to_agent",
      status: "completed",
      agentName: "Stable-Invest",
      amount: 750,
      eventId: "evt_stable_invest_route",
    },
  ];

  const events: WalletEvent[] = [
    {
      id: `evt_${Date.now()}_policy`,
      type: "policy_updated",
      message: "Saved risk score 3/10 and protected rent rule.",
      status: "confirmed",
      createdAt: now(),
    },
    {
      id: `evt_${Date.now()}_automation`,
      type: "automation_created",
      message: "Created monthly sister payment.",
      status: "active",
      createdAt: now(),
    },
    {
      id: `evt_${Date.now()}_payment`,
      type: "payment_confirmed",
      message: "Sent $50 to sister.",
      status: "confirmed",
      txHash,
      explorerUrl,
      createdAt: now(),
    },
    {
      id: `evt_${Date.now()}_agent`,
      type: "agent_routed",
      message: "Routed $750 to Stable-Invest.",
      status: "completed",
      createdAt: now(),
    },
    {
      id: `evt_${Date.now()}_portfolio`,
      type: "portfolio_updated",
      message: "Portfolio buckets updated.",
      status: "confirmed",
      createdAt: now(),
    },
  ];

  setEvents(events);

  return {
    assistantMessage:
      "I sent $50 to your sister, protected rent, and routed the remaining flexible funds to Stable-Invest because your risk score is 3 out of 10.",
    actions,
    portfolio: firstPlanPortfolio,
    events,
    automations: demoState.automations,
    riskScore: 3,
    why:
      "You asked for low risk, so I protected rent first, kept the family payment small and recurring, then chose Stable-Invest for the leftover funds because it is best for risk 1-3.",
  };
}
