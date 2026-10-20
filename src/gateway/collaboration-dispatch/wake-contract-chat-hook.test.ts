/**
 * C2 follow-up — chat.send wake wiring (unit; no live tip gw).
 */
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
import { createRoundPolicySnapshot } from "./round-policy-snapshot.js";
import { createRuntimeAuthority } from "./runtime-authority.js";
import type { CollaborationBotTarget } from "./types.js";
import {
  observeAssistantReplyWakeBestEffort,
  recordChatSendMentionWakesBestEffort,
  resolveChatSendWakeTargets,
} from "./wake-contract-chat-hook.js";
import { listWakeEvents, whoWokeWhom } from "./wake-contract.js";

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

function flagConfig(
  root: string,
  opts: { wakeContract?: boolean; assistantMentionDispatch?: boolean },
): OpenBotConfig {
  return {
    agents: { defaults: { workspace: path.join(root, "agent-ws") } },
    gateway: { security: { profile: "personal_local" } },
    collaboration: {
      defaults: { workspace: path.join(root, "collaboration") },
      runtimeNamespace: true,
      task: {
        ...(opts.wakeContract !== undefined ? { wakeContract: opts.wakeContract } : {}),
        ...(opts.assistantMentionDispatch !== undefined
          ? { assistantMentionDispatch: opts.assistantMentionDispatch }
          : {}),
      },
    },
  } as OpenBotConfig;
}

async function useConfig(opts: { wakeContract?: boolean; assistantMentionDispatch?: boolean }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-c2-wake-hook-"));
  tempDirs.push(root);
  process.env.OPENBOT_STATE_DIR = path.join(root, "state");
  delete process.env.OPENBOT_SECURITY_PROFILE;
  delete process.env.OPENCLAW_SECURITY_PROFILE;
  const cfg = flagConfig(root, opts);
  const configPath = path.join(root, "openbot.json");
  await fs.writeFile(configPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
  process.env.OPENBOT_CONFIG_PATH = configPath;
  process.env.OPENCLAW_CONFIG_PATH = configPath;
  setRuntimeConfigSnapshot(cfg, cfg);
  clearConfigCache();
  const authority = createRuntimeAuthority({
    snapshot: createRoundPolicySnapshot(
      { collaborationMode: "task_driven", finalDecisionMode: "human_required" },
      { now: 1, idGen: () => "pss_wake_hook_test" },
    ),
    episodeId: "ep_wake_hook_test",
    tenant: { tenantId: null, trust: "none" },
    groupId: "grp_wake_hook",
    profile: "personal_local",
    cfg,
  });
  return { root, cfg, authority };
}

const bots: CollaborationBotTarget[] = [
  { agentId: "bot_alpha", name: "Alpha", sessionKey: "agent:bot_alpha:main", updatedAt: 1 },
  { agentId: "bot_beta", name: "Beta", sessionKey: "agent:bot_beta:main", updatedAt: 1 },
  { agentId: "bot_gamma", name: "Gamma", sessionKey: "agent:bot_gamma:main", updatedAt: 1 },
];

describe("wake-contract-chat-hook", () => {
  test("resolveChatSendWakeTargets: plain-text @ and structured refs", () => {
    const plain = resolveChatSendWakeTargets({
      message: "请 @Alpha @Beta 交叉评议一下第三章",
      bots,
    });
    expect(plain.targets).toEqual(expect.arrayContaining(["bot_alpha", "bot_beta"]));
    expect(plain.targets.length).toBe(2);

    const structured = resolveChatSendWakeTargets({
      message: "催一下进度",
      explicitMentions: ["Gamma"],
      explicitMentionRefs: [{ agentId: "bot_gamma", displayName: "Gamma", targetKind: "agent" }],
      bots,
    });
    expect(structured.targets).toContain("bot_gamma");
  });

  test("flag-off: chat.send hook writes nothing", async () => {
    const { cfg, authority } = await useConfig({ wakeContract: false });
    const result = await recordChatSendMentionWakesBestEffort({
      authority,
      cfg,
      groupId: "grp_wake_hook",
      fromAgentId: "human_ops",
      message: "@Alpha 请尽快提交",
      bots,
      relatedId: "run_off",
    });
    expect(result.recorded).toBe(false);
    const events = await listWakeEvents(authority, { groupId: "grp_wake_hook" });
    expect(events).toHaveLength(0);
  });

  test("flag-on: structured multi-@ writes structured_mention + nudge; whoWokeWhom readable", async () => {
    const { cfg, authority } = await useConfig({ wakeContract: true });
    const result = await recordChatSendMentionWakesBestEffort({
      authority,
      cfg,
      groupId: "grp_wake_hook",
      fromAgentId: "human_ops",
      message: "@Alpha @Beta 请交叉评议并催办进度",
      bots,
      relatedId: "run_multi",
      taskId: "task_wake_1",
    });
    expect(result.recorded).toBe(true);
    expect(result.targetCount).toBe(2);
    const events = await listWakeEvents(authority, {
      groupId: "grp_wake_hook",
      taskId: "task_wake_1",
    });
    expect(events.some((e) => e.source === "structured_mention")).toBe(true);
    expect(events.some((e) => e.source === "nudge")).toBe(true);
    const timeline = whoWokeWhom(events);
    expect(timeline.length).toBeGreaterThanOrEqual(2);
    expect(timeline.every((row) => row.from === "human_ops")).toBe(true);
    expect(timeline.map((row) => row.to).toSorted()).toEqual(
      expect.arrayContaining(["bot_alpha", "bot_beta"]),
    );
  });

  test("flag-on + assistantMentionDispatch off: assistant @ observed as not_dispatched", async () => {
    const { cfg, authority } = await useConfig({
      wakeContract: true,
      assistantMentionDispatch: false,
    });
    await observeAssistantReplyWakeBestEffort({
      authority,
      cfg,
      groupId: "grp_wake_hook",
      fromAgentId: "bot_alpha",
      text: "我搞定了，请 @Beta 接着写第四章",
      relatedId: "run_asst",
    });
    const events = await listWakeEvents(authority, { groupId: "grp_wake_hook" });
    expect(events).toHaveLength(1);
    expect(events[0]?.source).toBe("assistant_inline_at");
    expect(events[0]?.outcome).toBe("not_dispatched");
  });

  test("flag-on + assistantMentionDispatch on: assistant @ is dispatch_eligible", async () => {
    const { cfg, authority } = await useConfig({
      wakeContract: true,
      assistantMentionDispatch: true,
    });
    await observeAssistantReplyWakeBestEffort({
      authority,
      cfg,
      groupId: "grp_wake_hook",
      fromAgentId: "bot_alpha",
      text: "请 @Gamma 补充数据源清单",
      relatedId: "run_asst_on",
    });
    const events = await listWakeEvents(authority, { groupId: "grp_wake_hook" });
    expect(events).toHaveLength(1);
    expect(events[0]?.outcome).toBe("dispatch_eligible");
  });
});
