/**
 * Phase 2 shadow ingress adapter.
 * Callers ignore the return. Never pass user text, prompt, or Ledger bodies.
 * Never invent objectiveId from runId.
 */

import { normalizeObservedRunId, resolveShadowTenant, type TenantScope } from "./candidates.js";
import { tryObserveObjectiveShadow } from "./runtime.js";
import { OBJECTIVE_SHADOW_SCHEMA } from "./types.js";
import type { ShadowCandidate, ShadowIngress } from "./types.js";

export const OBJECTIVE_SHADOW_LOG_ENV = "OPENBOT_TASK_FOCUS_OBJECTIVE_SHADOW_LOG";

export type IngressObserveParams = {
  ingress: ShadowIngress;
  tenantId?: string | null;
  /** identified: missing tenant is invalid_input. local_unscoped may use "local". */
  tenantScope?: TenantScope | null;
  runId?: string | null;
  parentRunId?: string | null;
  cronOccurrenceId?: string | null;
  /** Permanent job id — never used as runId / objectiveId. */
  cronJobId?: string | null;
  groupId?: string | null;
  /** Explicit structured candidates. Omitted or [] means skipped — no fabrication. */
  candidates?: ShadowCandidate[];
};

function depsFromEnv(): { env: NodeJS.ProcessEnv; logPath?: string; windowPath?: string } {
  const logPath = process.env[OBJECTIVE_SHADOW_LOG_ENV]?.trim();
  return {
    env: process.env,
    logPath: logPath || undefined,
    windowPath: logPath ? logPath.replace(/\.jsonl$/i, ".window.json") : undefined,
  };
}

/**
 * Fire-and-forget. Never throws. Never returns a value that callers may use
 * to change prompt, completion, status, Ledger, or round state.
 */
export function observeObjectiveShadowFromIngress(params: IngressObserveParams): void {
  try {
    const occurrence = params.cronOccurrenceId?.trim();
    const jobId = params.cronJobId?.trim();
    let runId = params.runId?.trim() ?? "";
    if (params.ingress === "cron_isolated") {
      if (!occurrence || (jobId && occurrence === jobId)) {
        return;
      }
      runId = occurrence;
    }
    if (!runId || !params.ingress) {
      return;
    }
    const tenant = resolveShadowTenant({
      tenantId: params.tenantId,
      tenantScope: params.tenantScope,
    });
    const candidates = params.candidates ?? [];
    if ("invalidInput" in tenant) {
      tryObserveObjectiveShadow(
        {
          schemaVersion: OBJECTIVE_SHADOW_SCHEMA,
          tenantId: "identified_missing",
          ingress: params.ingress,
          runId,
          parentRunId: normalizeObservedRunId(params.parentRunId),
          cronOccurrenceId:
            params.ingress === "cron_isolated"
              ? occurrence || runId
              : params.cronOccurrenceId?.trim(),
          groupId: params.groupId?.trim() || undefined,
          candidates: [],
          observedAtMs: Date.now(),
          inputErrors: ["invalid_input"],
        },
        depsFromEnv(),
      );
      return;
    }
    tryObserveObjectiveShadow(
      {
        schemaVersion: OBJECTIVE_SHADOW_SCHEMA,
        tenantId: tenant.tenantId,
        ingress: params.ingress,
        runId,
        parentRunId:
          params.ingress === "subagent" ? normalizeObservedRunId(params.parentRunId) : undefined,
        cronOccurrenceId:
          params.ingress === "cron_isolated"
            ? occurrence || runId
            : params.cronOccurrenceId?.trim(),
        groupId: params.groupId?.trim() || undefined,
        candidates,
        observedAtMs: Date.now(),
      },
      depsFromEnv(),
    );
  } catch {
    // I14: observation must never change the caller.
  }
}
