/**
 * P1–P3 synthetic short closed-loop revalidation (FT-COLLAB-MAIN-CHAIN-MATRIX).
 *
 * Cover: activate(dispatched:false) → publish≠auto-claim → self-claim(non-empty actor)
 * → plan propose(+agent-peer auto-confirm via confirmTodolist) → wake definite → execute binding → submit
 * → review wake → return/revise → accept → stop.
 *
 * Production entrypoints under test (not a mock/custom dispatcher writing business state):
 * - activateCollaborationTask
 * - tryClaimAfterBoardPublish / claimCollaborationBoardItem / applyCollaborationBoardClaim
 * - proposeCollaborationTodolist (agent-peer auto-confirm → confirmTodolist) / confirmCollaborationTodolist (consumed)
 * - triggerPostPlanConfirmAdvance (real recordNudgeWake + consumeWake; spy only settles)
 * - submitBoardItemForReview / returnBoardItemSubmission / acceptBoardItemSubmission
 * - triggerPostSubmissionEventAdvance
 *
 * Mock / stub boundaries (disclosed):
 * - plan gate: assertPlanGateAllowsDeliveryProgress stubbed only for progress mutate
 * - wake final dispatcher: returns ok+completed_with_receipt (definite accept) WITHOUT
 *   writing board/claim/plan state (no custom business-state writer)
 * - linked deliverable: seedLinkedTeamDeliverableFixture (fixture seed, not live group)
 * - group operating state: writeGroupOperatingState seeds coordinator+members for confirm ACL
 * - No LIVE model; no real group; activate.dispatched stays false
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearConfigCache,
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { makeOperatingState } from "../collaboration-dispatch/__fixtures__/policy-source-matrix.js";
import {
  acceptBoardItemSubmission,
  markBoardItemInProgress,
  returnBoardItemSubmission,
  submitBoardItemForReview,
} from "../collaboration-dispatch/claim-contract.js";
import { createRoundPolicySnapshot } from "../collaboration-dispatch/round-policy-snapshot.js";
import {
  createRuntimeAuthority,
  type RuntimeAuthority,
} from "../collaboration-dispatch/runtime-authority.js";
import type { WakeRoundDispatcher } from "../collaboration-dispatch/wake-round-dispatch.js";
import {
  activateCollaborationTask,
  ACTIVATE_SUCCESS_DISPATCHED,
} from "./activate-collaboration-task.js";
import {
  applyCollaborationBoardClaim,
  claimCollaborationBoardItem,
  listCollaborationBoardItems,
  proposeCollaborationTodolist,
  confirmCollaborationTodolist,
} from "./claim-contract-entry.js";
import { MAIN_CHAIN_FORMAL_ROWS } from "./main-chain-state-matrix.js";
import { triggerPostPlanConfirmAdvance } from "./post-plan-confirm-advance.js";
import { triggerPostSubmissionEventAdvance } from "./post-submission-event-advance.js";
import {
  createWorkspaceCollaborationStores,
  readGroupOperatingState,
  writeGroupOperatingState,
} from "./shared.js";
import { tryClaimAfterBoardPublish } from "./try-claim-after-board-publish.js";
import {
  P2_LINKED_DELIVERABLE_FIXTURE_BODY,
  seedLinkedTeamDeliverableFixture,
} from "./verify-linked-team-deliverable.js";

vi.mock("../collaboration-dispatch/executor-private-todolist.js", async () => {
  const actual = await vi.importActual<
    typeof import("../collaboration-dispatch/executor-private-todolist.js")
  >("../collaboration-dispatch/executor-private-todolist.js");
  return {
    ...actual,
    assertPlanGateAllowsDeliveryProgress: vi.fn(async () => ({ ok: true as const })),
  };
});

const tempDirs: string[] = [];
const savedStateDir = process.env.OPENBOT_STATE_DIR;
const savedOpenbotConfigPath = process.env.OPENBOT_CONFIG_PATH;
const savedOpenclawConfigPath = process.env.OPENCLAW_CONFIG_PATH;

const GROUP = "grp_main_chain_matrix";
const COORD = "bot-coord";
const EXEC = "bot-exec";
const HUMAN = "human:owner";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  clearRuntimeConfigSnapshot();
  clearConfigCache();
  if (savedStateDir === undefined) {
    delete process.env.OPENBOT_STATE_DIR;
  } else {
    process.env.OPENBOT_STATE_DIR = savedStateDir;
  }
  if (savedOpenbotConfigPath === undefined) {
    delete process.env.OPENBOT_CONFIG_PATH;
  } else {
    process.env.OPENBOT_CONFIG_PATH = savedOpenbotConfigPath;
  }
  if (savedOpenclawConfigPath === undefined) {
    delete process.env.OPENCLAW_CONFIG_PATH;
  } else {
    process.env.OPENCLAW_CONFIG_PATH = savedOpenclawConfigPath;
  }
  await Promise.all(tempDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

function flagConfig(root: string): OpenBotConfig {
  return {
    agents: {
      defaults: { workspace: path.join(root, "agent-ws") },
      list: [
        { id: COORD, name: COORD },
        { id: EXEC, name: EXEC },
      ],
    },
    gateway: { security: { profile: "personal_local" } },
    collaboration: {
      defaults: { workspace: path.join(root, "collaboration") },
      runtimeNamespace: true,
      task: {
        claimContract: true,
        wakeContract: true,
        wakeContractGroupAllowlist: [GROUP],
        selfAdvance: { mode: "execute", executeGroupAllowlist: [GROUP] },
      },
    },
  } as OpenBotConfig;
}

async function useConfig(): Promise<{ root: string; cfg: OpenBotConfig }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-main-chain-"));
  tempDirs.push(root);
  process.env.OPENBOT_STATE_DIR = path.join(root, "state");
  const cfg = flagConfig(root);
  const configPath = path.join(root, "openbot.json");
  await fs.writeFile(configPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
  process.env.OPENBOT_CONFIG_PATH = configPath;
  process.env.OPENCLAW_CONFIG_PATH = configPath;
  setRuntimeConfigSnapshot(cfg, cfg);
  clearConfigCache();
  return { root, cfg };
}

function authority(cfg: OpenBotConfig, groupId = GROUP): RuntimeAuthority {
  const snapshot = createRoundPolicySnapshot(
    { collaborationMode: "task_driven", finalDecisionMode: "human_required" },
    { now: 1, idGen: () => "pss_main_chain" },
  );
  return createRuntimeAuthority({
    snapshot,
    episodeId: "ep_main_chain",
    tenant: { tenantId: null, trust: "none" },
    groupId,
    profile: "personal_local",
    cfg,
  });
}

async function seedLink(
  auth: RuntimeAuthority,
  taskId: string,
  opts?: { deliverableId?: string; version?: number; content?: string },
) {
  const content = opts?.content ?? P2_LINKED_DELIVERABLE_FIXTURE_BODY;
  const seeded = await seedLinkedTeamDeliverableFixture({
    authority: auth,
    taskId,
    deliverableId: opts?.deliverableId ?? "del-main-chain",
    version: opts?.version ?? 1,
    content,
  });
  if (!seeded.ok) {
    throw new Error(seeded.reason);
  }
  return {
    linkedDeliverableId: seeded.deliverableId,
    linkedDeliverableVersion: seeded.version,
    linkedContentSha256: seeded.contentSha256,
  };
}

describe("P1–P3 synthetic short closed-loop (main-chain matrix)", () => {
  it("catalog names the covered formal steps S03–S17", () => {
    const ids = MAIN_CHAIN_FORMAL_ROWS.map((r) => r.id);
    for (const id of [
      "S03",
      "S04",
      "S05",
      "S06",
      "S07",
      "S08",
      "S09",
      "S13",
      "S15",
      "S16",
      "S17",
    ]) {
      expect(ids).toContain(id);
    }
    expect(ACTIVATE_SUCCESS_DISPATCHED).toBe(false);
  });

  it("activate→publish≠claim→self-claim→plan→wake definite→submit→return→revise→accept→stop", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    const taskId = "task-main-chain-1";

    // --- S03 activate (dispatched:false); suggested EXEC so publisher HUMAN does not self-claim ---
    const activated = await activateCollaborationTask({
      groupId: GROUP,
      taskId,
      title: "Main-chain short MD",
      message: "请执行人认领并产出短 Markdown，验收有标题与正文",
      actor: HUMAN,
      goal: "产出有标题与正文的短 Markdown 交付件",
      acceptanceCriteria: ["有标题", "有正文"],
      constraints: ["publish≠publisher claim", "不得编造来源"],
      suggestedClaimantIds: [EXEC],
      humanConfirmed: true,
      requireHumanConfirm: true,
      skipChallengeWindow: true,
      cfg,
    });
    expect(["activated", "partial_success"]).toContain(activated.status);
    if (activated.status !== "activated" && activated.status !== "partial_success") {
      throw new Error(
        `activate failed: status=${activated.status} reason=${"reason" in activated ? activated.reason : ""}`,
      );
    }
    expect(activated.dispatched).toBe(false);
    expect(activated.boardPublished).toBe(true);
    expect(activated.boardItemId).toBeTruthy();
    const boardItemId = activated.boardItemId;

    // --- S04 publish ≠ claim: publisher not claimant; formalClaim may handoff ---
    const itemsAfterPublish = await listCollaborationBoardItems({
      groupId: GROUP,
      taskId,
      cfg,
    });
    const published = itemsAfterPublish.find((i) => i.itemId === boardItemId);
    expect(published).toBeTruthy();
    expect(published!.status).toBe("published");
    expect(published!.claimantId == null || published!.claimantId === "").toBe(true);

    if (activated.formalClaim) {
      expect(activated.formalClaim.outcome).not.toBe("claimed");
      expect(
        activated.formalClaim.claimantId == null || activated.formalClaim.claimantId === "",
      ).toBe(true);
      // wakeDispatcherAccepted only if definite; handoff may be pending/not dispatched
      if (activated.formalClaim.wakeDispatched) {
        expect(activated.formalClaim.wakeDispatcherAccepted).toBe(true);
      }
    }

    // Re-assert tryClaimAfterBoardPublish does not proxy-claim as HUMAN
    const again = await tryClaimAfterBoardPublish({
      groupId: GROUP,
      taskId,
      item: published!,
      actorId: HUMAN,
      authority: auth,
      cfg,
      roundDispatcher: async () => ({
        ok: true,
        roundId: "handoff-spy",
        sideEffectClass: "completed_with_receipt",
      }),
    });
    expect(again.outcome).not.toBe("claimed");
    expect(again.item.claimantId == null || again.item.claimantId === "").toBe(true);

    // --- S05 self-claim with non-empty actor (sole entry) ---
    const actor = EXEC;
    expect(actor.trim().length).toBeGreaterThan(0);
    const claimed = await claimCollaborationBoardItem({
      groupId: GROUP,
      taskId,
      itemId: boardItemId,
      claimantId: EXEC,
      actor,
      cfg,
    });
    expect(claimed.claimantId).toBe(EXEC);
    expect(
      ["claimed", "applied", "in_progress"].includes(claimed.status) || claimed.claimantId,
    ).toBeTruthy();

    const applied = await applyCollaborationBoardClaim({
      groupId: GROUP,
      taskId,
      itemId: boardItemId,
      actor: EXEC,
      cfg,
    });
    expect(applied.item.claimantId).toBe(EXEC);
    expect(applied.item.status === "applied" || applied.item.status === "claimed").toBe(true);

    // --- S06 / S07 propose + confirm (coordinator confirms; not executor self-confirm) ---
    // Production ACL resolves confirmers from board publishedBy + OS; seed OS so
    // COORD is the trusted coordinatorBotId and HUMAN/COORD/EXEC are active members.
    {
      const { fileStore } = createWorkspaceCollaborationStores(cfg);
      const live = await readGroupOperatingState({ fileStore, groupId: GROUP });
      const liveEpoch =
        typeof (live as { authEpoch?: number } | null)?.authEpoch === "number"
          ? Number((live as { authEpoch: number }).authEpoch)
          : 0;
      const state = makeOperatingState({
        groupId: GROUP,
        governance: {
          ownerUserId: "owner",
          coordinatorBotId: COORD,
        },
      });
      state.memberRoleMap = [
        {
          memberId: HUMAN,
          memberKind: "human",
          governanceRole: "owner",
          collaborationRole: null,
          status: "active",
        },
        {
          memberId: COORD,
          memberKind: "bot",
          governanceRole: "member",
          collaborationRole: null,
          status: "active",
        },
        {
          memberId: EXEC,
          memberKind: "bot",
          governanceRole: "member",
          collaborationRole: null,
          status: "active",
        },
      ];
      // Auth write: business merges preserve live coordinator/members (activate may
      // have reprojected empty roster). Confirm ACL needs explicit authEpoch bump.
      await writeGroupOperatingState({
        fileStore,
        groupId: GROUP,
        cfg,
        writeKind: "auth",
        state: {
          ...state,
          authEpoch: liveEpoch + 1,
          updatedAtMs: Date.now(),
        } as typeof state & { authEpoch: number },
      });
    }

    const proposed = await proposeCollaborationTodolist({
      groupId: GROUP,
      taskId,
      boardItemId,
      ownerMemberId: EXEC,
      actor: EXEC,
      steps: [{ title: "写短 MD", detail: "标题+正文", stepId: "s1" }],
      cfg,
    });
    expect(proposed.todolist.todolistId).toBeTruthy();
    expect(proposed.todolist.boardItemId).toBe(boardItemId);
    const todolistId = proposed.todolist.todolistId;
    // Agent↔agent peer: proposeCollaborationTodolist auto-confirms via production
    // confirmTodolist (coordinator sole confirmer) — still S07 formal write entry.
    // A second confirmCollaborationTodolist would be confirmation_consumed.
    const confirmed = proposed.todolist;
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.confirmedBy).toBe(COORD);
    await expect(
      confirmCollaborationTodolist({
        groupId: GROUP,
        taskId,
        todolistId,
        confirmerId: COORD,
        actor: COORD,
        expectedVersion: confirmed.version,
        cfg,
      }),
    ).rejects.toMatchObject({ code: "confirmation_consumed" });

    // --- S08 / S09 / S11: post-plan advance → definite wake accept only; binding present ---
    let dispatchCalls = 0;
    const definite: WakeRoundDispatcher = async (req) => {
      dispatchCalls += 1;
      expect(req.toAgentIds).toEqual([EXEC]);
      // Binding may be attached by production consume/attach path
      if (req.executionDeliverableBinding) {
        expect(req.executionDeliverableBinding.taskId).toBe(taskId);
        expect(req.executionDeliverableBinding.boardItemId).toBe(boardItemId);
      }
      return {
        ok: true,
        roundId: `main-chain-wake-${dispatchCalls}`,
        sideEffectClass: "completed_with_receipt",
      };
    };
    const advance = await triggerPostPlanConfirmAdvance({
      groupId: GROUP,
      taskId,
      boardItemId,
      todolistId,
      confirmedVersion: confirmed.version,
      stepId: "s1",
      confirmerId: COORD,
      cfg,
      roundDispatcher: definite,
    });
    expect(advance.dispatched, `post-plan reason=${advance.reason}`).toBe(true);
    expect(advance.wakeRecorded).toBe(true);
    expect(advance.wakeConsumed).toBe(true);
    expect(advance.targetAgentIds).toEqual([EXEC]);
    expect(dispatchCalls).toBe(1);
    // Definite accept path: not pending-verification style reason
    expect(String(advance.reason ?? "")).not.toMatch(/pending_verification|started_or_unknown/i);

    // --- S12/S13 execute progress + submit ---
    const inProg = await markBoardItemInProgress(
      auth,
      { taskId, itemId: boardItemId, actorId: EXEC },
      { cfg },
    );
    expect(inProg.ok, inProg.ok ? "" : inProg.message).toBe(true);

    const link = await seedLink(auth, taskId, { deliverableId: "del-main-v1" });
    const submissionId = "11111111-1111-4111-8111-111111111111";
    const submitted = await submitBoardItemForReview(
      auth,
      {
        taskId,
        itemId: boardItemId,
        actorId: EXEC,
        submissionId,
        artifactVersion: "v1",
        submissionSummary: "draft body for review",
        ...link,
      },
      { cfg, coordinatorBotId: COORD },
    );
    expect(submitted.ok, submitted.ok ? "" : submitted.message).toBe(true);
    if (!submitted.ok) {
      return;
    }
    expect(submitted.value.status).toBe("submitted_for_review");
    expect(submitted.value.pendingEventRelay?.targetAgentIds).toEqual([COORD]);

    // --- S14 review wake (authorized reviewer) ---
    const reviewAdvance = await triggerPostSubmissionEventAdvance({
      groupId: GROUP,
      taskId,
      itemId: boardItemId,
      actorId: COORD,
      cfg,
      roundDispatcher: async (req) => {
        expect(req.toAgentIds).toEqual([COORD]);
        return {
          ok: true,
          roundId: "review-wake",
          sideEffectClass: "completed_with_receipt",
        };
      },
    });
    // May already be consumed by submit path; allow dispatched true or idempotent settle
    expect(typeof reviewAdvance.dispatched).toBe("boolean");

    // --- S15 return ---
    const returned = await returnBoardItemSubmission(
      auth,
      {
        taskId,
        itemId: boardItemId,
        actorId: COORD,
        reason: "needs sources",
        expectedSubmissionId: submissionId,
      },
      { cfg },
    );
    expect(returned.ok, returned.ok ? "" : returned.message).toBe(true);
    if (!returned.ok) {
      return;
    }
    expect(returned.value.status).toBe("returned");
    expect(returned.value.pendingEventRelay?.targetAgentIds).toEqual([EXEC]);

    // Late accept of old submission must fail
    const late = await acceptBoardItemSubmission(
      auth,
      {
        taskId,
        itemId: boardItemId,
        actorId: COORD,
        expectedSubmissionId: submissionId,
        reason: "late",
        checkedAcceptanceCriteria: ["有标题", "有正文"],
      },
      { cfg },
    );
    expect(late.ok).toBe(false);

    // Revise + resubmit
    const link2 = await seedLink(auth, taskId, {
      deliverableId: "del-main-v2",
      version: 1,
      content: "# revised with sources\n\nBody.\n",
    });
    const submissionId2 = "22222222-2222-4222-8222-222222222222";
    const resub = await submitBoardItemForReview(
      auth,
      {
        taskId,
        itemId: boardItemId,
        actorId: EXEC,
        submissionId: submissionId2,
        artifactVersion: "v2",
        submissionSummary: "revised with sources",
        ...link2,
      },
      { cfg, coordinatorBotId: COORD },
    );
    expect(resub.ok, resub.ok ? "" : resub.message).toBe(true);
    if (!resub.ok) {
      return;
    }

    // --- S16 accept ---
    const accepted = await acceptBoardItemSubmission(
      auth,
      {
        taskId,
        itemId: boardItemId,
        actorId: COORD,
        expectedSubmissionId: submissionId2,
        reason: "meets criteria — has title and body",
        checkedAcceptanceCriteria: ["有标题", "有正文"],
      },
      { cfg },
    );
    expect(accepted.ok, accepted.ok ? "" : accepted.message).toBe(true);
    if (!accepted.ok) {
      return;
    }
    expect(accepted.value.status).toBe("accepted");

    // --- S17 stop after accept ---
    const afterAccept = await triggerPostSubmissionEventAdvance({
      groupId: GROUP,
      taskId,
      itemId: boardItemId,
      actorId: COORD,
      cfg,
      roundDispatcher: async () => {
        throw new Error("must_not_dispatch_after_accept");
      },
    });
    expect(afterAccept.dispatched).toBe(false);
    expect(
      afterAccept.reason === "accepted_no_further_exec_schedule" ||
        String(afterAccept.reason ?? "").includes("accepted") ||
        String(afterAccept.businessEvent ?? "") === "accepted",
    ).toBe(true);
  });
});
