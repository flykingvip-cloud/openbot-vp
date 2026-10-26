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
import {
  canConfirmWakeOpCompleted as canConfirmFromGate,
  canPerformWakeOpRecovery,
  canReleaseWakeOpForRetry as canReleaseFromGate,
  claimWakeOpRunning,
  confirmWakeOpCompleted,
  markWakeOpCompleted,
  markWakeOpUnknown,
  readWakeOpRecord,
  releaseWakeOpForRetry,
  type TrustedWakeOpOperator,
} from "../collaboration-dispatch/wake-op-ledger.js";
import { resolveSecurityProfile } from "../security-profile.js";
import { createWorkspaceCollaborationStores, writeGroupOperatingState } from "./shared.js";
import { resolveCollaborationGroupTenantId } from "./shared.js";
import { canRequestTaskStop } from "./task-stop-entry.js";
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

function noneCheck(
  opKey: string,
  overrides: Partial<{ source: string; opId: string; checkedAtMs: number; outcome: "none" }> = {},
) {
  return {
    source: overrides.source ?? "side_effect_probe",
    opId: overrides.opId ?? opKey,
    checkedAtMs: overrides.checkedAtMs ?? Date.now(),
    outcome: (overrides.outcome ?? "none") as "none",
  };
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

    const forged = await releaseWakeOpForRetry({
      authority: ctx.authority,
      opKey: ctx.opKey,
      cfg,
      externalEffectVerified: "none",
      externalEffectCheck: noneCheck(ctx.opKey),
      // Forged: non-runtime identity source even with a plausible actor id.
      operator: { actorId: tenant.owner, identitySource: "declared" } as TrustedWakeOpOperator,
      operatingState: ctx.state,
    });
    expect(forged.ok).toBe(false);
    if (forged.ok) {
      throw new Error("expected forged reject");
    }
    expect(forged.reason).toBe("operator_identity_not_trusted");

    const forgedRuntime = await releaseWakeOpForRetry({
      authority: ctx.authority,
      opKey: ctx.opKey,
      cfg,
      externalEffectVerified: "none",
      externalEffectCheck: noneCheck(ctx.opKey),
      operator: { actorId: "forged-operator-id", identitySource: "runtime" },
      operatingState: ctx.state,
    });
    expect(forgedRuntime.ok).toBe(false);
    if (forgedRuntime.ok) {
      throw new Error("expected forged runtime reject");
    }
    expect(forgedRuntime.reason).toBe("release_forbidden");

    const cross = await releaseWakeOpForRetry({
      authority: ctx.authority,
      opKey: ctx.opKey,
      cfg,
      externalEffectVerified: "none",
      externalEffectCheck: noneCheck(ctx.opKey),
      operator: { actorId: tenant.crossOwner, identitySource: "runtime" },
      operatingState: ctx.state,
    });
    expect(cross.ok).toBe(false);
    if (cross.ok) {
      throw new Error("expected cross-tenant reject");
    }
    expect(cross.reason).toBe("release_forbidden");

    const unauthorized = await releaseWakeOpForRetry({
      authority: ctx.authority,
      opKey: ctx.opKey,
      cfg,
      externalEffectVerified: "none",
      externalEffectCheck: noneCheck(ctx.opKey),
      // Admin can stop but must NOT release.
      operator: { actorId: tenant.admin, identitySource: "runtime" },
      operatingState: ctx.state,
    });
    expect(unauthorized.ok).toBe(false);
    if (unauthorized.ok) {
      throw new Error("expected same-tenant unauthorized reject");
    }
    expect(unauthorized.reason).toBe("release_forbidden");

    const revokedState = buildState({ revokeOwner: true });
    const revoked = await releaseWakeOpForRetry({
      authority: ctx.authority,
      opKey: ctx.opKey,
      cfg,
      externalEffectVerified: "none",
      externalEffectCheck: noneCheck(ctx.opKey),
      operator: { actorId: tenant.owner, identitySource: "runtime" },
      operatingState: revokedState,
    });
    expect(revoked.ok).toBe(false);
    if (revoked.ok) {
      throw new Error("expected revoked reject");
    }
    expect(revoked.reason).toBe("release_forbidden");

    const afterDenies = await readWakeOpRecord({ authority: ctx.authority, opKey: ctx.opKey });
    expect(afterDenies?.status).toBe("unknown");
    expect(afterDenies?.releasedBy).toBeUndefined();

    const ok = await releaseWakeOpForRetry({
      authority: ctx.authority,
      opKey: ctx.opKey,
      cfg,
      externalEffectVerified: "none",
      externalEffectCheck: noneCheck(ctx.opKey),
      operator: { actorId: tenant.owner, identitySource: "runtime" },
      operatingState: ctx.state,
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
      operator: { actorId: tenant.approver, identitySource: "declared" } as TrustedWakeOpOperator,
      operatingState: ctx.state,
      taskApproverIds: ctx.approvers,
    });
    expect(forged.ok).toBe(false);
    if (forged.ok) {
      throw new Error("expected forged reject");
    }
    expect(forged.reason).toBe("operator_identity_not_trusted");

    const cross = await confirmWakeOpCompleted({
      authority: ctx.authority,
      opKey: ctx.opKey,
      roundId: "round-c1-confirm",
      cfg,
      operator: { actorId: tenant.crossOwner, identitySource: "runtime" },
      operatingState: ctx.state,
      taskApproverIds: ctx.approvers,
    });
    expect(cross.ok).toBe(false);
    if (cross.ok) {
      throw new Error("expected cross reject");
    }
    expect(cross.reason).toBe("confirm_forbidden");

    // Owner can release but is NOT approver → confirm forbidden.
    const ownerNotApprover = await confirmWakeOpCompleted({
      authority: ctx.authority,
      opKey: ctx.opKey,
      roundId: "round-c1-confirm",
      cfg,
      operator: { actorId: tenant.owner, identitySource: "runtime" },
      operatingState: ctx.state,
      taskApproverIds: ctx.approvers,
    });
    expect(ownerNotApprover.ok).toBe(false);
    if (ownerNotApprover.ok) {
      throw new Error("expected owner-without-approver reject");
    }
    expect(ownerNotApprover.reason).toBe("confirm_forbidden");

    const revokedState = buildState({ revokeOwner: true });
    // Revoke the approver row.
    revokedState.memberRoleMap = revokedState.memberRoleMap.map((row) =>
      row.memberId === tenant.approver ? { ...row, status: "revoked" } : row,
    );
    const revoked = await confirmWakeOpCompleted({
      authority: ctx.authority,
      opKey: ctx.opKey,
      roundId: "round-c1-confirm",
      cfg,
      operator: { actorId: tenant.approver, identitySource: "runtime" },
      operatingState: revokedState,
      taskApproverIds: ctx.approvers,
    });
    expect(revoked.ok).toBe(false);
    if (revoked.ok) {
      throw new Error("expected revoked reject");
    }
    expect(revoked.reason).toBe("confirm_forbidden");

    const afterDenies = await readWakeOpRecord({ authority: ctx.authority, opKey: ctx.opKey });
    expect(afterDenies?.status).toBe("unknown");
    expect(afterDenies?.confirmedBy).toBeUndefined();

    const ok = await confirmWakeOpCompleted({
      authority: ctx.authority,
      opKey: ctx.opKey,
      roundId: "round-c1-confirm",
      cfg,
      operator: { actorId: tenant.approver, identitySource: "runtime" },
      operatingState: ctx.state,
      taskApproverIds: ctx.approvers,
    });
    expect(ok.ok).toBe(true);
    if (!ok.ok) {
      throw new Error("expected approver confirm ok");
    }
    expect(ok.record.status).toBe("completed");
    expect(ok.record.confirmedBy).toBe(tenant.approver);
  });

  test("C2-EFFECT-CHECK-01: missing/wrong-op/expired/contradictory/declaration-alone refuse; stay unknown", async () => {
    const { cfg } = await useIsolationRoot();
    const ctx = await seedUnknownOp({ cfg, itemId: "c2-effect" });
    const now = Date.now();

    // Declaration alone: TypeScript requires check, but empty/invalid fields model "declaration only".
    const missing = await releaseWakeOpForRetry({
      authority: ctx.authority,
      opKey: ctx.opKey,
      cfg,
      nowMs: now,
      externalEffectVerified: "none",
      externalEffectCheck: noneCheck(ctx.opKey, { source: "" }),
      operator: { actorId: tenant.owner, identitySource: "runtime" },
      operatingState: ctx.state,
    });
    expect(missing.ok).toBe(false);
    if (missing.ok) {
      throw new Error("expected missing source");
    }
    expect(missing.reason).toBe("missing_effect_check_source");

    const wrongOp = await releaseWakeOpForRetry({
      authority: ctx.authority,
      opKey: ctx.opKey,
      cfg,
      nowMs: now,
      externalEffectVerified: "none",
      externalEffectCheck: noneCheck(ctx.opKey, { opId: "other-task-other-op" }),
      operator: { actorId: tenant.owner, identitySource: "runtime" },
      operatingState: ctx.state,
    });
    expect(wrongOp.ok).toBe(false);
    if (wrongOp.ok) {
      throw new Error("expected op mismatch");
    }
    expect(wrongOp.reason).toBe("effect_check_op_mismatch");

    const expired = await releaseWakeOpForRetry({
      authority: ctx.authority,
      opKey: ctx.opKey,
      cfg,
      nowMs: now,
      externalEffectVerified: "none",
      externalEffectCheck: noneCheck(ctx.opKey, { checkedAtMs: now - 31 * 60 * 1000 }),
      operator: { actorId: tenant.owner, identitySource: "runtime" },
      operatingState: ctx.state,
    });
    expect(expired.ok).toBe(false);
    if (expired.ok) {
      throw new Error("expected expired");
    }
    expect(expired.reason).toBe("effect_check_expired");

    const contradictory = await releaseWakeOpForRetry({
      authority: ctx.authority,
      opKey: ctx.opKey,
      cfg,
      nowMs: now,
      externalEffectVerified: "none",
      externalEffectCheck: {
        ...noneCheck(ctx.opKey),
        outcome: "occurred",
      } as ReturnType<typeof noneCheck>,
      operator: { actorId: tenant.owner, identitySource: "runtime" },
      operatingState: ctx.state,
    });
    expect(contradictory.ok).toBe(false);
    if (contradictory.ok) {
      throw new Error("expected contradictory");
    }
    expect(contradictory.reason).toBe("effect_check_contradictory_outcome");

    const still = await readWakeOpRecord({ authority: ctx.authority, opKey: ctx.opKey });
    expect(still?.status).toBe("unknown");

    // Human escalation checkbox ≠ fact: keep unknown when check cannot be validated.
    // (Already covered by missing source.) Authorized owner with valid check can release.
    const ok = await releaseWakeOpForRetry({
      authority: ctx.authority,
      opKey: ctx.opKey,
      cfg,
      nowMs: now,
      externalEffectVerified: "none",
      externalEffectCheck: noneCheck(ctx.opKey, { checkedAtMs: now - 1000 }),
      operator: { actorId: tenant.owner, identitySource: "runtime" },
      operatingState: ctx.state,
    });
    expect(ok.ok).toBe(true);
    if (!ok.ok) {
      throw new Error("expected valid check release");
    }
    expect(ok.record.externalEffectCheck?.checkedAtMs).toBe(now - 1000);
  });

  test("C2-NO-AUTO-RERUN-01: cannot confirm → stay unknown; late receipt blocks release", async () => {
    const { cfg } = await useIsolationRoot();
    const ctx = await seedUnknownOp({ cfg, itemId: "c2-no-rerun" });

    // No prior receipt → confirm refused; state stays unknown (no auto-rerun).
    const noReceipt = await confirmWakeOpCompleted({
      authority: ctx.authority,
      opKey: ctx.opKey,
      roundId: "invented-round",
      cfg,
      operator: { actorId: tenant.approver, identitySource: "runtime" },
      operatingState: ctx.state,
      taskApproverIds: ctx.approvers,
    });
    expect(noReceipt.ok).toBe(false);
    if (noReceipt.ok) {
      throw new Error("expected no receipt");
    }
    expect(noReceipt.reason).toBe("no_prior_receipt_on_ledger");
    expect((await readWakeOpRecord({ authority: ctx.authority, opKey: ctx.opKey }))?.status).toBe(
      "unknown",
    );

    // Evidence collected, then late completion appears → release must refuse.
    const check = noneCheck(ctx.opKey);
    await markWakeOpCompleted({
      authority: ctx.authority,
      opKey: ctx.opKey,
      roundId: "late-receipt-round",
      cfg,
      detail: "late_receipt_after_probe",
    });
    const late = await releaseWakeOpForRetry({
      authority: ctx.authority,
      opKey: ctx.opKey,
      cfg,
      externalEffectVerified: "none",
      externalEffectCheck: check,
      operator: { actorId: tenant.owner, identitySource: "runtime" },
      operatingState: ctx.state,
    });
    expect(late.ok).toBe(false);
    if (late.ok) {
      throw new Error("expected late receipt refuse");
    }
    expect(late.reason).toBe("late_receipt_completed");
    expect((await readWakeOpRecord({ authority: ctx.authority, opKey: ctx.opKey }))?.status).toBe(
      "completed",
    );

    // Prior receipt on unknown (gap model) → release refuses; use confirm instead.
    const ctx2 = await seedUnknownOp({
      cfg,
      itemId: "c2-prior-receipt",
      withRoundId: "round-prior",
    });
    const prior = await releaseWakeOpForRetry({
      authority: ctx2.authority,
      opKey: ctx2.opKey,
      cfg,
      externalEffectVerified: "none",
      externalEffectCheck: noneCheck(ctx2.opKey),
      operator: { actorId: tenant.owner, identitySource: "runtime" },
      operatingState: ctx2.state,
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
