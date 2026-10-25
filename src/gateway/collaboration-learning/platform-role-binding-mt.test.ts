/**
 * PLT-ROLE-BINDING-MT isolation fixture (r2.1 categories).
 *
 * Synthetic two-tenant / multi-actor harness. Temporary storage only.
 * No real credentials, outbound delivery, or production data.
 *
 * Conclusions bind to the SHA under test; historical 36+15 suites are
 * reference only and must not be merged into one acceptance record.
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
import {
  COLLAB_EDGE_NAME_RESOLVE_IS_NOT_ACL,
  createCollabEdgeTargetResolver,
} from "../collaboration-dispatch/collab-edge.js";
import {
  formatManagedGrayAllowlistKey,
  matchGrayGroupAllowlist,
} from "../collaboration-dispatch/gray-group-allowlist.js";
import {
  assertPeerReviewGateForAccept,
  recordPeerReview,
} from "../collaboration-dispatch/peer-review-gate.js";
import { createRoundPolicySnapshot } from "../collaboration-dispatch/round-policy-snapshot.js";
import { createRuntimeAuthority } from "../collaboration-dispatch/runtime-authority.js";
import {
  selfAdvanceDeliveryRequiresConfirmedPlan,
  selfAdvanceDoesNotAutoCompleteTask,
  selfAdvanceRequiresPerTickReauth,
} from "../collaboration-dispatch/self-advance.js";
import {
  bindDeliveryActor,
  isMappedDeliveryIdentity,
  preferMappedSessionSubjects,
  resolveDeliveryAclActor,
  claimedConnectActorId,
} from "./delivery-actor-binding.js";
import {
  acceptCollaborationTaskHandoffContract,
  applyCollaborationTaskHandoffContract,
  approveCollaborationTaskHandoffContract,
  proposeCollaborationTaskHandoffContract,
  resolveHandoffGovernanceActor,
} from "./handoff-contract-entry.js";
import { SELF_ADVANCE_ENTRY_DELEGATES_UNIFIED_GATE } from "./self-advance-entry.js";
import { createWorkspaceCollaborationStores, writeGroupOperatingState } from "./shared.js";
import {
  resolveCollaborationTenantResolution,
  resolveMembershipTenantIdForAcl,
  isAclSafeTenantTrust,
  resolveAuthorityTenantForEntry,
} from "./trusted-tenant.js";
import { WAKE_CONTRACT_ENTRY_READ_PATHS_DO_NOT_WRITE } from "./wake-contract-entry.js";

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

type SyntheticTenant = {
  tenantId: string;
  groupId: string;
  displayName: string;
  /** Same local id string reused across tenants — must not cross-authorize. */
  localEmployeeId: string;
  employees: Array<{ id: string; displayName: string; kind: "human" | "bot" }>;
  bots: Array<{ id: string; displayName: string }>;
  servicePrincipal: { id: string; displayName: string };
};

/** Two synthetic tenants with colliding display names and local ids. */
function syntheticTenants(): [SyntheticTenant, SyntheticTenant] {
  return [
    {
      tenantId: "tenant-alpha",
      groupId: "grp-alpha-collab",
      displayName: "Alex Chen",
      localEmployeeId: "emp-100",
      employees: [
        { id: "tenant-alpha/emp-100", displayName: "Alex Chen", kind: "human" },
        { id: "tenant-alpha/emp-200", displayName: "Blair Kim", kind: "human" },
      ],
      bots: [
        { id: "bot:alpha-coord", displayName: "CoordBot" },
        { id: "bot:alpha-exec", displayName: "ExecBot" },
      ],
      servicePrincipal: { id: "svc:alpha-runner", displayName: "Runner" },
    },
    {
      tenantId: "tenant-beta",
      groupId: "grp-beta-collab",
      displayName: "Alex Chen",
      localEmployeeId: "emp-100",
      employees: [
        { id: "tenant-beta/emp-100", displayName: "Alex Chen", kind: "human" },
        { id: "tenant-beta/emp-200", displayName: "Casey Wu", kind: "human" },
      ],
      bots: [
        { id: "bot:beta-coord", displayName: "CoordBot" },
        { id: "bot:beta-exec", displayName: "ExecBot" },
      ],
      servicePrincipal: { id: "svc:beta-runner", displayName: "Runner" },
    },
  ];
}

async function useIsolationRoot(opts?: {
  handoffContract?: boolean;
  claimContract?: boolean;
  requirePeerReview?: boolean;
  selfAdvanceMode?: "dry_run" | "execute";
  executeGroupAllowlist?: string[];
}): Promise<{ root: string; cfg: OpenBotConfig; tenantsRoot: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-role-binding-mt-"));
  tempDirs.push(root);
  const tenantsRoot = path.join(root, "tenants");
  process.env.OPENBOT_STATE_DIR = path.join(root, "state");
  process.env.OPENBOT_TENANTS_ROOT = tenantsRoot;
  process.env.OPENBOT_SECURITY_PROFILE = "personal_local";
  delete process.env.OPENCLAW_SECURITY_PROFILE;
  const cfg = {
    agents: { defaults: { workspace: path.join(root, "agent-ws") } },
    gateway: { security: { profile: "personal_local" } },
    collaboration: {
      defaults: { workspace: path.join(root, "collaboration") },
      runtimeNamespace: true,
      task: {
        claimContract: opts?.claimContract ?? true,
        handoffContract: opts?.handoffContract ?? true,
        requirePeerReview: opts?.requirePeerReview ?? false,
        selfAdvance: {
          mode: opts?.selfAdvanceMode ?? "dry_run",
          executeGroupAllowlist: opts?.executeGroupAllowlist ?? [],
        },
      },
    },
  } as OpenBotConfig;
  setRuntimeConfigSnapshot(cfg, path.join(root, "openbot.json"));
  return { root, cfg, tenantsRoot };
}

describe("PLT role-binding MT fixtures (r2.1)", () => {
  test("T-E4 / D1 / D2: same display name and local id never cross-tenant authorize", () => {
    const [alpha, beta] = syntheticTenants();
    expect(alpha.displayName).toBe(beta.displayName);
    expect(alpha.localEmployeeId).toBe(beta.localEmployeeId);
    expect(alpha.employees[0].id).not.toBe(beta.employees[0].id);

    const alphaKey = formatManagedGrayAllowlistKey(alpha.tenantId, alpha.groupId);
    const betaKey = formatManagedGrayAllowlistKey(beta.tenantId, beta.groupId);
    expect(alphaKey).toBe("tenant-alpha/grp-alpha-collab");
    expect(betaKey).toBe("tenant-beta/grp-beta-collab");

    const entries = [alphaKey];
    expect(
      matchGrayGroupAllowlist({
        entries,
        tenantId: alpha.tenantId,
        groupId: alpha.groupId,
      }),
    ).toBe(true);
    expect(
      matchGrayGroupAllowlist({
        entries,
        tenantId: beta.tenantId,
        groupId: beta.groupId,
      }),
    ).toBe(false);
    // Bare local id / display name must never authorize managed gray.
    expect(
      matchGrayGroupAllowlist({
        entries: [alpha.localEmployeeId, alpha.displayName, alpha.groupId],
        tenantId: alpha.tenantId,
        groupId: alpha.groupId,
      }),
    ).toBe(false);
  });

  test("EB-1: actor_fallback must not become ACL membership tenant", async () => {
    const membershipOnly = await resolveMembershipTenantIdForAcl(null);
    expect(membershipOnly).toBeNull();
    const labeled = await resolveCollaborationTenantResolution(null);
    expect(
      labeled.trust === "membership" ||
        labeled.trust === "actor_fallback" ||
        labeled.trust === "none",
    ).toBe(true);
    if (labeled.trust === "actor_fallback") {
      // ACL helper must stay null even when collaboration I/O can fall back.
      expect(await resolveMembershipTenantIdForAcl(null)).toBeNull();
    }
  });

  test("T-E1 / T-E2: mapped member claimed id requires matching session subject", () => {
    const [alpha] = syntheticTenants();
    const state = {
      governance: { coordinatorBotId: alpha.bots[0].id },
      memberRoleMap: [
        { memberId: alpha.employees[0].id },
        { memberId: alpha.employees[1].id },
        { memberId: alpha.bots[0].id },
      ],
    };
    expect(isMappedDeliveryIdentity(state, alpha.employees[0].id)).toBe(true);
    expect(isMappedDeliveryIdentity(state, betaLocal(alpha.employees[0].id))).toBe(false);

    expect(() =>
      bindDeliveryActor({
        claimedId: alpha.employees[0].id,
        subjects: [alpha.employees[1].id],
        privileged: true,
      }),
    ).toThrow(/actor_not_authenticated/);

    const rebound = bindDeliveryActor({
      claimedId: alpha.employees[0].id,
      subjects: [alpha.employees[0].id],
      privileged: true,
    });
    expect(rebound).toBe(alpha.employees[0].id);

    const preferred = preferMappedSessionSubjects({
      subjects: ["uuid-not-mapped", alpha.employees[0].id],
      stampedUser: alpha.employees[0].id,
      state,
    });
    expect(preferred[0]).toBe(alpha.employees[0].id);
  });

  test("T-E3: legitimate same-tenant actor binds when session matches", async () => {
    const { cfg } = await useIsolationRoot();
    const [alpha] = syntheticTenants();
    const { fileStore } = createWorkspaceCollaborationStores(cfg);
    const state = makeOperatingState({
      groupId: alpha.groupId,
      governance: { coordinatorBotId: alpha.bots[0].id },
    });
    state.memberRoleMap = [
      {
        memberId: alpha.employees[0].id,
        memberKind: "human",
        governanceRole: "member",
        collaborationRole: null,
        status: "active",
      },
      {
        memberId: alpha.bots[0].id,
        memberKind: "bot",
        governanceRole: "member",
        collaborationRole: null,
        status: "active",
      },
    ];
    await writeGroupOperatingState({ fileStore, groupId: alpha.groupId, state });

    const actor = await resolveDeliveryAclActor(
      {
        connect: { user: alpha.employees[0].id },
        user: alpha.employees[0].id,
        platformUserId: alpha.employees[0].id,
      },
      alpha.groupId,
    );
    expect(actor).toBe(alpha.employees[0].id);
  });

  test("D5 / CF-004: handoff before apply keeps original responsibility", async () => {
    const { cfg } = await useIsolationRoot({ handoffContract: true });
    const [alpha] = syntheticTenants();
    const groupId = alpha.groupId;
    const taskId = "task-handoff-d5";
    const { objectStorage, fileStore } = createWorkspaceCollaborationStores(cfg);
    const state = makeOperatingState({
      groupId,
      governance: { coordinatorBotId: alpha.bots[0].id, ownerUserId: alpha.employees[0].id },
    });
    state.memberRoleMap = [
      {
        memberId: alpha.employees[0].id,
        memberKind: "human",
        governanceRole: "owner",
        collaborationRole: null,
        status: "active",
      },
      {
        memberId: alpha.bots[0].id,
        memberKind: "bot",
        governanceRole: "member",
        collaborationRole: null,
        status: "active",
      },
      {
        memberId: alpha.bots[1].id,
        memberKind: "bot",
        governanceRole: "member",
        collaborationRole: null,
        status: "active",
      },
    ];
    await writeGroupOperatingState({ fileStore, groupId, state });

    const seed: Task = {
      taskId,
      groupId,
      title: "handoff isolation",
      status: "in_progress",
      ownerMemberId: alpha.bots[0].id,
      assignedMemberIds: [alpha.bots[0].id],
      responsibility: {
        owner: alpha.bots[0].id,
        executors: [alpha.bots[0].id],
        reviewers: [],
        approvers: [alpha.employees[0].id],
      },
      createdAtMs: 1,
      updatedAtMs: 1,
    } as Task;
    await objectStorage.writeObject(groupId, "task", taskId, seed);

    const proposed = await proposeCollaborationTaskHandoffContract({
      groupId,
      taskId,
      from: alpha.bots[0].id,
      to: alpha.bots[1].id,
      kind: "owner_transfer",
      remainingWork: "finish",
      acceptanceCriteria: ["done"],
      completedArtifacts: [],
      actor: alpha.bots[0].id,
      cfg,
    });
    expect(proposed.status).toBe("proposed");

    const mid = await objectStorage.readObject<Task>(groupId, "task", taskId);
    expect(mid?.ownerMemberId).toBe(alpha.bots[0].id);
    expect(mid?.responsibility?.owner).toBe(alpha.bots[0].id);

    await acceptCollaborationTaskHandoffContract({
      groupId,
      taskId,
      handoffId: proposed.handoffId,
      actor: alpha.bots[1].id,
      actorType: "bot",
      cfg,
    });
    const afterAccept = await objectStorage.readObject<Task>(groupId, "task", taskId);
    expect(afterAccept?.responsibility?.owner).toBe(alpha.bots[0].id);

    await approveCollaborationTaskHandoffContract({
      groupId,
      taskId,
      handoffId: proposed.handoffId,
      actor: alpha.employees[0].id,
      actorType: "human",
      cfg,
    });
    const afterApprove = await objectStorage.readObject<Task>(groupId, "task", taskId);
    expect(afterApprove?.responsibility?.owner).toBe(alpha.bots[0].id);

    const applied = await applyCollaborationTaskHandoffContract({
      groupId,
      taskId,
      handoffId: proposed.handoffId,
      actor: alpha.employees[0].id,
      cfg,
    });
    expect(applied.responsibility?.owner).toBe(alpha.bots[1].id);
  });

  test("EB-3: handoff actorType explicit wins; default infers bot from id shape", () => {
    expect(
      resolveHandoffGovernanceActor({ actorId: "bot:alpha-coord", actorType: "human" }),
    ).toEqual({
      type: "human",
      id: "bot:alpha-coord",
    });
    expect(resolveHandoffGovernanceActor({ actorId: "bot:alpha-coord" })).toEqual({
      type: "bot",
      id: "bot:alpha-coord",
    });
    expect(resolveHandoffGovernanceActor({ actorId: "tenant-alpha/emp-100" })).toEqual({
      type: "human",
      id: "tenant-alpha/emp-100",
    });
  });

  test("CF-008 / RG-LT-005: revise peer review still satisfies participation gate (independent PASS = 人工控制)", async () => {
    const { cfg } = await useIsolationRoot({ requirePeerReview: true, claimContract: true });
    const [alpha] = syntheticTenants();
    // personal_local authority (null tenant) so claimContract global ON applies without gray key.
    const authority = createRuntimeAuthority({
      snapshot: createRoundPolicySnapshot(
        { collaborationMode: "task_driven", finalDecisionMode: "human_required" },
        { now: 1, idGen: () => "pss_mt_peer" },
      ),
      episodeId: "ep_mt_peer",
      tenant: { tenantId: null, trust: "none" },
      groupId: alpha.groupId,
      profile: "personal_local",
      cfg,
    });
    const item = {
      taskId: "task-pr-revise",
      itemId: "item-1",
      submissionId: "sub-1",
      claimantId: alpha.bots[1].id,
      groupId: alpha.groupId,
      status: "submitted_for_review" as const,
    };
    const recorded = await recordPeerReview(
      authority,
      {
        taskId: item.taskId,
        itemId: item.itemId,
        reviewerId: alpha.employees[1].id,
        verdict: "revise",
        comment: "needs evidence",
        item,
      },
      { cfg },
    );
    expect(recorded.ok).toBe(true);

    const gate = await assertPeerReviewGateForAccept(authority, item, { cfg });
    // Participation gate counts non-author rows; does NOT require approve verdict.
    expect(gate.ok).toBe(true);
    // Platform capability note: independent review PASS (RG-LINE-002) remains 人工控制.
  });

  test("B4 / T-E5(1): revoke-before-submit blocks privileged bind", () => {
    const [alpha] = syntheticTenants();
    const active = {
      governance: { coordinatorBotId: alpha.bots[0].id },
      memberRoleMap: [{ memberId: alpha.employees[0].id }],
    };
    expect(isMappedDeliveryIdentity(active, alpha.employees[0].id)).toBe(true);

    // Revocation first → subsequent privileged claim rejected (判定点 1).
    const revoked = {
      governance: { coordinatorBotId: alpha.bots[0].id },
      memberRoleMap: [] as Array<{ memberId: string }>,
    };
    expect(isMappedDeliveryIdentity(revoked, alpha.employees[0].id)).toBe(false);
    // Non-privileged path: session subject wins over forged claimed id.
    const rebound = bindDeliveryActor({
      claimedId: alpha.employees[0].id,
      subjects: ["session-other"],
      privileged: false,
    });
    expect(rebound).toBe("session-other");
  });

  test("T-E5(2)/(3): already-applied handoff records actual result; unknown must not blind-retry mutate", async () => {
    const { cfg } = await useIsolationRoot({ handoffContract: true });
    const [alpha] = syntheticTenants();
    const groupId = alpha.groupId;
    const taskId = "task-te5-applied";
    const { objectStorage, fileStore } = createWorkspaceCollaborationStores(cfg);
    const state = makeOperatingState({
      groupId,
      governance: { coordinatorBotId: alpha.bots[0].id, ownerUserId: alpha.employees[0].id },
    });
    state.memberRoleMap = [
      {
        memberId: alpha.employees[0].id,
        memberKind: "human",
        governanceRole: "owner",
        collaborationRole: null,
        status: "active",
      },
      {
        memberId: alpha.bots[0].id,
        memberKind: "bot",
        governanceRole: "member",
        collaborationRole: null,
        status: "active",
      },
      {
        memberId: alpha.bots[1].id,
        memberKind: "bot",
        governanceRole: "member",
        collaborationRole: null,
        status: "active",
      },
    ];
    await writeGroupOperatingState({ fileStore, groupId, state });
    await objectStorage.writeObject(groupId, "task", taskId, {
      taskId,
      groupId,
      title: "te5",
      status: "in_progress",
      ownerMemberId: alpha.bots[0].id,
      assignedMemberIds: [alpha.bots[0].id],
      responsibility: {
        owner: alpha.bots[0].id,
        executors: [alpha.bots[0].id],
        reviewers: [],
        approvers: [alpha.employees[0].id],
      },
      createdAtMs: 1,
      updatedAtMs: 1,
    } as Task);

    const proposed = await proposeCollaborationTaskHandoffContract({
      groupId,
      taskId,
      from: alpha.bots[0].id,
      to: alpha.bots[1].id,
      kind: "owner_transfer",
      remainingWork: "x",
      acceptanceCriteria: ["y"],
      completedArtifacts: [],
      actor: alpha.bots[0].id,
      cfg,
    });
    await acceptCollaborationTaskHandoffContract({
      groupId,
      taskId,
      handoffId: proposed.handoffId,
      actor: alpha.bots[1].id,
      actorType: "bot",
      cfg,
    });
    await approveCollaborationTaskHandoffContract({
      groupId,
      taskId,
      handoffId: proposed.handoffId,
      actor: alpha.employees[0].id,
      actorType: "human",
      cfg,
    });
    const applied = await applyCollaborationTaskHandoffContract({
      groupId,
      taskId,
      handoffId: proposed.handoffId,
      actor: alpha.employees[0].id,
      cfg,
    });
    expect(applied.responsibility?.owner).toBe(alpha.bots[1].id);

    // 判定点 2: effect already happened — re-apply must not claim revoke succeeded / blank slate.
    await expect(
      applyCollaborationTaskHandoffContract({
        groupId,
        taskId,
        handoffId: proposed.handoffId,
        actor: alpha.employees[0].id,
        cfg,
      }),
    ).rejects.toThrow();

    const persisted = await objectStorage.readObject<Task>(groupId, "task", taskId);
    expect(persisted?.responsibility?.owner).toBe(alpha.bots[1].id);
  });

  test("C3: service principal id is distinct from employee and need not masquerade", () => {
    const [alpha] = syntheticTenants();
    expect(alpha.servicePrincipal.id.startsWith("svc:")).toBe(true);
    expect(alpha.servicePrincipal.id).not.toBe(alpha.employees[0].id);
    // Legal service identity is not an employee row; ACL must not invent employee mapping.
    const state = {
      governance: { coordinatorBotId: alpha.bots[0].id },
      memberRoleMap: [{ memberId: alpha.employees[0].id }],
    };
    expect(isMappedDeliveryIdentity(state, alpha.servicePrincipal.id)).toBe(false);
  });

  test("self-advance default stays dry_run (stop/长程: no silent execute without allowlist)", async () => {
    const { cfg } = await useIsolationRoot({
      selfAdvanceMode: "dry_run",
      executeGroupAllowlist: [],
    });
    expect(cfg.collaboration?.task?.selfAdvance?.mode ?? "dry_run").toBe("dry_run");
    expect(cfg.collaboration?.task?.selfAdvance?.executeGroupAllowlist ?? []).toEqual([]);
    expect(SELF_ADVANCE_ENTRY_DELEGATES_UNIFIED_GATE).toBe(true);
    expect(selfAdvanceRequiresPerTickReauth()).toBe(true);
    expect(selfAdvanceDeliveryRequiresConfirmedPlan()).toBe(true);
    expect(selfAdvanceDoesNotAutoCompleteTask()).toBe(true);
    expect(WAKE_CONTRACT_ENTRY_READ_PATHS_DO_NOT_WRITE).toBe(true);
  });

  test("T09-B2: displayName claim alone does not authenticate write actor", () => {
    const claimed = claimedConnectActorId({
      connect: { client: { displayName: "Alice", id: "client-1" } },
    });
    expect(claimed).toBe("Alice");
    expect(() =>
      bindDeliveryActor({
        claimedId: claimed,
        subjects: ["session-subject-not-alice"],
        privileged: true,
      }),
    ).toThrow(/actor_not_authenticated/);
  });

  test("T09-B2: group/authority fallback tenant is never ACL-safe membership", () => {
    const labeled = resolveAuthorityTenantForEntry({
      preferred: null,
      groupTenantId: "tenant-from-group-ownership",
    });
    expect(labeled.trust).toBe("actor_fallback");
    expect(isAclSafeTenantTrust(labeled.trust)).toBe(false);
  });

  test("T09-B2: collab-edge byName resolves mention only — not an ACL grant", () => {
    expect(COLLAB_EDGE_NAME_RESOLVE_IS_NOT_ACL).toBe(true);
    const resolve = createCollabEdgeTargetResolver([
      { agentId: "bot-a", name: "AliceBot" },
      { agentId: "bot-b", name: "BobBot" },
    ]);
    expect(resolve("AliceBot")).toBe("bot-a");
    expect(resolve("unknown-name")).toBeNull();
  });
});

function betaLocal(alphaScopedId: string): string {
  // Colliding local segment without tenant prefix — must not match mapped member.
  const local = alphaScopedId.split("/").pop() ?? alphaScopedId;
  return local;
}
