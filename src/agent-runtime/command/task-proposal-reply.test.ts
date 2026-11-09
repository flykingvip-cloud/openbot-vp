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
