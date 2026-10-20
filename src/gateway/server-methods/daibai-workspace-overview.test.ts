import { describe, expect, it } from "vitest";
import type { GatewayCollaborationSpaceSnapshot } from "../collaboration-learning/snapshot-types.js";
import type { EmployeeWorkbenchActor } from "../employee-workbench-scope.js";
import type { GatewayAgentRow } from "../session-utils.js";
import {
  buildDaibaiWorkspaceOverview,
  buildDaibaiWorkspaceScopePrompt,
  buildDaibaiWorkspaceOverviewSummary,
} from "./daibai-workspace-overview.js";

const actor: EmployeeWorkbenchActor = {
  userId: "user-1",
  userEmail: "user@example.com",
  tenantId: "tenant-1",
  seatAgentIds: ["main", "agent-sales", "agent-ops"],
  seatSpaceIds: ["group-alpha", "group-beta"],
};

const agents: GatewayAgentRow[] = [
  { id: "main", name: "大白管家", scope: "personal" },
  { id: "agent-sales", name: "销售助理", scope: "personal" },
  { id: "agent-ops", name: "运营助理", scope: "personal" },
  { id: "agent-hidden", name: "隐藏助理", scope: "team" },
] as GatewayAgentRow[];

const spaces: GatewayCollaborationSpaceSnapshot[] = [
  {
    id: "space:group-alpha",
    groupId: "group-alpha",
    title: "数字人战队",
    members: {
      humans: [
        { userId: "user-1", name: "CEO", status: "active" },
        { userId: "user-2", name: "高级秘书", status: "active" },
      ],
      bots: [
        { agentId: "main", name: "大白管家", status: "active" },
        { agentId: "agent-sales", name: "销售助理", status: "active" },
      ],
    },
    invites: { humans: [], bots: [] },
  },
  {
    id: "space:group-beta",
    groupId: "group-beta",
    title: "OpenBot 市场部",
    members: {
      humans: [{ userId: "user-1", name: "CEO", status: "active" }],
      bots: [{ agentId: "agent-ops", name: "运营助理", status: "active" }],
    },
    invites: { humans: [], bots: [] },
  },
] as GatewayCollaborationSpaceSnapshot[];

describe("daibai-workspace-overview", () => {
  it("counts visible robots and spaces while excluding the builtin steward", () => {
    const overview = buildDaibaiWorkspaceOverview({
      actor,
      agents,
      spaces,
      sessionKey: "agent:main:employee:user-1",
    });

    expect(overview.visibleRobotCount).toBe(2);
    expect(overview.visibleSpaceCount).toBe(2);
    expect(overview.currentSpace).toBeUndefined();
    expect(buildDaibaiWorkspaceOverviewSummary(overview)).toBe("当前可见 2 个机器人、2 个协作群。");
  });

  it("summarizes the current collaboration group from sourceSessionKey when available", () => {
    const overview = buildDaibaiWorkspaceOverview({
      actor,
      agents,
      spaces,
      sessionKey: "agent:main:employee:user-1",
      sourceSessionKey: "space:group-alpha",
    });

    expect(overview.currentSpace).toEqual({
      groupId: "group-alpha",
      title: "数字人战队",
      memberCount: 4,
      humanCount: 2,
      botCount: 2,
      humans: ["CEO", "高级秘书"],
      bots: ["大白管家", "销售助理"],
    });
    expect(buildDaibaiWorkspaceOverviewSummary(overview)).toBe(
      "当前可见 2 个机器人、2 个协作群。 当前群「数字人战队」共有 4 位成员（人类 2 / 机器人 2）。",
    );
  });

  it("builds a prompt that lists visible collaboration groups and forbids false absence claims", () => {
    const prompt = buildDaibaiWorkspaceScopePrompt({
      actor,
      agents,
      spaces,
      sessionKey: "agent:main:employee:user-1",
      sourceSessionKey: "space:group-alpha",
    });

    expect(prompt).toContain("可见协作群（2）");
    expect(prompt).toContain("数字人战队（成员 4：人类 2 / 机器人 2）");
    expect(prompt).toContain("OpenBot 市场部（成员 2：人类 1 / 机器人 1）");
    expect(prompt).toContain("在我当前授权范围内暂未看到");
    expect(prompt).toContain("系统中只有某一个群");
  });
});
