/**
 * P3 — two members, one Markdown deliverable short loop (phase lock).
 *
 * Flow: submit → review dispatch → return once → Mode B revise (ACL formal MD)
 * → board resubmit with linked receipt → accept → no further advance/redispatch.
 *
 * Reuses P2 fixtures / event-dispatch / Mode B boot paths — no second scheduler,
 * no new wake budget / WAKE sources, no production flags / real groups.
 *
 * Mode B mock boundary (honest): model reply (getReplyFromConfig) + space list +
 * ownership SoT reads. Real path under test: consume → Mode B boot →
 * resolveModeBWakeRoundContext (enforceAcl:true) → finalizeMemberRunTeamDeliverable.
 */
import { createHash, randomUUID } from "node:crypto";
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
  submitBoardItemForReview,
} from "../collaboration-dispatch/claim-contract.js";
import { createModeBWakeRoundDispatcher } from "../collaboration-dispatch/mode-b-wake-round-dispatcher.js";
import { createRoundPolicySnapshot } from "../collaboration-dispatch/round-policy-snapshot.js";
import {
  createRuntimeAuthority,
  type RuntimeAuthority,
} from "../collaboration-dispatch/runtime-authority.js";
import type { WakeRoundDispatcher } from "../collaboration-dispatch/wake-round-dispatch.js";
import {
  resolveModeBWakeRoundContext,
  unbindGatewayWakeRoundDispatcher,
} from "../wake-round-dispatcher-boot.js";
import { persistAuthoritativeGroupMembers } from "../workspace/group-acl.js";
import { resolveTrustedGroupLocator } from "../workspace/group-locator.js";
import {
  acceptCollaborationBoardItemSubmission,
  returnCollaborationBoardItemSubmission,
  submitCollaborationBoardItemForReview,
} from "./claim-contract-entry.js";
import {
  recoverPendingBoardEventRelays,
  triggerPostSubmissionEventAdvance,
} from "./post-submission-event-advance.js";
import { writeGroupOperatingState } from "./shared.js";
import { readTeamDeliverable } from "./team-deliverable-submit.js";
import {
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

const AUTHOR = "bot-a";
const REVIEWER = "bot-b";
const PEER = "human-peer";
const GROUP_ID = "grp_p3_md_loop";
const TENANT_ID = "tenant-p3-md";
const MD_V1_BODY = "# P3 Draft v1\n\nShort markdown deliverable body.\n";
const MD_V2_BODY = "# P3 Draft v2\n\nRevised after one return — accepted candidate.\n";

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

function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

describe("P3 — two-member Markdown short loop (submit→review→return→revise→accept)", () => {
  async function useManagedRoot() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-p3-md-loop-"));
    tempDirs.push(root);
    process.env.OPENBOT_STATE_DIR = path.join(root, "state");
    process.env.OPENBOT_TENANTS_ROOT = path.join(root, "tenants");
    process.env.OPENBOT_SECURITY_PROFILE = "managed_enterprise";
    const cfg = {
      agents: {
        defaults: { workspace: path.join(root, "agent-ws") },
        list: [
          { id: AUTHOR, name: AUTHOR },
          { id: REVIEWER, name: REVIEWER },
        ],
      },
      gateway: { security: { profile: "managed_enterprise" } },
      collaboration: {
        defaults: { workspace: path.join(root, "collaboration") },
        runtimeNamespace: true,
        task: {
          claimContract: true,
          wakeContract: true,
          // Synthetic gray allowlist only — not a global production flag.
          wakeContractGroupAllowlist: [`*/${GROUP_ID}`],
          selfAdvance: {
            mode: "execute",
            executeGroupAllowlist: [`*/${GROUP_ID}`],
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

  function authority(cfg: OpenBotConfig): RuntimeAuthority {
    const snapshot = createRoundPolicySnapshot(
      { collaborationMode: "task_driven", finalDecisionMode: "human_required" },
      { now: 1, idGen: () => "pss_p3_md_loop" },
    );
    return createRuntimeAuthority({
      snapshot,
      episodeId: "ep_p3_md_loop",
      tenant: { tenantId: TENANT_ID, trust: "membership" },
      groupId: GROUP_ID,
      profile: "managed_enterprise",
      cfg,
    });
  }

  function seedActiveOwnership() {
    findActiveOwnershipRecord.mockImplementation(
      (query: { tenantId: string; subjectKind: string; subjectId: string }) => {
        if (
          query.subjectKind === "group" &&
          query.subjectId === GROUP_ID &&
          query.tenantId === TENANT_ID
        ) {
          return {
            id: `${TENANT_ID}:group:${GROUP_ID}`,
            tenantId: TENANT_ID,
            subjectKind: "group",
            subjectId: GROUP_ID,
            bindingStatus: "active",
          };
        }
        return null;
      },
    );
  }

  async function seedMembersAndTask(params: { cfg: OpenBotConfig; taskId: string }) {
    await persistAuthoritativeGroupMembers({
      groupId: GROUP_ID,
      tenantId: TENANT_ID,
      profile: "managed_enterprise",
      cfg: params.cfg,
      members: [
        {
          memberId: `m-${AUTHOR}`,
          memberKind: "bot",
          agentId: AUTHOR,
          userId: AUTHOR,
          governanceRole: "member",
          status: "active",
          updatedAtMs: Date.now(),
        },
        {
          memberId: `m-${REVIEWER}`,
          memberKind: "bot",
          agentId: REVIEWER,
          userId: REVIEWER,
          governanceRole: "member",
          status: "active",
          updatedAtMs: Date.now(),
        },
        {
          memberId: `m-peer`,
          memberKind: "human",
          userId: PEER,
          governanceRole: "owner",
          status: "active",
          updatedAtMs: Date.now(),
        },
      ],
    });
    const groupLocator = resolveTrustedGroupLocator({
      groupId: GROUP_ID,
      tenantId: TENANT_ID,
      profile: "managed_enterprise",
      cfg: params.cfg,
    });
    const { createTrustedGroupStores } = await import("./team-resource-auth.js");
    const stores = createTrustedGroupStores({
      groupsRoot: path.dirname(groupLocator),
      groupLocator,
    });
    const now = Date.now();
    await stores.objectStorage.writeObject(GROUP_ID, "task", params.taskId, {
      taskId: params.taskId,
      groupId: GROUP_ID,
      title: "P3 short markdown deliverable",
      status: "in_progress",
      ownerMemberId: REVIEWER,
      assignedMemberIds: [AUTHOR, REVIEWER],
      createdBy: REVIEWER,
      updatedBy: REVIEWER,
      createdAtMs: now,
      updatedAtMs: now,
    } satisfies Task);
    await stores.groupStorage.writeProfile({
      groupId: GROUP_ID,
      groupCode: GROUP_ID,
      displayName: GROUP_ID,
      ownerUserId: PEER,
      coordinatorBotId: REVIEWER,
      createdAtMs: now,
      updatedAtMs: now,
    });
    await stores.groupStorage.writeMembers(GROUP_ID, [
      {
        memberId: `m-${AUTHOR}`,
        memberKind: "bot",
        agentId: AUTHOR,
        userId: AUTHOR,
        governanceRole: "member",
        status: "active",
        updatedAtMs: now,
      },
      {
        memberId: `m-${REVIEWER}`,
        memberKind: "bot",
        agentId: REVIEWER,
        userId: REVIEWER,
        governanceRole: "member",
        status: "active",
        updatedAtMs: now,
      },
      {
        memberId: `m-peer`,
        memberKind: "human",
        userId: PEER,
        governanceRole: "owner",
        status: "active",
        updatedAtMs: now,
      },
    ]);
    await writeGroupOperatingState({
      fileStore: stores.fileStore,
      groupId: GROUP_ID,
      groupRootDir: stores.groupsRoot,
      cfg: params.cfg,
      state: {
        ...makeOperatingState({
          groupId: GROUP_ID,
          governance: {
            ownerUserId: PEER,
            coordinatorBotId: REVIEWER,
          },
        }),
        memberRoleMap: [
          {
            memberId: AUTHOR,
            memberKind: "bot",
            status: "active",
            governanceRole: "member",
            collaborationRole: "contributor",
          },
          {
            memberId: REVIEWER,
            memberKind: "bot",
            status: "active",
            governanceRole: "member",
            collaborationRole: "contributor",
          },
          {
            memberId: PEER,
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

  async function seedAuthorInProgress(params: {
    auth: RuntimeAuthority;
    cfg: OpenBotConfig;
    taskId: string;
  }) {
    const seedTask: Task = {
      taskId: params.taskId,
      groupId: GROUP_ID,
      title: "P3 short markdown deliverable",
      status: "in_progress",
      ownerMemberId: REVIEWER,
      assignedMemberIds: [AUTHOR, REVIEWER],
      createdBy: REVIEWER,
      updatedBy: REVIEWER,
      createdAtMs: 1,
      updatedAtMs: 1,
    };
    const published = await publishBoardItem(
      params.auth,
      {
        groupId: GROUP_ID,
        taskId: params.taskId,
        remainingWork: "write short markdown",
        acceptanceCriteria: ["has title", "has body"],
        intendedClaimantIds: [AUTHOR],
        publishedBy: REVIEWER,
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
        claimantId: AUTHOR,
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
        groupId: GROUP_ID,
        ownerMemberId: AUTHOR,
        steps: [{ title: "draft short md" }, { title: "revise if returned once" }],
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
        confirmerId: REVIEWER,
      },
      { cfg: params.cfg, authorizedConfirmerIds: [REVIEWER] },
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
        actorId: AUTHOR,
      },
      { cfg: params.cfg },
    );
    expect(started.ok).toBe(true);
    if (!started.ok) {
      throw new Error(started.message);
    }
    return {
      item: started.value,
      todolistId: proposed.value.todolistId,
      planVersion: confirmed.value.version,
    };
  }

  test("two members one MD: submit→review→return once→Mode B revise→accept; no further advance", async () => {
    const { cfg } = await useManagedRoot();
    const taskId = "task-p3-two-member-md-loop";
    await seedMembersAndTask({ cfg, taskId });
    seedActiveOwnership();
    listGatewayCollaborationSpaces.mockResolvedValue({
      spaces: [
        {
          id: GROUP_ID,
          groupId: GROUP_ID,
          title: GROUP_ID,
          tenantId: TENANT_ID,
          members: {
            humans: [{ userId: PEER, name: PEER }],
            bots: [
              { agentId: AUTHOR, name: AUTHOR, status: "active" },
              { agentId: REVIEWER, name: REVIEWER, status: "active" },
            ],
          },
          operatingState: null,
          coordinatorBotId: REVIEWER,
        },
      ],
    });
    const auth = authority(cfg);
    expect(AUTHOR).not.toBe(REVIEWER);

    const seeded = await seedAuthorInProgress({ auth, cfg, taskId });
    const v1 = await seedLinkedTeamDeliverableFixture({
      authority: auth,
      taskId,
      deliverableId: "del-p3-md-v1",
      version: 1,
      content: MD_V1_BODY,
    });
    if (!v1.ok) {
      throw new Error(v1.reason);
    }
    expect(v1.contentSha256).toBe(sha256Hex(MD_V1_BODY));

    // 1) Author submit (board + linked MD artifact)
    const submissionId1 = randomUUID();
    const trusted = trustedLocatorFromAuthority(auth);
    const tenant = { tenantId: TENANT_ID, trust: "membership" as const };
    await submitCollaborationBoardItemForReview({
      groupId: GROUP_ID,
      taskId,
      itemId: seeded.item.itemId,
      submissionId: submissionId1,
      artifactVersion: "art-v1",
      submissionSummary: MD_V1_BODY.trim(),
      linkedDeliverableId: v1.deliverableId,
      linkedDeliverableVersion: v1.version,
      linkedContentSha256: v1.contentSha256,
      actor: AUTHOR,
      cfg,
      trusted,
      tenant,
      relayAdvance: false,
    });

    // 2) Review dispatch (reviewer principal) — counting mock; reuse nudge consume path
    let reviewCalls = 0;
    let reviewPrompt = "";
    const reviewAdvance = await triggerPostSubmissionEventAdvance({
      groupId: GROUP_ID,
      taskId,
      itemId: seeded.item.itemId,
      actorId: REVIEWER,
      cfg,
      roundDispatcher: async (req) => {
        reviewCalls += 1;
        reviewPrompt = req.dispatchPrompt ?? "";
        return { ok: true, roundId: "p3-review" };
      },
      trusted,
      tenant,
    });
    expect(reviewAdvance.dispatched, `review=${reviewAdvance.reason}`).toBe(true);
    expect(reviewCalls).toBe(1);
    expect(reviewPrompt).toContain("intent=review_submission");

    // 3) Return once (reviewer)
    const ret = await returnCollaborationBoardItemSubmission({
      groupId: GROUP_ID,
      taskId,
      itemId: seeded.item.itemId,
      expectedSubmissionId: submissionId1,
      reason: "revise body once for P3 short loop",
      actor: REVIEWER,
      cfg,
      trusted,
      tenant,
      relayAdvance: false,
    });
    expect(ret.item.status).toBe("returned");
    expect(ret.item.pendingEventRelay?.businessEvent).toBe("returned");
    expect(ret.item.pendingEventRelay?.returnRevision).toBe(1);

    // 4) Return-revise via Mode B (author) → ACL formal MD write
    getReplyFromConfig.mockImplementation(async () => {
      const live = await loadBoardClaimItem(auth, {
        taskId,
        itemId: seeded.item.itemId,
      });
      if (live?.status === "returned") {
        await markBoardItemInProgress(
          auth,
          { taskId, itemId: seeded.item.itemId, actorId: AUTHOR },
          { cfg },
        );
      }
      return {
        text:
          '完成修订。\n<<DELIVERABLE title="P3MDv2" file="p3-md-v2.md">>\n' +
          `${MD_V2_BODY}<</DELIVERABLE>>`,
      };
    });

    const modeBDispatcher = createModeBWakeRoundDispatcher(async (request) =>
      resolveModeBWakeRoundContext(request, cfg),
    );
    let returnPrompt = "";
    const wrappedModeB: WakeRoundDispatcher = async (req) => {
      returnPrompt = req.dispatchPrompt ?? "";
      return modeBDispatcher(req);
    };
    const returnAdvance = await triggerPostSubmissionEventAdvance({
      groupId: GROUP_ID,
      taskId,
      itemId: seeded.item.itemId,
      actorId: REVIEWER,
      cfg,
      roundDispatcher: wrappedModeB,
      trusted,
      tenant,
    });
    expect(returnAdvance.dispatched, `returnAdvance=${returnAdvance.reason}`).toBe(true);
    expect(returnPrompt).toContain("intent=return_revise");
    expect(returnPrompt).not.toContain("intent=review_submission");
    expect(getReplyFromConfig).toHaveBeenCalled();
    expect(finalizeSpy.calls).toBeGreaterThan(0);
    expect((finalizeSpy.last as { args?: { enforceAcl?: boolean } } | null)?.args?.enforceAcl).toBe(
      true,
    );
    const finalizeOutcome = (
      finalizeSpy.last as {
        outcome?: {
          ok?: boolean;
          deliverableId?: string;
          version?: number;
          contentSha256?: string;
        };
      } | null
    )?.outcome;
    expect(finalizeOutcome?.ok).toBe(true);
    if (!finalizeOutcome?.ok || !finalizeOutcome.deliverableId || !finalizeOutcome.contentSha256) {
      throw new Error(`Mode B ACL submit missing receipt: ${JSON.stringify(finalizeOutcome)}`);
    }
    expect(finalizeOutcome.contentSha256).toBe(sha256Hex(MD_V2_BODY.trim()));

    // Dual-track: board formal resubmit linked to Mode B MD receipt
    const afterModeB = await loadBoardClaimItem(auth, {
      taskId,
      itemId: seeded.item.itemId,
    });
    expect(afterModeB?.status).toBe("in_progress");
    const submissionId2 = randomUUID();
    const resubmitted = await submitBoardItemForReview(
      auth,
      {
        taskId,
        itemId: seeded.item.itemId,
        actorId: AUTHOR,
        submissionId: submissionId2,
        artifactVersion: "art-v2",
        submissionSummary: MD_V2_BODY.trim(),
        linkedDeliverableId: finalizeOutcome.deliverableId,
        linkedDeliverableVersion: finalizeOutcome.version ?? 1,
        linkedContentSha256: finalizeOutcome.contentSha256,
      },
      { cfg, coordinatorBotId: REVIEWER },
    );
    expect(resubmitted.ok, resubmitted.ok ? "" : resubmitted.message).toBe(true);
    if (!resubmitted.ok) {
      throw new Error(resubmitted.message);
    }
    expect(resubmitted.value.status).toBe("submitted_for_review");
    const staleAfterResubmit = resubmitted.value.pendingEventRelay ?? null;

    // 5) Accept (reviewer) — end of short loop
    const accepted = await acceptCollaborationBoardItemSubmission({
      groupId: GROUP_ID,
      taskId,
      itemId: seeded.item.itemId,
      expectedSubmissionId: submissionId2,
      reason: "P3 short loop accept",
      checkedAcceptanceCriteria: ["has title", "has body"],
      actor: REVIEWER,
      cfg,
      trusted,
      tenant,
      relayAdvance: false,
    });
    expect(accepted.item.status).toBe("accepted");
    expect(accepted.item.pendingEventRelay).toBeNull();

    // MD artifact read-back (peer ACL) — content is the deliverable
    const peerRead = await readTeamDeliverable({
      groupId: GROUP_ID,
      deliverableId: finalizeOutcome.deliverableId,
      actor: PEER,
      cfg,
      enforceAcl: true,
      tenant: { tenantId: TENANT_ID, trust: "membership" },
    });
    expect(peerRead.ok, JSON.stringify(peerRead)).toBe(true);
    if (peerRead.ok) {
      expect(peerRead.content).toContain("Revised after one return");
      expect(peerRead.content).toContain("# P3 Draft v2");
    }

    // 6) After accept: no further advance / redispatch for this submission chain
    let postAcceptCalls = 0;
    const postAccept: WakeRoundDispatcher = async () => {
      postAcceptCalls += 1;
      return { ok: true, roundId: "p3-must-not-run" };
    };
    const afterAcceptAdvance = await triggerPostSubmissionEventAdvance({
      groupId: GROUP_ID,
      taskId,
      itemId: seeded.item.itemId,
      actorId: REVIEWER,
      cfg,
      roundDispatcher: postAccept,
      trusted,
      tenant,
    });
    expect(afterAcceptAdvance.dispatched).toBe(false);
    expect(postAcceptCalls).toBe(0);

    const staleAdvance = await triggerPostSubmissionEventAdvance({
      groupId: GROUP_ID,
      taskId,
      itemId: seeded.item.itemId,
      actorId: REVIEWER,
      pending: staleAfterResubmit ?? undefined,
      cfg,
      roundDispatcher: postAccept,
      trusted,
      tenant,
    });
    expect(staleAdvance.dispatched).toBe(false);
    expect(postAcceptCalls).toBe(0);
    expect(
      staleAdvance.reason === "accepted_no_further_exec_schedule" ||
        staleAdvance.reason === "pending_opkey_stale_or_superseded" ||
        staleAdvance.reason === "no_pending_event_relay" ||
        afterAcceptAdvance.reason === "accepted_no_further_exec_schedule" ||
        afterAcceptAdvance.reason === "no_pending_event_relay",
    ).toBe(true);

    const acceptedItem = await loadBoardClaimItem(auth, {
      taskId,
      itemId: seeded.item.itemId,
    });
    const recovered = await recoverPendingBoardEventRelays({
      groupId: GROUP_ID,
      taskId,
      actorId: REVIEWER,
      items: acceptedItem ? [acceptedItem] : [],
      cfg,
      roundDispatcher: postAccept,
      trusted: trustedLocatorFromAuthority(auth),
      authority: auth,
      tenant: { tenantId: TENANT_ID, trust: "membership" },
    });
    expect(recovered).toHaveLength(0);
    expect(postAcceptCalls).toBe(0);

    // Return-once invariant: only one returnRevision observed on the chain
    expect(ret.item.pendingEventRelay?.returnRevision).toBe(1);
  });
});
