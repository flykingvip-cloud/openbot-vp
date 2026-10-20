/**
 * Core type definitions for the Group Mention System.
 *
 * Defines all mention-related data models, event types, UI types,
 * and type guard functions used across the mention subsystem.
 */

// ---------------------------------------------------------------------------
// Mention Metadata (embedded in chat.send payload)
// ---------------------------------------------------------------------------

/** Discriminated mention target — never disguise a human userId as agentId. */
export type MentionTarget =
  | { kind: "agent"; agentId: string }
  | { kind: "human"; userId: string }
  | { kind: "plugin"; pluginId: string }
  | { kind: "all" };

/** Structured metadata for a single mention in a message payload. */
export type MentionMetadata = {
  /** UUID — stable anchor independent of character offsets */
  mention_id: string;
  /**
   * Legacy target agent ID, or `"__all__"` for broadcast.
   * Prefer `target`. Kept for backward-compatible payloads and agent mentions.
   * Absent for human targets (must not forge agentId from userId).
   */
  agentId?: string;
  /** Canonical target. When omitted, resolved from legacy `agentId`. */
  target?: MentionTarget;
  /** Flat transport alias for `target.kind` (optional). */
  targetKind?: "agent" | "human" | "all" | "plugin";
  /** Flat transport alias for agentId/userId/pluginId/`__all__` (optional). */
  targetId?: string;
  /** Display name at time of mention (UI only — server must not trust for auth). */
  displayName: string;
  /** Character offset of "@displayName" in the plain-text message */
  offset: number;
  /** Character length of "@displayName" in the plain-text message */
  length: number;
};

// ---------------------------------------------------------------------------
// Mention Intent
// ---------------------------------------------------------------------------

/** Classification of the purpose behind a mention. */
export type MentionIntent =
  | "attention"
  | "task_assignment"
  | "approval_request"
  | "review_request"
  | "notification"
  | "handoff";

/** All valid MentionIntent values for runtime validation. */
export const MENTION_INTENT_VALUES: readonly MentionIntent[] = [
  "attention",
  "task_assignment",
  "approval_request",
  "review_request",
  "notification",
  "handoff",
] as const;

/** Intent suggestion returned by the IntentClassifier (never auto-executes). */
export type IntentSuggestion = {
  intent: MentionIntent;
  /** Confidence score in the range [0.0, 1.0] */
  confidence: number;
  /** Optional reasoning for the classification */
  reasoning?: string;
};

// ---------------------------------------------------------------------------
// Mention Context (delivered to mentioned agents via event bus)
// ---------------------------------------------------------------------------

/** Enriched context delivered to a mentioned agent's processing pipeline. */
export type MentionContext = {
  isMentioned: boolean;
  mentionType: "direct" | "broadcast";
  mentionSourceAgentId?: string;
  coordinatorVisible: boolean;
  requiresAck?: boolean;
  priority?: "low" | "normal" | "high";
  /** All mention_ids targeting this agent in the message */
  mentionIds: string[];
};

// ---------------------------------------------------------------------------
// Mention State (lifecycle tracking, reconstructed from journal)
// ---------------------------------------------------------------------------

/** Lifecycle tracking record for a single mention instance. */
export type MentionState = {
  mention_id: string;
  source_message_id: string;
  source_agent_id: string;
  target_agent_id: string;
  organization_id: string;
  acknowledged: boolean;
  responded: boolean;
  resolved: boolean;
  /** ISO 8601 timestamp */
  created_at: string;
  /** ISO 8601 timestamp */
  updated_at: string;
  acknowledged_at?: string;
  responded_at?: string;
  resolved_at?: string;
};

// ---------------------------------------------------------------------------
// Mention Events (event bus)
// ---------------------------------------------------------------------------

export type MentionEventType =
  | "mention.created"
  | "mention.acknowledged"
  | "mention.responded"
  | "mention.resolved"
  | "mention.escalated";

/** Event emitted on the MentionEventBus for lifecycle transitions. */
export type MentionEvent = {
  type: MentionEventType;
  mention_id: string;
  source_agent_id: string;
  target_agent_id: string;
  organization_id: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  payload?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// UI Layer Types
// ---------------------------------------------------------------------------

/** A mentionable candidate shown in the MentionPopup. */
export type MentionCandidate = {
  /** Discriminated target. When omitted, treated as agent via `agentId`. */
  kind?: "agent" | "human" | "all" | "plugin";
  /** Agent id for bots / `__all__` for broadcast. Empty for human-only candidates. */
  agentId: string;
  /** Human user id when `kind === "human"`. */
  userId?: string;
  displayName: string;
  roleName?: string;
  online: boolean;
  isCoordinator: boolean;
  isBot: boolean;
  /** Higher values rank earlier when match scores tie. */
  collaborationFrequency?: number;
  /** Higher values rank earlier after collaboration frequency. */
  projectParticipation?: number;
  /** Capability tags shown in popup and included in matching. */
  capabilityTags?: string[];
  /** Current task summary shown in popup and included in matching. */
  currentTask?: string;
};

/** Data backing a rendered MentionChip in the message input. */
export type MentionChipData = {
  mention_id: string;
  /** Legacy agent id; empty string for human chips. */
  agentId: string;
  userId?: string;
  kind?: "agent" | "human" | "all" | "plugin";
  displayName: string;
  isAll: boolean;
};

/** State of the mention trigger/popup lifecycle. */
export type MentionTriggerState = {
  active: boolean;
  query: string;
  caretPosition: { top: number; left: number };
  /** Character offset of the "@" in the input */
  triggerOffset: number;
};

// ---------------------------------------------------------------------------
// Validation & Delivery Results
// ---------------------------------------------------------------------------

/** Result of validating a mentions array against schema and organization registry. */
export type ValidationResult = {
  valid: MentionMetadata[];
  invalid: Array<{ mention: unknown; reason: string }>;
};

/** Result of delivering mentions to target agents / humans. */
export type DeliveryResult = {
  delivered: Array<{
    mention_id: string;
    agentId: string;
    status: "delivered" | "skipped" | "notified";
    targetKind?: "agent" | "human" | "all" | "plugin";
  }>;
  errors: Array<{
    mention_id: string;
    agentId: string;
    reason: string;
    targetKind?: "agent" | "human" | "all" | "plugin";
  }>;
};

// ---------------------------------------------------------------------------
// FuzzyMatcher Result
// ---------------------------------------------------------------------------

/** A single match result from the FuzzyMatcher ranking algorithm. */
export type MatchResult = {
  candidate: MentionCandidate;
  score: number;
  matchType: "prefix" | "substring" | "subsequence";
  matchedField: "displayName" | "roleName" | "agentId" | "capabilityTags" | "currentTask";
};

// ---------------------------------------------------------------------------
// Coordinator Observation
// ---------------------------------------------------------------------------

/** Decision made by the coordinator after observing a mention event. */
export type InterventionDecision = {
  action: "none" | "redirect" | "escalate" | "reassign" | "create_task";
  targetAgentId?: string;
  reason?: string;
  taskTitle?: string;
};

// ---------------------------------------------------------------------------
// Type Guards
// ---------------------------------------------------------------------------

/** Type guard for MentionMetadata (legacy agentId or new target shapes). */
export function isMentionMetadata(value: unknown): value is MentionMetadata {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  const hasLegacyAgentId = typeof record.agentId === "string" && record.agentId.length > 0;
  const hasTargetObject =
    record.target != null &&
    typeof record.target === "object" &&
    typeof (record.target as { kind?: unknown }).kind === "string";
  const hasFlatTarget =
    (record.targetKind === "agent" ||
      record.targetKind === "human" ||
      record.targetKind === "all" ||
      record.targetKind === "plugin") &&
    (record.targetKind === "all" ||
      (typeof record.targetId === "string" && record.targetId.length > 0));
  return (
    typeof record.mention_id === "string" &&
    typeof record.displayName === "string" &&
    typeof record.offset === "number" &&
    typeof record.length === "number" &&
    Number.isFinite(record.offset) &&
    Number.isFinite(record.length) &&
    record.offset >= 0 &&
    record.length >= 0 &&
    (hasLegacyAgentId || hasTargetObject || hasFlatTarget)
  );
}

/** Type guard for MentionState. */
export function isMentionState(value: unknown): value is MentionState {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.mention_id === "string" &&
    typeof record.source_message_id === "string" &&
    typeof record.source_agent_id === "string" &&
    typeof record.target_agent_id === "string" &&
    typeof record.organization_id === "string" &&
    typeof record.acknowledged === "boolean" &&
    typeof record.responded === "boolean" &&
    typeof record.resolved === "boolean" &&
    typeof record.created_at === "string" &&
    typeof record.updated_at === "string"
  );
}

/** Type guard for valid MentionIntent string values. */
export function isValidMentionIntent(value: string): value is MentionIntent {
  return (MENTION_INTENT_VALUES as readonly string[]).includes(value);
}

/** Type guard for intent suggestions produced by the classifier. */
export function isIntentSuggestion(value: unknown): value is IntentSuggestion {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.intent === "string" &&
    isValidMentionIntent(record.intent) &&
    typeof record.confidence === "number" &&
    Number.isFinite(record.confidence) &&
    record.confidence >= 0 &&
    record.confidence <= 1 &&
    (record.reasoning === undefined || typeof record.reasoning === "string")
  );
}
