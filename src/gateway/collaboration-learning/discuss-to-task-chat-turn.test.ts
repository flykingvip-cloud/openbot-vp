/**
 * Actual chat-turn helper integration (not format-only).
 * Covers flag-off, exception, duplicate request, receipt persist failure.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearConfigCache,
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { runControlledDiscussToTaskChatTurn } from "./discuss-to-task-chat-turn.js";
import { clearDiscussToTaskSourceBindingsForTests } from "./discuss-to-task-source-binding.js";
import { createTrustedGroupStores } from "./team-resource-auth.js";

const tempDirs: string[] = [];
const EXPLICIT = "请团队正式开展市场调研，验收标准：1) 竞品清单 2) 定价建议报告";

afterEach(async () => {
  clearDiscussToTaskSourceBindingsForTests();
  clearRuntimeConfigSnapshot();
  clearConfigCache();
  await Promise.all(tempDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

async function useCfg(claimContract: boolean) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-d2t-chat-turn-"));
  tempDirs.push(root);
  const groupsRoot = path.join(root, "collaboration", "groups");
  const groupLocator = path.join(groupsRoot, "grp_chat");
  await fs.mkdir(groupLocator, { recursive: true });
  const cfg = {
    agents: { defaults: { workspace: path.join(root, "agent-ws") } },
    gateway: { security: { profile: "personal_local" } },
    collaboration: {
      defaults: { workspace: path.join(root, "collaboration") },
      runtimeNamespace: true,
      task: { claimContract },
    },
  } as OpenBotConfig;
  const configPath = path.join(root, "openbot.json");
  await fs.writeFile(configPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
  process.env.OPENBOT_CONFIG_PATH = configPath;
  process.env.OPENCLAW_CONFIG_PATH = configPath;
  setRuntimeConfigSnapshot(cfg, cfg);
  clearConfigCache();
  return {
    cfg,
    trusted: { groupsRoot, groupLocator },
    stores: createTrustedGroupStores({ groupsRoot, groupLocator }),
  };
}

describe("runControlledDiscussToTaskChatTurn (chat handler path)", () => {
  it("flag-off / blocked: no 已派工 in visible receipt or coordinator bind", async () => {
    const { cfg } = await useCfg(false);
    const persisted: string[] = [];
    const turn = await runControlledDiscussToTaskChatTurn({
      groupId: "grp_chat",
      sourceMessageId: "chat-run-flag-off",
      message: EXPLICIT,
      principalActor: "human:owner",
      client: {},
      tenant: null,
      cfg,
      persistReceipt: async ({ message }) => {
        persisted.push(message);
        return { ok: true };
      },
    });
    expect(turn.userVisibleMessage ?? "").not.toMatch(/已派工/);
    if (turn.formalTaskEstablish) {
      expect(turn.formalTaskEstablish.userMessage ?? "").not.toMatch(/已派工/);
      expect(turn.coordinatorBindingText ?? "").toMatch(/禁止|回执/);
    }
    for (const row of persisted) {
      expect(row).not.toMatch(/已派工/);
    }
  });

  it("duplicate request: same principal ok; different principal conflicts", async () => {
    const { cfg } = await useCfg(true);
    await runControlledDiscussToTaskChatTurn({
      groupId: "grp_chat",
      sourceMessageId: "chat-run-dup",
      message: EXPLICIT,
      principalActor: "human:alice",
      client: {},
      tenant: null,
      cfg,
      persistReceipt: async () => ({ ok: true }),
    });
    const steal = await runControlledDiscussToTaskChatTurn({
      groupId: "grp_chat",
      sourceMessageId: "chat-run-dup",
      message: EXPLICIT,
      principalActor: "human:bob",
      client: {},
      tenant: null,
      cfg,
      persistReceipt: async () => ({ ok: true }),
    });
    expect(steal.formalTaskEstablish?.reason).toMatch(/source_owner_conflict/);
    expect(steal.userVisibleMessage ?? "").toMatch(/归属冲突|冲突|受阻/);
    expect(steal.userVisibleMessage ?? "").not.toMatch(/已派工/);
    const retry = await runControlledDiscussToTaskChatTurn({
      groupId: "grp_chat",
      sourceMessageId: "chat-run-dup",
      message: EXPLICIT,
      principalActor: "human:alice",
      client: {},
      tenant: null,
      cfg,
      persistReceipt: async () => ({ ok: true }),
    });
    expect(retry.formalTaskEstablish?.reason).not.toBe("source_owner_conflict");
  });

  it("receipt persist failure surfaces in user-visible message", async () => {
    const { cfg } = await useCfg(true);
    const turn = await runControlledDiscussToTaskChatTurn({
      groupId: "grp_chat",
      sourceMessageId: "chat-run-persist-fail",
      message: EXPLICIT,
      principalActor: "human:owner",
      client: {},
      tenant: null,
      cfg,
      persistReceipt: async () => ({ ok: false, error: "disk_full" }),
    });
    expect(turn.transcriptPersist?.ok).toBe(false);
    if (turn.d2tResult) {
      expect(turn.userVisibleMessage ?? "").toMatch(/展示写入失败/);
      expect(turn.userVisibleMessage ?? "").toMatch(/disk_full/);
    }
  });

  it("exception path returns blocked without 已派工", async () => {
    const turn = await runControlledDiscussToTaskChatTurn({
      groupId: "grp_chat",
      sourceMessageId: "chat-run-boom",
      message: EXPLICIT,
      principalActor: "human:owner",
      client: {},
      tenant: null,
      cfg: null as unknown as OpenBotConfig,
      persistReceipt: async () => ({ ok: true }),
    });
    const blob = (turn.userVisibleMessage ?? "") + (turn.formalTaskEstablish?.userMessage ?? "");
    expect(blob).not.toMatch(/已派工/);
  });
});
