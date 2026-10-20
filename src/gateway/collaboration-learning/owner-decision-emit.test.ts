import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  clearConfigCache,
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { makeOperatingState } from "../collaboration-dispatch/__fixtures__/policy-source-matrix.js";
import type { ExecutorPrivateTodolist } from "../collaboration-dispatch/executor-private-todolist.js";
import { resolveGroupPublicTranscriptPath } from "./collaboration-paths.js";
import { emitOwnerDecisionCardForProposedTodolist } from "./owner-decision-emit.js";
import { createWorkspaceCollaborationStores, writeGroupOperatingState } from "./shared.js";

const tempDirs: string[] = [];

afterEach(async () => {
  clearRuntimeConfigSnapshot();
  clearConfigCache();
  delete process.env.OPENBOT_CONFIG_PATH;
  delete process.env.OPENCLAW_CONFIG_PATH;
  delete process.env.OPENBOT_STATE_DIR;
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function flagConfig(root: string): OpenBotConfig {
  return {
    agents: { defaults: { workspace: path.join(root, "agent-ws") } },
    gateway: { security: { profile: "personal_local" } },
    collaboration: {
      defaults: { workspace: path.join(root, "collaboration") },
      runtimeNamespace: true,
      task: { claimContract: true },
    },
  } as OpenBotConfig;
}

async function useConfig(): Promise<{ cfg: OpenBotConfig; groupId: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-owner-decision-"));
  tempDirs.push(root);
  process.env.OPENBOT_STATE_DIR = path.join(root, "state");
  const cfg = flagConfig(root);
  const configPath = path.join(root, "openbot.json");
  await fs.writeFile(configPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
  process.env.OPENBOT_CONFIG_PATH = configPath;
  process.env.OPENCLAW_CONFIG_PATH = configPath;
  setRuntimeConfigSnapshot(cfg, cfg);
  clearConfigCache();
  return { cfg, groupId: "grp-owner-decision" };
}

describe("emitOwnerDecisionCardForProposedTodolist", () => {
  test("writes ownerDecision + @mention into group public transcript", async () => {
    const { cfg, groupId } = await useConfig();
    const { fileStore } = createWorkspaceCollaborationStores(cfg);
    const ownerId = "daniel.hhd@gmail.com";
    const state = makeOperatingState({
      groupId,
      governance: { coordinatorBotId: ownerId },
    });
    state.memberRoleMap = [
      {
        memberId: ownerId,
        memberKind: "human",
        governanceRole: "owner",
        collaborationRole: null,
        status: "active",
      },
    ];
    await writeGroupOperatingState({
      fileStore,
      groupId,
      state,
    });
    await fileStore.writeGroupFile({
      groupId,
      filename: "members.json",
      data: [
        {
          memberId: ownerId,
          memberKind: "human",
          userId: ownerId,
          name: "CEO",
          governanceRole: "owner",
          status: "active",
        },
        {
          memberId: "bot",
          memberKind: "bot",
          agentId: "bot",
          name: "高级秘书",
          governanceRole: "member",
          status: "active",
        },
      ],
    });

    const todolist: ExecutorPrivateTodolist = {
      todolistId: "td-emit-1",
      boardItemId: "board-emit-1",
      taskId: "task-emit-1",
      groupId,
      ownerMemberId: "bot-executor",
      status: "proposed",
      steps: [{ stepId: "s1", title: "产出摘要", status: "pending" }],
      proposedBy: "bot-executor",
      proposedAt: Date.now(),
      version: 1,
      visibility: "executor_private",
    };

    const result = await emitOwnerDecisionCardForProposedTodolist({
      groupId,
      todolist,
      cfg,
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.skipped) {
      throw new Error(`expected emit ok, got ${JSON.stringify(result)}`);
    }
    expect(result.card.mentionMemberIds).toContain(ownerId);
    expect(result.card.mentionLabels?.[0]).toBe("CEO");
    expect(result.card.mentionLabels?.join(" ")).not.toContain("@");
    expect(result.card.summary.every((line) => line.endsWith("；") || line.startsWith("（"))).toBe(
      true,
    );

    const transcriptPath = resolveGroupPublicTranscriptPath(groupId, cfg);
    const body = await fs.readFile(transcriptPath, "utf8");
    expect(body).toContain("ownerDecision");
    expect(body).toContain("@CEO");
    expect(body).not.toContain(`@${ownerId}`);
    expect(body).toContain("```owner-decision");
    expect(body).toContain("td-emit-1");
    expect(body).not.toMatch(/^- \d+\./m);

    const again = await emitOwnerDecisionCardForProposedTodolist({
      groupId,
      todolist,
      cfg,
    });
    expect(again.ok).toBe(true);
    if (again.ok) {
      expect(again.skipped).toBe(true);
    }
  });

  test("skips when no active confirmer is available", async () => {
    const { cfg, groupId } = await useConfig();
    const { fileStore } = createWorkspaceCollaborationStores(cfg);
    const state = makeOperatingState({
      groupId,
      governance: { coordinatorBotId: "ghost-coord" },
    });
    state.memberRoleMap = [];
    await writeGroupOperatingState({ fileStore, groupId, state });

    const todolist: ExecutorPrivateTodolist = {
      todolistId: "td-emit-2",
      boardItemId: "board-emit-2",
      taskId: "task-emit-2",
      groupId,
      ownerMemberId: "bot-executor",
      status: "proposed",
      steps: [{ stepId: "s1", title: "产出摘要", status: "pending" }],
      proposedBy: "bot-executor",
      proposedAt: Date.now(),
      version: 1,
      visibility: "executor_private",
    };

    const result = await emitOwnerDecisionCardForProposedTodolist({
      groupId,
      todolist,
      cfg,
    });
    expect(result).toEqual({ ok: true, skipped: true, reason: "no_active_confirmer" });
  });
});
