import { describe, expect, it } from "vitest";
import { resolveUserOperationalIdentityGatewayClient } from "./user-operational-identity-tool.js";

describe("resolveUserOperationalIdentityGatewayClient", () => {
  it("returns null for a global steward session without a gateway identity", () => {
    expect(
      resolveUserOperationalIdentityGatewayClient({
        agentSessionKey: "agent:main:main",
      }),
    ).toBeNull();
  });

  it("uses the employee steward session owner when the websocket client is empty", () => {
    const client = resolveUserOperationalIdentityGatewayClient({
      agentSessionKey: "agent:main:employee:90fed19a-1c8b-4420-87e0-bcc6165e32fa",
    });
    expect(client?.platformUserId).toBe("90fed19a-1c8b-4420-87e0-bcc6165e32fa");
    expect(client?.sessionDomain).toBe("employee");
  });

  it("prefers an explicit platform user id over the session key", () => {
    const client = resolveUserOperationalIdentityGatewayClient({
      gatewayClientPlatformUserId: "user-from-socket",
      agentSessionKey: "agent:main:employee:90fed19a-1c8b-4420-87e0-bcc6165e32fa",
    });
    expect(client?.platformUserId).toBe("user-from-socket");
  });
});
