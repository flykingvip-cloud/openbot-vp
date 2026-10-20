import { describe, expect, it } from "vitest";
import { resolveRobotRosterStatus, robotRosterEmptyCopy } from "./robot-roster-status.ts";

describe("resolveRobotRosterStatus", () => {
  it("treats a signed-in employee with no position as unbound", () => {
    expect(
      resolveRobotRosterStatus({
        signedIn: true,
        employeeAccessPresent: true,
        currentSeatId: null,
        connected: true,
        agentsListPresent: true,
        agentsError: null,
        positionBotCount: 0,
      }),
    ).toBe("unbound");
    expect(robotRosterEmptyCopy("unbound")).toContain("尚未绑定岗位");
  });

  it("distinguishes query failure, sync failure, and a bound position with zero bots", () => {
    expect(
      resolveRobotRosterStatus({
        signedIn: true,
        employeeAccessPresent: true,
        currentSeatId: "seat-cs",
        connected: true,
        agentsListPresent: false,
        agentsError: "agents.list failed",
        positionBotCount: 0,
      }),
    ).toBe("query_failed");
    expect(
      resolveRobotRosterStatus({
        signedIn: true,
        employeeAccessPresent: true,
        currentSeatId: "seat-cs",
        connected: true,
        agentsListPresent: false,
        agentsError: null,
        positionBotCount: 0,
      }),
    ).toBe("sync_failed");
    expect(
      resolveRobotRosterStatus({
        signedIn: true,
        employeeAccessPresent: true,
        currentSeatId: "seat-cs",
        connected: true,
        agentsListPresent: true,
        agentsError: null,
        positionBotCount: 0,
      }),
    ).toBe("zero");
    expect(robotRosterEmptyCopy("zero")).toContain("还没有机器人");
    expect(robotRosterEmptyCopy("query_failed")).toContain("查询失败");
    expect(robotRosterEmptyCopy("sync_failed")).toContain("没有同步");
  });
});
