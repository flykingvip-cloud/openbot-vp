/**
 * T34 C1/C2 evidence: unknown wake-op release/confirm authorization + effect proof.
 *
 * C1: trusted runtime operator + distinct release/confirm Gates (≠ canRequestTaskStop).
 * C2: externalEffectVerified:"none" bound to verifiable check; declaration alone ≠ retryable.
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
import { readOperatingStateAuthEpoch } from "../collaboration-dispatch/task-control-cas.js";
import {
  canConfirmWakeOpCompleted as canConfirmFromGate,
  canPerformWakeOpRecovery,
  canReleaseWakeOpForRetry as canReleaseFromGate,
  claimWakeOpRunning,
  confirmWakeOpCompleted,
  markWakeOpCompleted,
  markWakeOpUnknown,
  mintWakeOpRecoverySubject,
  producePlatformNoneVerification,
  readWakeOpRecord,
  releaseWakeOpForRetry,
} from "../collaboration-dispatch/wake-op-ledger.js";
import { resolveSecurityProfile } from "../security-profile.js";
import {
  createWorkspaceCollaborationStores,
  readGroupOperatingState,
  writeGroupOperatingState,
} from "./shared.js";
import { resolveCollaborationGroupTenantId } from "./shared.js";
import { canRequestTaskStop } from "./task-stop-entry.js";
import { resolveAuthorityTenantForEntry } from "./trusted-tenant.js";
import {
  confirmWakeOpCompletedAuthorized,
  releaseWakeOpForRetryAuthorized,
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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-c1c2-"));
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
  tenantId: "tenant-c1c2-a",
  groupId: "grp-c1c2-a",
  owner: "tenant-c1c2-a/emp-owner",
  admin: "tenant-c1c2-a/emp-admin",
  member: "tenant-c1c2-a/emp-member",
  approver: "tenant-c1c2-a/emp-approver",
  coordinator: "tenant-c1c2-a/bot-coord",
  crossOwner: "tenant-c1c2-b/emp-owner",
};

function buildState(params?: { revokeOwner?: boolean }) {
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
      memberId: tenant.member,
      memberKind: "human",
      governanceRole: "member",
      collaborationRole: null,
      status: "active",
    },
    {
      memberId: tenant.approver,
      memberKind: "human",
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

async function seedUnknownOp(params: { cfg: OpenBotConfig; itemId: string; withRoundId?: string }) {
  const groupId = tenant.groupId;
  const taskId = "task-c1c2";
  const { fileStore, objectStorage } = createWorkspaceCollaborationStores(params.cfg);
  const state = buildState();
  await writeGroupOperatingState({ fileStore, groupId, state });
  await objectStorage.writeObject(groupId, "task", taskId, {
    taskId,
    groupId,
    title: "c1c2",
    status: "in_progress",
    ownerMemberId: tenant.coordinator,
    assignedMemberIds: [tenant.coordinator],
    responsibility: {
      owner: tenant.coordinator,
      executors: [tenant.coordinator],
      reviewers: [],
      approvers: [tenant.approver],
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
    episodeId: episodeIdForClientRun(`task-wake:${groupId}:${taskId}`),
    tenant: resolveAuthorityTenantForEntry({
      preferred: null,
      groupTenantId: resolveCollaborationGroupTenantId(groupId),
    }),
    groupId,
    profile: resolveSecurityProfile(params.cfg).profile,
    cfg: params.cfg,
  });

  const keyInput = {
    groupId,
    fromAgentId: "system:group_task_heartbeat",
    toAgentIds: [tenant.coordinator],
    source: "self_advance" as const,
    taskId,
    itemId: params.itemId,
  };
  const claimed = await claimWakeOpRunning({ authority, keyInput, cfg: params.cfg });
  expect(claimed.action).toBe("proceed");
  const opKey = claimed.opKey;
  if (params.withRoundId) {
    await markWakeOpCompleted({
      authority,
      opKey,
      roundId: params.withRoundId,
      cfg: params.cfg,
    });
    await markWakeOpUnknown({
      authority,
      opKey,
      cfg: params.cfg,
      detail: "receipt_gap_model",
    });
  } else {
    await markWakeOpUnknown({
      authority,
      opKey,
      cfg: params.cfg,
      detail: "crash_mid_dispatch",
    });
  }
  const record = await readWakeOpRecord({ authority, opKey });
  expect(record?.status).toBe("unknown");
  return { authority, opKey, state, taskId, groupId, objectStorage, approvers: [tenant.approver] };
}

async function platformVerifyNone(params: {
  authority: import("../collaboration-dispatch/runtime-authority.js").RuntimeAuthority;
  cfg: OpenBotConfig;
  groupId: string;
  taskId: string;
  opKey: string;
  checkedAtMs?: number;
  source?: string;
  attemptId?: string;
}) {
  const nowMs = params.checkedAtMs ?? Date.now();
  const opRec = await readWakeOpRecord({ authority: params.authority, opKey: params.opKey });
  const attemptId =
    opRec?.executionAttemptId?.trim() || params.attemptId?.trim() || "missing-attempt";
  const produced = await producePlatformNoneVerification({
    authority: params.authority,
    cfg: params.cfg,
    groupId: params.groupId,
    taskId: params.taskId,
    opKey: params.opKey,
    attemptId,
    nowMs,
    probe: async () => ({ source: params.source ?? "side_effect_probe", outcome: "none" as const }),
  });
  if (!produced.ok) {
    throw new Error(`verify failed: ${produced.reason}`);
  }
  return produced.record;
}

function mintReleaseSubject(actorId: string, groupId: string, taskId: string) {
  return mintWakeOpRecoverySubject({
    actorId,
    action: "release_for_retry",
    groupId,
    taskId,
    taskApproverIds: [tenant.approver],
  });
}

function mintConfirmSubject(
  actorId: string,
  groupId: string,
  taskId: string,
  approvers?: string[],
) {
  return mintWakeOpRecoverySubject({
    actorId,
    action: "confirm_completed",
    groupId,
    taskId,
    taskApproverIds: approvers ?? [tenant.approver],
  });
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

describe("T34 C1/C2 wake-op release/confirm", () => {
  test("C1-PERM-DISTINCTION-01: stop ≠ release ≠ confirm", () => {
    const state = buildState();
    // Owner: stop + release; not confirm unless approver (owner is NOT in approvers here).
    expect(canRequestTaskStop({ actorId: tenant.owner, operatingState: state })).toBe(true);
    expect(canReleaseFromGate({ actorId: tenant.owner, operatingState: state })).toBe(true);
    expect(
      canConfirmFromGate({
        actorId: tenant.owner,
        operatingState: state,
        taskApproverIds: [tenant.approver],
      }),
    ).toBe(false);

    // Admin: stop yes; release no; confirm no.
    expect(canRequestTaskStop({ actorId: tenant.admin, operatingState: state })).toBe(true);
    expect(canReleaseFromGate({ actorId: tenant.admin, operatingState: state })).toBe(false);
    expect(
      canConfirmFromGate({
        actorId: tenant.admin,
        operatingState: state,
        taskApproverIds: [tenant.approver],
      }),
    ).toBe(false);

    // Coordinator: stop yes; release no; confirm no.
    expect(canRequestTaskStop({ actorId: tenant.coordinator, operatingState: state })).toBe(true);
    expect(canReleaseFromGate({ actorId: tenant.coordinator, operatingState: state })).toBe(false);

    // Approver member: stop no; release no; confirm yes.
    expect(canRequestTaskStop({ actorId: tenant.approver, operatingState: state })).toBe(false);
    expect(canReleaseFromGate({ actorId: tenant.approver, operatingState: state })).toBe(false);
    expect(
      canConfirmFromGate({
        actorId: tenant.approver,
        operatingState: state,
        taskApproverIds: [tenant.approver],
      }),
    ).toBe(true);

    expect(
      canPerformWakeOpRecovery({
        actorId: tenant.owner,
        action: "release_for_retry",
        operatingState: state,
      }),
    ).toBe(true);
    expect(
      canPerformWakeOpRecovery({
        actorId: tenant.approver,
        action: "confirm_completed",
        operatingState: state,
        taskApproverIds: [tenant.approver],
      }),
    ).toBe(true);
  });

  test("C1-RELEASE-AUTH-01: forged / cross-tenant / unauthorized / revoked reject; state unchanged; owner ok", async () => {
    const { cfg } = await useIsolationRoot();
    const ctx = await seedUnknownOp({ cfg, itemId: "c1-release-auth" });
    const before = await readWakeOpRecord({ authority: ctx.authority, opKey: ctx.opKey });
    expect(before?.status).toBe("unknown");

    // M1: self-constructed identitySource / plain operator object cannot unlock.
    const forgedDeclared = await releaseWakeOpForRetry({
      authority: ctx.authority,
      opKey: ctx.opKey,
      cfg,
      externalEffectVerified: "none",
      verificationId: "unused",
      subject: { actorId: tenant.owner, identitySource: "declared" } as never,
    });
    expect(forgedDeclared.ok).toBe(false);
    if (forgedDeclared.ok) {
      throw new Error("expected forged declared reject");
    }
    expect(forgedDeclared.reason).toBe("operator_identity_not_trusted");

    const forgedRuntimeTag = await releaseWakeOpForRetry({
      authority: ctx.authority,
      opKey: ctx.opKey,
      cfg,
      externalEffectVerified: "none",
      verificationId: "unused",
      subject: { actorId: tenant.owner, identitySource: "runtime" } as never,
    });
    expect(forgedRuntimeTag.ok).toBe(false);
    if (forgedRuntimeTag.ok) {
      throw new Error("expected forged runtime tag reject");
    }
    expect(forgedRuntimeTag.reason).toBe("operator_identity_not_trusted");

    // Forged subject id via controlled entry (loads OS — not caller state).
    const forgedSubject = await releaseWakeOpForRetryAuthorized({
      authority: ctx.authority,
      groupId: ctx.groupId,
      taskId: ctx.taskId,
      opKey: ctx.opKey,
      actorId: "forged-operator-id",
      verificationId: "unused",
      cfg,
    });
    expect(forgedSubject.ok).toBe(false);
    if (forgedSubject.ok) {
      throw new Error("expected forged subject reject");
    }
    expect(forgedSubject.reason).toBe("release_forbidden");

    const cross = await releaseWakeOpForRetryAuthorized({
      authority: ctx.authority,
      groupId: ctx.groupId,
      taskId: ctx.taskId,
      opKey: ctx.opKey,
      actorId: tenant.crossOwner,
      verificationId: "unused",
      cfg,
    });
    expect(cross.ok).toBe(false);
    if (cross.ok) {
      throw new Error("expected cross-tenant reject");
    }
    expect(cross.reason).toBe("release_forbidden");

    const unauthorized = await releaseWakeOpForRetryAuthorized({
      authority: ctx.authority,
      groupId: ctx.groupId,
      taskId: ctx.taskId,
      opKey: ctx.opKey,
      actorId: tenant.admin,
      verificationId: "unused",
      cfg,
    });
    expect(unauthorized.ok).toBe(false);
    if (unauthorized.ok) {
      throw new Error("expected same-tenant unauthorized reject");
    }
    expect(unauthorized.reason).toBe("release_forbidden");

    // Revoke owner in durable OS, then entry must refuse (state unchanged).
    const { fileStore } = createWorkspaceCollaborationStores(cfg);
    await writeAuthOsForTest({
      fileStore,
      groupId: ctx.groupId,
      cfg,
      state: buildState({ revokeOwner: true }),
    });
    const revoked = await releaseWakeOpForRetryAuthorized({
      authority: ctx.authority,
      groupId: ctx.groupId,
      taskId: ctx.taskId,
      opKey: ctx.opKey,
      actorId: tenant.owner,
      verificationId: "unused",
      cfg,
    });
    expect(revoked.ok).toBe(false);
    if (revoked.ok) {
      throw new Error("expected revoked reject");
    }
    expect(revoked.reason).toBe("release_forbidden");

    const afterDenies = await readWakeOpRecord({ authority: ctx.authority, opKey: ctx.opKey });
    expect(afterDenies?.status).toBe("unknown");
    expect(afterDenies?.releasedBy).toBeUndefined();

    // Restore OS; legitimate owner + controlled verification unlocks.
    await writeAuthOsForTest({ fileStore, groupId: ctx.groupId, cfg, state: buildState() });
    const verification = await platformVerifyNone({
      authority: ctx.authority,
      cfg,
      groupId: ctx.groupId,
      taskId: ctx.taskId,
      opKey: ctx.opKey,
    });
    const ok = await releaseWakeOpForRetryAuthorized({
      authority: ctx.authority,
      groupId: ctx.groupId,
      taskId: ctx.taskId,
      opKey: ctx.opKey,
      actorId: tenant.owner,
      verificationId: verification.verificationId,
      cfg,
    });
    expect(ok.ok).toBe(true);
    if (!ok.ok) {
      throw new Error("expected owner release ok");
    }
    expect(ok.record.status).toBe("failed");
    expect(ok.record.releasedBy).toBe(tenant.owner);
    expect(ok.record.externalEffectCheck?.source).toBe("side_effect_probe");
  });

  test("C1-CONFIRM-AUTH-01: forged / cross-tenant / unauthorized / revoked reject; approver ok", async () => {
    const { cfg } = await useIsolationRoot();
    const ctx = await seedUnknownOp({
      cfg,
      itemId: "c1-confirm-auth",
      withRoundId: "round-c1-confirm",
    });
    const before = await readWakeOpRecord({ authority: ctx.authority, opKey: ctx.opKey });
    expect(before?.status).toBe("unknown");
    expect(before?.roundId).toBe("round-c1-confirm");

    const forged = await confirmWakeOpCompleted({
      authority: ctx.authority,
      opKey: ctx.opKey,
      roundId: "round-c1-confirm",
      cfg,
      subject: { actorId: tenant.approver, identitySource: "declared" } as never,
    });
    expect(forged.ok).toBe(false);
    if (forged.ok) {
      throw new Error("expected forged reject");
    }
    expect(forged.reason).toBe("operator_identity_not_trusted");

    const forgedRuntime = await confirmWakeOpCompleted({
      authority: ctx.authority,
      opKey: ctx.opKey,
      roundId: "round-c1-confirm",
      cfg,
      subject: { actorId: tenant.approver, identitySource: "runtime" } as never,
    });
    expect(forgedRuntime.ok).toBe(false);
    if (forgedRuntime.ok) {
      throw new Error("expected forged runtime reject");
    }
    expect(forgedRuntime.reason).toBe("operator_identity_not_trusted");

    const cross = await confirmWakeOpCompletedAuthorized({
      authority: ctx.authority,
      groupId: ctx.groupId,
      taskId: ctx.taskId,
      opKey: ctx.opKey,
      roundId: "round-c1-confirm",
      actorId: tenant.crossOwner,
      cfg,
    });
    expect(cross.ok).toBe(false);
    if (cross.ok) {
      throw new Error("expected cross reject");
    }
    expect(cross.reason).toBe("confirm_forbidden");

    const ownerNotApprover = await confirmWakeOpCompletedAuthorized({
      authority: ctx.authority,
      groupId: ctx.groupId,
      taskId: ctx.taskId,
      opKey: ctx.opKey,
      roundId: "round-c1-confirm",
      actorId: tenant.owner,
      cfg,
    });
    expect(ownerNotApprover.ok).toBe(false);
    if (ownerNotApprover.ok) {
      throw new Error("expected owner-without-approver reject");
    }
    expect(ownerNotApprover.reason).toBe("confirm_forbidden");

    // Forge approver list: minted subject with forged approvers cannot be created via entry;
    // direct mint with forged list still requires brand — entry loads task approvers.
    // Forge approver list on an offline-minted subject — execute reloads task approvers and refuses.
    const forgedApproverList = mintConfirmSubject(tenant.member, ctx.groupId, ctx.taskId, [
      tenant.member,
    ]);
    const forgedList = await confirmWakeOpCompleted({
      authority: ctx.authority,
      opKey: ctx.opKey,
      roundId: "round-c1-confirm",
      cfg,
      subject: forgedApproverList,
    });
    expect(forgedList.ok).toBe(false);
    if (forgedList.ok) {
      throw new Error("expected forged approver-list refuse at execute");
    }
    expect(forgedList.reason).toBe("confirm_forbidden");

    const viaEntry = await confirmWakeOpCompletedAuthorized({
      authority: ctx.authority,
      groupId: ctx.groupId,
      taskId: ctx.taskId,
      opKey: ctx.opKey,
      roundId: "round-c1-confirm",
      actorId: tenant.member,
      cfg,
    });
    expect(viaEntry.ok).toBe(false);
    if (viaEntry.ok) {
      throw new Error("expected forged approver-list path refuse via entry");
    }
    expect(viaEntry.reason).toBe("confirm_forbidden");

    const { fileStore } = createWorkspaceCollaborationStores(cfg);
    const revokedState = buildState();
    revokedState.memberRoleMap = revokedState.memberRoleMap.map((row) =>
      row.memberId === tenant.approver ? { ...row, status: "revoked" } : row,
    );
    await writeAuthOsForTest({ fileStore, groupId: ctx.groupId, cfg, state: revokedState });
    const revoked = await confirmWakeOpCompletedAuthorized({
      authority: ctx.authority,
      groupId: ctx.groupId,
      taskId: ctx.taskId,
      opKey: ctx.opKey,
      roundId: "round-c1-confirm",
      actorId: tenant.approver,
      cfg,
    });
    expect(revoked.ok).toBe(false);
    if (revoked.ok) {
      throw new Error("expected revoked reject");
    }
    expect(revoked.reason).toBe("confirm_forbidden");

    const afterDenies = await readWakeOpRecord({ authority: ctx.authority, opKey: ctx.opKey });
    expect(afterDenies?.status).toBe("unknown");
    expect(afterDenies?.confirmedBy).toBeUndefined();

    await writeAuthOsForTest({ fileStore, groupId: ctx.groupId, cfg, state: buildState() });
    const ok = await confirmWakeOpCompletedAuthorized({
      authority: ctx.authority,
      groupId: ctx.groupId,
      taskId: ctx.taskId,
      opKey: ctx.opKey,
      roundId: "round-c1-confirm",
      actorId: tenant.approver,
      cfg,
    });
    expect(ok.ok).toBe(true);
    if (!ok.ok) {
      throw new Error("expected approver confirm ok");
    }
    expect(ok.record.status).toBe("completed");
    expect(ok.record.confirmedBy).toBe(tenant.approver);
  });

  test("C2-EFFECT-CHECK-01: self-filled / missing/wrong-op/expired/contradictory refuse; stay unknown", async () => {
    const { cfg } = await useIsolationRoot();
    const ctx = await seedUnknownOp({ cfg, itemId: "c2-effect" });
    const now = Date.now();
    const subject = mintReleaseSubject(tenant.owner, ctx.groupId, ctx.taskId);

    // Self-filled verificationId that was never produced by controlled verifier.
    const selfFilled = await releaseWakeOpForRetry({
      authority: ctx.authority,
      opKey: ctx.opKey,
      cfg,
      nowMs: now,
      externalEffectVerified: "none",
      verificationId: "caller-invented-verification",
      subject,
    });
    expect(selfFilled.ok).toBe(false);
    if (selfFilled.ok) {
      throw new Error("expected self-filled reject");
    }
    expect(selfFilled.reason).toBe("missing_external_effect_verification");

    // Wrong op: verification bound to a different opKey.
    const wrongOpVer = await producePlatformNoneVerification({
      authority: ctx.authority,
      cfg,
      groupId: ctx.groupId,
      taskId: ctx.taskId,
      opKey: "other-task-other-op",
      attemptId: "synthetic-wrong-op-attempt",
      nowMs: now,
      probe: async () => ({ source: "side_effect_probe", outcome: "none" }),
    });
    expect(wrongOpVer.ok).toBe(true);
    if (!wrongOpVer.ok) {
      throw new Error("setup");
    }
    const wrongOp = await releaseWakeOpForRetry({
      authority: ctx.authority,
      opKey: ctx.opKey,
      cfg,
      nowMs: now,
      externalEffectVerified: "none",
      verificationId: wrongOpVer.record.verificationId,
      subject,
    });
    expect(wrongOp.ok).toBe(false);
    if (wrongOp.ok) {
      throw new Error("expected op mismatch");
    }
    expect(wrongOp.reason).toBe("effect_check_op_mismatch");

    // Expired verification.
    const expiredVer = await producePlatformNoneVerification({
      authority: ctx.authority,
      cfg,
      groupId: ctx.groupId,
      taskId: ctx.taskId,
      opKey: ctx.opKey,
      attemptId:
        (await readWakeOpRecord({ authority: ctx.authority, opKey: ctx.opKey }))
          ?.executionAttemptId ?? "x",
      nowMs: now - 31 * 60 * 1000,
      probe: async () => ({ source: "side_effect_probe", outcome: "none" }),
    });
    expect(expiredVer.ok).toBe(true);
    if (!expiredVer.ok) {
      throw new Error("setup");
    }
    const expired = await releaseWakeOpForRetry({
      authority: ctx.authority,
      opKey: ctx.opKey,
      cfg,
      nowMs: now,
      externalEffectVerified: "none",
      verificationId: expiredVer.record.verificationId,
      subject,
    });
    expect(expired.ok).toBe(false);
    if (expired.ok) {
      throw new Error("expected expired");
    }
    expect(expired.reason).toBe("effect_check_expired");

    // Probe refuses / unavailable → keep unknown (no auto-retry).
    const unavailable = await producePlatformNoneVerification({
      authority: ctx.authority,
      cfg,
      groupId: ctx.groupId,
      taskId: ctx.taskId,
      opKey: ctx.opKey,
      attemptId:
        (await readWakeOpRecord({ authority: ctx.authority, opKey: ctx.opKey }))
          ?.executionAttemptId ?? "x",
      nowMs: now,
      probe: async () => null,
    });
    expect(unavailable.ok).toBe(false);
    if (unavailable.ok) {
      throw new Error("expected unavailable");
    }
    expect(unavailable.reason).toBe("verify_capability_unavailable");

    const still = await readWakeOpRecord({ authority: ctx.authority, opKey: ctx.opKey });
    expect(still?.status).toBe("unknown");

    // Trusted platform verification positive path.
    const okVer = await platformVerifyNone({
      authority: ctx.authority,
      cfg,
      groupId: ctx.groupId,
      taskId: ctx.taskId,
      opKey: ctx.opKey,
      checkedAtMs: now - 1000,
    });
    const ok = await releaseWakeOpForRetry({
      authority: ctx.authority,
      opKey: ctx.opKey,
      cfg,
      nowMs: now,
      externalEffectVerified: "none",
      verificationId: okVer.verificationId,
      subject,
    });
    expect(ok.ok).toBe(true);
    if (!ok.ok) {
      throw new Error("expected valid verification release");
    }
    expect(ok.record.externalEffectCheck?.checkedAtMs).toBe(now - 1000);
  });

  test("C2-NO-AUTO-RERUN-01: cannot confirm → stay unknown; late receipt blocks release", async () => {
    const { cfg } = await useIsolationRoot();
    const ctx = await seedUnknownOp({ cfg, itemId: "c2-no-rerun" });

    const noReceipt = await confirmWakeOpCompletedAuthorized({
      authority: ctx.authority,
      groupId: ctx.groupId,
      taskId: ctx.taskId,
      opKey: ctx.opKey,
      roundId: "invented-round",
      actorId: tenant.approver,
      cfg,
    });
    expect(noReceipt.ok).toBe(false);
    if (noReceipt.ok) {
      throw new Error("expected no receipt");
    }
    expect(noReceipt.reason).toBe("no_prior_receipt_on_ledger");
    expect((await readWakeOpRecord({ authority: ctx.authority, opKey: ctx.opKey }))?.status).toBe(
      "unknown",
    );

    const verification = await platformVerifyNone({
      authority: ctx.authority,
      cfg,
      groupId: ctx.groupId,
      taskId: ctx.taskId,
      opKey: ctx.opKey,
    });
    await markWakeOpCompleted({
      authority: ctx.authority,
      opKey: ctx.opKey,
      roundId: "late-receipt-round",
      cfg,
      detail: "late_receipt_after_probe",
    });
    const late = await releaseWakeOpForRetryAuthorized({
      authority: ctx.authority,
      groupId: ctx.groupId,
      taskId: ctx.taskId,
      opKey: ctx.opKey,
      actorId: tenant.owner,
      verificationId: verification.verificationId,
      cfg,
    });
    expect(late.ok).toBe(false);
    if (late.ok) {
      throw new Error("expected late receipt refuse");
    }
    expect(late.reason).toBe("late_receipt_completed");
    expect((await readWakeOpRecord({ authority: ctx.authority, opKey: ctx.opKey }))?.status).toBe(
      "completed",
    );

    const ctx2 = await seedUnknownOp({
      cfg,
      itemId: "c2-prior-receipt",
      withRoundId: "round-prior",
    });
    const verification2 = await platformVerifyNone({
      authority: ctx2.authority,
      cfg,
      groupId: ctx2.groupId,
      taskId: ctx2.taskId,
      opKey: ctx2.opKey,
    });
    const prior = await releaseWakeOpForRetryAuthorized({
      authority: ctx2.authority,
      groupId: ctx2.groupId,
      taskId: ctx2.taskId,
      opKey: ctx2.opKey,
      actorId: tenant.owner,
      verificationId: verification2.verificationId,
      cfg,
    });
    expect(prior.ok).toBe(false);
    if (prior.ok) {
      throw new Error("expected prior receipt refuse");
    }
    expect(prior.reason).toBe("prior_receipt_recheck_use_confirm");
    expect((await readWakeOpRecord({ authority: ctx2.authority, opKey: ctx2.opKey }))?.status).toBe(
      "unknown",
    );
  });
});
