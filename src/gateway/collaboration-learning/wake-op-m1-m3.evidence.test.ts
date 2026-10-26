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
import { resolveGroupPolicyInput } from "../collaboration-dispatch/resolve-effective-policy.js";
import {
  createRoundPolicySnapshot,
  generatePolicySnapshotId,
} from "../collaboration-dispatch/round-policy-snapshot.js";
import { createRuntimeAuthority } from "../collaboration-dispatch/runtime-authority.js";
import { createFixtureReceiptNoneAdapter } from "../collaboration-dispatch/wake-op-effect-verify.js";
import {
  claimWakeOpRunning,
  markWakeOpCompleted,
  markWakeOpUnknown,
  mintWakeOpRecoverySubject,
  produceHumanNoneAttestation,
  producePlatformNoneVerification,
  readWakeOpRecord,
  releaseWakeOpForRetry,
} from "../collaboration-dispatch/wake-op-ledger.js";
import { consumeWakeForRoundDispatch } from "../collaboration-dispatch/wake-round-dispatch.js";
import { resolveSecurityProfile } from "../security-profile.js";
import { createWorkspaceCollaborationStores, writeGroupOperatingState } from "./shared.js";
import { resolveCollaborationGroupTenantId } from "./shared.js";
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
