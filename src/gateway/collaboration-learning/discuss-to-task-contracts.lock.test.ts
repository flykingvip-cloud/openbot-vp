/**
 * P1 #164 contract matrix lock — Step 3.
 * Explicit named proofs for the five user contracts + historical R4/R5 review items.
 * Reuses real-storage / egress helpers; does NOT build a second dispatcher.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Task } from "@openbot/collaboration-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COLLABORATION_BOARD_TOOL } from "../../agents/tools/collaboration-board-tool.js";
import {
  clearConfigCache,
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { controlledDiscussToTask } from "./controlled-discuss-to-task.js";
import {
  emitDiscussToTaskClientFeedback,
  RECEIPT_PERSIST_FAIL_SUFFIX,
} from "./discuss-to-task-chat-turn.js";
import { mintDiscussToTaskId } from "./discuss-to-task-id.js";
import { FORMAL_TASK_FLAG_OFF_USER_MESSAGE } from "./discuss-to-task-receipt.js";
import { clearDiscussToTaskSourceBindingsForTests } from "./discuss-to-task-source-binding.js";
import { createTrustedGroupStores } from "./team-resource-auth.js";

const tempDirs: string[] = [];
const saved = {
  state: process.env.OPENBOT_STATE_DIR,
  cfg: process.env.OPENBOT_CONFIG_PATH,
  claw: process.env.OPENCLAW_CONFIG_PATH,
  sec: process.env.OPENBOT_SECURITY_PROFILE,
  leg: process.env.OPENCLAW_SECURITY_PROFILE,
};

afterEach(async () => {
  clearDiscussToTaskSourceBindingsForTests();
  clearRuntimeConfigSnapshot();
  clearConfigCache();
  const restore = (key: keyof typeof saved, env: string) => {
    const v = saved[key];
    if (v === undefined) {
      delete process.env[env];
    } else {
      process.env[env] = v;
    }
  };
  restore("state", "OPENBOT_STATE_DIR");
  restore("cfg", "OPENBOT_CONFIG_PATH");
  restore("claw", "OPENCLAW_CONFIG_PATH");
  restore("sec", "OPENBOT_SECURITY_PROFILE");
  restore("leg", "OPENCLAW_SECURITY_PROFILE");
  await Promise.all(tempDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
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

async function useTrusted(claimContract: boolean) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-d2t-contracts-"));
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
  await fs.mkdir(path.join(root, "collaboration", "groups"), { recursive: true });
  const groupsRoot = path.join(root, "collaboration", "groups");
  const groupLocator = path.join(groupsRoot, "grp_d2t");
  await fs.mkdir(groupLocator, { recursive: true });
  return { root, cfg, trusted: { groupsRoot, groupLocator } };
}

const EXPLICIT =
  "请两名成员协作完成短 Markdown 提纲\n验收标准：\n- 成员A写背景\n- 成员B写结论\n- 汇总不超过 400 字";

describe("P1 #164 contracts lock (Step 3)", () => {
  describe("C1 明确委托进入正式任务", () => {
    it("explicit delegation establishes formal task (needs_confirm default; not discuss-only)", async () => {
      const { cfg, trusted } = await useTrusted(true);
      const result = await controlledDiscussToTask({
        sourceMessageId: "contracts-c1-explicit",
        groupId: "grp_d2t",
        tenantId: "_local",
        actor: "human:owner",
        message: EXPLICIT,
        forceExplicit: true,
        trusted,
        cfg,
      });
      expect(result.attempted).toBe(true);
      expect(result.taskId).toBeTruthy();
      expect(result.stages.taskEstablished).toBe(true);
      expect(result.statusCode).not.toBe("discussion_only");
      expect(result.userMessage).not.toMatch(/已派工/);
      const stores = createTrustedGroupStores({
        groupsRoot: trusted.groupsRoot,
        groupLocator: trusted.groupLocator,
      });
      const task = await stores.objectStorage.readObject<Task>("grp_d2t", "task", result.taskId!);
      expect(task).not.toBeNull();
    });
  });

  describe("C2 旗关真实受阻", () => {
    it("flag-off blocks with fixed copy; no task object written", async () => {
      const { cfg, trusted } = await useTrusted(false);
      const result = await controlledDiscussToTask({
        sourceMessageId: "contracts-c2-flag-off",
        groupId: "grp_d2t",
        tenantId: "_local",
        actor: "human:owner",
        message: EXPLICIT,
        forceExplicit: true,
        trusted,
        cfg,
      });
      expect(result.internalReason).toBe("claim_contract_flag_off");
      expect(result.statusCode).toBe("formal_task_blocked_flag_off");
      expect(result.userMessage).toBe(FORMAL_TASK_FLAG_OFF_USER_MESSAGE);
      expect(result.activation).toBeNull();
      expect(result.taskId).toBeNull();
      expect(result.stages.taskEstablished).toBe(false);
      expect(result.stages.boardPublished).toBe(false);
      const wouldBe = mintDiscussToTaskId({
        tenantId: "_local",
        groupId: "grp_d2t",
        sourceMessageId: "contracts-c2-flag-off",
      });
      const stores = createTrustedGroupStores({
        groupsRoot: trusted.groupsRoot,
        groupLocator: trusted.groupLocator,
      });
      expect(await stores.objectStorage.readObject<Task>("grp_d2t", "task", wouldBe)).toBeNull();
    });
  });

  describe("C3 来源幂等", () => {
    it("same sourceMessageId sequential retry builds once", async () => {
      const { cfg, trusted } = await useTrusted(true);
      const input = {
        sourceMessageId: "contracts-c3-idem",
        groupId: "grp_d2t",
        tenantId: "_local",
        actor: "human:owner",
        message: EXPLICIT,
        forceExplicit: true as const,
        trusted,
        cfg,
      };
      const first = await controlledDiscussToTask(input);
      const second = await controlledDiscussToTask(input);
      expect(first.taskId).toBeTruthy();
      expect(second.taskId).toBe(first.taskId);
    });
  });

  describe("C4 失败可见（含 persist-fail + 客户端实收 + 固定文案）", () => {
    it("emitDiscussToTaskClientFeedback delivers fixed persist-fail copy via broadcast+node; no raw error", () => {
      const broadcasts: Array<{ payload: Record<string, unknown> }> = [];
      const nodeSends: Array<{ payload: Record<string, unknown> }> = [];
      const safeBase = "正式任务已建立，待确认后继续。";
      const clientFeedbackMessage = `${safeBase}${RECEIPT_PERSIST_FAIL_SUFFIX}`;
      const emitted = emitDiscussToTaskClientFeedback({
        applied: {
          formalTaskEstablish: {
            attempted: true,
            status: "established",
            taskId: "task-x",
            userMessage: clientFeedbackMessage,
          },
          clientFeedbackMessage,
          transcriptPersist: { ok: false, error: "EACCES /secret/path boom" },
        },
        sessionKey: "space:grp_d2t",
        runId: "run-parent-c4",
        broadcastChat: (_ch, payload) => {
          broadcasts.push({ payload: payload as Record<string, unknown> });
        },
        nodeSendToSession: (_sk, _ev, payload) => {
          nodeSends.push({ payload: payload as Record<string, unknown> });
        },
      });
      expect(emitted.emitted).toBe(true);
      expect(broadcasts).toHaveLength(1);
      expect(nodeSends).toHaveLength(1);
      expect(broadcasts[0].payload.state).toBe("status");
      const blob = JSON.stringify(broadcasts[0].payload) + JSON.stringify(nodeSends[0].payload);
      expect(blob).toContain(RECEIPT_PERSIST_FAIL_SUFFIX);
      expect(blob).toMatch(/展示写入失败/);
      expect(blob).not.toMatch(/EACCES/);
      expect(blob).not.toMatch(/\/secret\/path/);
    });
  });

  describe("C5 状态回执不结束主 run", () => {
    it("egress emits state:status (not final) with receipt runId suffix", () => {
      // Frontend isTerminalChatEventState("status")===false locked in
      // ui/src/ui/chat-event-reload.test.ts + chat.test.ts R6/R7 suite.
      const broadcasts: Array<{ payload: Record<string, unknown> }> = [];
      emitDiscussToTaskClientFeedback({
        applied: {
          clientFeedbackMessage: FORMAL_TASK_FLAG_OFF_USER_MESSAGE,
          formalTaskEstablish: {
            attempted: true,
            status: "blocked",
            taskId: null,
            userMessage: FORMAL_TASK_FLAG_OFF_USER_MESSAGE,
          },
        },
        sessionKey: "space:grp_d2t",
        runId: "run-parent-c5",
        broadcastChat: (_ch, payload) => {
          broadcasts.push({ payload: payload as Record<string, unknown> });
        },
        nodeSendToSession: vi.fn(),
      });
      expect(broadcasts[0]?.payload.state).toBe("status");
      expect(broadcasts[0]?.payload.state).not.toBe("final");
      expect(String(broadcasts[0]?.payload.runId)).toContain("discuss-to-task-receipt");
      expect(
        (broadcasts[0]?.payload.message as { discussToTaskReceipt?: boolean } | undefined)
          ?.discussToTaskReceipt,
      ).toBe(true);
    });
  });

  describe("R4/R5 historical — createOpenClawTools collaboration_board (no rebuild)", () => {
    it("composition tool name constant remains collaboration_board (execution covered by injection.test)", () => {
      expect(COLLABORATION_BOARD_TOOL).toBe("collaboration_board");
    });
  });
});
