/**
 * FINAL v3 S4 — Heartbeat scheduler reliability + observe-first task behavior.
 *
 * Acceptance:
 * - Restart recovery (persisted lastScanAt respected)
 * - Duplicate trigger dedup (in-flight lock)
 * - Stall escalate after configurable consecutive no-response
 * - Terminal status no longer reminded
 * - Chat-only does not reset stall; board/交卷 fingerprint does
 * - Default observe (no wake); emit only with wake + emit allowlist
 * - schedulerEnabled default false; LIVE untouched
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
import { publishBoardItem } from "./claim-contract.js";
import {
  listGroupTaskHeartbeatSchedulerTargets,
  startGroupTaskHeartbeatScheduler,
} from "./group-task-heartbeat-scheduler.js";
import {
  chatMessageDoesNotResetHeartbeatStall,
  DEFAULT_GROUP_TASK_HEARTBEAT_ESCALATE_AFTER,
  DEFAULT_GROUP_TASK_HEARTBEAT_SCAN_INTERVAL_MS,
  planHeartbeatActionForItem,
  progressFingerprint,
  resolveGroupTaskHeartbeatSchedulerEnabled,
  resolveGroupTaskHeartbeatWriteMode,
  runGroupTaskHeartbeat,
} from "./group-task-heartbeat.js";
import { createRoundPolicySnapshot } from "./round-policy-snapshot.js";
import { createRuntimeAuthority, type RuntimeAuthority } from "./runtime-authority.js";
import { listWakeEvents } from "./wake-contract.js";

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

const SAMPLE_GRAY = "grp-daniel-hhd-gmail-com-upbeyond";
const SCOPED_GRAY = "001/grp-daniel-hhd-gmail-com-upbeyond";

function flagConfig(
  root: string,
  opts: {
    wakeAllowlist?: string[];
    claimContract?: boolean;
    scanIntervalMs?: number;
    escalateAfter?: number;
    schedulerEnabled?: boolean;
    mode?: "observe" | "emit";
    emitAllowlist?: string[];
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
  return {
    agents: { defaults: { workspace: path.join(root, "agent-ws") } },
    gateway: { security: { profile: "personal_local" } },
    collaboration: {
      defaults: { workspace: path.join(root, "collaboration") },
      runtimeNamespace: true,
      task: {
        wakeContract: false,
        ...(opts.wakeAllowlist ? { wakeContractGroupAllowlist: opts.wakeAllowlist } : {}),
        ...(opts.claimContract !== undefined ? { claimContract: opts.claimContract } : {}),
        ...(Object.keys(hb).length > 0 ? { groupTaskHeartbeat: hb } : {}),
      },
    },
  } as OpenBotConfig;
}

async function useConfig(opts: {
  wakeAllowlist?: string[];
  claimContract?: boolean;
  scanIntervalMs?: number;
  escalateAfter?: number;
  schedulerEnabled?: boolean;
  mode?: "observe" | "emit";
  emitAllowlist?: string[];
}): Promise<{ root: string; cfg: OpenBotConfig }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-s4-hb-"));
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

function authority(
  cfg: OpenBotConfig,
  groupId: string,
  tenantId: string | null = null,
): RuntimeAuthority {
  const snapshot = createRoundPolicySnapshot(
    { collaborationMode: "task_driven", finalDecisionMode: "human_required" },
    { now: 1, idGen: () => "pss_s4_hb" },
  );
  return createRuntimeAuthority({
    snapshot,
    episodeId: "ep_s4_hb",
    tenant: { tenantId, trust: tenantId ? "actor_fallback" : "none" },
    groupId,
    profile: "personal_local",
    cfg,
  });
}

describe("S4 defaults & product semantics", () => {
  test("configurable defaults; scheduler off; observe-first; chat does not reset stall", async () => {
    expect(DEFAULT_GROUP_TASK_HEARTBEAT_SCAN_INTERVAL_MS).toBe(30 * 60 * 1000);
    expect(DEFAULT_GROUP_TASK_HEARTBEAT_ESCALATE_AFTER).toBe(2);
    expect(chatMessageDoesNotResetHeartbeatStall()).toBe(true);

    const { cfg } = await useConfig({});
    expect(resolveGroupTaskHeartbeatSchedulerEnabled(cfg)).toBe(false);
    expect(resolveGroupTaskHeartbeatWriteMode(cfg, SAMPLE_GRAY, null)).toBe("observe");

    const base = {
      status: "in_progress",
      claimantId: "bot-a",
      claimedAt: 10,
      inProgressAt: 20,
    };
    const fp1 = progressFingerprint(base);
    // "正在处理" chat is not a fingerprint input — same board → same stall key
    const fp2 = progressFingerprint({ ...base });
    expect(fp1).toBe(fp2);
    // 交卷版本变化 resets stall fingerprint
    const fp3 = progressFingerprint({
      ...base,
      submissionId: "11111111-1111-4111-8111-111111111111",
      artifactVersion: "v2",
    });
    expect(fp3).not.toBe(fp1);
  });

  test("LIVE_touched=false: defaults stay observe/scheduler off (no Floor emit)", async () => {
    const { cfg } = await useConfig({});
    expect(resolveGroupTaskHeartbeatSchedulerEnabled(cfg)).toBe(false);
    expect(resolveGroupTaskHeartbeatWriteMode(cfg, SAMPLE_GRAY, null)).toBe("observe");
    expect(cfg.collaboration?.task?.groupTaskHeartbeat?.schedulerEnabled ?? false).toBe(false);
    expect(cfg.collaboration?.task?.groupTaskHeartbeat?.mode ?? "observe").toBe("observe");
    expect((cfg as { floor?: unknown }).floor).toBeUndefined();
  });
});

describe("S4 observe vs emit", () => {
  test("observe (default): plans nudge but writes no wake events", async () => {
    const { cfg } = await useConfig({
      wakeAllowlist: [SAMPLE_GRAY],
      claimContract: true,
      scanIntervalMs: 1_000,
      escalateAfter: 2,
      // mode default observe; no emitAllowlist
    });
    const auth = authority(cfg, SAMPLE_GRAY);
    const published = await publishBoardItem(
      auth,
      {
        groupId: SAMPLE_GRAY,
        taskId: "task-obs",
        remainingWork: "写报告",
        acceptanceCriteria: ["有来源"],
        intendedClaimantIds: ["bot-analyst"],
        publishedBy: "human-ceo",
      },
      { cfg, nowMs: 100 },
    );
    expect(published.ok).toBe(true);

    const tick = await runGroupTaskHeartbeat(
      auth,
      { groupId: SAMPLE_GRAY },
      { cfg, force: true, nowMs: 1_000, coordinatorBotId: "bot-coord" },
    );
    expect(tick.ok).toBe(true);
    if (!tick.ok || tick.skipped) {
      throw new Error("expected scan");
    }
    expect(tick.writeMode).toBe("observe");
    expect(tick.decisions.some((d) => d.action === "nudge")).toBe(true);
    expect(tick.wakeEvents).toHaveLength(0);
    const events = await listWakeEvents(auth, { groupId: SAMPLE_GRAY });
    expect(events).toHaveLength(0);
  });

  test("emit allowlist + wake: writes nudge wake", async () => {
    const { cfg } = await useConfig({
      wakeAllowlist: [SAMPLE_GRAY],
      claimContract: true,
      emitAllowlist: [SAMPLE_GRAY],
      mode: "observe", // emit via allowlist, not global mode
      scanIntervalMs: 1_000,
    });
    expect(resolveGroupTaskHeartbeatWriteMode(cfg, SAMPLE_GRAY, null)).toBe("emit");
    const auth = authority(cfg, SAMPLE_GRAY);
    await publishBoardItem(
      auth,
      {
        groupId: SAMPLE_GRAY,
        taskId: "task-emit",
        remainingWork: "写报告",
        acceptanceCriteria: ["有来源"],
        intendedClaimantIds: ["bot-analyst"],
        publishedBy: "human-ceo",
      },
      { cfg, nowMs: 100 },
    );
    const tick = await runGroupTaskHeartbeat(
      auth,
      { groupId: SAMPLE_GRAY },
      { cfg, force: true, nowMs: 1_000, coordinatorBotId: "bot-coord" },
    );
    expect(tick.ok).toBe(true);
    if (!tick.ok || tick.skipped) {
      throw new Error("expected scan");
    }
    expect(tick.writeMode).toBe("emit");
    expect(tick.wakeEvents.some((e) => e.source === "nudge")).toBe(true);
  });
});

describe("S4 task behavior", () => {
  test("terminal accepted: skip and no longer remind; escalate then await progress (anti-spam)", () => {
    const accepted = planHeartbeatActionForItem({
      item: {
        itemId: "i1",
        groupId: SAMPLE_GRAY,
        taskId: "t1",
        status: "accepted",
        claimantId: "bot-a",
      },
      prior: { consecutiveNoResponse: 2, lastFingerprint: "x", lastStatus: "in_progress" },
      nowMs: 1,
      escalateAfter: 2,
      escalateTo: ["coord"],
    });
    expect(accepted.action).toBe("skip");
    expect(accepted.reason).toContain("not_actionable");

    const fp = progressFingerprint({
      status: "in_progress",
      claimantId: "bot-a",
      claimedAt: 1,
      inProgressAt: 2,
    });
    const afterEscalated = planHeartbeatActionForItem({
      item: {
        itemId: "i2",
        groupId: SAMPLE_GRAY,
        taskId: "t2",
        status: "in_progress",
        claimantId: "bot-a",
        claimedAt: 1,
        inProgressAt: 2,
      },
      prior: {
        consecutiveNoResponse: 2,
        lastFingerprint: fp,
        lastStatus: "in_progress",
        lastEscalateAt: 50,
      },
      nowMs: 100,
      escalateAfter: 2,
      escalateTo: ["coord"],
    });
    expect(afterEscalated.action).toBe("skip");
    expect(afterEscalated.reason).toContain("already_escalated_awaiting_progress");
  });

  test("stall: nudge then escalate after 2 consecutive no-response (observe keeps decisions)", async () => {
    const { cfg } = await useConfig({
      wakeAllowlist: [SAMPLE_GRAY],
      claimContract: true,
      scanIntervalMs: 1,
      escalateAfter: 2,
    });
    const auth = authority(cfg, SAMPLE_GRAY);
    await publishBoardItem(
      auth,
      {
        groupId: SAMPLE_GRAY,
        taskId: "task-stall",
        remainingWork: "推进",
        acceptanceCriteria: ["完成"],
        intendedClaimantIds: ["bot-a"],
        publishedBy: "lead",
      },
      { cfg, nowMs: 1 },
    );

    const t1 = await runGroupTaskHeartbeat(
      auth,
      { groupId: SAMPLE_GRAY },
      { cfg, force: true, nowMs: 10, dryRun: true, coordinatorBotId: "coord" },
    );
    expect(t1.ok && !t1.skipped && t1.decisions.some((d) => d.action === "nudge")).toBe(true);

    const t2 = await runGroupTaskHeartbeat(
      auth,
      { groupId: SAMPLE_GRAY },
      { cfg, force: true, nowMs: 20, dryRun: true, coordinatorBotId: "coord" },
    );
    expect(t2.ok && !t2.skipped).toBe(true);

    const t3 = await runGroupTaskHeartbeat(
      auth,
      { groupId: SAMPLE_GRAY },
      { cfg, force: true, nowMs: 30, dryRun: true, coordinatorBotId: "coord" },
    );
    expect(t3.ok && !t3.skipped && t3.decisions.some((d) => d.action === "escalate")).toBe(true);
  });
});

describe("S4 scheduler reliability", () => {
  test("default schedulerEnabled=false: timer dormant; targets from allowlists", async () => {
    const { cfg } = await useConfig({
      wakeAllowlist: [SAMPLE_GRAY],
      emitAllowlist: [SCOPED_GRAY],
    });
    expect(resolveGroupTaskHeartbeatSchedulerEnabled(cfg)).toBe(false);
    const targets = listGroupTaskHeartbeatSchedulerTargets(cfg);
    expect(targets.some((t) => t.groupId === SAMPLE_GRAY)).toBe(true);

    const scheduler = startGroupTaskHeartbeatScheduler({
      cfg,
      pollIntervalMs: 60_000,
      runGroup: async () => {
        throw new Error("should not run when disabled");
      },
    });
    expect(scheduler.isRunning()).toBe(false);
    const tick = await scheduler.runTickNow();
    expect(tick.schedulerEnabled).toBe(false);
    expect(tick.results).toHaveLength(0);
    scheduler.stop();
  });

  test("restart recovery: persisted lastScanAt causes interval skip after new scheduler", async () => {
    const { cfg } = await useConfig({
      wakeAllowlist: [SAMPLE_GRAY],
      claimContract: true,
      schedulerEnabled: true,
      scanIntervalMs: 60_000,
    });
    const auth = authority(cfg, SAMPLE_GRAY);
    await publishBoardItem(
      auth,
      {
        groupId: SAMPLE_GRAY,
        taskId: "task-restart",
        remainingWork: "x",
        acceptanceCriteria: ["y"],
        intendedClaimantIds: ["bot-a"],
        publishedBy: "lead",
      },
      { cfg, nowMs: 1 },
    );

    // First process tick at T=1000
    const first = await runGroupTaskHeartbeat(
      auth,
      { groupId: SAMPLE_GRAY },
      { cfg, force: false, nowMs: 1_000, dryRun: true },
    );
    expect(first.ok && !("skipped" in first && first.skipped)).toBe(true);

    // "Restart": new scheduler instance, same disk state — within interval → skip
    let calls = 0;
    const scheduler = startGroupTaskHeartbeatScheduler({
      cfg,
      pollIntervalMs: 60_000,
      listTargets: () => [{ groupId: SAMPLE_GRAY, tenantId: null }],
      runGroup: async (target, options) => {
        calls += 1;
        return runGroupTaskHeartbeat(auth, { groupId: target.groupId }, options);
      },
    });
    const tick = await scheduler.runTickNow({ force: false, nowMs: 10_000 });
    expect(tick.schedulerEnabled).toBe(true);
    expect(calls).toBe(1);
    const result = tick.results[0]?.result;
    expect(result?.ok).toBe(true);
    if (result && result.ok) {
      expect(result.skipped).toBe(true);
      if (result.skipped) {
        expect(result.reason).toBe("scan_interval_not_elapsed");
      }
    }
    scheduler.stop();
  });

  test("duplicate trigger dedup: overlapping runTickNow skips", async () => {
    const { cfg } = await useConfig({
      schedulerEnabled: true,
      wakeAllowlist: [SAMPLE_GRAY],
      scanIntervalMs: 1_000,
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = 0;
    const scheduler = startGroupTaskHeartbeatScheduler({
      cfg,
      pollIntervalMs: 60_000,
      listTargets: () => [{ groupId: SAMPLE_GRAY, tenantId: null }],
      runGroup: async () => {
        started += 1;
        await gate;
        return {
          ok: true,
          skipped: true,
          reason: "test_hold",
          groupId: SAMPLE_GRAY,
        };
      },
    });

    const p1 = scheduler.runTickNow({ nowMs: 1 });
    // yield so p1 acquires inFlight
    await new Promise((r) => setTimeout(r, 10));
    const p2 = scheduler.runTickNow({ nowMs: 2 });
    const second = await p2;
    expect(second.dedupSkipped).toBe(true);
    release();
    const first = await p1;
    expect(first.dedupSkipped).toBe(false);
    expect(started).toBe(1);
    expect(scheduler.getStatus().dedupSkipCount).toBeGreaterThanOrEqual(1);
    scheduler.stop();
  });

  test("exception retry: consecutiveFailures increments; next tick can succeed", async () => {
    const { cfg } = await useConfig({
      schedulerEnabled: true,
      wakeAllowlist: [SAMPLE_GRAY],
    });
    let failOnce = true;
    const scheduler = startGroupTaskHeartbeatScheduler({
      cfg,
      pollIntervalMs: 60_000,
      listTargets: () => [{ groupId: SAMPLE_GRAY, tenantId: null }],
      runGroup: async () => {
        if (failOnce) {
          failOnce = false;
          throw new Error("simulated_tick_failure");
        }
        return {
          ok: true,
          skipped: true,
          reason: "ok_after_retry",
          groupId: SAMPLE_GRAY,
        };
      },
    });
    const bad = await scheduler.runTickNow({ nowMs: 1 });
    expect(bad.error).toContain("simulated_tick_failure");
    expect(scheduler.getStatus().consecutiveFailures).toBe(1);
    expect(scheduler.getStatus().lastTickOk).toBe(false);

    const good = await scheduler.runTickNow({ nowMs: 2 });
    expect(good.error).toBeUndefined();
    expect(scheduler.getStatus().consecutiveFailures).toBe(0);
    expect(scheduler.getStatus().lastTickOk).toBe(true);
    scheduler.stop();
  });

  test("updateConfig arms/disarms timer; stop is idempotent", async () => {
    const { cfg } = await useConfig({ schedulerEnabled: false });
    const scheduler = startGroupTaskHeartbeatScheduler({
      cfg,
      pollIntervalMs: 60_000,
      runGroup: async () => ({
        ok: true,
        skipped: true,
        reason: "noop",
        groupId: SAMPLE_GRAY,
      }),
    });
    expect(scheduler.isRunning()).toBe(false);
    scheduler.updateConfig({
      ...cfg,
      collaboration: {
        ...cfg.collaboration,
        task: {
          ...cfg.collaboration?.task,
          groupTaskHeartbeat: {
            ...cfg.collaboration?.task?.groupTaskHeartbeat,
            schedulerEnabled: true,
            scanIntervalMs: 60_000,
          },
        },
      },
    } as OpenBotConfig);
    expect(scheduler.isRunning()).toBe(true);
    scheduler.stop();
    expect(scheduler.isRunning()).toBe(false);
    scheduler.stop();
  });

  test("slow timer tick then resumes single chain", async () => {
    const { cfg } = await useConfig({
      schedulerEnabled: true,
      wakeAllowlist: [SAMPLE_GRAY],
    });
    let invocations = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const scheduler = startGroupTaskHeartbeatScheduler({
      cfg,
      pollIntervalMs: 40,
      listTargets: () => [{ groupId: SAMPLE_GRAY, tenantId: null }],
      runGroup: async () => {
        invocations += 1;
        if (invocations === 1) {
          await gate;
        }
        return {
          ok: true,
          skipped: true,
          reason: "slow_tick",
          groupId: SAMPLE_GRAY,
        };
      },
    });
    for (let i = 0; i < 50 && invocations < 1; i += 1) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(invocations).toBe(1);
    release();
    await new Promise((r) => setTimeout(r, 20));
    const baseline = invocations;
    await new Promise((r) => setTimeout(r, 180));
    const delta = invocations - baseline;
    expect(delta).toBeGreaterThanOrEqual(2);
    expect(delta).toBeLessThanOrEqual(7);
    scheduler.stop();
  });

  test("timer-driven tick exception still re-arms once", async () => {
    const { cfg } = await useConfig({
      schedulerEnabled: true,
      wakeAllowlist: [SAMPLE_GRAY],
    });
    let invocations = 0;
    const scheduler = startGroupTaskHeartbeatScheduler({
      cfg,
      pollIntervalMs: 40,
      listTargets: () => [{ groupId: SAMPLE_GRAY, tenantId: null }],
      runGroup: async () => {
        invocations += 1;
        if (invocations === 1) {
          throw new Error("timer_tick_boom");
        }
        return {
          ok: true,
          skipped: true,
          reason: "after_boom",
          groupId: SAMPLE_GRAY,
        };
      },
    });
    for (let i = 0; i < 80 && invocations < 2; i += 1) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(invocations).toBeGreaterThanOrEqual(2);
    expect(scheduler.getStatus().consecutiveFailures).toBe(0);
    scheduler.stop();
  });

  test("stop during in-flight tick prevents finally re-arm", async () => {
    const { cfg } = await useConfig({
      schedulerEnabled: true,
      wakeAllowlist: [SAMPLE_GRAY],
    });
    let invocations = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const scheduler = startGroupTaskHeartbeatScheduler({
      cfg,
      pollIntervalMs: 40,
      listTargets: () => [{ groupId: SAMPLE_GRAY, tenantId: null }],
      runGroup: async () => {
        invocations += 1;
        await gate;
        return {
          ok: true,
          skipped: true,
          reason: "held",
          groupId: SAMPLE_GRAY,
        };
      },
    });
    for (let i = 0; i < 50 && invocations < 1; i += 1) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(invocations).toBe(1);
    scheduler.stop();
    release();
    await new Promise((r) => setTimeout(r, 120));
    expect(invocations).toBe(1);
    expect(scheduler.isRunning()).toBe(false);
  });

  test("updateConfig during slow tick does not create duplicate timer chains", async () => {
    const { cfg } = await useConfig({
      schedulerEnabled: true,
      wakeAllowlist: [SAMPLE_GRAY],
    });
    let invocations = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const scheduler = startGroupTaskHeartbeatScheduler({
      cfg,
      pollIntervalMs: 40,
      listTargets: () => [{ groupId: SAMPLE_GRAY, tenantId: null }],
      runGroup: async () => {
        invocations += 1;
        if (invocations === 1) {
          await gate;
        }
        return {
          ok: true,
          skipped: true,
          reason: "held_for_updateConfig",
          groupId: SAMPLE_GRAY,
        };
      },
    });
    for (let i = 0; i < 50 && invocations < 1; i += 1) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(invocations).toBe(1);

    // Concurrent config update while first tick is still running.
    scheduler.updateConfig(cfg);
    release();
    await new Promise((r) => setTimeout(r, 30));

    const baseline = invocations;
    await new Promise((r) => setTimeout(r, 220));
    const delta = invocations - baseline;
    // Single chain @40ms over ~220ms ⇒ ~5 fires. Duplicate chains ≫ 8.
    expect(delta).toBeGreaterThanOrEqual(3);
    expect(delta).toBeLessThanOrEqual(8);
    scheduler.stop();
  });
});
