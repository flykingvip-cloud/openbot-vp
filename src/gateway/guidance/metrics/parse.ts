/**
 * Sanitize metric metadata — drop secrets / task bodies (reuse progress rules).
 */

import { assertSafeProgressSegment } from "../progress/keys.js";
import { sanitizeGuidanceProgressMetadata } from "../progress/redact.js";
import { GuidanceProgressValidationError } from "../progress/types.js";
import { isGuidanceScope } from "../types.js";
import type { GuidanceMetricEvent, GuidanceMetricRecordInput } from "./types.js";
import { GUIDANCE_METRICS_VERSION, isGuidanceMetricEventType } from "./types.js";

export type GuidanceMetricParseError = {
  ok: false;
  message: string;
};

export type GuidanceMetricParseOk = {
  ok: true;
  event: GuidanceMetricEvent;
};

export function parseGuidanceMetricInput(
  value: unknown,
): GuidanceMetricParseOk | GuidanceMetricParseError {
  if (!value || typeof value !== "object") {
    return { ok: false, message: "metric payload must be an object" };
  }
  const raw = value as GuidanceMetricRecordInput;
  if (!isGuidanceMetricEventType(raw.event)) {
    return { ok: false, message: "invalid metric event type" };
  }
  if (!isGuidanceScope(raw.scope)) {
    return { ok: false, message: "scope must be user|robot|team" };
  }
  const scenario = typeof raw.scenario === "string" ? raw.scenario.trim() : "";
  const actionKind = typeof raw.actionKind === "string" ? raw.actionKind.trim() : "";
  const contentVersion = typeof raw.contentVersion === "string" ? raw.contentVersion.trim() : "";
  if (!scenario || !actionKind || !contentVersion) {
    return {
      ok: false,
      message: "tenantId, userId, entityId, scenario, actionKind, contentVersion are required",
    };
  }
  let tenantId: string;
  let userId: string;
  let entityId: string;
  try {
    tenantId = assertSafeProgressSegment(
      "tenantId",
      typeof raw.tenantId === "string" ? raw.tenantId : "",
    );
    userId = assertSafeProgressSegment("userId", typeof raw.userId === "string" ? raw.userId : "");
    entityId = assertSafeProgressSegment(
      "entityId",
      typeof raw.entityId === "string" ? raw.entityId : "",
    );
  } catch (err) {
    if (err instanceof GuidanceProgressValidationError) {
      return { ok: false, message: err.message };
    }
    return { ok: false, message: "invalid isolation key" };
  }
  const timestamp =
    typeof raw.timestamp === "number" && Number.isFinite(raw.timestamp)
      ? raw.timestamp
      : Date.now();

  return {
    ok: true,
    event: {
      version: GUIDANCE_METRICS_VERSION,
      event: raw.event,
      tenantId,
      userId,
      scope: raw.scope,
      entityId,
      scenario,
      actionKind,
      contentVersion,
      timestamp,
      metadata: sanitizeGuidanceProgressMetadata(raw.metadata),
    },
  };
}
