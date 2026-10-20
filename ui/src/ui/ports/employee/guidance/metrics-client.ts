/**
 * Client helpers for guidance metrics + Gateway progress resume (P3).
 * Metrics failures are swallowed — never block UX.
 */

import type { UiGuidanceSnapshot } from "./orchestrate-surface.ts";
import { GUIDANCE_CONTENT_VERSION, markGuidanceShownKey } from "./ui-control-state.ts";

export type GuidanceMetricClientEvent =
  | "guidance_shown"
  | "guidance_primary_clicked"
  | "guidance_optional_clicked"
  | "guidance_acknowledged"
  | "guidance_deferred"
  | "guidance_resumed"
  | "guidance_completed"
  | "guidance_abandoned"
  | "guidance_step_failed"
  | "guidance_high_risk_confirmed"
  | "guidance_context_low_confidence";

export type GuidanceOrchestratorClient = {
  request?: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>;
};

export async function recordGuidanceMetricClient(
  client: GuidanceOrchestratorClient | null | undefined,
  snapshot: UiGuidanceSnapshot,
  event: GuidanceMetricClientEvent,
  extras?: { actionKind?: string; metadata?: Record<string, unknown> },
): Promise<void> {
  try {
    await client?.request?.("guidance.metrics.record", {
      event,
      tenantId: snapshot.tenantId ?? "local",
      userId: snapshot.userId ?? "local",
      scope: snapshot.scope,
      entityId: snapshot.entityId,
      scenario: snapshot.scenario,
      actionKind: extras?.actionKind ?? snapshot.nextAction.kind,
      contentVersion: snapshot.contentVersion ?? GUIDANCE_CONTENT_VERSION,
      metadata: extras?.metadata,
    });
  } catch {
    // fail-soft
  }
}

/** Emit guidance_shown once per scope key. */
export async function recordGuidanceShownOnce(
  client: GuidanceOrchestratorClient | null | undefined,
  snapshot: UiGuidanceSnapshot,
): Promise<void> {
  if (!markGuidanceShownKey(snapshot)) {
    return;
  }
  await recordGuidanceMetricClient(client, snapshot, "guidance_shown");
  if (snapshot.confidence === "low") {
    await recordGuidanceMetricClient(client, snapshot, "guidance_context_low_confidence");
  }
}

/** Resume reads Gateway progress — never treat browser localStorage as authority. */
export async function readGuidanceProgressFromGateway(
  client: GuidanceOrchestratorClient | null | undefined,
  snapshot: UiGuidanceSnapshot,
): Promise<unknown> {
  try {
    const result = await client?.request?.<{ record?: unknown }>("guidance.progress.get", {
      tenantId: snapshot.tenantId ?? "local",
      userId: snapshot.userId ?? "local",
      scope: snapshot.scope,
      entityId: snapshot.entityId,
    });
    return result?.record ?? null;
  } catch {
    return null;
  }
}
