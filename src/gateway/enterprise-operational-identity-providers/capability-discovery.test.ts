import { describe, expect, it } from "vitest";
import { discoverOperationalIdentityCapabilities } from "./capability-discovery.js";

describe("discoverOperationalIdentityCapabilities", () => {
  it("grants kuaishou publish when oauth probe passes", async () => {
    const result = await discoverOperationalIdentityCapabilities({
      provider: "kuaishou",
      secret: {
        credentialBindingId: "cb-1",
        tenantId: "t-1",
        connectorId: "kuaishou",
        kind: "oauth_token",
        accessToken: "secret",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      probeResults: {
        oauth_token: { ok: true },
      },
      nowIso: "2026-01-01T00:00:00.000Z",
    });
    expect(result.capabilities).toEqual(["publish_video"]);
    expect(result.missing).toEqual([]);
  });

  it("grants tencent-meeting actions when Token auth_ok probe passes", async () => {
    const result = await discoverOperationalIdentityCapabilities({
      provider: "tencent-meeting",
      secret: {
        credentialBindingId: "cb-1",
        tenantId: "t-1",
        connectorId: "tencent-meeting",
        kind: "oauth_token",
        accessToken: "skill-token",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      probeResults: {
        auth_ok: { ok: true },
      },
      nowIso: "2026-01-01T00:00:00.000Z",
    });
    expect(result.capabilities).toEqual(
      expect.arrayContaining(["schedule_meeting", "cancel_meeting", "list_meetings"]),
    );
    expect(result.missing).toEqual([]);
  });

  it("grants tencent-meeting actions when api_signature probe passes", async () => {
    const result = await discoverOperationalIdentityCapabilities({
      provider: "tencent-meeting",
      secret: {
        credentialBindingId: "cb-1",
        tenantId: "t-1",
        connectorId: "tencent-meeting",
        kind: "oauth_token",
        accessToken: "secret-key",
        metadata: {
          secretId: "sid",
          defaultUserId: "operator1",
          sdkId: "sdk-1",
        },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      probeResults: {
        operator_userid: { ok: true },
        api_signature: { ok: true },
      },
      nowIso: "2026-01-01T00:00:00.000Z",
    });
    expect(result.capabilities).toEqual(
      expect.arrayContaining([
        "schedule_meeting",
        "cancel_meeting",
        "get_meeting",
        "get_meeting_by_code",
        "list_meetings",
      ]),
    );
    expect(result.missing).toEqual([]);
    expect(result.metadata?.defaultUserId).toBe("operator1");
  });
});
