/**
 * Gateway RPCs for recoverable guidance progress (Orchestrator P1).
 * Authority is Gateway-owned storage — not browser localStorage.
 */

import {
  createFileGuidanceMetricsStore,
  parseGuidanceMetricInput,
  recordGuidanceMetricSafe,
  type GuidanceMetricsStore,
} from "../guidance/metrics/index.js";
import {
  abandonGuidanceProgress,
  advanceGuidanceProgress,
  applyGuidanceEventToProgress,
  createFileGuidanceProgressStore,
  GuidanceProgressAuthError,
  GuidanceProgressValidationError,
  readGuidanceProgress,
  resolveAuthorizedProgressKey,
  upsertGuidanceProgress,
  type GuidanceProgressActor,
  type GuidanceProgressStore,
} from "../guidance/progress/index.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";

let storeOverride: GuidanceProgressStore | null = null;
let metricsStoreOverride: GuidanceMetricsStore | null = null;

/** Test seam — production always uses file store under CONFIG_DIR. */
export function setGuidanceProgressStoreForTests(store: GuidanceProgressStore | null): void {
  storeOverride = store;
}

export function setGuidanceMetricsStoreForTests(store: GuidanceMetricsStore | null): void {
  metricsStoreOverride = store;
}

function getStore(): GuidanceProgressStore {
  return storeOverride ?? createFileGuidanceProgressStore();
}

function getMetricsStore(): GuidanceMetricsStore {
  return metricsStoreOverride ?? createFileGuidanceMetricsStore();
}

function respondInvalid(respond: RespondFn, message: string): void {
  respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
}

function respondDenied(respond: RespondFn, message: string): void {
  respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
}

function respondUnavailable(respond: RespondFn, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, message));
}

function resolveActor(
  client:
    | {
        user?: string;
        platformUserId?: string;
        sessionEnterpriseId?: string;
        sessionTenantId?: string;
      }
    | null
    | undefined,
): GuidanceProgressActor | null {
  const userId =
    (typeof client?.user === "string" ? client.user.trim() : "") ||
    (typeof client?.platformUserId === "string" ? client.platformUserId.trim() : "");
  if (!userId) {
    return null;
  }
  const tenantId =
    (typeof client?.sessionEnterpriseId === "string" ? client.sessionEnterpriseId.trim() : "") ||
    (typeof client?.sessionTenantId === "string" ? client.sessionTenantId.trim() : "");
  return tenantId ? { userId, tenantId } : { userId };
}

function readKeyParams(params: Record<string, unknown> | undefined): {
  tenantId: string;
  userId: string;
  scope: string;
  entityId: string;
} {
  return {
    tenantId: typeof params?.tenantId === "string" ? params.tenantId : "",
    userId: typeof params?.userId === "string" ? params.userId : "",
    scope: typeof params?.scope === "string" ? params.scope : "",
    entityId: typeof params?.entityId === "string" ? params.entityId : "",
  };
}

function handleProgressError(respond: RespondFn, err: unknown): void {
  if (err instanceof GuidanceProgressAuthError) {
    respondDenied(respond, err.message);
    return;
  }
  if (err instanceof GuidanceProgressValidationError) {
    respondInvalid(respond, err.message);
    return;
  }
  respondUnavailable(respond, err);
}

export const guidanceProgressHandlers: GatewayRequestHandlers = {
  "guidance.progress.get": ({ params, client, respond }) => {
    void (async () => {
      try {
        const actor = resolveActor(client);
        const key = resolveAuthorizedProgressKey({ actor, ...readKeyParams(params) });
        const record = await readGuidanceProgress(getStore(), key);
        respond(true, { record });
      } catch (err) {
        handleProgressError(respond, err);
      }
    })();
  },

  "guidance.progress.upsert": ({ params, client, respond }) => {
    void (async () => {
      try {
        const actor = resolveActor(client);
        const key = resolveAuthorizedProgressKey({ actor, ...readKeyParams(params) });
        const record = await upsertGuidanceProgress(getStore(), key, {
          scenario: typeof params?.scenario === "string" ? params.scenario : "",
          currentStage: typeof params?.currentStage === "string" ? params.currentStage : "",
          nextActionKind: typeof params?.nextActionKind === "string" ? params.nextActionKind : "",
          nextActionLabel:
            typeof params?.nextActionLabel === "string" ? params.nextActionLabel : undefined,
          confidence: params?.confidence as "high" | "medium" | "low",
          completedSteps: Array.isArray(params?.completedSteps)
            ? params.completedSteps.filter((s): s is string => typeof s === "string")
            : undefined,
          failureCount: typeof params?.failureCount === "number" ? params.failureCount : undefined,
          status: params?.status === "completed" ? "completed" : "active",
          metadata:
            params?.metadata && typeof params.metadata === "object"
              ? (params.metadata as Record<string, unknown>)
              : undefined,
        });
        respond(true, { record });
      } catch (err) {
        handleProgressError(respond, err);
      }
    })();
  },

  "guidance.progress.advance": ({ params, client, respond }) => {
    void (async () => {
      try {
        const actor = resolveActor(client);
        const key = resolveAuthorizedProgressKey({ actor, ...readKeyParams(params) });
        const record = await advanceGuidanceProgress(getStore(), key, {
          stepId: typeof params?.stepId === "string" ? params.stepId : "",
          nextStage: typeof params?.nextStage === "string" ? params.nextStage : undefined,
          nextActionKind:
            typeof params?.nextActionKind === "string" ? params.nextActionKind : undefined,
          nextActionLabel:
            typeof params?.nextActionLabel === "string" ? params.nextActionLabel : undefined,
          confidence:
            params?.confidence === "high" ||
            params?.confidence === "medium" ||
            params?.confidence === "low"
              ? params.confidence
              : undefined,
          metadata:
            params?.metadata && typeof params.metadata === "object"
              ? (params.metadata as Record<string, unknown>)
              : undefined,
        });
        respond(true, { record });
      } catch (err) {
        handleProgressError(respond, err);
      }
    })();
  },

  "guidance.progress.abandon": ({ params, client, respond }) => {
    void (async () => {
      try {
        const actor = resolveActor(client);
        const key = resolveAuthorizedProgressKey({ actor, ...readKeyParams(params) });
        const record = await abandonGuidanceProgress(getStore(), key, {
          reason: typeof params?.reason === "string" ? params.reason : undefined,
          metadata:
            params?.metadata && typeof params.metadata === "object"
              ? (params.metadata as Record<string, unknown>)
              : undefined,
        });
        respond(true, { record });
      } catch (err) {
        handleProgressError(respond, err);
      }
    })();
  },

  /**
   * Correlate user-guidance-protocol `guidance_event` payloads into progress
   * without duplicating Growth lifecycle.
   */
  "guidance.progress.applyEvent": ({ params, client, respond }) => {
    void (async () => {
      try {
        const actor = resolveActor(client);
        const key = resolveAuthorizedProgressKey({ actor, ...readKeyParams(params) });
        const raw = params?.event && typeof params.event === "object" ? params.event : params;
        const record = await applyGuidanceEventToProgress(getStore(), key, raw);
        respond(true, { record });
      } catch (err) {
        handleProgressError(respond, err);
      }
    })();
  },

  /**
   * UX funnel metrics (P3) — distinct from asset-incubation guidance_event.
   * Fail-soft: validation/store errors return ok:false but HTTP-level success
   * so clients never block the guidance flow on metrics.
   */
  "guidance.metrics.record": ({ params, client, respond }) => {
    void (async () => {
      const actor = resolveActor(client);
      const payload =
        params && typeof params === "object"
          ? {
              ...params,
              userId:
                typeof params.userId === "string" && params.userId.trim()
                  ? params.userId
                  : (actor?.userId ?? ""),
            }
          : params;
      if (actor && typeof payload === "object" && payload) {
        const requestedUser = String((payload as { userId?: string }).userId ?? "");
        if (requestedUser && requestedUser.toLowerCase() !== actor.userId.toLowerCase()) {
          respond(true, { ok: false, message: "guidance metrics are user-isolated" });
          return;
        }
        const requestedTenant = String((payload as { tenantId?: string }).tenantId ?? "");
        if (actor.tenantId && requestedTenant && requestedTenant !== actor.tenantId) {
          respond(true, { ok: false, message: "guidance metrics are tenant-isolated" });
          return;
        }
      }
      const result = await recordGuidanceMetricSafe(
        getMetricsStore(),
        payload,
        parseGuidanceMetricInput,
      );
      // Always respond ok at transport layer — metrics must not block UX.
      respond(true, result);
    })();
  },
};
