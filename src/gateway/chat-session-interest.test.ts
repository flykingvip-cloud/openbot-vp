import { beforeEach, describe, expect, it } from "vitest";
import {
  noteChatRunTenant,
  resetChatSessionInterestForTests,
  resolveChatRunTenantId,
  resolveParentChatRunId,
} from "./chat-session-interest.js";

describe("chat-session-interest run tenant inheritance", () => {
  beforeEach(() => {
    resetChatSessionInterestForTests();
  });

  it("walks child runIds back to the parent ChatTurn tenant", () => {
    noteChatRunTenant("turn-uuid", "tenant-a");
    expect(resolveChatRunTenantId("turn-uuid")).toBe("tenant-a");
    expect(resolveChatRunTenantId("turn-uuid:user")).toBe("tenant-a");
    expect(resolveChatRunTenantId("turn-uuid:bot-sales")).toBe("tenant-a");
    expect(resolveParentChatRunId("turn-uuid:user")).toBe("turn-uuid");
  });

  it("does not invent a tenant when the parent turn was never noted", () => {
    expect(resolveChatRunTenantId("orphan:user")).toBeNull();
  });
});
