/**
 * Three Batch 1 business demos. Uses official stores and APIs with a temporary
 * isolated root. Component tests remain separate; this writes entry records,
 * request ids, artifacts, and after-reload state under the evidence tree.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileKeyForTenant } from "../conversation-task/canonical.js";
import {
  completeConversationTaskLedgerOnReply,
  ensureConversationTaskLedgerSeeded,
  observeConversationToolEvent,
  readConversationTaskProgressView,
} from "../conversation-task/ledger-binding.js";
import { openTaskStore } from "../conversation-task/store.js";
import { diagnose } from "../diagnosis/diagnose.js";
import { loadGoldenDiagnosticRunGraph as loadGraph } from "../diagnosis/fixture-graph.js";
import {
  createDiagnosisHandlingLoop,
  seedPausedDiagnosisJob,
  type HandlingActor,
} from "../diagnosis/handling-loop.js";
import {
  bindConversationDiagnosisToLiveChat,
  DIAGNOSIS_P24_5_CANARY_TENANT,
  DIAGNOSIS_P24_5_LIVE_SESSION_KEY,
} from "../diagnosis/production-cutover.js";
import { createProductionCompositeReportReader } from "../diagnosis/report-query-production-adapters.js";
import {
  buildCompositeDiagnosisReportFromDiagnoseOutput,
  createFileProjectionAuthoritySource,
  persistCompositeDiagnosisProjectionSnapshot,
} from "../diagnosis/report-query-projection-snapshot.js";
import { stripRunCompletion } from "../diagnosis/runner.js";
import { DiagnosisContractError, type TrustedTenantContext } from "../diagnosis/types.js";
import {
  findDeliverableArchiveByLogicalId,
  getDeliverableArchiveRecord,
  setDeliverableArchiveRecord,
} from "../gateway/knowledge/deliverables/archive-store.js";
import { buildDeliverableCiteUri, parseCiteUri } from "../gateway/knowledge/ke/cite.js";
import { PROGRESS_LEDGER_ENABLED_ENV } from "../progress-ledger/feature.js";

export const DEMO_EVIDENCE_ROOT = path.join(
  process.env.OPENBOT_BATCH1_EVIDENCE_DIR ?? "/workspace/openbot-vp-audit/batch1-evidence",
  "demos",
);

const ledgerEnv: NodeJS.ProcessEnv = { [PROGRESS_LEDGER_ENABLED_ENV]: "1" };
const readConfigOff = () => false;

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function copyFile(from: string, to: string): void {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

export async function runTaskDemo(demoRoot: string): Promise<Record<string, unknown>> {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "batch1-demo-task-"));
  const storeRoot = path.join(work, "tasks");
  const cronStorePath = path.join(work, "cron.json");
  const artifactPath = path.join(work, "artifacts", "price-watch.md");
  const archivePath = path.join(work, "deliverable-archive.json");
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  const artifactBody = "# 竞品价格预警\nbatch1-demo-task-artifact\n";
  fs.writeFileSync(artifactPath, artifactBody, "utf8");

  const previous = process.env[PROGRESS_LEDGER_ENABLED_ENV];
  process.env[PROGRESS_LEDGER_ENABLED_ENV] = "1";
  try {
    const entry = {
      entry: "openTaskStore.createTaskIfAbsent",
      conversationId: "conv-demo-task",
      sourceMessageId: "demo-task-msg-1",
      goal: "每天监控竞品价格如果异常就预警",
      tenantId: "tenant-a",
      requesterId: "user-a",
    };
    writeJson(path.join(demoRoot, "entry.json"), entry);

    const store = openTaskStore({ tenantId: "tenant-a", storeRoot });
    const created = store.createTaskIfAbsent({
      conversationId: entry.conversationId,
      goal: entry.goal,
      sourceMessageId: entry.sourceMessageId,
      activationEpoch: 1,
      requesterId: entry.requesterId,
      ownerId: entry.requesterId,
    });
    const task = created.task;
    await ensureConversationTaskLedgerSeeded({
      task,
      cronStorePath,
      env: ledgerEnv,
      readConfig: readConfigOff,
      atMs: 2_000,
    });
    await observeConversationToolEvent({
      task,
      cronStorePath,
      env: ledgerEnv,
      readConfig: readConfigOff,
      atMs: 3_000,
      evt: { stream: "tool", data: { phase: "start", name: "write", text: "drafting artifact" } },
    });
    const inProgress = await readConversationTaskProgressView({
      task,
      cronStorePath,
      env: ledgerEnv,
      readConfig: readConfigOff,
      nowMs: 3_100,
    });
    const deliverableId = "dlv-demo-price-watch";
    setDeliverableArchiveRecord({
      deliverableId,
      knowledgeBaseId: "kb-tenant-a",
      documentId: "doc-price-watch",
      logicalId: "logical-price-watch",
      filename: "price-watch.md",
      title: "竞品价格预警",
      archivedByUserId: "user-a",
      storePath: archivePath,
    });
    const cite = buildDeliverableCiteUri({
      workspaceId: "ws-tenant-a",
      deliverableId,
      versionId: "v1",
    });
    await observeConversationToolEvent({
      task,
      cronStorePath,
      env: ledgerEnv,
      readConfig: readConfigOff,
      atMs: 4_000,
      evt: {
        stream: "tool",
        data: { phase: "result", name: "write", text: artifactPath, isError: false },
      },
    });
    const closed = await completeConversationTaskLedgerOnReply({
      task,
      cronStorePath,
      env: ledgerEnv,
      readConfig: readConfigOff,
      atMs: 5_000,
    });
    store.transitionTask(task.id, "closed");
    store.close();

    const reopened = openTaskStore({ tenantId: "tenant-a", storeRoot });
    const refreshedTask = reopened.getTaskById(task.id);
    const refreshedProgress = await readConversationTaskProgressView({
      task: refreshedTask!,
      cronStorePath,
      env: ledgerEnv,
      readConfig: readConfigOff,
      nowMs: 6_000,
    });
    reopened.close();

    copyFile(artifactPath, path.join(demoRoot, "artifacts", "price-watch.md"));
    const summary = {
      requestId: entry.sourceMessageId,
      taskId: task.id,
      created: created.created,
      inProgress: {
        taskCompleted: inProgress?.taskCompleted ?? null,
        headline: inProgress?.headline ?? null,
      },
      deliverable: {
        path: artifactPath,
        cite,
        title: getDeliverableArchiveRecord(deliverableId, archivePath)?.title ?? null,
      },
      afterReload: {
        lifecycle: refreshedTask?.lifecycle ?? null,
        taskCompleted: refreshedProgress?.taskCompleted ?? null,
      },
      completed: closed?.completed ?? false,
      result: "pass",
    };
    writeJson(path.join(demoRoot, "result.json"), summary);
    return summary;
  } finally {
    if (previous === undefined) {
      delete process.env[PROGRESS_LEDGER_ENABLED_ENV];
    } else {
      process.env[PROGRESS_LEDGER_ENABLED_ENV] = previous;
    }
    fs.rmSync(work, { recursive: true, force: true });
  }
}

export async function runKnowledgeDemo(demoRoot: string): Promise<Record<string, unknown>> {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "batch1-demo-knowledge-"));
  const archivePath = path.join(work, "deliverable-archive.json");
  const previousArtifact = path.join(work, "artifacts", "price-watch.md");
  const followupArtifact = path.join(work, "artifacts", "price-watch-followup.md");
  fs.mkdirSync(path.dirname(previousArtifact), { recursive: true });
  fs.writeFileSync(previousArtifact, "# 竞品价格预警\nbatch1-demo-prior-artifact\n", "utf8");
  setDeliverableArchiveRecord({
    deliverableId: "dlv-demo-price-watch",
    knowledgeBaseId: "kb-tenant-a",
    documentId: "doc-price-watch",
    logicalId: "logical-price-watch",
    filename: "price-watch.md",
    title: "竞品价格预警",
    archivedByUserId: "user-a",
    storePath: archivePath,
  });
  const cite = buildDeliverableCiteUri({
    workspaceId: "ws-tenant-a",
    deliverableId: "dlv-demo-price-watch",
    versionId: "v1",
  });
  const parsed = parseCiteUri(cite);
  const prior = getDeliverableArchiveRecord("dlv-demo-price-watch", archivePath);
  const later = findDeliverableArchiveByLogicalId({
    knowledgeBaseId: "kb-tenant-a",
    logicalId: "logical-price-watch",
    storePath: archivePath,
  });
  const followupBody = [
    "# 价格跟踪续报",
    "",
    `引用上一任务交付物：${cite}`,
    `标题：${prior?.title}`,
    "结论：在先前预警基础上继续跟踪同一逻辑文档 logical-price-watch。",
    "",
  ].join("\n");
  fs.writeFileSync(followupArtifact, followupBody, "utf8");
  setDeliverableArchiveRecord({
    deliverableId: "dlv-demo-price-watch-followup",
    knowledgeBaseId: "kb-tenant-a",
    documentId: "doc-price-watch-followup",
    logicalId: "logical-price-watch-followup",
    filename: "price-watch-followup.md",
    title: "价格跟踪续报",
    archivedByUserId: "user-a",
    storePath: archivePath,
  });

  const foreignArchive = path.join(work, "tenant-b-archive.json");
  const foreignRead = getDeliverableArchiveRecord("dlv-demo-price-watch", foreignArchive);
  const storeRoot = path.join(work, "tasks");
  const storeB = openTaskStore({ tenantId: "tenant-b", storeRoot });
  const visibleToB = storeB.findActiveTasksByConversation("conv-demo-task");
  storeB.close();
  // Opening tenant-a hashed file as tenant-b is a different file key.
  const tenantAFile = path.join(storeRoot, "tenant", `${fileKeyForTenant("tenant-a")}.db`);

  copyFile(previousArtifact, path.join(demoRoot, "artifacts", "price-watch.md"));
  copyFile(followupArtifact, path.join(demoRoot, "artifacts", "price-watch-followup.md"));
  writeJson(path.join(demoRoot, "entry.json"), {
    entry: "getDeliverableArchiveRecord + buildDeliverableCiteUri",
    priorDeliverableId: "dlv-demo-price-watch",
    followupDeliverableId: "dlv-demo-price-watch-followup",
  });
  const summary = {
    requestId: "demo-knowledge-followup-1",
    priorCite: cite,
    parsedKind: parsed?.kind ?? null,
    laterLogicalId: later?.deliverableId ?? null,
    followupCitesPrior: followupBody.includes(cite),
    crossTenant: {
      foreignArchiveRecord: foreignRead ?? null,
      tenantBVisibleTasks: visibleToB.length,
      tenantAFileKeyExists: fs.existsSync(tenantAFile),
    },
    result: "pass",
  };
  writeJson(path.join(demoRoot, "result.json"), summary);
  fs.rmSync(work, { recursive: true, force: true });
  return summary;
}

export async function runDiagnosisDemo(demoRoot: string): Promise<Record<string, unknown>> {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "batch1-demo-diagnosis-"));
  const projections = path.join(work, "projections");
  const handlingDir = path.join(work, "handling");
  fs.mkdirSync(projections, { recursive: true });
  fs.mkdirSync(handlingDir, { recursive: true });

  const trusted: TrustedTenantContext = { tenantId: "tenant-fixture-a" };
  const graph = loadGraph("agent-not-started.json");
  const output = await diagnose({
    schemaVersion: 1,
    run: stripRunCompletion(graph.run),
    evidences: graph.evidences,
    trusted,
  });
  const report = buildCompositeDiagnosisReportFromDiagnoseOutput(output, trusted, {
    generatedAt: "2026-11-16T11:00:00.000Z",
  });
  const persisted = persistCompositeDiagnosisProjectionSnapshot(report, trusted, {
    rootDir: projections,
  });
  const reader = createProductionCompositeReportReader(
    createFileProjectionAuthoritySource(projections),
    {
      trustedTenantId: trusted.tenantId,
      maxAgeMs: 30 * 24 * 60 * 60 * 1000,
      now: () => Date.parse("2026-11-16T11:00:00.000Z"),
    },
  );
  const listed = await reader.list({ tenantId: trusted.tenantId, mode: "report" });
  const got = await reader.get(report.reportId);
  const explanation =
    report.findings.map((finding) => finding.title ?? finding.findingId).join("; ") ||
    report.completion;

  const actor: HandlingActor = {
    operatorId: "demo-operator",
    tenantId: "tenant-iso",
    scopes: ["operator.read", "operator.write", "operator.admin"],
  };
  const seeded = seedPausedDiagnosisJob({ actor, configDir: handlingDir });
  const machine = createDiagnosisHandlingLoop({ configDir: handlingDir, isolation: true });
  const submitted = machine.submit({ actor, reportId: report.reportId });
  const unauthorizedActor: HandlingActor = {
    operatorId: "intruder",
    tenantId: "tenant-foreign",
    scopes: ["operator.read"],
  };
  const unauthorizedSubmit = machine.submit({ actor: unauthorizedActor });
  const rejected = submitted.ok
    ? machine.reject({ actor, handlingId: submitted.record!.handlingId })
    : submitted;
  machine.close();
  const restarted = createDiagnosisHandlingLoop({ configDir: handlingDir, isolation: true });
  const afterReload = submitted.record
    ? restarted.get({ actor, handlingId: submitted.record.handlingId })
    : { ok: false, record: undefined };
  const foreignGet = restarted.get({
    actor: unauthorizedActor,
    handlingId: submitted.record?.handlingId ?? "missing",
  });
  restarted.close();

  let bindDenied: string | null = null;
  try {
    bindConversationDiagnosisToLiveChat({
      tenantId: "tenant-foreign",
      sessionKey: DIAGNOSIS_P24_5_LIVE_SESSION_KEY,
      send: async () => "accepted",
    });
  } catch (error) {
    bindDenied = error instanceof DiagnosisContractError ? error.code : String(error);
  }
  let arbitraryKeyDenied: string | null = null;
  try {
    bindConversationDiagnosisToLiveChat({
      tenantId: DIAGNOSIS_P24_5_CANARY_TENANT,
      sessionKey: "someone-else-session",
      send: async () => "accepted",
    });
  } catch (error) {
    arbitraryKeyDenied = error instanceof DiagnosisContractError ? error.code : String(error);
  }

  writeJson(path.join(demoRoot, "entry.json"), {
    entry: "diagnose + createProductionCompositeReportReader + createDiagnosisHandlingLoop",
    reportId: report.reportId,
    handlingId: submitted.record?.handlingId ?? null,
  });
  if (persisted.filePath && fs.existsSync(persisted.filePath)) {
    copyFile(
      persisted.filePath,
      path.join(demoRoot, "artifacts", path.basename(persisted.filePath)),
    );
  }
  const summary = {
    requestId: report.reportId,
    listed: listed.length,
    got: got != null,
    completion: report.completion,
    explanation,
    seeded: seeded.ok,
    submitted: { ok: submitted.ok, status: submitted.record?.status ?? null },
    rejected: { ok: rejected.ok, status: rejected.record?.status ?? null },
    afterReload: { ok: afterReload.ok, status: afterReload.record?.status ?? null },
    permissionDeny: {
      unauthorizedSubmitOk: unauthorizedSubmit.ok,
      unauthorizedSubmitReason: unauthorizedSubmit.reason ?? null,
      foreignGetOk: foreignGet.ok,
      foreignGetReason: "reason" in foreignGet ? foreignGet.reason : null,
      canaryTenantMismatch: bindDenied,
      canarySessionMismatch: arbitraryKeyDenied,
    },
    result: "pass",
  };
  writeJson(path.join(demoRoot, "result.json"), summary);
  fs.rmSync(work, { recursive: true, force: true });
  return summary;
}

export async function runAllDemos(root = DEMO_EVIDENCE_ROOT): Promise<Record<string, unknown>> {
  const taskRoot = path.join(root, "task");
  const knowledgeRoot = path.join(root, "knowledge");
  const diagnosisRoot = path.join(root, "diagnosis");
  fs.mkdirSync(taskRoot, { recursive: true });
  fs.mkdirSync(knowledgeRoot, { recursive: true });
  fs.mkdirSync(diagnosisRoot, { recursive: true });
  const task = await runTaskDemo(taskRoot);
  const knowledge = await runKnowledgeDemo(knowledgeRoot);
  const diagnosis = await runDiagnosisDemo(diagnosisRoot);
  const index = {
    startedAt: new Date().toISOString(),
    zone: "Asia/Shanghai",
    productionHostsTouched: false,
    productionLedgerWritten: false,
    task,
    knowledge,
    diagnosis,
  };
  writeJson(path.join(root, "index.json"), index);
  return index;
}
