/**
 * Explicit degrade snapshots — never invent a fake next step.
 */

import {
  GUIDANCE_NONE_ACTION,
  type GuidanceDegradeReason,
  type GuidanceScope,
  type GuidanceSnapshot,
  type GuidanceSource,
} from "./types.js";

export function buildDegradedGuidanceSnapshot(params: {
  scope: GuidanceScope;
  entityId: string;
  reason: Exclude<GuidanceDegradeReason, "none">;
  scenario?: string;
  source?: GuidanceSource;
  tenantId?: string | null;
  userId?: string | null;
  nowMs?: number;
  detail?: string;
}): GuidanceSnapshot {
  const generatedAt = params.nowMs ?? Date.now();
  const stageByReason: Record<Exclude<GuidanceDegradeReason, "none">, string> = {
    no_data: "awaiting_data",
    analysis_failed: "analysis_unavailable",
    permission_denied: "permission_required",
    provider_unavailable: "provider_unavailable",
  };
  return {
    scope: params.scope,
    scenario: params.scenario ?? `degrade.${params.reason}`,
    confidence: "low",
    currentStage: stageByReason[params.reason],
    nextAction: {
      ...GUIDANCE_NONE_ACTION,
      reason: params.detail?.trim() || `guidance.degrade.${params.reason}`,
    },
    optionalActions: [],
    blockers:
      params.reason === "permission_denied"
        ? [
            {
              code: "permission_denied",
              kind: "permission",
              label: "guidance.blocker.permission_denied",
              actionable: false,
            },
          ]
        : params.reason === "no_data"
          ? [
              {
                code: "no_data",
                kind: "data",
                label: "guidance.blocker.no_data",
                actionable: false,
              },
            ]
          : [],
    degrade: params.reason,
    tenantId: params.tenantId ?? null,
    userId: params.userId ?? null,
    entityId: params.entityId.trim() || "unknown",
    source: params.source ?? "orchestrator",
    generatedAt,
  };
}
