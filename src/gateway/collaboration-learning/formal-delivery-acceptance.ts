/**
 * Formal delivery acceptance for the current task.
 *
 * Form path: submit → return → revise → accept. Each step writes a receipt
 * and the artifact taskId must equal the current task.
 * A chat message that only says 「完成」does not change the acceptance phase.
 */

export const CHAT_COMPLETION_IS_NOT_ACCEPTANCE = "chat_completion_is_not_acceptance";

export type FormalAcceptancePhase = "none" | "submitted" | "returned" | "revised" | "accepted";

export type FormalAcceptanceAction = "submit" | "return" | "revise" | "accept";

const BARE_CHAT_COMPLETION =
  /^(?:完成|已完成|闭环完成|任务完成|任务已完成|本轮完成|本轮已完成|done|completed)[\s。.!！…]*$/iu;

/** True when the text is only a chat completion claim, not an audit rationale. */
export function isBareChatCompletionPhrase(value: string | null | undefined): boolean {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (!text) {
    return false;
  }
  return BARE_CHAT_COMPLETION.test(text);
}

export function bindArtifactToCurrentTask(params: {
  currentTaskId: string | null | undefined;
  artifactTaskId: string | null | undefined;
}):
  | { ok: true; taskId: string }
  | {
      ok: false;
      reason: "current_task_required" | "artifact_task_missing" | "artifact_task_mismatch";
    } {
  const currentTaskId = params.currentTaskId?.trim() ?? "";
  const artifactTaskId = params.artifactTaskId?.trim() ?? "";
  if (!currentTaskId) {
    return { ok: false, reason: "current_task_required" };
  }
  if (!artifactTaskId) {
    return { ok: false, reason: "artifact_task_missing" };
  }
  if (artifactTaskId !== currentTaskId) {
    return { ok: false, reason: "artifact_task_mismatch" };
  }
  return { ok: true, taskId: currentTaskId };
}

export type FormalAcceptanceReceipt = {
  phase: FormalAcceptancePhase;
  taskId: string;
  artifactTaskId: string;
  submissionId: string;
  action: FormalAcceptanceAction;
};

export type FormalAcceptanceState = {
  phase: FormalAcceptancePhase;
  taskId: string | null;
  artifactTaskId: string | null;
  openSubmissionId: string | null;
};

export function chatCompletionLeavesAcceptanceUnchanged(params: {
  chatText: string;
  state: FormalAcceptanceState;
}): {
  state: FormalAcceptanceState;
  changed: false;
  reason: typeof CHAT_COMPLETION_IS_NOT_ACCEPTANCE;
} {
  void params.chatText;
  return {
    state: params.state,
    changed: false,
    reason: CHAT_COMPLETION_IS_NOT_ACCEPTANCE,
  };
}

function unchanged(
  state: FormalAcceptanceState,
  reason: string,
): { ok: false; state: FormalAcceptanceState; reason: string } {
  return { ok: false, state, reason };
}

/**
 * Apply one formal form action. Chat completion is not an action here.
 * Accept is legal from submitted (first pass) or revised (after return).
 * Accept from returned is refused until revise writes a new submission.
 */
export function applyFormalAcceptanceForm(params: {
  state: FormalAcceptanceState;
  action: FormalAcceptanceAction;
  currentTaskId: string;
  artifactTaskId: string | null | undefined;
  submissionId: string;
  expectedSubmissionId?: string | null;
}):
  | { ok: true; state: FormalAcceptanceState; receipt: FormalAcceptanceReceipt }
  | { ok: false; state: FormalAcceptanceState; reason: string } {
  const submissionId = params.submissionId.trim();
  if (!submissionId) {
    return unchanged(params.state, "submission_id_required");
  }
  const bound = bindArtifactToCurrentTask({
    currentTaskId: params.currentTaskId,
    artifactTaskId: params.artifactTaskId,
  });
  if (!bound.ok) {
    return unchanged(params.state, bound.reason);
  }
  if (params.state.taskId && params.state.taskId !== bound.taskId) {
    return unchanged(params.state, "acceptance_task_mismatch");
  }

  const phase = params.state.phase;
  if (params.action === "submit") {
    if (phase !== "none") {
      return unchanged(params.state, "submit_requires_none");
    }
    return acceptedStep(params.state, "submitted", bound.taskId, submissionId, "submit");
  }
  if (params.action === "return") {
    if (phase !== "submitted") {
      return unchanged(params.state, "return_requires_submitted");
    }
    if (params.state.openSubmissionId !== submissionId) {
      return unchanged(params.state, "submission_version_mismatch");
    }
    return acceptedStep(params.state, "returned", bound.taskId, submissionId, "return");
  }
  if (params.action === "revise") {
    if (phase !== "returned") {
      return unchanged(params.state, "revise_requires_returned");
    }
    if (params.state.openSubmissionId === submissionId) {
      return unchanged(params.state, "revise_requires_new_submission");
    }
    return acceptedStep(params.state, "revised", bound.taskId, submissionId, "revise");
  }
  if (phase !== "submitted" && phase !== "revised") {
    return unchanged(params.state, "accept_requires_open_submission");
  }
  const expected = (params.expectedSubmissionId ?? submissionId).trim();
  if (!expected || expected !== params.state.openSubmissionId || expected !== submissionId) {
    return unchanged(params.state, "submission_version_mismatch");
  }
  return acceptedStep(params.state, "accepted", bound.taskId, submissionId, "accept");
}

function acceptedStep(
  previous: FormalAcceptanceState,
  phase: FormalAcceptancePhase,
  taskId: string,
  submissionId: string,
  action: FormalAcceptanceAction,
): { ok: true; state: FormalAcceptanceState; receipt: FormalAcceptanceReceipt } {
  const artifactTaskId = taskId;
  return {
    ok: true,
    state: {
      phase,
      taskId,
      artifactTaskId,
      openSubmissionId: phase === "accepted" ? null : submissionId,
    },
    receipt: {
      phase,
      taskId,
      artifactTaskId,
      submissionId,
      action,
    },
  };
}

/** Chat channel never moves acceptance. Form channel uses applyFormalAcceptanceForm. */
export function ingestMemberAcceptanceSignal(params: {
  channel: "chat" | "form";
  chatText?: string;
  state: FormalAcceptanceState;
  action?: FormalAcceptanceAction;
  currentTaskId?: string;
  artifactTaskId?: string | null;
  submissionId?: string;
  expectedSubmissionId?: string | null;
}):
  | { ok: false; state: FormalAcceptanceState; reason: string; changed: false }
  | { ok: true; state: FormalAcceptanceState; receipt: FormalAcceptanceReceipt; changed: true } {
  if (params.channel === "chat" || isBareChatCompletionPhrase(params.chatText)) {
    const refused = chatCompletionLeavesAcceptanceUnchanged({
      chatText: params.chatText ?? "",
      state: params.state,
    });
    return { ok: false, state: refused.state, reason: refused.reason, changed: false };
  }
  if (!params.action || !params.currentTaskId || !params.submissionId) {
    return { ok: false, state: params.state, reason: "form_fields_required", changed: false };
  }
  const applied = applyFormalAcceptanceForm({
    state: params.state,
    action: params.action,
    currentTaskId: params.currentTaskId,
    artifactTaskId: params.artifactTaskId,
    submissionId: params.submissionId,
    expectedSubmissionId: params.expectedSubmissionId,
  });
  if (!applied.ok) {
    return { ok: false, state: applied.state, reason: applied.reason, changed: false };
  }
  return { ok: true, state: applied.state, receipt: applied.receipt, changed: true };
}
