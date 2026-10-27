/**
 * C0 — member progress export + freeze invariants.
 * Field evidence: tip 数字人战队 stuck at applied; no submitted visible; no listBoard.
 */
import { describe, expect, test } from "vitest";
import { rcisScoresMustNotDriveAdmission } from "../collaboration-learning/rcis-aggregate.js";
import { boardItemGoal, oralDispatchCreatesBoardFact } from "./claim-contract.js";
import {
  buildExecutionTaskBag,
  type ExecutorPrivateTodolist,
} from "./executor-private-todolist.js";
import {
  aggregateMemberProgress,
  chatDraftIsBoardProgressFact,
  formatMemberProgressTable,
  latestItemsFromBoardClaimJsonl,
} from "./member-progress-export.js";
import { selectModeBLead } from "./mode-b-member-selection.js";
import {
  assertExecutionTaskBagAllowsDelivery,
  evaluateDeliveryExecGate,
} from "./plan-gate-exec.js";

describe("C0 member progress export", () => {
  test("freeze: oral dispatch and chat draft are never board facts", () => {
    expect(oralDispatchCreatesBoardFact()).toBe(false);
    expect(chatDraftIsBoardProgressFact()).toBe(false);
  });

  test("freeze: RCIS must not drive admission", () => {
    expect(rcisScoresMustNotDriveAdmission()).toBe(true);
  });

  test("parses jsonl and answers member×status including applied-stuck baseline", () => {
    const raw = [
      JSON.stringify({
        kind: "board_claim",
        at: 1,
        item: {
          itemId: "item-1",
          groupId: "grp-zhandui",
          taskId: "task-2030",
          title: "2030 AI strategy",
          status: "published",
          publishedBy: "human:ceo",
          publishedAt: 1,
        },
      }),
      JSON.stringify({
        kind: "board_claim",
        at: 2,
        item: {
          itemId: "item-1",
          groupId: "grp-zhandui",
          taskId: "task-2030",
          title: "2030 AI strategy",
          status: "claimed",
          publishedBy: "human:ceo",
          publishedAt: 1,
          claimantId: "bot:bot",
          claimedAt: 2,
        },
      }),
      JSON.stringify({
        kind: "board_claim",
        at: 3,
        item: {
          itemId: "item-1",
          groupId: "grp-zhandui",
          taskId: "task-2030",
          title: "2030 AI strategy",
          status: "applied",
          publishedBy: "human:ceo",
          publishedAt: 1,
          claimantId: "bot:bot",
          claimedAt: 2,
          appliedAt: 3,
        },
      }),
      JSON.stringify({
        kind: "board_claim",
        at: 4,
        item: {
          itemId: "item-2",
          groupId: "grp-zhandui",
          taskId: "task-2030-ch2",
          title: "Chapter 2",
          status: "published",
          publishedBy: "bot:bot",
          publishedAt: 4,
        },
      }),
    ].join("\n");

    const items = latestItemsFromBoardClaimJsonl(raw);
    expect(items).toHaveLength(2);
    expect(items.find((i) => i.itemId === "item-1")?.status).toBe("applied");

    const report = aggregateMemberProgress({
      items,
      claimsDir: "/tmp/fake-board-claims",
      groupIdHint: "grp-zhandui",
      currentTaskId: "task-2030",
    });
    expect(report.memberCount).toBe(1);
    expect(report.members[0]?.memberId).toBe("bot:bot");
    expect(report.members[0]?.status).toBe("applied");
    expect(report.members[0]?.isSubmitted).toBe(false);
    expect(report.unclaimed).toHaveLength(1);
    expect(report.gaps.some((g) => g.includes("no_submitted_for_review"))).toBe(true);
    expect(report.gaps.some((g) => g.includes("assistant_at_mention"))).toBe(true);

    const table = formatMemberProgressTable(report);
    expect(table).toContain("bot:bot");
    expect(table).toContain("applied");
  });

  test("jsonl round-trip preserves intendedClaimantIds + publishedAt for Mode B claim-first", () => {
    const publishedAt = 1_700_000_000_000;
    const raw = JSON.stringify({
      kind: "board_claim",
      at: publishedAt,
      item: {
        itemId: "item-longrun",
        groupId: "grp-zhandui",
        taskId: "task-2030",
        title: "2030 AI strategy",
        status: "published",
        publishedBy: "cli",
        publishedAt,
        intendedClaimantIds: ["bot", "bot-2", "  bot  ", "", 42],
        remainingWork: "deliver",
        acceptanceCriteria: ["pdf"],
      },
    });

    const items = latestItemsFromBoardClaimJsonl(raw);
    expect(items).toHaveLength(1);
    const item = items[0];
    expect(item.publishedAt).toBe(publishedAt);
    expect(item.publishedBy).toBe("cli");
    // Dedupe + trim; non-strings dropped — tip FAIL was intendedClaimantIds=null here.
    expect(item.intendedClaimantIds).toEqual(["bot", "bot-2"]);
    expect(item.remainingWork).toBe("deliver");
    expect(item.acceptanceCriteria).toEqual(["pdf"]);

    const lead = selectModeBLead({
      boardItems: items,
      hasBroadcastMention: false,
    });
    expect(lead.leadAgentId).toBe("bot");
    expect(lead.reason).toBe("board_intended");
    expect(lead.leadAgentId).not.toBe("cli");
  });

  test("jsonl without intendedClaimantIds still omits field (publisher fallback unchanged)", () => {
    const items = latestItemsFromBoardClaimJsonl(
      JSON.stringify({
        kind: "board_claim",
        at: 1,
        item: {
          itemId: "item-legacy",
          groupId: "g",
          taskId: "t",
          title: "legacy",
          status: "published",
          publishedBy: "cli",
          publishedAt: 1,
        },
      }),
    );
    expect(items[0]?.intendedClaimantIds).toBeUndefined();
    expect(items[0]?.publishedAt).toBe(1);
    const lead = selectModeBLead({ boardItems: items });
    expect(lead.leadAgentId).toBe("cli");
  });

  test("forward-compatible: submitted_for_review + submissionId counted as submitted", () => {
    const items = latestItemsFromBoardClaimJsonl(
      JSON.stringify({
        kind: "board_claim",
        at: 9,
        item: {
          itemId: "item-9",
          groupId: "g",
          taskId: "t",
          title: "ch",
          status: "submitted_for_review",
          claimantId: "bot:market",
          submissionId: "11111111-1111-4111-8111-111111111111",
          submittedAt: 9,
        },
      }),
    );
    const report = aggregateMemberProgress({
      items,
      claimsDir: "/tmp/x",
      currentTaskId: "t",
    });
    expect(report.members[0]?.isSubmitted).toBe(true);
    expect(report.members[0]?.submissionId).toMatch(/11111111/);
  });

  test("jsonl round-trip preserves goal/remainingWork so self-advance exec bag is not incomplete", () => {
    const raw = JSON.stringify({
      kind: "board_claim",
      at: 1_792_302_700_560,
      item: {
        itemId: "3c6349a8-8f5f-4a35-84b1-6ccfb109e0e3",
        groupId: "grp-daniel-hhd-gmail-com-upbeyond",
        taskId: "task-zhandui-2030-ai-strategy-1791822358535",
        title: "行业口径 v2 修订并交付可验收摘要",
        remainingWork: "修订行业口径 v2 → 写可验收摘要",
        acceptanceCriteria: ["摘要≥800字", "变更点≥3"],
        goal: "完成 CEO 行业口径拍板后的 v2 修订",
        constraints: ["gray-group-only"],
        dueAtMs: 1_792_906_125_582,
        intendedClaimantIds: ["bot:bot-2"],
        publishedBy: "daniel.hhd@gmail.com",
        publishedAt: 1_792_302_700_514,
        status: "applied",
        claimantId: "bot:bot-2",
        claimedAt: 1_792_302_700_543,
        appliedAt: 1_792_302_700_560,
      },
    });

    const items = latestItemsFromBoardClaimJsonl(raw);
    expect(items).toHaveLength(1);
    const item = items[0];
    expect(item.goal).toBe("完成 CEO 行业口径拍板后的 v2 修订");
    expect(item.remainingWork).toBe("修订行业口径 v2 → 写可验收摘要");
    expect(item.acceptanceCriteria).toEqual(["摘要≥800字", "变更点≥3"]);
    expect(item.constraints).toEqual(["gray-group-only"]);
    expect(item.dueAtMs).toBe(1_792_906_125_582);
    // Regression: tip export stripped goal → boardItemGoal empty → exec_bag_incomplete
    expect(boardItemGoal(item as Parameters<typeof boardItemGoal>[0])).toBe(
      "完成 CEO 行业口径拍板后的 v2 修订",
    );

    const todolist = {
      todolistId: "tl-1",
      boardItemId: item.itemId,
      taskId: item.taskId,
      groupId: item.groupId,
      ownerMemberId: "bot:bot-2",
      status: "confirmed" as const,
      steps: [
        {
          stepId: "step-1",
          title: "对照已拍板口径整理变更点",
          status: "active" as const,
        },
      ],
      proposedBy: "bot:bot-2",
      proposedAt: 1,
      version: 5,
      visibility: "executor_private" as const,
      confirmedBy: "daniel.hhd@gmail.com",
      confirmedAt: 2,
    } satisfies ExecutorPrivateTodolist;

    const boardItem = {
      itemId: item.itemId,
      groupId: item.groupId,
      taskId: item.taskId,
      title: item.title,
      remainingWork: item.remainingWork ?? "",
      acceptanceCriteria: item.acceptanceCriteria ?? [],
      goal: item.goal,
      constraints: item.constraints,
      dueAtMs: item.dueAtMs,
      intendedClaimantIds: item.intendedClaimantIds ?? [],
      publishedBy: item.publishedBy ?? "unknown",
      publishedAt: item.publishedAt ?? 0,
      status: "applied" as const,
      claimantId: item.claimantId,
      claimedAt: item.claimedAt,
      appliedAt: item.appliedAt,
    };

    const gate = evaluateDeliveryExecGate({
      boardItem,
      todolist,
      ownerMemberId: "bot:bot-2",
    });
    expect(gate.mode).toBe("delivery_exec");
    expect(gate.reason).toBe("delivery_exec_eligible");
    expect(gate.taskBag).not.toBeNull();
    const complete = assertExecutionTaskBagAllowsDelivery(gate.taskBag);
    expect(complete.ok).toBe(true);

    // Guard: if export ever drops goal+remainingWork again, bag must fail closed.
    const stripped = { ...boardItem, goal: undefined, remainingWork: "" };
    const badBag = buildExecutionTaskBag({ boardItem: stripped, todolist });
    const bad = assertExecutionTaskBagAllowsDelivery(badBag);
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.reason).toBe("exec_bag_incomplete");
    }
  });
});
