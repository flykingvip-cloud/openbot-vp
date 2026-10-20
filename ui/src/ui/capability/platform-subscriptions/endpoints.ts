export const PLATFORM_SUBSCRIPTIONS_ENDPOINTS = {
  summary: "platform-subscriptions.summary",
} as const;

export type PlatformCommercialSummary = {
  totals: {
    activeSubscriptions: number;
    mrrCents: number;
    previousActiveSubscriptions?: number;
    previousMrrCents?: number;
    subsTrendDelta?: number;
    mrrTrendDelta?: number | null;
  };
  plans: Record<
    string,
    {
      planId: string;
      activeSubscriptions: number;
      mrrCents: number;
      previousActiveSubscriptions?: number;
      previousMrrCents?: number;
      subsTrendDelta?: number;
      mrrTrendDelta?: number | null;
      versions: Record<string, { lockedSubscriptions: number }>;
    }
  >;
  recentActivity?: PlatformPricingActivityItem[];
};

export type PlatformPricingActivityKind =
  | "plan_version_published"
  | "plan_version_deprecated"
  | "subscription_started"
  | "subscription_ended"
  | "subscription_upgraded"
  | "subscription_downgraded";

export type PlatformPricingActivityItem = {
  id: string;
  kind: PlatformPricingActivityKind;
  occurredAt: string;
  planId?: string;
  planName?: string;
  fromPlanId?: string;
  fromPlanName?: string;
  versionNumber?: number;
  enterpriseId?: string;
};
