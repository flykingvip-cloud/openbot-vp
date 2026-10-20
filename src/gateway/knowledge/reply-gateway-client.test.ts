import { describe, expect, it } from "vitest";
import { buildKnowledgeReplyGatewayClient } from "./reply-gateway-client.js";

describe("buildKnowledgeReplyGatewayClient", () => {
  it("returns null when both email and platformUserId are missing", () => {
    expect(buildKnowledgeReplyGatewayClient({})).toBeNull();
    expect(buildKnowledgeReplyGatewayClient({ gatewayClientUser: "   " })).toBeNull();
  });

  it("accepts a platformUserId without an email header", () => {
    const client = buildKnowledgeReplyGatewayClient({
      gatewayClientPlatformUserId: "user-90",
    });
    expect(client).not.toBeNull();
    expect(client?.platformUserId).toBe("user-90");
    expect(client?.user).toBeUndefined();
  });

  it("keeps both email and platformUserId when both are present", () => {
    const client = buildKnowledgeReplyGatewayClient({
      gatewayClientUser: "owner@example.com",
      gatewayClientPlatformUserId: "user-90",
      gatewayClientSessionDomain: "platform",
    });
    expect(client?.user).toBe("owner@example.com");
    expect(client?.platformUserId).toBe("user-90");
    expect(client?.sessionDomain).toBe("platform");
  });

  it("forwards the frozen ChatTurn enterprise id onto the reconstructed client", () => {
    const client = buildKnowledgeReplyGatewayClient({
      gatewayClientUser: "owner@example.com",
      gatewayClientPlatformUserId: "user-90",
      gatewayClientSessionDomain: "employee",
      gatewayClientSessionEnterpriseId: "001",
      gatewayClientSessionMembershipId: "mem-1",
    });
    expect(client?.sessionEnterpriseId).toBe("001");
    expect(client?.sessionTenantId).toBe("001");
    expect(client?.sessionMembershipId).toBe("mem-1");
  });
});
