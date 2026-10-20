import { describe, expect, it } from "vitest";
import { buildOperationalIdentityCredentialEditPreview } from "./credential-edit-preview.js";

describe("buildOperationalIdentityCredentialEditPreview", () => {
  it("returns appId and secret configured flags for wechat-official manual credentials", () => {
    const preview = buildOperationalIdentityCredentialEditPreview({
      provider: "wechat-official",
      externalAccountId: "wx_test_app",
      secret: {
        credentialBindingId: "cred-1",
        tenantId: "tenant-1",
        connectorId: "wechat-official",
        kind: "oauth_token",
        accessToken: "token",
        externalAccountId: "wx_test_app",
        metadata: {
          authMode: "client_credential",
          appId: "wx_test_app",
          appSecret: "secret-value",
        },
        createdAt: "2026-07-12T00:00:00.000Z",
        updatedAt: "2026-07-12T00:00:00.000Z",
      },
    });
    expect(preview).toEqual({
      fields: { appId: "wx_test_app" },
      secretsConfigured: ["appSecret"],
    });
  });
});
