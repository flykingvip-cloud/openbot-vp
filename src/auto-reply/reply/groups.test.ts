import { describe, expect, it } from "vitest";
import { buildGroupChatContext } from "./groups.js";

describe("buildGroupChatContext", () => {
  it("does not tell non-coordinator agents to reply normally for group coordination", () => {
    const context = buildGroupChatContext({
      sessionCtx: {
        Provider: "webchat",
        GroupSubject: "upbeyond",
        GroupMembers: "大白管家, 市场助手",
      },
      organizationContext: {
        organization: { id: "upbeyond", name: "upbeyond" },
        self: {
          agentId: "bot-2",
          displayName: "市场助手",
          coordinatorAgentId: "main",
          permissions: ["receive_tasks", "report_status"],
          reachableAgents: [{ agentId: "main", displayName: "大白管家" }],
          identitySource: "organization_registry",
          capabilities: [],
        },
        coordinator: { agentId: "main", displayName: "大白管家" },
        members: [
          { agentId: "main", displayName: "大白管家" },
          { agentId: "bot-2", displayName: "市场助手" },
        ],
      },
    });

    expect(context).toContain("Coordinator Authority:");
    expect(context).toContain("User-visible group coordination belongs to 大白管家 (main).");
    expect(context).toContain("do not use it for group-level coordination");
    expect(context).not.toContain("just reply normally");
  });

  it("keeps normal group reply guidance for the coordinator", () => {
    const context = buildGroupChatContext({
      sessionCtx: {
        Provider: "webchat",
        GroupSubject: "upbeyond",
      },
      organizationContext: {
        organization: { id: "upbeyond", name: "upbeyond" },
        self: {
          agentId: "main",
          displayName: "大白管家",
          coordinatorAgentId: "main",
          permissions: ["coordinate"],
          reachableAgents: [{ agentId: "bot-2", displayName: "市场助手" }],
          identitySource: "organization_registry",
          capabilities: [],
        },
        coordinator: { agentId: "main", displayName: "大白管家" },
        members: [
          { agentId: "main", displayName: "大白管家" },
          { agentId: "bot-2", displayName: "市场助手" },
        ],
      },
    });

    expect(context).toContain("just reply normally");
    expect(context).not.toContain("Coordinator Authority:");
  });
});
