import { beforeEach, describe, expect, it, vi } from "vitest";

const owners = new Map<string, string>();

vi.mock("../gateway/ownership-store.js", () => ({
  findActiveOwnershipRecord: (params: { subjectId: string }) => {
    const owner = owners.get(params.subjectId);
    return owner ? { currentManagerUserId: owner } : null;
  },
}));

vi.mock("../gateway/agent-registry/store.js", () => ({
  loadAgentRegistryStore: async () => ({}),
}));

vi.mock("../gateway/agent-registry/registry.js", () => ({
  listAgentAssets: () => [
    { legacyAgentId: "bot-a", displayName: "我的助手" },
    { legacyAgentId: "bot-b", displayName: "别人的助手" },
  ],
}));

vi.mock("../diagnosis/diagnose-conversation.js", () => ({
  extractEmployeeStewardUserId: () => null,
  listOwnedDiagnoseAgentIds: ({ userId }: { userId: string }) =>
    userId === "user-a" ? ["bot-a"] : [],
}));

const { canSendConversationHandoff, listConversationPeers } =
  await import("./conversation-handoff.js");

describe("ordinary assistant collaboration stays same-user", () => {
  beforeEach(() => {
    owners.clear();
    owners.set("bot-a", "user-a");
    owners.set("bot-b", "user-b");
  });

  it("refuses an assistant messaging a different user's bot even for a tenant admin", () => {
    expect(
      canSendConversationHandoff({
        requesterUserId: "user-a",
        tenantId: "acme",
        tenantAdmin: true,
        targetAgentId: "bot-b",
        callerAgentId: "bot-a",
      }),
    ).toBe(false);
  });

  it("allows same-user assistants to collaborate", () => {
    owners.set("bot-c", "user-a");
    expect(
      canSendConversationHandoff({
        requesterUserId: "user-a",
        tenantId: "acme",
        tenantAdmin: false,
        targetAgentId: "bot-c",
        callerAgentId: "bot-a",
      }),
    ).toBe(true);
  });

  it("does not list another user's assistant for a tenant admin", async () => {
    const peers = await listConversationPeers({
      tenantId: "acme",
      requesterUserId: "user-a",
      tenantAdmin: true,
      sessionExists: () => true,
    });
    expect(peers.map((peer) => peer.agentId)).toEqual(["bot-a"]);
  });
});
