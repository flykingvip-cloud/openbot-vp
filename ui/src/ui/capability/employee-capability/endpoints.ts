import type {
  CapabilityShareVisibility,
  CapabilitySummary,
  CapabilityUsageBrief,
} from "./types.ts";

export type QuickSavePatternHint = {
  sampleTaskDescription: string;
  firstFormedScenario: string;
};

export type CapabilityRecommendation = {
  capability: CapabilitySummary;
  reason: string;
};

export type InstallToRobotResponse = {
  capabilityId: string;
  agentId: string;
};

export type CapabilityPreflightResponse = {
  capabilityId: string;
  status: string;
  nextStep: string;
  canInstall: boolean;
};

export type MyAccumulationResponse = {
  items: Array<{
    id: string;
    name: string;
    summary: string;
    assetType?:
      | "prompt"
      | "template"
      | "workflow"
      | "knowledge"
      | "agent"
      | "capability"
      | "tool"
      | "mcp";
    health: CapabilitySummary["health"];
    shareVisibility: CapabilityShareVisibility;
    isDraft: boolean;
    recentUpdate: CapabilitySummary["recentUpdate"];
    updatedAt: number;
    sourceRobotName: string | null;
    sourceContextLabel?: string;
    usageBrief: {
      robotCount: number;
      lastUsedAt: number | null;
    };
    usageMetrics: CapabilitySummary["usageMetrics"];
    versionInfo: CapabilitySummary["versionInfo"];
    applicationSummary?: string;
    feedbackSummary?: string;
    enterpriseReview?: CapabilitySummary["enterpriseReview"];
    enterpriseLifecycle?: CapabilitySummary["enterpriseLifecycle"];
    optimizationTargets?: NonNullable<CapabilitySummary["optimizationTargets"]>;
  }>;
  availableTags: string[];
  availableCategories: string[];
  availableSources: string[];
};

export type QuickSaveResponse = {
  capability: CapabilitySummary;
};

export type RecommendationsResponse = {
  recommendations: CapabilityRecommendation[];
};

export type UsageBriefResponse = {
  capabilityId: string;
  usage: CapabilityUsageBrief;
};

export type HealthLabelSubscribeResponse = {
  subscriptionId: string;
  initialLabels: Array<{
    capabilityId: string;
    health: CapabilitySummary["health"];
  }>;
};

export type UpdateRecapResponse = {
  capabilityId: string;
  recaps: NonNullable<CapabilitySummary["recentUpdate"]>[];
};
