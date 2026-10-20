import { createHash } from "node:crypto";
import { DEFAULT_CONTEXT_POLICY, type ContextPolicyV1 } from "../context-scope/types.js";

export type IncrementType =
  | "correction"
  | "deepening"
  | "example"
  | "missing-angle"
  | "risk"
  | "evidence"
  | "execution"
  | "closure";

export type TimeoutTaskType =
  | "chitchat"
  | "chat"
  | "knowledge"
  | "analysis"
  | "research"
  | "data"
  | "decision"
  | "execution"
  | "unknown";

export type CollaborationPolicyV1 = {
  version: "1.0";
  assignment: {
    coordinatorIsDefaultPrimary: false;
    primaryAssignmentAtomic: true;
  };
  mention: {
    mentionBotMustRespond: boolean;
    mentionOverridesPrimary: boolean;
    mentionedBotMode: "primary";
    unmatchedMention: "warn";
    structuredMentionPriority: boolean;
  };
  supplement: {
    enabled: boolean;
    waitForPrimary: true;
    requireIncrementalValue: boolean;
    allowedIncrementTypes: IncrementType[];
    maxSupplementBots: number;
    maxIncrementPerBot: 1;
    duplicateThreshold: number;
    relevanceThreshold: number;
    incrementScoreThreshold: number;
  };
  coordinator: {
    enabled: boolean;
    role: "convergence";
    summarizeWhen: Array<
      "multi-round" | "conflict" | "cross-role" | "explicit-request" | "deliverable-required"
    >;
    avoidSimpleQASummary: boolean;
  };
  conflict: {
    preserveDisagreement: boolean;
    requireExplicitPresentation: boolean;
    autoResolve: false;
    resolutionAuthority: "human" | "coordinator" | "external-policy";
  };
  fallback: {
    allowSecondaryTakeover: boolean;
    takeoverMode: "coordinator" | "best-role-match";
    userNotificationOnTimeout: boolean;
    timeoutPolicy: {
      placeholderMs: number;
      byTaskType: Record<TimeoutTaskType, number>;
    };
  };
  quality: {
    selfCheckBeforeSend: boolean;
    duplicateDetection: boolean;
    offTopicDetection: boolean;
    violationSelfReport: boolean;
    ledgerEnabled: true;
  };
  review: {
    enabled: boolean;
    periodicReview: boolean;
    reviewPeriod: "daily" | "weekly" | "mission" | "manual";
    trackViolations: boolean;
    trackContribution: boolean;
  };
  contextPolicy: ContextPolicyV1;
};

const DEFAULT_INCREMENT_TYPES: IncrementType[] = [
  "correction",
  "deepening",
  "example",
  "missing-angle",
  "risk",
  "evidence",
  "execution",
  "closure",
];

export const DEFAULT_COLLABORATION_POLICY: CollaborationPolicyV1 = {
  version: "1.0",
  assignment: {
    coordinatorIsDefaultPrimary: false,
    primaryAssignmentAtomic: true,
  },
  mention: {
    mentionBotMustRespond: true,
    mentionOverridesPrimary: true,
    mentionedBotMode: "primary",
    unmatchedMention: "warn",
    structuredMentionPriority: true,
  },
  supplement: {
    enabled: true,
    waitForPrimary: true,
    requireIncrementalValue: true,
    allowedIncrementTypes: DEFAULT_INCREMENT_TYPES,
    maxSupplementBots: 2,
    maxIncrementPerBot: 1,
    duplicateThreshold: 0.75,
    relevanceThreshold: 0.6,
    incrementScoreThreshold: 0.55,
  },
  coordinator: {
    enabled: true,
    role: "convergence",
    summarizeWhen: [
      "multi-round",
      "conflict",
      "cross-role",
      "explicit-request",
      "deliverable-required",
    ],
    avoidSimpleQASummary: true,
  },
  conflict: {
    preserveDisagreement: true,
    requireExplicitPresentation: true,
    autoResolve: false,
    resolutionAuthority: "human",
  },
  fallback: {
    allowSecondaryTakeover: true,
    takeoverMode: "best-role-match",
    userNotificationOnTimeout: true,
    timeoutPolicy: {
      placeholderMs: 5_000,
      byTaskType: {
        chitchat: 8_000,
        chat: 8_000,
        knowledge: 15_000,
        analysis: 30_000,
        research: 60_000,
        data: 60_000,
        decision: 30_000,
        execution: 120_000,
        unknown: 30_000,
      },
    },
  },
  quality: {
    selfCheckBeforeSend: true,
    duplicateDetection: true,
    offTopicDetection: true,
    violationSelfReport: true,
    ledgerEnabled: true,
  },
  review: {
    enabled: true,
    periodicReview: true,
    reviewPeriod: "weekly",
    trackViolations: true,
    trackContribution: true,
  },
  contextPolicy: DEFAULT_CONTEXT_POLICY,
};

/** P1-A3: PolicyV1 is derived from EffectivePolicy (see legacy-policy-view.ts). */
export { resolveCollaborationPolicyV1, toLegacyPolicyView } from "./legacy-policy-view.js";

export function freezeCollaborationPolicy(policy: CollaborationPolicyV1): CollaborationPolicyV1 {
  return JSON.parse(JSON.stringify(policy)) as CollaborationPolicyV1;
}

export function resolveFrozenRoundPolicy(snapshot: unknown): CollaborationPolicyV1 | null {
  if (!snapshot || typeof snapshot !== "object") {
    return null;
  }
  const policy = snapshot as CollaborationPolicyV1;
  if (policy.version !== "1.0" || !policy.supplement || !policy.fallback?.timeoutPolicy) {
    return null;
  }
  return policy;
}

export function hashCollaborationPolicy(policy: CollaborationPolicyV1) {
  return createHash("sha256").update(JSON.stringify(policy)).digest("hex");
}

export function snapshotCollaborationPolicy(policy: CollaborationPolicyV1) {
  const frozen = freezeCollaborationPolicy(policy);
  return {
    policyVersion: frozen.version,
    policyHash: hashCollaborationPolicy(frozen),
    snapshotAt: Date.now(),
    policySnapshot: frozen,
  };
}
