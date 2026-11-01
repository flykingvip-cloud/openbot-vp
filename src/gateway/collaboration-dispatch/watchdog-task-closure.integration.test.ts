/**
 * Watchdog task-closure integration: real heartbeat → consume → Mode B → round → wake-op ledger.
 * Does not mock executeCollaborationRound.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Task } from "@openbot/collaboration-core";
import { afterEach, describe, expect, it } from "vitest";
import { clearConfigCache, setRuntimeConfigSnapshot } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { createWorkspaceCollaborationStores } from "../collaboration-learning/shared.js";
import { sanitizeWakeRunBotErrorMessage } from "../wake-round-dispatcher-boot.js";
import { testAuthorityFromScope } from "./__fixtures__/runtime-authority-test-utils.js";
import {
  applyClaim,
  claimBoardItem,
  clearBoardPendingEventRelay,
  loadBoardClaimItem,
  markBoardItemInProgress,
  publishBoardItem,
  submitBoardItemForReview,
} from "./claim-contract.js";
import { confirmTodolist, proposeTodolist } from "./executor-private-todolist.js";
import {
  runGroupTaskHeartbeat,
  groupTaskHeartbeatDir,
  type GroupTaskHeartbeatResult,
} from "./group-task-heartbeat.js";
import { createModeBWakeRoundDispatcher } from "./mode-b-wake-round-dispatcher.js";
import { createRoundPolicySnapshot } from "./round-policy-snapshot.js";
import { createRuntimeAuthority, type RuntimeAuthority } from "./runtime-authority.js";
import type { CollaborationBotTarget } from "./types.js";
import {
  consumeWakeForRoundDispatch,
  setWakeRoundDispatcher,
  type WakeRoundDispatcher,
} from "./wake-round-dispatch.js";

const SAMPLE_GRAY = "grp_watchdog_closure";
const tempDirs: string[] = [];

afterEach(async () => {
  setWakeRoundDispatcher(null);
  clearConfigCache();
  delete process.env.OPENBOT_STATE_DIR;
  delete process.env.OPENBOT_CONFIG_PATH;
  delete process.env.OPENCLAW_CONFIG_PATH;
  for (const dir of tempDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

function flagConfig(root: string): OpenBotConfig {
  return {
    agents: { defaults: { workspace: path.join(root, "agent-ws") } },
    gateway: { security: { profile: "personal_local" } },
    collaboration: {
      defaults: { workspace: path.join(root, "collaboration") },
      runtimeNamespace: true,
      task: {
        wakeContract: true,
        wakeContractGroupAllowlist: [SAMPLE_GRAY],
        claimContract: true,
        selfAdvance: {
          mode: "execute",
          executeGroupAllowlist: [SAMPLE_GRAY],
        },
        groupTaskHeartbeat: {
          mode: "observe",
          emitGroupAllowlist: [SAMPLE_GRAY],
          scanIntervalMs: 1_000,
          escalateAfterConsecutiveNoResponse: 2,
        },
      },
    },
  } as OpenBotConfig;
}

async function useConfig(): Promise<{ root: string; cfg: OpenBotConfig }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-wd-closure-"));
  tempDirs.push(root);
  process.env.OPENBOT_STATE_DIR = path.join(root, "state");
  delete process.env.OPENBOT_SECURITY_PROFILE;
  const cfg = flagConfig(root);
  const configPath = path.join(root, "openbot.json");
  await fs.writeFile(configPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
  process.env.OPENBOT_CONFIG_PATH = configPath;
  process.env.OPENCLAW_CONFIG_PATH = configPath;
  setRuntimeConfigSnapshot(cfg, cfg);
  clearConfigCache();
  return { root, cfg };
}

function authority(cfg: OpenBotConfig, groupId = SAMPLE_GRAY): RuntimeAuthority {
  const snapshot = createRoundPolicySnapshot(
    { collaborationMode: "task_driven", finalDecisionMode: "human_required" },
    { now: 1, idGen: () => "pss_wd_closure" },
  );
  return createRuntimeAuthority({
    snapshot,
    episodeId: "ep_wd_closure",
    tenant: { tenantId: null, trust: "none" },
    groupId,
    profile: "personal_local",
    cfg,
  });
}

function okScan(tick: GroupTaskHeartbeatResult) {
  expect(tick.ok).toBe(true);
  if (!tick.ok || tick.skipped) {
    throw new Error("expected heartbeat scan");
  }
  return tick;
}

describe("watchdog closure — sanitize", () => {
  it("redacts credential-like runBot error text", () => {
    const raw = "upstream failed Authorization: Bearer sk-live-SUPERSECRETVALUE123456 api_key=abcd";
    const safe = sanitizeWakeRunBotErrorMessage(raw);
    expect(safe).not.toContain("sk-live-SUPERSECRETVALUE123456");
    expect(safe.toLowerCase()).not.toMatch(/bearer\s+sk-live-supersecretvalue123456/);
  });
});

describe("watchdog closure — consume/Mode B/ledger side effects", () => {
  it("not_started Mode B failure marks wake-op failed (retryable)", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    const dispatcher: WakeRoundDispatcher = async () => ({
      ok: false,
      reason: "mode_b_context_unavailable",
      sideEffectClass: "not_started",
    });
    const result = await consumeWakeForRoundDispatch({
      authority: auth,
      cfg,
      writeMode: "execute",
      roundDispatcher: dispatcher,
      nowMs: 1_700_000_000_200,
      request: {
        groupId: SAMPLE_GRAY,
        fromAgentId: "system:group_task_heartbeat",
        toAgentIds: ["bot:analyst"],
        source: "nudge",
        taskId: "task_ns",
        itemId: "item_ns",
        reason: "test:not_started",
      },
    });
    expect(result.dispatched).toBe(false);
    expect(result.sideEffectClass).toBe("not_started");
    expect(result.wakeOp?.status).toBe("failed");
  });

  it("started_or_unknown Mode B failure marks wake-op unknown (no blind replay)", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    const lead: CollaborationBotTarget = {
      agentId: "bot:analyst",
      name: "分析",
      sessionKey: "agent:bot:analyst:main",
      updatedAt: 1,
    };
    let runCount = 0;
    const modeB = createModeBWakeRoundDispatcher(async () => {
      const scoped = testAuthorityFromScope({
        groupId: SAMPLE_GRAY,
        rawSessionKey: `space:${SAMPLE_GRAY}`,
        title: "wd",
        bots: [lead],
      });
      return {
        authority: scoped.authority,
        facts: scoped.facts,
        sessionKey: `space:${SAMPLE_GRAY}`,
        leadBot: lead,
        cfg,
        runBot: async () => {
          runCount += 1;
          // Simulate tool side effects already happened, then empty final text.
          return undefined;
        },
      };
    });
    setWakeRoundDispatcher(modeB);
    const first = await consumeWakeForRoundDispatch({
      authority: auth,
      cfg,
      writeMode: "execute",
      nowMs: 1_700_000_000_300,
      request: {
        groupId: SAMPLE_GRAY,
        fromAgentId: "system:group_task_heartbeat",
        toAgentIds: ["bot:analyst"],
        source: "nudge",
        taskId: "task_su",
        itemId: "item_su",
        reason: "test:started_or_unknown",
      },
    });
    expect(runCount).toBe(1);
    expect(first.dispatched).toBe(false);
    expect(first.sideEffectClass).toBe("started_or_unknown");
    expect(first.wakeOp?.status).toBe("unknown");

    // Same opKey inspect should suppress blind re-dispatch.
    const second = await consumeWakeForRoundDispatch({
      authority: auth,
      cfg,
      writeMode: "execute",
      nowMs: 1_700_000_000_400,
      request: {
        groupId: SAMPLE_GRAY,
        fromAgentId: "system:group_task_heartbeat",
        toAgentIds: ["bot:analyst"],
        source: "nudge",
        taskId: "task_su",
        itemId: "item_su",
        reason: "test:started_or_unknown_retry",
      },
    });
    expect(runCount).toBe(1);
    expect(second.dispatched).toBe(false);
    expect(second.wakeOp?.status).toBe("unknown");
  });

  it("ROUND_COMPLETE Mode B path still completes ledger", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    const lead: CollaborationBotTarget = {
      agentId: "bot:analyst",
      name: "分析",
      sessionKey: "agent:bot:analyst:main",
      updatedAt: 1,
    };
    const modeB = createModeBWakeRoundDispatcher(async () => {
      const scoped = testAuthorityFromScope({
        groupId: SAMPLE_GRAY,
        rawSessionKey: `space:${SAMPLE_GRAY}`,
        title: "wd",
        bots: [lead],
      });
      return {
        authority: scoped.authority,
        facts: scoped.facts,
        sessionKey: `space:${SAMPLE_GRAY}`,
        leadBot: lead,
        cfg,
        runBot: async () => ({ text: "结论：本轮已完成。" }),
      };
    });
    const result = await consumeWakeForRoundDispatch({
      authority: auth,
      cfg,
      writeMode: "execute",
      roundDispatcher: modeB,
      nowMs: 1_700_000_000_500,
      request: {
        groupId: SAMPLE_GRAY,
        fromAgentId: "system:group_task_heartbeat",
        toAgentIds: ["bot:analyst"],
        source: "nudge",
        taskId: "task_ok",
        itemId: "item_ok",
        reason: "test:complete",
      },
    });
    expect(result.dispatched).toBe(true);
    expect(result.sideEffectClass).toBe("completed_with_receipt");
    expect(result.wakeOp?.status).toBe("completed");
    expect(result.roundId).toBeTruthy();
  });

  it("dispatcher throw persists unknown AND returns started_or_unknown (no omit)", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    let calls = 0;
    setWakeRoundDispatcher(async () => {
      calls += 1;
      throw new Error("simulated_dispatcher_throw");
    });

    const first = await consumeWakeForRoundDispatch({
      authority: auth,
      cfg,
      writeMode: "execute",
      nowMs: 1_700_000_000_500,
      request: {
        groupId: SAMPLE_GRAY,
        fromAgentId: "system:group_task_heartbeat",
        toAgentIds: ["bot:analyst"],
        source: "nudge",
        taskId: "task_throw",
        itemId: "item_throw",
        reason: "test:dispatcher_throw",
      },
    });
    expect(calls).toBe(1);
    expect(first.dispatched).toBe(false);
    expect(first.sideEffectClass).toBe("started_or_unknown");
    expect(first.wakeOp?.status).toBe("unknown");
    expect(first.reason).toContain("dispatch_threw");

    // Same opKey: unknown ledger must suppress blind re-dispatch.
    const second = await consumeWakeForRoundDispatch({
      authority: auth,
      cfg,
      writeMode: "execute",
      nowMs: 1_700_000_000_600,
      request: {
        groupId: SAMPLE_GRAY,
        fromAgentId: "system:group_task_heartbeat",
        toAgentIds: ["bot:analyst"],
        source: "nudge",
        taskId: "task_throw",
        itemId: "item_throw",
        reason: "test:dispatcher_throw_retry",
      },
    });
    expect(calls).toBe(1);
    expect(second.dispatched).toBe(false);
    expect(second.wakeOp?.status).toBe("unknown");
  });
});

describe("watchdog closure — heartbeat persistence + human exit", () => {
  it("nudge not_started failures count, backoff, then escalate/human exit across scans", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    let calls = 0;
    setWakeRoundDispatcher(async () => {
      calls += 1;
      return {
        ok: false,
        reason: "mode_b_context_unavailable",
        sideEffectClass: "not_started",
      };
    });

    const published = await publishBoardItem(
      auth,
      {
        groupId: SAMPLE_GRAY,
        taskId: "task_nudge_fail",
        remainingWork: "推进",
        acceptanceCriteria: ["有结果"],
        intendedClaimantIds: ["bot:analyst"],
        publishedBy: "human-ceo",
      },
      { cfg, nowMs: 100 },
    );
    expect(published.ok).toBe(true);
    if (!published.ok) {
      return;
    }

    const t1 = okScan(
      await runGroupTaskHeartbeat(
        auth,
        { groupId: SAMPLE_GRAY },
        {
          cfg,
          force: true,
          nowMs: 1_000,
          coordinatorBotId: "bot:coord",
          skipClaimBridge: true,
          actorId: "system:hb",
        },
      ),
    );
    expect(t1.decisions.some((d) => d.action === "nudge")).toBe(true);
    expect(calls).toBe(1);
    expect(t1.state.items[published.value.itemId]?.nudgeFailCount).toBe(1);

    // Backoff window — no new dispatch.
    const t2 = okScan(
      await runGroupTaskHeartbeat(
        auth,
        { groupId: SAMPLE_GRAY },
        {
          cfg,
          force: true,
          nowMs: 10_000,
          coordinatorBotId: "bot:coord",
          skipClaimBridge: true,
          actorId: "system:hb",
        },
      ),
    );
    expect(t2.decisions.some((d) => d.reason.includes("nudge_fail_backoff"))).toBe(true);
    expect(calls).toBe(1);

    // After backoff, fail again (2), then (3) → escalate path preferred.
    const t3 = okScan(
      await runGroupTaskHeartbeat(
        auth,
        { groupId: SAMPLE_GRAY },
        {
          cfg,
          force: true,
          nowMs: 50_000,
          coordinatorBotId: "bot:coord",
          skipClaimBridge: true,
          actorId: "system:hb",
        },
      ),
    );
    expect(calls).toBe(2);
    expect(t3.state.items[published.value.itemId]?.nudgeFailCount).toBe(2);

    const t4 = okScan(
      await runGroupTaskHeartbeat(
        auth,
        { groupId: SAMPLE_GRAY },
        {
          cfg,
          force: true,
          nowMs: 90_000,
          coordinatorBotId: "bot:coord",
          skipClaimBridge: true,
          actorId: "system:hb",
        },
      ),
    );
    expect(calls).toBe(3);
    expect(t4.state.items[published.value.itemId]?.nudgeFailCount).toBe(3);

    // Next plan should escalate due to nudge fail exhaustion with coordinator present.
    setWakeRoundDispatcher(async () => ({
      ok: false,
      reason: "mode_b_context_unavailable",
      sideEffectClass: "not_started",
    }));
    const t5 = okScan(
      await runGroupTaskHeartbeat(
        auth,
        { groupId: SAMPLE_GRAY },
        {
          cfg,
          force: true,
          nowMs: 130_000,
          coordinatorBotId: "bot:coord",
          skipClaimBridge: true,
          actorId: "system:hb",
        },
      ),
    );
    const esc = t5.decisions.find((d) => d.itemId === published.value.itemId);
    expect(esc?.action === "escalate" || esc?.action === "human_todo").toBe(true);
  });

  it("escalate failures exhaust to persisted humanAttention + jsonl", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    setWakeRoundDispatcher(async () => ({
      ok: false,
      reason: "mode_b_context_unavailable",
      sideEffectClass: "not_started",
    }));
    const published = await publishBoardItem(
      auth,
      {
        groupId: SAMPLE_GRAY,
        taskId: "task_esc_fail",
        remainingWork: "推进",
        acceptanceCriteria: ["有结果"],
        intendedClaimantIds: ["bot:analyst"],
        publishedBy: "human-ceo",
      },
      { cfg, nowMs: 100 },
    );
    expect(published.ok).toBe(true);
    if (!published.ok) {
      return;
    }

    // Seed state as already needing escalate (consecutive high + no successful escalate).
    let now = 1_000;
    for (let i = 0; i < 5; i++) {
      now += 60_000;
      await runGroupTaskHeartbeat(
        auth,
        { groupId: SAMPLE_GRAY },
        {
          cfg,
          force: true,
          nowMs: now,
          coordinatorBotId: "bot:coord",
          skipClaimBridge: true,
          actorId: "system:hb",
        },
      );
    }
    const finalTick = okScan(
      await runGroupTaskHeartbeat(
        auth,
        { groupId: SAMPLE_GRAY },
        {
          cfg,
          force: true,
          nowMs: now + 60_000,
          coordinatorBotId: "bot:coord",
          skipClaimBridge: true,
          actorId: "system:hb",
        },
      ),
    );
    const st = finalTick.state.items[published.value.itemId];
    const humanDecision = finalTick.decisions.find(
      (d) => d.itemId === published.value.itemId && d.action === "human_todo",
    );
    expect(humanDecision || st?.humanAttention?.status === "needs_human").toBeTruthy();
    expect(st?.humanAttention?.status).toBe("needs_human");
    expect(st?.humanAttention?.ownerIds.length).toBeGreaterThan(0);
    expect(st?.humanAttention?.recoveryHint.length).toBeGreaterThan(10);
    expect(st?.humanAttention?.ownerIds).toEqual(expect.arrayContaining(["human-ceo"]));
    expect(st?.humanAttention?.ownerIds).toContain("bot:coord");
    const dir = groupTaskHeartbeatDir(auth);
    const jsonl = await fs.readFile(path.join(dir, `${SAMPLE_GRAY}.human-attention.jsonl`), "utf8");
    expect(jsonl).toContain("group_task_heartbeat_human_attention");
    expect(jsonl).toContain(published.value.itemId);
  });

  it("dispatcher throw → immediate humanAttention; next scan does not blind re-nudge", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    let calls = 0;
    setWakeRoundDispatcher(async () => {
      calls += 1;
      throw new Error("hb_dispatcher_throw");
    });

    const published = await publishBoardItem(
      auth,
      {
        groupId: SAMPLE_GRAY,
        taskId: "task_throw_hb",
        remainingWork: "推进",
        acceptanceCriteria: ["有结果"],
        intendedClaimantIds: ["bot:analyst"],
        publishedBy: "human-ceo",
      },
      { cfg, nowMs: 100 },
    );
    expect(published.ok).toBe(true);
    if (!published.ok) {
      return;
    }

    const t1 = okScan(
      await runGroupTaskHeartbeat(
        auth,
        { groupId: SAMPLE_GRAY },
        {
          cfg,
          force: true,
          nowMs: 1_000,
          coordinatorBotId: "bot:coord",
          skipClaimBridge: true,
          actorId: "system:hb",
        },
      ),
    );
    expect(calls).toBe(1);
    const st1 = t1.state.items[published.value.itemId];
    const human1 = t1.decisions.find(
      (d) => d.itemId === published.value.itemId && d.action === "human_todo",
    );
    expect(human1).toBeTruthy();
    expect(human1?.reason).toContain("side_effect_unknown");
    expect(st1?.humanAttention?.status).toBe("needs_human");
    expect(st1?.humanAttention?.source).toBe("side_effect_unknown");
    // Must NOT be the not_started fail-count path (would leave action as nudge).
    expect(
      t1.decisions.some((d) => d.itemId === published.value.itemId && d.action === "nudge"),
    ).toBe(false);

    // Next scan: open humanAttention stays human_todo; no second dispatcher invoke.
    const t2 = okScan(
      await runGroupTaskHeartbeat(
        auth,
        { groupId: SAMPLE_GRAY },
        {
          cfg,
          force: true,
          nowMs: 60_000,
          coordinatorBotId: "bot:coord",
          skipClaimBridge: true,
          actorId: "system:hb",
        },
      ),
    );
    expect(calls).toBe(1);
    const human2 = t2.decisions.find(
      (d) => d.itemId === published.value.itemId && d.action === "human_todo",
    );
    expect(human2).toBeTruthy();
    expect(t2.state.items[published.value.itemId]?.humanAttention?.status).toBe("needs_human");
    expect(
      t2.decisions.some(
        (d) =>
          d.itemId === published.value.itemId && (d.action === "nudge" || d.action === "escalate"),
      ),
    ).toBe(false);
  });
});

describe("watchdog closure — review routing integration", () => {
  it("submitted_for_review nudges task.responsibility.reviewer after enrichment", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    const taskId = "task_review_route";
    const seedTask = {
      taskId,
      groupId: SAMPLE_GRAY,
      title: "review route",
      goal: "g",
      status: "OPEN",
      createdAt: 1,
      updatedAt: 1,
    } as unknown as Task;

    const published = await publishBoardItem(
      auth,
      {
        groupId: SAMPLE_GRAY,
        taskId,
        remainingWork: "交卷",
        acceptanceCriteria: ["有证据"],
        intendedClaimantIds: ["bot:executor"],
        publishedBy: "bot:publisher",
      },
      { cfg, nowMs: 100 },
    );
    expect(published.ok).toBe(true);
    if (!published.ok) {
      return;
    }

    const claimed = await claimBoardItem(
      auth,
      { taskId, itemId: published.value.itemId, claimantId: "bot:executor" },
      { cfg, nowMs: 200 },
    );
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) {
      return;
    }

    const applied = await applyClaim(
      auth,
      { taskId, itemId: published.value.itemId },
      seedTask,
      auth.policy.effective,
      { cfg, nowMs: 300 },
    );
    expect(applied.ok).toBe(true);
    if (!applied.ok) {
      return;
    }

    const proposed = await proposeTodolist(
      auth,
      {
        boardItemId: published.value.itemId,
        taskId,
        groupId: SAMPLE_GRAY,
        ownerMemberId: "bot:executor",
        steps: [{ title: "交卷准备" }],
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
        taskId,
        todolistId: proposed.value.todolistId,
        confirmerId: "bot:publisher",
      },
      { cfg, authorizedConfirmerIds: ["bot:publisher"] },
    );
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) {
      return;
    }

    const progress = await markBoardItemInProgress(
      auth,
      { taskId, itemId: published.value.itemId, actorId: "bot:executor" },
      { cfg, nowMs: 400 },
    );
    expect(progress.ok).toBe(true);
    if (!progress.ok) {
      return;
    }

    const { seedLinkedTeamDeliverableFixture, P2_LINKED_DELIVERABLE_FIXTURE } =
      await import("../collaboration-learning/verify-linked-team-deliverable.js");
    const seeded = await seedLinkedTeamDeliverableFixture({
      authority: auth,
      taskId,
      deliverableId: P2_LINKED_DELIVERABLE_FIXTURE.linkedDeliverableId,
      version: P2_LINKED_DELIVERABLE_FIXTURE.linkedDeliverableVersion,
    });
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) {
      return;
    }

    const submitted = await submitBoardItemForReview(
      auth,
      {
        taskId,
        itemId: published.value.itemId,
        actorId: "bot:executor",
        submissionId: "11111111-1111-4111-8111-111111111111",
        artifactVersion: "v1",
        submissionSummary: "review-route deliverable ready for reviewer",
        linkedDeliverableId: P2_LINKED_DELIVERABLE_FIXTURE.linkedDeliverableId,
        linkedDeliverableVersion: P2_LINKED_DELIVERABLE_FIXTURE.linkedDeliverableVersion,
        linkedContentSha256: seeded.contentSha256,
      },
      { cfg, nowMs: 500 },
    );
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) {
      return;
    }

    // Persist reviewer on the same task object store heartbeat enrichment reads
    // (createWorkspaceCollaborationStores(cfg) — no preferRuntime mismatch).
    const stores = createWorkspaceCollaborationStores(cfg);
    const current =
      (await stores.objectStorage.readObject<Task>(SAMPLE_GRAY, "task", taskId)) ?? seedTask;
    await stores.objectStorage.writeObject(SAMPLE_GRAY, "task", taskId, {
      ...current,
      responsibility: {
        owner: "bot:publisher",
        executors: ["bot:executor"],
        reviewer: "bot:reviewer",
        decisionAuthority: "bot:publisher",
      },
    } as Task);

    // Submit installs pendingEventRelay (product wake). Clear it so heartbeat
    // re-plans from board + task.responsibility enrichment (not relay guard).
    const live = await loadBoardClaimItem(auth, {
      taskId,
      itemId: published.value.itemId,
    });
    expect(live?.status).toBe("submitted_for_review");
    const pendingOpKey = live?.pendingEventRelay?.opKey;
    expect(pendingOpKey).toBeTruthy();
    if (pendingOpKey) {
      const cleared = await clearBoardPendingEventRelay(
        auth,
        { taskId, itemId: published.value.itemId, expectedOpKey: pendingOpKey },
        { cfg },
      );
      expect(cleared.ok).toBe(true);
    }

    setWakeRoundDispatcher(async () => ({
      ok: true,
      roundId: "round_review_1",
      sideEffectClass: "completed_with_receipt",
    }));

    const tick = okScan(
      await runGroupTaskHeartbeat(
        auth,
        { groupId: SAMPLE_GRAY },
        {
          cfg,
          force: true,
          nowMs: 2_000,
          coordinatorBotId: "bot:coord",
          skipClaimBridge: true,
          actorId: "system:hb",
        },
      ),
    );
    const decision = tick.decisions.find((d) => d.itemId === published.value.itemId);
    expect(decision?.action).toBe("nudge");
    expect(decision?.reason).toContain("awaiting_review");
    expect(decision?.toAgentIds).toContain("bot:reviewer");
    expect(decision?.toAgentIds).not.toContain("bot:executor");
  });
});
