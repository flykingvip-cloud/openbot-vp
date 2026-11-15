import { describe, expect, it } from "vitest";
import { parseAppointedProjectOwner } from "./collaboration-current-goal-binding.js";

const members = [
  { id: "uat-lead", name: "项目经理" },
  { id: "uat-analyst", name: "分析员" },
  { id: "uat-reviewer", name: "审查员" },
];

describe("appointment clause live seam", () => {
  it.each([
    "指定uat-lead担任负责人，uat-analyst负责核算、uat-reviewer负责非作者审查。",
    "请任命 @uat-lead 为项目负责人，组织 @uat-analyst 和 @uat-reviewer 完成复盘。",
    "指定项目经理担任负责人，分析员负责核算，审查员负责非作者审查。",
  ])("binds only the appointed member, independently of contribution mentions: %s", (message) => {
    expect(parseAppointedProjectOwner({ message, knownMembers: members })?.ownerId).toBe(
      "uat-lead",
    );
  });

  it.each([
    "请 @uat-lead 与 @uat-analyst 看一下材料。",
    "不要任命 @uat-lead 为负责人，请 @uat-reviewer 补证据。",
    "任命 @uat-lead 或 @uat-analyst 为负责人，先等我确定人选。",
    "任命foreign-bot担任负责人，请 @uat-lead 贡献材料。",
  ])("does not invent an appointment: %s", (message) => {
    expect(parseAppointedProjectOwner({ message, knownMembers: members })).toBeNull();
  });

  it("requires the current roster and rejects contradictory explicit proposals", () => {
    const message = "指定uat-lead担任负责人，uat-analyst负责核算。";
    expect(parseAppointedProjectOwner({ message })).toBeNull();
    expect(
      parseAppointedProjectOwner({
        message,
        appointedOwnerId: "uat-analyst",
        knownMembers: members,
      }),
    ).toBeNull();
  });
});
