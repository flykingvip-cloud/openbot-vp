/**
 * Controlled-fault diagnosis: induce a tool-timeout session in an isolated
 * work directory, run the official live diagnoser against that session file,
 * then perform human handling (submit then reject; no auto-remediation) and
 * a post-handling reload check.
 *
 * This is not a golden fixture graph and is not a complete live-model
 * business verification. The fault is written in the official Session JSONL
 * format that store readers already accept.
 */
import fs from "node:fs";
import path from "node:path";
import { deriveDiagnoseObservationSummaryFromOutput } from "../diagnosis/diagnose-observation-summary.js";
import { formatDiagnoseReportText } from "../diagnosis/diagnose-report-text.js";
import { diagnose } from "../diagnosis/diagnose.js";
import {
  createDiagnosisHandlingLoop,
  seedPausedDiagnosisJob,
  type HandlingActor,
} from "../diagnosis/handling-loop.js";
import { buildLiveDiagnosticRun, hashSessionKey } from "../diagnosis/live-run.js";
import { createProductionCompositeReportReader } from "../diagnosis/report-query-production-adapters.js";
import {
  buildCompositeDiagnosisReportFromDiagnoseOutput,
  createFileProjectionAuthoritySource,
  persistCompositeDiagnosisProjectionSnapshot,
} from "../diagnosis/report-query-projection-snapshot.js";
import { replayDiagnosticRunGraph } from "../diagnosis/runner.js";
import type { TrustedTenantContext } from "../diagnosis/types.js";
import { appendSkillInvocationEvent } from "../gateway/skill-invocation/event-store.js";
import { readBoundSha } from "./bound-sha.js";

export const CONTROLLED_FAULT_AGENT_ID = "agent-batch1-isolated";
export const CONTROLLED_FAULT_SESSION_KEY = "batch1:isolated:controlled-fault";
export const CONTROLLED_FAULT_RUN_ID = "run-batch1-controlled-fault";
export const CONTROLLED_FAULT_TOOL = "web_fetch";
export const CONTROLLED_FAULT_ERROR = "timeout after 30s";

export function induceControlledToolTimeoutSession(workRoot: string): {
  sessionFilePath: string;
  skillConfigDir: string;
  toolObservationFile: string;
  inducedAt: string;
  bytes: number;
} {
  const skillConfigDir = path.join(workRoot, "skill-config");
  const sessionDir = path.join(workRoot, "sessions");
  fs.mkdirSync(skillConfigDir, { recursive: true });
  fs.mkdirSync(sessionDir, { recursive: true });
  const inducedAt = new Date().toISOString();
  const sessionFilePath = path.join(sessionDir, "session-controlled-fault.jsonl");
  const lines = [
    {
      type: "session-meta",
      agentId: CONTROLLED_FAULT_AGENT_ID,
      sessionKey: CONTROLLED_FAULT_SESSION_KEY,
    },
    {
      type: "message",
      message: { role: "user", content: "batch1 controlled-fault: fetch competitor prices" },
    },
    {
      type: "message",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            name: CONTROLLED_FAULT_TOOL,
            input: { url: "http://allow.batch1.test/prices" },
          },
        ],
      },
    },
    {
      type: "message",
      message: {
        role: "toolResult",
        toolName: CONTROLLED_FAULT_TOOL,
        error: CONTROLLED_FAULT_ERROR,
        durationMs: 30_000,
      },
    },
    {
      type: "after_tool_call",
      toolName: CONTROLLED_FAULT_TOOL,
      timeout: true,
      error: { class: "timeout" },
      durationMs: 30_000,
      runId: CONTROLLED_FAULT_RUN_ID,
      toolCallId: "call-batch1-controlled-fault",
      observedAt: inducedAt,
    },
  ];
  const body = `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`;
  fs.writeFileSync(sessionFilePath, body, "utf8");
  const toolObservationFile = path.join(skillConfigDir, "tool-observations.jsonl");
  fs.writeFileSync(
    toolObservationFile,
    `${JSON.stringify({
      type: "after_tool_call",
      toolName: CONTROLLED_FAULT_TOOL,
      timeout: true,
      error: { class: "timeout" },
      durationMs: 30_000,
      runId: CONTROLLED_FAULT_RUN_ID,
      toolCallId: "call-batch1-controlled-fault",
      observedAt: inducedAt,
    })}\n`,
    "utf8",
  );
  appendSkillInvocationEvent(
    {
      type: "skill_invocation_completed",
      invocationId: "inv-batch1-controlled-fault",
      skillId: "price-watch",
      skillVersion: "1",
      agentId: CONTROLLED_FAULT_AGENT_ID,
      tenantId: "tenant-iso-fault",
      userId: "user-a",
      startedAt: Date.now() - 30_000,
      completedAt: Date.now(),
      outcome: "failure",
      latencyMs: 30_000,
      failureCategory: "timeout",
      runId: CONTROLLED_FAULT_RUN_ID,
      sessionKey: CONTROLLED_FAULT_SESSION_KEY,
      businessOutcome: null,
      toolName: CONTROLLED_FAULT_TOOL,
      attributionResolution: "identity_tool_name",
    },
    skillConfigDir,
  );
  return {
    sessionFilePath,
    skillConfigDir,
    toolObservationFile,
    inducedAt,
    bytes: Buffer.byteLength(body, "utf8"),
  };
}

export async function runControlledFaultDiagnosis(params: {
  workRoot: string;
  evidenceRoot?: string;
}): Promise<Record<string, unknown>> {
  const induced = induceControlledToolTimeoutSession(params.workRoot);
  const trusted: TrustedTenantContext = { tenantId: "tenant-iso-fault" };
  const projections = path.join(params.workRoot, "projections");
  const handlingDir = path.join(params.workRoot, "handling");
  fs.mkdirSync(projections, { recursive: true });
  fs.mkdirSync(handlingDir, { recursive: true });

  const target = {
    agentId: CONTROLLED_FAULT_AGENT_ID,
    sessionKey: CONTROLLED_FAULT_SESSION_KEY,
    sessionId: "session-batch1-controlled-fault",
    runId: CONTROLLED_FAULT_RUN_ID,
    sessionFilePath: induced.sessionFilePath,
  };
  const run = buildLiveDiagnosticRun({
    target,
    trusted,
    requestedBy: {
      schemaVersion: 1,
      principalId: "demo-operator",
      kind: "user",
      tenantId: trusted.tenantId,
    },
    mode: "TARGETED",
  });
  const stores = {
    skillConfigDir: induced.skillConfigDir,
    sessionFile: {
      sessionFilePath: induced.sessionFilePath,
      sessionId: target.sessionId,
      sessionKeyHash: hashSessionKey(CONTROLLED_FAULT_SESSION_KEY),
      agentId: CONTROLLED_FAULT_AGENT_ID,
    },
    toolObservationFile: induced.toolObservationFile,
  };
  const replayed = await replayDiagnosticRunGraph({
    graph: {
      schemaVersion: 1,
      graphKind: "DiagnosticRunGraph",
      run,
      evidences: [],
      verification: null,
    },
    trusted,
    stores,
  });
  const output = await diagnose({
    schemaVersion: 1,
    run,
    evidences: [],
    trusted,
    stores,
  });
  const reportForSummary = buildCompositeDiagnosisReportFromDiagnoseOutput(output, trusted);
  const summary = {
    reportId: reportForSummary.reportId,
    completion: reportForSummary.completion,
    runnerCompletion: output.run.completion ?? null,
    findingCount: reportForSummary.findings.length,
    findings: reportForSummary.findings.slice(0, 12).map((finding) => ({
      findingId: finding.findingId,
      severity: finding.severity,
      status: finding.status,
      ...(finding.code ? { code: finding.code } : {}),
    })),
  };
  const report = buildCompositeDiagnosisReportFromDiagnoseOutput(output, trusted);
  const persisted = persistCompositeDiagnosisProjectionSnapshot(report, trusted, {
    rootDir: projections,
  });
  const reader = createProductionCompositeReportReader(
    createFileProjectionAuthoritySource(projections),
    {
      trustedTenantId: trusted.tenantId,
      maxAgeMs: 30 * 24 * 60 * 60 * 1000,
      now: () => Date.now(),
    },
  );
  const listed = await reader.list({ tenantId: trusted.tenantId, mode: "report" });
  const got = await reader.get(report.reportId);
  const collected = output.collected.map((evidence) => ({
    evidenceId: evidence.evidenceId,
    source: evidence.source,
    authorityRecordId: evidence.authorityRecordId,
    summary: evidence.summary,
  }));
  const findings = report.findings.map((finding) => ({
    findingId: finding.findingId,
    title: finding.title ?? null,
    severity: finding.severity,
    status: finding.status,
    code: finding.code ?? null,
    fingerprint: finding.fingerprint ?? null,
  }));
  const toolTimeoutEvidence = collected.filter((row) => {
    const blob = JSON.stringify(row).toLowerCase();
    return (
      row.source === "tool_runtime" ||
      blob.includes("timeout") ||
      blob.includes(CONTROLLED_FAULT_TOOL)
    );
  });
  const toolRuntimeEvidence = collected.find((row) => row.source === "tool_runtime") ?? null;
  const runnerCompletion = output.run.completion ?? replayed.run.completion ?? null;
  const confirmedToolTimeout = replayed.journal
    .list()
    .some((row) => row.kind === "stop" && row.code === "step-q4" && row.detail === "CONFIRMED");

  const actor: HandlingActor = {
    operatorId: "demo-operator",
    tenantId: "tenant-iso-fault",
    scopes: ["operator.read", "operator.write", "operator.admin"],
  };
  const seeded = seedPausedDiagnosisJob({ actor, configDir: handlingDir });
  const machine = createDiagnosisHandlingLoop({ configDir: handlingDir, isolation: true });
  const submitted = machine.submit({
    actor,
    reportId: report.reportId,
    idempotencyKey: `controlled-fault-${report.reportId}`,
  });
  const rejected = submitted.ok
    ? machine.reject({ actor, handlingId: submitted.record!.handlingId })
    : submitted;
  machine.close();
  const restarted = createDiagnosisHandlingLoop({ configDir: handlingDir, isolation: true });
  const afterReload = submitted.record
    ? restarted.get({ actor, handlingId: submitted.record.handlingId })
    : { ok: false, record: undefined };
  restarted.close();

  const result = {
    kind: "controlled-fault",
    boundSha: readBoundSha(),
    notGoldenFixture: true,
    notCompleteModelBusinessVerification: true,
    realImplementations: [
      "diagnose + buildLiveDiagnosticRun (official live-run builder and diagnoser)",
      "buildCompositeDiagnosisReportFromDiagnoseOutput",
      "persistCompositeDiagnosisProjectionSnapshot",
      "createProductionCompositeReportReader",
      "createDiagnosisHandlingLoop",
      "read of official Session JSONL / skill invocation event store",
    ],
    replacedOrInduced: [
      "Session JSONL was written by the isolated demo to induce a web_fetch timeout (official reader format, no live paid-model tool call)",
      "appendSkillInvocationEvent wrote a matching failure/timeout skill event into a temporary config dir",
      "Handling loop uses seedPausedDiagnosisJob so submit is actionable; execute/auto-remediation were not called",
    ],
    induced: {
      ...induced,
      sessionKeyHash: hashSessionKey(CONTROLLED_FAULT_SESSION_KEY),
      agentId: CONTROLLED_FAULT_AGENT_ID,
      sessionKey: CONTROLLED_FAULT_SESSION_KEY,
      runId: CONTROLLED_FAULT_RUN_ID,
      tool: CONTROLLED_FAULT_TOOL,
      error: CONTROLLED_FAULT_ERROR,
    },
    reportId: report.reportId,
    completion: report.completion,
    listed: listed.length,
    got: got != null,
    summary,
    findings,
    collected,
    toolTimeoutEvidence,
    missing: output.missing,
    planSteps: replayed.plan.steps.map((step) => ({
      stepId: step.stepId,
      diagnoserId: step.diagnoserId ?? null,
      evidenceSourceId: step.evidenceSourceId ?? null,
      hypothesisIds: step.hypothesisIds,
    })),
    journal: replayed.journal.list(),

    runnerCompletion,
    confirmedToolTimeout,
    assessments: output.result.assessments,
    hypotheses: output.result.hypotheses,
    observationSummary:
      report.observationSummary ??
      deriveDiagnoseObservationSummaryFromOutput(output, report.completion),
    reportDisplayText: formatDiagnoseReportText({
      completion: report.completion,
      findingCount: report.findings.length,
      findings: report.findings.slice(0, 12).map((finding) => ({
        findingId: finding.findingId,
        severity: finding.severity,
        status: finding.status,
        ...(finding.code ? { code: finding.code } : {}),
      })),
      windowId: "controlled-fault",
      mode: "TARGETED",
      scope: "session",
      scanned: 1,
      skipped: 0,
      reportId: report.reportId,
      reportIds: [report.reportId],
      ...(report.observationSummary ? { observationSummary: report.observationSummary } : {}),
    }),
    problem: {
      title: "web_fetch timed out after 30s in the induced isolated session",
      basis:
        "Official runner collected tool_runtime evidence (toolNameClass=web_fetch, timeout=true, errorClass=timeout, latencyMs=30000) and stopped at step-q4 with CONFIRMED (tool.timeout=true). Composite report findings stay empty because diagnose() emits assessments/hypotheses, not handwritten finding drafts. Display meaning comes from observationSummary derived from collected evidence, unconfirmed root-cause confidence, and missing route_resolution.",
      evidence: toolRuntimeEvidence ?? toolTimeoutEvidence[0] ?? null,
      runnerCompletion,
      confirmedToolTimeout,
      observationSummary: report.observationSummary ?? null,
    },
    persistedPath: persisted.filePath ?? null,
    handling: {
      seeded: seeded.ok,
      submitted: { ok: submitted.ok, status: submitted.record?.status ?? null },
      rejected: { ok: rejected.ok, status: rejected.record?.status ?? null },
      afterReload: { ok: afterReload.ok, status: afterReload.record?.status ?? null },
      autoRemediationExecuted: false,
    },
    result:
      submitted.ok &&
      rejected.record?.status === "rejected" &&
      afterReload.record?.status === "rejected" &&
      confirmedToolTimeout &&
      toolRuntimeEvidence != null &&
      runnerCompletion === "CONFIRMED" &&
      report.completion === "INCONCLUSIVE" &&
      report.findings.length === 0 &&
      report.observationSummary?.text === "已观察到工具超时；根因尚未确认；路由证据缺失。" &&
      report.observationSummary.rootCauseConfirmed === false
        ? "pass"
        : "fail",
  };

  if (params.evidenceRoot) {
    fs.mkdirSync(params.evidenceRoot, { recursive: true });
    if (persisted.filePath && fs.existsSync(persisted.filePath)) {
      const dest = path.join(params.evidenceRoot, "artifacts", path.basename(persisted.filePath));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(persisted.filePath, dest);
    }
    const sessionDest = path.join(
      params.evidenceRoot,
      "artifacts",
      "session-controlled-fault.jsonl",
    );
    fs.mkdirSync(path.dirname(sessionDest), { recursive: true });
    fs.copyFileSync(induced.sessionFilePath, sessionDest);
    fs.writeFileSync(
      path.join(params.evidenceRoot, "entry.json"),
      `${JSON.stringify(
        {
          entry: "induceControlledToolTimeoutSession + diagnoseLiveTarget + handling loop",
          reportId: report.reportId,
          sessionFilePath: induced.sessionFilePath,
          handlingId: submitted.record?.handlingId ?? null,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    fs.writeFileSync(
      path.join(params.evidenceRoot, "result.json"),
      `${JSON.stringify(result, null, 2)}\n`,
      "utf8",
    );
  }
  return result;
}
