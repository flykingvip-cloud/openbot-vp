import { describe, expect, it } from "vitest";
import type { EnterpriseIdentity } from "../enterprise-operational-identity-types.js";
import {
  resolveOperationalIdentityConnectionStatus,
  resolveOperationalIdentityHealthStatus,
} from "./identity-lifecycle.js";

function baseIdentity(overrides: Partial<EnterpriseIdentity> = {}): EnterpriseIdentity {
  return {
    identityId: "id-1",
    tenantId: "tenant-1",
    provider: "enterprise-email",
    displayName: "sales@example.com",
    credentialBindingId: "cb-1",
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("identity lifecycle", () => {
  it("marks identity as active when verified, capable, and policy exists", () => {
    const identity = baseIdentity({
      lastVerifiedAt: "2026-01-02T00:00:00.000Z",
      capabilities: ["send_email"],
    });
    const connectionStatus = resolveOperationalIdentityConnectionStatus({
      identity,
      hasEnabledPolicy: true,
      nowIso: "2026-01-03T00:00:00.000Z",
    });
    expect(connectionStatus).toBe("active");
    expect(resolveOperationalIdentityHealthStatus({ identity, connectionStatus })).toBe("active");
  });

  it("marks connected when verified but no policy yet", () => {
    const identity = baseIdentity({
      lastVerifiedAt: "2026-01-02T00:00:00.000Z",
      capabilities: ["send_email"],
    });
    expect(
      resolveOperationalIdentityConnectionStatus({
        identity,
        hasEnabledPolicy: false,
        nowIso: "2026-01-03T00:00:00.000Z",
      }),
    ).toBe("connected");
  });
});
