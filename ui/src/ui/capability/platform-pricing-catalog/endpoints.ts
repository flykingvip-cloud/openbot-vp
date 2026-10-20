export const PLATFORM_PRICING_CATALOG_ENDPOINTS = {
  catalog: "platform-pricing.catalog",
} as const;

export type PricingCtaType = "trial" | "upgrade" | "current" | "contact";

export type PricingPlanViewModel = {
  id: string;
  planVersionId: string;
  slot: string;
  displayName: string;
  slogan?: string;
  recommended?: boolean;
  pricing: {
    monthly: number;
    quarterly?: number;
    annual?: number;
  };
  originalPricing?: {
    monthly?: number;
  };
  cycleSavings?: {
    quarterly?: number;
    annual?: number;
  };
  badge?: string;
  targetAudience?: string;
  description?: string;
  annualDiscountedMonthlyLabel?: string;
  capabilities: string[];
  metrics: {
    seats?: number | "custom";
    aiEmployees?: number | "custom";
    concurrentRuns?: number | "custom";
    creditsMonthly?: number;
    estimatedMonthlyTasks?: number;
    workflows?: number | "custom";
    knowledgeBases?: number | "custom";
  };
  /** AI 授权档数量文案（如 30 个基础 AI + 50 个专业 AI + 20 个高级 AI 授权）。 */
  aiAuthorizationLabel?: string;
  /** Structured AI capability quotas (基础/专业/高级) — not membership roles. */
  aiProfileQuota?: {
    basic: number | "custom" | null;
    pro: number | "custom" | null;
    elite: number | "custom" | null;
  };
  tierLabel?: string;
  cardFields: {
    teamRange?: string;
    annualDiscountedMonthly?: string;
    overagePolicy?: string;
  };
  compare: Record<string, unknown>;
  cta: {
    label: string;
    type: PricingCtaType;
  };
  contactSales: boolean;
  freeTrial: boolean;
};

export type PricingCompareRow = {
  id: string;
  label: string;
  /** Secondary explanation under the row title (e.g. AI capability scope). */
  description?: string;
  values: Record<string, string | boolean>;
};

export type PricingFaqItem = {
  question: string;
  answer: string;
  points?: string[];
  examples?: string[];
};

export type PricingCatalogViewModel = {
  plans: PricingPlanViewModel[];
  compareRows: PricingCompareRow[];
  faq: PricingFaqItem[];
  billingHint: string;
};

export type PlatformPricingCatalogResponse = PricingCatalogViewModel;
