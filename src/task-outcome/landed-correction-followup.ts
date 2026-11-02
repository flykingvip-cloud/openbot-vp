/**
 * After a correction version is committed, run recheck and notice.
 * Both switches stay off unless a caller passes enabled: true or the
 * module constant is changed. Follow-up failure does not roll the correction back
 * and does not rewrite taskJudgement.
 * A replayed reject command does not run this again.
 */
import type { OpenBotConfig } from "../config/config.js";
import {
  createCorrectionNoticeSessionInject,
  type CorrectionNoticeInject,
} from "./correction-notice-inject.js";
import { resolveCorrectionNoticeRecipient } from "./correction-notice-session.js";
import {
  CORRECTION_NOTIFY_ENABLED,
  deliverCorrectionNotice,
  maybeNotifyLandedCorrection,
  type CorrectionNotifyResult,
  type CorrectionNotifySend,
} from "./correction-notify.js";
import {
  RECHECK_EXECUTION_ENABLED,
  executeOriginalScenarioRecheck,
  resolveStoredRecheckScenario,
  type RecheckExecutionResult,
  type RecheckRun,
} from "./recheck-executor.js";
import { rejectTaskOutcomeResult, type RejectTaskOutcomeResult } from "./reject-result.js";
import { createStoredScenarioRecheckRun } from "./scenario-recheck-run.js";
import type { TaskOutcomeRecord } from "./types.js";

export type LandedCorrectionFollowUp = {
  notify: CorrectionNotifyResult;
  recheck: RecheckExecutionResult;
};

export type LandedCorrectionFollowUpOptions = {
  notifyEnabled?: boolean;
  recheckEnabled?: boolean;
  send?: CorrectionNotifySend;
  run?: RecheckRun;
  inject?: CorrectionNoticeInject;
  observe?: (report: LandedCorrectionFollowUp) => void;
};

function noticeFacts(record: TaskOutcomeRecord) {
  return {
    taskId: record.taskId,
    negatedOutcomeVersion: record.previousOutcomeVersion ?? 0,
    correctionOutcomeVersion: record.outcomeVersion,
    judgement: record.taskJudgement,
    revisionKind: record.revisionKind,
  };
}

async function runNotice(input: {
  cfg: OpenBotConfig;
  agentId: string;
  record: TaskOutcomeRecord;
  authenticatedPlatformUserId: string;
  callerTenantId?: string | null;
  notifyEnabled?: boolean;
  send?: CorrectionNotifySend;
  inject?: CorrectionNoticeInject;
}): Promise<CorrectionNotifyResult> {
  const facts = noticeFacts(input.record);
  const notifyOn = input.notifyEnabled ?? CORRECTION_NOTIFY_ENABLED;
  if (!notifyOn) {
    return maybeNotifyLandedCorrection({
      cfg: input.cfg,
      agentId: input.agentId,
      ...facts,
      subjectRef: input.record.scope.subjectRef,
      callerTenantId: input.callerTenantId,
      verifiedPlatformUserId: input.record.scope.subjectRef,
    });
  }
  const resolved = resolveCorrectionNoticeRecipient({
    scope: input.record.scope,
    authenticatedPlatformUserId: input.authenticatedPlatformUserId,
    callerTenantId: input.callerTenantId,
  });
  if (!resolved.ok) {
    return { ok: false, code: "recipient_unresolved" };
  }
  const send =
    input.send ??
    createCorrectionNoticeSessionInject(input.inject ? { inject: input.inject } : undefined);
  return deliverCorrectionNotice({
    enabled: true,
    cfg: input.cfg,
    agentId: input.agentId,
    ...facts,
    subjectRef: resolved.subjectRef,
    callerTenantId: input.callerTenantId,
    verifiedPlatformUserId: resolved.platformUserId,
    send,
  });
}

async function runRecheck(input: {
  cfg: OpenBotConfig;
  agentId: string;
  record: TaskOutcomeRecord;
  recheckEnabled?: boolean;
  run?: RecheckRun;
}): Promise<RecheckExecutionResult> {
  const recheckOn = input.recheckEnabled ?? RECHECK_EXECUTION_ENABLED;
  const bound = recheckOn ? resolveStoredRecheckScenario(input.record) : null;
  return executeOriginalScenarioRecheck({
    cfg: input.cfg,
    agentId: input.agentId,
    taskId: input.record.taskId,
    outcomeVersion: input.record.outcomeVersion,
    taskContractVersion: bound?.taskContractVersion,
    scenarioId: bound?.scenarioId,
    enabled: recheckOn,
    run: recheckOn
      ? (input.run ?? createStoredScenarioRecheckRun({ cfg: input.cfg, agentId: input.agentId }))
      : undefined,
  });
}

export async function orchestrateLandedCorrection(input: {
  cfg: OpenBotConfig;
  agentId: string;
  record: TaskOutcomeRecord;
  authenticatedPlatformUserId: string;
  callerTenantId?: string | null;
  notifyEnabled?: boolean;
  recheckEnabled?: boolean;
  send?: CorrectionNotifySend;
  run?: RecheckRun;
  inject?: CorrectionNoticeInject;
}): Promise<LandedCorrectionFollowUp> {
  const agentId = input.agentId.trim();
  const [notify, recheck] = await Promise.all([
    runNotice({ ...input, agentId }).catch(
      (): CorrectionNotifyResult => ({ ok: false, code: "delivery_failed" }),
    ),
    runRecheck({ ...input, agentId }).catch(
      (): RecheckExecutionResult => ({ ok: false, code: "storage_failed" }),
    ),
  ]);
  return { notify, recheck };
}

/**
 * Commit the correction, then follow up.
 * The returned value is only the reject result. Notice acceptance is not part of it.
 */
export async function rejectTaskOutcomeAndFollowUp(
  input: {
    cfg: OpenBotConfig;
    agentId: string;
    taskId: string;
    outcomeVersion: number;
    callerSubjectRaw: string;
    callerTenantId?: string | null;
    commandId?: string;
  } & LandedCorrectionFollowUpOptions,
): Promise<RejectTaskOutcomeResult> {
  const result = rejectTaskOutcomeResult({
    cfg: input.cfg,
    agentId: input.agentId,
    taskId: input.taskId,
    outcomeVersion: input.outcomeVersion,
    callerSubjectRaw: input.callerSubjectRaw,
    callerTenantId: input.callerTenantId,
    commandId: input.commandId,
  });
  if (!result.ok || result.replayed || result.record.revisionKind !== "correction") {
    return result;
  }
  try {
    const report = await orchestrateLandedCorrection({
      cfg: input.cfg,
      agentId: input.agentId,
      record: result.record,
      authenticatedPlatformUserId: input.callerSubjectRaw,
      callerTenantId: input.callerTenantId,
      notifyEnabled: input.notifyEnabled,
      recheckEnabled: input.recheckEnabled,
      send: input.send,
      run: input.run,
      inject: input.inject,
    });
    try {
      input.observe?.(report);
    } catch {
      // A test observer cannot change the committed correction.
    }
  } catch {
    // The correction is already the tip. Follow-up cannot roll it back.
  }
  return result;
}
