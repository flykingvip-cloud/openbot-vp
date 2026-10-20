import { describe, expect, it, vi } from "vitest";
import * as api from "./enterprise-operational-identity-tencent-meeting-api.js";
import { probeTencentMeetingCredential } from "./enterprise-operational-identity-tencent-meeting-credential.js";
import * as mcp from "./enterprise-operational-identity-tencent-meeting-mcp.js";

describe("probeTencentMeetingCredential", () => {
  it("reports missing default userid", async () => {
    const result = await probeTencentMeetingCredential({
      secret: {
        credentialBindingId: "cb-1",
        tenantId: "t-1",
        connectorId: "tencent-meeting",
        kind: "oauth_token",
        accessToken: "secret-key",
        metadata: { secretId: "sid" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    expect(result.signatureOk).toBe(false);
    expect(result.detail).toContain("userid");
  });

  it("accepts AI Skill Token without userid", async () => {
    vi.spyOn(mcp, "verifyTencentMeetingMcpToken").mockResolvedValue({ ok: true });
    const result = await probeTencentMeetingCredential({
      secret: {
        credentialBindingId: "cb-1",
        tenantId: "t-1",
        connectorId: "tencent-meeting",
        kind: "oauth_token",
        accessToken: "skill-token",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    expect(result).toEqual({ userId: "", signatureOk: true });
    vi.restoreAllMocks();
  });

  it("returns signatureOk when verify succeeds", async () => {
    vi.spyOn(api, "verifyTencentMeetingCredentials").mockResolvedValue({ ok: true });
    const result = await probeTencentMeetingCredential({
      secret: {
        credentialBindingId: "cb-1",
        tenantId: "t-1",
        connectorId: "tencent-meeting",
        kind: "oauth_token",
        accessToken: "secret-key",
        metadata: { secretId: "sid", defaultUserId: "operator1" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    expect(result).toEqual({ userId: "operator1", signatureOk: true });
    vi.restoreAllMocks();
  });
});
