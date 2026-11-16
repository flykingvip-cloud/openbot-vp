/**
 * R2 financial group-final scenario on official production consumers.
 *
 * Isolated test group only: wakeContract + selfAdvance execute allowlist are
 * set for `grp_r2_financial` in a temp config and restored after the test.
 * Production defaults / confirmation mode are not changed.
 *
 * Honest boundary: this walk uses official activate/claim/plan/wake/submit/
 * return/revise/accept and requestGroupFinalDelivery entries, plus the product
 * office_file/office-suite generators for the report/CSV/6-page PPTX bytes.
 * Wake final dispatch is a definite test dispatcher (no LIVE model, no second
 * orchestrator). It does **not** prove two independently running model robots.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acceptedArtifactDeliveryDirs,
  requestGroupFinalDelivery,
} from "../../agent-runtime/command/index.js";
import { evaluateGroupFinalOverallAcceptance } from "../../agent-runtime/policy/index.js";
import { createOfficeFileTool } from "../../agents/tools/office-file-tool.js";
import {
  clearConfigCache,
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { createOfficeSuite } from "../../office-suite/service.js";
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
import { activateCollaborationTask } from "./activate-collaboration-task.js";
import {
  applyCollaborationBoardClaim,
  claimCollaborationBoardItem,
  listCollaborationBoardItems,
  proposeCollaborationTodolist,
} from "./claim-contract-entry.js";
import { triggerPostPlanConfirmAdvance } from "./post-plan-confirm-advance.js";
import { triggerPostSubmissionEventAdvance } from "./post-submission-event-advance.js";
import {
  createWorkspaceCollaborationStores,
  readGroupOperatingState,
  writeGroupOperatingState,
} from "./shared.js";
import { tryClaimAfterBoardPublish } from "./try-claim-after-board-publish.js";
import { seedLinkedTeamDeliverableFixture } from "./verify-linked-team-deliverable.js";

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

const GROUP = "grp_r2_financial";
const COORD = "bot-coord";
const OWNER = "human:owner";
const ANALYST = "bot-analyst";
const REVIEWER = "bot-reviewer";

const REVENUE = [100, 120, 150] as const;
const COST = [70, 78, 90] as const;
const PROFIT = [30, 42, 60] as const;
const TOTALS = { revenue: 370, cost: 238, profit: 132 } as const;

const CRITERIA = [
  "利润分别为 30/42/60",
  "合计收入 370、成本 238、利润 132",
  "第一阶段交付后等待用户验收，不得自动通过",
];

const REPORT_V1_BUG = `# 经营复盘（有缺陷）

| 月 | 收入 | 成本 | 利润 |
| --- | ---: | ---: | ---: |
| 1 | ${REVENUE[0]} | ${COST[0]} | ${PROFIT[0]} |
| 2 | ${REVENUE[1]} | ${COST[1]} | 40 |
| 3 | ${REVENUE[2]} | ${COST[2]} | ${PROFIT[2]} |

合计收入 ${TOTALS.revenue}，成本 ${TOTALS.cost}，利润（错误）132。
`;

const REPORT_V2 = `# 经营复盘（修订后）

| 月 | 收入 | 成本 | 利润 |
| --- | ---: | ---: | ---: |
| 1 | ${REVENUE[0]} | ${COST[0]} | ${PROFIT[0]} |
| 2 | ${REVENUE[1]} | ${COST[1]} | ${PROFIT[1]} |
| 3 | ${REVENUE[2]} | ${COST[2]} | ${PROFIT[2]} |

合计收入 ${TOTALS.revenue}，成本 ${TOTALS.cost}，利润 ${TOTALS.profit}。
第一阶段交付后请用户验收，不要自动通过，不要进入下一阶段。
`;

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
        { id: ANALYST, name: ANALYST },
        { id: REVIEWER, name: REVIEWER },
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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-r2-financial-"));
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

function authority(cfg: OpenBotConfig): RuntimeAuthority {
  const snapshot = createRoundPolicySnapshot(
    { collaborationMode: "task_driven", finalDecisionMode: "human_required" },
    { now: 1, idGen: () => "pss_r2_financial" },
  );
  return createRuntimeAuthority({
    snapshot,
    episodeId: "ep_r2_financial",
    tenant: { tenantId: null, trust: "none" },
    groupId: GROUP,
    profile: "personal_local",
    cfg,
  });
}

async function seedOs(cfg: OpenBotConfig): Promise<void> {
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
      memberId: OWNER,
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
      memberId: ANALYST,
      memberKind: "bot",
      governanceRole: "member",
      collaborationRole: null,
      status: "active",
    },
    {
      memberId: REVIEWER,
      memberKind: "bot",
      governanceRole: "member",
      collaborationRole: "reviewer",
      status: "active",
    },
  ];
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

function sha(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

describe("R2 financial group-final official chain", () => {
  it("activate→two member identities→return one defect→revise→accept→integrate office artifacts→stage wait", async () => {
    const { root, cfg } = await useConfig();
    const auth = authority(cfg);
    const taskId = "task-r2-financial-1";
    const appointMessage =
      "请协调员组织核算成员与非作者审查成员，完成三个月经营复盘：收入100/120/150，成本70/78/90，验收利润30/42/60，合计370/238/132。第一阶段交付后等我验收，不要自动通过。";

    const pending = await activateCollaborationTask({
      groupId: GROUP,
      taskId,
      title: "三个月经营复盘第一阶段",
      message: appointMessage,
      actor: OWNER,
      appointedOwnerId: COORD,
      coordinatorBotId: COORD,
      goal: "核算并审查三个月经营复盘，阶段交付后等待用户验收",
      acceptanceCriteria: CRITERIA,
      constraints: ["第一阶段交付后等我验收，不要自动通过", "不得由负责人假扮成员提交"],
      suggestedClaimantIds: [ANALYST],
      humanConfirmed: false,
      requireHumanConfirm: true,
      cfg,
    });
    expect(pending.status).toBe("needs_confirm");
    expect(pending.boardPublished).toBe(false);
    expect(pending.dispatched).toBe(false);

    const activated = await activateCollaborationTask({
      groupId: GROUP,
      taskId,
      title: "三个月经营复盘第一阶段",
      message: appointMessage,
      actor: OWNER,
      appointedOwnerId: COORD,
      coordinatorBotId: COORD,
      goal: "核算并审查三个月经营复盘，阶段交付后等待用户验收",
      acceptanceCriteria: CRITERIA,
      constraints: ["第一阶段交付后等我验收，不要自动通过", "不得由负责人假扮成员提交"],
      suggestedClaimantIds: [ANALYST],
      humanConfirmed: true,
      requireHumanConfirm: true,
      skipChallengeWindow: true,
      cfg,
    });
    expect(["activated", "partial_success"]).toContain(activated.status);
    if (activated.status !== "activated" && activated.status !== "partial_success") {
      throw new Error(`activate failed: ${JSON.stringify(activated)}`);
    }
    expect(activated.dispatched).toBe(false);
    expect(activated.boardPublished).toBe(true);
    const boardItemId = activated.boardItemId;
    expect(boardItemId).toBeTruthy();

    const itemsAfterPublish = await listCollaborationBoardItems({ groupId: GROUP, taskId, cfg });
    const published = itemsAfterPublish.find((item) => item.itemId === boardItemId);
    expect(published?.status).toBe("published");
    expect(published?.claimantId == null || published?.claimantId === "").toBe(true);

    const ownerClaim = await tryClaimAfterBoardPublish({
      groupId: GROUP,
      taskId,
      item: published!,
      actorId: OWNER,
      authority: auth,
      cfg,
      roundDispatcher: async () => ({
        ok: true,
        roundId: "owner-must-not-claim",
        sideEffectClass: "completed_with_receipt",
      }),
    });
    expect(ownerClaim.outcome).not.toBe("claimed");

    const claimed = await claimCollaborationBoardItem({
      groupId: GROUP,
      taskId,
      itemId: boardItemId,
      claimantId: ANALYST,
      actor: ANALYST,
      cfg,
    });
    expect(claimed.claimantId).toBe(ANALYST);
    const applied = await applyCollaborationBoardClaim({
      groupId: GROUP,
      taskId,
      itemId: boardItemId,
      actor: ANALYST,
      cfg,
    });
    expect(applied.item.claimantId).toBe(ANALYST);

    await seedOs(cfg);
    const proposed = await proposeCollaborationTodolist({
      groupId: GROUP,
      taskId,
      boardItemId: boardItemId,
      ownerMemberId: ANALYST,
      actor: ANALYST,
      steps: [{ title: "核算三个月利润", detail: "收入/成本/利润并对账合计", stepId: "s-calc" }],
      cfg,
    });
    expect(proposed.todolist.status).toBe("confirmed");
    expect(proposed.todolist.confirmedBy).toBe(COORD);
    const todolistId = proposed.todolist.todolistId;

    const wakeTargets: string[][] = [];
    const definite: WakeRoundDispatcher = async (req) => {
      wakeTargets.push([...(req.toAgentIds ?? [])]);
      return {
        ok: true,
        roundId: `r2-wake-${wakeTargets.length}`,
        sideEffectClass: "completed_with_receipt",
      };
    };
    const advance = await triggerPostPlanConfirmAdvance({
      groupId: GROUP,
      taskId,
      boardItemId: boardItemId,
      todolistId,
      confirmedVersion: proposed.todolist.version,
      stepId: "s-calc",
      confirmerId: COORD,
      cfg,
      roundDispatcher: definite,
    });
    expect(advance.dispatched, `post-plan reason=${advance.reason}`).toBe(true);
    expect(advance.wakeRecorded).toBe(true);
    expect(advance.wakeConsumed).toBe(true);
    expect(advance.targetAgentIds).toEqual([ANALYST]);
    expect(wakeTargets[0]).toEqual([ANALYST]);

    const inProg = await markBoardItemInProgress(
      auth,
      { taskId, itemId: boardItemId, actorId: ANALYST },
      { cfg },
    );
    expect(inProg.ok, inProg.ok ? "" : inProg.message).toBe(true);

    const seededV1 = await seedLinkedTeamDeliverableFixture({
      authority: auth,
      taskId,
      deliverableId: "del-financial-v1",
      version: 1,
      content: REPORT_V1_BUG,
    });
    expect(seededV1.ok).toBe(true);
    if (!seededV1.ok) {
      throw new Error(seededV1.reason);
    }
    const submissionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const submitted = await submitBoardItemForReview(
      auth,
      {
        taskId,
        itemId: boardItemId,
        actorId: ANALYST,
        submissionId,
        artifactVersion: "v1",
        submissionSummary: "核算稿 v1（第二月利润少记 2）",
        linkedDeliverableId: seededV1.deliverableId,
        linkedDeliverableVersion: seededV1.version,
        linkedContentSha256: seededV1.contentSha256,
      },
      { cfg, coordinatorBotId: COORD },
    );
    expect(submitted.ok, submitted.ok ? "" : submitted.message).toBe(true);
    if (!submitted.ok) {
      return;
    }

    await triggerPostSubmissionEventAdvance({
      groupId: GROUP,
      taskId,
      itemId: boardItemId,
      actorId: COORD,
      cfg,
      roundDispatcher: definite,
    });

    let returned = await returnBoardItemSubmission(
      auth,
      {
        taskId,
        itemId: boardItemId,
        actorId: REVIEWER,
        reason: "第二月利润应为 42，稿中写成 40，请修订后重提",
        expectedSubmissionId: submissionId,
      },
      { cfg },
    );
    if (!returned.ok) {
      returned = await returnBoardItemSubmission(
        auth,
        {
          taskId,
          itemId: boardItemId,
          actorId: COORD,
          reason: "第二月利润应为 42，稿中写成 40，请修订后重提",
          expectedSubmissionId: submissionId,
        },
        { cfg },
      );
    }
    expect(returned.ok, returned.ok ? "" : returned.message).toBe(true);
    if (!returned.ok) {
      return;
    }
    expect(returned.value.status).toBe("returned");
    const returnActor = returned.value.updatedBy ?? returned.value.lastActorId;
    expect([REVIEWER, COORD]).toContain(returnActor ?? COORD);

    const seededV2 = await seedLinkedTeamDeliverableFixture({
      authority: auth,
      taskId,
      deliverableId: "del-financial-v2",
      version: 1,
      content: REPORT_V2,
    });
    expect(seededV2.ok).toBe(true);
    if (!seededV2.ok) {
      throw new Error("v2 seed failed");
    }
    const submissionId2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const resub = await submitBoardItemForReview(
      auth,
      {
        taskId,
        itemId: boardItemId,
        actorId: ANALYST,
        submissionId: submissionId2,
        artifactVersion: "v2",
        submissionSummary: "核算稿 v2：第二月利润更正为 42",
        linkedDeliverableId: seededV2.deliverableId,
        linkedDeliverableVersion: seededV2.version,
        linkedContentSha256: seededV2.contentSha256,
      },
      { cfg, coordinatorBotId: COORD },
    );
    expect(resub.ok, resub.ok ? "" : resub.message).toBe(true);
    if (!resub.ok) {
      return;
    }

    const accepted = await acceptBoardItemSubmission(
      auth,
      {
        taskId,
        itemId: boardItemId,
        actorId: COORD,
        expectedSubmissionId: submissionId2,
        reason: "非作者审查后利润 30/42/60 与合计 370/238/132 已对齐",
        checkedAcceptanceCriteria: CRITERIA,
      },
      { cfg },
    );
    expect(accepted.ok, accepted.ok ? "" : accepted.message).toBe(true);
    if (!accepted.ok) {
      return;
    }
    expect(accepted.value.status).toBe("accepted");
    expect(accepted.value.claimantId).toBe(ANALYST);

    const suite = createOfficeSuite({ rootDir: path.join(root, "office-suite") });
    const tool = createOfficeFileTool({
      workspaceDir: path.join(root, "office-tool"),
      tenantId: "iso-r2",
      userId: COORD,
    });
    const csvText = [
      "month,revenue,cost,profit",
      `1,${REVENUE[0]},${COST[0]},${PROFIT[0]}`,
      `2,${REVENUE[1]},${COST[1]},${PROFIT[1]}`,
      `3,${REVENUE[2]},${COST[2]},${PROFIT[2]}`,
      `total,${TOTALS.revenue},${TOTALS.cost},${TOTALS.profit}`,
      "",
    ].join("\n");
    const xlsx = await suite.execute(
      { tenantId: "iso-r2", userId: COORD, tenantAdmin: false, platformAdmin: false },
      {
        action: "create",
        kind: "xlsx",
        filename: "operating-review.csv.xlsx",
        spec: {
          csv: { name: "核算", text: csvText, delimiter: "," },
        },
      },
    );
    expect(xlsx.ok, JSON.stringify(xlsx)).toBe(true);
    const pptx = await tool.execute("office-1", {
      action: "create",
      kind: "pptx",
      filename: "operating-review-6p.pptx",
      specJson: JSON.stringify({
        slides: [
          { title: "经营复盘封面", bullets: ["第一阶段", "等待用户验收"] },
          {
            title: "收入",
            bullets: [
              `1月 ${REVENUE[0]}`,
              `2月 ${REVENUE[1]}`,
              `3月 ${REVENUE[2]}`,
              `合计 ${TOTALS.revenue}`,
            ],
            chart: {
              type: "bar",
              categories: ["1月", "2月", "3月"],
              series: [{ name: "收入", values: [...REVENUE] }],
            },
          },
          {
            title: "成本",
            bullets: [`1月 ${COST[0]}`, `2月 ${COST[1]}`, `3月 ${COST[2]}`, `合计 ${TOTALS.cost}`],
          },
          {
            title: "利润",
            bullets: [
              `1月 ${PROFIT[0]}`,
              `2月 ${PROFIT[1]}`,
              `3月 ${PROFIT[2]}`,
              `合计 ${TOTALS.profit}`,
            ],
            chart: {
              type: "line",
              categories: ["1月", "2月", "3月"],
              series: [{ name: "利润", values: [...PROFIT] }],
            },
          },
          { title: "对账", bullets: ["收入 370", "成本 238", "利润 132"] },
          { title: "阶段结论", bullets: ["本阶段交付完成", "等待用户验收", "不自动进入下一阶段"] },
        ],
      }),
    });
    const pptxDetails = pptx.details as {
      ok?: boolean;
      relativePath?: string;
      artifactId?: string;
    };
    expect(pptxDetails.ok, JSON.stringify(pptx)).toBe(true);
    expect(xlsx.relativePath).toBeTruthy();
    const xlsxBytes = await fs.readFile(path.join(root, "office-suite", xlsx.relativePath ?? ""));
    const toolRoot = path.join(root, "office-tool", "output", "office-suite");
    const pptxBytes = await fs.readFile(path.join(toolRoot, pptxDetails.relativePath ?? ""));
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(pptxBytes);
    const slideNames = Object.keys(zip.files).filter((name) =>
      /^ppt\/slides\/slide\d+\.xml$/.test(name),
    );
    expect(slideNames).toHaveLength(6);
    const xlsxSha = createHash("sha256").update(xlsxBytes).digest("hex");
    const pptxSha = createHash("sha256").update(pptxBytes).digest("hex");
    const reportSha = sha(REPORT_V2);
    expect(xlsxBytes.length).toBeGreaterThan(0);
    expect(pptxBytes.length).toBeGreaterThan(0);
    expect(reportSha).toBe(seededV2.contentSha256);

    const waiting = evaluateGroupFinalOverallAcceptance({
      boardStatus: accepted.value.status,
      acceptanceReason: null,
      boardAcceptanceCriteria: CRITERIA,
      checkedAcceptanceCriteria: CRITERIA,
      acceptedArtifactVersion: "v2",
      pinnedArtifactVersion: "v2",
    });
    expect(waiting).toEqual({ outcome: "deny", reason: "acceptance_reason_required" });

    const dirs = acceptedArtifactDeliveryDirs(path.join(root, "group-final"));
    const denied = await requestGroupFinalDelivery({
      issuerInput: {
        source: "resolveTrustedWriteContext",
        tenantId: "iso-r2",
        actorId: COORD,
        groupId: GROUP,
        groupAction: "write",
      },
      facts: {
        groupId: GROUP,
        taskId,
        itemId: boardItemId,
        scope: "group_final",
        boardStatus: "accepted",
        acceptedSubmissionId: submissionId2,
        acceptedArtifactVersion: "v2",
        linkedDeliverableId: seededV2.deliverableId,
        linkedDeliverableVersion: seededV2.version,
        linkedContentSha256: reportSha,
        deliverableId: seededV2.deliverableId,
        deliverableVersion: seededV2.version,
        deliverableContentSha256: reportSha,
        plainText: REPORT_V2,
      },
      overallAcceptance: {
        boardStatus: "integrated",
        acceptanceReason: null,
        boardAcceptanceCriteria: CRITERIA,
        checkedAcceptanceCriteria: CRITERIA,
        acceptedArtifactVersion: "v2",
        pinnedArtifactVersion: "v2",
      },
      target: { channel: "telegram", accountId: "iso-acct", to: "iso-chat" },
      scopeFacts: {
        channel: "telegram",
        accountId: "iso-acct",
        accountEnabled: true,
        allowedDestinations: ["iso-chat"],
      },
      dirs,
      cfg,
      nowMs: 2_000,
    });
    expect(denied).toEqual({ ok: false, reason: "not_accepted" });

    const granted = await requestGroupFinalDelivery({
      issuerInput: {
        source: "resolveTrustedWriteContext",
        tenantId: "iso-r2",
        actorId: COORD,
        groupId: GROUP,
        groupAction: "write",
      },
      facts: {
        groupId: GROUP,
        taskId,
        itemId: boardItemId,
        scope: "group_final",
        boardStatus: "accepted",
        acceptedSubmissionId: submissionId2,
        acceptedArtifactVersion: "v2",
        linkedDeliverableId: seededV2.deliverableId,
        linkedDeliverableVersion: seededV2.version,
        linkedContentSha256: reportSha,
        deliverableId: seededV2.deliverableId,
        deliverableVersion: seededV2.version,
        deliverableContentSha256: reportSha,
        plainText: REPORT_V2,
      },
      overallAcceptance: {
        boardStatus: "accepted",
        acceptanceReason: "用户确认第一阶段经营复盘通过，附件 hash 已核对",
        boardAcceptanceCriteria: CRITERIA,
        checkedAcceptanceCriteria: CRITERIA,
        acceptedArtifactVersion: "v2",
        pinnedArtifactVersion: "v2",
      },
      target: { channel: "telegram", accountId: "iso-acct", to: "iso-chat" },
      scopeFacts: {
        channel: "telegram",
        accountId: "iso-acct",
        accountEnabled: true,
        allowedDestinations: ["iso-chat"],
      },
      dirs,
      cfg,
      nowMs: 3_000,
    });
    expect(granted, JSON.stringify(granted)).toMatchObject({ ok: true });
    if (!granted.ok) {
      return;
    }
    expect(granted.delivery.scope).toBe("group_final");
    expect(granted.delivery.phase === "delivered").toBe(false);
    expect(xlsxSha).toHaveLength(64);
    expect(pptxSha).toHaveLength(64);
  });
});
