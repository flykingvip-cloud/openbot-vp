/** Optional read-only observation projection; caller identity must come from server auth. */
import type { OpenBotConfig } from "../config/config.js";
import type { createActionIntentStore } from "./action-intent-store.js";
import type { ActionIntent } from "./action-intent.js";
import { readOutcomeMetadata } from "./outcome-reader.js";
function publicIntent(intent: ActionIntent) {
  return {
    actionIntentId: intent.actionIntentId,
    revision: intent.revision,
    state: intent.state,
    createdAt: intent.createdAt,
    updatedAt: intent.updatedAt,
    target: {
      controlPlane: intent.target.controlPlane,
      targetType: intent.target.targetType,
      targetId: intent.target.targetId,
    },
    source: {
      environment: intent.evidence.environment,
      provenance: intent.evidence.provenance,
      nonProduction: intent.evidence.environment === "test",
    },
    receipts: intent.receipts.map((r) => ({
      receiptId: r.receiptId,
      status: r.status,
      at: r.at,
      actualVersion: r.actualVersion,
    })),
    readback: intent.readback
      ? { actualVersion: intent.readback.actualVersion, observedAt: intent.readback.observedAt }
      : null,
    verification: intent.verification
      ? {
          passed: intent.verification.passed,
          eligible: intent.verification.eligible,
          observedAt: intent.verification.observedAt,
        }
      : null,
  };
}
export async function queryActionIntents(
  input: {
    cfg: OpenBotConfig;
    caller: { subjectRef: string; tenantId?: string | null };
    agentId: string;
    taskId: string;
    outcomeVersion: number;
    intentId?: string;
    revision?: number;
    limit?: number;
    cursor?: string;
  },
  store: Pick<ReturnType<typeof createActionIntentStore>, "list" | "detail">,
) {
  if (
    (input.intentId !== undefined && !input.intentId.trim()) ||
    (input.revision !== undefined &&
      (!input.intentId || !Number.isSafeInteger(input.revision) || input.revision < 0)) ||
    (input.limit !== undefined &&
      (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100)) ||
    (input.cursor !== undefined && (!input.cursor || input.cursor.length > 4096)) ||
    (input.intentId && (input.cursor !== undefined || input.limit !== undefined))
  ) {
    return { ok: false as const, code: "invalid_intent_query" as const };
  }
  const authorize = () =>
    readOutcomeMetadata({
      cfg: input.cfg,
      agentId: input.agentId,
      taskId: input.taskId,
      outcomeVersion: input.outcomeVersion,
      callerSubjectRef: input.caller.subjectRef,
      callerTenantId: input.caller.tenantId,
    });
  const auth = authorize();
  if (!auth.ok) {
    return auth;
  }
  try {
    let rows: ActionIntent[];
    let nextCursor: string | null = null;
    if (input.intentId) {
      const row = await store.detail(auth.outcome.scope, input.intentId, input.revision);
      rows = row?.evidence.sampleRefs.some(
        (r) => r.taskId === input.taskId && r.outcomeVersion === input.outcomeVersion,
      )
        ? [row]
        : [];
    } else {
      const page = await store.list(auth.outcome.scope, {
        taskId: input.taskId,
        outcomeVersion: input.outcomeVersion,
        limit: input.limit,
        cursor: input.cursor,
      });
      rows = page.items;
      nextCursor = page.nextCursor;
    }
    const expectedScopeRef =
      auth.outcome.scope.kind === "enterprise"
        ? auth.outcome.scope.tenantId
        : auth.outcome.scope.personalDomainId;
    if (rows.some((row) => row.target.scopeRef !== expectedScopeRef)) {
      return { ok: false as const, code: "intent_scope_mismatch" as const };
    }
    const fresh = authorize();
    if (!fresh.ok) {
      return fresh;
    }
    if (JSON.stringify(fresh.outcome.scope) !== JSON.stringify(auth.outcome.scope)) {
      return { ok: false as const, code: "scope_changed" as const };
    }
    return {
      mode: input.intentId ? ("detail" as const) : ("summary" as const),
      detail: input.intentId && rows[0] ? structuredClone(rows[0]) : null,
      ok: true as const,
      state: rows.length ? ("present" as const) : ("unknown" as const),
      items: rows.map(publicIntent),
      nextCursor,
      reasons: rows.length ? [] : ["intent_record_unavailable"],
      readOnly: true as const,
    };
  } catch {
    return { ok: false as const, code: "intent_read_failed" as const };
  }
}
