/**
 * C2 — Wake Contract ledger tests.
 * Flag-off refuses writes; assistant inline @ freeze; who-woke-whom timeline.
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
import { createRuntimeAuthority, type RuntimeAuthority } from "./runtime-authority.js";
import {
  assistantInlineAtCreatesRound,
  detectStitchOnly,
  isCollabTaskAssistantMentionDispatchEnabled,
  isCollabTaskWakeContractEnabled,
  listWakeEvents,
  markStitchOnlyIfNoPeerWake,
  observeAssistantInlineAtMentions,
  planAssistantMentionTargets,
  recordNudgeWake,
  recordStructuredMentionWake,
  recordWakeEvent,
  shouldDispatchAssistantMention,
  whoWokeWhom,
} from "./wake-contract.js";

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

async function useConfig(opts: {
  wakeContract?: boolean;
  assistantMentionDispatch?: boolean;
}): Promise<{ root: string; cfg: OpenBotConfig }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-c2-wake-"));
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
  return { root, cfg };
}

function authority(cfg: OpenBotConfig, groupId = "grp_wake"): RuntimeAuthority {
  const snapshot = createRoundPolicySnapshot(
    { collaborationMode: "task_driven", finalDecisionMode: "human_required" },
    { now: 1, idGen: () => "pss_wake_test" },
  );
  return createRuntimeAuthority({
    snapshot,
    episodeId: "ep_wake",
    tenant: { tenantId: null, trust: "none" },
    groupId,
    profile: "personal_local",
    cfg,
  });
}

describe("C2 Wake Contract", () => {
  test("AS-IS freeze: assistant inline @ does not create rounds", () => {
    expect(assistantInlineAtCreatesRound()).toBe(false);
  });

  test("flags default OFF", async () => {
    const { cfg } = await useConfig({});
    expect(isCollabTaskWakeContractEnabled(cfg)).toBe(false);
    expect(isCollabTaskAssistantMentionDispatchEnabled(cfg)).toBe(false);
    expect(shouldDispatchAssistantMention(cfg)).toBe(false);
  });

  test("flag-off: recordWakeEvent refuses and writes nothing", async () => {
    const { cfg } = await useConfig({ wakeContract: false });
    const auth = authority(cfg);
    const result = await recordWakeEvent(
      auth,
      {
        groupId: "grp_wake",
        fromAgentId: "ceo",
        toAgentIds: ["bot-2"],
        source: "nudge",
      },
      { cfg },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("flag_off");
    }
    const listed = await listWakeEvents(auth, { groupId: "grp_wake" });
    expect(listed).toEqual([]);
  });

  test("flag-on: structured mention + whoWokeWhom timeline", async () => {
    const { cfg } = await useConfig({ wakeContract: true });
    const auth = authority(cfg);
    const recorded = await recordStructuredMentionWake(
      auth,
      {
        groupId: "grp_wake",
        fromAgentId: "human-ceo",
        toAgentIds: ["bot-secretary", "bot-analyst"],
        taskId: "task-1",
        relatedId: "round_1",
      },
      { cfg, nowMs: 1000 },
    );
    expect(recorded.ok).toBe(true);
    const nudge = await recordNudgeWake(
      auth,
      {
        groupId: "grp_wake",
        fromAgentId: "human-ceo",
        toAgentIds: ["bot-analyst"],
        taskId: "task-1",
        reason: "催办交叉评议",
      },
      { cfg, nowMs: 2000 },
    );
    expect(nudge.ok).toBe(true);
    const events = await listWakeEvents(auth, { groupId: "grp_wake", taskId: "task-1" });
    expect(events).toHaveLength(2);
    const timeline = whoWokeWhom(events);
    expect(timeline.map((row) => `${row.from}->${row.to}:${row.source}`)).toEqual([
      "human-ceo->bot-secretary:structured_mention",
      "human-ceo->bot-analyst:structured_mention",
      "human-ceo->bot-analyst:nudge",
    ]);
  });

  test("assistantMentionDispatch OFF: observe as not_dispatched; plan denied", async () => {
    const { cfg } = await useConfig({
      wakeContract: true,
      assistantMentionDispatch: false,
    });
    const auth = authority(cfg);
    const plan = planAssistantMentionTargets("@市场助手 请补数据源", cfg);
    expect(plan.allowed).toBe(false);
    expect(plan.targets.length).toBeGreaterThan(0);
    const observed = await observeAssistantInlineAtMentions(
      auth,
      {
        groupId: "grp_wake",
        fromAgentId: "bot-secretary",
        text: "@市场助手 请交叉评议第2章",
        taskId: "task-1",
      },
      { cfg, nowMs: 3000 },
    );
    expect(observed.ok).toBe(true);
    if (observed.ok) {
      expect(observed.value?.outcome).toBe("not_dispatched");
      expect(observed.value?.source).toBe("assistant_inline_at");
    }
  });

  test("assistantMentionDispatch ON: plan allowed + dispatch_eligible", async () => {
    const { cfg } = await useConfig({
      wakeContract: true,
      assistantMentionDispatch: true,
    });
    expect(shouldDispatchAssistantMention(cfg)).toBe(true);
    const plan = planAssistantMentionTargets("@高密度分析 请互评", cfg);
    expect(plan.allowed).toBe(true);
    const auth = authority(cfg);
    const observed = await observeAssistantInlineAtMentions(
      auth,
      {
        groupId: "grp_wake",
        fromAgentId: "bot-secretary",
        text: "@高密度分析 请互评",
      },
      { cfg, nowMs: 4000 },
    );
    expect(observed.ok).toBe(true);
    if (observed.ok) {
      expect(observed.value?.outcome).toBe("dispatch_eligible");
    }
  });

  test("stitch_only when no peer wake between assign and submit", async () => {
    const { cfg } = await useConfig({ wakeContract: true });
    const auth = authority(cfg);
    // Self activity only — not a peer wake.
    await recordWakeEvent(
      auth,
      {
        groupId: "grp_wake",
        fromAgentId: "bot-analyst",
        toAgentIds: ["bot-analyst"],
        source: "claim",
        taskId: "task-1",
        itemId: "item-1",
      },
      { cfg, nowMs: 100 },
    );
    const eventsBefore = await listWakeEvents(auth, { groupId: "grp_wake" });
    expect(
      detectStitchOnly({
        events: eventsBefore,
        memberId: "bot-analyst",
        assignAt: 50,
        submitAt: 500,
      }),
    ).toBe(true);
    const marked = await markStitchOnlyIfNoPeerWake(
      auth,
      {
        groupId: "grp_wake",
        memberId: "bot-analyst",
        assignAt: 50,
        submitAt: 500,
        taskId: "task-1",
        itemId: "item-1",
        actorId: "system",
      },
      { cfg, nowMs: 600 },
    );
    expect(marked.ok).toBe(true);
    if (marked.ok) {
      expect(marked.value?.source).toBe("stitch_only");
      expect(marked.value?.stitchOnly).toBe(true);
      expect(marked.value?.outcome).toBe("observe_only");
    }
  });

  test("peer wake suppresses stitch_only", async () => {
    const { cfg } = await useConfig({ wakeContract: true });
    const auth = authority(cfg);
    await recordStructuredMentionWake(
      auth,
      {
        groupId: "grp_wake",
        fromAgentId: "bot-secretary",
        toAgentIds: ["bot-analyst"],
        taskId: "task-1",
      },
      { cfg, nowMs: 200 },
    );
    const events = await listWakeEvents(auth, { groupId: "grp_wake" });
    expect(
      detectStitchOnly({
        events,
        memberId: "bot-analyst",
        assignAt: 50,
        submitAt: 500,
      }),
    ).toBe(false);
    const marked = await markStitchOnlyIfNoPeerWake(
      auth,
      {
        groupId: "grp_wake",
        memberId: "bot-analyst",
        assignAt: 50,
        submitAt: 500,
        taskId: "task-1",
      },
      { cfg, nowMs: 700 },
    );
    expect(marked.ok).toBe(true);
    if (marked.ok) {
      expect(marked.value).toBeNull();
    }
  });
});
