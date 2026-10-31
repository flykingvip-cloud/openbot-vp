/**
 * P1 #164 Step 4 — combo closed-loop synthetic (phase lock).
 *
 * Loop: 用户委托 → 任务建立 → 所需确认 → 执行 → 提交 → 退回一次 → 修订 → 接受
 *
 * P1 entry via controlledDiscussToTask (flag-on). Confirmation via
 * activateCollaborationTask(humanConfirmed:true) with the **same** first-persisted
 * contract fields (message/goal/constraints/candidates) — NOT discussToTask bypass
 * and NOT a silent field replace on confirm (see discuss-to-task-confirm-bind.test.ts).
 * Execute/submit/return/revise/accept reuses P2/P3 Mode B + board fixtures.
 * No second dispatcher / wake budget / prod flags / real groups / LIVE model.
 *
 * Mode B mock boundary (honest, same as P3): getReplyFromConfig + space list +
 * ownership SoT. Real: consume → Mode B boot → enforceAcl:true finalize.
 *
 * Harness-only (NOT autonomous loop evidence): writeDispatchableAuthOs / roster
 * re-seed after activate OS sync, and task responsibility normalize writes.
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
import type { GovernedTask } from "../collaboration-dispatch/task-runtime.js";
import type { WakeRoundDispatcher } from "../collaboration-dispatch/wake-round-dispatch.js";
import {
  resolveModeBWakeRoundContext,
  unbindGatewayWakeRoundDispatcher,
} from "../wake-round-dispatcher-boot.js";
import { persistAuthoritativeGroupMembers } from "../workspace/group-acl.js";
import { resolveTrustedGroupLocator } from "../workspace/group-locator.js";
import { activateCollaborationTask } from "./activate-collaboration-task.js";
import {
  acceptCollaborationBoardItemSubmission,
  returnCollaborationBoardItemSubmission,
  submitCollaborationBoardItemForReview,
} from "./claim-contract-entry.js";
import { controlledDiscussToTask } from "./controlled-discuss-to-task.js";
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
const GROUP_ID = "grp_p1_combo_loop";
const TENANT_ID = "tenant-p1-combo";
const EXPLICIT =
  "请两名成员协作完成短 Markdown 提纲\n验收标准：\n- 有标题\n- 有正文\n请团队正式开展";
/** First-persisted contract fields — confirm must reuse these (no silent replace). */
const COMBO_TITLE = "P1 combo short markdown";
const COMBO_GOAL = "产出有标题与正文的短 Markdown 提纲";
const COMBO_CONSTRAINTS = ["不得编造来源"] as const;
const MD_V1_BODY = "# P1 Combo Draft v1\n\nShort markdown deliverable body.\n";
const MD_V2_BODY = "# P1 Combo Draft v2\n\nRevised after one return — accepted candidate.\n";

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

describe("P1 #164 combo closed-loop (delegate→establish→confirm→exec→submit→return→revise→accept)", () => {
  async function useManagedRoot() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-p1-combo-"));
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
      { now: 1, idGen: () => "pss_p1_combo" },
    );
    return createRuntimeAuthority({
      snapshot,
      episodeId: "ep_p1_combo",
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

  async function seedMembersOnly(params: { cfg: OpenBotConfig }) {
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
    return {
      groupLocator,
      stores,
      trusted: { groupsRoot: path.dirname(groupLocator), groupLocator },
    };
  }

  async function writeDispatchableAuthOs(params: {
    stores: Awaited<ReturnType<typeof seedMembersOnly>>["stores"];
    cfg: OpenBotConfig;
  }) {
    const live = await (
      await import("./shared.js")
    ).readGroupOperatingState({
      fileStore: params.stores.fileStore,
      groupId: GROUP_ID,
    });
    const epoch =
      typeof (live as { authEpoch?: number } | null)?.authEpoch === "number"
        ? Number((live as { authEpoch: number }).authEpoch) + 1
        : 1;
    await writeGroupOperatingState({
      fileStore: params.stores.fileStore,
      groupId: GROUP_ID,
      groupRootDir: params.stores.groupsRoot,
      cfg: params.cfg,
      writeKind: "auth",
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
        authEpoch: epoch,
        updatedAtMs: Date.now(),
      } as never,
    });
  }

  test("combo: P1 delegate→establish→confirm then P3 submit→return→revise→accept", async () => {
    const stages: Record<string, "pass" | "fail"> = {
      delegate_establish: "fail",
      confirm: "fail",
      execute: "fail",
      submit: "fail",
      return_once: "fail",
      revise: "fail",
      accept: "fail",
    };
    const { cfg } = await useManagedRoot();
    const seeded = await seedMembersOnly({ cfg });
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
    const tenant = { tenantId: TENANT_ID, trust: "membership" as const };

    // —— 1) 用户委托 → 任务建立（P1 controlledDiscussToTask, flag-on）——
    const d2t = await controlledDiscussToTask({
      sourceMessageId: `p1-combo-src-${Date.now()}`,
      groupId: GROUP_ID,
      tenantId: TENANT_ID,
      actor: PEER,
      message: EXPLICIT,
      title: COMBO_TITLE,
      goal: COMBO_GOAL,
      acceptanceCriteria: ["有标题", "有正文"],
      constraints: [...COMBO_CONSTRAINTS],
      suggestedClaimantIds: [AUTHOR, REVIEWER],
      forceExplicit: true,
      trusted: seeded.trusted,
      cfg,
      tenant,
    });
    expect(d2t.classification).toBe("explicit_delegation");
    expect(d2t.attempted).toBe(true);
    expect(d2t.taskId).toBeTruthy();
    expect(d2t.stages.taskEstablished).toBe(true);
    expect(d2t.userMessage).not.toMatch(/已派工/);
    // Phase-1 default: confirm still required (not silently published as 已派工)
    expect(
      d2t.statusCode === "formal_task_needs_confirm" ||
        d2t.activation?.status === "needs_confirm" ||
        d2t.stages.boardPublished === false,
    ).toBe(true);
    const taskId = d2t.taskId!;
    const durable = await seeded.stores.objectStorage.readObject<Task>(GROUP_ID, "task", taskId);
    expect(durable).not.toBeNull();
    stages.delegate_establish = "pass";

    // —— 2) 所需确认：同一首次持久化契约（message/goal/constraints/candidates）——
    // activate(humanConfirmed:true) composition only; field drift must conflict
    // (covered by discuss-to-task-confirm-bind.test.ts), not silently replace here.
    expect(d2t.activationKey).toBeTruthy();
    const confirmed = await activateCollaborationTask({
      groupId: GROUP_ID,
      taskId,
      title: COMBO_TITLE,
      message: EXPLICIT,
      actor: PEER,
      goal: COMBO_GOAL,
      acceptanceCriteria: ["有标题", "有正文"],
      constraints: [...COMBO_CONSTRAINTS],
      suggestedClaimantIds: [AUTHOR, REVIEWER],
      humanConfirmed: true,
      requireHumanConfirm: true,
      trusted: seeded.trusted,
      cfg,
      tenant,
    });
    if (confirmed.status === "blocked") {
      expect(confirmed.reason).not.toBe("activation_contract_conflict");
    }
    expect(confirmed.activationKey).toBe(d2t.activationKey);
    expect(
      confirmed.status === "activated" || confirmed.boardPublished,
      JSON.stringify(confirmed),
    ).toBe(true);
    expect(confirmed.taskEnsured).toBe(true);
    stages.confirm = "pass";

    // TEST HARNESS ONLY (not autonomous closed-loop evidence): re-assert roster
    // after activate OS sync so later claim/advance avoid auth_revoked fixtures.
    await writeDispatchableAuthOs({ stores: seeded.stores, cfg });
    seedActiveOwnership();

    // —— 3) 执行：claim + todolist confirm + in_progress ——
    let itemId =
      "boardItemId" in confirmed && typeof confirmed.boardItemId === "string"
        ? confirmed.boardItemId
        : "";
    if (!itemId) {
      const published = await publishBoardItem(
        auth,
        {
          groupId: GROUP_ID,
          taskId,
          remainingWork: "write short markdown",
          acceptanceCriteria: ["有标题", "有正文"],
          intendedClaimantIds: [AUTHOR],
          publishedBy: REVIEWER,
        },
        { cfg },
      );
      expect(published.ok, published.ok ? "" : published.message).toBe(true);
      if (!published.ok) {
        throw new Error(published.message);
      }
      itemId = published.value.itemId;
    }
    const seedTask: Task = {
      taskId,
      groupId: GROUP_ID,
      title: COMBO_TITLE,
      status: "in_progress",
      ownerMemberId: REVIEWER,
      assignedMemberIds: [AUTHOR, REVIEWER],
      createdBy: PEER,
      updatedBy: PEER,
      createdAtMs: 1,
      updatedAtMs: 1,
    };
    const claimed = await claimBoardItem(auth, { taskId, itemId, claimantId: AUTHOR }, { cfg });
    expect(claimed.ok, claimed.ok ? "" : claimed.message).toBe(true);
    if (!claimed.ok) {
      throw new Error(claimed.message);
    }
    const applied = await applyClaim(auth, { taskId, itemId }, seedTask, auth.policy.effective, {
      cfg,
    });
    expect(applied.ok, applied.ok ? "" : applied.message).toBe(true);
    if (!applied.ok) {
      throw new Error(applied.message);
    }
    const { proposeTodolist, confirmTodolist } =
      await import("../collaboration-dispatch/executor-private-todolist.js");
    const proposed = await proposeTodolist(
      auth,
      {
        boardItemId: itemId,
        taskId,
        groupId: GROUP_ID,
        ownerMemberId: AUTHOR,
        steps: [{ title: "draft short md" }, { title: "revise if returned once" }],
      },
      { cfg },
    );
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) {
      throw new Error(proposed.message);
    }
    const todolistConfirmed = await confirmTodolist(
      auth,
      { taskId, todolistId: proposed.value.todolistId, confirmerId: REVIEWER },
      { cfg, authorizedConfirmerIds: [REVIEWER] },
    );
    expect(todolistConfirmed.ok).toBe(true);
    if (!todolistConfirmed.ok) {
      throw new Error(todolistConfirmed.message);
    }
    const started = await markBoardItemInProgress(
      auth,
      { taskId, itemId, actorId: AUTHOR },
      { cfg },
    );
    expect(started.ok).toBe(true);
    if (!started.ok) {
      throw new Error(started.message);
    }

    // TEST HARNESS ONLY: normalize duty/membership ids to P3 fixture shape so
    // dispatch auth recheck maps claimants (d2t stamps owner as human-peer;
    // OS sync may use m-* ids). Not an autonomous loop action.
    const nowMs = Date.now();
    const prevTask = await seeded.stores.objectStorage.readObject<Task>(GROUP_ID, "task", taskId);
    if (!prevTask) {
      throw new Error("expected task before responsibility normalize");
    }
    const normalized: GovernedTask = {
      ...prevTask,
      ownerMemberId: REVIEWER,
      assignedMemberIds: [AUTHOR, REVIEWER],
      updatedBy: REVIEWER,
      updatedAtMs: nowMs,
      status: "in_progress",
      responsibility: {
        owner: REVIEWER,
        executors: [AUTHOR],
        reviewer: REVIEWER,
        approver: PEER,
        decisionAuthority: PEER,
      },
    };
    await seeded.stores.objectStorage.writeObject(GROUP_ID, "task", taskId, normalized);
    await writeDispatchableAuthOs({ stores: seeded.stores, cfg });
    seedActiveOwnership();
    stages.execute = "pass";

    const v1 = await seedLinkedTeamDeliverableFixture({
      authority: auth,
      taskId,
      deliverableId: "del-p1-combo-v1",
      version: 1,
      content: MD_V1_BODY,
    });
    if (!v1.ok) {
      throw new Error(v1.reason);
    }
    expect(v1.contentSha256).toBe(sha256Hex(MD_V1_BODY));

    const trusted = trustedLocatorFromAuthority(auth);

    // —— 4) 提交 ——
    const submissionId1 = randomUUID();
    const submitted1 = await submitCollaborationBoardItemForReview({
      groupId: GROUP_ID,
      taskId,
      itemId,
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
    expect(submitted1.item.status).toBe("submitted_for_review");

    // TEST HARNESS ONLY: submit/entry may re-sync OS from m-* membership rows —
    // restore dispatchable map (not autonomous loop evidence).
    await writeDispatchableAuthOs({ stores: seeded.stores, cfg });
    seedActiveOwnership();

    let reviewCalls = 0;
    const reviewAdvance = await triggerPostSubmissionEventAdvance({
      groupId: GROUP_ID,
      taskId,
      itemId,
      actorId: REVIEWER,
      cfg,
      roundDispatcher: async (req) => {
        reviewCalls += 1;
        expect(req.dispatchPrompt ?? "").toContain("intent=review_submission");
        return { ok: true, roundId: "p1-combo-review" };
      },
      trusted,
      tenant,
    });
    expect(reviewAdvance.dispatched, `review=${reviewAdvance.reason}`).toBe(true);
    expect(reviewCalls).toBe(1);
    stages.submit = "pass";

    // —— 5) 退回一次 ——
    const ret = await returnCollaborationBoardItemSubmission({
      groupId: GROUP_ID,
      taskId,
      itemId,
      expectedSubmissionId: submissionId1,
      reason: "revise body once for P1 combo loop",
      actor: REVIEWER,
      cfg,
      trusted,
      tenant,
      relayAdvance: false,
    });
    expect(ret.item.status).toBe("returned");
    expect(ret.item.pendingEventRelay?.returnRevision).toBe(1);
    stages.return_once = "pass";

    // —— 6) 修订（Mode B ACL）——
    getReplyFromConfig.mockImplementation(async () => {
      const live = await loadBoardClaimItem(auth, { taskId, itemId });
      if (live?.status === "returned") {
        await markBoardItemInProgress(auth, { taskId, itemId, actorId: AUTHOR }, { cfg });
      }
      return {
        text:
          '完成修订。\n<<DELIVERABLE title="P1ComboV2" file="p1-combo-v2.md">>\n' +
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
      itemId,
      actorId: REVIEWER,
      cfg,
      roundDispatcher: wrappedModeB,
      trusted,
      tenant,
    });
    expect(returnAdvance.dispatched, `returnAdvance=${returnAdvance.reason}`).toBe(true);
    expect(returnPrompt).toContain("intent=return_revise");
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
    const afterModeB = await loadBoardClaimItem(auth, { taskId, itemId });
    expect(afterModeB?.status).toBe("in_progress");
    const submissionId2 = randomUUID();
    const resubmitted = await submitBoardItemForReview(
      auth,
      {
        taskId,
        itemId,
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
    stages.revise = "pass";

    // —— 7) 接受 ——
    const accepted = await acceptCollaborationBoardItemSubmission({
      groupId: GROUP_ID,
      taskId,
      itemId,
      expectedSubmissionId: submissionId2,
      reason: "P1 combo loop accept",
      checkedAcceptanceCriteria: ["有标题", "有正文"],
      actor: REVIEWER,
      cfg,
      trusted,
      tenant,
      relayAdvance: false,
    });
    expect(accepted.item.status).toBe("accepted");
    expect(accepted.item.pendingEventRelay).toBeNull();
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
    }
    let postAcceptCalls = 0;
    const afterAcceptAdvance = await triggerPostSubmissionEventAdvance({
      groupId: GROUP_ID,
      taskId,
      itemId,
      actorId: REVIEWER,
      cfg,
      roundDispatcher: async () => {
        postAcceptCalls += 1;
        return { ok: true, roundId: "must-not-run" };
      },
      trusted,
      tenant,
    });
    expect(afterAcceptAdvance.dispatched).toBe(false);
    expect(postAcceptCalls).toBe(0);
    const acceptedItem = await loadBoardClaimItem(auth, { taskId, itemId });
    await recoverPendingBoardEventRelays({
      groupId: GROUP_ID,
      taskId,
      actorId: REVIEWER,
      items: acceptedItem ? [acceptedItem] : [],
      cfg,
      roundDispatcher: async () => {
        postAcceptCalls += 1;
        return { ok: true, roundId: "recover-must-not" };
      },
      trusted,
      tenant,
    });
    expect(postAcceptCalls).toBe(0);
    stages.accept = "pass";

    // Surface stage map for evidence consumers
    expect(stages).toEqual({
      delegate_establish: "pass",
      confirm: "pass",
      execute: "pass",
      submit: "pass",
      return_once: "pass",
      revise: "pass",
      accept: "pass",
    });
  });
});
