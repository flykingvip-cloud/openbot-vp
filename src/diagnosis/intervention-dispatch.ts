/**
 * Track I / M2 — dispatch InterventionCase via existing diagnose-action-dispatch.
 * Parent group cases never dispatch; space sessionKeys stay hard-rejected.
 */
import {
  canDispatchDiagnoseAction,
  dispatchDiagnoseConversationAction,
  type DiagnoseActionDispatchRequest,
  type DiagnoseActionDispatchResult,
} from "./diagnose-action-dispatch.js";
import type { InterventionCaseStore } from "./intervention-case-store.js";
import {
  isDispatchableInterventionTarget,
  transitionInterventionCase,
  type InterventionCase,
} from "./intervention-case.js";
import { attachInterventionDaibaiCanary } from "./intervention-daibai-canary.js";

export type DispatchInterventionCaseInput = {
  case: InterventionCase;
  store: InterventionCaseStore;
  requesterUserId: string;
  tenantId: string | null;
  tenantAdmin: boolean;
  agentPrompt: string;
  receiptText?: string;
  requesterSessionKey?: string;
  now?: string;
  /** Passthrough to diagnose-action-dispatch (tests). */
  dispatch?: (req: DiagnoseActionDispatchRequest) => Promise<DiagnoseActionDispatchResult>;
  sessionExists?: (agentId: string, sessionKey: string) => boolean;
  send?: DiagnoseActionDispatchRequest["send"];
  injectReceipt?: DiagnoseActionDispatchRequest["injectReceipt"];
  /** When true, attempt daibai canary after successful dispatch (still gate-closed by default). */
  attachDaibaiCanary?: boolean;
};

export type DispatchInterventionCaseResult = {
  ok: boolean;
  reason: string;
  case: InterventionCase;
  dispatch?: DiagnoseActionDispatchResult;
};

export async function dispatchInterventionCase(
  input: DispatchInterventionCaseInput,
): Promise<DispatchInterventionCaseResult> {
  const now = input.now ?? new Date().toISOString();
  let row = input.case;

  if (!isDispatchableInterventionTarget(row.target.kind)) {
    return {
      ok: false,
      reason: row.target.kind === "group_parent" ? "parent_dispatch_forbidden" : "not_dispatchable",
      case: row,
    };
  }
  // failed/blocked retry must return to queued via expand first; only queued dispatches.
  if (row.status !== "queued") {
    return { ok: false, reason: "not_queued", case: row };
  }

  const sessionKey = row.target.sessionKey?.trim() ?? "";
  const agentId = row.target.agentId?.trim() ?? "";
  if (!sessionKey || !agentId) {
    const blocked = transitionInterventionCase(row, "blocked", {
      blockReason: "session_missing",
      updatedAt: now,
    });
    row = blocked.ok
      ? blocked.case
      : { ...row, status: "blocked", blockReason: "session_missing", updatedAt: now };
    input.store.put(row);
    return { ok: false, reason: "session_missing", case: row };
  }
  if (sessionKey.includes(":space:")) {
    const blocked = transitionInterventionCase(row, "blocked", {
      blockReason: "group_not_1to1",
      updatedAt: now,
    });
    row = blocked.ok
      ? blocked.case
      : { ...row, status: "blocked", blockReason: "group_not_1to1", updatedAt: now };
    input.store.put(row);
    return { ok: false, reason: "group_not_1to1", case: row };
  }

  if (
    !canDispatchDiagnoseAction({
      targetAgentId: agentId,
      requesterUserId: input.requesterUserId,
      tenantId: input.tenantId,
      tenantAdmin: input.tenantAdmin,
    })
  ) {
    const blocked = transitionInterventionCase(row, "blocked", {
      blockReason: "unauthorized",
      updatedAt: now,
    });
    row = blocked.ok
      ? blocked.case
      : { ...row, status: "blocked", blockReason: "unauthorized", updatedAt: now };
    input.store.put(row);
    return { ok: false, reason: "unauthorized", case: row };
  }

  const dispatching = transitionInterventionCase(row, "dispatching", { updatedAt: now });
  if (!dispatching.ok) {
    return { ok: false, reason: dispatching.reason, case: row };
  }
  row = dispatching.case;
  input.store.put(row);

  const req: DiagnoseActionDispatchRequest = {
    title: row.title,
    agentPrompt: input.agentPrompt,
    targetAgentId: agentId,
    targetSessionKey: sessionKey,
    requesterUserId: input.requesterUserId,
    tenantId: input.tenantId,
    tenantAdmin: input.tenantAdmin,
    ...(input.requesterSessionKey ? { requesterSessionKey: input.requesterSessionKey } : {}),
    ...(input.receiptText ? { receiptText: input.receiptText } : {}),
    ...(input.sessionExists ? { sessionExists: input.sessionExists } : {}),
    ...(input.send ? { send: input.send } : {}),
    ...(input.injectReceipt ? { injectReceipt: input.injectReceipt } : {}),
  };

  const dispatchFn = input.dispatch ?? dispatchDiagnoseConversationAction;
  let result: DiagnoseActionDispatchResult;
  try {
    result = await dispatchFn(req);
  } catch {
    const failed = transitionInterventionCase(row, "failed", { updatedAt: now });
    row = failed.ok ? failed.case : { ...row, status: "failed", updatedAt: now };
    input.store.put(row);
    return { ok: false, reason: "unavailable", case: row };
  }

  if (!result.ok) {
    const reason = result.reason || "failed";
    const nextStatus =
      reason === "group_not_1to1" || reason === "session_missing" || reason === "unauthorized"
        ? "blocked"
        : "failed";
    const moved = transitionInterventionCase(row, nextStatus, {
      blockReason: reason,
      updatedAt: now,
    });
    row = moved.ok
      ? moved.case
      : { ...row, status: nextStatus, blockReason: reason, updatedAt: now };
    input.store.put(row);
    return { ok: false, reason, case: row, dispatch: result };
  }

  const dispatched = transitionInterventionCase(row, "dispatched", {
    dispatch: {
      runId: result.runId,
      channel: result.channel,
      at: now,
    },
    stewardReceiptText: input.receiptText,
    updatedAt: now,
  });
  row = dispatched.ok
    ? dispatched.case
    : {
        ...row,
        status: "dispatched",
        dispatch: { runId: result.runId, channel: result.channel, at: now },
        updatedAt: now,
      };
  input.store.put(row);

  if (input.attachDaibaiCanary !== false) {
    row = await attachInterventionDaibaiCanary({ case: row, store: input.store, now });
  }

  return { ok: true, reason: "accepted", case: row, dispatch: result };
}
