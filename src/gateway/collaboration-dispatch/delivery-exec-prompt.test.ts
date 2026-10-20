/**
 * FINAL v3 S2 — 三件套 reaches the collaboration agent prompt assembly.
 * Missing plan nudges/blocks. Claim contract off does not inject.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Task } from "@openbot/collaboration-core";
import { afterEach, describe, expect, test } from "vitest";
import { assembleCollaborationRuntimeContextParts } from "../../auto-reply/reply/runtime-context-assembly.js";
import type { TemplateContext } from "../../auto-reply/templating.js";
import {
  clearConfigCache,
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../../config/config.js";
import type { SessionEntry } from "../../config/sessions.js";
import type { OpenBotConfig } from "../../config/types.js";
import {
  applyClaim,
  claimBoardItem,
  loadBoardClaimItem,
  markBoardItemInProgress,
  publishBoardItem,
} from "./claim-contract.js";
import { confirmTodolist, proposeTodolist } from "./executor-private-todolist.js";
import { createRoundPolicySnapshot } from "./round-policy-snapshot.js";
import { createRuntimeAuthority, type RuntimeAuthority } from "./runtime-authority.js";

const GROUP_ID = "grp_prompt";
const TASK_ID = "task_prompt";
const GOAL = "交付 overnight 三件套报告";
const STEP = "撰写确认步骤";

const tempDirs: string[] = [];
const savedStateDir = process.env.OPENBOT_STATE_DIR;
const savedOpenbotConfigPath = process.env.OPENBOT_CONFIG_PATH;
const savedOpenclawConfigPath = process.env.OPENCLAW_CONFIG_PATH;
const savedSecurityProfile = process.env.OPENBOT_SECURITY_PROFILE;
const savedLegacySecurityProfile = process.env.OPENCLAW_SECURITY_PROFILE;

afterEach(async () => {
  clearRuntimeConfigSnapshot();
  clearConfigCache();
  if (savedStateDir === undefined) {
    delete process.env.OPENBOT_STATE_DIR;
  } else {
    process.env.OPENBOT_STATE_DIR = savedStateDir;
  }
  if (savedOpenbotConfigPath === undefined) {
    delete process.env.OPENBOT_CONFIG_PATH;
  } else {
    process.env.OPENBOT_CONFIG_PATH = savedOpenbotConfigPath;
  }
  if (savedOpenclawConfigPath === undefined) {
    delete process.env.OPENCLAW_CONFIG_PATH;
  } else {
    process.env.OPENCLAW_CONFIG_PATH = savedOpenclawConfigPath;
  }
  if (savedSecurityProfile === undefined) {
    delete process.env.OPENBOT_SECURITY_PROFILE;
  } else {
    process.env.OPENBOT_SECURITY_PROFILE = savedSecurityProfile;
  }
  if (savedLegacySecurityProfile === undefined) {
    delete process.env.OPENCLAW_SECURITY_PROFILE;
  } else {
    process.env.OPENCLAW_SECURITY_PROFILE = savedLegacySecurityProfile;
  }
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function flagConfig(root: string, claimContract: boolean): OpenBotConfig {
  return {
    agents: { defaults: { workspace: path.join(root, "agent-ws") } },
    gateway: { security: { profile: "personal_local" } },
    collaboration: {
      defaults: { workspace: path.join(root, "collaboration") },
      runtimeNamespace: true,
      task: { claimContract },
    },
  } as OpenBotConfig;
}

async function useConfig(claimContract: boolean): Promise<{ root: string; cfg: OpenBotConfig }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-exec-prompt-"));
  tempDirs.push(root);
  process.env.OPENBOT_STATE_DIR = path.join(root, "state");
  delete process.env.OPENBOT_SECURITY_PROFILE;
  delete process.env.OPENCLAW_SECURITY_PROFILE;
  const cfg = flagConfig(root, claimContract);
  const configPath = path.join(root, "openbot.json");
  await fs.writeFile(configPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
  process.env.OPENBOT_CONFIG_PATH = configPath;
  process.env.OPENCLAW_CONFIG_PATH = configPath;
  setRuntimeConfigSnapshot(cfg, cfg);
  clearConfigCache();
  return { root, cfg };
}

function authority(cfg: OpenBotConfig): RuntimeAuthority {
  const snapshot = createRoundPolicySnapshot(
    {
      collaborationMode: "task_driven",
      finalDecisionMode: "human_required",
      botMaySelfAdvanceWithoutHuman: false,
    },
    { now: 1, idGen: () => "pss_prompt" },
  );
  return createRuntimeAuthority({
    snapshot,
    episodeId: "ep_prompt",
    tenant: { tenantId: null, trust: "none" },
    groupId: GROUP_ID,
    profile: "personal_local",
    cfg,
  });
}

const seedTask = {
  taskId: TASK_ID,
  title: "prompt inject",
  status: "open",
} as unknown as Task;

async function assemble(cfg: OpenBotConfig, root: string): Promise<string> {
  const parts = await assembleCollaborationRuntimeContextParts({
    cfg,
    workspaceDir: path.join(root, "agent-ws"),
    agentWorkspaceDir: path.join(root, "agent-ws"),
    agentId: "bot-analyst",
    sessionKey: "agent:bot-analyst:group",
    sessionEntry: { sessionId: "bot-private", updatedAt: 1 } as SessionEntry,
    sessionCtx: {
      CollaborationGroupId: GROUP_ID,
      CollaborationBotAgentId: "bot-analyst",
      CollaborationRoundInvoked: true,
      Provider: "webchat",
    } as TemplateContext,
    isNewSession: false,
    shouldInjectGroupIntro: false,
    defaultActivation: "mention",
    silentToken: "NO_REPLY",
  });
  return parts.join("\n");
}

describe("delivery exec prompt on the agent assembly path", () => {
  test("claim off does not inject a delivery bag", async () => {
    const { root, cfg } = await useConfig(false);
    const prompt = await assemble(cfg, root);
    expect(prompt).not.toContain("执行三件套");
    expect(prompt).not.toContain("不得静默交付");
  });

  test("confirmed plan injects 三件套; missing plan nudges instead of executing", async () => {
    const { root, cfg } = await useConfig(true);
    const auth = authority(cfg);
    const published = await publishBoardItem(
      auth,
      {
        groupId: GROUP_ID,
        taskId: TASK_ID,
        remainingWork: GOAL,
        acceptanceCriteria: ["含来源"],
        goal: GOAL,
        intendedClaimantIds: ["bot-analyst"],
        publishedBy: "bot-lead",
      },
      { cfg },
    );
    expect(published.ok).toBe(true);
    if (!published.ok) {
      return;
    }
    const itemId = published.value.itemId;
    await claimBoardItem(auth, { taskId: TASK_ID, itemId, claimantId: "bot-analyst" }, { cfg });
    await applyClaim(auth, { taskId: TASK_ID, itemId }, seedTask, auth.policy.effective, { cfg });

    const unconfirmed = await assemble(cfg, root);
    expect(unconfirmed).toContain("不得静默交付");
    expect(unconfirmed).toContain("plan_nudge");
    expect(unconfirmed).toContain(GOAL);
    expect(unconfirmed).toContain(GROUP_ID);
    expect(unconfirmed).not.toContain("计划门禁: 已确认");

    const proposed = await proposeTodolist(
      auth,
      {
        boardItemId: itemId,
        taskId: TASK_ID,
        groupId: GROUP_ID,
        ownerMemberId: "bot-analyst",
        steps: [{ title: STEP, detail: "仅当前确认步" }],
      },
      { cfg },
    );
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) {
      return;
    }
    const confirmed = await confirmTodolist(
      auth,
      {
        taskId: TASK_ID,
        todolistId: proposed.value.todolistId,
        confirmerId: "bot-lead",
      },
      { cfg, authorizedConfirmerIds: ["bot-lead"] },
    );
    expect(confirmed.ok).toBe(true);
    const inProg = await markBoardItemInProgress(
      auth,
      { taskId: TASK_ID, itemId, actorId: "bot-analyst" },
      { cfg },
    );
    expect(inProg.ok).toBe(true);

    const prompt = await assemble(cfg, root);
    expect(prompt).toContain("执行三件套");
    expect(prompt).toContain("共享看板摘要");
    expect(prompt).toContain(GOAL);
    expect(prompt).toContain("群上下文指针");
    expect(prompt).toContain(`groupId: ${GROUP_ID}`);
    expect(prompt).toContain("runtime/transcript.jsonl");
    expect(prompt).toContain(STEP);
    expect(prompt).toContain("计划门禁: 已确认");
    expect(prompt).not.toContain("不得静默交付");

    const loaded = await loadBoardClaimItem(auth, { taskId: TASK_ID, itemId });
    expect(loaded?.status).toBe("in_progress");
  });
});
