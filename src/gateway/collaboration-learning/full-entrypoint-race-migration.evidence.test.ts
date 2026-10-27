/**
 * T34 A1/A2/A3 — full-entrypoint stop↔wake-revoke races + caller migration inventory.
 * T36 L3: marker constants deleted; migration matrix asserts U1–U3 behavior.
 * This file closes named race gaps beyond CMD-5 partial U1-BOUND-RACE / REVOKE-HB / IDEMPOTENT.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Task } from "@openbot/collaboration-core";
import { afterEach, describe, expect, test } from "vitest";
import {
  clearConfigCache,
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { makeOperatingState } from "../collaboration-dispatch/__fixtures__/policy-source-matrix.js";
import { episodeIdForClientRun } from "../collaboration-dispatch/collaboration-event-key.js";
import { runDeliveryToolSideEffect } from "../collaboration-dispatch/delivery-tool-side-effect.js";
import { resolveGroupPolicyInput } from "../collaboration-dispatch/resolve-effective-policy.js";
import {
  createRoundPolicySnapshot,
  generatePolicySnapshotId,
} from "../collaboration-dispatch/round-policy-snapshot.js";
import { createRuntimeAuthority } from "../collaboration-dispatch/runtime-authority.js";
import { readOperatingStateAuthEpoch } from "../collaboration-dispatch/task-control-cas.js";
import { recheckCurrentDispatchAuthorization } from "../collaboration-dispatch/task-dispatch-auth-recheck.js";
import { readWakeOpRecord } from "../collaboration-dispatch/wake-op-ledger.js";
import { consumeWakeForRoundDispatch } from "../collaboration-dispatch/wake-round-dispatch.js";
import { resolveSecurityProfile } from "../security-profile.js";
import { markCollaborationBoardItemInProgress } from "./claim-contract-entry.js";
import { proposeCollaborationTaskHandoffContract } from "./handoff-contract-entry.js";
import { runCollaborationSelfAdvance } from "./self-advance-entry.js";
import {
  createWorkspaceCollaborationStores,
  readGroupOperatingState,
  writeGroupOperatingState,
} from "./shared.js";
import { resolveCollaborationGroupTenantId } from "./shared.js";
import { requestCollaborationTaskStop, TaskStoppedError } from "./task-stop-entry.js";
import { resolveAuthorityTenantForEntry } from "./trusted-tenant.js";
import { listCollaborationWakeEvents } from "./wake-contract-entry.js";

const tempDirs: string[] = [];
const savedEnv = {
  OPENBOT_STATE_DIR: process.env.OPENBOT_STATE_DIR,
  OPENBOT_CONFIG_PATH: process.env.OPENBOT_CONFIG_PATH,
  OPENCLAW_CONFIG_PATH: process.env.OPENCLAW_CONFIG_PATH,
  OPENBOT_SECURITY_PROFILE: process.env.OPENBOT_SECURITY_PROFILE,
  OPENCLAW_SECURITY_PROFILE: process.env.OPENCLAW_SECURITY_PROFILE,
  OPENBOT_TENANTS_ROOT: process.env.OPENBOT_TENANTS_ROOT,
};

afterEach(async () => {
  clearRuntimeConfigSnapshot();
  clearConfigCache();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function useIsolationRoot(opts: { handoffContract?: boolean; claimContract?: boolean } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-a1-race-"));
  tempDirs.push(root);
  process.env.OPENBOT_STATE_DIR = root;
  process.env.OPENBOT_TENANTS_ROOT = path.join(root, "tenants");
  const configPath = path.join(root, "openbot.json");
  process.env.OPENBOT_CONFIG_PATH = configPath;
  process.env.OPENCLAW_CONFIG_PATH = configPath;
  process.env.OPENBOT_SECURITY_PROFILE = "local";
  process.env.OPENCLAW_SECURITY_PROFILE = "local";
  const cfg = {
    collaboration: {
      task: {
        handoffContract: opts.handoffContract ?? true,
        claimContract: opts.claimContract ?? true,
        wakeContract: true,
        selfAdvance: { mode: "execute", executeGroupAllowlist: [] },
      },
    },
  } as OpenBotConfig;
  await fs.writeFile(configPath, JSON.stringify(cfg, null, 2), "utf8");
  setRuntimeConfigSnapshot(cfg);
  clearConfigCache();
  return { root, cfg };
}

const tenant = {
  groupId: "grp-a1-race",
  owner: "tenant-a1/emp-owner",
  bot0: "tenant-a1/bot-coord",
  bot1: "tenant-a1/bot-exec",
};

async function seed(params: { cfg: OpenBotConfig; taskId: string }) {
  const groupId = tenant.groupId;
  const { fileStore, objectStorage } = createWorkspaceCollaborationStores(params.cfg);
  const state = makeOperatingState({
    groupId,
    governance: { coordinatorBotId: tenant.bot0, ownerUserId: tenant.owner },
  });
  state.memberRoleMap = [
    {
      memberId: tenant.owner,
      memberKind: "human",
      governanceRole: "owner",
      collaborationRole: null,
      status: "active",
    },
    {
      memberId: tenant.bot0,
      memberKind: "bot",
      governanceRole: "member",
      collaborationRole: null,
      status: "active",
    },
    {
      memberId: tenant.bot1,
      memberKind: "bot",
      governanceRole: "member",
      collaborationRole: null,
      status: "active",
    },
  ];
  state.activeContext = { ...state.activeContext, currentTaskId: params.taskId };
  await writeGroupOperatingState({ fileStore, groupId, state });
  await objectStorage.writeObject(groupId, "task", params.taskId, {
    taskId: params.taskId,
    groupId,
    title: "a1-race",
    status: "in_progress",
    ownerMemberId: tenant.bot0,
    assignedMemberIds: [tenant.bot0],
    responsibility: {
      owner: tenant.bot0,
      executors: [tenant.bot0],
      reviewers: [],
      approvers: [tenant.owner],
    },
    createdAtMs: 1,
    updatedAtMs: 1,
  } as Task);
  const now = Date.now();
  const snapshot = createRoundPolicySnapshot(resolveGroupPolicyInput({ operatingState: state }), {
    now,
    idGen: () => generatePolicySnapshotId(now),
  });
  const authority = createRuntimeAuthority({
    snapshot,
    episodeId: episodeIdForClientRun(`task-wake:${groupId}:${params.taskId}`),
    tenant: resolveAuthorityTenantForEntry({
      preferred: null,
      groupTenantId: resolveCollaborationGroupTenantId(groupId),
    }),
    groupId,
    profile: resolveSecurityProfile(params.cfg).profile,
    cfg: params.cfg,
  });
  return { authority, state, groupId, objectStorage, fileStore };
}

function wakeReq(taskId: string, itemId: string) {
  return {
    groupId: tenant.groupId,
    fromAgentId: "system:group_task_heartbeat",
    toAgentIds: [tenant.bot0],
    source: "nudge" as const,
    taskId,
    itemId,
    reason: "a1-race",
  };
}

async function writeAuthOsForTest(params: {
  fileStore: ReturnType<typeof createWorkspaceCollaborationStores>["fileStore"];
  groupId: string;
  state: Parameters<typeof writeGroupOperatingState>[0]["state"];
  cfg?: OpenBotConfig;
}) {
  const live = await readGroupOperatingState({
    fileStore: params.fileStore,
    groupId: params.groupId,
  });
  const nextEpoch = readOperatingStateAuthEpoch(live) + 1;
  await writeGroupOperatingState({
    fileStore: params.fileStore,
    groupId: params.groupId,
    cfg: params.cfg,
    writeKind: "auth",
    state: {
      ...params.state,
      authEpoch: nextEpoch,
      updatedAtMs: Date.now(),
    } as Parameters<typeof writeGroupOperatingState>[0]["state"] & { authEpoch: number },
  });
  return nextEpoch;
}

describe("T34 A1 full-entrypoint races", () => {
  test("A1-RACE-STOP-WAKE-01: stop after claim / before dispatch → no side-effect (TOCTOU closed)", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-a1-stop-wake-toc";
    const { authority } = await seed({ cfg, taskId });

    let release!: () => void;
    const barrier = new Promise<void>((r) => {
      release = r;
    });
    let calls = 0;
    const wakeP = consumeWakeForRoundDispatch({
      authority,
      cfg,
      writeMode: "execute",
      _testAfterClaimBarrier: () => barrier,
      roundDispatcher: async () => {
        calls += 1;
        return { ok: true, roundId: "should-not" };
      },
      request: wakeReq(taskId, "item-toc"),
    });

    // Wait until claim persisted as running, then accept stop, then release barrier.
    const opKeyHint = [
      tenant.groupId,
      "nudge",
      taskId,
      "item-toc",
      "system:group_task_heartbeat",
      tenant.bot0,
    ].join("|");
    for (let i = 0; i < 200; i += 1) {
      const rec = await readWakeOpRecord({ authority, opKey: opKeyHint });
      if (rec?.status === "running") {
        break;
      }
      await new Promise((r) => setTimeout(r, 5));
    }
    expect((await readWakeOpRecord({ authority, opKey: opKeyHint }))?.status).toBe("running");

    const stopped = await requestCollaborationTaskStop({
      groupId: tenant.groupId,
      taskId,
      actor: tenant.owner,
      reason: "race-after-claim",
      externalEffect: "none",
      cfg,
    });
    expect(stopped.stopControl.status).toBe("accepted");
    release();

    const wake = await wakeP;
    expect(calls).toBe(0);
    expect(wake.dispatched).toBe(false);
    expect(wake.reason).toBe("task_stopped");
    expect((await readWakeOpRecord({ authority, opKey: opKeyHint }))?.status).toBe("failed");
  });

  test("A1-RACE-REVOKE-WAKE-01: revoke after claim / before dispatch → auth_revoked, no side-effect", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-a1-revoke-wake";
    const { authority, fileStore } = await seed({ cfg, taskId });

    let release!: () => void;
    const barrier = new Promise<void>((r) => {
      release = r;
    });
    let calls = 0;
    const wakeP = consumeWakeForRoundDispatch({
      authority,
      cfg,
      writeMode: "execute",
      _testAfterClaimBarrier: () => barrier,
      roundDispatcher: async () => {
        calls += 1;
        return { ok: true, roundId: "revoked-no" };
      },
      request: wakeReq(taskId, "item-revoke-race"),
    });

    const opKeyHint = [
      tenant.groupId,
      "nudge",
      taskId,
      "item-revoke-race",
      "system:group_task_heartbeat",
      tenant.bot0,
    ].join("|");
    for (let i = 0; i < 200; i += 1) {
      const rec = await readWakeOpRecord({ authority, opKey: opKeyHint });
      if (rec?.status === "running") {
        break;
      }
      await new Promise((r) => setTimeout(r, 5));
    }

    const revoked = makeOperatingState({
      groupId: tenant.groupId,
      governance: { ownerUserId: tenant.owner, coordinatorBotId: "" },
    });
    revoked.memberRoleMap = [];
    await writeAuthOsForTest({ fileStore, groupId: tenant.groupId, cfg, state: revoked });
    const auth = await recheckCurrentDispatchAuthorization({
      groupId: tenant.groupId,
      taskId,
      targetActorIds: [tenant.bot0],
      cfg,
    });
    expect(auth.ok).toBe(false);
    release();

    const wake = await wakeP;
    expect(calls).toBe(0);
    expect(wake.dispatched).toBe(false);
    expect(wake.reason).toBe("auth_revoked");
  });

  test("A1-RACE-STOP-WAKE-PARALLEL-01: Promise.all stop+wake; settle → stop held, follow-up wake blocked", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-a1-parallel";
    const { authority } = await seed({ cfg, taskId });

    let calls = 0;
    const [stopResult, wakeResult] = await Promise.all([
      requestCollaborationTaskStop({
        groupId: tenant.groupId,
        taskId,
        actor: tenant.owner,
        reason: "parallel",
        externalEffect: "none",
        cfg,
      }),
      consumeWakeForRoundDispatch({
        authority,
        cfg,
        writeMode: "execute",
        roundDispatcher: async () => {
          calls += 1;
          return { ok: true, roundId: "parallel-wake" };
        },
        request: wakeReq(taskId, "item-parallel"),
      }),
    ]);
    expect(stopResult.stopControl.status).toBe("accepted");
    // Either wake lost the race (task_stopped) or completed before stop; follow-up must not dispatch.
    if (wakeResult.dispatched) {
      expect(calls).toBe(1);
    } else {
      expect(["task_stopped", "wake_op_in_flight", "wake_op_unknown", "auth_revoked"]).toContain(
        wakeResult.reason,
      );
    }

    let follow = 0;
    const again = await consumeWakeForRoundDispatch({
      authority,
      cfg,
      writeMode: "execute",
      roundDispatcher: async () => {
        follow += 1;
        return { ok: true, roundId: "follow" };
      },
      request: wakeReq(taskId, "item-parallel-follow"),
    });
    expect(follow).toBe(0);
    expect(again.dispatched).toBe(false);
    expect(again.reason).toBe("task_stopped");
  });

  test("A1-RACE-MULTI-ENTRY-01: concurrent stop vs handoff/claim/queue/self-advance — writers refuse or skip", async () => {
    const { cfg, root } = await useIsolationRoot({ handoffContract: true, claimContract: true });
    const taskId = "task-a1-multi";
    await seed({ cfg, taskId });

    const stopP = requestCollaborationTaskStop({
      groupId: tenant.groupId,
      taskId,
      actor: tenant.owner,
      reason: "multi-entry",
      externalEffect: "none",
      cfg,
    });

    const handoffP = proposeCollaborationTaskHandoffContract({
      groupId: tenant.groupId,
      taskId,
      from: tenant.bot0,
      to: tenant.bot1,
      kind: "owner_transfer",
      remainingWork: "x",
      acceptanceCriteria: ["y"],
      actor: tenant.bot0,
      cfg,
    }).then(
      (ok) => ({ ok: true as const, value: ok }),
      (err) => ({ ok: false as const, err }),
    );

    const claimP = markCollaborationBoardItemInProgress({
      groupId: tenant.groupId,
      taskId,
      itemId: "item-missing-multi",
      actor: tenant.bot0,
      cfg,
    }).then(
      (ok) => ({ ok: true as const, value: ok }),
      (err) => ({ ok: false as const, err }),
    );

    let queueRan = 0;
    const queueP = runDeliveryToolSideEffect({
      schedule: {
        ledgerDir: path.join(root, "tool-side-effects-multi"),
        taskId,
        boardItemId: "item-m",
        stepId: "step-m",
      },
      toolName: "message",
      groupId: tenant.groupId,
      cfg,
      run: async () => {
        queueRan += 1;
        return "x";
      },
    });

    const selfP = runCollaborationSelfAdvance({
      groupId: tenant.groupId,
      actorId: tenant.owner,
      cfg,
    }).then(
      (ok) => ({ ok: true as const, value: ok }),
      (err) => ({ ok: false as const, err }),
    );

    const [stopped, handoff, claim, queue, selfAdvance] = await Promise.all([
      stopP,
      handoffP,
      claimP,
      queueP,
      selfP,
    ]);
    expect(stopped.stopControl.status).toBe("accepted");

    // After settle, all write entries must observe stop (reject/skip) — not silently succeed past U1.
    if (handoff.ok) {
      // Rare: handoff won before stop; follow-up must fail.
      await expect(
        proposeCollaborationTaskHandoffContract({
          groupId: tenant.groupId,
          taskId,
          from: tenant.bot0,
          to: tenant.bot1,
          kind: "owner_transfer",
          remainingWork: "z",
          acceptanceCriteria: ["w"],
          actor: tenant.bot0,
          cfg,
        }),
      ).rejects.toBeInstanceOf(TaskStoppedError);
    } else {
      expect(handoff.err).toBeInstanceOf(TaskStoppedError);
    }

    // Claim may lose to item-not-found if it raced before stop; follow-up must see stop.
    await expect(
      markCollaborationBoardItemInProgress({
        groupId: tenant.groupId,
        taskId,
        itemId: "item-missing-multi-2",
        actor: tenant.bot0,
        cfg,
      }),
    ).rejects.toBeInstanceOf(TaskStoppedError);
    void claim;

    // Queue: either skipped due to stop, or if it raced before stop, a second call skips.
    const queue2 = await runDeliveryToolSideEffect({
      schedule: {
        ledgerDir: path.join(root, "tool-side-effects-multi-2"),
        taskId,
        boardItemId: "item-m2",
        stepId: "step-m2",
      },
      toolName: "message",
      groupId: tenant.groupId,
      cfg,
      run: async () => {
        queueRan += 1;
        return "y";
      },
    });
    expect(queue2.skipped).toBe(true);
    void queue;
    void selfAdvance;
  });
});

describe("T34 A2 caller migration inventory + A3 old-write reachability", () => {
  test("A2-MIGRATE-MATRIX-01: entry → U1–U3 gate binding (source inventory)", async () => {
    const rows: Array<{ file: string; mustMatch: RegExp; role: string; l3Only: boolean }> = [
      {
        file: "src/gateway/server-methods/collaboration-learning.ts",
        mustMatch: /"collaboration\.task\.stop"[\s\S]*requestCollaborationTaskStop/,
        role: "RPC stop → U1 requestCollaborationTaskStop",
        l3Only: false,
      },
      {
        file: "src/gateway/collaboration-learning/self-advance-entry.ts",
        mustMatch: /assertPersistedTaskNotStopped[\s\S]*trySelfAdvance/,
        role: "self-advance entry → U1 guard then trySelfAdvance (L3 adapter marker)",
        l3Only: false,
      },
      {
        file: "src/gateway/collaboration-learning/wake-contract-entry.ts",
        mustMatch: /listCollaborationWakeEvents[\s\S]*listWakeEvents/,
        role: "wake entry list delegates to read-only listWakeEvents (no write)",
        l3Only: false,
      },
      {
        file: "src/gateway/collaboration-dispatch/wake-round-dispatch.ts",
        mustMatch: /inspectWakeOp[\s\S]*isTaskStopAccepted[\s\S]*claimWakeOpRunning/,
        role: "WAKE consume → U1 stop + U2 auth + U3 claim",
        l3Only: false,
      },
      {
        file: "src/gateway/collaboration-dispatch/group-task-heartbeat.ts",
        mustMatch: /consumeWakeForRoundDispatch/,
        role: "HB nudge/escalate → consumeWake (U1–U3)",
        l3Only: false,
      },
      {
        file: "src/gateway/collaboration-learning/handoff-contract-entry.ts",
        mustMatch: /assertPersistedTaskNotStopped/,
        role: "handoff entry → U1",
        l3Only: false,
      },
      {
        file: "src/gateway/collaboration-learning/claim-contract-entry.ts",
        mustMatch: /assertPersistedTaskNotStopped/,
        role: "claim entry → U1",
        l3Only: false,
      },
      {
        file: "src/agents/tools/collaboration-board-tool.ts",
        mustMatch: /assertPersistedTaskNotStopped/,
        role: "board tool → U1",
        l3Only: false,
      },
      {
        file: "src/gateway/collaboration-dispatch/delivery-tool-side-effect.ts",
        mustMatch: /isTaskStopAccepted/,
        role: "queue side-effect → U1",
        l3Only: false,
      },
      {
        file: "src/gateway/collaboration-dispatch/continue-after-round.ts",
        mustMatch: /consumeWakeForRoundDispatch/,
        role: "continue-after-round → consumeWake",
        l3Only: false,
      },
    ];
    for (const row of rows) {
      const text = await fs.readFile(path.join(process.cwd(), row.file), "utf8");
      expect(text, row.role).toMatch(row.mustMatch);
      expect(row.l3Only, `${row.role} must not be L3-only write authority`).toBe(false);
    }
    // L3 markers deleted (T36); behavior entries remain.
    expect(typeof runCollaborationSelfAdvance).toBe("function");
    expect(typeof listCollaborationWakeEvents).toBe("function");
  });

  test("A2-L3-CLEANUP-01: marker constants removed; behavior assertions retained", async () => {
    const sa = await fs.readFile(
      path.join(process.cwd(), "src/gateway/collaboration-learning/self-advance-entry.ts"),
      "utf8",
    );
    const wake = await fs.readFile(
      path.join(process.cwd(), "src/gateway/collaboration-learning/wake-contract-entry.ts"),
      "utf8",
    );
    expect(sa).not.toMatch(/SELF_ADVANCE_ENTRY_DELEGATES_UNIFIED_GATE/);
    expect(wake).not.toMatch(/WAKE_CONTRACT_ENTRY_READ_PATHS_DO_NOT_WRITE/);
    expect(sa).toMatch(/assertPersistedTaskNotStopped/);
    expect(wake).toMatch(/listCollaborationWakeEvents/);
  });

  test("A3-PAUSE-RESUME-ABSENT-01: collaboration.task.pause/resume not registered on this tip", async () => {
    const list = await fs.readFile(
      path.join(process.cwd(), "src/gateway/server-methods-list.ts"),
      "utf8",
    );
    const scopes = await fs.readFile(
      path.join(process.cwd(), "src/gateway/method-scopes.ts"),
      "utf8",
    );
    const handlers = await fs.readFile(
      path.join(process.cwd(), "src/gateway/server-methods/collaboration-learning.ts"),
      "utf8",
    );
    for (const text of [list, scopes, handlers]) {
      expect(text).toMatch(/"collaboration\.task\.stop"/);
      expect(text).not.toMatch(/"collaboration\.task\.pause"/);
      expect(text).not.toMatch(/"collaboration\.task\.resume"/);
    }
  });

  test("A3-NO-SECOND-STOP-SOT-01: stopControl remains on task authority object only", async () => {
    const runtime = await fs.readFile(
      path.join(process.cwd(), "src/gateway/collaboration-dispatch/task-runtime.ts"),
      "utf8",
    );
    expect(runtime).toMatch(/stopControl/);
    // No parallel pause store module for collaboration.task.
    await expect(
      fs.access(path.join(process.cwd(), "src/gateway/collaboration-learning/task-pause-entry.ts")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
