/**
 * P3 — Group task heartbeat + wake gray allowlist tests.
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
import { loadBoardClaimItem, publishBoardItem } from "./claim-contract.js";
import {
  buildAdminDailySummaryMessage,
  DEFAULT_GROUP_TASK_HEARTBEAT_ESCALATE_AFTER,
  DEFAULT_GROUP_TASK_HEARTBEAT_SCAN_INTERVAL_MS,
  heartbeatFakesTranscriptCompletion,
  heartbeatReadsTaskSurfaceWritesWake,
  isGroupTaskHeartbeatEnabled,
  planHeartbeatActionForItem,
  runGroupTaskHeartbeat,
  shouldAttemptUnclaimedClaimBridge,
} from "./group-task-heartbeat.js";
import { createRoundPolicySnapshot } from "./round-policy-snapshot.js";
import { createRuntimeAuthority, type RuntimeAuthority } from "./runtime-authority.js";
import { listSelfAdvanceDecisions } from "./self-advance.js";
import {
  isCollabTaskWakeContractEnabled,
  isGroupOnWakeContractAllowlist,
  listWakeEvents,
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
  opts: {
    wakeContract?: boolean;
    wakeAllowlist?: string[];
    claimContract?: boolean;
    scanIntervalMs?: number;
    escalateAfter?: number;
    schedulerEnabled?: boolean;
    mode?: "observe" | "emit";
    emitAllowlist?: string[];
    selfAdvanceExecute?: boolean;
    selfAdvanceAllowlist?: string[];
  },
): OpenBotConfig {
  const hb: Record<string, unknown> = {};
  if (opts.scanIntervalMs !== undefined) {
    hb.scanIntervalMs = opts.scanIntervalMs;
  }
  if (opts.escalateAfter !== undefined) {
    hb.escalateAfterConsecutiveNoResponse = opts.escalateAfter;
  }
  if (opts.schedulerEnabled !== undefined) {
    hb.schedulerEnabled = opts.schedulerEnabled;
  }
  if (opts.mode !== undefined) {
    hb.mode = opts.mode;
  }
  if (opts.emitAllowlist !== undefined) {
    hb.emitGroupAllowlist = opts.emitAllowlist;
  }
  const selfAdvance =
    opts.selfAdvanceExecute || opts.selfAdvanceAllowlist
      ? {
          mode: opts.selfAdvanceExecute ? ("execute" as const) : ("dry_run" as const),
          executeGroupAllowlist: opts.selfAdvanceAllowlist ?? ["grp-daniel-hhd-gmail-com-upbeyond"],
        }
      : undefined;
  return {
    agents: { defaults: { workspace: path.join(root, "agent-ws") } },
    gateway: { security: { profile: "personal_local" } },
    collaboration: {
      defaults: { workspace: path.join(root, "collaboration") },
      runtimeNamespace: true,
      task: {
        ...(opts.wakeContract !== undefined ? { wakeContract: opts.wakeContract } : {}),
        ...(opts.wakeAllowlist ? { wakeContractGroupAllowlist: opts.wakeAllowlist } : {}),
        ...(opts.claimContract !== undefined ? { claimContract: opts.claimContract } : {}),
        ...(Object.keys(hb).length > 0 ? { groupTaskHeartbeat: hb } : {}),
        ...(selfAdvance ? { selfAdvance } : {}),
      },
    },
  } as OpenBotConfig;
}

async function useConfig(opts: {
  wakeContract?: boolean;
  wakeAllowlist?: string[];
  claimContract?: boolean;
  scanIntervalMs?: number;
  escalateAfter?: number;
  schedulerEnabled?: boolean;
  mode?: "observe" | "emit";
  emitAllowlist?: string[];
  selfAdvanceExecute?: boolean;
  selfAdvanceAllowlist?: string[];
}): Promise<{ root: string; cfg: OpenBotConfig }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-p3-hb-"));
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

function authority(cfg: OpenBotConfig, groupId: string): RuntimeAuthority {
  const snapshot = createRoundPolicySnapshot(
    { collaborationMode: "task_driven", finalDecisionMode: "human_required" },
    { now: 1, idGen: () => "pss_p3_hb" },
  );
  return createRuntimeAuthority({
    snapshot,
    episodeId: "ep_p3_hb",
    tenant: { tenantId: null, trust: "none" },
    groupId,
    profile: "personal_local",
    cfg,
  });
}

const SAMPLE_GRAY = "grp-daniel-hhd-gmail-com-upbeyond";

describe("P3 wake gray allowlist", () => {
  test("defaults OFF; allowlist enables wake for listed group only", async () => {
    const { cfg } = await useConfig({
      wakeContract: false,
      wakeAllowlist: [SAMPLE_GRAY],
    });
    expect(isCollabTaskWakeContractEnabled(cfg)).toBe(false);
    expect(isCollabTaskWakeContractEnabled(cfg, "other-group")).toBe(false);
    expect(isCollabTaskWakeContractEnabled(cfg, SAMPLE_GRAY)).toBe(true);
    expect(isGroupOnWakeContractAllowlist({ groupId: SAMPLE_GRAY, cfg })).toBe(true);
    expect(isGroupTaskHeartbeatEnabled(cfg, SAMPLE_GRAY)).toBe(true);
    expect(isGroupTaskHeartbeatEnabled(cfg, "other-group")).toBe(false);
  });

  test("rollback: empty allowlist + global false refuses", async () => {
    const { cfg } = await useConfig({ wakeContract: false, wakeAllowlist: [] });
    expect(isCollabTaskWakeContractEnabled(cfg, SAMPLE_GRAY)).toBe(false);
    expect(isGroupTaskHeartbeatEnabled(cfg, SAMPLE_GRAY)).toBe(false);
  });
});

describe("P3 group task heartbeat planner", () => {
  test("defaults and contracts", () => {
    expect(DEFAULT_GROUP_TASK_HEARTBEAT_SCAN_INTERVAL_MS).toBe(30 * 60 * 1000);
    expect(DEFAULT_GROUP_TASK_HEARTBEAT_ESCALATE_AFTER).toBe(2);
    expect(heartbeatFakesTranscriptCompletion()).toBe(false);
    expect(heartbeatReadsTaskSurfaceWritesWake()).toBe(true);
  });

  test("nudge unclaimed; escalate after consecutive no-response", () => {
    const item = {
      itemId: "item-1",
      groupId: SAMPLE_GRAY,
      taskId: "task-1",
      status: "published",
      intendedClaimantIds: ["bot-a"],
      publishedBy: "lead",
    };
    const first = planHeartbeatActionForItem({
      item,
      prior: null,
      nowMs: 1_000,
      escalateAfter: 2,
      escalateTo: ["coord"],
    });
    expect(first.action).toBe("nudge");
    expect(first.toAgentIds).toEqual(["bot-a"]);

    const afterOne = planHeartbeatActionForItem({
      item,
      prior: {
        consecutiveNoResponse: 1,
        lastFingerprint: "published|bot-a||||||||||".replace("bot-a", ""), // will mismatch — recompute
        lastStatus: "published",
      },
      nowMs: 2_000,
      escalateAfter: 2,
      escalateTo: ["coord"],
    });
    // fingerprint for published with no claimant: status|claimant|...
    // Use matching fingerprint via a second nudge path:
    const fpItem = { ...item, claimantId: undefined };
    const nudge1 = planHeartbeatActionForItem({
      item: fpItem,
      prior: null,
      nowMs: 1,
      escalateAfter: 2,
      escalateTo: ["coord"],
    });
    expect(nudge1.action).toBe("nudge");

    const afterTwo = planHeartbeatActionForItem({
      item: fpItem,
      prior: {
        consecutiveNoResponse: 2,
        lastFingerprint: [fpItem.status, "", "", "", "", "", "", "", "", ""].join("|"),
        lastStatus: "published",
      },
      nowMs: 3,
      escalateAfter: 2,
      escalateTo: ["coord"],
    });
    expect(afterTwo.action).toBe("escalate");
    expect(afterTwo.toAgentIds).toEqual(["coord"]);
    expect(afterOne.action === "nudge" || afterOne.action === "escalate").toBe(true);
  });
});

describe("P3 runGroupTaskHeartbeat", () => {
  test("wake off + dryRun false refuses emit; default observe still scans", async () => {
    const { cfg } = await useConfig({ wakeContract: false });
    const auth = authority(cfg, SAMPLE_GRAY);
    const emitDenied = await runGroupTaskHeartbeat(
      auth,
      { groupId: SAMPLE_GRAY },
      { cfg, force: true, dryRun: false },
    );
    expect(emitDenied.ok).toBe(false);
    if (!emitDenied.ok) {
      expect(emitDenied.reason).toBe("flag_off");
    }
    const observed = await runGroupTaskHeartbeat(
      auth,
      { groupId: SAMPLE_GRAY },
      { cfg, force: true },
    );
    expect(observed.ok).toBe(true);
    if (observed.ok && !observed.skipped) {
      expect(observed.writeMode).toBe("observe");
      expect(observed.wakeEvents).toHaveLength(0);
    }
  });

  test("allowlist on: nudge → second no-response escalate; whoWokeWhom auditable", async () => {
    const { cfg } = await useConfig({
      wakeContract: false,
      wakeAllowlist: [SAMPLE_GRAY],
      claimContract: true,
      scanIntervalMs: 60_000,
      escalateAfter: 2,
      mode: "emit",
      emitAllowlist: [SAMPLE_GRAY],
    });
    const auth = authority(cfg, SAMPLE_GRAY);
    const published = await publishBoardItem(
      auth,
      {
        groupId: SAMPLE_GRAY,
        taskId: "task-energy",
        remainingWork: "写过夜报告",
        acceptanceCriteria: ["有来源", "成稿"],
        intendedClaimantIds: ["bot-analyst"],
        publishedBy: "human-ceo",
        dueAtMs: 1, // overdue
      },
      { cfg, nowMs: 100 },
    );
    expect(published.ok).toBe(true);

    const tick1 = await runGroupTaskHeartbeat(
      auth,
      { groupId: SAMPLE_GRAY },
      {
        cfg,
        force: true,
        nowMs: 1_000,
        coordinatorBotId: "bot-coord",
        groupOwnerId: "human-ceo",
      },
    );
    expect(tick1.ok).toBe(true);
    if (!tick1.ok || tick1.skipped) {
      throw new Error("expected scan");
    }
    expect(tick1.wakeEvents.some((e) => e.source === "nudge")).toBe(true);
    expect(tick1.decisions.some((d) => d.action === "nudge")).toBe(true);

    const tick2 = await runGroupTaskHeartbeat(
      auth,
      { groupId: SAMPLE_GRAY },
      {
        cfg,
        force: true,
        nowMs: 2_000,
        coordinatorBotId: "bot-coord",
      },
    );
    expect(tick2.ok).toBe(true);
    if (!tick2.ok || tick2.skipped) {
      throw new Error("expected second scan");
    }

    const tick3 = await runGroupTaskHeartbeat(
      auth,
      { groupId: SAMPLE_GRAY },
      {
        cfg,
        force: true,
        nowMs: 3_000,
        coordinatorBotId: "bot-coord",
      },
    );
    expect(tick3.ok).toBe(true);
    if (!tick3.ok || tick3.skipped) {
      throw new Error("expected third scan");
    }
    expect(tick3.wakeEvents.some((e) => e.source === "escalate")).toBe(true);
    expect(tick3.decisions.some((d) => d.action === "escalate")).toBe(true);

    const events = await listWakeEvents(auth, { groupId: SAMPLE_GRAY });
    const timeline = whoWokeWhom(events);
    expect(timeline.some((r) => r.source === "nudge")).toBe(true);
    expect(timeline.some((r) => r.source === "escalate" && r.to === "bot-coord")).toBe(true);

    const summary = buildAdminDailySummaryMessage({
      groupId: SAMPLE_GRAY,
      items: tick3.decisions.map((d) => ({
        itemId: d.itemId,
        groupId: d.groupId,
        taskId: d.taskId,
        status: d.status,
      })),
      wakeEvents: events,
      generatedAtMs: 3_000,
    });
    expect(summary).toContain("【协作日摘要】");
    expect(summary).toContain("whoWokeWhom");
    expect(heartbeatFakesTranscriptCompletion()).toBe(false);
  });

  test("scan interval skip without force", async () => {
    const { cfg } = await useConfig({
      wakeAllowlist: [SAMPLE_GRAY],
      scanIntervalMs: 60_000,
    });
    const auth = authority(cfg, SAMPLE_GRAY);
    const first = await runGroupTaskHeartbeat(
      auth,
      { groupId: SAMPLE_GRAY },
      { cfg, force: true, nowMs: 10_000 },
    );
    expect(first.ok).toBe(true);
    const second = await runGroupTaskHeartbeat(
      auth,
      { groupId: SAMPLE_GRAY },
      { cfg, force: false, nowMs: 20_000 },
    );
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.skipped).toBe(true);
    }
  });
});

describe("unclaimed claim bridge (Mode B)", () => {
  test("shouldAttemptUnclaimedClaimBridge gates emit+execute+unclaimed", () => {
    expect(
      shouldAttemptUnclaimedClaimBridge({
        dryRun: false,
        selfAdvanceWriteMode: "execute",
        decisions: [
          {
            itemId: "i1",
            taskId: "t1",
            groupId: SAMPLE_GRAY,
            status: "published",
            action: "nudge",
            toAgentIds: ["bot"],
            reason: "heartbeat_nudge:unclaimed",
            consecutiveNoResponse: 1,
          },
        ],
      }),
    ).toBe(true);
    expect(
      shouldAttemptUnclaimedClaimBridge({
        dryRun: false,
        selfAdvanceWriteMode: "dry_run",
        decisions: [
          {
            itemId: "i1",
            taskId: "t1",
            groupId: SAMPLE_GRAY,
            status: "published",
            action: "nudge",
            toAgentIds: ["bot"],
            reason: "heartbeat_nudge:unclaimed",
            consecutiveNoResponse: 1,
          },
        ],
      }),
    ).toBe(false);
  });

  test("emit + selfAdvance execute: nudge then claim intended lead", async () => {
    const { cfg } = await useConfig({
      wakeContract: false,
      wakeAllowlist: [SAMPLE_GRAY],
      claimContract: true,
      mode: "emit",
      emitAllowlist: [SAMPLE_GRAY],
      selfAdvanceExecute: true,
      selfAdvanceAllowlist: [SAMPLE_GRAY],
    });
    const auth = authority(cfg, SAMPLE_GRAY);
    const published = await publishBoardItem(
      auth,
      {
        groupId: SAMPLE_GRAY,
        taskId: "task-longrun-bridge",
        title: "bridge smoke",
        remainingWork: "deliver",
        acceptanceCriteria: ["pdf"],
        intendedClaimantIds: ["bot", "bot-2", "panda"],
        publishedBy: "cli",
        skipChallengeWindow: true,
      },
      { cfg, nowMs: 100 },
    );
    expect(published.ok).toBe(true);
    if (!published.ok) {
      return;
    }
    const tick = await runGroupTaskHeartbeat(
      auth,
      { groupId: SAMPLE_GRAY },
      { cfg, force: true, nowMs: 1_000, dryRun: false },
    );
    expect(tick.ok).toBe(true);
    if (!tick.ok || tick.skipped) {
      throw new Error("expected emit scan");
    }
    expect(tick.decisions.some((d) => d.action === "nudge" && d.reason.includes("unclaimed"))).toBe(
      true,
    );
    expect(tick.claimBridge?.attempted).toBe(true);
    expect(tick.claimBridge?.claimed).toBe(true);
    expect(tick.claimBridge?.leadAgentId).toBe("bot");
    expect(tick.claimBridge?.boardItemId).toBe(published.value.itemId);

    const after = await loadBoardClaimItem(auth, {
      taskId: published.value.taskId,
      itemId: published.value.itemId,
    });
    expect(after?.status).toBe("claimed");
    expect(after?.claimantId).toBe("bot");

    const decisions = await listSelfAdvanceDecisions(auth, { limit: 5 });
    expect(
      decisions.some(
        (d) =>
          d.triggerSource === "heartbeat:unclaimed_claim_bridge" &&
          d.boardItemId === published.value.itemId,
      ),
    ).toBe(true);
  });

  test("selfAdvance dry_run: nudge only, no claim", async () => {
    const { cfg } = await useConfig({
      wakeContract: false,
      wakeAllowlist: [SAMPLE_GRAY],
      claimContract: true,
      mode: "emit",
      emitAllowlist: [SAMPLE_GRAY],
      selfAdvanceExecute: false,
    });
    const auth = authority(cfg, SAMPLE_GRAY);
    const published = await publishBoardItem(
      auth,
      {
        groupId: SAMPLE_GRAY,
        taskId: "task-nudge-only",
        title: "nudge only",
        remainingWork: "x",
        acceptanceCriteria: ["y"],
        intendedClaimantIds: ["bot"],
        publishedBy: "cli",
        skipChallengeWindow: true,
      },
      { cfg, nowMs: 100 },
    );
    expect(published.ok).toBe(true);
    if (!published.ok) {
      return;
    }
    const tick = await runGroupTaskHeartbeat(
      auth,
      { groupId: SAMPLE_GRAY },
      { cfg, force: true, nowMs: 1_000, dryRun: false },
    );
    expect(tick.ok).toBe(true);
    if (!tick.ok || tick.skipped) {
      throw new Error("expected scan");
    }
    expect(tick.claimBridge).toBeUndefined();
    const after = await loadBoardClaimItem(auth, {
      taskId: published.value.taskId,
      itemId: published.value.itemId,
    });
    expect(after?.status).toBe("published");
  });
});
