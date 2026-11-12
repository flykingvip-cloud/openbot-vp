import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ list: vi.fn(), exists: vi.fn() }));
vi.mock("../../conversation-task/conversation-handoff.js", () => ({
  listConversationPeers: mocks.list,
  resolveConversationSessionExists: mocks.exists,
}));
import { readConversationPeerContext } from "./conversation-peer-context.js";
beforeEach(() => vi.clearAllMocks());
it("does not read a global registry when trusted tenant or owner is absent", async () => {
  expect(await readConversationPeerContext({ tenantId: "t1", client: null })).toBeUndefined();
  expect(mocks.list).not.toHaveBeenCalled();
});
it("uses the sending tool's same-owner directory and owner-scoped session resolver", async () => {
  const exists = vi.fn();
  mocks.exists.mockResolvedValue(exists);
  mocks.list.mockResolvedValue([
    { agentId: "account", displayName: "客户经理", sessionExists: true },
  ]);
  expect(
    await readConversationPeerContext({ tenantId: "t1", ownerUserId: "u1", client: null }),
  ).toContain("客户经理");
  expect(mocks.list).toHaveBeenCalledWith({
    tenantId: "t1",
    requesterUserId: "u1",
    tenantAdmin: false,
    includeMissingSessions: true,
    sessionExists: exists,
  });
});
