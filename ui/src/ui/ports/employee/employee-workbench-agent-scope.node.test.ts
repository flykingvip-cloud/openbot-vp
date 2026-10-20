import { describe, expect, it } from "vitest";
import { filterAgentsListForEmployeeWorkbench } from "./employee-workbench-agent-scope.ts";

const roster = {
  defaultId: "main",
  mainKey: "agent:main:main",
  scope: "global" as const,
  agents: [
    { id: "main", name: "大白管家", scope: "self" },
    { id: "position-bot", name: "客户经理", scope: "shared", ownerId: "seat-cs" },
    { id: "foreign-bot", name: "别人的助手", scope: "self", ownerId: "other-user" },
  ],
};

describe("employee-workbench-agent-scope", () => {
  it("shows the backend agents.list unchanged", () => {
    const filtered = filterAgentsListForEmployeeWorkbench(roster);
    expect(filtered?.agents.map((entry) => entry.id)).toEqual([
      "main",
      "position-bot",
      "foreign-bot",
    ]);
  });

  it("returns null when the list has not arrived", () => {
    expect(filterAgentsListForEmployeeWorkbench(null)).toBeNull();
  });
});
