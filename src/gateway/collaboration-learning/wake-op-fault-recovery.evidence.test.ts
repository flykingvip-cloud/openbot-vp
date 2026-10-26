import { spawnSync } from "node:child_process";
/**
 * T34-B fault recovery (isolation): real child-process exit/restart, stale locks,
 * interrupted/corrupt writes. Recovery must re-check stop+auth, not duplicate
 * effective dispatch, not permanently lose legitimate completed work, not silently
 * overwrite corrupted state; undecidable → block / keep unknown.
 */
import { createHash } from "node:crypto";
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
import { resolveGroupPolicyInput } from "../collaboration-dispatch/resolve-effective-policy.js";
import {
  createRoundPolicySnapshot,
  generatePolicySnapshotId,
} from "../collaboration-dispatch/round-policy-snapshot.js";
import {
  ROUND_LOCK_STALE_MS,
  roundLockPath,
  withRoundLock,
} from "../collaboration-dispatch/round-store-io.js";
import { createRuntimeAuthority } from "../collaboration-dispatch/runtime-authority.js";
import {
  claimWakeOpRunning,
  inspectWakeOp,
  markWakeOpCompleted,
  markWakeOpFailed,
  readWakeOpRecord,
  readWakeOpRecordDetailed,
  wakeOpIdempotencyKey,
  wakeOpRecordPath,
  wakeOpsDir,
} from "../collaboration-dispatch/wake-op-ledger.js";
import { consumeWakeForRoundDispatch } from "../collaboration-dispatch/wake-round-dispatch.js";
import { resolveSecurityProfile } from "../security-profile.js";
import { createWorkspaceCollaborationStores, writeGroupOperatingState } from "./shared.js";
import { resolveCollaborationGroupTenantId } from "./shared.js";
import { requestCollaborationTaskStop } from "./task-stop-entry.js";
import { resolveAuthorityTenantForEntry } from "./trusted-tenant.js";

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

async function useIsolationRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-b-fault-"));
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
        wakeContract: true,
        selfAdvance: { mode: "execute", executeGroupAllowlist: [] },
      },
    },
  } as OpenBotConfig;
  await fs.writeFile(configPath, JSON.stringify(cfg, null, 2), "utf8");
  setRuntimeConfigSnapshot(cfg);
  clearConfigCache();
  return { root, cfg, configPath };
}

const tenant = {
  groupId: "grp-b-fault",
  owner: "tenant-b-fault/emp-owner",
  bot: "tenant-b-fault/bot-exec",
};

async function seedGroup(params: { cfg: OpenBotConfig; taskId: string; stopped?: boolean }) {
  const groupId = tenant.groupId;
  const { fileStore, objectStorage } = createWorkspaceCollaborationStores(params.cfg);
  const state = makeOperatingState({
    groupId,
    governance: { coordinatorBotId: tenant.bot, ownerUserId: tenant.owner },
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
      memberId: tenant.bot,
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
    title: "b-fault",
    status: "in_progress",
    ownerMemberId: tenant.bot,
    assignedMemberIds: [tenant.bot],
    responsibility: {
      owner: tenant.bot,
      executors: [tenant.bot],
      reviewers: [],
      approvers: [tenant.owner],
    },
    createdAtMs: 1,
    updatedAtMs: 1,
  } as Task);
  if (params.stopped) {
    await requestCollaborationTaskStop({
      groupId,
      taskId: params.taskId,
      actor: tenant.owner,
      reason: "seed-stopped",
      externalEffect: "none",
      cfg: params.cfg,
    });
  }
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

function requestFor(taskId: string, itemId: string) {
  return {
    groupId: tenant.groupId,
    fromAgentId: "system:group_task_heartbeat",
    toAgentIds: [tenant.bot],
    source: "self_advance" as const,
    taskId,
    itemId,
    reason: "b-fault",
  };
}

/**
 * Real OS child process: write a completed wake-op record into the parent's
 * namespace using the same path algorithm, then exit. Parent reloads via APIs.
 */
function childWriteCompletedWakeOp(params: {
  wakeOpsRoot: string;
  opKey: string;
  record: Record<string, unknown>;
}): { status: number | null; stderr: string } {
  const script = `
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = process.argv[1];
const opKey = process.argv[2];
const recordJson = process.argv[3];
const digest = crypto.createHash("sha256").update(opKey).digest("hex");
const dest = path.join(root, digest + ".json");
fs.mkdirSync(root, { recursive: true });
const tmp = dest + "." + process.pid + ".child.tmp";
fs.writeFileSync(tmp, recordJson + "\\n", { encoding: "utf8", mode: 0o600 });
fs.renameSync(tmp, dest);
process.exit(0);
`;
  const result = spawnSync(
    process.execPath,
    ["-e", script, params.wakeOpsRoot, params.opKey, JSON.stringify(params.record)],
    {
      encoding: "utf8",
    },
  );
  return { status: result.status, stderr: result.stderr ?? "" };
}

/** Child claims running semantics by writing status=running then exiting hard (no completed). */
function childWriteRunningThenExit(params: {
  wakeOpsRoot: string;
  opKey: string;
  record: Record<string, unknown>;
}): { status: number | null } {
  const script = `
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = process.argv[1];
const opKey = process.argv[2];
const recordJson = process.argv[3];
const digest = crypto.createHash("sha256").update(opKey).digest("hex");
const dest = path.join(root, digest + ".json");
fs.mkdirSync(root, { recursive: true });
fs.writeFileSync(dest, recordJson + "\\n", { encoding: "utf8", mode: 0o600 });
process.exit(1);
`;
  const result = spawnSync(
    process.execPath,
    ["-e", script, params.wakeOpsRoot, params.opKey, JSON.stringify(params.record)],
    {
      encoding: "utf8",
    },
  );
  return { status: result.status };
}

describe("T34-B wake-op / lock fault recovery (isolation)", () => {
  test("B-PROCESS-EXIT-01: child writes completed then exits; parent reload reuses — no duplicate dispatch", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-b-proc-completed";
    const { authority } = await seedGroup({ cfg, taskId });
    const request = requestFor(taskId, "item-completed");
    const opKey = wakeOpIdempotencyKey(request);
    const now = Date.now();
    const record = {
      opKey,
      groupId: tenant.groupId,
      source: "self_advance",
      taskId,
      itemId: "item-completed",
      fromAgentId: request.fromAgentId,
      toAgentIds: [tenant.bot],
      status: "completed",
      roundId: "round-child-completed",
      createdAtMs: now,
      updatedAtMs: now,
    };
    const child = childWriteCompletedWakeOp({
      wakeOpsRoot: wakeOpsDir(authority),
      opKey,
      record,
    });
    expect(child.status).toBe(0);

    // New handles after "restart".
    clearConfigCache();
    setRuntimeConfigSnapshot(cfg);
    const reloaded = await readWakeOpRecord({ authority, opKey });
    expect(reloaded?.status).toBe("completed");
    expect(reloaded?.roundId).toBe("round-child-completed");

    let calls = 0;
    const consume = await consumeWakeForRoundDispatch({
      authority,
      cfg,
      writeMode: "execute",
      roundDispatcher: async () => {
        calls += 1;
        return { ok: true, roundId: "should-not-dispatch" };
      },
      request,
    });
    expect(calls).toBe(0);
    expect(consume.reused).toBe(true);
    expect(consume.roundId).toBe("round-child-completed");
    expect(consume.reason).toBe("idempotent_reuse");
  });

  test("B-PROCESS-EXIT-02: child dies while running; parent suppresses — no blind re-run; work not silently dropped as absent", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-b-proc-running";
    const { authority } = await seedGroup({ cfg, taskId });
    const request = requestFor(taskId, "item-running-crash");
    const opKey = wakeOpIdempotencyKey(request);
    const now = Date.now();
    const child = childWriteRunningThenExit({
      wakeOpsRoot: wakeOpsDir(authority),
      opKey,
      record: {
        opKey,
        groupId: tenant.groupId,
        source: "self_advance",
        taskId,
        itemId: "item-running-crash",
        fromAgentId: request.fromAgentId,
        toAgentIds: [tenant.bot],
        status: "running",
        createdAtMs: now,
        updatedAtMs: now,
      },
    });
    expect(child.status).toBe(1);

    const detailed = await readWakeOpRecordDetailed({ authority, opKey });
    expect(detailed.state).toBe("ok");
    if (detailed.state === "ok") {
      expect(detailed.record.status).toBe("running");
    }

    let calls = 0;
    const consume = await consumeWakeForRoundDispatch({
      authority,
      cfg,
      writeMode: "execute",
      roundDispatcher: async () => {
        calls += 1;
        return { ok: true, roundId: "blind" };
      },
      request,
    });
    expect(calls).toBe(0);
    expect(consume.dispatched).toBe(false);
    expect(consume.reason).toBe("wake_op_in_flight");
    // Legitimate in-flight marker preserved (not treated as missing → re-dispatch).
    expect((await readWakeOpRecord({ authority, opKey }))?.status).toBe("running");
  });

  test("B-PROCESS-EXIT-03: after restart, stop + auth recheck still gate failed→retry path", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-b-proc-stop-auth";
    const { authority } = await seedGroup({ cfg, taskId });
    const request = requestFor(taskId, "item-failed-retry");
    const opKey = wakeOpIdempotencyKey(request);

    await claimWakeOpRunning({ authority, keyInput: request, cfg });
    await markWakeOpFailed({ authority, opKey, cfg, detail: "before_restart" });
    expect((await readWakeOpRecord({ authority, opKey }))?.status).toBe("failed");

    // Persist stop, then "restart" with new store handles + consume.
    await requestCollaborationTaskStop({
      groupId: tenant.groupId,
      taskId,
      actor: tenant.owner,
      reason: "post-restart-stop",
      externalEffect: "none",
      cfg,
    });
    const { objectStorage: freshStore } = createWorkspaceCollaborationStores(cfg);
    const task = await freshStore.readObject<Task & { stopControl?: { status?: string } }>(
      tenant.groupId,
      "task",
      taskId,
    );
    expect(task?.stopControl?.status).toBe("accepted");

    let calls = 0;
    const consume = await consumeWakeForRoundDispatch({
      authority,
      cfg,
      writeMode: "execute",
      roundDispatcher: async () => {
        calls += 1;
        return { ok: true, roundId: "stopped-no" };
      },
      request,
    });
    expect(calls).toBe(0);
    expect(consume.reason).toBe("task_stopped");
    expect(consume.dispatched).toBe(false);

    // Revoke membership → auth_revoked even if stop cleared.
    const cleared = { ...(task as Record<string, unknown>) };
    delete cleared.stopControl;
    await freshStore.writeObject(tenant.groupId, "task", taskId, cleared as Task);
    const { fileStore } = createWorkspaceCollaborationStores(cfg);
    const revoked = makeOperatingState({
      groupId: tenant.groupId,
      governance: { ownerUserId: tenant.owner, coordinatorBotId: "" },
    });
    revoked.memberRoleMap = [];
    await writeGroupOperatingState({ fileStore, groupId: tenant.groupId, state: revoked });

    const authBlocked = await consumeWakeForRoundDispatch({
      authority,
      cfg,
      writeMode: "execute",
      roundDispatcher: async () => {
        calls += 1;
        return { ok: true, roundId: "auth-no" };
      },
      request,
    });
    expect(calls).toBe(0);
    expect(authBlocked.reason).toBe("auth_revoked");
  });

  test("B-STALE-LOCK-01: residual lock older than ROUND_LOCK_STALE_MS is cleared; holder proceeds", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-b-lock-"));
    tempDirs.push(dir);
    const stem = "stale-lock-stem";
    const lockPath = roundLockPath(dir, stem);
    await fs.writeFile(lockPath, "999001\n0\n", "utf8");
    const aged = new Date(Date.now() - ROUND_LOCK_STALE_MS - 5_000);
    await fs.utimes(lockPath, aged, aged);

    let ran = false;
    await withRoundLock(dir, stem, async () => {
      ran = true;
      return "ok";
    });
    expect(ran).toBe(true);
    await expect(fs.access(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("B-STALE-LOCK-02: wake-op claim recovers after stale lock left in wake-ops dir", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-b-stale-wake-lock";
    const { authority } = await seedGroup({ cfg, taskId });
    const request = requestFor(taskId, "item-stale-lock");
    const opKey = wakeOpIdempotencyKey(request);
    const dir = wakeOpsDir(authority);
    await fs.mkdir(dir, { recursive: true });
    const stem = createHash("sha256").update(opKey).digest("hex").slice(0, 32);
    const lockPath = roundLockPath(dir, stem);
    await fs.writeFile(lockPath, `${process.pid}\n${Date.now()}\n`, "utf8");
    const aged = new Date(Date.now() - ROUND_LOCK_STALE_MS - 1_000);
    await fs.utimes(lockPath, aged, aged);

    const claimed = await claimWakeOpRunning({ authority, keyInput: request, cfg });
    expect(claimed.action).toBe("proceed");
    expect(claimed.record?.status).toBe("running");
  });

  test("B-INTERRUPT-WRITE-01: truncated/corrupt JSON → suppress wake_op_corrupt; bytes not overwritten", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-b-corrupt";
    const { authority } = await seedGroup({ cfg, taskId });
    const request = requestFor(taskId, "item-corrupt");
    const opKey = wakeOpIdempotencyKey(request);
    const filePath = wakeOpRecordPath(authority, opKey);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const truncated = '{"opKey":"' + opKey + '","status":"completed","roundId":"r1"';
    await fs.writeFile(filePath, truncated, "utf8");

    const detailed = await readWakeOpRecordDetailed({ authority, opKey });
    expect(detailed.state).toBe("corrupt");

    const inspected = await inspectWakeOp({ authority, keyInput: request });
    expect(inspected.action).toBe("suppress");
    if (inspected.action === "suppress") {
      expect(inspected.reason).toBe("wake_op_corrupt");
    }

    const claimed = await claimWakeOpRunning({ authority, keyInput: request, cfg });
    expect(claimed.action).toBe("suppress");
    if (claimed.action === "suppress") {
      expect(claimed.reason).toBe("wake_op_corrupt");
    }

    // Must not silently replace damaged file with a fresh running record.
    const after = await fs.readFile(filePath, "utf8");
    expect(after).toBe(truncated);

    let calls = 0;
    const consume = await consumeWakeForRoundDispatch({
      authority,
      cfg,
      writeMode: "execute",
      roundDispatcher: async () => {
        calls += 1;
        return { ok: true, roundId: "nope" };
      },
      request,
    });
    expect(calls).toBe(0);
    expect(consume.dispatched).toBe(false);
    expect(consume.reason).toBe("wake_op_corrupt");
  });

  test("B-INTERRUPT-WRITE-02: writeJsonDurable crash leaves dest intact (tmp orphan only); completed not lost", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-b-tmp-orphan";
    const { authority } = await seedGroup({ cfg, taskId });
    const request = requestFor(taskId, "item-tmp");
    const opKey = wakeOpIdempotencyKey(request);
    await claimWakeOpRunning({ authority, keyInput: request, cfg });
    await markWakeOpCompleted({
      authority,
      opKey,
      roundId: "round-durable",
      cfg,
    });
    const filePath = wakeOpRecordPath(authority, opKey);
    const before = await fs.readFile(filePath, "utf8");
    expect(before).toContain("round-durable");

    // Simulate crash after tmp write, before rename: orphan tmp + intact dest.
    const orphan = `${filePath}.${process.pid}.orphan.tmp`;
    await fs.writeFile(orphan, '{"status":"running","opKey":"half', "utf8");
    expect(await fs.readFile(filePath, "utf8")).toBe(before);

    const reloaded = await readWakeOpRecord({ authority, opKey });
    expect(reloaded?.status).toBe("completed");
    expect(reloaded?.roundId).toBe("round-durable");

    let calls = 0;
    const consume = await consumeWakeForRoundDispatch({
      authority,
      cfg,
      writeMode: "execute",
      roundDispatcher: async () => {
        calls += 1;
        return { ok: true, roundId: "dup" };
      },
      request,
    });
    expect(calls).toBe(0);
    expect(consume.reused).toBe(true);
  });

  test("B-INTERRUPT-WRITE-03: markWakeOpCompleted refuses to invent over corrupt file", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-b-no-invent";
    const { authority } = await seedGroup({ cfg, taskId });
    const request = requestFor(taskId, "item-no-invent");
    const opKey = wakeOpIdempotencyKey(request);
    const filePath = wakeOpRecordPath(authority, opKey);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const junk = "{not-json";
    await fs.writeFile(filePath, junk, "utf8");

    const updated = await markWakeOpCompleted({
      authority,
      opKey,
      roundId: "invented",
      cfg,
    });
    expect(updated).toBeNull();
    expect(await fs.readFile(filePath, "utf8")).toBe(junk);
  });
});
