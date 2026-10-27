/**
 * R7 — claim clear/release same trusted SoT/lock as commit/take;
 * managed helper hard-reject; strong positive op-A→op-B.
 *
 * Proof scope: mock identity boundary where noted; REAL consumeWakeForRoundDispatch
 * on managed tenant locator. Not claimed: autoAdvance / readiness / agent tools / F4.
 */
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CollaborationMember, Task } from "@openbot/collaboration-core";
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
  casClearTaskDispatchClaimForOp,
  casCommitTaskDispatchEligibility,
  resolveTaskControlTrustedStores,
} from "../collaboration-dispatch/task-control-cas.js";
import { recheckCurrentDispatchAuthorization } from "../collaboration-dispatch/task-dispatch-auth-recheck.js";
import { asGovernedTask } from "../collaboration-dispatch/task-runtime.js";
import { consumeWakeForRoundDispatch } from "../collaboration-dispatch/wake-round-dispatch.js";
import { persistAuthoritativeGroupMembers } from "../workspace/group-acl.js";
import { resolveTrustedGroupLocator } from "../workspace/group-locator.js";
import {
  createWorkspaceCollaborationStores,
  readGroupOperatingState,
  writeGroupOperatingState,
} from "./shared.js";
import { createTrustedGroupStores, TRUSTED_GROUP_LOCATOR_REQUIRED } from "./team-resource-auth.js";
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
  await Promise.all(tempDirs.splice(0).map((dir) => fsp.rm(dir, { recursive: true, force: true })));
});

async function useManagedRoot() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "openbot-r7-claim-"));
  tempDirs.push(root);
  const tenantsRoot = path.join(root, "tenants");
  process.env.OPENBOT_STATE_DIR = root;
  process.env.OPENBOT_TENANTS_ROOT = tenantsRoot;
  const configPath = path.join(root, "openbot.json");
  process.env.OPENBOT_CONFIG_PATH = configPath;
  process.env.OPENCLAW_CONFIG_PATH = configPath;
  process.env.OPENBOT_SECURITY_PROFILE = "enterprise";
  process.env.OPENCLAW_SECURITY_PROFILE = "enterprise";
  const cfg = {
    gateway: { security: { profile: "managed_enterprise" } },
    collaboration: {
      runtimeNamespace: true,
      task: {
        claimContract: true,
        wakeContract: true,
      },
    },
  } as OpenBotConfig;
  await fsp.writeFile(configPath, JSON.stringify(cfg, null, 2), "utf8");
  setRuntimeConfigSnapshot(cfg);
  clearConfigCache();
  return { root, tenantsRoot, cfg };
}

function rosterMembers(owner: string, bot: string): CollaborationMember[] {
  return [
    {
      memberId: owner,
      memberKind: "human",
      userId: owner,
      governanceRole: "owner",
      status: "active",
      updatedAtMs: 1,
    },
    {
      memberId: bot,
      memberKind: "bot",
      agentId: bot,
      userId: bot,
      governanceRole: "member",
      status: "active",
      updatedAtMs: 1,
    },
  ];
}

async function seedTrustedRoster(params: {
  tenantId: string;
  owner: string;
  bot: string;
  cfg: OpenBotConfig;
  groupId: string;
}) {
  const groupLocator = resolveTrustedGroupLocator({
    groupId: params.groupId,
    tenantId: params.tenantId,
    profile: "managed_enterprise",
    cfg: params.cfg,
  });
  const groupsRoot = path.dirname(groupLocator);
  const stores = createTrustedGroupStores({ groupsRoot, groupLocator });
  await persistAuthoritativeGroupMembers({
    groupId: params.groupId,
    tenantId: params.tenantId,
    profile: "managed_enterprise",
    cfg: params.cfg,
    members: rosterMembers(params.owner, params.bot),
  });
  await stores.groupStorage.writeProfile({
    groupId: params.groupId,
    groupCode: params.groupId,
    displayName: `r7-${params.tenantId}`,
    ownerUserId: params.owner,
    coordinatorBotId: params.owner,
    createdAtMs: 1,
    updatedAtMs: 1,
  });
  await stores.groupStorage.writeMembers(params.groupId, rosterMembers(params.owner, params.bot));
  return { groupLocator, groupsRoot, stores };
}

function buildAuthority(params: {
  cfg: OpenBotConfig;
  groupId: string;
  tenantId: string;
  taskId: string;
  operatingState: ReturnType<typeof makeOperatingState>;
}) {
  const now = Date.now();
  const snapshot = createRoundPolicySnapshot(
    resolveGroupPolicyInput({ operatingState: params.operatingState }),
    { now, idGen: () => generatePolicySnapshotId(now) },
  );
  return createRuntimeAuthority({
    snapshot,
    episodeId: episodeIdForClientRun(`task-wake:${params.groupId}:${params.taskId}`),
    tenant: resolveAuthorityTenantForEntry({
      preferred: { tenantId: params.tenantId, trust: "membership" },
      groupTenantId: params.tenantId,
    }),
    groupId: params.groupId,
    profile: "managed_enterprise",
    cfg: params.cfg,
  });
}

async function seedTenantTaskReady(params: {
  cfg: OpenBotConfig;
  tenantId: string;
  owner: string;
  bot: string;
  groupId: string;
  taskId: string;
}) {
  const seeded = await seedTrustedRoster(params);
  await seeded.stores.objectStorage.writeObject(params.groupId, "task", params.taskId, {
    taskId: params.taskId,
    groupId: params.groupId,
    title: "r7-claim-life",
    status: "ready",
    ownerMemberId: params.owner,
    responsibility: {
      owner: params.owner,
      executors: [params.bot],
      reviewers: [],
      approvers: [params.owner],
    },
    controlEpoch: 0,
    createdAtMs: 1,
    updatedAtMs: 1,
  } as Task);

  const tenantOs = makeOperatingState({
    groupId: params.groupId,
    governance: {
      ownerUserId: params.owner,
      adminUserIds: [params.owner],
      coordinatorBotId: params.owner,
    },
  });
  tenantOs.memberRoleMap = [
    {
      memberId: params.owner,
      memberKind: "human",
      governanceRole: "owner",
      collaborationRole: "contributor",
      status: "active",
    },
    {
      memberId: params.bot,
      memberKind: "bot",
      governanceRole: "member",
      collaborationRole: "contributor",
      status: "active",
    },
  ];
  await writeGroupOperatingState({
    fileStore: seeded.stores.fileStore,
    groupId: params.groupId,
    state: { ...tenantOs, authEpoch: 3, updatedAtMs: Date.now() } as typeof tenantOs & {
      authEpoch: number;
    },
    groupRootDir: seeded.groupsRoot,
    cfg: params.cfg,
    writeKind: "auth",
  });

  // Poison legacy root OS (authorized missing bot) — must not be used by wake.
  const legacy = createWorkspaceCollaborationStores(params.cfg);
  const legacyOs = makeOperatingState({
    groupId: params.groupId,
    governance: {
      ownerUserId: params.owner,
      adminUserIds: [params.owner],
      coordinatorBotId: params.owner,
    },
  });
  legacyOs.memberRoleMap = [
    {
      memberId: params.owner,
      memberKind: "human",
      governanceRole: "owner",
      collaborationRole: "contributor",
      status: "active",
    },
  ];
  await writeGroupOperatingState({
    fileStore: legacy.fileStore,
    groupId: params.groupId,
    state: { ...legacyOs, authEpoch: 1, updatedAtMs: Date.now() } as typeof legacyOs & {
      authEpoch: number;
    },
    cfg: params.cfg,
    writeKind: "auth",
  });

  const authority = buildAuthority({
    cfg: params.cfg,
    groupId: params.groupId,
    tenantId: params.tenantId,
    taskId: params.taskId,
    operatingState: tenantOs,
  });
  expect(authority.namespace.groupLocator).toContain(path.join(params.tenantId, "collaboration"));

  return { seeded, legacy, authority, tenantOs };
}

describe("R7 claim lifecycle · same trusted SoT/lock (managed)", () => {
  test("op-A success → finally clears tenant claim → op-B succeeds; legacy root has no task write", async () => {
    const { cfg } = await useManagedRoot();
    const tenantId = "tenant-r7-life-a";
    const owner = `${tenantId}/emp-owner`;
    const bot = `${tenantId}/bot-analyst`;
    const groupId = "grp-r7-life-a";
    const taskId = "task-r7-life-a";
    const { seeded, legacy, authority } = await seedTenantTaskReady({
      cfg,
      tenantId,
      owner,
      bot,
      groupId,
      taskId,
    });

    let callsA = 0;
    const wakeA = await consumeWakeForRoundDispatch({
      authority,
      cfg,
      writeMode: "execute",
      roundDispatcher: async () => {
        callsA += 1;
        return { ok: true, roundId: "r7-op-a" };
      },
      request: {
        groupId,
        fromAgentId: "system:group_task_heartbeat",
        toAgentIds: [bot],
        source: "nudge",
        taskId,
        itemId: "item-a",
        reason: "r7-op-a",
      },
    });
    expect(wakeA.dispatched).toBe(true);
    expect(callsA).toBe(1);
    expect(wakeA.roundId).toBe("r7-op-a");

    const afterA = asGovernedTask(
      (await seeded.stores.objectStorage.readObject(groupId, "task", taskId)) as never,
    );
    expect(afterA.dispatchClaim).toBeFalsy();
    expect(await legacy.objectStorage.readObject(groupId, "task", taskId)).toBeNull();

    let callsB = 0;
    const wakeB = await consumeWakeForRoundDispatch({
      authority,
      cfg,
      writeMode: "execute",
      roundDispatcher: async () => {
        callsB += 1;
        return { ok: true, roundId: "r7-op-b" };
      },
      request: {
        groupId,
        fromAgentId: "system:group_task_heartbeat",
        toAgentIds: [bot],
        source: "nudge",
        taskId,
        itemId: "item-b",
        reason: "r7-op-b",
      },
    });
    expect(wakeB.reason).not.toBe("eligibility_cas_rejected");
    expect(wakeB.dispatched).toBe(true);
    expect(callsB).toBe(1);
    expect(wakeB.roundId).toBe("r7-op-b");

    const afterB = asGovernedTask(
      (await seeded.stores.objectStorage.readObject(groupId, "task", taskId)) as never,
    );
    expect(afterB.dispatchClaim).toBeFalsy();
    expect(await legacy.objectStorage.readObject(groupId, "task", taskId)).toBeNull();
  });

  test("claim commit then mirror fail → release on tenant root → retry ok; stale claimId cannot clear new claim", async () => {
    const { cfg } = await useManagedRoot();
    const tenantId = "tenant-r7-life-b";
    const owner = `${tenantId}/emp-owner`;
    const bot = `${tenantId}/bot-analyst`;
    const groupId = "grp-r7-life-b";
    const taskId = "task-r7-life-b";
    const { seeded, legacy, authority } = await seedTenantTaskReady({
      cfg,
      tenantId,
      owner,
      bot,
      groupId,
      taskId,
    });

    let callsFail = 0;
    const wakeFail = await consumeWakeForRoundDispatch({
      authority,
      cfg,
      writeMode: "execute",
      _testForceEligibilityMirrorFailure: true,
      roundDispatcher: async () => {
        callsFail += 1;
        return { ok: true, roundId: "r7-must-not" };
      },
      request: {
        groupId,
        fromAgentId: "system:group_task_heartbeat",
        toAgentIds: [bot],
        source: "nudge",
        taskId,
        itemId: "item-mirror",
        reason: "r7-mirror-fail",
      },
    });
    expect(callsFail).toBe(0);
    expect(wakeFail.dispatched).toBe(false);
    expect(wakeFail.reason).toBe("eligibility_commit_failed");

    const afterFail = asGovernedTask(
      (await seeded.stores.objectStorage.readObject(groupId, "task", taskId)) as never,
    );
    expect(afterFail.dispatchClaim).toBeFalsy();
    expect(await legacy.objectStorage.readObject(groupId, "task", taskId)).toBeNull();

    // Legitimate retry with a different op succeeds on same tenant SoT.
    let callsOk = 0;
    const wakeOk = await consumeWakeForRoundDispatch({
      authority,
      cfg,
      writeMode: "execute",
      roundDispatcher: async () => {
        callsOk += 1;
        return { ok: true, roundId: "r7-retry-ok" };
      },
      request: {
        groupId,
        fromAgentId: "system:group_task_heartbeat",
        toAgentIds: [bot],
        source: "nudge",
        taskId,
        itemId: "item-retry",
        reason: "r7-retry-ok",
      },
    });
    expect(callsOk).toBe(1);
    expect(wakeOk.dispatched).toBe(true);

    // Stale token must not clear a newer claim on the same tenant root.
    const before = asGovernedTask(
      (await seeded.stores.objectStorage.readObject(groupId, "task", taskId)) as never,
    );
    const epoch = typeof before.controlEpoch === "number" ? before.controlEpoch : 0;
    const os = await readGroupOperatingState({
      fileStore: seeded.stores.fileStore,
      groupId,
    });
    const authEpoch =
      typeof (os as { authEpoch?: number } | null)?.authEpoch === "number"
        ? Number((os as { authEpoch?: number }).authEpoch)
        : 3;
    const committed = await casCommitTaskDispatchEligibility({
      groupId,
      taskId,
      opKey: "r7-stale-clear-op",
      expectedControlEpoch: epoch,
      expectedAuthEpoch: authEpoch,
      authFingerprint: "force",
      targetActorIds: [bot],
      cfg,
      groupRootDir: seeded.groupsRoot,
      objectStorage: seeded.stores.objectStorage,
      fileStore: seeded.stores.fileStore,
      _testForceLiveAuthFingerprint: "force",
      nowMs: Date.now(),
    });
    expect(committed.ok).toBe(true);
    if (!committed.ok) {
      throw new Error(`commit failed: ${committed.reason}`);
    }
    const staleClear = await casClearTaskDispatchClaimForOp({
      groupId,
      taskId,
      opKey: "r7-stale-clear-op",
      claimId: "stale-old-token-must-not-clear",
      cfg,
      trusted: {
        groupRootDir: seeded.groupsRoot,
        objectStorage: seeded.stores.objectStorage,
        fileStore: seeded.stores.fileStore,
      },
    });
    expect(staleClear.cleared).toBe(false);
    expect(staleClear.reason).toBe("claim_id_mismatch");
    const still = asGovernedTask(
      (await seeded.stores.objectStorage.readObject(groupId, "task", taskId)) as never,
    );
    expect(still.dispatchClaim?.claimId).toBe(committed.claim.claimId);
    await casClearTaskDispatchClaimForOp({
      groupId,
      taskId,
      opKey: "r7-stale-clear-op",
      claimId: committed.claim.claimId,
      cfg,
      trusted: {
        groupRootDir: seeded.groupsRoot,
        objectStorage: seeded.stores.objectStorage,
        fileStore: seeded.stores.fileStore,
      },
    });
  });
});

describe("R7 managed helpers · incomplete trusted stores hard-refuse", () => {
  test("recheckCurrentDispatchAuthorization managed missing stores → auth_source_unreadable", async () => {
    const { cfg } = await useManagedRoot();
    const result = await recheckCurrentDispatchAuthorization({
      groupId: "grp-r7-missing",
      taskId: "task-x",
      targetActorIds: ["tenant-r7/bot"],
      cfg,
      // deliberately omit fileStore/objectStorage
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected refuse");
    }
    expect(result.reason).toBe("auth_source_unreadable");
    expect(result.detail).toContain(TRUSTED_GROUP_LOCATOR_REQUIRED);
  });

  test("recheck partial mix (only fileStore) refused", async () => {
    const { cfg } = await useManagedRoot();
    const tenantId = "tenant-r7-partial";
    const groupId = "grp-r7-partial";
    const groupLocator = resolveTrustedGroupLocator({
      groupId,
      tenantId,
      profile: "managed_enterprise",
      cfg,
    });
    const stores = createTrustedGroupStores({
      groupsRoot: path.dirname(groupLocator),
      groupLocator,
    });
    const result = await recheckCurrentDispatchAuthorization({
      groupId,
      cfg,
      fileStore: stores.fileStore,
      // objectStorage omitted → must not fill legacy
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected refuse");
    }
    expect(result.reason).toBe("auth_source_unreadable");
    expect(result.detail).toContain(TRUSTED_GROUP_LOCATOR_REQUIRED);
  });

  test("resolveTaskControlTrustedStores managed incomplete throws", async () => {
    const { cfg } = await useManagedRoot();
    expect(() => resolveTaskControlTrustedStores({ cfg })).toThrow(TRUSTED_GROUP_LOCATOR_REQUIRED);
    expect(() =>
      resolveTaskControlTrustedStores({
        cfg,
        groupRootDir: "/tmp/only-root",
      }),
    ).toThrow(TRUSTED_GROUP_LOCATOR_REQUIRED);
  });

  test("casClear without trusted in managed throws (no legacy self-create)", async () => {
    const { cfg } = await useManagedRoot();
    await expect(
      casClearTaskDispatchClaimForOp({
        groupId: "g",
        taskId: "t",
        opKey: "op",
        claimId: "c",
        cfg,
      }),
    ).rejects.toThrow(TRUSTED_GROUP_LOCATOR_REQUIRED);
  });
});
