/**
 * T36 M1–M3 mechanism evidence: trusted auth, trusted verify, stop×dispatch races.
 * Fail-first gaps closed with barrier-ordered concurrency (not only error returns).
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
import {
  applyApprovedHandoff,
  loadHandoffContract,
} from "../collaboration-dispatch/handoff-contract.js";
import { resolveGroupPolicyInput } from "../collaboration-dispatch/resolve-effective-policy.js";
import {
  createRoundPolicySnapshot,
  generatePolicySnapshotId,
} from "../collaboration-dispatch/round-policy-snapshot.js";
import { createRuntimeAuthority } from "../collaboration-dispatch/runtime-authority.js";
import {
  applyBusinessTaskPatchUnderControlLock,
  applyTaskStopUnderControlLock,
  casClearTaskDispatchClaimForOp,
  casCommitTaskDispatchEligibility,
  casReleaseUnconsumedCommittedClaim,
  casTakeTaskDispatchEligibility,
} from "../collaboration-dispatch/task-control-cas.js";
import { recheckCurrentDispatchAuthorization } from "../collaboration-dispatch/task-dispatch-auth-recheck.js";
import {
  asGovernedTask,
  MissingTaskDeliverableError,
} from "../collaboration-dispatch/task-runtime.js";
import {
  buildAcceptedTaskStopControl,
  TaskStoppedError,
} from "../collaboration-dispatch/task-stop-control.js";
import { createFixtureReceiptNoneAdapter } from "../collaboration-dispatch/wake-op-effect-verify.js";
import {
  claimWakeOpRunning,
  markWakeOpCompleted,
  markWakeOpFailed,
  markWakeOpUnknown,
  mintWakeOpRecoverySubject,
  produceHumanNoneAttestation,
  producePlatformNoneVerification,
  readWakeOpRecord,
  releaseWakeOpForRetry,
  wakeOpAuthFingerprint,
} from "../collaboration-dispatch/wake-op-ledger.js";
import { consumeWakeForRoundDispatch } from "../collaboration-dispatch/wake-round-dispatch.js";
import { resolveSecurityProfile } from "../security-profile.js";
import {
  applyCollaborationBoardClaim,
  claimCollaborationBoardItem,
  loadCollaborationBoardClaimItem,
  publishCollaborationBoardItem,
} from "./claim-contract-entry.js";
import {
  acceptCollaborationTaskHandoffContract,
  applyCollaborationTaskHandoffContract,
  approveCollaborationTaskHandoffContract,
  proposeCollaborationTaskHandoffContract,
} from "./handoff-contract-entry.js";
import {
  createWorkspaceCollaborationStores,
  readGroupOperatingState,
  writeGroupOperatingState,
} from "./shared.js";
import { resolveCollaborationGroupTenantId } from "./shared.js";
import { transitionCollaborationTask } from "./state-machine.js";
import { requestCollaborationTaskStop } from "./task-stop-entry.js";
import { resolveAuthorityTenantForEntry } from "./trusted-tenant.js";
import {
  WAKE_OP_RECOVERY_IDENTITY_MODE,
  confirmWakeOpCompletedAuthorized,
  createInternalLibraryRecoveryExecContext,
  producePlatformNoneVerificationAtRoot,
  releaseWakeOpForRetryAuthorized,
  resolveWakeOpRecoverySubjectForAction,
} from "./wake-op-recovery-entry.js";

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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-t36-"));
  tempDirs.push(root);
  process.env.OPENBOT_STATE_DIR = root;
  process.env.OPENBOT_TENANTS_ROOT = path.join(root, "tenants");
  const configPath = path.join(root, "openbot.json");
  process.env.OPENBOT_CONFIG_PATH = configPath;
  process.env.OPENCLAW_CONFIG_PATH = configPath;
  process.env.OPENBOT_SECURITY_PROFILE = "local";
  process.env.OPENCLAW_SECURITY_PROFILE = "local";
  const cfg = { collaboration: { task: { wakeContract: true } } } as OpenBotConfig;
  await fs.writeFile(configPath, JSON.stringify(cfg, null, 2), "utf8");
  setRuntimeConfigSnapshot(cfg);
  clearConfigCache();
  return { root, cfg };
}

const tenant = {
  tenantId: "tenant-t36-a",
  groupId: "grp-t36-a",
  owner: "tenant-t36-a/emp-owner",
  admin: "tenant-t36-a/emp-admin",
  approver: "tenant-t36-a/emp-approver",
  bot0: "tenant-t36-a/bot-0",
  coordinator: "tenant-t36-a/bot-coord",
};

function buildState(params?: { revokeOwner?: boolean; revokeApprover?: boolean }) {
  const state = makeOperatingState({
    groupId: tenant.groupId,
    governance: {
      coordinatorBotId: tenant.coordinator,
      ownerUserId: tenant.owner,
      adminUserIds: [tenant.admin],
    },
  });
  state.memberRoleMap = [
    {
      memberId: tenant.owner,
      memberKind: "human",
      governanceRole: "owner",
      collaborationRole: null,
      status: params?.revokeOwner ? "revoked" : "active",
    },
    {
      memberId: tenant.admin,
      memberKind: "human",
      governanceRole: "admin",
      collaborationRole: null,
      status: "active",
    },
    {
      memberId: tenant.approver,
      memberKind: "human",
      governanceRole: "member",
      collaborationRole: null,
      status: params?.revokeApprover ? "revoked" : "active",
    },
    {
      memberId: tenant.bot0,
      memberKind: "bot",
      governanceRole: "member",
      collaborationRole: null,
      status: "active",
    },
    {
      memberId: tenant.coordinator,
      memberKind: "bot",
      governanceRole: "member",
      collaborationRole: null,
      status: "active",
    },
  ];
  return state;
}

async function seed(params: { cfg: OpenBotConfig; taskId: string; itemId: string }) {
  const groupId = tenant.groupId;
  const { fileStore, objectStorage } = createWorkspaceCollaborationStores(params.cfg);
  const state = buildState();
  await writeGroupOperatingState({ fileStore, groupId, state });
  await objectStorage.writeObject(groupId, "task", params.taskId, {
    taskId: params.taskId,
    groupId,
    title: "t36",
    status: "in_progress",
    ownerMemberId: tenant.coordinator,
    assignedMemberIds: [tenant.bot0],
    responsibility: {
      owner: tenant.coordinator,
      executors: [tenant.bot0],
      reviewers: [],
      approvers: [tenant.approver],
    },
    controlEpoch: 0,
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
  return { authority, state, groupId, objectStorage, fileStore, taskId: params.taskId };
}

function wakeReq(taskId: string, itemId: string) {
  return {
    groupId: tenant.groupId,
    fromAgentId: "system:group_task_heartbeat",
    toAgentIds: [tenant.bot0],
    source: "nudge" as const,
    taskId,
    itemId,
    reason: "t36-m3",
  };
}

function opKeyFor(taskId: string, itemId: string) {
  return [tenant.groupId, "nudge", taskId, itemId, "system:group_task_heartbeat", tenant.bot0].join(
    "|",
  );
}

async function currentAttemptId(
  authority: Parameters<typeof readWakeOpRecord>[0]["authority"],
  opKey: string,
): Promise<string> {
  const rec = await readWakeOpRecord({ authority, opKey });
  const id = rec?.executionAttemptId?.trim() ?? "";
  if (!id) {
    throw new Error(`missing executionAttemptId for ${opKey}`);
  }
  return id;
}

async function waitRunning(
  authority: Parameters<typeof readWakeOpRecord>[0]["authority"],
  opKey: string,
) {
  for (let i = 0; i < 200; i += 1) {
    const rec = await readWakeOpRecord({ authority, opKey });
    if (rec?.status === "running") {
      return rec;
    }
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`op not running: ${opKey}`);
}

describe("T36 M1 trusted authorization", () => {
  test("M1-FORGE-01: forge identitySource/subject/approver cannot unlock; revoke refuses; owner ok", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-m1-forge";
    const { authority, groupId } = await seed({ cfg, taskId, itemId: "m1" });
    const claimed = await claimWakeOpRunning({
      authority,
      cfg,
      keyInput: {
        groupId,
        source: "nudge",
        fromAgentId: "system:group_task_heartbeat",
        toAgentIds: [tenant.bot0],
        taskId,
        itemId: "m1-unknown",
      },
    });
    expect(claimed.action).toBe("proceed");
    await markWakeOpUnknown({ authority, opKey: claimed.opKey, cfg, detail: "seed" });

    const forged = await releaseWakeOpForRetry({
      authority,
      opKey: claimed.opKey,
      cfg,
      externalEffectVerified: "none",
      verificationId: "x",
      subject: { actorId: tenant.owner, identitySource: "runtime" } as never,
    });
    expect(forged.ok).toBe(false);
    expect((forged as { reason: string }).reason).toBe("operator_identity_not_trusted");

    const forgedApprover = await resolveWakeOpRecoverySubjectForAction({
      groupId,
      taskId,
      actorId: tenant.admin,
      action: "confirm_completed",
      cfg,
    });
    expect(forgedApprover.ok).toBe(false);

    const { fileStore } = createWorkspaceCollaborationStores(cfg);
    await writeGroupOperatingState({
      fileStore,
      groupId,
      state: buildState({ revokeOwner: true }),
    });
    const revoked = await releaseWakeOpForRetryAuthorized({
      authority,
      groupId,
      taskId,
      opKey: claimed.opKey,
      actorId: tenant.owner,
      verificationId: "x",
      cfg,
    });
    expect(revoked.ok).toBe(false);
    expect((await readWakeOpRecord({ authority, opKey: claimed.opKey }))?.status).toBe("unknown");

    await writeGroupOperatingState({ fileStore, groupId, state: buildState() });
    const ver = await producePlatformNoneVerification({
      authority,
      cfg,
      groupId,
      taskId,
      opKey: claimed.opKey,
      attemptId: await currentAttemptId(authority, claimed.opKey),
      probe: async () => ({ source: "probe", outcome: "none" }),
    });
    expect(ver.ok).toBe(true);
    if (!ver.ok) {
      throw new Error("ver");
    }
    const ok = await releaseWakeOpForRetryAuthorized({
      authority,
      groupId,
      taskId,
      opKey: claimed.opKey,
      actorId: tenant.owner,
      verificationId: ver.record.verificationId,
      cfg,
    });
    expect(ok.ok).toBe(true);
    if (!ok.ok) {
      throw new Error("ok");
    }
    expect(ok.record.status).toBe("failed");
    expect(ok.record.releasedBy).toBe(tenant.owner);
  });
});

describe("T36 M2 trusted verification", () => {
  test("M2-VERIFY-01: self-filled unlock refused; human attestation stores basis; late no double-exec", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-m2-verify";
    const { authority, groupId } = await seed({ cfg, taskId, itemId: "m2" });
    const claimed = await claimWakeOpRunning({
      authority,
      cfg,
      keyInput: {
        groupId,
        source: "nudge",
        fromAgentId: "system:group_task_heartbeat",
        toAgentIds: [tenant.bot0],
        taskId,
        itemId: "m2-u",
      },
    });
    await markWakeOpUnknown({ authority, opKey: claimed.opKey, cfg });

    const subject = mintWakeOpRecoverySubject({
      actorId: tenant.owner,
      action: "release_for_retry",
      groupId,
      taskId,
    });
    const selfFilled = await releaseWakeOpForRetry({
      authority,
      opKey: claimed.opKey,
      cfg,
      externalEffectVerified: "none",
      verificationId: "self-filled-not-stored",
      subject,
    });
    expect(selfFilled.ok).toBe(false);
    expect((selfFilled as { reason: string }).reason).toBe("missing_external_effect_verification");

    const human = await produceHumanNoneAttestation({
      authority,
      cfg,
      subject,
      groupId,
      taskId,
      opKey: claimed.opKey,
      attemptId: await currentAttemptId(authority, claimed.opKey),
      basis: "operator inspected external ticket XYZ",
      scope: `tenant:${tenant.tenantId}/task:${taskId}/op:${claimed.opKey}`,
    });
    expect(human.ok).toBe(true);
    if (!human.ok) {
      throw new Error("human");
    }
    expect(human.record.platformAutoProved).toBe(false);
    expect(human.record.basis).toContain("XYZ");
    expect(human.record.responsibleSubjectId).toBe(tenant.owner);

    // Concurrent verify-path release vs late completion → no double execute (stay completed).
    await markWakeOpCompleted({
      authority,
      opKey: claimed.opKey,
      roundId: "late-round",
      cfg,
    });
    // Re-seed unknown with roundId for prior-receipt model, then race confirm vs release.
    await markWakeOpUnknown({ authority, opKey: claimed.opKey, cfg, detail: "gap" });
    // markWakeOpUnknown keeps status unknown; roundId may clear — set completed then unknown with round via claim path.
    const claimed2 = await claimWakeOpRunning({
      authority,
      cfg,
      keyInput: {
        groupId,
        source: "nudge",
        fromAgentId: "system:group_task_heartbeat",
        toAgentIds: [tenant.bot0],
        taskId,
        itemId: "m2-late",
      },
    });
    await markWakeOpCompleted({
      authority,
      opKey: claimed2.opKey,
      roundId: "round-late-m2",
      cfg,
    });
    await markWakeOpUnknown({ authority, opKey: claimed2.opKey, cfg, detail: "receipt_gap" });

    const [confirmR, releaseR] = await Promise.all([
      confirmWakeOpCompletedAuthorized({
        authority,
        groupId,
        taskId,
        opKey: claimed2.opKey,
        roundId: "round-late-m2",
        actorId: tenant.approver,
        cfg,
      }),
      (async () => {
        const v = await producePlatformNoneVerification({
          authority,
          cfg,
          groupId,
          taskId,
          opKey: claimed2.opKey,
          attemptId: await currentAttemptId(authority, claimed2.opKey),
          probe: async () => ({ source: "probe", outcome: "none" }),
        });
        if (!v.ok) {
          return v;
        }
        return releaseWakeOpForRetryAuthorized({
          authority,
          groupId,
          taskId,
          opKey: claimed2.opKey,
          actorId: tenant.owner,
          verificationId: v.record.verificationId,
          cfg,
        });
      })(),
    ]);
    const final = await readWakeOpRecord({ authority, opKey: claimed2.opKey });
    // One wins coherently: completed (confirm) or failed (release) or unknown if release lost to prior receipt.
    expect(["completed", "failed", "unknown"]).toContain(final?.status);
    if (confirmR.ok) {
      expect(final?.status).toBe("completed");
      expect(final?.confirmedBy).toBe(tenant.approver);
    }
    if (releaseR.ok) {
      expect(final?.status).toBe("failed");
    }
    // Never silently double-execute: at most one success transition.
    expect([confirmR.ok, releaseR.ok].filter(Boolean).length).toBeLessThanOrEqual(1);
  });
});

describe("T36 M3 stop/revoke × dispatch races", () => {
  test("M3-1: after claim before eligibility commit — stop → no dispatch; failed; calls=0", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-m3-1";
    const { authority } = await seed({ cfg, taskId, itemId: "i1" });
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
        return { ok: true, roundId: "no" };
      },
      request: wakeReq(taskId, "i1"),
    });
    const opKey = opKeyFor(taskId, "i1");
    await waitRunning(authority, opKey);
    const stopped = await requestCollaborationTaskStop({
      groupId: tenant.groupId,
      taskId,
      actor: tenant.owner,
      reason: "m3-1",
      externalEffect: "none",
      cfg,
    });
    expect(stopped.stopControl.status).toBe("accepted");
    release();
    const wake = await wakeP;
    expect(calls).toBe(0);
    expect(wake.dispatched).toBe(false);
    expect(wake.reason).toBe("task_stopped");
    expect((await readWakeOpRecord({ authority, opKey }))?.status).toBe("failed");
  });

  test("M3-2: after eligibility before external — stop → in-flight/unknown; calls=0", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-m3-2";
    const { authority } = await seed({ cfg, taskId, itemId: "i2" });
    let release!: () => void;
    const barrier = new Promise<void>((r) => {
      release = r;
    });
    let calls = 0;
    const wakeP = consumeWakeForRoundDispatch({
      authority,
      cfg,
      writeMode: "execute",
      _testAfterEligibilityBarrier: () => barrier,
      roundDispatcher: async () => {
        calls += 1;
        return { ok: true, roundId: "no" };
      },
      request: wakeReq(taskId, "i2"),
    });
    const opKey = opKeyFor(taskId, "i2");
    for (let i = 0; i < 200; i += 1) {
      const rec = await readWakeOpRecord({ authority, opKey });
      if (rec?.dispatchEligibility) {
        break;
      }
      await new Promise((r) => setTimeout(r, 5));
    }
    expect((await readWakeOpRecord({ authority, opKey }))?.dispatchEligibility).toBeTruthy();
    await requestCollaborationTaskStop({
      groupId: tenant.groupId,
      taskId,
      actor: tenant.owner,
      reason: "m3-2",
      externalEffect: "none",
      cfg,
    });
    release();
    const wake = await wakeP;
    expect(calls).toBe(0);
    expect(wake.dispatched).toBe(false);
    expect(wake.reason).toBe("task_stopped_in_flight");
    expect((await readWakeOpRecord({ authority, opKey }))?.status).toBe("unknown");
  });

  test("M3-3: external sent, receipt not written, interrupt → unknown; no silent success", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-m3-3";
    const { authority } = await seed({ cfg, taskId, itemId: "i3" });
    let release!: () => void;
    const barrier = new Promise<void>((r) => {
      release = r;
    });
    let calls = 0;
    const wakeP = consumeWakeForRoundDispatch({
      authority,
      cfg,
      writeMode: "execute",
      _testAfterExternalBeforeReceiptBarrier: () => barrier,
      roundDispatcher: async () => {
        calls += 1;
        return { ok: true, roundId: "ext-round" };
      },
      request: wakeReq(taskId, "i3"),
    });
    const opKey = opKeyFor(taskId, "i3");
    for (let i = 0; i < 200; i += 1) {
      if (calls >= 1) {
        break;
      }
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(calls).toBe(1);
    await requestCollaborationTaskStop({
      groupId: tenant.groupId,
      taskId,
      actor: tenant.owner,
      reason: "m3-3",
      externalEffect: "unknown",
      cfg,
    });
    release();
    const wake = await wakeP;
    expect(wake.dispatched).toBe(false);
    const rec = await readWakeOpRecord({ authority, opKey });
    expect(rec?.status).toBe("unknown");
    expect(rec?.status).not.toBe("completed");
  });

  test("M3-5: two recovery operators concurrent release/confirm — one wins or both safe", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-m3-5";
    const { authority, groupId } = await seed({ cfg, taskId, itemId: "i5" });
    const claimed = await claimWakeOpRunning({
      authority,
      cfg,
      keyInput: {
        groupId,
        source: "nudge",
        fromAgentId: "system:group_task_heartbeat",
        toAgentIds: [tenant.bot0],
        taskId,
        itemId: "i5",
      },
    });
    await markWakeOpCompleted({
      authority,
      opKey: claimed.opKey,
      roundId: "round-m3-5",
      cfg,
    });
    await markWakeOpUnknown({ authority, opKey: claimed.opKey, cfg, detail: "gap" });

    const ver = await producePlatformNoneVerification({
      authority,
      cfg,
      groupId,
      taskId,
      opKey: claimed.opKey,
      attemptId: await currentAttemptId(authority, claimed.opKey),
      probe: async () => ({ source: "probe", outcome: "none" }),
    });
    expect(ver.ok).toBe(true);
    if (!ver.ok) {
      throw new Error("ver");
    }

    const [a, b] = await Promise.all([
      releaseWakeOpForRetryAuthorized({
        authority,
        groupId,
        taskId,
        opKey: claimed.opKey,
        actorId: tenant.owner,
        verificationId: ver.record.verificationId,
        cfg,
      }),
      confirmWakeOpCompletedAuthorized({
        authority,
        groupId,
        taskId,
        opKey: claimed.opKey,
        roundId: "round-m3-5",
        actorId: tenant.approver,
        cfg,
      }),
    ]);
    const final = await readWakeOpRecord({ authority, opKey: claimed.opKey });
    expect(["completed", "failed", "unknown"]).toContain(final?.status);
    // Coherent: at most one ok success; if both fail, state still unknown with prior roundId.
    const oks = [a.ok, b.ok].filter(Boolean).length;
    expect(oks).toBeLessThanOrEqual(1);
    if (a.ok) {
      expect(final?.status).toBe("failed");
    }
    if (b.ok) {
      expect(final?.status).toBe("completed");
    }
  });
});

describe("T38 M3 fail-open + pre-eligibility barrier", () => {
  test("M3-FO-01: eligibility committed, task read fails before dispatch → calls=0; diagnostic reason", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-m3-fo-01";
    const { authority } = await seed({ cfg, taskId, itemId: "fo1" });
    let calls = 0;
    const wake = await consumeWakeForRoundDispatch({
      authority,
      cfg,
      writeMode: "execute",
      _testForcePostEligibilityTaskReadError: () =>
        new Error("simulated task control read failure"),
      roundDispatcher: async () => {
        calls += 1;
        return { ok: true, roundId: "must-not-run" };
      },
      request: wakeReq(taskId, "fo1"),
    });
    expect(calls).toBe(0);
    expect(wake.dispatched).toBe(false);
    expect(wake.reason).toBe("task_control_unreadable");
    const rec = await readWakeOpRecord({ authority, opKey: opKeyFor(taskId, "fo1") });
    expect(rec?.status).toBe("unknown");
    expect(rec?.detail).toContain("task_control_unreadable");
  });

  test("M3-FO-02: auth source unreadable before dispatch → no prior fingerprint reuse; reason; no side effects", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-m3-fo-02";
    const { authority } = await seed({ cfg, taskId, itemId: "fo2" });
    let calls = 0;
    const wake = await consumeWakeForRoundDispatch({
      authority,
      cfg,
      writeMode: "execute",
      _testForcePostEligibilityAuthSourceReadError: () =>
        new Error("simulated operating-state read failure"),
      roundDispatcher: async () => {
        calls += 1;
        return { ok: true, roundId: "must-not-run" };
      },
      request: wakeReq(taskId, "fo2"),
    });
    expect(calls).toBe(0);
    expect(wake.dispatched).toBe(false);
    expect(wake.reason).toBe("auth_source_unreadable");
    const rec = await readWakeOpRecord({ authority, opKey: opKeyFor(taskId, "fo2") });
    expect(rec?.status).toBe("failed");
    expect(rec?.detail).toContain("auth_source_unreadable");
    // No successful dispatch side effect / no completed receipt.
    expect(rec?.status).not.toBe("completed");
    expect(rec?.roundId).toBeFalsy();
  });

  test("M3-FO-03: missing task after eligibility ≠ default not-stopped; calls=0; distinct reason", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-m3-fo-03";
    const { authority, objectStorage, groupId } = await seed({ cfg, taskId, itemId: "fo3" });
    let release!: () => void;
    const barrier = new Promise<void>((r) => {
      release = r;
    });
    let calls = 0;
    const wakeP = consumeWakeForRoundDispatch({
      authority,
      cfg,
      writeMode: "execute",
      _testAfterEligibilityBarrier: () => barrier,
      roundDispatcher: async () => {
        calls += 1;
        return { ok: true, roundId: "must-not-run" };
      },
      request: wakeReq(taskId, "fo3"),
    });
    const opKey = opKeyFor(taskId, "fo3");
    for (let i = 0; i < 200; i += 1) {
      const rec = await readWakeOpRecord({ authority, opKey });
      if (rec?.dispatchEligibility) {
        break;
      }
      await new Promise((r) => setTimeout(r, 5));
    }
    expect((await readWakeOpRecord({ authority, opKey }))?.dispatchEligibility).toBeTruthy();
    // Delete task so post-eligibility read returns null (missing ≠ not-stopped).
    await objectStorage.deleteObject(groupId, "task", taskId);
    release();
    const wake = await wakeP;
    expect(calls).toBe(0);
    expect(wake.dispatched).toBe(false);
    expect(wake.reason).toBe("task_missing");
    expect((await readWakeOpRecord({ authority, opKey }))?.status).toBe("unknown");
  });

  test("M3-4: after control read before eligibility commit — stop → eligibility must not win; calls=0", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-m3-4";
    const { authority } = await seed({ cfg, taskId, itemId: "i4" });
    let release!: () => void;
    const barrier = new Promise<void>((r) => {
      release = r;
    });
    let entered = false;
    let calls = 0;
    const wakeP = consumeWakeForRoundDispatch({
      authority,
      cfg,
      writeMode: "execute",
      _testAfterControlReadBeforeEligibilityBarrier: async () => {
        entered = true;
        await barrier;
      },
      roundDispatcher: async () => {
        calls += 1;
        return { ok: true, roundId: "no" };
      },
      request: wakeReq(taskId, "i4"),
    });
    const opKey = opKeyFor(taskId, "i4");
    for (let i = 0; i < 200; i += 1) {
      if (entered) {
        break;
      }
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(entered).toBe(true);
    // Stop after control read, before eligibility commit.
    const stopped = await requestCollaborationTaskStop({
      groupId: tenant.groupId,
      taskId,
      actor: tenant.owner,
      reason: "m3-4",
      externalEffect: "none",
      cfg,
    });
    expect(stopped.stopControl.status).toBe("accepted");
    release();
    const wake = await wakeP;
    expect(calls).toBe(0);
    expect(wake.dispatched).toBe(false);
    expect(wake.reason).toBe("task_stopped");
    const rec = await readWakeOpRecord({ authority, opKey });
    expect(rec?.status).toBe("failed");
    // Eligibility must not have won (no committed eligibility that then dispatched).
    expect(rec?.dispatchEligibility).toBeFalsy();
  });

  test("M3-4b: after control read before eligibility — revoke → no dispatch; eligibility not won", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-m3-4b";
    const { authority, fileStore, groupId } = await seed({ cfg, taskId, itemId: "i4b" });
    let release!: () => void;
    const barrier = new Promise<void>((r) => {
      release = r;
    });
    let entered = false;
    let calls = 0;
    const wakeP = consumeWakeForRoundDispatch({
      authority,
      cfg,
      writeMode: "execute",
      _testAfterControlReadBeforeEligibilityBarrier: async () => {
        entered = true;
        await barrier;
      },
      roundDispatcher: async () => {
        calls += 1;
        return { ok: true, roundId: "no" };
      },
      request: wakeReq(taskId, "i4b"),
    });
    const opKey = opKeyFor(taskId, "i4b");
    for (let i = 0; i < 200; i += 1) {
      if (entered) {
        break;
      }
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(entered).toBe(true);
    // Strip mapped membership (status:"revoked" alone is still mapped by id).
    const revoked = buildState();
    revoked.memberRoleMap = (revoked.memberRoleMap ?? []).filter(
      (row) => row.memberId !== tenant.bot0,
    );
    revoked.governance = {
      ...revoked.governance,
      coordinatorBotId: tenant.coordinator,
      ownerUserId: tenant.owner,
    };
    await writeGroupOperatingState({ fileStore, groupId, state: revoked });
    release();
    const wake = await wakeP;
    expect(calls).toBe(0);
    expect(wake.dispatched).toBe(false);
    expect(wake.reason).toBe("auth_revoked");
    const rec = await readWakeOpRecord({ authority, opKey });
    expect(rec?.status).toBe("failed");
    expect(rec?.dispatchEligibility).toBeFalsy();
  });
});

describe("T40 M3 residual: recheck OS fail-closed + pre-claim task catch", () => {
  test("M3-R-01: recheckCurrentDispatchAuthorization OS unreadable → not ok:true; diagnostic", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-m3-r-01";
    await seed({ cfg, taskId, itemId: "r01" });
    const auth = await recheckCurrentDispatchAuthorization({
      groupId: tenant.groupId,
      taskId,
      targetActorIds: [tenant.bot0],
      cfg,
      _testForceOperatingStateReadError: () => new Error("simulated OS unreadable for recheck"),
    });
    expect(auth.ok).toBe(false);
    if (auth.ok) {
      throw new Error("expected refuse");
    }
    expect(auth.reason).toBe("auth_source_unreadable");
    expect(auth.detail).toContain("operating_state_unreadable");
    expect(auth.detail).toContain("simulated OS unreadable");
  });

  test("M3-R-01b: pre-claim auth OS unreadable → no claim; reason; calls=0", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-m3-r-01b";
    const { authority } = await seed({ cfg, taskId, itemId: "r01b" });
    let calls = 0;
    const wake = await consumeWakeForRoundDispatch({
      authority,
      cfg,
      writeMode: "execute",
      _testForcePreClaimAuthOsReadError: () => new Error("simulated pre-claim OS unreadable"),
      roundDispatcher: async () => {
        calls += 1;
        return { ok: true, roundId: "must-not-run" };
      },
      request: wakeReq(taskId, "r01b"),
    });
    expect(calls).toBe(0);
    expect(wake.dispatched).toBe(false);
    expect(wake.reason).toBe("auth_source_unreadable");
    // Pre-claim refuse: durable claim must not have proceeded to running.
    const rec = await readWakeOpRecord({ authority, opKey: opKeyFor(taskId, "r01b") });
    expect(rec?.status === "running").toBe(false);
    expect(rec?.status).not.toBe("completed");
  });

  test("M3-R-02: pre-claim task read throw → refuse before claim; ≠ never-observed null", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-m3-r-02";
    const { authority } = await seed({ cfg, taskId, itemId: "r02" });
    let calls = 0;
    const wake = await consumeWakeForRoundDispatch({
      authority,
      cfg,
      writeMode: "execute",
      _testForcePreClaimTaskReadError: () =>
        new Error("simulated pre-claim task control read failure"),
      roundDispatcher: async () => {
        calls += 1;
        return { ok: true, roundId: "must-not-run" };
      },
      request: wakeReq(taskId, "r02"),
    });
    expect(calls).toBe(0);
    expect(wake.dispatched).toBe(false);
    expect(wake.reason).toBe("task_control_unreadable");
    const rec = await readWakeOpRecord({ authority, opKey: opKeyFor(taskId, "r02") });
    expect(rec?.status === "running").toBe(false);
    expect(rec?.status).not.toBe("completed");
  });

  test("M3-R-02b: never-observed null task (no throw) still distinct — not task_control_unreadable from catch", async () => {
    const { cfg } = await useIsolationRoot();
    // Seed OS + authority but omit writing the task object → pre-claim read returns null.
    const groupId = tenant.groupId;
    const { fileStore, objectStorage } = createWorkspaceCollaborationStores(cfg);
    await writeGroupOperatingState({ fileStore, groupId, state: buildState() });
    const now = Date.now();
    const snapshot = createRoundPolicySnapshot(
      resolveGroupPolicyInput({ operatingState: buildState() }),
      {
        now,
        idGen: () => generatePolicySnapshotId(now),
      },
    );
    const authority = createRuntimeAuthority({
      snapshot,
      episodeId: episodeIdForClientRun(`task-wake:${groupId}:task-m3-r-02b`),
      tenant: resolveAuthorityTenantForEntry({
        preferred: null,
        groupTenantId: resolveCollaborationGroupTenantId(groupId),
      }),
      groupId,
      profile: resolveSecurityProfile(cfg).profile,
      cfg,
    });
    void objectStorage;
    let calls = 0;
    const wake = await consumeWakeForRoundDispatch({
      authority,
      cfg,
      writeMode: "execute",
      roundDispatcher: async () => {
        calls += 1;
        return { ok: true, roundId: "round-null-task-ok" };
      },
      request: wakeReq("task-m3-r-02b-missing", "r02b"),
    });
    // Never-observed null must not be classified as task_control_unreadable (throw path).
    expect(wake.reason).not.toBe("task_control_unreadable");
    // May dispatch (compatible with wakes that have no task object) or fail for other reasons,
    // but the throw-path reason must stay reserved.
    if (wake.dispatched) {
      expect(calls).toBe(1);
    }
  });
});

describe("T37 M2 attempt binding (fail-first)", () => {
  test("M2-ATTEMPT-01: attempt A none cannot release attempt B; only B-bound verification unlocks", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-t37-attempt";
    const { authority, groupId } = await seed({ cfg, taskId, itemId: "att" });
    const keyInput = {
      groupId,
      source: "nudge" as const,
      fromAgentId: "system:group_task_heartbeat",
      toAgentIds: [tenant.bot0],
      taskId,
      itemId: "att-1",
    };

    // Attempt A
    const claimA = await claimWakeOpRunning({ authority, cfg, keyInput });
    expect(claimA.action).toBe("proceed");
    const attemptA = claimA.record?.executionAttemptId;
    expect(attemptA).toBeTruthy();
    await markWakeOpUnknown({ authority, opKey: claimA.opKey, cfg, detail: "A uncertain" });

    const verA = await producePlatformNoneVerification({
      authority,
      cfg,
      groupId,
      taskId,
      opKey: claimA.opKey,
      attemptId: await currentAttemptId(authority, claimA.opKey),
      probe: async () => ({ source: "probe-A", outcome: "none" }),
    });
    expect(verA.ok).toBe(true);
    if (!verA.ok) {
      throw new Error("verA");
    }
    expect(verA.record.attemptId).toBe(attemptA);

    const releaseA = await releaseWakeOpForRetryAuthorized({
      authority,
      groupId,
      taskId,
      opKey: claimA.opKey,
      actorId: tenant.owner,
      verificationId: verA.record.verificationId,
      cfg,
    });
    expect(releaseA.ok).toBe(true);
    if (!releaseA.ok) {
      throw new Error("releaseA");
    }
    expect(releaseA.record.status).toBe("failed");

    // Attempt B: claim after failed → new executionAttemptId → unknown
    const claimB = await claimWakeOpRunning({ authority, cfg, keyInput });
    expect(claimB.action).toBe("proceed");
    const attemptB = claimB.record?.executionAttemptId;
    expect(attemptB).toBeTruthy();
    expect(attemptB).not.toBe(attemptA);
    await markWakeOpUnknown({ authority, opKey: claimB.opKey, cfg, detail: "B uncertain" });

    // Using A's verification to release B MUST reject + state unchanged
    const reuseA = await releaseWakeOpForRetryAuthorized({
      authority,
      groupId,
      taskId,
      opKey: claimB.opKey,
      actorId: tenant.owner,
      verificationId: verA.record.verificationId,
      cfg,
    });
    expect(reuseA.ok).toBe(false);
    expect((reuseA as { reason: string }).reason).toBe("effect_check_attempt_mismatch");
    expect((await readWakeOpRecord({ authority, opKey: claimB.opKey }))?.status).toBe("unknown");
    expect((await readWakeOpRecord({ authority, opKey: claimB.opKey }))?.executionAttemptId).toBe(
      attemptB,
    );

    // Only verification bound to B may allow recovery
    const verB = await producePlatformNoneVerification({
      authority,
      cfg,
      groupId,
      taskId,
      opKey: claimB.opKey,
      attemptId: await currentAttemptId(authority, claimB.opKey),
      probe: async () => ({ source: "probe-B", outcome: "none" }),
    });
    expect(verB.ok).toBe(true);
    if (!verB.ok) {
      throw new Error("verB");
    }
    expect(verB.record.attemptId).toBe(attemptB);

    const releaseB = await releaseWakeOpForRetryAuthorized({
      authority,
      groupId,
      taskId,
      opKey: claimB.opKey,
      actorId: tenant.owner,
      verificationId: verB.record.verificationId,
      cfg,
    });
    expect(releaseB.ok).toBe(true);
    if (!releaseB.ok) {
      throw new Error("releaseB");
    }
    expect(releaseB.record.status).toBe("failed");
  });
});

describe("T37 M1 subject source boundary", () => {
  test("M1-BRAND-01: Symbol.for forged brand rejected; identity mode is internal-library", async () => {
    expect(WAKE_OP_RECOVERY_IDENTITY_MODE).toBe("internal_library_not_e2e_authenticated");

    const { cfg } = await useIsolationRoot();
    const taskId = "task-t37-m1-brand";
    const { authority, groupId } = await seed({ cfg, taskId, itemId: "m1b" });
    const claimed = await claimWakeOpRunning({
      authority,
      cfg,
      keyInput: {
        groupId,
        source: "nudge",
        fromAgentId: "system:group_task_heartbeat",
        toAgentIds: [tenant.bot0],
        taskId,
        itemId: "m1b-u",
      },
    });
    await markWakeOpUnknown({ authority, opKey: claimed.opKey, cfg });

    const FORGE_BRAND = Symbol.for("openbot.WakeOpRecoverySubject");
    const forged = {
      actorId: tenant.owner,
      action: "release_for_retry" as const,
      groupId,
      taskId,
      taskApproverIds: [] as string[],
      mintedAtMs: Date.now(),
      [FORGE_BRAND]: true as const,
    };
    const forgedRelease = await releaseWakeOpForRetry({
      authority,
      opKey: claimed.opKey,
      cfg,
      externalEffectVerified: "none",
      verificationId: "x",
      subject: forged as never,
    });
    expect(forgedRelease.ok).toBe(false);
    expect((forgedRelease as { reason: string }).reason).toBe("operator_identity_not_trusted");
    expect((await readWakeOpRecord({ authority, opKey: claimed.opKey }))?.status).toBe("unknown");

    // actorId-only path cannot claim e2e authentication — exec context is labeled internal
    const exec = await createInternalLibraryRecoveryExecContext({
      groupId,
      taskId,
      actorId: tenant.owner,
      action: "release_for_retry",
      cfg,
    });
    expect(exec.ok).toBe(true);
    if (!exec.ok) {
      throw new Error("exec");
    }
    expect(exec.exec.identityProvenance).toBe("caller_asserted_internal");
    expect(exec.exec.identityMode).toBe("internal_library_not_e2e_authenticated");

    // Symbol.for forged object is not a valid exec context either
    const forgedExec = {
      actorId: tenant.owner,
      groupId,
      taskId,
      action: "release_for_retry" as const,
      identityProvenance: "caller_asserted_internal" as const,
      identityMode: WAKE_OP_RECOVERY_IDENTITY_MODE,
      [Symbol.for("openbot.WakeOpRecoveryExecContext")]: true,
    };
    const forgedExecRelease = await releaseWakeOpForRetryAuthorized({
      authority,
      groupId,
      taskId,
      opKey: claimed.opKey,
      exec: forgedExec as never,
      verificationId: "x",
      cfg,
    });
    expect(forgedExecRelease.ok).toBe(false);
    expect((forgedExecRelease as { reason: string }).reason).toBe("operator_identity_not_trusted");
  });
});

describe("T37 M2 trusted verifier adapters", () => {
  test("M2-ADAPTER-01: registry adapter reads fixture receipt; arbitrary probe is not production root; no adapter keeps unknown", async () => {
    const { cfg, root } = await useIsolationRoot();
    const taskId = "task-t37-adapter";
    const { authority, groupId } = await seed({ cfg, taskId, itemId: "adp" });
    const claimed = await claimWakeOpRunning({
      authority,
      cfg,
      keyInput: {
        groupId,
        source: "nudge",
        fromAgentId: "system:group_task_heartbeat",
        toAgentIds: [tenant.bot0],
        taskId,
        itemId: "adp-1",
      },
    });
    await markWakeOpUnknown({ authority, opKey: claimed.opKey, cfg });
    const attemptId = await currentAttemptId(authority, claimed.opKey);

    // Empty registry → capability unavailable
    const noAdapter = await producePlatformNoneVerificationAtRoot({
      authority,
      opKey: claimed.opKey,
      registry: [],
      cfg,
    });
    expect(noAdapter.ok).toBe(false);
    expect((noAdapter as { reason: string }).reason).toBe("verify_capability_unavailable");
    expect((await readWakeOpRecord({ authority, opKey: claimed.opKey }))?.status).toBe("unknown");

    // Wrong opType in registry → unavailable
    const wrongType = await producePlatformNoneVerificationAtRoot({
      authority,
      opKey: claimed.opKey,
      registry: [
        createFixtureReceiptNoneAdapter({
          operationType: "other-source",
          receiptFilePath: "/dev/null",
        }),
      ],
      cfg,
    });
    expect(wrongType.ok).toBe(false);
    expect((wrongType as { reason: string }).reason).toBe("verify_capability_unavailable");

    // Fixture receipt adapter that actually reads the file
    const receiptPath = `${root}/fixture-receipt-none.json`;
    await fs.writeFile(
      receiptPath,
      JSON.stringify({
        opKey: claimed.opKey,
        attemptId,
        outcome: "none",
        source: receiptPath,
      }),
      "utf8",
    );
    const registry = [
      createFixtureReceiptNoneAdapter({ operationType: "nudge", receiptFilePath: receiptPath }),
    ];
    const okVer = await producePlatformNoneVerificationAtRoot({
      authority,
      opKey: claimed.opKey,
      registry,
      cfg,
    });
    expect(okVer.ok).toBe(true);
    if (!okVer.ok) {
      throw new Error("okVer");
    }
    expect(okVer.record.platformAutoProved).toBe(true);
    expect(okVer.record.attemptId).toBe(attemptId);
    expect(okVer.record.source).toBe(receiptPath);

    // Stale attempt in fixture → adapter returns null → unavailable
    await fs.writeFile(
      receiptPath,
      JSON.stringify({
        opKey: claimed.opKey,
        attemptId: "stale-other-attempt",
        outcome: "none",
        source: receiptPath,
      }),
      "utf8",
    );
    const stale = await producePlatformNoneVerificationAtRoot({
      authority,
      opKey: claimed.opKey,
      registry,
      cfg,
    });
    expect(stale.ok).toBe(false);
    expect((stale as { reason: string }).reason).toBe("verify_capability_unavailable");

    // Positive release with correct fixture
    await fs.writeFile(
      receiptPath,
      JSON.stringify({
        opKey: claimed.opKey,
        attemptId,
        outcome: "none",
        source: receiptPath,
      }),
      "utf8",
    );
    const ver2 = await producePlatformNoneVerificationAtRoot({
      authority,
      opKey: claimed.opKey,
      registry,
      cfg,
    });
    expect(ver2.ok).toBe(true);
    if (!ver2.ok) {
      throw new Error("ver2");
    }
    const released = await releaseWakeOpForRetryAuthorized({
      authority,
      groupId,
      taskId,
      opKey: claimed.opKey,
      actorId: tenant.owner,
      verificationId: ver2.record.verificationId,
      cfg,
    });
    expect(released.ok).toBe(true);
  });
});

describe("T41 M3 shared control-version CAS", () => {
  test("M3-CAS-1: after pre-commit recheck, stop before task CAS → CAS rejects; no eligibility; calls=0", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-m3-cas-1";
    const { authority, objectStorage, groupId } = await seed({ cfg, taskId, itemId: "cas1" });
    let release!: () => void;
    const barrier = new Promise<void>((r) => {
      release = r;
    });
    let entered = false;
    let calls = 0;
    const wakeP = consumeWakeForRoundDispatch({
      authority,
      cfg,
      writeMode: "execute",
      _testAfterRecheckBeforeTaskCasBarrier: async () => {
        entered = true;
        await barrier;
      },
      roundDispatcher: async () => {
        calls += 1;
        return { ok: true, roundId: "must-not-run" };
      },
      request: wakeReq(taskId, "cas1"),
    });
    const opKey = opKeyFor(taskId, "cas1");
    for (let i = 0; i < 200; i += 1) {
      if (entered) {
        break;
      }
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(entered).toBe(true);
    // Stop AFTER second control recheck completed, BEFORE shared task CAS.
    await requestCollaborationTaskStop({
      groupId: tenant.groupId,
      taskId,
      actor: tenant.owner,
      reason: "m3-cas-1",
      externalEffect: "none",
      cfg,
    });
    release();
    const wake = await wakeP;
    expect(calls).toBe(0);
    expect(wake.dispatched).toBe(false);
    expect(wake.reason).toBe("task_stopped");
    const rec = await readWakeOpRecord({ authority, opKey });
    expect(rec?.status).toBe("failed");
    // Eligibility must not win on wake-op mirror.
    expect(rec?.dispatchEligibility).toBeFalsy();
    // Task authoritative claim must be absent (CAS lost to stop).
    const task = asGovernedTask((await objectStorage.readObject(groupId, "task", taskId)) as never);
    expect(task.dispatchClaim).toBeFalsy();
    expect(task.controlEpoch).toBeGreaterThan(0);
  });

  test("M3-CAS-2: eligibility CAS committed, then stop, then take before dispatcher → calls=0", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-m3-cas-2";
    const { authority, objectStorage, groupId } = await seed({ cfg, taskId, itemId: "cas2" });
    let release!: () => void;
    const barrier = new Promise<void>((r) => {
      release = r;
    });
    let calls = 0;
    const wakeP = consumeWakeForRoundDispatch({
      authority,
      cfg,
      writeMode: "execute",
      _testAfterEligibilityBarrier: () => barrier,
      roundDispatcher: async () => {
        calls += 1;
        return { ok: true, roundId: "must-not-run" };
      },
      request: wakeReq(taskId, "cas2"),
    });
    const opKey = opKeyFor(taskId, "cas2");
    for (let i = 0; i < 200; i += 1) {
      const rec = await readWakeOpRecord({ authority, opKey });
      if (rec?.dispatchEligibility) {
        break;
      }
      await new Promise((r) => setTimeout(r, 5));
    }
    expect((await readWakeOpRecord({ authority, opKey }))?.dispatchEligibility).toBeTruthy();
    const mid = asGovernedTask((await objectStorage.readObject(groupId, "task", taskId)) as never);
    expect(mid.dispatchClaim?.phase).toBe("committed");
    await requestCollaborationTaskStop({
      groupId: tenant.groupId,
      taskId,
      actor: tenant.owner,
      reason: "m3-cas-2",
      externalEffect: "none",
      cfg,
    });
    const afterStop = asGovernedTask(
      (await objectStorage.readObject(groupId, "task", taskId)) as never,
    );
    expect(afterStop.dispatchClaim).toBeFalsy();
    expect(afterStop.controlEpoch).toBeGreaterThan(mid.controlEpoch ?? 0);
    release();
    const wake = await wakeP;
    expect(calls).toBe(0);
    expect(wake.dispatched).toBe(false);
    expect(wake.reason).toBe("task_stopped_in_flight");
    expect((await readWakeOpRecord({ authority, opKey }))?.status).toBe("unknown");
  });

  test("M3-CAS-3: concurrent stop vs eligibility CAS — shared version adjudicates; exactly one coherent winner", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-m3-cas-3";
    const { objectStorage, groupId, fileStore } = await seed({ cfg, taskId, itemId: "cas3" });
    const os = await readGroupOperatingState({
      fileStore,
      groupId,
    });
    const fp = wakeOpAuthFingerprint(os, [tenant.bot0]);
    const before = asGovernedTask(
      (await objectStorage.readObject(groupId, "task", taskId)) as never,
    );
    const expectedEpoch = typeof before.controlEpoch === "number" ? before.controlEpoch : 0;

    const stopP = requestCollaborationTaskStop({
      groupId,
      taskId,
      actor: tenant.owner,
      reason: "m3-cas-3-concurrent",
      externalEffect: "none",
      cfg,
    });
    const casP = casCommitTaskDispatchEligibility({
      groupId,
      taskId,
      opKey: opKeyFor(taskId, "cas3"),
      expectedControlEpoch: expectedEpoch,
      authFingerprint: fp,
      targetActorIds: [tenant.bot0],
      cfg,
    });
    const [stopResult, casResult] = await Promise.all([stopP, casP]);

    const final = asGovernedTask(
      (await objectStorage.readObject(groupId, "task", taskId)) as never,
    );
    // Stop always eventually accepted (or already); CAS either commits at expected epoch or rejects.
    expect(stopResult.stopControl.status).toBe("accepted");
    if (casResult.ok) {
      // Eligibility won the lock first: claim at expected epoch, then stop bumped epoch and cleared claim.
      expect(final.dispatchClaim).toBeFalsy();
      expect(final.controlEpoch).toBeGreaterThan(expectedEpoch);
      expect(casResult.claim.controlEpoch).toBe(expectedEpoch);
    } else {
      // Stop won first (or CAS lost expected-version): claim absent; CAS refused.
      expect(casResult.ok).toBe(false);
      expect(["task_stopped", "epoch_mismatch"]).toContain(casResult.reason);
      expect(final.dispatchClaim).toBeFalsy();
      expect(final.controlEpoch).toBeGreaterThan(expectedEpoch);
    }
    // No stuck "committed" claim that could still be taken after stop.
    if (final.dispatchClaim) {
      expect(final.dispatchClaim.controlEpoch).toBe(final.controlEpoch);
    }
    const take = await casTakeTaskDispatchEligibility({
      groupId,
      taskId,
      opKey: opKeyFor(taskId, "cas3"),
      claimId: "no-claim-after-stop",
      targetActorIds: [tenant.bot0],
      cfg,
    });
    expect(take.ok).toBe(false);
  });
});

describe("T42 M3 stop patch + single claim write", () => {
  test("M3-WRITE-A stop under lock must not clobber newer business fields with stale snapshot", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-m3-write-a";
    const { objectStorage, groupId } = await seed({ cfg, taskId, itemId: "write-a" });
    const before = asGovernedTask(
      (await objectStorage.readObject(groupId, "task", taskId)) as never,
    );
    // Simulate entry reading old task outside the lock…
    const staleSnapshot = {
      ...before,
      status: "in_progress" as const,
      responsibility: {
        owner: tenant.coordinator,
        executors: [tenant.bot0],
        reviewers: [],
        approvers: [tenant.approver],
      },
      ownerMemberId: tenant.coordinator,
      assignedMemberIds: [tenant.bot0],
      updatedAtMs: 1,
      updatedBy: tenant.owner,
    };
    // …then another writer updates responsibility/status before stop acquires the lock.
    const liveBusiness = {
      ...before,
      status: "blocked" as const,
      responsibility: {
        owner: tenant.admin,
        executors: [tenant.approver],
        reviewers: [tenant.bot0],
        approvers: [tenant.owner],
      },
      ownerMemberId: tenant.admin,
      assignedMemberIds: [tenant.approver],
      updatedAtMs: 42,
      updatedBy: tenant.admin,
      title: "live-after-stale-read",
    };
    await objectStorage.writeObject(groupId, "task", taskId, liveBusiness as never);

    const stopControl = buildAcceptedTaskStopControl({
      requestedBy: tenant.owner,
      reason: "m3-write-a",
      externalEffect: "none",
      requestedAtMs: 99,
    });
    // Entry previously held staleSnapshot outside the lock; helper now takes only
    // the stop patch and patches onto the live task under the lock.
    void staleSnapshot; // retained to document the pre-lock stale read in the scenario
    const stopped = await applyTaskStopUnderControlLock({
      groupId,
      taskId,
      stopControl,
      updatedBy: tenant.owner,
      updatedAtMs: 99,
      cfg,
    });

    expect(stopped.stopControl?.status).toBe("accepted");
    expect(stopped.stopControl?.requestedBy).toBe(tenant.owner);
    // Latest business fields must survive; stale snapshot must not win.
    expect(stopped.status).toBe("blocked");
    expect(stopped.ownerMemberId).toBe(tenant.admin);
    expect(stopped.assignedMemberIds).toEqual([tenant.approver]);
    expect(stopped.responsibility?.owner).toBe(tenant.admin);
    expect(stopped.title).toBe("live-after-stale-read");
    expect(stopped.controlEpoch).toBeGreaterThan(
      typeof before.controlEpoch === "number" ? before.controlEpoch : 0,
    );
    expect(stopped.dispatchClaim).toBeFalsy();

    const final = asGovernedTask(
      (await objectStorage.readObject(groupId, "task", taskId)) as never,
    );
    expect(final.status).toBe("blocked");
    expect(final.ownerMemberId).toBe(tenant.admin);
    expect(final.stopControl?.status).toBe("accepted");
  });

  test("M3-WRITE-B two different ops same epoch — second commit must not overwrite first claim", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-m3-write-b";
    const { objectStorage, groupId, fileStore } = await seed({ cfg, taskId, itemId: "write-b" });
    const os = await readGroupOperatingState({ fileStore, groupId });
    const fp = wakeOpAuthFingerprint(os, [tenant.bot0]);
    const before = asGovernedTask(
      (await objectStorage.readObject(groupId, "task", taskId)) as never,
    );
    const epoch = typeof before.controlEpoch === "number" ? before.controlEpoch : 0;
    const opA = opKeyFor(taskId, "write-b-op-a");
    const opB = opKeyFor(taskId, "write-b-op-b");

    const first = await casCommitTaskDispatchEligibility({
      groupId,
      taskId,
      opKey: opA,
      expectedControlEpoch: epoch,
      authFingerprint: fp,
      targetActorIds: [tenant.bot0],
      cfg,
      nowMs: 100,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      throw new Error("first commit must succeed");
    }
    expect(first.claim.opKey).toBe(opA);
    expect(first.claim.phase).toBe("committed");
    expect(first.claim.claimId?.length).toBeGreaterThan(8);

    const second = await casCommitTaskDispatchEligibility({
      groupId,
      taskId,
      opKey: opB,
      expectedControlEpoch: epoch,
      authFingerprint: fp,
      targetActorIds: [tenant.bot0],
      cfg,
      nowMs: 200,
    });
    // Single-claim model: other op must be refused; first claim remains.
    expect(second.ok).toBe(false);
    if (second.ok) {
      throw new Error("second commit must not silently overwrite");
    }
    expect(["claim_held", "claim_conflict", "epoch_mismatch"]).toContain(second.reason);

    const final = asGovernedTask(
      (await objectStorage.readObject(groupId, "task", taskId)) as never,
    );
    expect(final.dispatchClaim?.opKey).toBe(opA);
    expect(final.dispatchClaim?.phase).toBe("committed");
    expect(final.dispatchClaim?.committedAtMs).toBe(100);
  });

  test("M3-WRITE-C after taken, re-commit (same or other op) must not reset to committed", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-m3-write-c";
    const { objectStorage, groupId, fileStore } = await seed({ cfg, taskId, itemId: "write-c" });
    const os = await readGroupOperatingState({ fileStore, groupId });
    const fp = wakeOpAuthFingerprint(os, [tenant.bot0]);
    const before = asGovernedTask(
      (await objectStorage.readObject(groupId, "task", taskId)) as never,
    );
    const epoch = typeof before.controlEpoch === "number" ? before.controlEpoch : 0;
    const opA = opKeyFor(taskId, "write-c-op-a");
    const opB = opKeyFor(taskId, "write-c-op-b");

    const committed = await casCommitTaskDispatchEligibility({
      groupId,
      taskId,
      opKey: opA,
      expectedControlEpoch: epoch,
      authFingerprint: fp,
      targetActorIds: [tenant.bot0],
      cfg,
      nowMs: 10,
    });
    expect(committed.ok).toBe(true);
    if (!committed.ok) {
      throw new Error("commit must succeed");
    }
    const taken = await casTakeTaskDispatchEligibility({
      groupId,
      taskId,
      opKey: opA,
      claimId: committed.claim.claimId,
      targetActorIds: [tenant.bot0],
      cfg,
      nowMs: 20,
    });
    expect(taken.ok).toBe(true);
    if (!taken.ok) {
      throw new Error("take must succeed");
    }
    expect(taken.claim.phase).toBe("taken");

    const sameOpRetry = await casCommitTaskDispatchEligibility({
      groupId,
      taskId,
      opKey: opA,
      expectedControlEpoch: epoch,
      authFingerprint: fp,
      targetActorIds: [tenant.bot0],
      cfg,
      nowMs: 30,
    });
    // Same op must not reset taken → committed (idempotent keep taken OR refuse).
    if (sameOpRetry.ok) {
      expect(sameOpRetry.claim.phase).toBe("taken");
      expect(sameOpRetry.claim.opKey).toBe(opA);
    } else {
      expect(["claim_held", "claim_conflict", "already_taken"]).toContain(sameOpRetry.reason);
    }

    const otherOp = await casCommitTaskDispatchEligibility({
      groupId,
      taskId,
      opKey: opB,
      expectedControlEpoch: epoch,
      authFingerprint: fp,
      targetActorIds: [tenant.bot0],
      cfg,
      nowMs: 40,
    });
    expect(otherOp.ok).toBe(false);
    if (otherOp.ok) {
      throw new Error("other op must not overwrite taken");
    }

    const final = asGovernedTask(
      (await objectStorage.readObject(groupId, "task", taskId)) as never,
    );
    expect(final.dispatchClaim?.opKey).toBe(opA);
    expect(final.dispatchClaim?.phase).toBe("taken");
    expect(final.dispatchClaim?.takenAtMs).toBe(20);
  });
});

describe("T43 M3 claim lifecycle (committed/taken recovery + claimId bind)", () => {
  test("M3-LIFE-A commit then auth change refuses take — release unconsumed; op B can proceed", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-m3-life-a";
    const { authority, objectStorage, groupId, fileStore } = await seed({
      cfg,
      taskId,
      itemId: "life-a",
    });
    let release!: () => void;
    const barrier = new Promise<void>((r) => {
      release = r;
    });
    let calls = 0;
    const wakeP = consumeWakeForRoundDispatch({
      authority,
      cfg,
      writeMode: "execute",
      _testAfterEligibilityBarrier: () => barrier,
      roundDispatcher: async () => {
        calls += 1;
        return { ok: true, roundId: "life-a-must-not-run" };
      },
      request: wakeReq(taskId, "life-a"),
    });
    const opA = opKeyFor(taskId, "life-a");
    for (let i = 0; i < 200; i += 1) {
      const rec = await readWakeOpRecord({ authority, opKey: opA });
      if (rec?.dispatchEligibility) {
        break;
      }
      await new Promise((r) => setTimeout(r, 5));
    }
    expect((await readWakeOpRecord({ authority, opKey: opA }))?.dispatchEligibility).toBeTruthy();
    const mid = asGovernedTask((await objectStorage.readObject(groupId, "task", taskId)) as never);
    expect(mid.dispatchClaim?.phase).toBe("committed");
    const claimIdA = mid.dispatchClaim?.claimId;
    expect(claimIdA).toBeTruthy();

    // Auth change after commit, before take.
    const revoked = buildState({ revokeApprover: false });
    // Revoke the target bot so fingerprint changes.
    revoked.memberRoleMap = (revoked.memberRoleMap ?? []).map((row) =>
      row.memberId === tenant.bot0 ? { ...row, status: "revoked" as const } : row,
    );
    await writeGroupOperatingState({ fileStore, groupId, state: revoked });

    release();
    const wake = await wakeP;
    expect(calls).toBe(0);
    expect(wake.dispatched).toBe(false);
    expect(["auth_revoked", "eligibility_take_rejected", "auth_source_unreadable"]).toContain(
      wake.reason,
    );
    // Unconsumed committed claim must not permanently block.
    const afterA = asGovernedTask(
      (await objectStorage.readObject(groupId, "task", taskId)) as never,
    );
    expect(afterA.dispatchClaim).toBeFalsy();

    // Restore auth; op B must be able to advance.
    await writeGroupOperatingState({ fileStore, groupId, state: buildState() });
    let callsB = 0;
    const wakeB = await consumeWakeForRoundDispatch({
      authority,
      cfg,
      writeMode: "execute",
      roundDispatcher: async () => {
        callsB += 1;
        return { ok: true, roundId: "life-a-op-b" };
      },
      request: wakeReq(taskId, "life-a-b"),
    });
    expect(wakeB.reason).not.toBe("eligibility_cas_rejected");
    expect(callsB).toBe(1);
    expect(wakeB.dispatched).toBe(true);
    const afterB = asGovernedTask(
      (await objectStorage.readObject(groupId, "task", taskId)) as never,
    );
    // take+finally should have cleared B's claim too
    expect(afterB.dispatchClaim).toBeFalsy();
  });

  test("M3-LIFE-B wake-op mirror fails after task claim commit — release; no permanent block; no dispatch", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-m3-life-b";
    const { authority, objectStorage, groupId } = await seed({
      cfg,
      taskId,
      itemId: "life-b",
    });
    let calls = 0;
    const wake = await consumeWakeForRoundDispatch({
      authority,
      cfg,
      writeMode: "execute",
      _testForceEligibilityMirrorFailure: true,
      roundDispatcher: async () => {
        calls += 1;
        return { ok: true, roundId: "life-b-must-not" };
      },
      request: wakeReq(taskId, "life-b"),
    });
    expect(calls).toBe(0);
    expect(wake.dispatched).toBe(false);
    expect(wake.reason).toBe("eligibility_commit_failed");
    const after = asGovernedTask(
      (await objectStorage.readObject(groupId, "task", taskId)) as never,
    );
    expect(after.dispatchClaim).toBeFalsy();

    // Recovery: another op can commit/dispatch (not permanently blocked; not a re-run of A).
    let calls2 = 0;
    const wake2 = await consumeWakeForRoundDispatch({
      authority,
      cfg,
      writeMode: "execute",
      roundDispatcher: async () => {
        calls2 += 1;
        return { ok: true, roundId: "life-b-recover" };
      },
      request: wakeReq(taskId, "life-b-2"),
    });
    expect(calls2).toBe(1);
    expect(wake2.dispatched).toBe(true);
  });

  test("M3-LIFE-C process exit between commit and take — recovery releases committed only; taken refuses", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-m3-life-c";
    const { authority, objectStorage, groupId, fileStore } = await seed({
      cfg,
      taskId,
      itemId: "life-c",
    });
    const os = await readGroupOperatingState({ fileStore, groupId });
    const fp = wakeOpAuthFingerprint(os, [tenant.bot0]);
    const before = asGovernedTask(
      (await objectStorage.readObject(groupId, "task", taskId)) as never,
    );
    const epoch = typeof before.controlEpoch === "number" ? before.controlEpoch : 0;
    // Simulate: wake claimed + task claim committed, then process died before take.
    const claimed = await claimWakeOpRunning({
      authority,
      cfg,
      nowMs: 10,
      keyInput: {
        groupId,
        source: "nudge",
        fromAgentId: "system:group_task_heartbeat",
        toAgentIds: [tenant.bot0],
        taskId,
        itemId: "life-c",
      },
    });
    expect(claimed.action).toBe("proceed");
    const attemptId = claimed.record?.executionAttemptId;
    expect(attemptId).toBeTruthy();
    const committed = await casCommitTaskDispatchEligibility({
      groupId,
      taskId,
      opKey: claimed.opKey,
      expectedControlEpoch: epoch,
      authFingerprint: fp,
      targetActorIds: [tenant.bot0],
      executionAttemptId: attemptId,
      cfg,
      nowMs: 20,
    });
    expect(committed.ok).toBe(true);
    if (!committed.ok) {
      throw new Error("commit");
    }
    const claimId = committed.claim.claimId;
    expect(committed.claim.phase).toBe("committed");
    expect(committed.claim.executionAttemptId).toBe(attemptId);

    // Crash recovery of wake-op: mark failed (proves attempt did not consume / no receipt).
    await markWakeOpFailed({
      authority,
      opKey: claimed.opKey,
      cfg,
      nowMs: 30,
      detail: "process_exit_before_take",
    });
    // Deterministic release: phase still committed + claimId + associated failed attempt.
    const released = await casReleaseUnconsumedCommittedClaim({
      groupId,
      taskId,
      opKey: claimed.opKey,
      claimId,
      cfg,
      nowMs: 40,
    });
    expect(released.released).toBe(true);
    expect(
      asGovernedTask((await objectStorage.readObject(groupId, "task", taskId)) as never)
        .dispatchClaim,
    ).toBeFalsy();

    // Taken must NOT be released by the same helper (no timeout auto re-run).
    const committed2 = await casCommitTaskDispatchEligibility({
      groupId,
      taskId,
      opKey: opKeyFor(taskId, "life-c-taken"),
      expectedControlEpoch: epoch,
      authFingerprint: fp,
      targetActorIds: [tenant.bot0],
      cfg,
      nowMs: 50,
    });
    expect(committed2.ok).toBe(true);
    if (!committed2.ok) {
      throw new Error("commit2");
    }
    const taken = await casTakeTaskDispatchEligibility({
      groupId,
      taskId,
      opKey: committed2.claim.opKey,
      claimId: committed2.claim.claimId,
      targetActorIds: [tenant.bot0],
      cfg,
      nowMs: 60,
    });
    expect(taken.ok).toBe(true);
    const refuse = await casReleaseUnconsumedCommittedClaim({
      groupId,
      taskId,
      opKey: committed2.claim.opKey,
      claimId: committed2.claim.claimId,
      cfg,
      nowMs: 70,
    });
    expect(refuse.released).toBe(false);
    expect(refuse.reason).toBe("phase_taken");
    expect(
      asGovernedTask((await objectStorage.readObject(groupId, "task", taskId)) as never)
        .dispatchClaim?.phase,
    ).toBe("taken");

    // Cleanup for isolation: clear with matching claimId (simulates proper finally).
    await casClearTaskDispatchClaimForOp({
      groupId,
      taskId,
      opKey: committed2.claim.opKey,
      claimId: committed2.claim.claimId,
      cfg,
      nowMs: 80,
    });
  });

  test("M3-LIFE-D barrier: stale clear must not drop newer same-op claim (claimId bind)", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-m3-life-d";
    const { objectStorage, groupId, fileStore } = await seed({
      cfg,
      taskId,
      itemId: "life-d",
    });
    const os = await readGroupOperatingState({ fileStore, groupId });
    const fp = wakeOpAuthFingerprint(os, [tenant.bot0]);
    const before = asGovernedTask(
      (await objectStorage.readObject(groupId, "task", taskId)) as never,
    );
    const epoch = typeof before.controlEpoch === "number" ? before.controlEpoch : 0;
    const opKey = opKeyFor(taskId, "life-d");

    const first = await casCommitTaskDispatchEligibility({
      groupId,
      taskId,
      opKey,
      expectedControlEpoch: epoch,
      authFingerprint: fp,
      targetActorIds: [tenant.bot0],
      cfg,
      nowMs: 1,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      throw new Error("first");
    }
    const oldClaimId = first.claim.claimId;

    // Old attempt enters teardown; meanwhile new attempt establishes a new claim.
    const released = await casReleaseUnconsumedCommittedClaim({
      groupId,
      taskId,
      opKey,
      claimId: oldClaimId,
      cfg,
      nowMs: 2,
    });
    expect(released.released).toBe(true);

    const second = await casCommitTaskDispatchEligibility({
      groupId,
      taskId,
      opKey,
      expectedControlEpoch: epoch,
      authFingerprint: fp,
      targetActorIds: [tenant.bot0],
      cfg,
      nowMs: 3,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) {
      throw new Error("second");
    }
    const newClaimId = second.claim.claimId;
    expect(newClaimId).not.toBe(oldClaimId);

    // Stale clear with old claimId must leave the new claim intact.
    const stale = await casClearTaskDispatchClaimForOp({
      groupId,
      taskId,
      opKey,
      claimId: oldClaimId,
      cfg,
      nowMs: 4,
    });
    expect(stale.cleared).toBe(false);
    expect(stale.reason).toBe("claim_id_mismatch");
    const final = asGovernedTask(
      (await objectStorage.readObject(groupId, "task", taskId)) as never,
    );
    expect(final.dispatchClaim?.claimId).toBe(newClaimId);
    expect(final.dispatchClaim?.phase).toBe("committed");
  });

  test("M3-LIFE-E completed + receipt + clear failure — no second dispatch; original result kept", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-m3-life-e";
    const { authority, objectStorage, groupId } = await seed({
      cfg,
      taskId,
      itemId: "life-e",
    });
    let calls = 0;
    const wake = await consumeWakeForRoundDispatch({
      authority,
      cfg,
      writeMode: "execute",
      _testForceClaimClearError: () => new Error("forced_clear_failure"),
      roundDispatcher: async () => {
        calls += 1;
        return { ok: true, roundId: "life-e-round" };
      },
      request: wakeReq(taskId, "life-e"),
    });
    expect(calls).toBe(1);
    expect(wake.dispatched).toBe(true);
    expect(wake.outcome).toBe("dispatched");
    const rec = await readWakeOpRecord({ authority, opKey: wake.opKey! });
    expect(rec?.status).toBe("completed");
    expect(rec?.roundId).toBe("life-e-round");
    // Clear failed → claim may remain taken; must not invite blind re-dispatch.
    const task = asGovernedTask((await objectStorage.readObject(groupId, "task", taskId)) as never);
    expect(task.dispatchClaim?.phase).toBe("taken");

    let calls2 = 0;
    const again = await consumeWakeForRoundDispatch({
      authority,
      cfg,
      writeMode: "execute",
      roundDispatcher: async () => {
        calls2 += 1;
        return { ok: true, roundId: "life-e-second" };
      },
      request: wakeReq(taskId, "life-e"),
    });
    expect(calls2).toBe(0);
    // Reuse of completed reports dispatched:true with reused:true — no new side effect.
    expect(again.reused).toBe(true);
    expect(again.dispatched).toBe(true);
    const rec2 = await readWakeOpRecord({ authority, opKey: wake.opKey! });
    expect(rec2?.status).toBe("completed");
    expect(rec2?.roundId).toBe("life-e-round");
  });
});

describe("T44 M3 other task writers under control lock", () => {
  test("M3-WRITERS-0 tip hazard: stale {...current} spread drops live stopControl/claim", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-m3-writers-0";
    const { objectStorage, groupId, fileStore } = await seed({
      cfg,
      taskId,
      itemId: "writers-0",
    });
    const before = asGovernedTask(
      (await objectStorage.readObject(groupId, "task", taskId)) as never,
    );
    const stale = { ...before, status: "in_progress" as const, updatedAtMs: 1 };

    const stopControl = buildAcceptedTaskStopControl({
      requestedBy: tenant.owner,
      reason: "writers-0-stop",
      externalEffect: "none",
      requestedAtMs: 50,
    });
    await applyTaskStopUnderControlLock({
      groupId,
      taskId,
      stopControl,
      updatedBy: tenant.owner,
      updatedAtMs: 50,
      cfg,
    });
    const os = await readGroupOperatingState({ fileStore, groupId });
    // Re-seed claim path: stop cleared claim; commit after would need unstopped.
    // For hazard demo, write a synthetic claim onto a fresh non-stop task via direct
    // fields then show stale spread wiping them — use a second task.
    const taskId2 = "task-m3-writers-0b";
    await objectStorage.writeObject(groupId, "task", taskId2, {
      ...before,
      taskId: taskId2,
      controlEpoch: 3,
      dispatchClaim: {
        claimId: "claim-hazard",
        opKey: opKeyFor(taskId2, "hazard"),
        controlEpoch: 3,
        authFingerprint: wakeOpAuthFingerprint(os, [tenant.bot0]),
        committedAtMs: 10,
        phase: "committed",
      },
      stopControl: {
        status: "accepted",
        requestedBy: tenant.owner,
        requestedAtMs: 11,
        inFlightAbort: "best_effort",
        externalEffect: "none",
      },
      updatedAtMs: 11,
    } as never);
    const live = asGovernedTask(
      (await objectStorage.readObject(groupId, "task", taskId2)) as never,
    );
    expect(live.stopControl?.status).toBe("accepted");
    expect(live.dispatchClaim?.claimId).toBe("claim-hazard");

    // Tip-era business writer pattern (must remain a documented failing pattern).
    const buggy: typeof live = {
      ...stale,
      taskId: taskId2,
      status: "blocked",
      updatedAtMs: 99,
      updatedBy: tenant.admin,
    } as never;
    await objectStorage.writeObject(groupId, "task", taskId2, buggy as never);
    const afterBug = asGovernedTask(
      (await objectStorage.readObject(groupId, "task", taskId2)) as never,
    );
    // Prove lost-update: control fields gone (this is the red tip hazard).
    expect(afterBug.stopControl).toBeFalsy();
    expect(afterBug.dispatchClaim).toBeFalsy();
    expect(afterBug.controlEpoch ?? 0).toBe(0);
    expect(afterBug.status).toBe("blocked");

    // Helper repair path: start from restored live-with-control + business patch.
    await objectStorage.writeObject(groupId, "task", taskId2, live as never);
    const patched = await applyBusinessTaskPatchUnderControlLock({
      groupId,
      taskId: taskId2,
      cfg,
      refuseIfStopped: false, // allow patch while stopped to show field preserve
      buildPatch: () => ({
        status: "blocked",
        updatedAtMs: 100,
        updatedBy: tenant.admin,
      }),
    });
    expect(patched.status).toBe("blocked");
    expect(patched.stopControl?.status).toBe("accepted");
    expect(patched.dispatchClaim?.claimId).toBe("claim-hazard");
    expect(patched.controlEpoch).toBe(3);
  });

  test("M3-WRITERS-A transition vs concurrent stop — must refuse (not wipe stop)", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-m3-writers-a";
    const { objectStorage, groupId } = await seed({ cfg, taskId, itemId: "writers-a" });

    let release!: () => void;
    const barrier = new Promise<void>((r) => {
      release = r;
    });
    let hitRead!: () => void;
    const readHit = new Promise<void>((r) => {
      hitRead = r;
    });

    const transitionP = transitionCollaborationTask({
      groupId,
      taskId,
      toStatus: "blocked",
      actor: tenant.owner,
      cfg,
      _testAfterTaskReadBarrier: async () => {
        hitRead();
        await barrier;
      },
    });

    await readHit;
    const stopControl = buildAcceptedTaskStopControl({
      requestedBy: tenant.owner,
      reason: "writers-a",
      externalEffect: "none",
      requestedAtMs: 77,
    });
    await applyTaskStopUnderControlLock({
      groupId,
      taskId,
      stopControl,
      updatedBy: tenant.owner,
      updatedAtMs: 77,
      cfg,
    });
    release();

    await expect(transitionP).rejects.toBeInstanceOf(TaskStoppedError);

    const final = asGovernedTask(
      (await objectStorage.readObject(groupId, "task", taskId)) as never,
    );
    expect(final.stopControl?.status).toBe("accepted");
    expect(final.stopControl?.reason).toBe("writers-a");
    expect(final.status).toBe("in_progress"); // business write did not land
    expect(final.controlEpoch).toBeGreaterThan(0);
  });

  test("M3-WRITERS-B transition vs concurrent claim — must keep dispatchClaim + apply status", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-m3-writers-b";
    const { objectStorage, groupId, fileStore } = await seed({
      cfg,
      taskId,
      itemId: "writers-b",
    });
    const os = await readGroupOperatingState({ fileStore, groupId });
    const fp = wakeOpAuthFingerprint(os, [tenant.bot0]);
    const before = asGovernedTask(
      (await objectStorage.readObject(groupId, "task", taskId)) as never,
    );
    const epoch = typeof before.controlEpoch === "number" ? before.controlEpoch : 0;
    const opA = opKeyFor(taskId, "writers-b-op");

    let release!: () => void;
    const barrier = new Promise<void>((r) => {
      release = r;
    });
    let hitRead!: () => void;
    const readHit = new Promise<void>((r) => {
      hitRead = r;
    });

    const transitionP = transitionCollaborationTask({
      groupId,
      taskId,
      toStatus: "blocked",
      actor: tenant.owner,
      cfg,
      _testAfterTaskReadBarrier: async () => {
        hitRead();
        await barrier;
      },
    });

    await readHit;
    const commit = await casCommitTaskDispatchEligibility({
      groupId,
      taskId,
      opKey: opA,
      expectedControlEpoch: epoch,
      authFingerprint: fp,
      targetActorIds: [tenant.bot0],
      cfg,
      nowMs: 120,
    });
    expect(commit.ok).toBe(true);
    if (!commit.ok) {
      throw new Error("commit must succeed");
    }
    const claimId = commit.claim.claimId;
    release();

    const updated = await transitionP;
    expect(updated.status).toBe("blocked");

    const final = asGovernedTask(
      (await objectStorage.readObject(groupId, "task", taskId)) as never,
    );
    expect(final.status).toBe("blocked");
    expect(final.dispatchClaim?.claimId).toBe(claimId);
    expect(final.dispatchClaim?.opKey).toBe(opA);
    expect(final.dispatchClaim?.phase).toBe("committed");
    expect(final.controlEpoch).toBe(epoch);
    expect(final.stopControl).toBeFalsy();
  });

  test("M3-WRITERS-C business patch under lock must not drop control when patch omits them", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-m3-writers-c";
    const { objectStorage, groupId, fileStore } = await seed({
      cfg,
      taskId,
      itemId: "writers-c",
    });
    const os = await readGroupOperatingState({ fileStore, groupId });
    const fp = wakeOpAuthFingerprint(os, [tenant.bot0]);
    const before = asGovernedTask(
      (await objectStorage.readObject(groupId, "task", taskId)) as never,
    );
    const epoch = typeof before.controlEpoch === "number" ? before.controlEpoch : 0;
    const commit = await casCommitTaskDispatchEligibility({
      groupId,
      taskId,
      opKey: opKeyFor(taskId, "writers-c"),
      expectedControlEpoch: epoch,
      authFingerprint: fp,
      targetActorIds: [tenant.bot0],
      cfg,
      nowMs: 5,
    });
    expect(commit.ok).toBe(true);
    if (!commit.ok) {
      throw new Error("commit");
    }

    // Simulate handoff/claim-entry style patch that only spreads business fields.
    const patched = await applyBusinessTaskPatchUnderControlLock({
      groupId,
      taskId,
      cfg,
      buildPatch: (live) => ({
        // Deliberately include undefined control keys as a hostile patch.
        stopControl: undefined,
        controlEpoch: 0,
        dispatchClaim: undefined,
        status: "blocked",
        title: "writers-c-patched",
        updatedAtMs: 88,
        updatedBy: tenant.admin,
        ownerMemberId: live.ownerMemberId,
      }),
    });

    expect(patched.title).toBe("writers-c-patched");
    expect(patched.status).toBe("blocked");
    expect(patched.dispatchClaim?.claimId).toBe(commit.claim.claimId);
    expect(patched.controlEpoch).toBe(epoch);
    expect(patched.stopControl).toBeFalsy();
  });
});

describe("T45 M3 business atomicity (handoff / board-claim / complete-gate)", () => {
  async function useBizCfg() {
    const { root, cfg: base } = await useIsolationRoot();
    const cfg = {
      ...base,
      collaboration: {
        ...base.collaboration,
        task: {
          ...base.collaboration?.task,
          wakeContract: true,
          handoffContract: true,
          claimContract: true,
        },
      },
    } as OpenBotConfig;
    const configPath = process.env.OPENBOT_CONFIG_PATH!;
    await fs.writeFile(configPath, JSON.stringify(cfg, null, 2), "utf8");
    setRuntimeConfigSnapshot(cfg);
    clearConfigCache();
    return { root, cfg };
  }

  test("M3-BIZ-A handoff apply vs concurrent responsibility move — must conflict (not overwrite)", async () => {
    const { cfg } = await useBizCfg();
    const taskId = "task-m3-biz-a";
    const { objectStorage, groupId } = await seed({ cfg, taskId, itemId: "biz-a" });

    const proposed = await proposeCollaborationTaskHandoffContract({
      groupId,
      taskId,
      from: tenant.coordinator,
      to: tenant.bot0,
      kind: "owner_transfer",
      remainingWork: "finish biz-a",
      acceptanceCriteria: ["owner moved"],
      actor: tenant.coordinator,
      cfg,
    });
    await acceptCollaborationTaskHandoffContract({
      groupId,
      taskId,
      handoffId: proposed.handoffId,
      actor: tenant.bot0,
      actorType: "bot",
      cfg,
    });
    await approveCollaborationTaskHandoffContract({
      groupId,
      taskId,
      handoffId: proposed.handoffId,
      actor: tenant.owner,
      actorType: "human",
      cfg,
    });

    let release!: () => void;
    const barrier = new Promise<void>((r) => {
      release = r;
    });
    let hitRead!: () => void;
    const readHit = new Promise<void>((r) => {
      hitRead = r;
    });

    const applyP = applyCollaborationTaskHandoffContract({
      groupId,
      taskId,
      handoffId: proposed.handoffId,
      actor: tenant.owner,
      cfg,
      _testAfterTaskReadBarrier: async () => {
        hitRead();
        await barrier;
      },
    });

    await readHit;
    // Concurrent live responsibility move while stale approved contract is mid-apply.
    await applyBusinessTaskPatchUnderControlLock({
      groupId,
      taskId,
      cfg,
      buildPatch: (live) => {
        const liveGoverned = asGovernedTask(live);
        return {
          responsibility: {
            ...(liveGoverned.responsibility ?? {
              owner: tenant.coordinator,
              executors: [tenant.bot0],
              reviewers: [],
              approvers: [tenant.approver],
            }),
            owner: tenant.admin,
          },
          ownerMemberId: tenant.admin,
          updatedAtMs: Date.now(),
          updatedBy: tenant.admin,
        };
      },
    });
    release();

    await expect(applyP).rejects.toMatchObject({
      name: "HandoffContractEntryError",
      code: "responsibility_conflict",
    });

    const final = asGovernedTask(
      (await objectStorage.readObject(groupId, "task", taskId)) as never,
    );
    // Live concurrent owner must stick; stale handoff must not overwrite to bot0.
    expect(final.responsibility?.owner).toBe(tenant.admin);
    expect(final.ownerMemberId).toBe(tenant.admin);
    const historyIds = (final.handoffs ?? []).map((h) => h.handoffId).filter(Boolean);
    expect(historyIds).not.toContain(proposed.handoffId);
  });

  test("M3-BIZ-B board claim apply vs concurrent stop — refuse before board applied", async () => {
    const { cfg } = await useBizCfg();
    const taskId = "task-m3-biz-b";
    const { objectStorage, groupId } = await seed({ cfg, taskId, itemId: "biz-b" });

    const published = await publishCollaborationBoardItem({
      groupId,
      taskId,
      remainingWork: "biz-b chapter",
      acceptanceCriteria: ["sources"],
      intendedClaimantIds: [tenant.bot0],
      actor: tenant.coordinator,
      cfg,
    });
    await claimCollaborationBoardItem({
      groupId,
      taskId,
      itemId: published.itemId,
      claimantId: tenant.bot0,
      cfg,
    });

    let release!: () => void;
    const barrier = new Promise<void>((r) => {
      release = r;
    });
    let hitRead!: () => void;
    const readHit = new Promise<void>((r) => {
      hitRead = r;
    });

    const applyP = applyCollaborationBoardClaim({
      groupId,
      taskId,
      itemId: published.itemId,
      actor: tenant.bot0,
      cfg,
      _testAfterTaskReadBarrier: async () => {
        hitRead();
        await barrier;
      },
    });

    await readHit;
    const stopControl = buildAcceptedTaskStopControl({
      requestedBy: tenant.owner,
      reason: "biz-b-stop",
      externalEffect: "none",
      requestedAtMs: 42,
    });
    await applyTaskStopUnderControlLock({
      groupId,
      taskId,
      stopControl,
      updatedBy: tenant.owner,
      updatedAtMs: 42,
      cfg,
    });
    release();

    await expect(applyP).rejects.toBeInstanceOf(TaskStoppedError);

    const board = await loadCollaborationBoardClaimItem({
      groupId,
      taskId,
      itemId: published.itemId,
      cfg,
    });
    // Board must not reach applied if stop won the race under the shared lock.
    expect(board?.status).toBe("claimed");

    const final = asGovernedTask(
      (await objectStorage.readObject(groupId, "task", taskId)) as never,
    );
    expect(final.stopControl?.status).toBe("accepted");
    expect(final.stopControl?.reason).toBe("biz-b-stop");
    // Seed already assigns bot0; ensure claim-apply did not mutate status / add claim history.
    expect(final.status).toBe("in_progress");
  });

  test("M3-BIZ-B2 prior partial: board applied + task stopped → identifiable code", async () => {
    const { cfg } = await useBizCfg();
    const taskId = "task-m3-biz-b2";
    const { objectStorage, groupId } = await seed({ cfg, taskId, itemId: "biz-b2" });

    const published = await publishCollaborationBoardItem({
      groupId,
      taskId,
      remainingWork: "biz-b2 chapter",
      acceptanceCriteria: ["sources"],
      intendedClaimantIds: [tenant.bot0],
      actor: tenant.coordinator,
      cfg,
    });
    await claimCollaborationBoardItem({
      groupId,
      taskId,
      itemId: published.itemId,
      claimantId: tenant.bot0,
      cfg,
    });
    // Happy-path apply first (board + task).
    await applyCollaborationBoardClaim({
      groupId,
      taskId,
      itemId: published.itemId,
      actor: tenant.bot0,
      cfg,
    });
    const boardApplied = await loadCollaborationBoardClaimItem({
      groupId,
      taskId,
      itemId: published.itemId,
      cfg,
    });
    expect(boardApplied?.status).toBe("applied");

    const stopControl = buildAcceptedTaskStopControl({
      requestedBy: tenant.owner,
      reason: "biz-b2-after-apply",
      externalEffect: "none",
      requestedAtMs: 99,
    });
    await applyTaskStopUnderControlLock({
      groupId,
      taskId,
      stopControl,
      updatedBy: tenant.owner,
      updatedAtMs: 99,
      cfg,
    });

    await expect(
      applyCollaborationBoardClaim({
        groupId,
        taskId,
        itemId: published.itemId,
        actor: tenant.bot0,
        cfg,
      }),
    ).rejects.toMatchObject({
      name: "ClaimContractEntryError",
      code: "partial_success_board_applied_task_stopped",
    });

    const final = asGovernedTask(
      (await objectStorage.readObject(groupId, "task", taskId)) as never,
    );
    expect(final.stopControl?.status).toBe("accepted");
  });

  test("M3-BIZ-C complete-gate revalidate at commit — missing deliverable after barrier refuses", async () => {
    const { cfg } = await useBizCfg();
    const taskId = "task-m3-biz-c";
    const { objectStorage, groupId, fileStore } = await seed({
      cfg,
      taskId,
      itemId: "biz-c",
    });
    // task_driven ⇒ deliverableRequired
    const state = buildState();
    (state as { groupProfile: Record<string, unknown> }).groupProfile = {
      ...(state as { groupProfile?: Record<string, unknown> }).groupProfile,
      displayName: "T45 biz-c",
      expectedOutputs: ["task"],
      successCriteria: [],
      collaborationMode: "task_driven",
    };
    await writeGroupOperatingState({ fileStore, groupId, state });

    const delId = "del-biz-c";
    await objectStorage.writeObject(groupId, "deliverable", delId, {
      deliverableId: delId,
      groupId,
      taskId,
      title: "biz-c deliverable",
      status: "submitted",
      version: 1,
      submittedBy: tenant.bot0,
      createdAtMs: 1,
      updatedAtMs: 1,
    } as never);

    let release!: () => void;
    const barrier = new Promise<void>((r) => {
      release = r;
    });
    let hitRead!: () => void;
    const readHit = new Promise<void>((r) => {
      hitRead = r;
    });

    const transitionP = transitionCollaborationTask({
      groupId,
      taskId,
      toStatus: "completed",
      actor: tenant.owner,
      cfg,
      _testAfterTaskReadBarrier: async () => {
        hitRead();
        await barrier;
      },
    });

    await readHit;
    // Remove deliverable after outside read / before commit-boundary revalidate.
    await objectStorage.deleteObject(groupId, "deliverable", delId);
    release();

    await expect(transitionP).rejects.toBeInstanceOf(MissingTaskDeliverableError);

    const final = asGovernedTask(
      (await objectStorage.readObject(groupId, "task", taskId)) as never,
    );
    expect(final.status).toBe("in_progress");
    expect(final.completedAtMs).toBeFalsy();
  });

  test("M3-BIZ-H1 different handoff same target must NOT already_applied", async () => {
    const { cfg } = await useBizCfg();
    const taskId = "task-m3-biz-h1";
    const { objectStorage, groupId } = await seed({ cfg, taskId, itemId: "biz-h1" });

    const first = await proposeCollaborationTaskHandoffContract({
      groupId,
      taskId,
      from: tenant.coordinator,
      to: tenant.bot0,
      kind: "owner_transfer",
      remainingWork: "h1-first",
      acceptanceCriteria: ["owner bot0"],
      actor: tenant.coordinator,
      cfg,
    });
    await acceptCollaborationTaskHandoffContract({
      groupId,
      taskId,
      handoffId: first.handoffId,
      actor: tenant.bot0,
      actorType: "bot",
      cfg,
    });
    await approveCollaborationTaskHandoffContract({
      groupId,
      taskId,
      handoffId: first.handoffId,
      actor: tenant.owner,
      actorType: "human",
      cfg,
    });
    await applyCollaborationTaskHandoffContract({
      groupId,
      taskId,
      handoffId: first.handoffId,
      actor: tenant.owner,
      cfg,
    });

    const second = await proposeCollaborationTaskHandoffContract({
      groupId,
      taskId,
      from: tenant.coordinator,
      to: tenant.bot0,
      kind: "owner_transfer",
      remainingWork: "h1-second-same-target",
      acceptanceCriteria: ["still bot0"],
      actor: tenant.coordinator,
      cfg,
    });
    expect(second.handoffId).not.toBe(first.handoffId);
    expect(second.baseHistoryLen).toBe(1);
    await acceptCollaborationTaskHandoffContract({
      groupId,
      taskId,
      handoffId: second.handoffId,
      actor: tenant.bot0,
      actorType: "bot",
      cfg,
    });
    await approveCollaborationTaskHandoffContract({
      groupId,
      taskId,
      handoffId: second.handoffId,
      actor: tenant.owner,
      actorType: "human",
      cfg,
    });

    let caught: { name?: string; code?: string } | undefined;
    try {
      await applyCollaborationTaskHandoffContract({
        groupId,
        taskId,
        handoffId: second.handoffId,
        actor: tenant.owner,
        cfg,
      });
    } catch (err) {
      caught = err as { name?: string; code?: string };
    }
    expect(caught?.name).toBe("HandoffContractEntryError");
    expect(caught?.code).toBeDefined();
    expect(caught?.code).not.toBe("already_applied");
    expect(["target_matches_unproven", "responsibility_conflict"]).toContain(caught?.code);

    const final = asGovernedTask(
      (await objectStorage.readObject(groupId, "task", taskId)) as never,
    );
    expect(final.responsibility?.owner).toBe(tenant.bot0);
    const historyIds = (final.handoffs ?? []).map((h) => h.handoffId).filter(Boolean);
    expect(historyIds).toContain(first.handoffId);
    expect(historyIds).not.toContain(second.handoffId);
  });

  test("M3-BIZ-H2 A→B→A then replay old approved contract must conflict", async () => {
    const { cfg } = await useBizCfg();
    const taskId = "task-m3-biz-h2";
    const { objectStorage, groupId } = await seed({ cfg, taskId, itemId: "biz-h2" });

    // Old contract A→B proposed while history empty (baseHistoryLen=0).
    const old = await proposeCollaborationTaskHandoffContract({
      groupId,
      taskId,
      from: tenant.coordinator,
      to: tenant.bot0,
      kind: "owner_transfer",
      remainingWork: "h2-old",
      acceptanceCriteria: ["old"],
      actor: tenant.coordinator,
      cfg,
    });
    expect(old.baseHistoryLen).toBe(0);
    await acceptCollaborationTaskHandoffContract({
      groupId,
      taskId,
      handoffId: old.handoffId,
      actor: tenant.bot0,
      actorType: "bot",
      cfg,
    });
    await approveCollaborationTaskHandoffContract({
      groupId,
      taskId,
      handoffId: old.handoffId,
      actor: tenant.owner,
      actorType: "human",
      cfg,
    });

    // Intervening A→admin→A (applied), advancing duty-chain version.
    const mid = await proposeCollaborationTaskHandoffContract({
      groupId,
      taskId,
      from: tenant.coordinator,
      to: tenant.admin,
      kind: "owner_transfer",
      remainingWork: "h2-mid",
      acceptanceCriteria: ["mid"],
      actor: tenant.coordinator,
      cfg,
    });
    await acceptCollaborationTaskHandoffContract({
      groupId,
      taskId,
      handoffId: mid.handoffId,
      actor: tenant.admin,
      actorType: "human",
      cfg,
    });
    await approveCollaborationTaskHandoffContract({
      groupId,
      taskId,
      handoffId: mid.handoffId,
      actor: tenant.owner,
      actorType: "human",
      cfg,
    });
    await applyCollaborationTaskHandoffContract({
      groupId,
      taskId,
      handoffId: mid.handoffId,
      actor: tenant.owner,
      cfg,
    });

    const back = await proposeCollaborationTaskHandoffContract({
      groupId,
      taskId,
      from: tenant.admin,
      to: tenant.coordinator,
      kind: "owner_transfer",
      remainingWork: "h2-back",
      acceptanceCriteria: ["back"],
      actor: tenant.admin,
      cfg,
    });
    await acceptCollaborationTaskHandoffContract({
      groupId,
      taskId,
      handoffId: back.handoffId,
      actor: tenant.coordinator,
      actorType: "bot",
      cfg,
    });
    await approveCollaborationTaskHandoffContract({
      groupId,
      taskId,
      handoffId: back.handoffId,
      actor: tenant.owner,
      actorType: "human",
      cfg,
    });
    await applyCollaborationTaskHandoffContract({
      groupId,
      taskId,
      handoffId: back.handoffId,
      actor: tenant.owner,
      cfg,
    });

    const afterLoop = asGovernedTask(
      (await objectStorage.readObject(groupId, "task", taskId)) as never,
    );
    expect(afterLoop.responsibility?.owner).toBe(tenant.coordinator);
    expect((afterLoop.handoffs ?? []).length).toBe(2);

    // Replay old A→B: fromId matches again, but baseHistoryLen=0 ≠ live 2.
    await expect(
      applyCollaborationTaskHandoffContract({
        groupId,
        taskId,
        handoffId: old.handoffId,
        actor: tenant.owner,
        cfg,
      }),
    ).rejects.toMatchObject({
      name: "HandoffContractEntryError",
      code: "responsibility_conflict",
    });

    const final = asGovernedTask(
      (await objectStorage.readObject(groupId, "task", taskId)) as never,
    );
    expect(final.responsibility?.owner).toBe(tenant.coordinator);
    expect((final.handoffs ?? []).map((h) => h.handoffId)).not.toContain(old.handoffId);
  });

  test("M3-BIZ-R1 board applied + task fail → retry projects without re-applying board", async () => {
    const { cfg } = await useBizCfg();
    const taskId = "task-m3-biz-r1";
    const { objectStorage, groupId } = await seed({ cfg, taskId, itemId: "biz-r1" });

    const published = await publishCollaborationBoardItem({
      groupId,
      taskId,
      remainingWork: "r1 chapter",
      acceptanceCriteria: ["sources"],
      intendedClaimantIds: [tenant.admin],
      actor: tenant.coordinator,
      cfg,
    });
    await claimCollaborationBoardItem({
      groupId,
      taskId,
      itemId: published.itemId,
      claimantId: tenant.admin,
      cfg,
    });

    await expect(
      applyCollaborationBoardClaim({
        groupId,
        taskId,
        itemId: published.itemId,
        actor: tenant.admin,
        cfg,
        _testAfterBoardAppliedBeforeTaskPatch: async () => {
          throw new Error("injected_task_write_failure");
        },
      }),
    ).rejects.toThrow(/injected_task_write_failure/);

    const boardAfterPartial = await loadCollaborationBoardClaimItem({
      groupId,
      taskId,
      itemId: published.itemId,
      cfg,
    });
    expect(boardAfterPartial?.status).toBe("applied");
    expect(boardAfterPartial?.revision).toBeTypeOf("number");
    const rev1 = boardAfterPartial!.revision;

    const mid = asGovernedTask((await objectStorage.readObject(groupId, "task", taskId)) as never);
    expect(mid.assignedMemberIds ?? []).not.toContain(tenant.admin);

    const repaired = await applyCollaborationBoardClaim({
      groupId,
      taskId,
      itemId: published.itemId,
      actor: tenant.admin,
      cfg,
    });
    expect(repaired.item.status).toBe("applied");
    expect(repaired.item.revision).toBe(rev1); // board not re-mutated
    expect(repaired.task.assignedMemberIds).toContain(tenant.admin);
    expect(repaired.task.responsibility?.executors).toContain(tenant.admin);

    const boardFinal = await loadCollaborationBoardClaimItem({
      groupId,
      taskId,
      itemId: published.itemId,
      cfg,
    });
    expect(boardFinal?.revision).toBe(rev1);
  });

  test("M3-BIZ-R2 later handoff must not re-grant old applied claimant on recover", async () => {
    const { cfg } = await useBizCfg();
    const taskId = "task-m3-biz-r2";
    const { objectStorage, groupId } = await seed({ cfg, taskId, itemId: "biz-r2" });

    const published = await publishCollaborationBoardItem({
      groupId,
      taskId,
      remainingWork: "r2 chapter",
      acceptanceCriteria: ["sources"],
      intendedClaimantIds: [tenant.admin],
      actor: tenant.coordinator,
      cfg,
    });
    await claimCollaborationBoardItem({
      groupId,
      taskId,
      itemId: published.itemId,
      claimantId: tenant.admin,
      cfg,
    });
    await applyCollaborationBoardClaim({
      groupId,
      taskId,
      itemId: published.itemId,
      actor: tenant.admin,
      cfg,
    });

    // Subsequent executor handoff moves work away from admin (from=admin → bot0).
    const moved = await proposeCollaborationTaskHandoffContract({
      groupId,
      taskId,
      from: tenant.admin,
      to: tenant.bot0,
      kind: "continue",
      fromRole: "executor",
      toRole: "executor",
      remainingWork: "r2-moved",
      acceptanceCriteria: ["moved"],
      actor: tenant.admin,
      cfg,
    });
    await acceptCollaborationTaskHandoffContract({
      groupId,
      taskId,
      handoffId: moved.handoffId,
      actor: tenant.bot0,
      actorType: "bot",
      cfg,
    });
    // continue/executor may not need human approve — try approve if required
    try {
      await approveCollaborationTaskHandoffContract({
        groupId,
        taskId,
        handoffId: moved.handoffId,
        actor: tenant.owner,
        actorType: "human",
        cfg,
      });
    } catch {
      // approval may be none
    }
    await applyCollaborationTaskHandoffContract({
      groupId,
      taskId,
      handoffId: moved.handoffId,
      actor: tenant.owner,
      cfg,
    });

    const afterMove = asGovernedTask(
      (await objectStorage.readObject(groupId, "task", taskId)) as never,
    );
    expect(afterMove.responsibility?.executors ?? []).not.toContain(tenant.admin);
    expect(afterMove.assignedMemberIds ?? []).not.toContain(tenant.admin);

    await expect(
      applyCollaborationBoardClaim({
        groupId,
        taskId,
        itemId: published.itemId,
        actor: tenant.admin,
        cfg,
      }),
    ).rejects.toMatchObject({
      name: "ClaimContractEntryError",
      code: "stale_applied_claim_superseded",
    });

    const final = asGovernedTask(
      (await objectStorage.readObject(groupId, "task", taskId)) as never,
    );
    expect(final.assignedMemberIds ?? []).not.toContain(tenant.admin);
    expect(final.responsibility?.executors ?? []).not.toContain(tenant.admin);
  });

  test("M3-BIZ-R3 stopped + board applied keeps partial_success; not a recovery pass", async () => {
    const { cfg } = await useBizCfg();
    const taskId = "task-m3-biz-r3";
    const { objectStorage, groupId } = await seed({ cfg, taskId, itemId: "biz-r3" });

    const published = await publishCollaborationBoardItem({
      groupId,
      taskId,
      remainingWork: "r3 chapter",
      acceptanceCriteria: ["sources"],
      intendedClaimantIds: [tenant.admin],
      actor: tenant.coordinator,
      cfg,
    });
    await claimCollaborationBoardItem({
      groupId,
      taskId,
      itemId: published.itemId,
      claimantId: tenant.admin,
      cfg,
    });
    await expect(
      applyCollaborationBoardClaim({
        groupId,
        taskId,
        itemId: published.itemId,
        actor: tenant.admin,
        cfg,
        _testAfterBoardAppliedBeforeTaskPatch: async () => {
          throw new Error("injected_before_task");
        },
      }),
    ).rejects.toThrow(/injected_before_task/);

    const stopControl = buildAcceptedTaskStopControl({
      requestedBy: tenant.owner,
      reason: "r3-stop-after-partial",
      externalEffect: "none",
      requestedAtMs: 55,
    });
    await applyTaskStopUnderControlLock({
      groupId,
      taskId,
      stopControl,
      updatedBy: tenant.owner,
      updatedAtMs: 55,
      cfg,
    });

    await expect(
      applyCollaborationBoardClaim({
        groupId,
        taskId,
        itemId: published.itemId,
        actor: tenant.admin,
        cfg,
      }),
    ).rejects.toMatchObject({
      name: "ClaimContractEntryError",
      code: "partial_success_board_applied_task_stopped",
    });

    const final = asGovernedTask(
      (await objectStorage.readObject(groupId, "task", taskId)) as never,
    );
    expect(final.stopControl?.status).toBe("accepted");
    expect(final.assignedMemberIds ?? []).not.toContain(tenant.admin);
  });

  test("M3-BIZ-H3 applied ledger + no history + live from mismatch must conflict", async () => {
    const { cfg } = await useBizCfg();
    const taskId = "task-m3-biz-h3";
    const { objectStorage, groupId, authority } = await seed({ cfg, taskId, itemId: "biz-h3" });

    const proposed = await proposeCollaborationTaskHandoffContract({
      groupId,
      taskId,
      from: tenant.coordinator,
      to: tenant.bot0,
      kind: "owner_transfer",
      remainingWork: "h3-applied-recover",
      acceptanceCriteria: ["owner bot0"],
      actor: tenant.coordinator,
      cfg,
    });
    expect(proposed.baseHistoryLen).toBe(0);
    await acceptCollaborationTaskHandoffContract({
      groupId,
      taskId,
      handoffId: proposed.handoffId,
      actor: tenant.bot0,
      actorType: "bot",
      cfg,
    });
    await approveCollaborationTaskHandoffContract({
      groupId,
      taskId,
      handoffId: proposed.handoffId,
      actor: tenant.owner,
      actorType: "human",
      cfg,
    });

    // Ledger reaches applied without entry writing task history (partial apply).
    const approved = await loadHandoffContract(authority, {
      taskId,
      handoffId: proposed.handoffId,
    });
    expect(approved?.status).toBe("approved");
    const liveBefore = asGovernedTask(
      (await objectStorage.readObject(groupId, "task", taskId)) as never,
    );
    const ledgerApplied = await applyApprovedHandoff(authority, approved!, liveBefore, { cfg });
    expect(ledgerApplied.ok).toBe(true);
    const afterLedger = await loadHandoffContract(authority, {
      taskId,
      handoffId: proposed.handoffId,
    });
    expect(afterLedger?.status).toBe("applied");

    // Other legitimate entry changed owner; history still empty (same baseHistoryLen=0).
    await applyBusinessTaskPatchUnderControlLock({
      groupId,
      taskId,
      cfg,
      buildPatch: (live) => {
        const g = asGovernedTask(live);
        return {
          ownerMemberId: tenant.admin,
          responsibility: {
            ...(g.responsibility ?? {
              owner: tenant.coordinator,
              executors: [tenant.bot0],
              reviewers: [],
              approvers: [tenant.approver],
            }),
            owner: tenant.admin,
          },
          handoffs: g.handoffs ?? [],
          updatedAtMs: Date.now(),
          updatedBy: tenant.admin,
        };
      },
    });

    await expect(
      applyCollaborationTaskHandoffContract({
        groupId,
        taskId,
        handoffId: proposed.handoffId,
        actor: tenant.owner,
        cfg,
      }),
    ).rejects.toMatchObject({
      name: "HandoffContractEntryError",
      code: "responsibility_conflict",
    });

    const final = asGovernedTask(
      (await objectStorage.readObject(groupId, "task", taskId)) as never,
    );
    expect(final.responsibility?.owner).toBe(tenant.admin);
    expect((final.handoffs ?? []).map((h) => h.handoffId)).not.toContain(proposed.handoffId);
  });

  test("M3-BIZ-H4 applied + same history len + other-entry duty change must conflict", async () => {
    const { cfg } = await useBizCfg();
    const taskId = "task-m3-biz-h4";
    const { objectStorage, groupId, authority } = await seed({ cfg, taskId, itemId: "biz-h4" });

    // Seed one prior history entry so baseHistoryLen will be 1 (same len later).
    await applyBusinessTaskPatchUnderControlLock({
      groupId,
      taskId,
      cfg,
      buildPatch: (live) => {
        const g = asGovernedTask(live);
        return {
          handoffs: [
            {
              taskId,
              from: tenant.bot0,
              to: tenant.admin,
              reason: "continue",
              remainingWork: "prior",
              acceptanceCriteria: ["prior"],
              completedArtifacts: [],
              assumptions: [],
              blockers: [],
              handoffId: "prior-h4-history",
            },
          ],
          responsibility: {
            ...(g.responsibility ?? {
              owner: tenant.coordinator,
              executors: [tenant.bot0],
              reviewers: [],
              approvers: [tenant.approver],
            }),
            executors: [tenant.admin],
          },
          assignedMemberIds: [tenant.admin],
          updatedAtMs: Date.now(),
          updatedBy: tenant.admin,
        };
      },
    });

    const proposed = await proposeCollaborationTaskHandoffContract({
      groupId,
      taskId,
      from: tenant.coordinator,
      to: tenant.bot0,
      kind: "owner_transfer",
      remainingWork: "h4-same-len",
      acceptanceCriteria: ["owner bot0"],
      actor: tenant.coordinator,
      cfg,
    });
    expect(proposed.baseHistoryLen).toBe(1);
    await acceptCollaborationTaskHandoffContract({
      groupId,
      taskId,
      handoffId: proposed.handoffId,
      actor: tenant.bot0,
      actorType: "bot",
      cfg,
    });
    await approveCollaborationTaskHandoffContract({
      groupId,
      taskId,
      handoffId: proposed.handoffId,
      actor: tenant.owner,
      actorType: "human",
      cfg,
    });

    const approved = await loadHandoffContract(authority, {
      taskId,
      handoffId: proposed.handoffId,
    });
    const liveBefore = asGovernedTask(
      (await objectStorage.readObject(groupId, "task", taskId)) as never,
    );
    expect((liveBefore.handoffs ?? []).length).toBe(1);
    const ledgerApplied = await applyApprovedHandoff(authority, approved!, liveBefore, { cfg });
    expect(ledgerApplied.ok).toBe(true);

    // Other entry changes owner; history length stays 1 (matches baseHistoryLen).
    await applyBusinessTaskPatchUnderControlLock({
      groupId,
      taskId,
      cfg,
      buildPatch: (live) => {
        const g = asGovernedTask(live);
        expect((g.handoffs ?? []).length).toBe(1);
        return {
          ownerMemberId: tenant.admin,
          responsibility: {
            ...(g.responsibility ?? {
              owner: tenant.coordinator,
              executors: [tenant.admin],
              reviewers: [],
              approvers: [tenant.approver],
            }),
            owner: tenant.admin,
          },
          handoffs: g.handoffs ?? [],
          updatedAtMs: Date.now(),
          updatedBy: tenant.admin,
        };
      },
    });

    await expect(
      applyCollaborationTaskHandoffContract({
        groupId,
        taskId,
        handoffId: proposed.handoffId,
        actor: tenant.owner,
        cfg,
      }),
    ).rejects.toMatchObject({
      name: "HandoffContractEntryError",
      code: "responsibility_conflict",
    });

    const final = asGovernedTask(
      (await objectStorage.readObject(groupId, "task", taskId)) as never,
    );
    expect(final.responsibility?.owner).toBe(tenant.admin);
    expect((final.handoffs ?? []).length).toBe(1);
    expect((final.handoffs ?? []).map((h) => h.handoffId)).not.toContain(proposed.handoffId);
  });

  test("M3-BIZ-R4 old handoff history must not block new applied claim repair", async () => {
    const { cfg } = await useBizCfg();
    const taskId = "task-m3-biz-r4";
    const { objectStorage, groupId } = await seed({ cfg, taskId, itemId: "biz-r4" });

    // Old unrelated handoff where claimant appears as from (before this board apply).
    await applyBusinessTaskPatchUnderControlLock({
      groupId,
      taskId,
      cfg,
      buildPatch: (live) => {
        const g = asGovernedTask(live);
        return {
          handoffs: [
            {
              taskId,
              from: tenant.admin,
              to: tenant.bot0,
              reason: "continue",
              remainingWork: "old-away",
              acceptanceCriteria: ["old"],
              completedArtifacts: [],
              assumptions: [],
              blockers: [],
              handoffId: "old-admin-away",
            },
          ],
          updatedAtMs: Date.now(),
          updatedBy: tenant.admin,
          responsibility: g.responsibility,
          assignedMemberIds: g.assignedMemberIds,
        };
      },
    });

    const published = await publishCollaborationBoardItem({
      groupId,
      taskId,
      remainingWork: "r4 chapter",
      acceptanceCriteria: ["sources"],
      intendedClaimantIds: [tenant.admin],
      actor: tenant.coordinator,
      cfg,
    });
    await claimCollaborationBoardItem({
      groupId,
      taskId,
      itemId: published.itemId,
      claimantId: tenant.admin,
      cfg,
    });

    await expect(
      applyCollaborationBoardClaim({
        groupId,
        taskId,
        itemId: published.itemId,
        actor: tenant.admin,
        cfg,
        _testAfterBoardAppliedBeforeTaskPatch: async () => {
          throw new Error("injected_task_write_failure_r4");
        },
      }),
    ).rejects.toThrow(/injected_task_write_failure_r4/);

    const boardAfterPartial = await loadCollaborationBoardClaimItem({
      groupId,
      taskId,
      itemId: published.itemId,
      cfg,
    });
    expect(boardAfterPartial?.status).toBe("applied");
    expect(boardAfterPartial?.applyBaseHistoryLen).toBe(1);
    const rev1 = boardAfterPartial!.revision;

    const mid = asGovernedTask((await objectStorage.readObject(groupId, "task", taskId)) as never);
    expect(mid.assignedMemberIds ?? []).not.toContain(tenant.admin);

    // Retry must repair despite old from===admin history (before this apply baseline).
    const repaired = await applyCollaborationBoardClaim({
      groupId,
      taskId,
      itemId: published.itemId,
      actor: tenant.admin,
      cfg,
    });
    expect(repaired.item.status).toBe("applied");
    expect(repaired.item.revision).toBe(rev1);
    expect(repaired.task.assignedMemberIds).toContain(tenant.admin);
    expect(repaired.task.responsibility?.executors).toContain(tenant.admin);
  });
});
