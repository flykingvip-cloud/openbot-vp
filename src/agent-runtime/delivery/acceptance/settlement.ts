import type {
  TurnCompletionInput,
  TurnCompletionSettlement,
  TurnCompletionHardStop,
} from "../../contracts/acceptance.js";
import type { EnvProbe } from "../../policy/index.js";
import {
  isSidePathLabel,
  assistantRestopsCleared,
  isMainlineBlockNarrative,
} from "../../policy/index.js";

type ResultParams = { receipt?: string; hardStopPrevented: TurnCompletionHardStop | null };
/** Fixed source-code dependencies; adapters retain storage, clocks and environment authority. */
export type SettlementPorts = {
  oguiWaitBlocksSession: (sessionKey?: string) => boolean;
  isSkillSmokeTurn: (user: string, assistant: string) => boolean;
  isPreviewOkFormalBlocked: (text: string) => boolean;
  turnCompletionApplies: (input: TurnCompletionInput) => boolean;
  sidePathReceipt: (label: string, error?: unknown) => string;
  extractNarratedPath: (text: string) => string | null;
  claimsSuccessWithoutArtifact: (text: string) => boolean;
  defaultEnvProbes: (user: string) => EnvProbe[];
  resolveSkillSmokeSlaMs: (env?: NodeJS.ProcessEnv) => number;
  now: () => number;
  isSkillBindTerminologyMisread: (assistant: string, user: string) => boolean;
  isTrueForkText: (text: string, options?: readonly string[]) => boolean;
  isLsOnlyHardStopNarrative: (text: string) => boolean;
  isSilentExecWindow: (user: string) => boolean;
  writeWorkspaceFile: (workspace: string, relative: string, body: string) => string | null;
  deliveredResult: (
    params: ResultParams & { openablePath: string; note?: string; sessionKey?: string },
  ) => TurnCompletionSettlement;
  applyTrialGate: (params: {
    trial: boolean;
    narrative: string;
    workspaceDir?: string | null;
    previewPath: string | null;
  }) => { openablePath?: string; declaration: string; action: string; reason: string } | null;
  permanentResult: (
    params: ResultParams & { reason: string; degradation: string; requiredUserAction: string },
  ) => TurnCompletionSettlement;
  firstDeliverablePath: (text: string) => string | null;
  violatesProgressProseBan: (text: string) => boolean;
  isSilentExecFishingStop: (assistant: string, user: string) => boolean;
  degradationBody: (params: { reason: string; receipt?: string }) => string;
  degradedDeliverableRelative: string;
};

export function settleTurnCompletionWithPorts(
  input: TurnCompletionInput,
  ports: SettlementPorts,
): TurnCompletionSettlement {
  const assistantText = input.assistantText ?? "";
  const userText = input.userText ?? "";
  const unchanged = (): TurnCompletionSettlement => ({
    contract: null,
    visibleText: assistantText,
    continueExecution: false,
    hardStopPrevented: null,
  });
  // E3: a valid OGUI WAIT is not rewritten to delivered or permanent_block by
  // deliverable write, trial, existing-deliverable, or SLA. Visible text stays
  // so a deliverable mention can coexist with the waiting card. Flag-off
  // callers omit the flag and leave the in-process registry empty.
  if (input.oguiWaitActive === true || ports.oguiWaitBlocksSession(input.sessionKey)) {
    return unchanged();
  }
  const trial = input.skillSmoke === true || ports.isSkillSmokeTurn(userText, assistantText);
  const trialApplies = trial && ports.isPreviewOkFormalBlocked(`${userText}\n${assistantText}`);
  if (
    !ports.turnCompletionApplies(input) &&
    !input.deliverable &&
    !input.sidePathAttempt &&
    !trialApplies
  ) {
    return unchanged();
  }

  let receipt: string | undefined;
  if (input.sidePathAttempt) {
    try {
      input.sidePathAttempt();
    } catch (err) {
      receipt = ports.sidePathReceipt(input.sidePathLabel ?? "memory/task_ledger.json", err);
    }
  } else if (isSidePathLabel(assistantText)) {
    receipt = ports.sidePathReceipt(
      ports.extractNarratedPath(assistantText) ?? "memory/task_ledger.json",
    );
  }

  const emptySuccess = ports.claimsSuccessWithoutArtifact(assistantText);
  const sideRefusal =
    isSidePathLabel(assistantText) &&
    /拒绝|无法出|不能出|不会.*(?:pdf|pptx|稿)|到此结束|写操作被拒绝/iu.test(assistantText);
  const hardStopPrevented: TurnCompletionHardStop | null = emptySuccess
    ? "empty_success"
    : sideRefusal
      ? "side_path_refusal"
      : null;

  const probes = input.envProbes ?? ports.defaultEnvProbes(userText);
  const slaMs = input.slaMs ?? ports.resolveSkillSmokeSlaMs(input.env);
  const nowMs = input.nowMs ?? ports.now();
  const smoke = input.skillSmoke === true || ports.isSkillSmokeTurn(userText, assistantText);
  const slaExpired =
    smoke && input.smokeStartedAtMs != null && nowMs - input.smokeStartedAtMs >= slaMs;
  const misread = ports.isSkillBindTerminologyMisread(assistantText, userText);
  const fork = !misread && ports.isTrueForkText(assistantText, input.forkOptions) && !slaExpired;
  const cleared = probes.some((probe) => assistantRestopsCleared(assistantText, probe));
  const lsOnly =
    ports.isLsOnlyHardStopNarrative(assistantText) &&
    (ports.isSilentExecWindow(userText) ||
      /拒绝|无法|不能|到此结束|写操作被拒绝/u.test(assistantText));

  if (input.deliverable && input.workspaceDir) {
    const written = ports.writeWorkspaceFile(
      input.workspaceDir,
      input.deliverable.relativePath,
      input.deliverable.body,
    );
    if (written) {
      return ports.deliveredResult({
        openablePath: written,
        receipt,
        note: "主线成果已落盘。",
        hardStopPrevented,
        sessionKey: input.sessionKey,
      });
    }
  }

  const trialDecision = ports.applyTrialGate({
    trial,
    narrative: `${userText}\n${assistantText}`,
    workspaceDir: input.workspaceDir,
    previewPath: ports.firstDeliverablePath(assistantText),
  });
  if (trialDecision?.openablePath) {
    return ports.deliveredResult({
      openablePath: trialDecision.openablePath,
      receipt,
      note: trialDecision.declaration,
      hardStopPrevented,
      sessionKey: input.sessionKey,
    });
  }
  if (trialDecision?.action === "permanent_block") {
    return ports.permanentResult({
      reason: trialDecision.reason,
      degradation: "unavailable",
      requiredUserAction: "确认成果目录可写后回复继续",
      receipt,
      hardStopPrevented,
    });
  }

  const existing =
    ports.firstDeliverablePath(assistantText) ??
    input.openablePaths?.find((item) => item.trim()) ??
    null;
  if (existing && !emptySuccess && !slaExpired && !misread && !sideRefusal) {
    return {
      contract: {
        state: "delivered",
        openablePath: existing,
        ...(receipt ? { sidePathReceipt: receipt } : {}),
      },
      visibleText: receipt ? `${assistantText.trim()}\n${receipt}` : assistantText,
      continueExecution: false,
      hardStopPrevented,
    };
  }

  if (fork) {
    const options =
      input.forkOptions && input.forkOptions.length >= 2
        ? [...input.forkOptions]
        : ["option_a", "option_b"];
    // formatTrueFork remains exported for structured consumers; never put the
    // bracket marker into visibleText (end-user chat).
    const speech = assistantText.trim();
    const hasGate =
      /等待你确认|等待确认后|waiting_confirmation|owner-decision|owner_decision|请扫码|请支付|二维码|验证码|授权登录/iu.test(
        speech,
      );
    const visibleText = hasGate
      ? speech
      : speech
        ? `${speech}\n\n等待你确认下一步。`
        : "等待你确认下一步。";
    return {
      contract: { state: "true_fork", options },
      visibleText,
      continueExecution: false,
      hardStopPrevented: null,
    };
  }

  const mustForce =
    slaExpired ||
    misread ||
    cleared ||
    lsOnly ||
    sideRefusal ||
    emptySuccess ||
    ports.violatesProgressProseBan(assistantText) ||
    (ports.isSilentExecWindow(userText) &&
      ports.isSilentExecFishingStop(assistantText, userText)) ||
    Boolean(input.deliverable);

  if (!mustForce && isMainlineBlockNarrative(assistantText)) {
    const degraded = input.workspaceDir
      ? ports.writeWorkspaceFile(
          input.workspaceDir,
          ports.degradedDeliverableRelative,
          ports.degradationBody({ reason: "mainline_degraded", receipt }),
        )
      : null;
    if (degraded) {
      return ports.deliveredResult({
        openablePath: degraded,
        receipt,
        hardStopPrevented,
        sessionKey: input.sessionKey,
      });
    }
    return ports.permanentResult({
      reason: "render_engine_missing",
      degradation: "unavailable",
      requiredUserAction: "提供可写成果目录或可用渲染环境后回复继续",
      receipt,
      hardStopPrevented,
    });
  }

  if (!mustForce) {
    return unchanged();
  }

  const reason = slaExpired
    ? "skill_smoke_sla"
    : emptySuccess
      ? "empty_success"
      : misread
        ? "skill_bind_terminology"
        : cleared
          ? "already_cleared"
          : "side_path_or_incomplete";
  const degraded = input.workspaceDir
    ? ports.writeWorkspaceFile(
        input.workspaceDir,
        ports.degradedDeliverableRelative,
        ports.degradationBody({ reason, receipt }),
      )
    : null;
  if (degraded) {
    return ports.deliveredResult({
      openablePath: degraded,
      receipt,
      hardStopPrevented,
      sessionKey: input.sessionKey,
    });
  }
  return ports.permanentResult({
    reason: slaExpired ? "skill_smoke_sla" : reason,
    degradation: "unavailable",
    requiredUserAction: "确认成果目录可写后回复继续",
    receipt,
    hardStopPrevented,
  });
}
