/**
 * User Guidance Protocol → Asset Incubation bridge.
 *
 * Maps structured guidance_* events from the steward skill into
 * asset-incubation session-event records for pattern mining / SOP reuse.
 */

import { redactSecretText } from "../../infra/redact-secret-text.js";
import type { AssetIncubationSessionEventRecord } from "../asset-incubation-session-store.js";

export const GUIDANCE_EVENTS = [
  "guidance_completed",
  "guidance_step_failed",
  "guidance_abandoned",
] as const;

export type GuidanceEventType = (typeof GUIDANCE_EVENTS)[number];

export const GUIDANCE_CONFIDENCE = ["high", "medium", "low"] as const;
export type GuidanceContextConfidence = (typeof GUIDANCE_CONFIDENCE)[number];

export type GuidanceEventInput = {
  event: GuidanceEventType;
  skill?: string;
  scenario: string;
  stepId?: string;
  contextConfidence: GuidanceContextConfidence;
  stepsCompleted?: number;
  exceptions?: number;
  failureReason?: string;
  issueClass?: string;
  userAction?: string;
  reusablePattern?: boolean;
  sessionKey?: string;
  contextId?: string | null;
  ownerKey?: string;
  occurredAt?: number;
};

function isGuidanceEventType(value: unknown): value is GuidanceEventType {
  return typeof value === "string" && (GUIDANCE_EVENTS as readonly string[]).includes(value);
}

function isConfidence(value: unknown): value is GuidanceContextConfidence {
  return typeof value === "string" && (GUIDANCE_CONFIDENCE as readonly string[]).includes(value);
}

/** Redact secrets and long hex blobs (e.g. WeChat AppSecret) from free-text fields. */
export function redactGuidanceFreeText(value: string): string {
  let out = redactSecretText(value);
  // 32-char hex commonly used for WeChat AppSecret / similar tokens.
  out = out.replace(/\b[a-fA-F0-9]{32}\b/g, "***");
  // Long opaque alnum tokens (24+) that are unlikely to be normal prose.
  out = out.replace(/\b[A-Za-z0-9_-]{40,}\b/g, "***");
  return out;
}

function redactOptional(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  return redactGuidanceFreeText(trimmed);
}

export function parseGuidanceEventInput(value: unknown): GuidanceEventInput | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Record<string, unknown>;
  if (!isGuidanceEventType(raw.event)) {
    return null;
  }
  const scenario = typeof raw.scenario === "string" ? raw.scenario.trim() : "";
  if (!scenario) {
    return null;
  }
  if (!isConfidence(raw.contextConfidence)) {
    return null;
  }
  if (raw.event === "guidance_step_failed") {
    const stepId = typeof raw.stepId === "string" ? raw.stepId.trim() : "";
    const failureReason = typeof raw.failureReason === "string" ? raw.failureReason.trim() : "";
    if (!stepId || !failureReason) {
      return null;
    }
  }
  return {
    event: raw.event,
    skill: typeof raw.skill === "string" ? raw.skill.trim() : "user-guidance-protocol",
    scenario,
    stepId: typeof raw.stepId === "string" ? raw.stepId.trim() : undefined,
    contextConfidence: raw.contextConfidence,
    stepsCompleted: typeof raw.stepsCompleted === "number" ? raw.stepsCompleted : undefined,
    exceptions: typeof raw.exceptions === "number" ? raw.exceptions : undefined,
    failureReason: redactOptional(
      typeof raw.failureReason === "string" ? raw.failureReason : undefined,
    ),
    issueClass: typeof raw.issueClass === "string" ? raw.issueClass.trim() : undefined,
    userAction: redactOptional(typeof raw.userAction === "string" ? raw.userAction : undefined),
    reusablePattern: typeof raw.reusablePattern === "boolean" ? raw.reusablePattern : undefined,
    sessionKey: typeof raw.sessionKey === "string" ? raw.sessionKey : undefined,
    contextId: typeof raw.contextId === "string" ? raw.contextId : null,
    ownerKey: typeof raw.ownerKey === "string" ? raw.ownerKey : undefined,
    occurredAt: typeof raw.occurredAt === "number" ? raw.occurredAt : undefined,
  };
}

/** Build a stable cluster / intent key for pattern mining. */
export function buildGuidanceIntentKey(input: GuidanceEventInput): string {
  const parts = ["guidance", input.scenario, input.event];
  if (input.stepId) {
    parts.push(input.stepId);
  }
  return parts.join(":");
}

/**
 * Convert a guidance event into an asset-incubation session-event record.
 * `workflowSignature` carries a compact JSON summary for later miners.
 */
export function toGuidanceSessionEvent(
  input: GuidanceEventInput,
  ownerKey: string,
): AssetIncubationSessionEventRecord {
  const occurredAt = input.occurredAt ?? Date.now();
  const intentKey = buildGuidanceIntentKey(input);
  const skill = input.skill || "user-guidance-protocol";
  const reusable =
    input.reusablePattern ??
    (input.event === "guidance_completed" && input.contextConfidence !== "low");
  const label =
    input.event === "guidance_completed"
      ? `引导完成: ${input.scenario}`
      : input.event === "guidance_abandoned"
        ? `引导放弃: ${input.scenario}`
        : `引导卡点: ${input.scenario}/${input.stepId ?? "?"}`;

  return {
    id: `${intentKey}:${occurredAt}`,
    ownerKey,
    sessionKey: input.sessionKey ?? "",
    contextId: input.contextId ?? null,
    clusterId: `guidance:${input.scenario}`,
    intentKey,
    label,
    suggestedAssetType: reusable ? "sop" : "capability",
    workflowSignature: JSON.stringify({
      event: input.event,
      skill,
      scenario: input.scenario,
      stepId: input.stepId,
      contextConfidence: input.contextConfidence,
      stepsCompleted: input.stepsCompleted,
      exceptions: input.exceptions,
      failureReason: input.failureReason,
      issueClass: input.issueClass,
      userAction: input.userAction,
      reusablePattern: reusable,
    }),
    occurredAt,
  };
}
