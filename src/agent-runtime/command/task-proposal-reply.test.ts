import { expect, it } from "vitest";
import { formatTaskProposalReply } from "./task-proposal-reply.js";
const decision = {
  kind: "task_change" as const,
  target: { taskId: "a", revision: "1" },
  text: "三页",
  answer: "任务板最近记录：已完成资料整理。",
};
it("answers the question and acknowledges only the actual applied mutation", () => {
  expect(
    formatTaskProposalReply(decision, { kind: "applied", text: "三页要求已写入原任务。" }),
  ).toBe("任务板最近记录：已完成资料整理。\n\n三页要求已写入原任务。");
});
it("does not present a stale model answer as current after CAS rejection", () => {
  const reply = formatTaskProposalReply(decision, {
    kind: "rejected",
    reason: "revision_mismatch",
  });
  expect(reply).toContain("本次未修改");
  expect(reply).not.toContain(decision.answer);
});

it("does not treat an unconfirmed drain as an already-effective revision", () => {
  const reply = formatTaskProposalReply(decision, {
    kind: "unconfirmed",
    text: "要求已写入原任务板，但未能确认旧执行已停止，本次未启动新执行。",
  });
  expect(reply).toContain("未能确认旧执行已停止");
  expect(reply).not.toContain(decision.answer);
  expect(reply).not.toContain("已生效");
});

it("reports bound status using only host board facts", () => {
  expect(
    formatTaskProposalReply(
      {
        kind: "task_control",
        action: "status",
        target: { taskId: "a", revision: "1" },
        answer: "Everything is completed and delivered",
      },
      { kind: "applied", text: "Task board: unfinished" },
    ),
  ).toBe("Task board: unfinished");
});
