/**
 * Align user-guidance-protocol / guidance_event fields with progress records.
 * Does not write GrowthStatus or duplicate lifecycle FSM.
 */

import {
  buildGuidanceIntentKey,
  parseGuidanceEventInput,
  type GuidanceEventInput,
} from "../../agent-growth/guidance-event.js";
import { upsertGuidanceProgress, abandonGuidanceProgress } from "./service.js";
import type {
  GuidanceProgressKey,
  GuidanceProgressRecord,
  GuidanceProgressStore,
} from "./types.js";
import { GuidanceProgressValidationError } from "./types.js";

/**
 * Field map (protocol / guidance_event → progress):
 * - scenario → scenario
 * - stepId → currentStage (and completedSteps on failure/completion signals)
 * - contextConfidence → confidence
 * - stepsCompleted → length hint for completedSteps (does not invent step ids)
 * - event → lastGuidanceEventType + status transitions
 * - intentKey / id → lastGuidanceEventId
 */
export function mapGuidanceEventToProgressFields(event: GuidanceEventInput): {
  scenario: string;
  currentStage: string;
  nextActionKind: string;
  confidence: GuidanceEventInput["contextConfidence"];
  status: "active" | "completed";
  failureCountDelta: number;
  eventId: string;
} {
  const eventId = `${buildGuidanceIntentKey(event)}:${event.occurredAt ?? "pending"}`;
  if (event.event === "guidance_completed") {
    return {
      scenario: event.scenario,
      currentStage: event.stepId?.trim() || "completed",
      nextActionKind: "none",
      confidence: event.contextConfidence,
      status: "completed",
      failureCountDelta: 0,
      eventId,
    };
  }
  if (event.event === "guidance_abandoned") {
    return {
      scenario: event.scenario,
      currentStage: event.stepId?.trim() || "abandoned",
      nextActionKind: "none",
      confidence: event.contextConfidence,
      status: "active", // abandon handled separately
      failureCountDelta: 0,
      eventId,
    };
  }
  // guidance_step_failed
  return {
    scenario: event.scenario,
    currentStage: event.stepId?.trim() || "unknown",
    nextActionKind: event.stepId?.trim() || "retry_step",
    confidence: event.contextConfidence,
    status: "active",
    failureCountDelta: 1,
    eventId,
  };
}

export async function applyGuidanceEventToProgress(
  store: GuidanceProgressStore,
  key: GuidanceProgressKey,
  rawEvent: unknown,
  opts?: { nowMs?: number },
): Promise<GuidanceProgressRecord> {
  const parsed = parseGuidanceEventInput(rawEvent);
  if (!parsed) {
    throw new GuidanceProgressValidationError(
      "event must include event(guidance_*), scenario, contextConfidence; step failures need stepId + failureReason",
    );
  }
  const nowMs = opts?.nowMs ?? parsed.occurredAt ?? Date.now();
  const mapped = mapGuidanceEventToProgressFields({ ...parsed, occurredAt: nowMs });

  if (parsed.event === "guidance_abandoned") {
    // Ensure a record exists so abandon is recoverable / correlated.
    await upsertGuidanceProgress(store, key, {
      scenario: mapped.scenario,
      currentStage: mapped.currentStage,
      nextActionKind: mapped.nextActionKind,
      confidence: mapped.confidence,
      completedSteps: [],
      lastGuidanceEventId: mapped.eventId,
      lastGuidanceEventType: parsed.event,
      metadata: {
        issueClass: parsed.issueClass ?? null,
        userAction: parsed.userAction ?? null,
      },
      nowMs,
    });
    return await abandonGuidanceProgress(store, key, {
      reason: parsed.failureReason ?? parsed.userAction ?? "user_abandoned",
      nowMs,
      metadata: {
        issueClass: parsed.issueClass ?? null,
      },
    });
  }

  const completedSteps =
    parsed.event === "guidance_completed" && parsed.stepId?.trim() ? [parsed.stepId.trim()] : [];

  const existing = await store.read(key);
  const failureCount =
    (existing &&
    existing.tenantId === key.tenantId &&
    existing.userId === key.userId &&
    existing.scope === key.scope &&
    existing.entityId === key.entityId
      ? existing.failureCount
      : 0) + mapped.failureCountDelta;

  return await upsertGuidanceProgress(store, key, {
    scenario: mapped.scenario,
    currentStage: mapped.currentStage,
    nextActionKind: mapped.nextActionKind,
    confidence: mapped.confidence,
    status: mapped.status,
    completedSteps,
    failureCount,
    lastGuidanceEventId: mapped.eventId,
    lastGuidanceEventType: parsed.event,
    metadata: {
      issueClass: parsed.issueClass ?? null,
      userAction: parsed.userAction ?? null,
      exceptions: typeof parsed.exceptions === "number" ? parsed.exceptions : null,
      stepsCompletedHint: typeof parsed.stepsCompleted === "number" ? parsed.stepsCompleted : null,
      skill: parsed.skill ?? "user-guidance-protocol",
    },
    nowMs,
  });
}
