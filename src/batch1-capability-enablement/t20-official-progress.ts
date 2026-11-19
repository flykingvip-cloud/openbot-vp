/**
 * Official-entry task progress, knowledge reuse, and isolated OpenBot
 * rollback drill for Batch 1 t20. Uses official stores and ledger APIs
 * with an independent persistence directory. Not a production deploy.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileKeyForTenant } from "../conversation-task/canonical.js";
import {
  completeConversationTaskLedgerOnReply,
  ensureConversationTaskLedgerSeeded,
  isConversationTaskProgressEnabled,
  observeConversationToolEvent,
  readConversationTaskProgressView,
} from "../conversation-task/ledger-binding.js";
import { openTaskStore } from "../conversation-task/store.js";
import {
  getDeliverableArchiveRecord,
  setDeliverableArchiveRecord,
} from "../gateway/knowledge/deliverables/archive-store.js";
import { buildDeliverableCiteUri } from "../gateway/knowledge/ke/cite.js";
import {
  PROGRESS_LEDGER_ENABLED_ENV,
  PROGRESS_LEDGER_SHUTDOWN_ENV,
  PROGRESS_LEDGER_TENANT_ALLOWLIST_ENV,
  describeProgressLedgerCanaryScope,
  resolveProgressLedgerGate,
} from "../progress-ledger/feature.js";
import { readBoundSha } from "./bound-sha.js";
import { BATCH1_EVIDENCE_ROOT } from "./evidence-root.js";
import { runKnowledgeDemo } from "./run-demos.js";

export const T20_EVIDENCE_ROOT = path.join(BATCH1_EVIDENCE_ROOT, "t20-official-progress");
export const T20_ROLLBACK_EVIDENCE_ROOT = path.join(BATCH1_EVIDENCE_ROOT, "t20-rollback");
export const T20_KNOWLEDGE_EVIDENCE_ROOT = path.join(BATCH1_EVIDENCE_ROOT, "t20-knowledge");

const PILOT_TENANT = "tenant-a";
const FOREIGN_TENANT = "tenant-b";
const readConfigOff = () => false;

export type OfficialProgressEnv = {
  [PROGRESS_LEDGER_ENABLED_ENV]?: string;
  [PROGRESS_LEDGER_SHUTDOWN_ENV]?: string;
  [PROGRESS_LEDGER_TENANT_ALLOWLIST_ENV]?: string;
};

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function artifactIdentity(): Record<string, unknown> {
  return {
    boundSha: readBoundSha(),
    originMainAncestor: "67fc9b6461d30d97ea587c218b6914240b88344f",
    imageDigest: null,
    imageDigestUnfilledReason:
      "Auditor box has no docker/podman/nerdctl/buildah/ctr client. A process listens on 0.0.0.0:2375 but no local container runtime process was identified in this namespace, and talking to that unknown listener was not treated as a safe isolated build. Digest is unfilled, not invented.",
    pythonListenerRollbackRetracted: true,
    pythonListenerHistoricalIndex: path.join(
      BATCH1_EVIDENCE_ROOT,
      "release-prep",
      "rollback-drill.json",
    ),
    zone: "Asia/Shanghai",
    recordedAt: new Date().toISOString(),
  };
}

async function runOfficialTaskCycle(params: {
  workRoot: string;
  env: OfficialProgressEnv;
  requestId: string;
  goal?: string;
}) {
  const storeRoot = path.join(params.workRoot, "tasks");
  const cronStorePath = path.join(params.workRoot, "cron.json");
  const artifactPath = path.join(params.workRoot, "artifacts", "price-watch.md");
  const archivePath = path.join(params.workRoot, "deliverable-archive.json");
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  const body = "# 竞品价格预警\nofficial-entry-t20-artifact\n";
  fs.writeFileSync(artifactPath, body, "utf8");
  const store = openTaskStore({ tenantId: PILOT_TENANT, storeRoot });
  const created = store.createTaskIfAbsent({
    conversationId: "conv-t20-official",
    goal: params.goal ?? "通过正式入口创建任务并追踪交付物",
    sourceMessageId: params.requestId,
    activationEpoch: 1,
    requesterId: "user-a",
    ownerId: "user-a",
  });
  const task = created.task;
  const before = {
    lifecycle: task.lifecycle,
    taskId: task.id,
    progressEnabled: isConversationTaskProgressEnabled({
      tenantId: PILOT_TENANT,
      env: params.env,
      readConfig: readConfigOff,
    }),
  };
  const seeded = await ensureConversationTaskLedgerSeeded({
    task,
    cronStorePath,
    env: params.env,
    readConfig: readConfigOff,
    atMs: 2_000,
  });
  await observeConversationToolEvent({
    task,
    cronStorePath,
    env: params.env,
    readConfig: readConfigOff,
    atMs: 3_000,
    evt: { stream: "tool", data: { phase: "start", name: "write", text: "drafting artifact" } },
  });
  const inProgress = await readConversationTaskProgressView({
    task,
    cronStorePath,
    env: params.env,
    readConfig: readConfigOff,
    nowMs: 3_100,
  });
  const deliverableId = "dlv-t20-official-price-watch";
  setDeliverableArchiveRecord({
    deliverableId,
    knowledgeBaseId: "kb-tenant-a",
    documentId: "doc-t20-price-watch",
    logicalId: "logical-t20-price-watch",
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
  const deliverableRead = {
    path: artifactPath,
    bytes: fs.statSync(artifactPath).size,
    hash: createHash("sha256").update(fs.readFileSync(artifactPath)).digest("hex"),
    body,
    archiveTitle: getDeliverableArchiveRecord(deliverableId, archivePath)?.title ?? null,
    cite,
  };
  await observeConversationToolEvent({
    task,
    cronStorePath,
    env: params.env,
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
    env: params.env,
    readConfig: readConfigOff,
    atMs: 5_000,
  });
  store.transitionTask(task.id, "closed");
  store.close();
  const reopened = openTaskStore({ tenantId: PILOT_TENANT, storeRoot });
  const refreshedTask = reopened.getTaskById(task.id);
  const refreshedProgress = await readConversationTaskProgressView({
    task: refreshedTask!,
    cronStorePath,
    env: params.env,
    readConfig: readConfigOff,
    nowMs: 6_000,
  });
  reopened.close();
  const foreignStore = openTaskStore({ tenantId: FOREIGN_TENANT, storeRoot });
  const foreignVisible = foreignStore.findActiveTasksByConversation("conv-t20-official");
  const foreignProgressEnabled = isConversationTaskProgressEnabled({
    tenantId: FOREIGN_TENANT,
    env: params.env,
    readConfig: readConfigOff,
  });
  foreignStore.close();
  return {
    officialEntry:
      "openTaskStore.createTaskIfAbsent + ensureConversationTaskLedgerSeeded + readConversationTaskProgressView + deliverable archive read + reopen store",
    requestId: params.requestId,
    tenantId: PILOT_TENANT,
    taskId: task.id,
    created: created.created,
    before,
    inProgress: {
      taskCompleted: inProgress?.taskCompleted ?? null,
      headline: inProgress?.headline ?? null,
      emitToChat: inProgress?.emitToChat ?? null,
    },
    seeded: seeded != null,
    closed: closed?.completed ?? null,
    deliverable: deliverableRead,
    afterReload: {
      lifecycle: refreshedTask?.lifecycle ?? null,
      taskCompleted: refreshedProgress?.taskCompleted ?? null,
      emitToChat: refreshedProgress?.emitToChat ?? null,
    },
    crossTenant: {
      foreignVisibleCount: foreignVisible.length,
      foreignProgressEnabled,
    },
    gate: resolveProgressLedgerGate(params.env, readConfigOff),
    canaryScope: describeProgressLedgerCanaryScope(params.env, readConfigOff),
    tenantDbFile: path.join(storeRoot, "tenant", `${fileKeyForTenant(PILOT_TENANT)}.db`),
    cronStorePath,
    archivePath,
    artifactPath,
  };
}

export async function runOfficialTaskProgressEntry(params?: {
  evidenceRoot?: string;
}): Promise<Record<string, unknown>> {
  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "t20-official-task-"));
  const env: OfficialProgressEnv = {
    [PROGRESS_LEDGER_ENABLED_ENV]: "1",
    [PROGRESS_LEDGER_TENANT_ALLOWLIST_ENV]: PILOT_TENANT,
  };
  const cycle = await runOfficialTaskCycle({
    workRoot,
    env,
    requestId: "t20-official-task-1",
  });
  const result = {
    kind: "official-task-progress-entry",
    ...artifactIdentity(),
    workRoot,
    result:
      cycle.created &&
      cycle.inProgress.emitToChat === true &&
      cycle.inProgress.taskCompleted === false &&
      cycle.afterReload.lifecycle === "closed" &&
      cycle.afterReload.taskCompleted === true &&
      cycle.deliverable.bytes > 0 &&
      cycle.crossTenant.foreignVisibleCount === 0 &&
      !cycle.crossTenant.foreignProgressEnabled &&
      cycle.canaryScope === "tenant_allowlist"
        ? "pass"
        : "fail",
    cycle,
  };
  const evidenceRoot = params?.evidenceRoot ?? T20_EVIDENCE_ROOT;
  writeJson(path.join(evidenceRoot, "official-entry.json"), result);
  if (fs.existsSync(cycle.artifactPath)) {
    const dest = path.join(evidenceRoot, "artifacts", "price-watch.md");
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(cycle.artifactPath, dest);
  }
  return result;
}

export async function runOfficialKnowledgeEntry(params?: {
  evidenceRoot?: string;
}): Promise<Record<string, unknown>> {
  const evidenceRoot = params?.evidenceRoot ?? T20_KNOWLEDGE_EVIDENCE_ROOT;
  const demo = await runKnowledgeDemo(evidenceRoot);
  const result = {
    kind: "official-knowledge-reuse-entry",
    officialEntry:
      "writeKnowledgeFolderFile + setDeliverableArchiveRecord + readReservedDeliverableOriginal + fact extraction and comparison",
    ...artifactIdentity(),
    result: demo.result === "pass" ? "pass" : "fail",
    demo,
  };
  writeJson(path.join(evidenceRoot, "official-knowledge.json"), result);
  return result;
}

export async function runOpenBotRollbackDrill(params?: {
  evidenceRoot?: string;
}): Promise<Record<string, unknown>> {
  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "t20-rollback-"));
  const enabledEnv: OfficialProgressEnv = {
    [PROGRESS_LEDGER_ENABLED_ENV]: "1",
    [PROGRESS_LEDGER_TENANT_ALLOWLIST_ENV]: PILOT_TENANT,
  };
  const enabled = await runOfficialTaskCycle({
    workRoot,
    env: enabledEnv,
    requestId: "t20-rollback-task-1",
  });
  const shutdownEnv: OfficialProgressEnv = {
    [PROGRESS_LEDGER_ENABLED_ENV]: "1",
    [PROGRESS_LEDGER_SHUTDOWN_ENV]: "1",
    [PROGRESS_LEDGER_TENANT_ALLOWLIST_ENV]: PILOT_TENANT,
  };
  // Env is read on each official API call. This is the real runtime mechanism
  // for env shutdown. Config-file changes would require a process restart
  // because loadConfig() is cached.
  const store = openTaskStore({
    tenantId: PILOT_TENANT,
    storeRoot: path.join(workRoot, "tasks"),
  });
  const existing = store.getTaskById(enabled.taskId);
  const progressAfterShutdown = existing
    ? await readConversationTaskProgressView({
        task: existing,
        cronStorePath: enabled.cronStorePath,
        env: shutdownEnv,
        readConfig: readConfigOff,
        nowMs: 8_000,
      })
    : null;
  const newTask = store.createTaskIfAbsent({
    conversationId: "conv-t20-official-new-after-shutdown",
    goal: "关闭后的新请求不应再投影进度",
    sourceMessageId: "t20-rollback-new-1",
    activationEpoch: 1,
    requesterId: "user-a",
    ownerId: "user-a",
  });
  const seededAfterShutdown = await ensureConversationTaskLedgerSeeded({
    task: newTask.task,
    cronStorePath: enabled.cronStorePath,
    env: shutdownEnv,
    readConfig: readConfigOff,
    atMs: 8_100,
  });
  const newProgress = await readConversationTaskProgressView({
    task: newTask.task,
    cronStorePath: enabled.cronStorePath,
    env: shutdownEnv,
    readConfig: readConfigOff,
    nowMs: 8_200,
  });
  const deliverableAfterShutdown = {
    exists: fs.existsSync(enabled.artifactPath),
    bytes: fs.existsSync(enabled.artifactPath) ? fs.statSync(enabled.artifactPath).size : 0,
    hash: fs.existsSync(enabled.artifactPath)
      ? createHash("sha256").update(fs.readFileSync(enabled.artifactPath)).digest("hex")
      : null,
    archiveTitle:
      getDeliverableArchiveRecord("dlv-t20-official-price-watch", enabled.archivePath)?.title ??
      null,
  };
  // Restore without shutdown on the same persistence dir (candidate re-enable).
  const restoredProgress = existing
    ? await readConversationTaskProgressView({
        task: existing,
        cronStorePath: enabled.cronStorePath,
        env: enabledEnv,
        readConfig: readConfigOff,
        nowMs: 9_000,
      })
    : null;
  store.close();

  const envZeroOnly = resolveProgressLedgerGate({ [PROGRESS_LEDGER_ENABLED_ENV]: "0" }, () => ({
    enabled: true,
  }));
  const result = {
    kind: "openbot-rollback-drill",
    ...artifactIdentity(),
    pythonListenerConclusionRetracted:
      "The earlier Python-listener drill is not application-rollback evidence. It remains only a historical index.",
    runtimeMechanism:
      "OPENBOT_PROGRESS_LEDGER_SHUTDOWN is read on each official ledger API call in-process. Config-file shutdown/enabled changes require a process restart because loadConfig() is cached. Rollback must cover env, config, shutdown, and the default-on conversation-task close-requires-evidence path. Setting only OPENBOT_PROGRESS_LEDGER_ENABLED=0 is not complete if config.enabled is true or if conversation-task projections should stop.",
    forwardReleaseRule:
      "deploy/production/scripts/verify-forward-only.sh — recovery SHA must be an ancestor of the candidate (or an approved --intentional-revert). This drill uses origin/main 67fc9b6461d30d97ea587c218b6914240b88344f as the allowed recovery version. No ledger schema was changed, so the candidate-written JSONL ledger and deliverable archive remain readable after re-enable on the candidate and would be readable by that ancestor for this path.",
    workRoot,
    enablement: {
      env: enabledEnv,
      canaryScope: enabled.canaryScope,
      gate: enabled.gate,
    },
    enabledCycle: {
      requestId: enabled.requestId,
      taskId: enabled.taskId,
      afterReload: enabled.afterReload,
      deliverableHash: enabled.deliverable.hash,
    },
    shutdown: {
      env: shutdownEnv,
      gate: resolveProgressLedgerGate(shutdownEnv, readConfigOff),
      existingTaskProgress: progressAfterShutdown,
      newRequestSeeded: seededAfterShutdown != null,
      newRequestProgress: newProgress,
      deliverableStillReadable: deliverableAfterShutdown,
    },
    reenableCompatibility: {
      existingTaskProgressCompleted: restoredProgress?.taskCompleted ?? null,
      deliverableHashUnchanged: deliverableAfterShutdown.hash === enabled.deliverable.hash,
    },
    incompleteRollbackIfOnlyEnvZeroWhileConfigEnabled: envZeroOnly.processEnabled,
    result:
      enabled.afterReload.taskCompleted === true &&
      progressAfterShutdown == null &&
      newProgress == null &&
      seededAfterShutdown == null &&
      deliverableAfterShutdown.exists &&
      restoredProgress?.taskCompleted === true &&
      envZeroOnly.processEnabled
        ? "pass"
        : "fail",
  };
  const evidenceRoot = params?.evidenceRoot ?? T20_ROLLBACK_EVIDENCE_ROOT;
  writeJson(path.join(evidenceRoot, "rollback-drill.json"), result);
  return result;
}
