/**
 * C3 — assistantMentionDispatch consumer (unit; no live tip gw).
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
import {
  ASSISTANT_MENTION_EDGE_REASON,
  attachPrimaryEdgesWithAssistantMentionConsumer,
  buildAssistantMentionPeerAskEdges,
  planAssistantMentionDispatch,
} from "./assistant-mention-dispatch.js";
import { createRoundPolicySnapshot } from "./round-policy-snapshot.js";
import { createRuntimeAuthority } from "./runtime-authority.js";
import type { CollaborationBotTarget } from "./types.js";
import { observeAssistantReplyWakeBestEffort } from "./wake-contract-chat-hook.js";
import { assistantInlineAtCreatesRound, listWakeEvents } from "./wake-contract.js";

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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-c3-amd-"));
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
      { now: 1, idGen: () => "pss_c3_amd_test" },
    ),
    episodeId: "ep_c3_amd_test",
    tenant: { tenantId: null, trust: "none" },
    groupId: "grp_c3_amd",
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

describe("assistant-mention-dispatch consumer", () => {
  test("assistantInlineAtCreatesRound stays frozen false", () => {
    expect(assistantInlineAtCreatesRound()).toBe(false);
  });

  test("flag OFF: plan denied; attach keeps directive-only edges", () => {
    const cfg = flagConfig("/tmp/c3-amd-off", { assistantMentionDispatch: false });
    const plan = planAssistantMentionDispatch({
      text: "请 @Beta 接着改第四章",
      fromAgentId: "bot_alpha",
      bots,
      cfg,
    });
    expect(plan.allowed).toBe(false);
    expect(plan.targets).toHaveLength(0);

    const attached = attachPrimaryEdgesWithAssistantMentionConsumer({
      primaryText:
        "结论：可行。\n[[collab_edge:peer_ask|to=bot_gamma|reason=补数据]]\n请 @Beta 也看一眼",
      fromAgentId: "bot_alpha",
      bots,
      cfg,
    });
    expect(attached.consumerActive).toBe(false);
    expect(attached.dispatchedAgentIds).toHaveLength(0);
    expect(attached.edges).toHaveLength(1);
    expect(attached.edges[0]?.toAgentId).toBe("bot_gamma");
    expect(attached.edges[0]?.reason).toBe("补数据");
  });

  test("flag ON: resolves @Name to bots; skips self and broadcast", () => {
    const cfg = flagConfig("/tmp/c3-amd-on", { assistantMentionDispatch: true });
    const plan = planAssistantMentionDispatch({
      text: "我写完了，请 @Beta @所有人 @Alpha 交叉评议",
      fromAgentId: "bot_alpha",
      bots,
      cfg,
    });
    expect(plan.allowed).toBe(true);
    expect(plan.targets.map((b) => b.agentId)).toEqual(["bot_beta"]);
  });

  test("flag ON: unmatched tokens stay ineligible for edges", () => {
    const cfg = flagConfig("/tmp/c3-amd-miss", { assistantMentionDispatch: true });
    const plan = planAssistantMentionDispatch({
      text: "请 @不存在的助手 补充",
      fromAgentId: "bot_alpha",
      bots,
      cfg,
    });
    expect(plan.allowed).toBe(false);
    expect(plan.targets).toHaveLength(0);

    const attached = attachPrimaryEdgesWithAssistantMentionConsumer({
      primaryText: "请 @不存在的助手 补充",
      fromAgentId: "bot_alpha",
      bots,
      cfg,
    });
    expect(attached.consumerActive).toBe(true);
    expect(attached.edges).toHaveLength(0);
  });

  test("build peer_ask edges carry assistant_inline_at reason", () => {
    const edges = buildAssistantMentionPeerAskEdges({
      fromAgentId: "bot_alpha",
      targets: [bots[1], bots[2]],
    });
    expect(edges).toHaveLength(2);
    expect(edges.every((e) => e.kind === "peer_ask")).toBe(true);
    expect(edges.every((e) => e.reason === ASSISTANT_MENTION_EDGE_REASON)).toBe(true);
    expect(edges.every((e) => e.depth === 1)).toBe(true);
  });

  test("attach merges @mention peer_ask under budget ≤2 with directives", () => {
    const cfg = flagConfig("/tmp/c3-amd-budget", { assistantMentionDispatch: true });
    const attached = attachPrimaryEdgesWithAssistantMentionConsumer({
      primaryText:
        "结论：OK\n[[collab_edge:peer_ask|to=bot_gamma|reason=directive]]\n请 @Beta 补充口径",
      fromAgentId: "bot_alpha",
      bots,
      cfg,
    });
    expect(attached.edges.length).toBeLessThanOrEqual(2);
    expect(attached.edges.some((e) => e.toAgentId === "bot_gamma")).toBe(true);
    expect(attached.edges.some((e) => e.toAgentId === "bot_beta")).toBe(true);
    expect(attached.dispatchedAgentIds).toContain("bot_beta");
  });

  test("observe with bots + flag ON → wake outcome dispatched", async () => {
    const { cfg, authority } = await useConfig({
      wakeContract: true,
      assistantMentionDispatch: true,
    });
    await observeAssistantReplyWakeBestEffort({
      authority,
      cfg,
      groupId: "grp_c3_amd",
      fromAgentId: "bot_alpha",
      text: "请 @Gamma 补充数据源清单",
      relatedId: "run_c3_dispatch",
      bots,
    });
    const events = await listWakeEvents(authority, { groupId: "grp_c3_amd" });
    expect(events).toHaveLength(1);
    expect(events[0]?.source).toBe("assistant_inline_at");
    expect(events[0]?.outcome).toBe("dispatched");
    expect(events[0]?.toAgentIds).toEqual(["bot_gamma"]);
  });

  test("observe without bots + flag ON → still dispatch_eligible", async () => {
    const { cfg, authority } = await useConfig({
      wakeContract: true,
      assistantMentionDispatch: true,
    });
    await observeAssistantReplyWakeBestEffort({
      authority,
      cfg,
      groupId: "grp_c3_amd",
      fromAgentId: "bot_alpha",
      text: "请 @Gamma 补充数据源清单",
      relatedId: "run_c3_eligible",
    });
    const events = await listWakeEvents(authority, { groupId: "grp_c3_amd" });
    expect(events).toHaveLength(1);
    expect(events[0]?.outcome).toBe("dispatch_eligible");
  });

  test("observe flag OFF → not_dispatched even with bots", async () => {
    const { cfg, authority } = await useConfig({
      wakeContract: true,
      assistantMentionDispatch: false,
    });
    await observeAssistantReplyWakeBestEffort({
      authority,
      cfg,
      groupId: "grp_c3_amd",
      fromAgentId: "bot_alpha",
      text: "请 @Beta 接着写",
      bots,
    });
    const events = await listWakeEvents(authority, { groupId: "grp_c3_amd" });
    expect(events).toHaveLength(1);
    expect(events[0]?.outcome).toBe("not_dispatched");
  });
});
