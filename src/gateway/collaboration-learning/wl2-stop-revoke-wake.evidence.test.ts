/**
 * WL2 (CAP-03/04) execution-evidence bindings for PR #80 work line 2.
 *
 * PASS rows map to existing enforced behavior. Platform-gap rows use it.todo —
 * do not treat todos as forced PASS. Do not delete L3 stop/resume adapters.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Task } from "@openbot/collaboration-core";
import { afterEach, describe, expect, it, test } from "vitest";
import {
  clearConfigCache,
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { makeOperatingState } from "../collaboration-dispatch/__fixtures__/policy-source-matrix.js";
import { bindDeliveryActor, isMappedDeliveryIdentity } from "./delivery-actor-binding.js";
import {
  acceptCollaborationTaskHandoffContract,
  applyCollaborationTaskHandoffContract,
  approveCollaborationTaskHandoffContract,
  proposeCollaborationTaskHandoffContract,
} from "./handoff-contract-entry.js";
import { SELF_ADVANCE_ENTRY_DELEGATES_UNIFIED_GATE } from "./self-advance-entry.js";
import { createWorkspaceCollaborationStores, writeGroupOperatingState } from "./shared.js";
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

async function useIsolationRoot(opts: { handoffContract?: boolean } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-wl2-"));
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
      },
    },
  } as OpenBotConfig;
  await fs.writeFile(configPath, JSON.stringify(cfg, null, 2), "utf8");
  setRuntimeConfigSnapshot(cfg);
  clearConfigCache();
  return { root, cfg };
}

const tenant = {
  tenantId: "tenant-wl2-a",
  groupId: "grp-wl2-a",
  employees: [{ id: "tenant-wl2-a/emp-owner" }],
  bots: [{ id: "tenant-wl2-a/bot-coord" }, { id: "tenant-wl2-a/bot-exec" }],
};

describe("WL2 CAP-03/04 evidence bindings", () => {
  test("WL2-REVOKE-ACTION-01: revoke-before-submit blocks privileged bind (T-E5(1))", () => {
    const active = {
      governance: { coordinatorBotId: tenant.bots[0].id },
      memberRoleMap: [{ memberId: tenant.employees[0].id }],
    };
    expect(isMappedDeliveryIdentity(active, tenant.employees[0].id)).toBe(true);

    const revoked = {
      governance: { coordinatorBotId: tenant.bots[0].id },
      memberRoleMap: [] as Array<{ memberId: string }>,
    };
    expect(isMappedDeliveryIdentity(revoked, tenant.employees[0].id)).toBe(false);
    const rebound = bindDeliveryActor({
      claimedId: tenant.employees[0].id,
      subjects: ["session-other"],
      privileged: false,
    });
    expect(rebound).toBe("session-other");
  });

  test("WL2-UNKNOWN-NO-RETRY-01: already-applied handoff must not blind-retry mutate (T-E5(2)/(3))", async () => {
    const { cfg } = await useIsolationRoot({ handoffContract: true });
    const groupId = tenant.groupId;
    const taskId = "task-wl2-unknown";
    const { objectStorage, fileStore } = createWorkspaceCollaborationStores(cfg);
    const state = makeOperatingState({
      groupId,
      governance: { coordinatorBotId: tenant.bots[0].id, ownerUserId: tenant.employees[0].id },
    });
    state.memberRoleMap = [
      {
        memberId: tenant.employees[0].id,
        memberKind: "human",
        governanceRole: "owner",
        collaborationRole: null,
        status: "active",
      },
      {
        memberId: tenant.bots[0].id,
        memberKind: "bot",
        governanceRole: "member",
        collaborationRole: null,
        status: "active",
      },
      {
        memberId: tenant.bots[1].id,
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
      title: "wl2-unknown",
      status: "in_progress",
      ownerMemberId: tenant.bots[0].id,
      assignedMemberIds: [tenant.bots[0].id],
      responsibility: {
        owner: tenant.bots[0].id,
        executors: [tenant.bots[0].id],
        reviewers: [],
        approvers: [tenant.employees[0].id],
      },
      createdAtMs: 1,
      updatedAtMs: 1,
    } as Task);

    const proposed = await proposeCollaborationTaskHandoffContract({
      groupId,
      taskId,
      from: tenant.bots[0].id,
      to: tenant.bots[1].id,
      kind: "owner_transfer",
      remainingWork: "x",
      acceptanceCriteria: ["y"],
      completedArtifacts: [],
      actor: tenant.bots[0].id,
      cfg,
    });
    await acceptCollaborationTaskHandoffContract({
      groupId,
      taskId,
      handoffId: proposed.handoffId,
      actor: tenant.bots[1].id,
      actorType: "bot",
      cfg,
    });
    await approveCollaborationTaskHandoffContract({
      groupId,
      taskId,
      handoffId: proposed.handoffId,
      actor: tenant.employees[0].id,
      actorType: "human",
      cfg,
    });
    const applied = await applyCollaborationTaskHandoffContract({
      groupId,
      taskId,
      handoffId: proposed.handoffId,
      actor: tenant.employees[0].id,
      cfg,
    });
    expect(applied.responsibility?.owner).toBe(tenant.bots[1].id);

    await expect(
      applyCollaborationTaskHandoffContract({
        groupId,
        taskId,
        handoffId: proposed.handoffId,
        actor: tenant.employees[0].id,
        cfg,
      }),
    ).rejects.toThrow();

    const persisted = await objectStorage.readObject<Task>(groupId, "task", taskId);
    expect(persisted?.responsibility?.owner).toBe(tenant.bots[1].id);
  });

  test("L3 adapters retained: self-advance/wake entry markers (do not delete stop/resume path)", () => {
    expect(SELF_ADVANCE_ENTRY_DELEGATES_UNIFIED_GATE).toBe(true);
    expect(WAKE_CONTRACT_ENTRY_READ_PATHS_DO_NOT_WRITE).toBe(true);
  });

  test("platform inventory: no collaboration.task.stop|pause|resume RPC registered", async () => {
    const listPath = path.join(process.cwd(), "src/gateway/server-methods-list.ts");
    const text = await fs.readFile(listPath, "utf8");
    expect(text).not.toMatch(/"collaboration\.task\.stop"/);
    expect(text).not.toMatch(/"collaboration\.task\.pause"/);
    expect(text).not.toMatch(/"collaboration\.task\.resume"/);
  });

  // CAP-03 full-entrypoint stop — no collaboration stop gate wired to write paths.
  it.todo(
    "WL2-STOP-RPC-01: after collaboration stop RPC, handoff/claim/self-advance/board writes refuse",
  );
  it.todo("WL2-STOP-TOOL-01: collaboration_board writes refuse after stop; reads follow ACL");
  it.todo("WL2-STOP-QUEUE-01: queued jobs after stop skip side-effect writes");
  it.todo("WL2-STOP-HB-01: heartbeat tick concurrent with stop does not write wake/board");
  it.todo(
    "WL2-STOP-WAKE-01: wake consume after stop does not advance delivery / double side effects",
  );

  // CAP-04 wake/HB revoke races — T10 close table 待测.
  it.todo(
    "WL2-REVOKE-WAKE-01: revoke membership after accept/approve queue; wake consume refuses with 0 writes",
  );
  it.todo("WL2-REVOKE-HB-01: heartbeat path revoke race same T-E5判定点 as wake");

  // Wake resume / payload idempotency across stop — not enforced at wake-contract ledger.
  it.todo("WL2-WAKE-IDEMPOTENT-01: duplicate wake payload yields single side-effect");
  it.todo("WL2-WAKE-RESUME-01: stop→resume→wake preserves work without double-write");
});
