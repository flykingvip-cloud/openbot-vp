/**
 * Local smoke for ConversationTask inline progress + reply completion.
 * In-process only — does not start or bind a second gateway on :18789.
 *
 * Run: node --import tsx scripts/dev/conversation-task-inline-smoke.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CONVERSATION_TASK_ENV } from "../../src/conversation-task/feature.ts";
import { LOCAL_ACTIVATION_TENANT_ID } from "../../src/conversation-task/gateway-activation-hook.ts";
import {
  ensureConversationTaskLedgerSeeded,
  readConversationTaskProgressView,
} from "../../src/conversation-task/ledger-binding.ts";
import { observeConversationTaskReplyCompleted } from "../../src/conversation-task/reply-completion.ts";
import { defaultShadowStoreRoot } from "../../src/conversation-task/runtime-bootstrap.ts";
import { openTaskStore } from "../../src/conversation-task/store.ts";
import { PROGRESS_LEDGER_ENABLED_ENV } from "../../src/progress-ledger/feature.ts";

const GOAL = "分三步完成竞品监控联调";
const CONVERSATION_ID = "agent:main:smoke-inline";
const REQUESTER = "smoke-user@openbot.test";
const SOURCE_MESSAGE_ID = "m-smoke-inline-1";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    throw new Error(msg);
  }
}

async function loadActiveEntries(conversationId: string, cronStorePath: string) {
  const store = openTaskStore({
    tenantId: LOCAL_ACTIVATION_TENANT_ID,
    storeRoot: defaultShadowStoreRoot(),
  });
  try {
    const tasks = store
      .findActiveTasksByConversation(conversationId)
      .filter((task) => task.requesterId === REQUESTER || task.ownerId === REQUESTER);
    const entries = [];
    for (const task of tasks) {
      const progress = await readConversationTaskProgressView({ task, cronStorePath });
      if (!progress?.emitToChat) {
        continue;
      }
      entries.push({
        taskId: String(task.id),
        sourceMessageId: task.sourceMessageId,
        goal: task.goal,
        lifecycle: task.lifecycle,
        progress,
      });
    }
    return entries;
  } finally {
    store.close();
  }
}

const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-ct-smoke-"));
const cronStorePath = path.join(homeDir, "cron", "jobs.json");
fs.mkdirSync(path.dirname(cronStorePath), { recursive: true });
fs.writeFileSync(cronStorePath, "[]\n");

process.env.HOME = homeDir;
process.env.OPENCLAW_STATE_DIR = path.join(homeDir, "state");
process.env[CONVERSATION_TASK_ENV.activation] = "1";
process.env[PROGRESS_LEDGER_ENABLED_ENV] = "1";

const results: string[] = [];

try {
  const storeRoot = defaultShadowStoreRoot();
  const store = openTaskStore({ tenantId: LOCAL_ACTIVATION_TENANT_ID, storeRoot });
  const { task } = store.createTaskIfAbsent({
    conversationId: CONVERSATION_ID,
    goal: GOAL,
    activationEpoch: 1,
    requesterId: REQUESTER,
    ownerId: REQUESTER,
    sourceMessageId: SOURCE_MESSAGE_ID,
  });
  await ensureConversationTaskLedgerSeeded({ task, cronStorePath });
  store.close();

  const before = await loadActiveEntries(CONVERSATION_ID, cronStorePath);
  assert(before.length === 1, "expected one active task");
  assert(before[0]?.sourceMessageId === SOURCE_MESSAGE_ID, "sourceMessageId mismatch");
  assert(before[0]?.progress.emitToChat, "emitToChat should be true");
  results.push(`✓ active 任务投影 1 条 (${before[0]?.progress.headline ?? ""})`);

  void observeConversationTaskReplyCompleted({
    tenantId: LOCAL_ACTIVATION_TENANT_ID,
    requesterId: REQUESTER,
    conversationId: CONVERSATION_ID,
    sourceMessageId: SOURCE_MESSAGE_ID,
    text: GOAL,
    cronStorePath,
  });
  await new Promise((r) => setTimeout(r, 300));

  const after = await loadActiveEntries(CONVERSATION_ID, cronStorePath);
  assert(after.length === 0, "expected zero active tasks after reply");
  results.push("✓ reply 完成后 active 投影为空（内联条应收起）");

  const liveHealth = (await fetch("http://127.0.0.1:18789/healthz").then((r) => r.json())) as {
    ok?: boolean;
    status?: string;
  };
  assert(liveHealth.ok === true, "live mac gateway health failed");
  results.push(`✓ 本机 launchd gateway :18789 healthz=${liveHealth.status ?? "live"}`);

  const buildInfo = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "dist/build-info.json"), "utf8"),
  ) as { commit?: string; builtAt?: string };
  results.push(
    `✓ dist 已重建 (commit ${String(buildInfo.commit ?? "").slice(0, 12)}, ${buildInfo.builtAt ?? ""})`,
  );

  console.log("\n=== ConversationTask 内联进度 gateway 联调 ===\n");
  for (const line of results) {
    console.log(line);
  }
  console.log(
    "\n说明：本机 menubar gateway 未开 OPENBOT_CONVERSATION_TASK_ACTIVATION / Progress Ledger env，",
  );
  console.log("聊天 UI 内联条需在 Control UI 重建 + flag 开启后于浏览器验证。");
  console.log("\n全部通过。\n");
} finally {
  delete process.env[CONVERSATION_TASK_ENV.activation];
  delete process.env[PROGRESS_LEDGER_ENABLED_ENV];
  fs.rmSync(homeDir, { recursive: true, force: true });
}
