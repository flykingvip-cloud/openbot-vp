/**
 * Gateway-owned recoverable guidance progress (SoT P1).
 *
 * Authority lives on the Gateway — never browser localStorage alone.
 * Does NOT duplicate GrowthStatus / LifecycleState.
 */

import type { GuidanceEventType } from "../../agent-growth/guidance-event.js";
import type { GuidanceConfidence, GuidanceScope } from "../types.js";

export const GUIDANCE_PROGRESS_VERSION = 1 as const;

export type GuidanceProgressStatus = "active" | "completed" | "abandoned";

/** Isolation + addressing key — required for every persisted record. */
export type GuidanceProgressKey = {
  tenantId: string;
  userId: string;
  scope: GuidanceScope;
  entityId: string;
};

/**
 * Safe metadata bag. Forbidden: task body, AppSecret, API keys, passwords.
 * Values are redacted on write; unknown nested objects are dropped.
 */
export type GuidanceProgressMetadata = Record<string, string | number | boolean | null>;

export type GuidanceProgressRecord = GuidanceProgressKey & {
  version: typeof GUIDANCE_PROGRESS_VERSION;
  scenario: string;
  /** Protocol NavigationState stage / step id (aligns with user-guidance-protocol). */
  currentStage: string;
  completedSteps: string[];
  /** Aligns with GuidanceNextAction.kind / protocol next step id. */
  nextActionKind: string;
  nextActionLabel?: string;
  confidence: GuidanceConfidence;
  failureCount: number;
  status: GuidanceProgressStatus;
  abandonedAt?: number;
  completedAt?: number;
  lastSeenAt: number;
  createdAt: number;
  updatedAt: number;
  /** Correlation to guidance_event / asset-incubation — not Growth lifecycle. */
  lastGuidanceEventId?: string;
  lastGuidanceEventType?: GuidanceEventType;
  metadata?: GuidanceProgressMetadata;
  /** Absolute expiry; expired records are treated as absent on read. */
  expiresAt?: number;
};

export type GuidanceProgressUpsertInput = {
  scenario: string;
  currentStage: string;
  completedSteps?: string[];
  nextActionKind: string;
  nextActionLabel?: string;
  confidence: GuidanceConfidence;
  failureCount?: number;
  status?: Extract<GuidanceProgressStatus, "active" | "completed">;
  metadata?: GuidanceProgressMetadata | Record<string, unknown>;
  expiresAt?: number;
  lastGuidanceEventId?: string;
  lastGuidanceEventType?: GuidanceEventType;
  /** Test / clock injection. */
  nowMs?: number;
};

export type GuidanceProgressAdvanceInput = {
  stepId: string;
  nextStage?: string;
  nextActionKind?: string;
  nextActionLabel?: string;
  confidence?: GuidanceConfidence;
  metadata?: GuidanceProgressMetadata | Record<string, unknown>;
  nowMs?: number;
};

export type GuidanceProgressAbandonInput = {
  reason?: string;
  metadata?: GuidanceProgressMetadata | Record<string, unknown>;
  nowMs?: number;
};

export type GuidanceProgressStore = {
  read(key: GuidanceProgressKey): Promise<GuidanceProgressRecord | null>;
  write(record: GuidanceProgressRecord): Promise<GuidanceProgressRecord>;
  delete(key: GuidanceProgressKey): Promise<void>;
};

export class GuidanceProgressAuthError extends Error {
  readonly code = "permission_denied" as const;
  constructor(message: string) {
    super(message);
    this.name = "GuidanceProgressAuthError";
  }
}

export class GuidanceProgressValidationError extends Error {
  readonly code = "invalid_request" as const;
  constructor(message: string) {
    super(message);
    this.name = "GuidanceProgressValidationError";
  }
}
