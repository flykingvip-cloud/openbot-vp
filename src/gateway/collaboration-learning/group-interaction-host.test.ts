import { expect, it } from "vitest";
import type { GroupBoardClaimItem } from "../collaboration-dispatch/claim-contract.js";
import {
  captureGroupInteractionTarget,
  explainFormalTaskRejection,
  groupTaskControlReply,
} from "./group-interaction-host.js";
const item = {
  groupId: "g",
  taskId: "task",
  itemId: "item",
  title: "Report",
  revision: 1,
  status: "in_progress",
} as GroupBoardClaimItem;
it("binds only same-group formal task revisions and rejects stale or foreign targets", () => {
  const captured = captureGroupInteractionTarget("g", "task", [item]);
  expect(captured).toBeDefined();
  expect(captureGroupInteractionTarget("foreign", "task", [item])).toBeUndefined();
  expect(captureGroupInteractionTarget("g", "other", [item])).toBeUndefined();
  expect(
    captureGroupInteractionTarget("g", "task", [{ ...item, revision: undefined }]),
  ).toBeUndefined();
  const decision = { kind: "task_control" as const, action: "cancel" as const, target: captured! };
  expect(
    groupTaskControlReply(
      decision,
      captured,
      captureGroupInteractionTarget("g", "task", [{ ...item, revision: 2 }]),
      [item],
    ),
  ).toContain("版本已变化");
  expect(
    groupTaskControlReply(
      { ...decision, target: { ...captured!, taskId: "other" } },
      captured,
      captured,
      [item],
    ),
  ).toContain("尚未修改");
});
it("status uses board facts; mutations explain existing controls without creating authority or tasks", () => {
  const target = captureGroupInteractionTarget("g", "task", [item])!;
  expect(
    groupTaskControlReply({ kind: "task_control", action: "status", target }, target, target, [
      item,
    ]),
  ).toContain("in_progress");
  expect(
    groupTaskControlReply(
      { kind: "task_change", target, text: "revise", mode: "revise" },
      target,
      target,
      [item],
    ),
  ).toContain("尚未修改或重建任务");
});
it("rejection explanation retains facts and gives next steps without claiming feature enablement", () => {
  expect(
    explainFormalTaskRejection("formal_task_blocked_flag_off", "尚未建立正式任务。"),
  ).toContain("管理员");
  expect(explainFormalTaskRejection("formal_task_blocked_auth")).toContain("任务写入权限");
  expect(explainFormalTaskRejection("blocked")).toContain("看板");
});
