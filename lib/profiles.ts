export type AuthUser = {
  userId: string;
  email: string;
  name?: string;
  imageUrl?: string;
};

export type WalletOSProfile = {
  userId: string;
  email: string;
  name?: string;
  imageUrl?: string;
  riskScore: number;
  connectedAgents: string[];
  automations: string[];
};

const profiles = new Map<string, WalletOSProfile>();

export function getOrCreateProfile(user: AuthUser): WalletOSProfile {
  const existing = profiles.get(user.userId);

  if (existing) {
    return {
      ...existing,
      email: user.email,
      name: user.name,
      imageUrl: user.imageUrl,
    };
  }

  const profile: WalletOSProfile = {
    userId: user.userId,
    email: user.email,
    name: user.name,
    imageUrl: user.imageUrl,
    riskScore: 3,
    connectedAgents: ["Stable-Invest"],
    automations: [],
  };

  profiles.set(user.userId, profile);
  return profile;
}

export function updateProfile(
  userId: string,
  update: Partial<Omit<WalletOSProfile, "userId">>,
) {
  const current = profiles.get(userId);
  if (!current) return;
  profiles.set(userId, { ...current, ...update });
}
