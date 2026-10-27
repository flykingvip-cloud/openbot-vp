/**
 * T36 M1–M3 mechanism evidence: trusted auth, trusted verify, stop×dispatch races.
 * Fail-first gaps closed with barrier-ordered concurrency (not only error returns).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Task } from "@openbot/collaboration-core";
import type { CollaborationMember } from "@openbot/collaboration-core";
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
  applyAuthRevokeSharedCas,
  applyRosterAuthChangeSharedCas,
  applyBusinessTaskPatchUnderControlLock,
  applyTaskStopUnderControlLock,
  casClearTaskDispatchClaimForOp,
  casCommitTaskDispatchEligibility,
  casReleaseUnconsumedCommittedClaim,
  casTakeTaskDispatchEligibility,
  readOperatingStateAuthEpoch,
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
import {
  WAKE_OP_DECLARED_VERIFY_CAPABLE_SOURCES,
  buildDeclaredWakeOpVerifyAdapterRegistry,
  createFixtureReceiptNoneAdapter,
  isWakeOpDeclaredVerifyCapableSource,
  writeWakeOpDurableEffectReceipt,
} from "../collaboration-dispatch/wake-op-effect-verify.js";
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
import { isMappedDeliveryIdentity } from "./delivery-actor-binding.js";
import {
  acceptCollaborationTaskHandoffContract,
  applyCollaborationTaskHandoffContract,
  approveCollaborationTaskHandoffContract,
  proposeCollaborationTaskHandoffContract,
} from "./handoff-contract-entry.js";
import {
  commitSyncedGroupOperatingState,
  createWorkspaceCollaborationStores,
  groupAuthLockDir,
  readGroupOperatingState,
  operatingStateAuthContentEqual,
  readOperatingStateAuthSurface,
  resolveGroupOperatingStateAuthLockDir,
  resolveOperatingStateAuthLockRoot,
  syncGroupOperatingState,
  withGroupAuthLock,
  writeGroupOperatingState,
} from "./shared.js";
import { resolveCollaborationGroupTenantId } from "./shared.js";
import { leaveGatewayCollaborationSpace } from "./space-store.js";
import { transitionCollaborationTask } from "./state-machine.js";
import { requestCollaborationTaskStop } from "./task-stop-entry.js";
import { resolveAuthorityTenantForEntry } from "./trusted-tenant.js";
import {
  WAKE_OP_RECOVERY_IDENTITY_MODE,
  WAKE_OP_RECOVERY_IDENTITY_MODE_GATEWAY,
  WAKE_OP_RECOVERY_IDENTITY_MODE_TEST_ONLY,
  confirmWakeOpCompletedAuthorized,
  createGatewaySessionRecoveryExecContext,
  createInternalLibraryRecoveryExecContext,
  mintWakeOpTrustedGatewaySessionForTests,
  mintWakeOpTrustedGatewaySessionFromPlatformAuth,
  produceDeclaredPlatformNoneVerificationAtRoot,
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

      approver: tenant.approver,
      decisionAuthority: tenant.approver,
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
    await writeAuthOsForTest({
      fileStore,
      groupId,
      cfg,
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

    await writeAuthOsForTest({ fileStore, groupId, cfg, state: buildState() });
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
    await writeAuthOsForTest({ fileStore, groupId, cfg, state: revoked });
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
  test("M1-BRAND-01: Symbol.for forged brand rejected; internal-library demoted to test-only", async () => {
    expect(WAKE_OP_RECOVERY_IDENTITY_MODE).toBe(WAKE_OP_RECOVERY_IDENTITY_MODE_TEST_ONLY);
    expect(WAKE_OP_RECOVERY_IDENTITY_MODE_TEST_ONLY).toBe("internal_library_not_e2e_authenticated");
    expect(WAKE_OP_RECOVERY_IDENTITY_MODE_GATEWAY).toBe("gateway_session_authenticated");

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
    expect(exec.exec.identityMode).toBe(WAKE_OP_RECOVERY_IDENTITY_MODE_TEST_ONLY);
    // Must not claim gateway e2e mode on bare-actorId / internal-library path
    expect(exec.exec.identityMode).not.toBe(WAKE_OP_RECOVERY_IDENTITY_MODE_GATEWAY);
    expect(exec.exec.identityProvenance).not.toBe("gateway_session");

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

        approver: tenant.approver,
        decisionAuthority: tenant.approver,
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
        reviewer: tenant.bot0,
        approver: tenant.owner,
        decisionAuthority: tenant.owner,
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
    await writeAuthOsForTest({ fileStore, groupId, cfg, state: revoked });

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
    await writeAuthOsForTest({ fileStore, groupId, cfg, state: buildState() });
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
        authEpoch: 0,
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

              approver: tenant.approver,
              decisionAuthority: tenant.approver,
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

              approver: tenant.approver,
              decisionAuthority: tenant.approver,
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

              approver: tenant.approver,
              decisionAuthority: tenant.approver,
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

              approver: tenant.approver,
              decisionAuthority: tenant.approver,
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

describe("T51 M3-REVOKE shared authEpoch CAS", () => {
  test("M3-REV-1: after recheck before task CAS — auth revoke bumps authEpoch → commit拒; calls=0", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-m3-rev-1";
    const { authority, fileStore, groupId, objectStorage } = await seed({
      cfg,
      taskId,
      itemId: "rev1",
    });
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
        return { ok: true, roundId: "no" };
      },
      request: wakeReq(taskId, "rev1"),
    });
    for (let i = 0; i < 200; i += 1) {
      if (entered) {
        break;
      }
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(entered).toBe(true);
    const beforeOs = await readGroupOperatingState({ fileStore, groupId });
    const beforeAuth = readOperatingStateAuthEpoch(beforeOs);
    const revoked = await applyAuthRevokeSharedCas({
      groupId,
      cfg,
      invalidateTaskIds: [taskId],
      mutate: (state) => ({
        ...state,
        memberRoleMap: (state.memberRoleMap ?? []).filter((row) => row.memberId !== tenant.bot0),
        governance: {
          ...state.governance,
          coordinatorBotId: tenant.coordinator,
          ownerUserId: tenant.owner,
        },
      }),
    });
    expect(revoked.authEpoch).toBeGreaterThan(beforeAuth);
    release();
    const wake = await wakeP;
    expect(calls).toBe(0);
    expect(wake.dispatched).toBe(false);
    expect(["auth_revoked", "eligibility_cas_rejected", "task_stopped"]).toContain(wake.reason);
    const final = asGovernedTask(
      (await objectStorage.readObject(groupId, "task", taskId)) as never,
    );
    expect(final.dispatchClaim).toBeFalsy();
    const os = await readGroupOperatingState({ fileStore, groupId });
    expect(readOperatingStateAuthEpoch(os)).toBe(revoked.authEpoch);
  });

  test("M3-REV-2: commit ok → revoke+authEpoch bump → take拒; no external dispatch", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-m3-rev-2";
    const { authority, fileStore, groupId, objectStorage } = await seed({
      cfg,
      taskId,
      itemId: "rev2",
    });
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
      _testAfterEligibilityBarrier: async () => {
        entered = true;
        await barrier;
      },
      roundDispatcher: async () => {
        calls += 1;
        return { ok: true, roundId: "no" };
      },
      request: wakeReq(taskId, "rev2"),
    });
    for (let i = 0; i < 200; i += 1) {
      if (entered) {
        break;
      }
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(entered).toBe(true);
    const mid = asGovernedTask((await objectStorage.readObject(groupId, "task", taskId)) as never);
    expect(mid.dispatchClaim?.phase).toBe("committed");
    const claimAuth = mid.dispatchClaim?.authEpoch ?? 0;
    await applyAuthRevokeSharedCas({
      groupId,
      cfg,
      invalidateTaskIds: [taskId],
      mutate: (state) => ({
        ...state,
        memberRoleMap: (state.memberRoleMap ?? []).filter((row) => row.memberId !== tenant.bot0),
      }),
    });
    const afterOs = await readGroupOperatingState({ fileStore, groupId });
    expect(readOperatingStateAuthEpoch(afterOs)).toBeGreaterThan(claimAuth);
    release();
    const wake = await wakeP;
    expect(calls).toBe(0);
    expect(wake.dispatched).toBe(false);
    expect(["auth_revoked", "eligibility_take_rejected", "task_stopped_in_flight"]).toContain(
      wake.reason,
    );
  });

  test("M3-REV-3: fingerprint held constant but authEpoch bumped → still拒 (not fingerprint-only)", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-m3-rev-3";
    const { fileStore, groupId, objectStorage } = await seed({ cfg, taskId, itemId: "rev3" });
    const os0 = await readGroupOperatingState({ fileStore, groupId });
    const fp = wakeOpAuthFingerprint(os0, [tenant.bot0]);
    const before = asGovernedTask(
      (await objectStorage.readObject(groupId, "task", taskId)) as never,
    );
    const epoch = typeof before.controlEpoch === "number" ? before.controlEpoch : 0;
    const auth0 = readOperatingStateAuthEpoch(os0);

    const revoked = await applyAuthRevokeSharedCas({
      groupId,
      cfg,
      invalidateTaskIds: [],
      bumpTaskControlEpoch: false,
      mutate: (state) => state,
    });
    expect(revoked.authEpoch).toBe(auth0 + 1);
    const os1 = await readGroupOperatingState({ fileStore, groupId });
    expect(wakeOpAuthFingerprint(os1, [tenant.bot0])).toBe(fp);

    const cas = await casCommitTaskDispatchEligibility({
      groupId,
      taskId,
      opKey: opKeyFor(taskId, "rev3"),
      expectedControlEpoch: epoch,
      expectedAuthEpoch: auth0,
      authFingerprint: fp,
      targetActorIds: [tenant.bot0],
      _testForceLiveAuthFingerprint: fp,
      cfg,
    });
    expect(cas.ok).toBe(false);
    if (cas.ok) {
      throw new Error("must refuse on authEpoch alone");
    }
    expect(cas.reason).toBe("auth_epoch_mismatch");

    const casOk = await casCommitTaskDispatchEligibility({
      groupId,
      taskId,
      opKey: opKeyFor(taskId, "rev3-fresh"),
      expectedControlEpoch: epoch,
      expectedAuthEpoch: revoked.authEpoch,
      authFingerprint: fp,
      targetActorIds: [tenant.bot0],
      cfg,
    });
    expect(casOk.ok).toBe(true);
    if (!casOk.ok) {
      throw new Error("fresh authEpoch must commit");
    }
    expect(casOk.claim.authEpoch).toBe(revoked.authEpoch);

    await applyAuthRevokeSharedCas({
      groupId,
      cfg,
      invalidateTaskIds: [],
      mutate: (state) => state,
    });
    const take = await casTakeTaskDispatchEligibility({
      groupId,
      taskId,
      opKey: opKeyFor(taskId, "rev3-fresh"),
      claimId: casOk.claim.claimId,
      targetActorIds: [tenant.bot0],
      _testForceLiveAuthFingerprint: fp,
      cfg,
    });
    expect(take.ok).toBe(false);
    if (take.ok) {
      throw new Error("take must refuse");
    }
    expect(take.reason).toBe("auth_epoch_mismatch");
  });

  test("M3-REV-4: revoke actor A; actor B independent eligibility still obtainable", async () => {
    const { cfg } = await useIsolationRoot();
    const taskA = "task-m3-rev-4a";
    const taskB = "task-m3-rev-4b";
    const { fileStore, groupId, objectStorage } = await seed({
      cfg,
      taskId: taskA,
      itemId: "rev4a",
    });
    await objectStorage.writeObject(groupId, "task", taskB, {
      taskId: taskB,
      groupId,
      title: "t51-b",
      status: "in_progress",
      ownerMemberId: tenant.coordinator,
      assignedMemberIds: [tenant.coordinator],
      responsibility: {
        owner: tenant.coordinator,

        executors: [tenant.coordinator],

        approver: tenant.approver,
        decisionAuthority: tenant.approver,
      },
      controlEpoch: 0,
      createdAtMs: 1,
      updatedAtMs: 1,
    } as Task);

    const os0 = await readGroupOperatingState({ fileStore, groupId });
    const fpA = wakeOpAuthFingerprint(os0, [tenant.bot0]);
    const auth0 = readOperatingStateAuthEpoch(os0);

    await applyAuthRevokeSharedCas({
      groupId,
      cfg,
      invalidateTaskIds: [taskA],
      mutate: (state) => ({
        ...state,
        memberRoleMap: (state.memberRoleMap ?? []).filter((row) => row.memberId !== tenant.bot0),
      }),
    });
    const os1 = await readGroupOperatingState({ fileStore, groupId });
    const auth1 = readOperatingStateAuthEpoch(os1);
    expect(auth1).toBeGreaterThan(auth0);

    const refuseA = await casCommitTaskDispatchEligibility({
      groupId,
      taskId: taskA,
      opKey: opKeyFor(taskA, "rev4a"),
      expectedControlEpoch: 0,
      expectedAuthEpoch: auth0,
      authFingerprint: fpA,
      targetActorIds: [tenant.bot0],
      cfg,
    });
    expect(refuseA.ok).toBe(false);

    // Fresh authEpoch but still presenting pre-revoke fingerprint for A → fingerprint refuse.
    const refuseA2 = await casCommitTaskDispatchEligibility({
      groupId,
      taskId: taskA,
      opKey: opKeyFor(taskA, "rev4a-2"),
      expectedControlEpoch: 1,
      expectedAuthEpoch: auth1,
      authFingerprint: fpA,
      targetActorIds: [tenant.bot0],
      cfg,
    });
    expect(refuseA2.ok).toBe(false);
    if (refuseA2.ok) {
      throw new Error("A must not commit with stale fingerprint");
    }
    expect(refuseA2.reason).toBe("auth_fingerprint_mismatch");

    // Authorization recheck also refuses unmapped A (execution path gate).
    const authA = await recheckCurrentDispatchAuthorization({
      groupId,
      taskId: taskA,
      targetActorIds: [tenant.bot0],
      cfg,
    });
    expect(authA.ok).toBe(false);

    const okB = await casCommitTaskDispatchEligibility({
      groupId,
      taskId: taskB,
      opKey: opKeyFor(taskB, "rev4b"),
      expectedControlEpoch: 0,
      expectedAuthEpoch: auth1,
      authFingerprint: wakeOpAuthFingerprint(os1, [tenant.coordinator]),
      targetActorIds: [tenant.coordinator],
      cfg,
    });
    expect(okB.ok).toBe(true);
    if (!okB.ok) {
      throw new Error("B must still obtain eligibility");
    }
    expect(okB.claim.authEpoch).toBe(auth1);
  });

  test("M3-REV-5: cross-handle + cross-process authEpoch vs eligibility CAS", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-m3-rev-5";
    const { fileStore, groupId } = await seed({ cfg, taskId, itemId: "rev5" });
    const storesA = createWorkspaceCollaborationStores(cfg);
    const storesB = createWorkspaceCollaborationStores(cfg);
    expect(storesA.objectStorage).not.toBe(storesB.objectStorage);

    const os = await readGroupOperatingState({ fileStore: storesA.fileStore, groupId });
    const fp = wakeOpAuthFingerprint(os, [tenant.bot0]);
    const before = asGovernedTask(
      (await storesA.objectStorage.readObject(groupId, "task", taskId)) as never,
    );
    const expectedEpoch = typeof before.controlEpoch === "number" ? before.controlEpoch : 0;
    const expectedAuth = readOperatingStateAuthEpoch(os);

    const casP = casCommitTaskDispatchEligibility({
      groupId,
      taskId,
      opKey: opKeyFor(taskId, "rev5"),
      expectedControlEpoch: expectedEpoch,
      expectedAuthEpoch: expectedAuth,
      authFingerprint: fp,
      targetActorIds: [tenant.bot0],
      cfg,
    });
    const revokeP = applyAuthRevokeSharedCas({
      groupId,
      cfg,
      invalidateTaskIds: [taskId],
      mutate: (state) => ({
        ...state,
        memberRoleMap: (state.memberRoleMap ?? []).filter((row) => row.memberId !== tenant.bot0),
      }),
    });
    const [casResult, revokeResult] = await Promise.all([casP, revokeP]);
    expect(revokeResult.authEpoch).toBeGreaterThan(expectedAuth);

    const final = asGovernedTask(
      (await storesB.objectStorage.readObject(groupId, "task", taskId)) as never,
    );
    const finalOs = await readGroupOperatingState({ fileStore: storesB.fileStore, groupId });
    expect(readOperatingStateAuthEpoch(finalOs)).toBe(revokeResult.authEpoch);

    if (casResult.ok) {
      expect(final.dispatchClaim).toBeFalsy();
      expect(casResult.claim.authEpoch).toBe(expectedAuth);
    } else {
      expect([
        "auth_epoch_mismatch",
        "auth_fingerprint_mismatch",
        "epoch_mismatch",
        "claim_held",
      ]).toContain(casResult.reason);
      expect(final.dispatchClaim).toBeFalsy();
    }

    const take = await casTakeTaskDispatchEligibility({
      groupId,
      taskId,
      opKey: opKeyFor(taskId, "rev5"),
      claimId: casResult.ok ? casResult.claim.claimId : "none",
      targetActorIds: [tenant.bot0],
      cfg,
    });
    expect(take.ok).toBe(false);

    // Cross-process: child bumps OS authEpoch + strips member on durable file.
    const taskId2 = "task-m3-rev-5-child";
    await storesA.objectStorage.writeObject(groupId, "task", taskId2, {
      taskId: taskId2,
      groupId,
      title: "t51-child",
      status: "in_progress",
      ownerMemberId: tenant.coordinator,
      assignedMemberIds: [tenant.bot0],
      responsibility: {
        owner: tenant.coordinator,

        executors: [tenant.bot0],

        approver: tenant.approver,
        decisionAuthority: tenant.approver,
      },
      controlEpoch: 0,
      createdAtMs: 1,
      updatedAtMs: 1,
    } as Task);
    await applyAuthRevokeSharedCas({
      groupId,
      cfg,
      invalidateTaskIds: [],
      mutate: (state) => {
        const map = [...(state.memberRoleMap ?? [])];
        if (!map.some((r) => r.memberId === tenant.bot0)) {
          map.push({
            memberId: tenant.bot0,
            memberKind: "bot",
            governanceRole: "member",
            collaborationRole: null,
            status: "active",
          });
        }
        return { ...state, memberRoleMap: map };
      },
    });
    const osReady = await readGroupOperatingState({ fileStore, groupId });
    const fpReady = wakeOpAuthFingerprint(osReady, [tenant.bot0]);
    const authReady = readOperatingStateAuthEpoch(osReady);
    const stateDir = process.env.OPENBOT_STATE_DIR!;
    const childScript = [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const stateDir = process.argv[1];",
      "const groupId = process.argv[2];",
      "const botId = process.argv[3];",
      "function walk(dir, acc) {",
      "  acc = acc || [];",
      "  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {",
      "    const p = path.join(dir, ent.name);",
      "    if (ent.isDirectory()) walk(p, acc);",
      "    else if (ent.name.indexOf('operating-state') >= 0 && ent.name.endsWith('.json')) acc.push(p);",
      "  }",
      "  return acc;",
      "}",
      "const tenants = path.join(stateDir, 'tenants');",
      "let files = fs.existsSync(tenants) ? walk(tenants) : [];",
      "if (!files.length) files = walk(stateDir);",
      "const target = files.find((f) => f.indexOf(groupId) >= 0) || files[0];",
      "if (!target) { console.error('no OS'); process.exit(3); }",
      "const raw = JSON.parse(fs.readFileSync(target, 'utf8'));",
      "raw.authEpoch = (typeof raw.authEpoch === 'number' ? raw.authEpoch : 0) + 1;",
      "raw.memberRoleMap = (raw.memberRoleMap || []).filter((r) => r.memberId !== botId);",
      "fs.writeFileSync(target, JSON.stringify(raw, null, 2));",
      "process.stdout.write(String(raw.authEpoch));",
      "process.exit(0);",
    ].join("\n");
    const child = spawnSync(process.execPath, ["-e", childScript, stateDir, groupId, tenant.bot0], {
      encoding: "utf8",
    });
    expect(child.status).toBe(0);
    const childAuth = Number((child.stdout || "").trim());
    expect(childAuth).toBeGreaterThan(authReady);

    const casAfterChild = await casCommitTaskDispatchEligibility({
      groupId,
      taskId: taskId2,
      opKey: opKeyFor(taskId2, "rev5-child"),
      expectedControlEpoch: 0,
      expectedAuthEpoch: authReady,
      authFingerprint: fpReady,
      targetActorIds: [tenant.bot0],
      cfg,
    });
    expect(casAfterChild.ok).toBe(false);
    if (casAfterChild.ok) {
      throw new Error("cross-process authEpoch bump must refuse stale commit");
    }
    expect(["auth_epoch_mismatch", "auth_fingerprint_mismatch"]).toContain(casAfterChild.reason);
  });

  test("M3-AUTH-1: concurrent revoke A+B both retained (stable counterexample)", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-m3-auth-1";
    const { fileStore, groupId } = await seed({ cfg, taskId, itemId: "auth1" });
    // Ensure both A (bot0) and B (admin) are present to revoke independently.
    await applyAuthRevokeSharedCas({
      groupId,
      cfg,
      invalidateTaskIds: [],
      mutate: (state) => {
        const map = [...(state.memberRoleMap ?? [])];
        for (const id of [tenant.bot0, tenant.admin]) {
          if (!map.some((r) => r.memberId === id)) {
            map.push({
              memberId: id,
              memberKind: id === tenant.bot0 ? "bot" : "human",
              governanceRole: id === tenant.admin ? "admin" : "member",
              collaborationRole: null,
              status: "active",
            });
          }
        }
        return { ...state, memberRoleMap: map };
      },
    });
    const os0 = await readGroupOperatingState({ fileStore, groupId });
    const auth0 = readOperatingStateAuthEpoch(os0);
    expect((os0?.memberRoleMap ?? []).some((r) => r.memberId === tenant.bot0)).toBe(true);
    expect((os0?.memberRoleMap ?? []).some((r) => r.memberId === tenant.admin)).toBe(true);

    let releaseWrites!: () => void;
    const bothReadGate = new Promise<void>((r) => {
      releaseWrites = r;
    });
    let reads = 0;
    const noteRead = async () => {
      reads += 1;
      if (reads >= 2) {
        // both observed the pre-lock snapshot; allow lock/re-read/write to proceed
      }
      await bothReadGate;
    };

    const revokeA = applyAuthRevokeSharedCas({
      groupId,
      cfg,
      invalidateTaskIds: [],
      _testAfterInitialReadBeforeLock: noteRead,
      mutate: (state) => ({
        ...state,
        memberRoleMap: (state.memberRoleMap ?? []).filter((row) => row.memberId !== tenant.bot0),
      }),
    });
    const revokeB = applyAuthRevokeSharedCas({
      groupId,
      cfg,
      invalidateTaskIds: [],
      _testAfterInitialReadBeforeLock: noteRead,
      mutate: (state) => ({
        ...state,
        memberRoleMap: (state.memberRoleMap ?? []).filter((row) => row.memberId !== tenant.admin),
      }),
    });

    for (let i = 0; i < 400; i += 1) {
      if (reads >= 2) {
        break;
      }
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(reads).toBe(2);
    releaseWrites();
    const [ra, rb] = await Promise.all([revokeA, revokeB]);

    const finalOs = await readGroupOperatingState({ fileStore, groupId });
    const finalAuth = readOperatingStateAuthEpoch(finalOs);
    const ids = new Set((finalOs?.memberRoleMap ?? []).map((r) => r.memberId));
    // Both revokes must be retained — not last-writer-wins on a stale snapshot.
    expect(ids.has(tenant.bot0)).toBe(false);
    expect(ids.has(tenant.admin)).toBe(false);
    // Version advance is explainable: two serialized bumps from the same baseline.
    expect(finalAuth).toBe(auth0 + 2);
    expect(new Set([ra.authEpoch, rb.authEpoch])).toEqual(new Set([auth0 + 1, auth0 + 2]));
    expect(Math.max(ra.authEpoch, rb.authEpoch)).toBe(finalAuth);
  });

  test("M3-AUTH-2: take OS-read→taken submit atomic vs revoke; multi-task same group", async () => {
    const { cfg } = await useIsolationRoot();
    const taskA = "task-m3-auth-2a";
    const taskB = "task-m3-auth-2b";
    const { fileStore, groupId, objectStorage } = await seed({
      cfg,
      taskId: taskA,
      itemId: "auth2a",
    });
    await objectStorage.writeObject(groupId, "task", taskB, {
      taskId: taskB,
      groupId,
      title: "t52-b",
      status: "in_progress",
      ownerMemberId: tenant.coordinator,
      assignedMemberIds: [tenant.bot0],
      responsibility: {
        owner: tenant.coordinator,

        executors: [tenant.bot0],

        approver: tenant.approver,
        decisionAuthority: tenant.approver,
      },
      controlEpoch: 0,
      createdAtMs: 1,
      updatedAtMs: 1,
    } as Task);

    const os0 = await readGroupOperatingState({ fileStore, groupId });
    const fp = wakeOpAuthFingerprint(os0, [tenant.bot0]);
    const auth0 = readOperatingStateAuthEpoch(os0);

    const commitA = await casCommitTaskDispatchEligibility({
      groupId,
      taskId: taskA,
      opKey: opKeyFor(taskA, "auth2a"),
      expectedControlEpoch: 0,
      expectedAuthEpoch: auth0,
      authFingerprint: fp,
      targetActorIds: [tenant.bot0],
      cfg,
    });
    expect(commitA.ok).toBe(true);
    if (!commitA.ok) {
      throw new Error("commit A required");
    }
    const commitB = await casCommitTaskDispatchEligibility({
      groupId,
      taskId: taskB,
      opKey: opKeyFor(taskB, "auth2b"),
      expectedControlEpoch: 0,
      expectedAuthEpoch: auth0,
      authFingerprint: fp,
      targetActorIds: [tenant.bot0],
      cfg,
    });
    expect(commitB.ok).toBe(true);
    if (!commitB.ok) {
      throw new Error("commit B required");
    }

    let releaseTake!: () => void;
    const takeBarrier = new Promise<void>((r) => {
      releaseTake = r;
    });
    let takeEntered = false;
    let revokeStarted = false;
    let revokeFinishedBeforeTakeWrite = false;

    const takeP = casTakeTaskDispatchEligibility({
      groupId,
      taskId: taskA,
      opKey: opKeyFor(taskA, "auth2a"),
      claimId: commitA.claim.claimId,
      targetActorIds: [tenant.bot0],
      cfg,
      _testAfterOsReadBarrier: async () => {
        takeEntered = true;
        // While take holds auth+task locks after OS read, revoke must not complete
        // an OS auth write (unified boundary). Signal and wait.
        await takeBarrier;
        // If revoke already finished its OS write while we sat on the barrier,
        // the auth lock was NOT covering this critical section (regression).
        if (revokeStarted && revokeFinishedBeforeTakeWrite) {
          // observed below via flag; take will still re-check? No — snapshot already read.
          // With the fix, revoke cannot finish until we release.
        }
      },
    });

    for (let i = 0; i < 400; i += 1) {
      if (takeEntered) {
        break;
      }
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(takeEntered).toBe(true);

    revokeStarted = true;
    const revokeP = applyAuthRevokeSharedCas({
      groupId,
      cfg,
      invalidateTaskIds: [taskA, taskB],
      mutate: (state) => ({
        ...state,
        memberRoleMap: (state.memberRoleMap ?? []).filter((row) => row.memberId !== tenant.bot0),
      }),
    });
    // Give revoke a chance to race; with auth lock it must block until take releases.
    await new Promise((r) => setTimeout(r, 80));
    const osMid = await readGroupOperatingState({ fileStore, groupId });
    // Revoke must not have written yet (still authEpoch == auth0) while take holds the lock.
    expect(readOperatingStateAuthEpoch(osMid)).toBe(auth0);
    revokeFinishedBeforeTakeWrite = readOperatingStateAuthEpoch(osMid) > auth0;

    releaseTake();
    const [takeResult, revokeResult] = await Promise.all([takeP, revokeP]);

    // Take completed under the pre-revoke epoch (legitimately first), then revoke advanced.
    // OR take refused if revoke won the auth lock first — both are valid linearizations.
    // Illegal: revoke OS write between take's OS read and taken write while take still succeeds
    // with the stale snapshot. We already asserted mid-barrier OS was unchanged.
    expect(revokeFinishedBeforeTakeWrite).toBe(false);
    expect(revokeResult.authEpoch).toBeGreaterThan(auth0);

    const finalOs = await readGroupOperatingState({ fileStore, groupId });
    expect(readOperatingStateAuthEpoch(finalOs)).toBe(revokeResult.authEpoch);
    expect((finalOs?.memberRoleMap ?? []).some((r) => r.memberId === tenant.bot0)).toBe(false);

    // Both tasks affected by the same group auth change: outstanding claims cleared / epochs bumped.
    const finalA = asGovernedTask(
      (await objectStorage.readObject(groupId, "task", taskA)) as never,
    );
    const finalB = asGovernedTask(
      (await objectStorage.readObject(groupId, "task", taskB)) as never,
    );
    expect(finalA.dispatchClaim).toBeFalsy();
    expect(finalB.dispatchClaim).toBeFalsy();

    if (takeResult.ok) {
      // Take won the race before revoke: claim was taken then cleared by revoke.
      expect(takeResult.claim.phase).toBe("taken");
    } else {
      expect([
        "auth_epoch_mismatch",
        "claim_missing",
        "epoch_mismatch",
        "claim_id_mismatch",
      ]).toContain(takeResult.reason);
    }

    // Fresh take on B with pre-revoke claim must fail after group auth change.
    const takeB = await casTakeTaskDispatchEligibility({
      groupId,
      taskId: taskB,
      opKey: opKeyFor(taskB, "auth2b"),
      claimId: commitB.claim.claimId,
      targetActorIds: [tenant.bot0],
      cfg,
    });
    expect(takeB.ok).toBe(false);
  });

  test("M3-AUTH-3: stale OS business write cannot roll back authEpoch / member auth", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-m3-auth-3";
    const { fileStore, groupId } = await seed({ cfg, taskId, itemId: "auth3" });
    const os0 = await readGroupOperatingState({ fileStore, groupId });
    const auth0 = readOperatingStateAuthEpoch(os0);
    const staleSnapshot = {
      ...(os0 as NonNullable<typeof os0>),
      activeContext: {
        ...(os0 as NonNullable<typeof os0>).activeContext,
        summary: "stale-business-summary",
      },
    };

    const revoked = await applyAuthRevokeSharedCas({
      groupId,
      cfg,
      invalidateTaskIds: [taskId],
      mutate: (state) => ({
        ...state,
        memberRoleMap: (state.memberRoleMap ?? []).filter((row) => row.memberId !== tenant.bot0),
      }),
    });
    expect(revoked.authEpoch).toBe(auth0 + 1);
    const afterRevoke = await readGroupOperatingState({ fileStore, groupId });
    expect((afterRevoke?.memberRoleMap ?? []).some((r) => r.memberId === tenant.bot0)).toBe(false);

    // Stale business write carrying old authEpoch + old memberRoleMap must not roll back.
    await writeGroupOperatingState({
      fileStore,
      groupId,
      state: {
        ...staleSnapshot,
        authEpoch: auth0,
        updatedAtMs: Date.now(),
      } as typeof staleSnapshot & { authEpoch: number },
    });
    const finalOs = await readGroupOperatingState({ fileStore, groupId });
    expect(readOperatingStateAuthEpoch(finalOs)).toBe(revoked.authEpoch);
    expect((finalOs?.memberRoleMap ?? []).some((r) => r.memberId === tenant.bot0)).toBe(false);
    // Business field from stale may apply, but auth fields stay at live.
    expect(finalOs?.activeContext?.summary).toBe("stale-business-summary");

    // Abnormal authEpoch on auth write must refuse (not silently become legal).
    await expect(
      writeGroupOperatingState({
        fileStore,
        groupId,
        writeKind: "auth",
        state: {
          ...(finalOs as NonNullable<typeof finalOs>),
          authEpoch: Number.NaN,
        } as never,
      }),
    ).rejects.toThrow(/invalid authEpoch/);
  });

  test("M3-AUTH-3b: business write without authEpoch cannot restore revoked member", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-m3-auth-3b";
    const { fileStore, groupId } = await seed({ cfg, taskId, itemId: "auth3b" });
    const os0 = await readGroupOperatingState({ fileStore, groupId });
    expect(isMappedDeliveryIdentity(os0, tenant.bot0)).toBe(true);

    // Capture a business-shaped snapshot that still lists bot0, then strip authEpoch.
    const staleWithMember = {
      ...(os0 as NonNullable<typeof os0>),
      activeContext: {
        ...(os0 as NonNullable<typeof os0>).activeContext,
        summary: "biz-no-epoch-restore-member",
      },
      updatedAtMs: Date.now(),
    };
    const noEpochSnapshot = { ...staleWithMember };
    delete (noEpochSnapshot as { authEpoch?: number }).authEpoch;

    const revoked = await applyAuthRevokeSharedCas({
      groupId,
      cfg,
      invalidateTaskIds: [taskId],
      mutate: (state) => ({
        ...state,
        memberRoleMap: (state.memberRoleMap ?? []).filter((row) => row.memberId !== tenant.bot0),
      }),
    });
    expect(revoked.authEpoch).toBe(readOperatingStateAuthEpoch(os0) + 1);
    expect(isMappedDeliveryIdentity(revoked.operatingState, tenant.bot0)).toBe(false);

    // Old caller: no authEpoch field → must NOT restore bot0 under the same version.
    await writeGroupOperatingState({
      fileStore,
      groupId,
      cfg,
      state: noEpochSnapshot as typeof staleWithMember,
    });
    const finalOs = await readGroupOperatingState({ fileStore, groupId });
    expect(readOperatingStateAuthEpoch(finalOs)).toBe(revoked.authEpoch);
    expect((finalOs?.memberRoleMap ?? []).some((r) => r.memberId === tenant.bot0)).toBe(false);
    expect(isMappedDeliveryIdentity(finalOs, tenant.bot0)).toBe(false);
    expect(finalOs?.activeContext?.summary).toBe("biz-no-epoch-restore-member");
  });

  test("M3-AUTH-3c: business write cannot restore old owner/admin/coordinator", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-m3-auth-3c";
    const { fileStore, groupId } = await seed({ cfg, taskId, itemId: "auth3c" });
    const os0 = await readGroupOperatingState({ fileStore, groupId });
    const staleGov = {
      ...(os0 as NonNullable<typeof os0>),
      activeContext: {
        ...(os0 as NonNullable<typeof os0>).activeContext,
        summary: "biz-restore-governance",
      },
      updatedAtMs: Date.now(),
    };

    const newOwner = `${tenant.tenantId}/emp-owner-new`;
    const newAdmin = `${tenant.tenantId}/emp-admin-new`;
    const newCoord = `${tenant.tenantId}/bot-coord-new`;
    const revoked = await applyAuthRevokeSharedCas({
      groupId,
      cfg,
      invalidateTaskIds: [taskId],
      mutate: (state) => ({
        ...state,
        governance: {
          ...state.governance,
          ownerUserId: newOwner,
          adminUserIds: [newAdmin],
          coordinatorBotId: newCoord,
        },
      }),
    });
    expect(revoked.operatingState.governance.ownerUserId).toBe(newOwner);
    expect(revoked.operatingState.governance.adminUserIds).toEqual([newAdmin]);
    expect(revoked.operatingState.governance.coordinatorBotId).toBe(newCoord);

    await writeGroupOperatingState({
      fileStore,
      groupId,
      cfg,
      state: {
        ...staleGov,
        // even with matching or lower epoch, governance must stay at live
        authEpoch: readOperatingStateAuthEpoch(os0),
      } as typeof staleGov & { authEpoch: number },
    });
    const finalOs = await readGroupOperatingState({ fileStore, groupId });
    expect(readOperatingStateAuthEpoch(finalOs)).toBe(revoked.authEpoch);
    expect(finalOs?.governance?.ownerUserId).toBe(newOwner);
    expect(finalOs?.governance?.adminUserIds).toEqual([newAdmin]);
    expect(finalOs?.governance?.coordinatorBotId).toBe(newCoord);
    expect(finalOs?.governance?.ownerUserId).not.toBe(tenant.owner);
    expect(finalOs?.governance?.adminUserIds).not.toContain(tenant.admin);
    expect(finalOs?.governance?.coordinatorBotId).not.toBe(tenant.coordinator);
    expect(isMappedDeliveryIdentity(finalOs, newCoord)).toBe(true);
    expect(finalOs?.activeContext?.summary).toBe("biz-restore-governance");
  });

  test("M3-AUTH-3d: same-epoch auth content change refused; business update succeeds", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-m3-auth-3d";
    const { fileStore, groupId } = await seed({ cfg, taskId, itemId: "auth3d" });
    const live = await readGroupOperatingState({ fileStore, groupId });
    const liveEpoch = readOperatingStateAuthEpoch(live);
    const liveSurface = readOperatingStateAuthSurface(live);
    expect(liveSurface).not.toBeNull();

    await expect(
      writeGroupOperatingState({
        fileStore,
        groupId,
        cfg,
        writeKind: "auth",
        state: {
          ...(live as NonNullable<typeof live>),
          authEpoch: liveEpoch,
          memberRoleMap: (live?.memberRoleMap ?? []).filter((row) => row.memberId !== tenant.bot0),
          updatedAtMs: Date.now(),
        } as never,
      }),
    ).rejects.toThrow(/same authEpoch.*authorization content/);

    // Idempotent same-epoch auth write with identical content must succeed.
    await writeGroupOperatingState({
      fileStore,
      groupId,
      cfg,
      writeKind: "auth",
      state: {
        ...(live as NonNullable<typeof live>),
        authEpoch: liveEpoch,
        updatedAtMs: Date.now(),
      } as never,
    });

    // Legitimate non-auth business update still succeeds and keeps auth surface.
    await writeGroupOperatingState({
      fileStore,
      groupId,
      cfg,
      state: {
        ...(live as NonNullable<typeof live>),
        authEpoch: liveEpoch,
        activeContext: {
          ...(live as NonNullable<typeof live>).activeContext,
          summary: "legit-business-update",
        },
        updatedAtMs: Date.now(),
      } as never,
    });
    const finalOs = await readGroupOperatingState({ fileStore, groupId });
    expect(finalOs?.activeContext?.summary).toBe("legit-business-update");
    expect(readOperatingStateAuthEpoch(finalOs)).toBe(liveEpoch);
    expect(isMappedDeliveryIdentity(finalOs, tenant.bot0)).toBe(true);
    expect(
      operatingStateAuthContentEqual(liveSurface, readOperatingStateAuthSurface(finalOs)),
    ).toBe(true);
  });

  test("M3-AUTH-3e: custom cfg / fileStore / baseDir share one auth lock path", async () => {
    const { cfg } = await useIsolationRoot();
    const stores = createWorkspaceCollaborationStores(cfg);
    const groupId = tenant.groupId;
    await writeGroupOperatingState({
      fileStore: stores.fileStore,
      groupId,
      cfg,
      state: buildState(),
    });

    const viaCfg = resolveGroupOperatingStateAuthLockDir({ groupId, cfg });
    const viaStore = resolveGroupOperatingStateAuthLockDir({
      groupId,
      fileStore: stores.fileStore,
    });
    const viaBase = resolveGroupOperatingStateAuthLockDir({
      groupId,
      baseDir: stores.groupRootDir,
      fileStore: stores.fileStore,
    });
    const viaExplicit = resolveGroupOperatingStateAuthLockDir({
      groupId,
      groupRootDir: stores.groupRootDir,
    });
    const viaHelper = groupAuthLockDir({
      groupId,
      groupRootDir: stores.groupRootDir,
    });
    expect(viaCfg).toBe(viaHelper);
    expect(viaStore).toBe(viaHelper);
    expect(viaBase).toBe(viaHelper);
    expect(viaExplicit).toBe(viaHelper);

    // Same physical OS: holding the cfg-derived lock serializes a fileStore-only writer.
    let writerEntered = false;
    let releaseHold!: () => void;
    const holdGate = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    const holdP = withGroupAuthLock({
      groupId,
      groupRootDir: stores.groupRootDir,
      cfg,
      fn: async () => {
        await holdGate;
      },
    });
    // Give the holder time to acquire.
    await new Promise((r) => setTimeout(r, 30));
    const writeP = writeGroupOperatingState({
      fileStore: stores.fileStore,
      groupId,
      state: {
        ...buildState(),
        activeContext: {
          ...buildState().activeContext,
          summary: "lock-path-serialized",
        },
        updatedAtMs: Date.now(),
      },
      _testAfterLiveReadBarrier: async () => {
        writerEntered = true;
      },
    });
    await new Promise((r) => setTimeout(r, 80));
    expect(writerEntered).toBe(false);
    releaseHold();
    await holdP;
    await writeP;
    expect(writerEntered).toBe(true);
    const finalOs = await readGroupOperatingState({ fileStore: stores.fileStore, groupId });
    expect(finalOs?.activeContext?.summary).toBe("lock-path-serialized");
  });

  test("M3-AUTH-3f: conflicting explicit groupRootDir vs fileStore lock root is refused", async () => {
    const { cfg } = await useIsolationRoot();
    const stores = createWorkspaceCollaborationStores(cfg);
    const groupId = tenant.groupId;
    const otherRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-t54-other-root-"));
    tempDirs.push(otherRoot);

    expect(() =>
      resolveOperatingStateAuthLockRoot({
        groupRootDir: otherRoot,
        fileStore: stores.fileStore,
      }),
    ).toThrow(/auth lock root conflict/);

    await expect(
      writeGroupOperatingState({
        fileStore: stores.fileStore,
        groupId,
        groupRootDir: otherRoot,
        cfg,
        state: buildState(),
      }),
    ).rejects.toThrow(/auth lock root conflict/);

    // Boundary honesty: path.resolve does not unify symlink aliases. Passing the
    // symlink path and the real path as two explicit sources is a conflict when
    // their resolved strings differ — we do not claim same-inode ⇒ same lock.
    const linkRoot = path.join(otherRoot, "link-to-primary");
    try {
      await fs.symlink(stores.groupRootDir, linkRoot);
      const resolvedLink = path.resolve(linkRoot);
      const resolvedPrimary = path.resolve(stores.groupRootDir);
      if (resolvedLink !== resolvedPrimary) {
        expect(() =>
          resolveOperatingStateAuthLockRoot({
            groupRootDir: linkRoot,
            fileStore: stores.fileStore,
          }),
        ).toThrow(/auth lock root conflict/);
      }
    } catch (err) {
      // Some CI hosts disallow symlink; still covered by the string-conflict case above.
      if ((err as NodeJS.ErrnoException).code !== "EPERM") {
        throw err;
      }
    }
  });
});

describe("T54 M3 AUTH sync production entry (syncGroupOperatingState)", () => {
  function rosterMembers(overrides?: {
    omitBot0?: boolean;
    bot0Removed?: boolean;
    ownerUserId?: string;
    coordinatorBotId?: string;
    adminUserId?: string;
  }): CollaborationMember[] {
    const owner = overrides?.ownerUserId ?? tenant.owner;
    const admin = overrides?.adminUserId ?? tenant.admin;
    const coordinator = overrides?.coordinatorBotId ?? tenant.coordinator;
    const rows: CollaborationMember[] = [
      {
        memberId: owner,
        memberKind: "human",
        userId: owner,
        governanceRole: "owner",
        status: "active",
        updatedAtMs: 1,
      },
      {
        memberId: admin,
        memberKind: "human",
        userId: admin,
        governanceRole: "admin",
        status: "active",
        updatedAtMs: 1,
      },
      {
        memberId: tenant.approver,
        memberKind: "human",
        userId: tenant.approver,
        governanceRole: "member",
        status: "active",
        updatedAtMs: 1,
      },
      {
        memberId: coordinator,
        memberKind: "bot",
        agentId: coordinator,
        governanceRole: "member",
        status: "active",
        updatedAtMs: 1,
      },
    ];
    if (!overrides?.omitBot0) {
      rows.push({
        memberId: tenant.bot0,
        memberKind: "bot",
        agentId: tenant.bot0,
        governanceRole: "member",
        status: overrides?.bot0Removed ? "removed" : "active",
        updatedAtMs: 1,
      });
    }
    return rows;
  }

  async function seedSyncSources(params: {
    cfg: OpenBotConfig;
    taskId: string;
    members?: CollaborationMember[];
    ownerUserId?: string;
    coordinatorBotId?: string;
  }) {
    const stores = createWorkspaceCollaborationStores(params.cfg);
    const groupId = tenant.groupId;
    const ownerUserId = params.ownerUserId ?? tenant.owner;
    const coordinatorBotId = params.coordinatorBotId ?? tenant.coordinator;
    const members = params.members ?? rosterMembers();
    await stores.groupStorage.writeProfile({
      groupId,
      groupCode: groupId,
      displayName: "t54-sync-auth",
      ownerUserId,
      coordinatorBotId,
      createdAtMs: 1,
      updatedAtMs: 1,
    });
    await stores.groupStorage.writeMembers(groupId, members);
    const seeded = await seed({ cfg: params.cfg, taskId: params.taskId, itemId: "t54" });
    return { ...seeded, stores, ownerUserId, coordinatorBotId };
  }

  test("M3-AUTH-SYNC-1: remove member then sync — OS + auth check drop privilege", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-m3-auth-sync-1";
    const { fileStore, groupId, stores } = await seedSyncSources({ cfg, taskId });
    const os0 = await readGroupOperatingState({ fileStore, groupId });
    const auth0 = readOperatingStateAuthEpoch(os0);
    expect(isMappedDeliveryIdentity(os0, tenant.bot0)).toBe(true);

    // Production leave/update shape: member marked removed (or omitted). Use removed.
    await stores.groupStorage.writeMembers(groupId, rosterMembers({ bot0Removed: true }));

    const returned = await syncGroupOperatingState({
      fileStore: stores.fileStore,
      groupStorage: stores.groupStorage,
      metadataStorage: stores.metadataStorage,
      memoryStorage: stores.memoryStorage,
      learningStorage: stores.learningStorage,
      objectStorage: stores.objectStorage,
      groupId,
    });

    expect((returned.memberRoleMap ?? []).some((r) => r.memberId === tenant.bot0)).toBe(false);
    expect(isMappedDeliveryIdentity(returned, tenant.bot0)).toBe(false);
    expect(readOperatingStateAuthEpoch(returned)).toBe(auth0 + 1);

    const persisted = await readGroupOperatingState({ fileStore, groupId });
    expect((persisted?.memberRoleMap ?? []).some((r) => r.memberId === tenant.bot0)).toBe(false);
    expect(isMappedDeliveryIdentity(persisted, tenant.bot0)).toBe(false);
    expect(readOperatingStateAuthEpoch(persisted)).toBe(auth0 + 1);

    const recheck = await recheckCurrentDispatchAuthorization({
      groupId,
      taskId,
      targetActorIds: [tenant.bot0],
      cfg,
    });
    expect(recheck.ok).toBe(false);
    if (recheck.ok) {
      throw new Error("expected auth recheck failure");
    }
    expect(recheck.reason).toBe("auth_revoked");
  });

  test("M3-AUTH-SYNC-2: owner/coordinator change — return, persist, authEpoch agree", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-m3-auth-sync-2";
    const newOwner = `${tenant.tenantId}/emp-owner-sync2`;
    const newCoord = `${tenant.tenantId}/bot-coord-sync2`;
    const { fileStore, groupId, stores } = await seedSyncSources({ cfg, taskId });
    const auth0 = readOperatingStateAuthEpoch(
      await readGroupOperatingState({ fileStore, groupId }),
    );

    await stores.groupStorage.writeProfile({
      groupId,
      groupCode: groupId,
      displayName: "t54-sync-auth",
      ownerUserId: newOwner,
      coordinatorBotId: newCoord,
      createdAtMs: 1,
      updatedAtMs: Date.now(),
    });
    await stores.groupStorage.writeMembers(
      groupId,
      rosterMembers({ ownerUserId: newOwner, coordinatorBotId: newCoord }),
    );

    const returned = await syncGroupOperatingState({
      fileStore: stores.fileStore,
      groupStorage: stores.groupStorage,
      metadataStorage: stores.metadataStorage,
      memoryStorage: stores.memoryStorage,
      learningStorage: stores.learningStorage,
      objectStorage: stores.objectStorage,
      groupId,
    });

    expect(returned.governance.ownerUserId).toBe(newOwner);
    expect(returned.governance.coordinatorBotId).toBe(newCoord);
    expect(readOperatingStateAuthEpoch(returned)).toBe(auth0 + 1);

    const persisted = await readGroupOperatingState({ fileStore, groupId });
    expect(persisted?.governance?.ownerUserId).toBe(newOwner);
    expect(persisted?.governance?.coordinatorBotId).toBe(newCoord);
    expect(readOperatingStateAuthEpoch(persisted)).toBe(auth0 + 1);
    expect(
      operatingStateAuthContentEqual(
        readOperatingStateAuthSurface(returned),
        readOperatingStateAuthSurface(persisted),
      ),
    ).toBe(true);
    expect(isMappedDeliveryIdentity(persisted, newCoord)).toBe(true);
  });

  test("M3-AUTH-SYNC-3: legal auth sync vs concurrent stale business write", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-m3-auth-sync-3";
    const { fileStore, groupId, stores } = await seedSyncSources({ cfg, taskId });
    const os0 = await readGroupOperatingState({ fileStore, groupId });
    const auth0 = readOperatingStateAuthEpoch(os0);
    const staleBusiness = {
      ...(os0 as NonNullable<typeof os0>),
      activeContext: {
        ...(os0 as NonNullable<typeof os0>).activeContext,
        summary: "stale-biz-during-sync-auth",
      },
      updatedAtMs: Date.now(),
    };

    await stores.groupStorage.writeMembers(groupId, rosterMembers({ omitBot0: true }));

    // Concurrent: production sync auth update + stale business snapshot that still lists bot0.
    const [returned] = await Promise.all([
      syncGroupOperatingState({
        fileStore: stores.fileStore,
        groupStorage: stores.groupStorage,
        metadataStorage: stores.metadataStorage,
        memoryStorage: stores.memoryStorage,
        learningStorage: stores.learningStorage,
        objectStorage: stores.objectStorage,
        groupId,
      }),
      writeGroupOperatingState({
        fileStore,
        groupId,
        cfg,
        state: staleBusiness as typeof staleBusiness & { authEpoch?: number },
      }),
    ]);

    let finalOs = await readGroupOperatingState({ fileStore, groupId });
    expect((returned.memberRoleMap ?? []).some((r) => r.memberId === tenant.bot0)).toBe(false);
    expect((finalOs?.memberRoleMap ?? []).some((r) => r.memberId === tenant.bot0)).toBe(false);
    expect(isMappedDeliveryIdentity(finalOs, tenant.bot0)).toBe(false);
    expect(readOperatingStateAuthEpoch(finalOs)).toBeGreaterThan(auth0);

    // Sequenced follow-up: after auth sync landed, a late stale business write must keep
    // business fields while refusing to roll back the new auth surface.
    await writeGroupOperatingState({
      fileStore,
      groupId,
      cfg,
      state: {
        ...staleBusiness,
        activeContext: {
          ...staleBusiness.activeContext,
          summary: "stale-biz-after-sync-auth",
        },
        updatedAtMs: Date.now(),
      } as typeof staleBusiness & { authEpoch?: number },
    });
    finalOs = await readGroupOperatingState({ fileStore, groupId });
    expect(finalOs?.activeContext?.summary).toBe("stale-biz-after-sync-auth");
    expect((finalOs?.memberRoleMap ?? []).some((r) => r.memberId === tenant.bot0)).toBe(false);
    expect(isMappedDeliveryIdentity(finalOs, tenant.bot0)).toBe(false);
    expect(readOperatingStateAuthEpoch(finalOs)).toBeGreaterThan(auth0);
  });

  test("M3-AUTH-SYNC-4: sync return value matches persisted OS", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-m3-auth-sync-4";
    const { fileStore, groupId, stores } = await seedSyncSources({ cfg, taskId });

    await stores.groupStorage.writeMembers(groupId, rosterMembers({ omitBot0: true }));
    const returned = await syncGroupOperatingState({
      fileStore: stores.fileStore,
      groupStorage: stores.groupStorage,
      metadataStorage: stores.metadataStorage,
      memoryStorage: stores.memoryStorage,
      learningStorage: stores.learningStorage,
      objectStorage: stores.objectStorage,
      groupId,
    });
    const persisted = await readGroupOperatingState({ fileStore, groupId });
    expect(persisted).not.toBeNull();
    expect(readOperatingStateAuthEpoch(returned)).toBe(readOperatingStateAuthEpoch(persisted));
    expect(
      operatingStateAuthContentEqual(
        readOperatingStateAuthSurface(returned),
        readOperatingStateAuthSurface(persisted),
      ),
    ).toBe(true);
    expect(returned.activeContext?.currentOperatingPhase).toBe(
      persisted?.activeContext?.currentOperatingPhase,
    );
    expect(returned.governance.ownerUserId).toBe(persisted?.governance?.ownerUserId);
    expect((returned.memberRoleMap ?? []).map((r) => r.memberId).toSorted()).toEqual(
      (persisted?.memberRoleMap ?? []).map((r) => r.memberId).toSorted(),
    );

    // commitSynced helper itself returns the persisted merge result.
    const again = await commitSyncedGroupOperatingState({
      fileStore,
      groupId,
      desired: {
        ...(persisted as NonNullable<typeof persisted>),
        activeContext: {
          ...(persisted as NonNullable<typeof persisted>).activeContext,
          summary: "sync4-business-only",
        },
        updatedAtMs: Date.now(),
      },
    });
    const after = await readGroupOperatingState({ fileStore, groupId });
    expect(again.activeContext?.summary).toBe("sync4-business-only");
    expect(after?.activeContext?.summary).toBe("sync4-business-only");
    expect(readOperatingStateAuthEpoch(again)).toBe(readOperatingStateAuthEpoch(after));
    expect(
      operatingStateAuthContentEqual(
        readOperatingStateAuthSurface(again),
        readOperatingStateAuthSurface(after),
      ),
    ).toBe(true);
  });
});

describe("W1 AUTH production entry close (roster CAS + stale sync)", () => {
  function rosterMembers(overrides?: {
    omitBot0?: boolean;
    bot0Removed?: boolean;
    ownerUserId?: string;
    coordinatorBotId?: string;
    adminUserId?: string;
  }): CollaborationMember[] {
    const owner = overrides?.ownerUserId ?? tenant.owner;
    const admin = overrides?.adminUserId ?? tenant.admin;
    const coordinator = overrides?.coordinatorBotId ?? tenant.coordinator;
    const rows: CollaborationMember[] = [
      {
        memberId: owner,
        memberKind: "human",
        userId: owner,
        governanceRole: "owner",
        status: "active",
        updatedAtMs: 1,
      },
      {
        memberId: admin,
        memberKind: "human",
        userId: admin,
        governanceRole: "admin",
        status: "active",
        updatedAtMs: 1,
      },
      {
        memberId: tenant.approver,
        memberKind: "human",
        userId: tenant.approver,
        governanceRole: "member",
        status: "active",
        updatedAtMs: 1,
      },
      {
        memberId: coordinator,
        memberKind: "bot",
        agentId: coordinator,
        governanceRole: "member",
        status: "active",
        updatedAtMs: 1,
      },
    ];
    if (!overrides?.omitBot0) {
      rows.push({
        memberId: tenant.bot0,
        memberKind: "bot",
        agentId: tenant.bot0,
        governanceRole: "member",
        status: overrides?.bot0Removed ? "removed" : "active",
        updatedAtMs: 1,
      });
    }
    return rows;
  }

  async function seedRoster(params: { cfg: OpenBotConfig; taskId: string }) {
    const stores = createWorkspaceCollaborationStores(params.cfg);
    const groupId = tenant.groupId;
    await stores.groupStorage.writeProfile({
      groupId,
      groupCode: groupId,
      displayName: "w1-auth-entries",
      ownerUserId: tenant.owner,
      coordinatorBotId: tenant.coordinator,
      createdAtMs: 1,
      updatedAtMs: 1,
    });
    await stores.groupStorage.writeMembers(groupId, rosterMembers());
    const seeded = await seed({ cfg: params.cfg, taskId: params.taskId, itemId: "w1" });
    return { ...seeded, stores };
  }

  test("W1-ENTRY-1: stale lock-external sync draft cannot re-grant after roster revoke", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-w1-entry-1";
    const { fileStore, groupId, stores } = await seedRoster({ cfg, taskId });
    const os0 = await readGroupOperatingState({ fileStore, groupId });
    const auth0 = readOperatingStateAuthEpoch(os0);
    const staleDesired = {
      ...(os0 as NonNullable<typeof os0>),
      updatedAtMs: Date.now(),
    };

    await stores.groupStorage.writeMembers(groupId, rosterMembers({ bot0Removed: true }));
    const revoked = await applyRosterAuthChangeSharedCas({
      groupId,
      cfg,
      profile: await stores.groupStorage.readProfile(groupId),
      members: await stores.groupStorage.readMembers(groupId),
      invalidateTaskIds: [taskId],
    });
    expect(revoked.authEpoch).toBe(auth0 + 1);
    expect(isMappedDeliveryIdentity(revoked.operatingState, tenant.bot0)).toBe(false);

    // Stale draft still lists bot0, but groupStorage reproject under lock must win.
    const returned = await commitSyncedGroupOperatingState({
      fileStore,
      groupId,
      desired: staleDesired,
      groupStorage: stores.groupStorage,
      cfg,
    });
    expect(isMappedDeliveryIdentity(returned, tenant.bot0)).toBe(false);
    expect((returned.memberRoleMap ?? []).some((r) => r.memberId === tenant.bot0)).toBe(false);
    expect(readOperatingStateAuthEpoch(returned)).toBeGreaterThanOrEqual(revoked.authEpoch);

    const persisted = await readGroupOperatingState({ fileStore, groupId });
    expect(isMappedDeliveryIdentity(persisted, tenant.bot0)).toBe(false);
    expect(readOperatingStateAuthEpoch(persisted)).toBe(readOperatingStateAuthEpoch(returned));

    const recheck = await recheckCurrentDispatchAuthorization({
      groupId,
      taskId,
      targetActorIds: [tenant.bot0],
      cfg,
    });
    expect(recheck.ok).toBe(false);
    if (recheck.ok) {
      throw new Error("expected auth recheck failure");
    }
    expect(recheck.reason).toBe("auth_revoked");
  });

  test("W1-ENTRY-2: production leave entry drops actor mapping + bumps authEpoch", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-w1-entry-2";
    const { fileStore, groupId, stores } = await seedRoster({ cfg, taskId });
    const auth0 = readOperatingStateAuthEpoch(
      await readGroupOperatingState({ fileStore, groupId }),
    );
    expect(
      isMappedDeliveryIdentity(
        await readGroupOperatingState({ fileStore, groupId }),
        tenant.approver,
      ),
    ).toBe(true);

    const left = await leaveGatewayCollaborationSpace({
      groupId,
      actor: tenant.approver,
    });
    expect(left.left).toBe(true);
    expect(
      (left.space.operatingState?.memberRoleMap ?? []).some((r) => r.memberId === tenant.approver),
    ).toBe(false);

    const persisted = await readGroupOperatingState({ fileStore, groupId });
    expect(isMappedDeliveryIdentity(persisted, tenant.approver)).toBe(false);
    expect(readOperatingStateAuthEpoch(persisted)).toBeGreaterThan(auth0);

    const members = await stores.groupStorage.readMembers(groupId);
    const approver = members.find((m) => m.memberId === tenant.approver);
    expect(approver?.status).toBe("removed");
  });

  test("W1-ENTRY-3: direct business OS write cannot restore revoked member after roster CAS", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-w1-entry-3";
    const { fileStore, groupId, stores } = await seedRoster({ cfg, taskId });
    const os0 = await readGroupOperatingState({ fileStore, groupId });
    const stale = {
      ...(os0 as NonNullable<typeof os0>),
      activeContext: {
        ...(os0 as NonNullable<typeof os0>).activeContext,
        summary: "w1-entry-3-stale-biz",
      },
      updatedAtMs: Date.now(),
    };

    await stores.groupStorage.writeMembers(groupId, rosterMembers({ omitBot0: true }));
    const revoked = await applyRosterAuthChangeSharedCas({
      groupId,
      cfg,
      profile: await stores.groupStorage.readProfile(groupId),
      members: await stores.groupStorage.readMembers(groupId),
    });
    expect(isMappedDeliveryIdentity(revoked.operatingState, tenant.bot0)).toBe(false);

    await writeGroupOperatingState({
      fileStore,
      groupId,
      cfg,
      state: stale,
      writeKind: "business",
    });
    const finalOs = await readGroupOperatingState({ fileStore, groupId });
    expect(finalOs?.activeContext?.summary).toBe("w1-entry-3-stale-biz");
    expect(isMappedDeliveryIdentity(finalOs, tenant.bot0)).toBe(false);
    expect(readOperatingStateAuthEpoch(finalOs)).toBe(revoked.authEpoch);
  });

  test("W1-ENTRY-4: concurrent legal owner sync vs stale business — auth kept, business retained", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-w1-entry-4";
    const newOwner = `${tenant.tenantId}/emp-owner-w1`;
    const { fileStore, groupId, stores } = await seedRoster({ cfg, taskId });
    const os0 = await readGroupOperatingState({ fileStore, groupId });
    const auth0 = readOperatingStateAuthEpoch(os0);
    const staleBiz = {
      ...(os0 as NonNullable<typeof os0>),
      activeContext: {
        ...(os0 as NonNullable<typeof os0>).activeContext,
        summary: "w1-entry-4-stale",
      },
      updatedAtMs: Date.now(),
    };

    await stores.groupStorage.writeProfile({
      groupId,
      groupCode: groupId,
      displayName: "w1-auth-entries",
      ownerUserId: newOwner,
      coordinatorBotId: tenant.coordinator,
      createdAtMs: 1,
      updatedAtMs: Date.now(),
    });
    await stores.groupStorage.writeMembers(groupId, rosterMembers({ ownerUserId: newOwner }));
    await applyRosterAuthChangeSharedCas({
      groupId,
      cfg,
      profile: await stores.groupStorage.readProfile(groupId),
      members: await stores.groupStorage.readMembers(groupId),
    });

    const [synced] = await Promise.all([
      syncGroupOperatingState({
        fileStore: stores.fileStore,
        groupStorage: stores.groupStorage,
        metadataStorage: stores.metadataStorage,
        memoryStorage: stores.memoryStorage,
        learningStorage: stores.learningStorage,
        objectStorage: stores.objectStorage,
        groupId,
      }),
      writeGroupOperatingState({
        fileStore,
        groupId,
        cfg,
        state: staleBiz,
        writeKind: "business",
      }),
    ]);

    expect(synced.governance.ownerUserId).toBe(newOwner);
    const finalOs = await readGroupOperatingState({ fileStore, groupId });
    expect(finalOs?.governance?.ownerUserId).toBe(newOwner);
    expect(readOperatingStateAuthEpoch(finalOs)).toBeGreaterThan(auth0);
    // Late business write after auth may land summary; either way auth must hold.
    expect(isMappedDeliveryIdentity(finalOs, tenant.bot0)).toBe(true);
  });
});

describe("W2 M1 trusted gateway-session identity wiring", () => {
  test("W2-M1-01: gateway session mint → release ok; conflicting actorId refused; revoke refuses; brand forge still refused", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-w2-m1";
    const { authority, groupId, fileStore } = await seed({ cfg, taskId, itemId: "w2m1" });
    const claimed = await claimWakeOpRunning({
      authority,
      cfg,
      keyInput: {
        groupId,
        source: "nudge",
        fromAgentId: "system:group_task_heartbeat",
        toAgentIds: [tenant.bot0],
        taskId,
        itemId: "w2m1-u",
      },
    });
    await markWakeOpUnknown({ authority, opKey: claimed.opKey, cfg });
    const attemptId = await currentAttemptId(authority, claimed.opKey);

    // Suspended / missing platform auth → refuse mint
    const suspended = mintWakeOpTrustedGatewaySessionFromPlatformAuth({
      userId: tenant.owner,
      userStatus: "suspended",
      sessionKind: "member",
      sessionId: "sess-suspended",
    });
    expect(suspended.ok).toBe(false);

    const platformMint = mintWakeOpTrustedGatewaySessionFromPlatformAuth({
      userId: tenant.owner,
      userStatus: "active",
      sessionKind: "member",
      sessionId: "sess-owner-1",
    });
    expect(platformMint.ok).toBe(true);
    if (!platformMint.ok) {
      throw new Error("platformMint");
    }
    expect(platformMint.session.mintSource).toBe("platform_auth_context");
    expect(platformMint.session.authenticatedUserId).toBe(tenant.owner);

    // Symbol.for forged session handle rejected
    const forgedSession = {
      authenticatedUserId: tenant.owner,
      sessionStatus: "active" as const,
      sessionKind: "member",
      sessionId: "x",
      mintSource: "platform_auth_context" as const,
      [Symbol.for("openbot.WakeOpTrustedGatewaySession")]: true,
    };
    const forgedExec = await createGatewaySessionRecoveryExecContext({
      session: forgedSession as never,
      groupId,
      taskId,
      action: "release_for_retry",
      cfg,
    });
    expect(forgedExec.ok).toBe(false);
    expect((forgedExec as { reason: string }).reason).toBe("operator_identity_not_trusted");

    // Conflicting bare actorId cannot override session identity
    const conflict = await createGatewaySessionRecoveryExecContext({
      session: platformMint.session,
      groupId,
      taskId,
      action: "release_for_retry",
      actorId: tenant.admin,
      cfg,
    });
    expect(conflict.ok).toBe(false);
    expect((conflict as { reason: string }).reason).toBe("operator_identity_not_trusted");

    const exec = await createGatewaySessionRecoveryExecContext({
      session: platformMint.session,
      groupId,
      taskId,
      action: "release_for_retry",
      cfg,
    });
    expect(exec.ok).toBe(true);
    if (!exec.ok) {
      throw new Error("exec");
    }
    expect(exec.exec.identityProvenance).toBe("gateway_session");
    expect(exec.exec.identityMode).toBe(WAKE_OP_RECOVERY_IDENTITY_MODE_GATEWAY);
    expect(exec.exec.actorId).toBe(tenant.owner);

    const ver = await producePlatformNoneVerification({
      authority,
      cfg,
      groupId,
      taskId,
      opKey: claimed.opKey,
      attemptId,
      probe: async () => ({ source: "probe", outcome: "none" }),
    });
    expect(ver.ok).toBe(true);
    if (!ver.ok) {
      throw new Error("ver");
    }

    // Revoke owner → gateway exec refuses; status unchanged
    await writeAuthOsForTest({
      fileStore,
      groupId,
      cfg,
      state: buildState({ revokeOwner: true }),
    });
    const revokedExec = await createGatewaySessionRecoveryExecContext({
      session: platformMint.session,
      groupId,
      taskId,
      action: "release_for_retry",
      cfg,
    });
    expect(revokedExec.ok).toBe(false);
    expect((revokedExec as { reason: string }).reason).toBe("release_forbidden");
    expect((await readWakeOpRecord({ authority, opKey: claimed.opKey }))?.status).toBe("unknown");

    // Restore owner → gateway session release succeeds
    await writeAuthOsForTest({ fileStore, groupId, cfg, state: buildState() });
    const okExec = await createGatewaySessionRecoveryExecContext({
      session: platformMint.session,
      groupId,
      taskId,
      action: "release_for_retry",
      cfg,
    });
    expect(okExec.ok).toBe(true);
    if (!okExec.ok) {
      throw new Error("okExec");
    }
    const released = await releaseWakeOpForRetryAuthorized({
      authority,
      groupId,
      taskId,
      opKey: claimed.opKey,
      exec: okExec.exec,
      verificationId: ver.record.verificationId,
      cfg,
    });
    expect(released.ok).toBe(true);
    if (!released.ok) {
      throw new Error("released");
    }
    expect(released.record.status).toBe("failed");
    expect(released.record.releasedBy).toBe(tenant.owner);

    // Internal-library / test harness cannot claim gateway_session mode
    const testSess = mintWakeOpTrustedGatewaySessionForTests({ userId: tenant.owner });
    expect(testSess.ok).toBe(true);
    if (!testSess.ok) {
      throw new Error("testSess");
    }
    expect(testSess.session.mintSource).toBe("test_only");
    const lib = await createInternalLibraryRecoveryExecContext({
      groupId,
      taskId,
      actorId: tenant.owner,
      action: "release_for_retry",
      cfg,
    });
    expect(lib.ok).toBe(true);
    if (!lib.ok) {
      throw new Error("lib");
    }
    expect(lib.exec.identityMode).toBe(WAKE_OP_RECOVERY_IDENTITY_MODE_TEST_ONLY);
    expect(lib.exec.identityProvenance).toBe("caller_asserted_internal");
  });
});

describe("W3 M2 verify capability boundary", () => {
  test("W3-M2-01: declared durable adapter verifies nudge; undeclared keeps unknown; no auto side-effect; human still non-auto", async () => {
    const { cfg } = await useIsolationRoot();
    const taskId = "task-w3-m2";
    const { authority, groupId } = await seed({ cfg, taskId, itemId: "w3m2" });

    expect(WAKE_OP_DECLARED_VERIFY_CAPABLE_SOURCES).toEqual(["nudge"]);
    expect(isWakeOpDeclaredVerifyCapableSource("nudge")).toBe(true);
    expect(isWakeOpDeclaredVerifyCapableSource("self_advance")).toBe(false);
    expect(isWakeOpDeclaredVerifyCapableSource("escalate")).toBe(false);

    // Undeclared source (self_advance) → capability unavailable; status stays unknown
    const undeclaredClaim = await claimWakeOpRunning({
      authority,
      cfg,
      keyInput: {
        groupId,
        source: "self_advance",
        fromAgentId: "system:self_advance",
        toAgentIds: [tenant.bot0],
        taskId,
        itemId: "w3m2-sa",
      },
    });
    await markWakeOpUnknown({ authority, opKey: undeclaredClaim.opKey, cfg });
    const undeclared = await produceDeclaredPlatformNoneVerificationAtRoot({
      authority,
      opKey: undeclaredClaim.opKey,
      cfg,
    });
    expect(undeclared.ok).toBe(false);
    expect((undeclared as { reason: string }).reason).toBe("verify_capability_unavailable");
    expect((await readWakeOpRecord({ authority, opKey: undeclaredClaim.opKey }))?.status).toBe(
      "unknown",
    );
    // No automatic release / side-effect retry when capability unavailable
    const autoRefuse = await releaseWakeOpForRetryAuthorized({
      authority,
      groupId,
      taskId,
      opKey: undeclaredClaim.opKey,
      actorId: tenant.owner,
      verificationId: "caller-invented",
      cfg,
    });
    expect(autoRefuse.ok).toBe(false);
    expect((await readWakeOpRecord({ authority, opKey: undeclaredClaim.opKey }))?.status).toBe(
      "unknown",
    );

    // Declared source (nudge) without durable receipt → unavailable
    const nudgeClaim = await claimWakeOpRunning({
      authority,
      cfg,
      keyInput: {
        groupId,
        source: "nudge",
        fromAgentId: "system:group_task_heartbeat",
        toAgentIds: [tenant.bot0],
        taskId,
        itemId: "w3m2-nudge",
      },
    });
    await markWakeOpUnknown({ authority, opKey: nudgeClaim.opKey, cfg });
    const attemptId = await currentAttemptId(authority, nudgeClaim.opKey);
    const missingReceipt = await produceDeclaredPlatformNoneVerificationAtRoot({
      authority,
      opKey: nudgeClaim.opKey,
      cfg,
    });
    expect(missingReceipt.ok).toBe(false);
    expect((missingReceipt as { reason: string }).reason).toBe("verify_capability_unavailable");
    expect((await readWakeOpRecord({ authority, opKey: nudgeClaim.opKey }))?.status).toBe(
      "unknown",
    );

    // Stale attempt durable receipt → unavailable
    await writeWakeOpDurableEffectReceipt({
      authority,
      cfg,
      opKey: nudgeClaim.opKey,
      attemptId: "stale-attempt-other",
      operationType: "nudge",
      outcome: "none",
      source: "durable:nudge:stale",
    });
    const stale = await produceDeclaredPlatformNoneVerificationAtRoot({
      authority,
      opKey: nudgeClaim.opKey,
      cfg,
    });
    expect(stale.ok).toBe(false);
    expect((stale as { reason: string }).reason).toBe("verify_capability_unavailable");

    // Correct durable receipt → declared adapter proves none
    await writeWakeOpDurableEffectReceipt({
      authority,
      cfg,
      opKey: nudgeClaim.opKey,
      attemptId,
      operationType: "nudge",
      outcome: "none",
      source: "durable:nudge:ok",
    });
    const declaredReg = buildDeclaredWakeOpVerifyAdapterRegistry();
    expect(declaredReg.map((a) => a.operationType)).toEqual(["nudge"]);
    // Fixture adapter ≠ declared production registry (different construction)
    const fixtureReg = [
      createFixtureReceiptNoneAdapter({
        operationType: "nudge",
        receiptFilePath: "/tmp/not-declared-production.json",
      }),
    ];
    expect(declaredReg[0]).not.toBe(fixtureReg[0]);

    const okVer = await produceDeclaredPlatformNoneVerificationAtRoot({
      authority,
      opKey: nudgeClaim.opKey,
      cfg,
    });
    expect(okVer.ok).toBe(true);
    if (!okVer.ok) {
      throw new Error("okVer");
    }
    expect(okVer.record.platformAutoProved).toBe(true);
    expect(okVer.record.attemptId).toBe(attemptId);
    expect(okVer.record.source).toBe("durable:nudge:ok");

    const sessionMint = mintWakeOpTrustedGatewaySessionForTests({ userId: tenant.owner });
    expect(sessionMint.ok).toBe(true);
    if (!sessionMint.ok) {
      throw new Error("sessionMint");
    }
    const exec = await createGatewaySessionRecoveryExecContext({
      session: sessionMint.session,
      groupId,
      taskId,
      action: "release_for_retry",
      cfg,
    });
    expect(exec.ok).toBe(true);
    if (!exec.ok) {
      throw new Error("exec");
    }
    const released = await releaseWakeOpForRetryAuthorized({
      authority,
      groupId,
      taskId,
      opKey: nudgeClaim.opKey,
      exec: exec.exec,
      verificationId: okVer.record.verificationId,
      cfg,
    });
    expect(released.ok).toBe(true);

    // Human attestation path still platformAutoProved===false (separate claim)
    const humanClaim = await claimWakeOpRunning({
      authority,
      cfg,
      keyInput: {
        groupId,
        source: "nudge",
        fromAgentId: "system:group_task_heartbeat",
        toAgentIds: [tenant.bot0],
        taskId,
        itemId: "w3m2-human",
      },
    });
    await markWakeOpUnknown({ authority, opKey: humanClaim.opKey, cfg });
    const humanAttempt = await currentAttemptId(authority, humanClaim.opKey);
    const subject = mintWakeOpRecoverySubject({
      actorId: tenant.owner,
      action: "release_for_retry",
      groupId,
      taskId,
      taskApproverIds: [],
    });
    const human = await produceHumanNoneAttestation({
      authority,
      cfg,
      subject,
      groupId,
      taskId,
      opKey: humanClaim.opKey,
      attemptId: humanAttempt,
      basis: "manual review of channel",
      scope: `op:${humanClaim.opKey}`,
    });
    expect(human.ok).toBe(true);
    if (!human.ok) {
      throw new Error("human");
    }
    expect(human.record.platformAutoProved).toBe(false);
    expect(human.record.kind).toBe("human_attestation");
  });
});
