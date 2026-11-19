/**
 * Isolation proofs for the closed-loop contract freeze.
 * Synthetic ids, temp directories, mocked inject. No production gateway.
 *
 * Each group separates (a) what the live path does today from (b) what an
 * underlying API can do when called directly. Direct correction success is
 * API capability only — user replies are not wired to it.
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildEmployeeBuiltinStewardSessionKey } from "../agents/builtin-steward/employee-isolation.js";
import { extractGoalCorrectionMutation } from "../auto-reply/reply/goal-correction-mutation.js";
import { applyInboundTaskFeedback } from "../auto-reply/reply/inbound-task-feedback.js";
import {
  createTaskContext,
  getTaskContext,
  resolveTaskContextScope,
} from "../auto-reply/reply/task-context-store.js";
import type { OpenBotConfig } from "../config/config.js";
import { resolveCronSurfaceSessionKey } from "../cron/isolated-agent/result-surfacing.js";
import type { CronJob } from "../cron/types.js";
import {
  deliverDiagnoseReportToConversation,
  resolveDiagnoseConversationTargets,
} from "../diagnosis/diagnose-daibai-inbox.js";
import type { DiagnoseGrowthAssessment } from "../diagnosis/diagnose-growth-assessment.js";
import { parseDiagnoseRequest, planDiagnosisDaibaiDelivery } from "../diagnosis/diagnose-policy.js";
import {
  DIAGNOSIS_SELF_EVOLUTION_CONFIRM_ENABLED,
  DIAGNOSIS_ZERO_FINDINGS_TEXT,
} from "../diagnosis/diagnose-professional-protocol.js";
import {
  confirmDiagnoseEvolutionPrescription,
  type EvolutionCronPort,
} from "../diagnosis/diagnose-self-evolution.js";
import { createDiagnosisIssueQueueHandlers } from "../diagnosis/diagnosis-issue-gateway.js";
import {
  runDiagnosisIssuePipeline,
  type DiagnosisIssueEvaluationRef,
} from "../diagnosis/diagnosis-issue-queue.js";
import {
  DIAGNOSIS_P24_5_LIVE_SESSION_KEY,
  DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED,
} from "../diagnosis/production-cutover.js";
import {
  deriveStructuralPreviewSources,
  readSessionIndex,
} from "../diagnosis/structural-preview-reader.js";
import { deriveInboundFeedbackSignals } from "../gateway/agent-growth/feedback-signal.js";
import { isCollabTaskClaimContractEnabled } from "../gateway/collaboration-dispatch/claim-contract.js";
import {
  getEmptyReplyGapCounterForTests,
  recordCapabilityGapEvent,
} from "../gateway/evolution-control/capability-gap-ingest.js";
import {
  isSoftObserveDhEnabled,
  setSoftObserveDhEnabledForTests,
} from "../gateway/evolution-control/soft-observe-dh-loop.js";
import {
  getEvolutionGovernanceMode,
  isEvolutionAutoRuntimeMutationEnabled,
  setEvolutionGovernanceModeForTests,
} from "../gateway/evolution-governance/mode.js";
import {
  isSkillAutoEvolutionEnabled,
  isSkillAutoEvolutionMutationAllowed,
  setSkillAutoEvolutionForTests,
} from "../gateway/evolution-governance/skill-auto-evolution.js";
import { applySupportCaseResolution, createSupportCase } from "../support-cases/store.js";
import {
  CHAT_TURN_CONTRACT_V1,
  resolveChatTurnCloseGates,
  resolveTurnTaskContract,
} from "./chat-entry.js";
import { OutcomeConsumerRuntime } from "./consumers.js";
import { ChatTaskOutcomeAdapter } from "./entrypoints/chat.js";
import { resolveExperienceVerificationPlan } from "./experience-verified-handler.js";
import { registerAwaitingDelivery } from "./pending-delivery.js";
import { TaskOutcomeResultService } from "./result-service.js";
import { recordRunnerTurnOutcome } from "./runtime-from-runner.js";
import { DurableTaskOutcomeStore } from "./store.js";
import { scopeIdOf } from "./transitions.js";
import type { TaskOutcomeRecord, TrustedScope } from "./types.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const childPath = fileURLToPath(
  new URL("./closed-loop-isolation-restart-child.ts", import.meta.url),
);

const scope: TrustedScope = {
  kind: "personal",
  personalDomainId: "personal:subject-alice",
  subjectRef: "subject:alice",
  authzScopeRef: "scope:isolation",
};

const tempDirs: string[] = [];

afterEach(() => {
  setEvolutionGovernanceModeForTests(null);
  setSkillAutoEvolutionForTests(null);
  setSoftObserveDhEnabledForTests(null);
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function rgFiles(symbol: string): string[] {
  try {
    const out = execFileSync(
      "rg",
      ["-l", "--glob", "*.ts", "--glob", "!**/*.test.ts", symbol, "src"],
      { cwd: repoRoot, encoding: "utf8" },
    );
    return out
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .toSorted((left, right) => left.localeCompare(right));
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 1) {
      return [];
    }
    throw error;
  }
}

type NegationClass =
  | "explicit_prior_artifact"
  | "other_subject"
  | "quoted_other"
  | "new_requirement"
  | "ambiguous_target"
  | "none";

/**
 * Frozen binder oracle for the first business PR. Not called by production.
 * A regex hit never authorizes mutation. A single nearby task is not a target.
 */
function classifyUserNegationCandidate(input: {
  text: string;
  candidateTaskIds: readonly string[];
  explicitTargetTaskId?: string;
}): { klass: NegationClass; targetTaskId?: string; mayMutate: false | true } {
  const text = input.text.trim();
  if (!text) {
    return { klass: "none", mayMutate: false };
  }
  const quoted =
    /[「“"][^」”"]{0,80}不对/.test(text) || /(?:他说|她说|别人说|引用|原话)/.test(text);
  if (quoted && /不对|错了|重做/.test(text)) {
    return { klass: "quoted_other", mayMutate: false };
  }
  const negation = /不对|错了|搞错|不是我要的|重做|仍未解决|没用/.test(text);
  const addition = /再加|另外|还要|新增|同时要/.test(text);
  if (addition && !negation) {
    return { klass: "new_requirement", mayMutate: false };
  }
  const artifact = /这个结果|上次|刚才|交付|成果|原任务|那份/.test(text);
  if (negation && artifact) {
    const target = input.explicitTargetTaskId?.trim();
    if (target && input.candidateTaskIds.includes(target)) {
      return { klass: "explicit_prior_artifact", targetTaskId: target, mayMutate: true };
    }
    return { klass: "ambiguous_target", mayMutate: false };
  }
  if (negation) {
    return { klass: "other_subject", mayMutate: false };
  }
  return { klass: "none", mayMutate: false };
}

function readBoundTaskEvidence(
  service: TaskOutcomeResultService,
  taskId: string,
  outcomeVersion: number | undefined,
):
  | {
      ok: true;
      judgement: TaskOutcomeRecord["taskJudgement"];
      reasonCode: TaskOutcomeRecord["reasonCode"];
      toolFailureCount: number;
      lifecycle: TaskOutcomeRecord["lifecycle"];
    }
  | {
      ok: false;
      code: "version_required" | "version_missing" | "tip_missing" | "outcome_version_changed";
      tipVersion?: number;
    } {
  if (!Number.isInteger(outcomeVersion)) {
    return { ok: false, code: "version_required" };
  }
  const version = outcomeVersion as number;
  const snap = service.getVersion(taskId, version);
  if (!snap) {
    return { ok: false, code: "version_missing" };
  }
  const tip = service.get(taskId);
  if (!tip) {
    return { ok: false, code: "tip_missing" };
  }
  if (tip.outcomeVersion !== version) {
    return { ok: false, code: "outcome_version_changed", tipVersion: tip.outcomeVersion };
  }
  const toolFailureCount = snap.attempts.reduce(
    (count, attempt) => count + (attempt.toolObservations?.filter((tool) => !tool.ok).length ?? 0),
    0,
  );
  return {
    ok: true,
    judgement: snap.taskJudgement,
    reasonCode: snap.reasonCode,
    toolFailureCount,
    lifecycle: snap.lifecycle,
  };
}

function resolveFollowUpRecipient(input: {
  subjectRef?: string;
  platformUserId?: string;
  subjectToPlatformUser?: Readonly<Record<string, string>>;
}): { ok: true; sessionKey: string } | { ok: false; code: "recipient_unresolved" } {
  const subject = input.subjectRef?.trim() ?? "";
  const mapped = subject ? input.subjectToPlatformUser?.[subject]?.trim() : "";
  if (!subject || !mapped) {
    return { ok: false, code: "recipient_unresolved" };
  }
  if (input.platformUserId?.trim() && input.platformUserId.trim() !== mapped) {
    return { ok: false, code: "recipient_unresolved" };
  }
  const sessionKey = buildEmployeeBuiltinStewardSessionKey(mapped);
  if (
    sessionKey === "agent:main:main" ||
    sessionKey === DIAGNOSIS_P24_5_LIVE_SESSION_KEY ||
    sessionKey.includes("canary")
  ) {
    return { ok: false, code: "recipient_unresolved" };
  }
  return { ok: true, sessionKey };
}

function runChild(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, ["--import", "tsx", childPath, ...args], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function readChildJson(args: string[], outFile: string): Promise<Record<string, unknown>> {
  const child = await runChild([...args, outFile]);
  const body = fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8") : "";
  expect(child.code, `${child.stderr}\n${body}`).toBe(0);
  return JSON.parse(body) as Record<string, unknown>;
}

function cronJob(overrides: Partial<CronJob> = {}): CronJob {
  return {
    id: "job-isolation",
    name: "isolation",
    enabled: true,
    createdAtMs: 1,
    updatedAtMs: 1,
    state: {},
    schedule: { kind: "cron", expr: "0 0 * * *" },
    sessionTarget: "isolated",
    wakeMode: "now",
    payload: { kind: "agentTurn", message: "noop" },
    agentId: "bot-2",
    delivery: { mode: "none" },
    ...overrides,
  };
}

function closeSuccess(chat: ChatTaskOutcomeAdapter, taskId: string) {
  const opened = chat.createOrRestore({
    taskId,
    scope,
    taskContractVersion: "1.0.0",
    commandId: `create:${taskId}`,
  });
  if (!opened.ok) {
    throw new Error(opened.message);
  }
  const fencing = opened.fencingToken;
  const attempt = chat.recordAttempt(
    taskId,
    opened.record.outcomeVersion,
    fencing,
    {
      attemptId: "a1",
      runId: "r1",
      status: "succeeded",
      observedAt: "2026-11-01T00:00:00.000Z",
      toolObservations: [{ toolName: "turn_tools", ok: false, summary: "0/1" }],
    },
    { runId: "r1", attemptIds: ["a1"], fencingToken: fencing, status: "succeeded" },
    { scope, commandId: `attempt:${taskId}` },
  );
  if (!attempt.ok) {
    throw new Error(attempt.message);
  }
  const accepted = chat.setAcceptance(
    taskId,
    attempt.record.outcomeVersion,
    fencing,
    { status: "not_required", reason: "chat_turn_contract_v1:no_external_acceptance" },
    { allowRetry: true, scope, commandId: `accept:${taskId}` },
  );
  if (!accepted.ok) {
    throw new Error(accepted.message);
  }
  const delivered = chat.setDelivery(
    taskId,
    accepted.record.outcomeVersion,
    fencing,
    { status: "delivered" },
    "delivery-1",
    { scope, commandId: `delivery:${taskId}` },
  );
  if (!delivered.ok) {
    throw new Error(delivered.message);
  }
  return { fencing, record: delivered.record };
}

describe("closed-loop isolation contract", () => {
  it("live constructors reject correction; the API appends a version and keeps history", async () => {
    const root = tempDir("cl-correct-");
    const store = new DurableTaskOutcomeStore(root);
    const live = new TaskOutcomeResultService({ store, submittedBy: "chat-entry" });
    const chat = new ChatTaskOutcomeAdapter(live);
    const closed = closeSuccess(chat, "task-closed");
    expect(closed.record.lifecycle).toBe("closed");
    expect(closed.record.taskJudgement).toBe("success");
    expect(closed.record.attempts[0]?.toolObservations?.[0]?.ok).toBe(false);

    const ordinary = chat.setAcceptance(
      "task-closed",
      closed.record.outcomeVersion,
      closed.fencing,
      { status: "failed" },
      { allowRetry: true, scope },
    );
    expect(ordinary.ok).toBe(false);
    if (!ordinary.ok) {
      expect(ordinary.code).toBe("terminal_protected");
    }

    const denied = live.submit(
      "task-closed",
      {
        type: "correction",
        expectedVersion: closed.record.outcomeVersion,
        previousOutcomeVersion: closed.record.outcomeVersion,
        authorizedBy: scope.subjectRef,
        revisionReason: "用户否定该次交付",
        acceptance: { status: "failed" },
        delivery: { status: "delivered" },
      },
      { requiredScope: scope, callerSubjectRef: scope.subjectRef },
    );
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.code).toBe("unauthorized_correction");
    }
    expect(live.get("task-closed")?.outcomeVersion).toBe(closed.record.outcomeVersion);

    const api = new TaskOutcomeResultService({
      store,
      correctionAllowlist: [scope.subjectRef],
      submittedBy: "isolation-api",
    });
    const stranger = api.submit(
      "task-closed",
      {
        type: "correction",
        expectedVersion: closed.record.outcomeVersion,
        previousOutcomeVersion: closed.record.outcomeVersion,
        authorizedBy: "subject:mallory",
        revisionReason: "冒充",
        acceptance: { status: "failed" },
        delivery: { status: "delivered" },
      },
      { requiredScope: scope, callerSubjectRef: "subject:mallory" },
    );
    expect(stranger.ok).toBe(false);

    const mismatchedCaller = api.submit(
      "task-closed",
      {
        type: "correction",
        expectedVersion: closed.record.outcomeVersion,
        previousOutcomeVersion: closed.record.outcomeVersion,
        authorizedBy: scope.subjectRef,
        revisionReason: "caller 不一致",
        acceptance: { status: "failed" },
        delivery: { status: "delivered" },
      },
      { requiredScope: scope, callerSubjectRef: "subject:mallory" },
    );
    expect(mismatchedCaller.ok).toBe(false);

    const otherSubject: TrustedScope = { ...scope, subjectRef: "subject:bob" };
    const scopeDenied = api.submit(
      "task-closed",
      {
        type: "correction",
        expectedVersion: closed.record.outcomeVersion,
        previousOutcomeVersion: closed.record.outcomeVersion,
        authorizedBy: scope.subjectRef,
        revisionReason: "跨主体",
        acceptance: { status: "failed" },
        delivery: { status: "delivered" },
      },
      { requiredScope: otherSubject, callerSubjectRef: scope.subjectRef },
    );
    expect(scopeDenied.ok).toBe(false);
    if (!scopeDenied.ok) {
      expect(scopeDenied.code).toBe("scope_mismatch");
    }

    const corrected = api.submit(
      "task-closed",
      {
        type: "correction",
        expectedVersion: closed.record.outcomeVersion,
        previousOutcomeVersion: closed.record.outcomeVersion,
        authorizedBy: scope.subjectRef,
        revisionReason: "用户否定该次交付",
        acceptance: { status: "failed" },
        delivery: { status: "delivered" },
      },
      {
        requiredScope: scope,
        callerSubjectRef: scope.subjectRef,
        commandId: "cmd-correct-1",
      },
    );
    expect(corrected.ok).toBe(true);
    if (!corrected.ok) {
      return;
    }
    expect(corrected.record.outcomeVersion).toBe(closed.record.outcomeVersion + 1);
    expect(corrected.record.revisionKind).toBe("correction");
    expect(corrected.record.lifecycle).toBe("closed");
    expect(corrected.record.taskJudgement).toBe("failure");
    expect(corrected.record.reasonCode).toBe("correction");
    expect(corrected.record.attempts).toHaveLength(1);
    expect(corrected.createdEvents[0]?.eventType).toBe("task.corrected");
    expect(corrected.record.lifecycle).not.toBe("active");
    const prior = api.getVersion("task-closed", closed.record.outcomeVersion);
    expect(prior?.taskJudgement).toBe("success");
    expect(prior?.attempts[0]?.toolObservations?.[0]?.ok).toBe(false);
    const consumer = new OutcomeConsumerRuntime(store);
    const drained = await consumer.drain((taskId) => live.get(taskId));
    expect(drained.deferred).toBe(0);
    expect(consumer.getProjection().successCount).toBe(0);
    expect(consumer.getProjection().failureCount).toBe(1);
    const applied = consumer.getProjection().applied.find((row) => row.taskId === "task-closed");
    expect(applied).toMatchObject({
      outcomeVersion: corrected.record.outcomeVersion,
      judgement: "failure",
    });

    const replay = api.submit(
      "task-closed",
      {
        type: "correction",
        expectedVersion: closed.record.outcomeVersion,
        previousOutcomeVersion: closed.record.outcomeVersion,
        authorizedBy: scope.subjectRef,
        revisionReason: "用户否定该次交付",
        acceptance: { status: "failed" },
        delivery: { status: "delivered" },
      },
      {
        requiredScope: scope,
        callerSubjectRef: scope.subjectRef,
        commandId: "cmd-correct-1",
      },
    );
    expect(replay.ok).toBe(true);
    if (replay.ok) {
      expect(replay.record.outcomeVersion).toBe(corrected.record.outcomeVersion);
      expect(replay.createdEvents).toEqual([]);
    }

    const pending = api.submit(
      "task-closed",
      {
        type: "correction",
        expectedVersion: corrected.record.outcomeVersion,
        previousOutcomeVersion: corrected.record.outcomeVersion,
        authorizedBy: scope.subjectRef,
        revisionReason: "改回待验收，不新开执行",
        acceptance: { status: "pending" },
        delivery: { status: "delivered" },
      },
      { requiredScope: scope, callerSubjectRef: scope.subjectRef, commandId: "cmd-correct-2" },
    );
    expect(pending.ok).toBe(true);
    if (pending.ok) {
      expect(pending.record.lifecycle).toBe("awaiting_acceptance");
      expect(pending.record.taskJudgement).toBe("incomplete");
      expect(pending.record.attempts).toHaveLength(1);
      expect(pending.record.decisiveRunId).toBe("r1");
    }
    store.close();
  });

  it("production source has no correction allowlist and no feedback writeback", () => {
    expect(rgFiles("correctionAllowlist")).toEqual([
      "src/task-outcome/reject-result.ts",
      "src/task-outcome/result-service.ts",
    ]);
    expect(rgFiles("recordInboundFeedback")).toEqual([
      "src/gateway/agent-growth/record-feedback.ts",
    ]);
    expect(rgFiles("deriveInboundFeedbackSignals")).toEqual([
      "src/gateway/agent-growth/feedback-signal.ts",
      "src/gateway/agent-growth/record-feedback.ts",
    ]);
    expect(rgFiles("applyGoalCorrectionMutation")).toEqual([
      "src/auto-reply/reply/goal-correction-mutation.ts",
      "src/auto-reply/reply/inbound-task-feedback.ts",
    ]);
    expect(rgFiles("applyInboundTaskFeedback")).toContain("src/auto-reply/reply/get-reply-run.ts");
    expect(rgFiles("attachAdoptedLearningAssetsToTask")).toEqual([
      "src/task-outcome/index.ts",
      "src/task-outcome/learning-adoption.ts",
    ]);
    const taskOutcomeImporters = [
      ...rgFiles('from "../task-outcome/'),
      ...rgFiles('from "../../task-outcome/'),
    ].toSorted((left, right) => left.localeCompare(right));
    expect(taskOutcomeImporters.filter((file) => file.startsWith("src/diagnosis/"))).toEqual([
      "src/diagnosis/report-query-gateway.ts",
      "src/diagnosis/task-outcome-evidence.ts",
    ]);
    // Keep the importer inventory exact after the runtime and evidence split;
    // the diagnosis-only boundary above remains independently constrained.
    expect(taskOutcomeImporters).toEqual(
      [
        "src/agent-runtime/command/command-outcome-entry.ts",
        "src/agent-runtime/wiring/admitted-turn-host.ts",
        "src/agent-runtime/wiring/delivery-confirm.ts",
        "src/agent-runtime/wiring/reply-turn.ts",
        "src/agents/pi-embedded-subscribe.handlers.tools.ts",
        "src/agents/subagent-spawn.ts",
        "src/auto-reply/reply/agent-runner.ts",
        "src/auto-reply/reply/dispatch-from-config.ts",
        "src/auto-reply/reply/followup-runner.ts",
        "src/auto-reply/reply/inbound-task-feedback.ts",
        "src/commands/agent.ts",
        "src/cron/isolated-agent/run.ts",
        "src/cron/service/timer.ts",
        "src/diagnosis/report-query-gateway.ts",
        "src/diagnosis/task-outcome-evidence.ts",
        "src/executor-evidence/association.ts",
        "src/executor-evidence/command-race-child.ts",
        "src/executor-evidence/governed-model-entry.ts",
        "src/executor-evidence/identity.ts",
        "src/executor-evidence/model-call-evidence.ts",
        "src/executor-evidence/read-port.ts",
        "src/gateway/agent-growth/operational-metrics-store.ts",
        "src/gateway/collaboration-learning/claim-contract-entry.ts",
        "src/gateway/server-chat.ts",
        "src/gateway/server-methods/chat.ts",
        "src/gateway/server-methods/task-outcome-reject.ts",
        "src/gateway/server.impl.ts",
        "src/gateway/supervisor/engine.ts",
        "src/observation/action-intent-association-recovery.ts",
        "src/observation/action-intent-recovery.ts",
        "src/observation/action-intent-store.ts",
        "src/observation/cohort-identity.ts",
        "src/observation/execution-evidence-store.ts",
        "src/observation/execution-journal-runtime.ts",
        "src/observation/execution-journal.ts",
        "src/observation/execution-projection.ts",
        "src/observation/executor-technical-evidence.ts",
        "src/observation/metric-compare-gateway.ts",
        "src/observation/outcome-reader.ts",
        "src/observation/platform-task-index.ts",
        "src/observation/platform-window-snapshot.ts",
        "src/observation/query-gateway.ts",
        "src/observation/query.ts",
        "src/observation/run-cost-collector.ts",
        "src/observation/run-cost-evidence.ts",
        "src/observation/runtime-evidence.ts",
        "src/observation/sample-assembler.ts",
      ].toSorted((left, right) => left.localeCompare(right)),
    );
  });

  it("feedback regex and goal mutation do not correct the named TaskOutcome", async () => {
    expect(
      classifyUserNegationCandidate({
        text: "上次的交付不对",
        candidateTaskIds: ["task-a"],
        explicitTargetTaskId: "task-a",
      }),
    ).toEqual({ klass: "explicit_prior_artifact", targetTaskId: "task-a", mayMutate: true });
    expect(
      classifyUserNegationCandidate({
        text: "上次的交付不对",
        candidateTaskIds: ["task-a"],
      }).klass,
    ).toBe("ambiguous_target");
    expect(
      classifyUserNegationCandidate({
        text: "上次的交付不对",
        candidateTaskIds: ["task-a", "task-b"],
      }).mayMutate,
    ).toBe(false);
    expect(
      classifyUserNegationCandidate({ text: "他说「不对」", candidateTaskIds: ["task-a"] }).klass,
    ).toBe("quoted_other");
    expect(
      classifyUserNegationCandidate({ text: "今天天气不对", candidateTaskIds: ["task-a"] }).klass,
    ).toBe("other_subject");
    expect(
      classifyUserNegationCandidate({ text: "请再加一个导出", candidateTaskIds: ["task-a"] }),
    ).toEqual({
      klass: "new_requirement",
      mayMutate: false,
    });

    expect(deriveInboundFeedbackSignals("他说「不对」").sentiment).toBe("negative");
    expect(deriveInboundFeedbackSignals("请再加一个导出").sentiment).toBeUndefined();
    expect(extractGoalCorrectionMutation("他说「不对，重做一遍这个结果」")).not.toBeNull();
    expect(extractGoalCorrectionMutation("今天天气不对啊")).not.toBeNull();
    expect(extractGoalCorrectionMutation("请再加一个导出")).toBeNull();

    const root = tempDir("cl-feedback-");
    const store = new DurableTaskOutcomeStore(root);
    const service = new TaskOutcomeResultService({
      store,
      correctionAllowlist: [scope.subjectRef],
    });
    const chat = new ChatTaskOutcomeAdapter(service);
    const closed = closeSuccess(chat, "task-a");
    const before = closed.record.outcomeVersion;

    const workspace = tempDir("cl-goal-");
    fs.mkdirSync(path.join(workspace, "memory"), { recursive: true });
    const cfg = {} as OpenBotConfig;
    const contextScope = resolveTaskContextScope({
      cfg,
      workspaceDir: workspace,
      agentId: "bot-isolation",
      sessionKey: "agent:bot-isolation:main",
    });
    const bound = await createTaskContext({
      scope: contextScope,
      title: "原目标",
      description: "原来的交付说明",
    });
    const other = await createTaskContext({
      scope: contextScope,
      title: "另一项",
      description: "不该被改",
    });
    const quoted = await applyInboundTaskFeedback({
      cfg,
      workspaceDir: workspace,
      agentId: "bot-isolation",
      sessionKey: "agent:bot-isolation:main",
      sessionEntry: { sessionId: "s1", updatedAt: 1, taskContextId: bound.id },
      text: "他说「不对，重做一遍这个结果」",
      sourceMessageId: "m-quote",
    });
    expect(quoted.workspace).toBe("skipped");
    expect(quoted.disposition).toEqual({ kind: "ignore", reason: "quoted" });
    expect(service.get("task-a")?.outcomeVersion).toBe(before);
    expect(service.get("task-a")?.taskJudgement).toBe("success");
    expect((await getTaskContext(contextScope, bound.id))?.description).toBe("原来的交付说明");
    expect((await getTaskContext(contextScope, other.id))?.description).toBe("不该被改");

    const unbound = await applyInboundTaskFeedback({
      cfg,
      workspaceDir: workspace,
      agentId: "bot-isolation",
      sessionKey: "agent:bot-isolation:other",
      text: "上次的交付不对，应该是要让结果通过验收",
      sourceMessageId: "m-unbound",
    });
    expect(unbound.workspace).toBe("skipped");
    expect(unbound.clarify).toContain("结果不符合要求");
    expect(service.get("task-a")?.taskJudgement).toBe("success");
    store.close();
  });

  it("runner success with a failed tool stays success; diagnosis jsonl does not see the tip", async () => {
    const agentDir = tempDir("cl-runner-");
    const cfg = { agents: { list: [{ id: "bot", agentDir }] } } as unknown as OpenBotConfig;
    const taskId = "chat:bot:sess:run-tool-fail";
    const out = await recordRunnerTurnOutcome(cfg, "bot", {
      success: true,
      runId: "run-tool-fail",
      taskId,
      toolsTotal: 2,
      toolsSucceeded: 1,
      scope,
      acceptance: {
        status: "not_required",
        reason: "chat_turn_contract_v1:no_external_acceptance",
      },
      delivery: { status: "delivered" },
      deliveryId: "delivery:run-tool-fail",
    });
    expect(out.record.taskJudgement).toBe("success");
    expect(out.record.attempts.at(-1)?.toolObservations?.[0]?.ok).toBe(false);
    expect(out.record.reasonCode).toBe("accepted_and_delivered");

    const store = new DurableTaskOutcomeStore(path.join(agentDir, "task-outcomes"));
    const service = new TaskOutcomeResultService({ store });
    const bound = readBoundTaskEvidence(service, taskId, out.record.outcomeVersion);
    expect(bound.ok).toBe(true);
    if (bound.ok) {
      expect(bound.judgement).toBe("success");
      expect(bound.toolFailureCount).toBeGreaterThan(0);
      expect(bound.reasonCode).not.toContain("tool");
    }
    const api = new TaskOutcomeResultService({
      store,
      correctionAllowlist: [scope.subjectRef],
    });
    const corrected = api.submit(
      taskId,
      {
        type: "correction",
        expectedVersion: out.record.outcomeVersion,
        previousOutcomeVersion: out.record.outcomeVersion,
        authorizedBy: scope.subjectRef,
        revisionReason: "补记否定",
        acceptance: { status: "failed" },
        delivery: { status: "delivered" },
      },
      { requiredScope: scope, callerSubjectRef: scope.subjectRef },
    );
    expect(corrected.ok).toBe(true);
    const stale = readBoundTaskEvidence(service, taskId, out.record.outcomeVersion);
    expect(stale).toMatchObject({ ok: false, code: "outcome_version_changed" });
    const unbound = readBoundTaskEvidence(service, taskId, undefined);
    expect(unbound.ok).toBe(false);
    if (!unbound.ok) {
      expect(unbound.code).toBe("version_required");
    }

    const now = Date.now();
    const failedPreview = deriveStructuralPreviewSources({
      agentId: "bot",
      tenantId: "tenant-a",
      windowStartMs: now - 1_000,
      windowEndMs: now + 1_000,
      taskOutcomes: [
        {
          agentId: "bot",
          tenantId: "tenant-a",
          occurredAt: now,
          succeeded: false,
          outcome: "completed",
          observationEligibility: "eligible",
          runId: "run-tool-fail",
          taskId,
        },
      ],
      sessions: [],
      skillEvents: [],
      baseline: null,
    });
    expect(failedPreview.hadTaskActivity).toBe(false);
    const absent = deriveStructuralPreviewSources({
      agentId: "bot",
      tenantId: "tenant-a",
      windowStartMs: now - 1_000,
      windowEndMs: now + 1_000,
      taskOutcomes: [],
      sessions: [],
      skillEvents: [],
      baseline: null,
    });
    expect(absent.hadTaskActivity).toBe(false);
    const sessionFile = path.join(agentDir, "sessions.json");
    fs.writeFileSync(sessionFile, "{", "utf8");
    expect(readSessionIndex(sessionFile)).toEqual([]);
    expect(DIAGNOSIS_ZERO_FINDINGS_TEXT).toContain("不代表系统正常");
    store.close();
  });

  it("acceptance not_required is a contract waiver, not a human approval", () => {
    const waived = resolveChatTurnCloseGates({
      deliveryId: "d1",
      contract: resolveTurnTaskContract({
        explicitChatTurn: true,
        contractId: CHAT_TURN_CONTRACT_V1,
      }),
      deliveryPhase: "delivered",
    });
    expect(waived.acceptance).toEqual({
      status: "not_required",
      reason: `${CHAT_TURN_CONTRACT_V1}:no_external_acceptance`,
    });
    const unknown = resolveChatTurnCloseGates({
      deliveryId: "d2",
      contract: resolveTurnTaskContract({}),
      deliveryPhase: "awaiting",
    });
    expect(unknown.acceptance).toEqual({ status: "pending" });
    const technical = resolveChatTurnCloseGates({
      deliveryId: "d3",
      contract: resolveTurnTaskContract({ validatorsRequired: true, acceptanceVerified: true }),
      deliveryPhase: "delivered",
      acceptanceVerified: true,
    });
    expect(technical.acceptance).toEqual({ status: "passed" });
  });

  it("inject acceptance does not move the original task or reuse pending-delivery", async () => {
    const root = tempDir("cl-notify-");
    const store = new DurableTaskOutcomeStore(root);
    const chat = new ChatTaskOutcomeAdapter(new TaskOutcomeResultService({ store }));
    const closed = closeSuccess(chat, "task-notify");
    const before = structuredClone(closed.record);
    registerAwaitingDelivery({
      taskId: "task-notify",
      deliveryId: "delivery-original",
      agentId: "bot",
      runId: "run-original",
      persistRoot: root,
    });

    const planned = planDiagnosisDaibaiDelivery({ enterpriseAdmin: false, owners: true });
    expect(planned).toMatchObject({ delivered: false, reason: "daibai_delivery_gate_closed" });

    const request = parseDiagnoseRequest({
      deliverTo: { owners: true },
      agentId: "bot",
      sessionKey: "agent:bot:main",
    });
    const sends: string[] = [];
    const accepted = await deliverDiagnoseReportToConversation({
      request,
      reportText: "跟进：原任务结果已被否定",
      tenantId: "tenant-a",
      send: async ({ sessionKey }) => {
        sends.push(sessionKey);
        return "accepted";
      },
      resolveOwners: () => [
        {
          userId: "platform-alice",
          route: "employee",
          sessionKey: buildEmployeeBuiltinStewardSessionKey("platform-alice"),
        },
      ],
    });
    expect(accepted.delivered).toBe(true);
    expect(accepted.reason).toBe("conversation_accepted");
    expect(store.loadTask("task-notify")).toEqual(before);

    const failed = await deliverDiagnoseReportToConversation({
      request,
      reportText: "跟进失败",
      tenantId: "tenant-a",
      send: async () => "unavailable",
      resolveOwners: () => [
        {
          userId: "platform-alice",
          route: "employee",
          sessionKey: buildEmployeeBuiltinStewardSessionKey("platform-alice"),
        },
      ],
    });
    expect(failed.delivered).toBe(false);
    expect(failed.reason).toBe("conversation_unavailable");
    expect(store.loadTask("task-notify")?.lifecycle).toBe("closed");
    expect(store.loadTask("task-notify")?.taskJudgement).toBe("success");
    expect(store.loadTask("task-notify")?.delivery.status).toBe("delivered");

    const noOwner = await deliverDiagnoseReportToConversation({
      request,
      reportText: "无人",
      tenantId: "tenant-a",
      send: async () => "accepted",
      resolveOwners: () => [],
    });
    expect(noOwner.reason).toBe("conversation_unavailable");
    expect(sends).toEqual([buildEmployeeBuiltinStewardSessionKey("platform-alice")]);

    const again = await deliverDiagnoseReportToConversation({
      request,
      reportText: "跟进：原任务结果已被否定",
      tenantId: "tenant-a",
      send: async ({ sessionKey }) => {
        sends.push(sessionKey);
        return "accepted";
      },
      resolveOwners: () => [
        {
          userId: "platform-alice",
          route: "employee",
          sessionKey: buildEmployeeBuiltinStewardSessionKey("platform-alice"),
        },
      ],
    });
    expect(again.reason).toBe("conversation_accepted");
    expect(sends).toHaveLength(2);
    expect(store.loadTask("task-notify")?.outcomeVersion).toBe(before.outcomeVersion);

    const child = await readChildJson(
      ["pending", root, "task-notify"],
      path.join(root, "pending-out.json"),
    );
    expect(child).toMatchObject({
      ok: true,
      taskId: "task-notify",
      deliveryId: "delivery-original",
    });
    expect(buildEmployeeBuiltinStewardSessionKey(scope.subjectRef)).not.toBe(
      buildEmployeeBuiltinStewardSessionKey("platform-alice"),
    );
    expect(
      resolveFollowUpRecipient({
        subjectRef: scope.subjectRef,
        platformUserId: "platform-bob",
        subjectToPlatformUser: { "subject:alice": "platform-alice" },
      }).ok,
    ).toBe(false);
    expect(
      resolveFollowUpRecipient({
        subjectRef: scope.subjectRef,
        platformUserId: "platform-alice",
        subjectToPlatformUser: { "subject:alice": "platform-alice" },
      }),
    ).toEqual({
      ok: true,
      sessionKey: buildEmployeeBuiltinStewardSessionKey("platform-alice"),
    });
    expect(resolveFollowUpRecipient({ subjectRef: scope.subjectRef }).ok).toBe(false);

    const cfg = { session: { mainKey: "main" } } as OpenBotConfig;
    expect(
      resolveCronSurfaceSessionKey({
        cfg,
        job: cronJob(),
        agentId: "main",
        surface: "workbench-agent-main",
      }),
    ).toBe("agent:main:main");
    expect(
      resolveCronSurfaceSessionKey({
        cfg,
        job: cronJob({ ownership: { ownerId: "platform-alice" } }),
        agentId: "bot-2",
        surface: "workbench-agent-main",
      }),
    ).toBe("agent:bot-2:main");
    expect(resolveDiagnoseConversationTargets({ request, tenantId: "tenant-a" })).toEqual([]);
    store.close();
  });

  it("restarts an independent process for outbox retry, ack loss, and gap counters", async () => {
    const root = tempDir("cl-restart-");
    const store = new DurableTaskOutcomeStore(root);
    const chat = new ChatTaskOutcomeAdapter(new TaskOutcomeResultService({ store }));
    closeSuccess(chat, "task-restart");
    store.close();

    const failFile = path.join(root, "fail.json");
    const failed = await readChildJson(["fail-once", root], failFile);
    expect(failed.deferred).toBeGreaterThan(0);
    expect(failed.pending).toBeGreaterThan(0);

    const counter = path.join(root, "side-effects.txt");
    const first = await readChildJson(
      ["drain", root, path.join(root, "drain-1.json"), counter],
      path.join(root, "drain-1.json"),
    );
    expect(first).toMatchObject({ ok: true, successCount: 1, pending: 0, sideEffects: 4 });
    const second = await readChildJson(
      ["drain", root, path.join(root, "drain-2.json"), counter],
      path.join(root, "drain-2.json"),
    );
    expect(second).toMatchObject({ ok: true, successCount: 1, pending: 0, sideEffects: 4 });

    const ackRoot = tempDir("cl-ack-");
    const ackStore = new DurableTaskOutcomeStore(ackRoot);
    const ackChat = new ChatTaskOutcomeAdapter(new TaskOutcomeResultService({ store: ackStore }));
    const ackClosed = closeSuccess(ackChat, "task-ack");
    const runtime = new OutcomeConsumerRuntime(ackStore);
    const event = ackStore
      .listPendingOutbox()
      .find((row) => row.taskId === "task-ack" && row.eventType === "task.closed");
    expect(event?.outcomeVersion).toBe(ackClosed.record.outcomeVersion);
    if (!event) {
      throw new Error("missing outbox");
    }
    runtime.applyContribution("growth-evolution", event, ackClosed.record);
    expect(ackStore.hasConsumed("growth-evolution", event.eventId)).toBe(false);
    ackStore.close();
    const ackChild = await readChildJson(["drain", ackRoot], path.join(ackRoot, "ack.json"));
    expect(ackChild).toMatchObject({ ok: true, successCount: 1 });

    const parentGap = recordCapabilityGapEvent({
      category: "skill",
      reason: "direct_chat_silent_or_empty_reply",
      sourceKind: "empty_reply",
      tenantId: "tenant-isolation",
      agentId: "bot-isolation",
      sessionKey: "sess-isolation",
      explicitMarker: false,
    });
    expect(parentGap.metricOnly).toBe(true);
    expect(parentGap.proposalId).toBeNull();
    const parentCount = getEmptyReplyGapCounterForTests();
    const gapChild = await readChildJson(["gap-empty"], path.join(root, "gap.json"));
    expect(gapChild).toMatchObject({ ok: true, counter: 1, proposalId: null, deduped: false });
    expect(getEmptyReplyGapCounterForTests()).toBe(parentCount);
  });

  it("two processes cannot both commit the same version", async () => {
    const root = tempDir("cl-race-");
    const store = new DurableTaskOutcomeStore(root);
    const chat = new ChatTaskOutcomeAdapter(new TaskOutcomeResultService({ store }));
    const opened = chat.createOrRestore({
      taskId: "task-race",
      scope,
      taskContractVersion: "1.0.0",
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) {
      return;
    }
    store.close();
    const outA = path.join(root, "a.json");
    const outB = path.join(root, "b.json");
    const [a, b] = await Promise.all([
      readChildJson(["accept", root, "task-race", "1", opened.fencingToken, "cmd-a"], outA),
      readChildJson(["accept", root, "task-race", "1", opened.fencingToken, "cmd-b"], outB),
    ]);
    const codes = [String(a.code), String(b.code)].toSorted((left, right) =>
      left.localeCompare(right),
    );
    expect(codes).toEqual(["ok", "version_conflict"]);
    const reopened = new DurableTaskOutcomeStore(root);
    expect(reopened.loadTask("task-race")?.outcomeVersion).toBe(2);
    expect(reopened.loadTaskVersion("task-race", 1)?.lifecycle).not.toBe("closed");
    reopened.close();
  });

  it("keeps issue, support, adoption, and claim boundaries closed", async () => {
    expect(DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED).toBe(false);
    expect(DIAGNOSIS_SELF_EVOLUTION_CONFIRM_ENABLED).toBe(true);
    expect(
      isCollabTaskClaimContractEnabled({} as OpenBotConfig, "group-isolation", "tenant-a"),
    ).toBe(false);
    delete process.env.OPENBOT_EVOLUTION_GOVERNANCE_MODE;
    delete process.env.OPENBOT_SKILL_AUTO_EVOLUTION;
    setEvolutionGovernanceModeForTests(null);
    setSkillAutoEvolutionForTests(null);
    setSoftObserveDhEnabledForTests(null);
    expect(getEvolutionGovernanceMode()).toBe("assist");
    expect(isEvolutionAutoRuntimeMutationEnabled()).toBe(false);
    expect(isSkillAutoEvolutionEnabled()).toBe(false);
    expect(isSkillAutoEvolutionMutationAllowed()).toBe(false);
    expect(isSoftObserveDhEnabled()).toBe(true);

    const root = tempDir("cl-boundary-");
    const store = new DurableTaskOutcomeStore(root);
    const chat = new ChatTaskOutcomeAdapter(new TaskOutcomeResultService({ store }));
    const closed = closeSuccess(chat, "task-boundary");
    const version = closed.record.outcomeVersion;

    const handlers = createDiagnosisIssueQueueHandlers(
      { resolveMembership: async () => ({ tenantId: "tenant-a", userId: "employee-9" }) },
      { configDir: tempDir("cl-issue-") },
    );
    const advance = handlers["diagnosis.issues.advance"];
    for (const action of ["confirm", "prescribe", "apply", "recheck", "writeback"]) {
      let body: Record<string, unknown> | undefined;
      await advance({
        req: { type: "req", id: action, method: "diagnosis.issues.advance" } as never,
        params: { action, enabled: true, issueId: "iss-x" },
        client: {
          user: "employee-9@example.com",
          platformUserId: "employee-9",
          sessionDomain: "enterprise",
          sessionKind: "member",
        } as never,
        isWebchatConnect: () => false,
        respond: (_ok, payload) => {
          body = payload as Record<string, unknown>;
        },
        context: {} as never,
      });
      expect(body).toMatchObject({ ok: false, reason: "confirm_not_enabled", enabled: true });
    }
    expect(store.loadTask("task-boundary")?.outcomeVersion).toBe(version);

    const supportEnv = { ...process.env, OPENBOT_STATE_DIR: tempDir("cl-support-") };
    const supportCase = await createSupportCase({
      userId: "platform-alice",
      tenantId: "tenant-a",
      userProblem: "结果不对",
      contextBundle: { userMessage: "结果不对" },
      env: supportEnv,
    });
    const closedCase = await applySupportCaseResolution({
      caseId: supportCase.caseId,
      env: supportEnv,
    });
    expect(closedCase?.status).toBe("closed");
    expect(store.loadTask("task-boundary")?.taskJudgement).toBe("success");

    const exposed = closeSuccess(chat, "task-exposed");
    const withExposure: TaskOutcomeRecord = {
      ...exposed.record,
      experienceExposure: {
        scopes: [{ scopeId: scopeIdOf(scope), botId: "bot", assetIds: ["asset-1"] }],
        attachedAt: exposed.record.updatedAt,
      },
    };
    expect(resolveExperienceVerificationPlan(withExposure).reason).toBe(
      "exposure_on_success_not_verified",
    );
    expect(resolveExperienceVerificationPlan(withExposure).shouldVerify).toBe(false);

    const dir = tempDir("cl-cron-");
    const jobs: Array<{ id: string; name: string; ownerId?: string; deliver?: string }> = [];
    const cron: EvolutionCronPort = {
      async list() {
        return jobs.map((job) => ({ id: job.id, name: job.name, ownerId: job.ownerId }));
      },
      async add(job) {
        const created = {
          id: `job-${jobs.length + 1}`,
          name: job.name,
          ownerId: job.ownership?.ownerId,
          deliver: job.delivery?.mode,
        };
        jobs.push(created);
        return { id: created.id };
      },
    };
    const pipeline = await runDiagnosisIssuePipeline({
      tenantId: "tenant-a",
      configDir: dir,
      evaluations: [
        {
          tenantId: "tenant-a",
          conversationId: "conv-1",
          eventId: "evt-iso",
          agentId: "bot-2",
          failureAttribution: "tool",
          correctness: "fail",
          usability: "degraded",
        } satisfies DiagnosisIssueEvaluationRef,
      ],
      assessment: gapAssessment(),
      professionalReportId: "pdr-iso",
      callerUserId: "employee-9",
      cron,
      enabled: true,
    });
    expect(pipeline.ok).toBe(true);
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs.every((job) => job.deliver === "none")).toBe(true);
    expect(JSON.stringify(jobs)).not.toContain("task-boundary");
    expect(store.loadTask("task-boundary")?.taskJudgement).toBe("success");
    if (pipeline.ok && pipeline.issue.prescriptionId) {
      const beforeDuplicate = jobs.length;
      const again = await confirmDiagnoseEvolutionPrescription({
        prescriptionId: pipeline.issue.prescriptionId,
        tenantId: "tenant-a",
        professionalReportId: "pdr-iso",
        callerUserId: "employee-9",
        enabled: true,
        configDir: dir,
        cron,
      });
      expect(again.ok).toBe(false);
      if (!again.ok) {
        expect(again.reason).toBe("prescription_hash_required");
      }
      expect(jobs).toHaveLength(beforeDuplicate);
    }
    store.close();
  });
});

function gapAssessment(): DiagnoseGrowthAssessment {
  return {
    agentId: "bot-2",
    tenantId: "tenant-a",
    agentAssetId: "asset-bot-2",
    targetOwnerId: "employee-9",
    groupId: null,
    objectLabel: "bot-2",
    displayName: null,
    identity: {
      readable: true,
      bootstrapPending: true,
      identityInitialized: false,
      userInitialized: false,
    },
    memory: { present: false, fresh: false },
    hadTaskActivity: false,
    memoryJudgedMissing: false,
    capable: [],
    unstable: [],
    unused: [],
    baselineGapCandidates: [],
    existingJobNames: [],
    identityMissingFields: ["name"],
    userMissingFields: [],
    installedSkillIds: [],
    memoryFileCount: 0,
    reportFileCount: 0,
    freshArtifactCount: 0,
    sessionRoster: { main: 1, cron: 0, other: 0, freshCron: 0, freshMain: 0 },
    activitySources: [],
    roleBaselineInjected: false,
    skillLastSeenMs: {},
  };
}
