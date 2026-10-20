import { describe, expect, it } from "vitest";
import { scopeAgentsForClientActor } from "./employee-workbench-scope.js";

const roster = [
  { id: "main", name: "大白管家", scope: "self" },
  { id: "agt-other", name: "市场助手", ownerId: "other-user", scope: "shared" },
  { id: "agt-mine", name: "我的助手", ownerId: "me@example.com", scope: "shared" },
] as const;

describe("scopeAgentsForClientActor", () => {
  it("returns steward-only when personal-workbench actor is null", () => {
    const agents = scopeAgentsForClientActor(
      { sessionDomain: "employee", user: "me@example.com" } as never,
      [...roster] as never,
      null,
    );
    expect(agents.map((entry) => entry.id)).toEqual(["main"]);
  });

  it("filters by actor seat/ownership when actor resolves", () => {
    const agents = scopeAgentsForClientActor(
      { sessionDomain: "employee", user: "me@example.com" } as never,
      [...roster] as never,
      {
        userId: "user-me",
        userEmail: "me@example.com",
        tenantId: "tenant-a",
        seatAgentIds: ["main", "agt-mine"],
        seatSpaceIds: [],
      },
    );
    expect(agents.map((entry) => entry.id).toSorted()).toEqual(["agt-mine", "main"]);
  });

  it("keeps install-wide roster for platform sessions without actor", () => {
    const input = [...roster];
    const agents = scopeAgentsForClientActor(
      { sessionDomain: "platform", user: "ops@example.com" } as never,
      input as never,
      null,
    );
    expect(agents).toEqual(input);
  });

  it("fails closed for authenticated sessions missing sessionDomain", () => {
    const agents = scopeAgentsForClientActor(
      { user: "me@example.com" } as never,
      [...roster] as never,
      null,
    );
    expect(agents.map((entry) => entry.id)).toEqual(["main"]);
  });

  it("does not grant a bot because ownerId matches the user email", () => {
    const agents = scopeAgentsForClientActor(
      { sessionDomain: "employee", user: "me@example.com" } as never,
      [...roster] as never,
      {
        userId: "user-me",
        userEmail: "me@example.com",
        tenantId: "tenant-a",
        seatAgentIds: ["main"],
        seatSpaceIds: [],
      },
    );
    expect(agents.map((entry) => entry.id)).toEqual(["main"]);
  });

  it("personal-scopes enterprise-admin sessions instead of tenant mesh", () => {
    const agents = scopeAgentsForClientActor(
      { sessionDomain: "enterprise", user: "ceo@example.com" } as never,
      [...roster] as never,
      {
        userId: "user-ceo",
        userEmail: "ceo@example.com",
        tenantId: "tenant-a",
        seatAgentIds: ["main", "agt-mine"],
        seatSpaceIds: [],
      },
    );
    expect(agents.map((entry) => entry.id).toSorted()).toEqual(["agt-mine", "main"]);
  });

  it("fails closed for enterprise sessions when actor is unresolved", () => {
    const agents = scopeAgentsForClientActor(
      { sessionDomain: "enterprise", user: "ceo@example.com" } as never,
      [...roster] as never,
      null,
    );
    expect(agents.map((entry) => entry.id)).toEqual(["main"]);
  });

  it("does not return foreign seat agents when www still carries a platform session", () => {
    const agents = scopeAgentsForClientActor(
      {
        sessionDomain: "platform",
        sessionKind: "platform-super-admin",
        user: "ceo@example.com",
        upgradeRequestOrigin: "https://www.openbot.love",
      } as never,
      [...roster] as never,
      null,
    );
    expect(agents.map((entry) => entry.id)).toEqual(["main"]);
    expect(agents.some((entry) => entry.id === "agt-other")).toBe(false);
  });

  it("does not return foreign seat agents when the www socket lost its session", () => {
    const agents = scopeAgentsForClientActor(
      { upgradeRequestHost: "www.openbot.love" } as never,
      [...roster] as never,
      null,
    );
    expect(agents.map((entry) => entry.id)).toEqual(["main"]);
  });

  it("returns about N position grants for a CEO seat and drops other seats", () => {
    const grants = [
      "main",
      "panda",
      "bot-2",
      "bot--agent",
      "bot-skill",
      "agt-nchn5ey",
      "agt-openbot",
      "agt-ntjgyw5",
    ];
    const present = grants.filter((id) => id !== "bot--agent");
    const foreign = [
      { id: "agt-l-zong", name: "L总", ownerId: "seat-other", scope: "self" },
      { id: "agt-sales-ops", name: "销售运营分析师", ownerId: "seat-ws18", scope: "self" },
      { id: "agt-susie", name: "Susie的公众号助理", ownerId: "seat-0a61", scope: "self" },
    ];
    const agents = scopeAgentsForClientActor(
      {
        sessionDomain: "employee",
        user: "ceo@example.com",
        upgradeRequestOrigin: "https://www.openbot.love",
      } as never,
      [...present.map((id) => ({ id, name: id, scope: "self" })), ...foreign] as never,
      {
        userId: "user-ceo",
        userEmail: "ceo@example.com",
        tenantId: "tenant-a",
        currentSeatId: "seat-ceo-daniel-main",
        seatAgentIds: grants,
        seatSpaceIds: [],
      },
    );
    expect(agents.map((entry) => entry.id).toSorted()).toEqual(present.toSorted());
    expect(agents).toHaveLength(present.length);
    expect(agents.some((entry) => entry.id === "agt-l-zong")).toBe(false);
  });
});
