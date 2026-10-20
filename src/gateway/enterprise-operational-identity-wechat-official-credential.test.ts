import { describe, expect, it, vi } from "vitest";
import type { EnterpriseOperationalIdentityCredentialSecret } from "./enterprise-operational-identity-oauth/credential-secrets-persistence.js";
import {
  finalizeWechatOfficialManualCredentialSecret,
  refreshWechatOfficialOperationalAccessToken,
  resolveWechatOfficialAuthMode,
} from "./enterprise-operational-identity-wechat-official-credential.js";
import {
  executeWechatOfficialActionWithTicketRetry,
  explainWechatOfficialTokenError,
  isWechatOfficialAccessTokenRetryableError,
} from "./wechat-official/credentials.js";

const baseSecret = (): EnterpriseOperationalIdentityCredentialSecret => ({
  credentialBindingId: "cred-1",
  tenantId: "001",
  connectorId: "wechat-official",
  kind: "oauth_token",
  accessToken: "",
  createdAt: "2026-07-12T00:00:00.000Z",
  updatedAt: "2026-07-12T00:00:00.000Z",
});

describe("enterprise-operational-identity-wechat-official-credential", () => {
  it("explains WeChat IP whitelist failures with the rejected IP", () => {
    expect(
      explainWechatOfficialTokenError(
        40164,
        "invalid ip 117.129.37.33 ipv6 ::ffff:117.129.37.33, not in whitelist rid: abc",
      ),
    ).toContain("117.129.37.33");
  });

  it("detects client_credential auth mode from metadata", () => {
    expect(
      resolveWechatOfficialAuthMode({
        ...baseSecret(),
        metadata: { authMode: "client_credential", appSecret: "secret" },
      }),
    ).toBe("client_credential");
    expect(
      resolveWechatOfficialAuthMode({
        ...baseSecret(),
        refreshToken: "refresh-token",
      }),
    ).toBe("authorizer");
    expect(
      resolveWechatOfficialAuthMode({
        ...baseSecret(),
        externalAccountId: "wxb502501ca0df2586",
      }),
    ).toBe("client_credential");
  });

  it("finalizes manual credential with client_credential token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "token-abc", expires_in: 7200 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const finalized = await finalizeWechatOfficialManualCredentialSecret({
      secret: baseSecret(),
      appId: "wxtestappid0000001",
      appSecret: "test-secret",
      nowIso: "2026-07-12T01:00:00.000Z",
    });

    expect(finalized.externalAccountId).toBe("wxtestappid0000001");
    expect(finalized.accessToken).toBe("token-abc");
    expect(finalized.metadata?.authMode).toBe("client_credential");
    expect(finalized.metadata?.appSecret).toBe("test-secret");
    expect(finalized.expiresAt).toBe("2026-07-12T03:00:00.000Z");
    vi.unstubAllGlobals();
  });

  it("refetches client_credential tokens instead of reusing a cached gettoken", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "stable-fresh", expires_in: 7200 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await refreshWechatOfficialOperationalAccessToken({
      secret: {
        ...baseSecret(),
        accessToken: "stale-cached-token",
        expiresAt: "2026-07-12T03:00:00.000Z",
        metadata: {
          authMode: "client_credential",
          appId: "wxtestappid0000001",
          appSecret: "test-secret",
        },
      },
      nowIso: "2026-07-12T01:00:00.000Z",
    });

    expect(result.refreshed).toBe(true);
    expect(result.secret.accessToken).toBe("stable-fresh");
    expect(fetchMock).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("executeWechatOfficialActionWithTicketRetry", () => {
  it("falls back to cached ticket when both ticket exchanges fail", async () => {
    const result = await executeWechatOfficialActionWithTicketRetry({
      cachedTicket: "cached-ticket",
      resolveTicket: async () => null,
      execute: async (ticket) => `ok:${ticket}`,
    });
    expect(result).toBe("ok:cached-ticket");
  });

  it("retries the same API once after a 42001 response", async () => {
    let forceRefreshCalls = 0;
    let executeCalls = 0;
    const result = await executeWechatOfficialActionWithTicketRetry({
      cachedTicket: "cached-ticket",
      resolveTicket: async (forceRefresh) => {
        if (forceRefresh) {
          forceRefreshCalls += 1;
          return "fresh-ticket";
        }
        return "stale-ticket";
      },
      execute: async (ticket) => {
        executeCalls += 1;
        if (ticket === "stale-ticket") {
          throw new Error("WeChat token expired: 42001");
        }
        return `ok:${ticket}`;
      },
    });
    expect(result).toBe("ok:fresh-ticket");
    expect(forceRefreshCalls).toBe(1);
    expect(executeCalls).toBe(2);
  });
});

describe("isWechatOfficialAccessTokenRetryableError", () => {
  it("treats 42001 and 40001 as retryable token errors", () => {
    expect(isWechatOfficialAccessTokenRetryableError(new Error("errcode: 42001"))).toBe(true);
    expect(isWechatOfficialAccessTokenRetryableError(new Error("access_token expired"))).toBe(true);
    expect(isWechatOfficialAccessTokenRetryableError(new Error("errcode: 40164"))).toBe(false);
  });
});
