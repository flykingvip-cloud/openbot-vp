/**
 * P2 R4 — minimal real Mode B boot + ACL formal submit path.
 *
 * Production: consumeWakeForRoundDispatch → createModeBWakeRoundDispatcher /
 * resolveModeBWakeRoundContext (identity, scope, current attempt, ACL enforce true).
 * Mocked: model reply only (getReplyFromConfig) + space listing + ownership SoT reads
 * required for managed composition (same as wake-round-dispatcher-boot.test).
 * Does NOT replace boot runBot; does NOT call finalizeMemberRunTeamDeliverable with
 * enforceAcl:false as the happy-path proof.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Task } from "@openbot/collaboration-core";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  clearConfigCache,
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { makeOperatingState } from "../collaboration-dispatch/__fixtures__/policy-source-matrix.js";
import {
  applyClaim,
  claimBoardItem,
  loadBoardClaimItem,
  markBoardItemInProgress,
  publishBoardItem,
  returnBoardItemSubmission,
  submitBoardItemForReview,
} from "../collaboration-dispatch/claim-contract.js";
import { createModeBWakeRoundDispatcher } from "../collaboration-dispatch/mode-b-wake-round-dispatcher.js";
import { createRoundPolicySnapshot } from "../collaboration-dispatch/round-policy-snapshot.js";
import {
  createRuntimeAuthority,
  type RuntimeAuthority,
} from "../collaboration-dispatch/runtime-authority.js";
import {
  resolveModeBWakeRoundContext,
  unbindGatewayWakeRoundDispatcher,
} from "../wake-round-dispatcher-boot.js";
import { persistAuthoritativeGroupMembers } from "../workspace/group-acl.js";
import { resolveTrustedGroupLocator } from "../workspace/group-locator.js";
import { finalizeMemberRunTeamDeliverable } from "./chat-deliverable-team-submit.js";
import { triggerPostSubmissionEventAdvance } from "./post-submission-event-advance.js";
import { writeGroupOperatingState } from "./shared.js";
import { readTeamDeliverable } from "./team-deliverable-submit.js";
import {
  P2_LINKED_DELIVERABLE_FIXTURE_BODY,
  seedLinkedTeamDeliverableFixture,
  trustedLocatorFromAuthority,
} from "./verify-linked-team-deliverable.js";

const getReplyFromConfig = vi.hoisted(() => vi.fn());
const listGatewayCollaborationSpaces = vi.hoisted(() => vi.fn());
const findActiveOwnershipRecord = vi.hoisted(() => vi.fn());
const finalizeSpy = vi.hoisted(() => ({ last: null as unknown, calls: 0 }));

vi.mock("../../auto-reply/reply.js", () => ({
  getReplyFromConfig: (...args: unknown[]) => getReplyFromConfig(...args),
}));

vi.mock("./space-store.js", () => ({
  listGatewayCollaborationSpaces: (...args: unknown[]) => listGatewayCollaborationSpaces(...args),
}));

vi.mock("../ownership-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ownership-store.js")>();
  return {
    ...actual,
    findActiveOwnershipRecord: (...args: unknown[]) => findActiveOwnershipRecord(...args),
  };
});

vi.mock("./chat-deliverable-team-submit.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./chat-deliverable-team-submit.js")>();
  return {
    ...actual,
    finalizeMemberRunTeamDeliverable: async (
      ...args: Parameters<typeof actual.finalizeMemberRunTeamDeliverable>
    ) => {
      finalizeSpy.calls += 1;
      const result = await actual.finalizeMemberRunTeamDeliverable(...args);
      finalizeSpy.last = {
        args: args[0],
        outcome: result.outcome,
        text: result.text.slice(0, 400),
      };
      return result;
    },
  };
});

const tempDirs: string[] = [];
const saved = {
  stateDir: process.env.OPENBOT_STATE_DIR,
  tenantsRoot: process.env.OPENBOT_TENANTS_ROOT,
  securityProfile: process.env.OPENBOT_SECURITY_PROFILE,
  configPath: process.env.OPENBOT_CONFIG_PATH,
  openclawConfigPath: process.env.OPENCLAW_CONFIG_PATH,
};

afterEach(async () => {
  unbindGatewayWakeRoundDispatcher();
  clearRuntimeConfigSnapshot();
  clearConfigCache();
  vi.clearAllMocks();
  for (const [key, value] of Object.entries(saved)) {
    const envKey =
      key === "stateDir"
        ? "OPENBOT_STATE_DIR"
        : key === "tenantsRoot"
          ? "OPENBOT_TENANTS_ROOT"
          : key === "securityProfile"
            ? "OPENBOT_SECURITY_PROFILE"
            : key === "configPath"
              ? "OPENBOT_CONFIG_PATH"
              : "OPENCLAW_CONFIG_PATH";
    if (value === undefined) {
      delete process.env[envKey];
    } else {
      process.env[envKey] = value;
    }
  }
  await Promise.all(tempDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

beforeEach(() => {
  listGatewayCollaborationSpaces.mockResolvedValue({ spaces: [] });
  findActiveOwnershipRecord.mockReturnValue(null);
  getReplyFromConfig.mockResolvedValue({ text: "noop" });
  finalizeSpy.calls = 0;
  finalizeSpy.last = null;
});

describe("P2 R4 — real Mode B boot + ACL formal submit", () => {
  async function useManagedRoot() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-p2-r4-modeb-"));
    tempDirs.push(root);
    process.env.OPENBOT_STATE_DIR = path.join(root, "state");
    process.env.OPENBOT_TENANTS_ROOT = path.join(root, "tenants");
    process.env.OPENBOT_SECURITY_PROFILE = "managed_enterprise";
    const cfg = {
      agents: {
        defaults: { workspace: path.join(root, "agent-ws") },
        list: [
          { id: "bot-a", name: "bot-a" },
          { id: "bot-b", name: "bot-b" },
        ],
      },
      gateway: { security: { profile: "managed_enterprise" } },
      collaboration: {
        defaults: { workspace: path.join(root, "collaboration") },
        runtimeNamespace: true,
        task: {
          claimContract: true,
          wakeContract: true,
          // Managed gray keys must be tenantId/groupId (bare "*" never matches with tenant).
          wakeContractGroupAllowlist: ["*/grp_p2_modeb", "*/grp_p2_miss_bind", "*/grp_p2_revoked"],
          selfAdvance: {
            mode: "execute",
            executeGroupAllowlist: ["*/grp_p2_modeb", "*/grp_p2_miss_bind", "*/grp_p2_revoked"],
          },
        },
      },
    } as OpenBotConfig;
    const configPath = path.join(root, "openbot.json");
    await fs.writeFile(configPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
    process.env.OPENBOT_CONFIG_PATH = configPath;
    process.env.OPENCLAW_CONFIG_PATH = configPath;
    setRuntimeConfigSnapshot(cfg, cfg);
    clearConfigCache();
    return { root, cfg };
  }

  function authority(cfg: OpenBotConfig, groupId: string, tenantId: string): RuntimeAuthority {
    const snapshot = createRoundPolicySnapshot(
      { collaborationMode: "task_driven", finalDecisionMode: "human_required" },
      { now: 1, idGen: () => "pss_p2_r4_modeb" },
    );
    return createRuntimeAuthority({
      snapshot,
      episodeId: "ep_p2_r4_modeb",
      tenant: { tenantId, trust: "membership" },
      groupId,
      profile: "managed_enterprise",
      cfg,
    });
  }

  function seedActiveOwnership(params: { tenantId: string; groupId: string }) {
    findActiveOwnershipRecord.mockImplementation(
      (query: { tenantId: string; subjectKind: string; subjectId: string }) => {
        if (
          query.subjectKind === "group" &&
          query.subjectId === params.groupId &&
          query.tenantId === params.tenantId
        ) {
          return {
            id: `${params.tenantId}:group:${params.groupId}`,
            tenantId: params.tenantId,
            subjectKind: "group",
            subjectId: params.groupId,
            bindingStatus: "active",
          };
        }
        return null;
      },
    );
  }

  async function seedMembersAndTask(params: {
    cfg: OpenBotConfig;
    tenantId: string;
    groupId: string;
    agentId: string;
    reviewerId: string;
    peerId: string;
    taskId: string;
  }) {
    await persistAuthoritativeGroupMembers({
      groupId: params.groupId,
      tenantId: params.tenantId,
      profile: "managed_enterprise",
      cfg: params.cfg,
      members: [
        {
          memberId: `m-${params.agentId}`,
          memberKind: "bot",
          agentId: params.agentId,
          userId: params.agentId,
          governanceRole: "member",
          status: "active",
          updatedAtMs: Date.now(),
        },
        {
          memberId: `m-${params.reviewerId}`,
          memberKind: "bot",
          agentId: params.reviewerId,
          userId: params.reviewerId,
          governanceRole: "member",
          status: "active",
          updatedAtMs: Date.now(),
        },
        {
          memberId: `m-peer`,
          memberKind: "human",
          userId: params.peerId,
          governanceRole: "owner",
          status: "active",
          updatedAtMs: Date.now(),
        },
      ],
    });
    const groupLocator = resolveTrustedGroupLocator({
      groupId: params.groupId,
      tenantId: params.tenantId,
      profile: "managed_enterprise",
      cfg: params.cfg,
    });
    const { createTrustedGroupStores } = await import("./team-resource-auth.js");
    const stores = createTrustedGroupStores({
      groupsRoot: path.dirname(groupLocator),
      groupLocator,
    });
    const now = Date.now();
    await stores.objectStorage.writeObject(params.groupId, "task", params.taskId, {
      taskId: params.taskId,
      groupId: params.groupId,
      title: params.taskId,
      status: "in_progress",
      ownerMemberId: params.reviewerId,
      assignedMemberIds: [params.agentId, params.reviewerId],
      createdBy: params.reviewerId,
      updatedBy: params.reviewerId,
      createdAtMs: now,
      updatedAtMs: now,
    } satisfies Task);
    await stores.groupStorage.writeProfile({
      groupId: params.groupId,
      groupCode: params.groupId,
      displayName: params.groupId,
      ownerUserId: params.peerId,
      coordinatorBotId: params.reviewerId,
      createdAtMs: now,
      updatedAtMs: now,
    });
    await stores.groupStorage.writeMembers(params.groupId, [
      {
        memberId: `m-${params.agentId}`,
        memberKind: "bot",
        agentId: params.agentId,
        userId: params.agentId,
        governanceRole: "member",
        status: "active",
        updatedAtMs: now,
      },
      {
        memberId: `m-${params.reviewerId}`,
        memberKind: "bot",
        agentId: params.reviewerId,
        userId: params.reviewerId,
        governanceRole: "member",
        status: "active",
        updatedAtMs: now,
      },
      {
        memberId: `m-peer`,
        memberKind: "human",
        userId: params.peerId,
        governanceRole: "owner",
        status: "active",
        updatedAtMs: now,
      },
    ]);
    await writeGroupOperatingState({
      fileStore: stores.fileStore,
      groupId: params.groupId,
      groupRootDir: stores.groupsRoot,
      cfg: params.cfg,
      state: {
        ...makeOperatingState({
          groupId: params.groupId,
          governance: {
            ownerUserId: params.peerId,
            coordinatorBotId: params.reviewerId,
          },
        }),
        memberRoleMap: [
          {
            memberId: params.agentId,
            memberKind: "bot",
            status: "active",
            governanceRole: "member",
            collaborationRole: "contributor",
          },
          {
            memberId: params.reviewerId,
            memberKind: "bot",
            status: "active",
            governanceRole: "member",
            collaborationRole: "contributor",
          },
          {
            memberId: params.peerId,
            memberKind: "human",
            status: "active",
            governanceRole: "owner",
            collaborationRole: "owner",
          },
        ],
      } as never,
    });
    return { groupLocator, stores };
  }

  async function seedReturnedBoard(params: {
    auth: RuntimeAuthority;
    cfg: OpenBotConfig;
    taskId: string;
    claimant: string;
    reviewer: string;
  }) {
    const seedTask: Task = {
      taskId: params.taskId,
      groupId: params.auth.groupId,
      title: "mode-b revise",
      status: "in_progress",
      ownerMemberId: params.reviewer,
      assignedMemberIds: [params.claimant, params.reviewer],
      createdBy: params.reviewer,
      updatedBy: params.reviewer,
      createdAtMs: 1,
      updatedAtMs: 1,
    };
    const published = await publishBoardItem(
      params.auth,
      {
        groupId: params.auth.groupId,
        taskId: params.taskId,
        remainingWork: "revise short markdown",
        acceptanceCriteria: ["has title", "has body"],
        intendedClaimantIds: [params.claimant],
        publishedBy: params.reviewer,
      },
      { cfg: params.cfg },
    );
    expect(published.ok).toBe(true);
    if (!published.ok) {
      throw new Error(published.message);
    }
    const claimed = await claimBoardItem(
      params.auth,
      {
        taskId: params.taskId,
        itemId: published.value.itemId,
        claimantId: params.claimant,
      },
      { cfg: params.cfg },
    );
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) {
      throw new Error(claimed.message);
    }
    const applied = await applyClaim(
      params.auth,
      { taskId: params.taskId, itemId: published.value.itemId },
      seedTask,
      params.auth.policy.effective,
      { cfg: params.cfg },
    );
    expect(applied.ok).toBe(true);
    if (!applied.ok) {
      throw new Error(applied.message);
    }
    const { proposeTodolist, confirmTodolist } =
      await import("../collaboration-dispatch/executor-private-todolist.js");
    const proposed = await proposeTodolist(
      params.auth,
      {
        boardItemId: published.value.itemId,
        taskId: params.taskId,
        groupId: params.auth.groupId,
        ownerMemberId: params.claimant,
        steps: [{ title: "draft" }, { title: "revise" }],
      },
      { cfg: params.cfg },
    );
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) {
      throw new Error(proposed.message);
    }
    const confirmed = await confirmTodolist(
      params.auth,
      {
        taskId: params.taskId,
        todolistId: proposed.value.todolistId,
        confirmerId: params.reviewer,
      },
      { cfg: params.cfg, authorizedConfirmerIds: [params.reviewer] },
    );
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) {
      throw new Error(confirmed.message);
    }
    const started = await markBoardItemInProgress(
      params.auth,
      {
        taskId: params.taskId,
        itemId: published.value.itemId,
        actorId: params.claimant,
      },
      { cfg: params.cfg },
    );
    expect(started.ok).toBe(true);
    if (!started.ok) {
      throw new Error(started.message);
    }

    const seeded = await seedLinkedTeamDeliverableFixture({
      authority: params.auth,
      taskId: params.taskId,
      deliverableId: "del-modeb-r4",
      version: 1,
      content: P2_LINKED_DELIVERABLE_FIXTURE_BODY,
    });
    if (!seeded.ok) {
      throw new Error(seeded.reason);
    }
    const submissionId = randomUUID();
    const submitted = await submitBoardItemForReview(
      params.auth,
      {
        taskId: params.taskId,
        itemId: published.value.itemId,
        actorId: params.claimant,
        submissionId,
        artifactVersion: "art-v1",
        submissionSummary: "# Draft v1\nbody",
        linkedDeliverableId: seeded.deliverableId,
        linkedDeliverableVersion: seeded.version,
        linkedContentSha256: seeded.contentSha256,
      },
      { cfg: params.cfg, coordinatorBotId: params.reviewer },
    );
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) {
      throw new Error(submitted.message);
    }
    const returned = await returnBoardItemSubmission(
      params.auth,
      {
        taskId: params.taskId,
        itemId: published.value.itemId,
        actorId: params.reviewer,
        expectedSubmissionId: submissionId,
        reason: "revise section 2",
      },
      { cfg: params.cfg },
    );
    expect(returned.ok).toBe(true);
    if (!returned.ok) {
      throw new Error(returned.message);
    }
    return {
      item: returned.value,
      todolistId: proposed.value.todolistId,
      planVersion: confirmed.value.version,
      submissionId,
    };
  }

  test("real consume → Mode B boot → mock model → ACL submit → deliverable read-back", async () => {
    const { cfg } = await useManagedRoot();
    const groupId = "grp_p2_modeb";
    const tenantId = "tenant-p2-modeb";
    const agentId = "bot-a";
    const reviewerId = "bot-b";
    const peerId = "human-peer";
    const taskId = "task-p2-r4-modeb-boot";

    await seedMembersAndTask({
      cfg,
      tenantId,
      groupId,
      agentId,
      reviewerId,
      peerId,
      taskId,
    });
    seedActiveOwnership({ tenantId, groupId });
    listGatewayCollaborationSpaces.mockResolvedValue({
      spaces: [
        {
          id: groupId,
          groupId,
          title: groupId,
          tenantId,
          members: {
            humans: [{ userId: peerId, name: peerId }],
            bots: [
              { agentId, name: agentId, status: "active" },
              { agentId: reviewerId, name: reviewerId, status: "active" },
            ],
          },
          operatingState: null,
          coordinatorBotId: reviewerId,
        },
      ],
    });
    const auth = authority(cfg, groupId, tenantId);
    const seeded = await seedReturnedBoard({
      auth,
      cfg,
      taskId,
      claimant: agentId,
      reviewer: reviewerId,
    });
    expect(seeded.item.status).toBe("returned");
    expect(seeded.item.pendingEventRelay?.status).toBe("pending");

    // Keep returned+pending through permit linearization. The mock model (agent turn)
    // resumes in_progress before emitting DELIVERABLE — same order as a real member run.
    getReplyFromConfig.mockImplementation(async () => {
      const live = await loadBoardClaimItem(auth, {
        taskId,
        itemId: seeded.item.itemId,
      });
      if (live?.status === "returned") {
        await markBoardItemInProgress(
          auth,
          { taskId, itemId: seeded.item.itemId, actorId: agentId },
          { cfg },
        );
      }
      return {
        text: '完成。\n<<DELIVERABLE title="ModeBR4" file="modeb-r4.md">>\n# revised section 2\nmode-b-boot-acl-body\n<</DELIVERABLE>>',
      };
    });

    const modeBDispatcher = createModeBWakeRoundDispatcher(async (request) =>
      resolveModeBWakeRoundContext(request, cfg),
    );

    const advance = await triggerPostSubmissionEventAdvance({
      groupId,
      taskId,
      itemId: seeded.item.itemId,
      actorId: reviewerId,
      cfg,
      roundDispatcher: modeBDispatcher,
      trusted: trustedLocatorFromAuthority(auth),
      tenant: { tenantId, trust: "membership" },
    });

    expect(advance.dispatched, `advance=${advance.reason}`).toBe(true);
    expect(getReplyFromConfig).toHaveBeenCalled();
    expect(finalizeSpy.calls).toBeGreaterThan(0);
    expect((finalizeSpy.last as { args?: { enforceAcl?: boolean } } | null)?.args?.enforceAcl).toBe(
      true,
    );
    expect((finalizeSpy.last as { outcome?: { ok?: boolean } } | null)?.outcome?.ok).toBe(true);

    const groupLocator = resolveTrustedGroupLocator({
      groupId,
      tenantId,
      profile: "managed_enterprise",
      cfg,
    });
    const deliverablesDir = path.join(groupLocator, "deliverables");
    const files = await fs.readdir(deliverablesDir);
    expect(files.length).toBeGreaterThan(0);
    const bodies = await Promise.all(
      files.map((f) => fs.readFile(path.join(deliverablesDir, f), "utf8")),
    );
    expect(bodies.some((b) => b.includes("mode-b-boot-acl-body"))).toBe(true);

    const { createTrustedGroupStores } = await import("./team-resource-auth.js");
    const stores = createTrustedGroupStores({
      groupsRoot: path.dirname(groupLocator),
      groupLocator,
    });
    const rows = await stores.objectStorage.listObjects<{ deliverableId: string }>(
      groupId,
      "deliverable",
    );
    const written = rows.find((row) => row.deliverableId !== "del-modeb-r4") ?? rows[0];
    expect(written?.deliverableId).toBeTruthy();
    if (!written) {
      throw new Error("expected a deliverable row after Mode B ACL submit");
    }

    const peerRead = await readTeamDeliverable({
      groupId,
      deliverableId: written.deliverableId,
      actor: peerId,
      cfg,
      enforceAcl: true,
      tenant: { tenantId, trust: "membership" },
    });
    expect(peerRead.ok, JSON.stringify(peerRead)).toBe(true);
    if (peerRead.ok) {
      expect(peerRead.content).toContain("mode-b-boot-acl-body");
    }
  });

  test("missing binding → formal submit refuses write (counterexample)", async () => {
    const { cfg } = await useManagedRoot();
    const groupId = "grp_p2_miss_bind";
    const tenantId = "tenant-p2-miss";
    const agentId = "bot-a";
    await seedMembersAndTask({
      cfg,
      tenantId,
      groupId,
      agentId,
      reviewerId: "bot-b",
      peerId: "human-peer",
      taskId: "task-miss",
    });
    seedActiveOwnership({ tenantId, groupId });
    const missing = await finalizeMemberRunTeamDeliverable({
      text: '<<DELIVERABLE title="X" file="x.md">>\nbody\n<</DELIVERABLE>>',
      agentId,
      binding: null,
      cfg,
      tenant: { tenantId, trust: "service_execution" },
      enforceAcl: true,
    });
    expect(missing.outcome.ok).toBe(false);
    if (!missing.outcome.ok) {
      expect(missing.outcome.reason).toBe("execution_binding_required");
    }
  });

  test("ownership revoked → Mode B boot refuses context; no deliverable write", async () => {
    const { cfg } = await useManagedRoot();
    const groupId = "grp_p2_revoked";
    const tenantId = "tenant-p2-rev";
    const agentId = "bot-a";
    const reviewerId = "bot-b";
    const taskId = "task-revoked";
    const seededMeta = await seedMembersAndTask({
      cfg,
      tenantId,
      groupId,
      agentId,
      reviewerId,
      peerId: "human-peer",
      taskId,
    });
    // Space still lists group; ownership SoT revoked/missing.
    findActiveOwnershipRecord.mockReturnValue(null);
    listGatewayCollaborationSpaces.mockResolvedValue({
      spaces: [
        {
          id: groupId,
          groupId,
          title: groupId,
          tenantId,
          members: {
            humans: [],
            bots: [{ agentId, name: agentId, status: "active" }],
          },
          operatingState: null,
          coordinatorBotId: reviewerId,
        },
      ],
    });
    getReplyFromConfig.mockResolvedValue({
      text: '<<DELIVERABLE title="ShouldNot" file="no.md">>\nnope\n<</DELIVERABLE>>',
    });

    const auth = authority(cfg, groupId, tenantId);
    const seeded = await seedReturnedBoard({
      auth,
      cfg,
      taskId,
      claimant: agentId,
      reviewer: reviewerId,
    });

    const modeBDispatcher = createModeBWakeRoundDispatcher(async (request) =>
      resolveModeBWakeRoundContext(request, cfg),
    );
    const advance = await triggerPostSubmissionEventAdvance({
      groupId,
      taskId,
      itemId: seeded.item.itemId,
      actorId: reviewerId,
      cfg,
      roundDispatcher: modeBDispatcher,
      trusted: trustedLocatorFromAuthority(auth),
      tenant: { tenantId, trust: "membership" },
    });
    expect(advance.dispatched).toBe(false);
    expect(getReplyFromConfig).not.toHaveBeenCalled();

    const listing = await fs
      .readdir(path.join(seededMeta.groupLocator, "deliverables"))
      .catch(() => [] as string[]);
    // Fixture seed may exist; ensure no Mode B write of "nope".
    for (const f of listing) {
      const body = await fs.readFile(path.join(seededMeta.groupLocator, "deliverables", f), "utf8");
      expect(body).not.toContain("nope");
    }
  });
});
