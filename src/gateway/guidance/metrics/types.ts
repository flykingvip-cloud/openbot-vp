/**
 * Guidance Orchestrator P3 metrics — audit events (not Growth FSM, not incubation).
 * Fail-soft: recording errors must never block guidance UX.
 */

import type { GuidanceScope } from "../types.js";

export const GUIDANCE_METRIC_EVENTS = [
  "guidance_shown",
  "guidance_primary_clicked",
  "guidance_optional_clicked",
  "guidance_acknowledged",
  "guidance_deferred",
  "guidance_resumed",
  "guidance_completed",
  "guidance_abandoned",
  "guidance_step_failed",
  "guidance_high_risk_confirmed",
  "guidance_context_low_confidence",
] as const;

export type GuidanceMetricEventType = (typeof GUIDANCE_METRIC_EVENTS)[number];

export const GUIDANCE_METRICS_VERSION = 1 as const;

/** Distinct from asset-incubation `guidance_event` — UX funnel metrics only. */
export type GuidanceMetricEvent = {
  version: typeof GUIDANCE_METRICS_VERSION;
  event: GuidanceMetricEventType;
  tenantId: string;
  userId: string;
  scope: GuidanceScope;
  entityId: string;
  scenario: string;
  actionKind: string;
  contentVersion: string;
  timestamp: number;
  /** Optional safe scalars — never task body / secrets. */
  metadata?: Record<string, string | number | boolean | null>;
};

export type GuidanceMetricRecordInput = {
  event: GuidanceMetricEventType;
  tenantId: string;
  userId: string;
  scope: GuidanceScope;
  entityId: string;
  scenario: string;
  actionKind: string;
  contentVersion: string;
  timestamp?: number;
  metadata?: Record<string, unknown>;
};

export function isGuidanceMetricEventType(value: unknown): value is GuidanceMetricEventType {
  return typeof value === "string" && (GUIDANCE_METRIC_EVENTS as readonly string[]).includes(value);
}
