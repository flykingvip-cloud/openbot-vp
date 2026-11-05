import fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EnterpriseDataStoreError, listConnectorActions } from "./connector-action-store.js";
import { findDataConnectorDefinition, resolveDataConnectorCatalog } from "./connector-catalog.js";
import { upsertDataConnectorCredential } from "./connector-credential-store.js";
import { loadCredentialSecret, saveCredentialSecret } from "./connector-credential-vault.js";
import {
  loadDataConnectorOAuthSessionStore,
  saveDataConnectorOAuthSessionStore,
} from "./connector-oauth-session-persistence.js";
import {
  simulateCompleteDataConnectorOAuthSession,
  startDataConnectorOAuthSession,
} from "./connector-oauth.js";
import { ensureConnectorPackage } from "./connector-packages.js";
import { upsertDataSource } from "./data-source-store.js";
import { MATERIALIZER_SEAT_ID } from "./enterprise-data-seat-context.js";
import { findScopePolicy, upsertScopePolicy } from "./scope-policy-store.js";
import { findSeatActionGrant, listSeatActionGrants } from "./seat-action-grant-store.js";
import { probeDataSourceConnection } from "./source-connection-probe.js";
import { normalizeEnterpriseDataStore } from "./store.js";
import {
  loadYonyouTplusAppTicket,
  saveYonyouTplusAppTicket,
  saveYonyouTplusOrgPermanentAuth,
} from "./yonyou-tplus-message-store.js";

function isRequestInit(value: unknown): value is RequestInit {
  return Boolean(value) && typeof value === "object";
}

function recordedFetch(mock: { mock: { calls: readonly unknown[] } }): [string, RequestInit] {
  const call: unknown = mock.mock.calls[0];
  if (!Array.isArray(call) || typeof call[0] !== "string" || !isRequestInit(call[1])) {
    throw new Error("expected fetch(url, init)");
  }
  return [call[0], call[1]];
}

const testPaths = vi.hoisted(() => ({
  tmpDir: `/tmp/openbot-yonyou-tplus-connector-${Date.now()}`,
}));

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return {
    ...actual,
    CONFIG_DIR: testPaths.tmpDir,
  };
});

const tenantId = "tenant-jingshanzi";
const nowIso = "2026-10-22T00:00:00.000Z";

function jsonBody(body: RequestInit["body"]): unknown {
  if (typeof body !== "string") {
    throw new Error("expected a string request body");
  }
  return JSON.parse(body);
}

function cleanStore() {
  fs.rmSync(testPaths.tmpDir, { recursive: true, force: true });
  fs.mkdirSync(testPaths.tmpDir, { recursive: true });
}

describe("yonyou tplus connector registration", () => {
  beforeEach(() => {
    cleanStore();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("is a production ERP oauth2 catalog entry", () => {
    const definition = findDataConnectorDefinition("erp-yonyou-tplus");
    expect(definition).toMatchObject({
      label: "用友 T+",
      category: "erp",
      integrationTier: "production",
      credentialKind: "oauth2",
      accessMethod: "credential",
      defaultSourceKey: "yonyou-tplus",
    });
    const catalog = resolveDataConnectorCatalog({
      store: normalizeEnterpriseDataStore({}),
      tenantId,
    });
    const entry = catalog.find((item) => item.connectorId === "erp-yonyou-tplus");
    expect(entry?.ready).toBe(false);
    expect(entry?.registeredActionCount).toBe(0);
  });

  it("installs read actions and requires a credential before probing", async () => {
    const store = normalizeEnterpriseDataStore({});
    const installed = ensureConnectorPackage({
      store,
      tenantId,
      connectorId: "erp-yonyou-tplus",
      nowIso,
    });
    expect(installed).toEqual({ installed: true, actionCount: 7 });
    const entry = resolveDataConnectorCatalog({ store, tenantId }).find(
      (item) => item.connectorId === "erp-yonyou-tplus",
    );
    expect(entry?.ready).toBe(true);
    expect(entry?.runtimeHandlerCount).toBe(7);
    const probe = await probeDataSourceConnection({
      store,
      tenantId,
      connectorId: "erp-yonyou-tplus",
    });
    expect(probe.ok).toBe(false);
    expect(probe.mode).toBe("credential_required");
  });

  it("stores an oauth2 credential and probes GetVersionInfo", async () => {
    const store = normalizeEnterpriseDataStore({});
    ensureConnectorPackage({
      store,
      tenantId,
      connectorId: "erp-yonyou-tplus",
      nowIso,
    });
    const credential = upsertDataConnectorCredential({
      store,
      tenantId,
      connectorId: "erp-yonyou-tplus",
      label: "京扇子 T+",
      kind: "oauth2",
      instanceUrl: "https://openapi.chanjet.com",
      secretHint: "ken-1",
      nowIso,
    });
    await saveCredentialSecret(credential.credentialId, {
      appKey: "ak-test",
      appSecret: "as-test",
      oauthAccessToken: "open-token-1",
      orgId: "90001198862",
      appName: "tpluscloud",
    });
    const stored = await loadCredentialSecret(credential.credentialId);
    expect(stored).toMatchObject({
      appKey: "ak-test",
      oauthAccessToken: "open-token-1",
      orgId: "90001198862",
      appName: "tpluscloud",
    });

    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ result: "16.0" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const probe = await probeDataSourceConnection({
      store,
      tenantId,
      connectorId: "erp-yonyou-tplus",
      credentialId: credential.credentialId,
    });
    expect(probe.ok).toBe(true);
    expect(probe.mode).toBe("live_probe_ok");
    const [url, init] = recordedFetch(fetchMock);
    expect(url).toBe("https://openapi.chanjet.com/tplus/api/v2/accountAPI/GetVersionInfo");
    expect(init.headers).toMatchObject({
      appKey: "ak-test",
      appSecret: "as-test",
      openToken: "open-token-1",
    });
  });

  it("returns a graceful probe error when the stored credential has no token", async () => {
    const store = normalizeEnterpriseDataStore({});
    ensureConnectorPackage({
      store,
      tenantId,
      connectorId: "erp-yonyou-tplus",
      nowIso,
    });
    const credential = upsertDataConnectorCredential({
      store,
      tenantId,
      connectorId: "erp-yonyou-tplus",
      label: "京扇子 T+ 未授权",
      kind: "oauth2",
      nowIso,
    });
    await saveCredentialSecret(credential.credentialId, { orgId: "90001198862" });
    vi.stubGlobal("fetch", vi.fn());
    const probe = await probeDataSourceConnection({
      store,
      tenantId,
      connectorId: "erp-yonyou-tplus",
      credentialId: credential.credentialId,
    });
    expect(probe.ok).toBe(false);
    expect(probe.mode).toBe("live_probe_failed");
    expect(probe.message).toContain("openToken");
  });

  it("lets a tenant upsert a data source after the package is installed", () => {
    const store = normalizeEnterpriseDataStore({});
    expect(() =>
      upsertDataSource({
        store,
        tenantId,
        nowIso,
        source: {
          sourceKey: "yonyou-tplus",
          displayName: "用友 T+",
          category: "erp",
          status: "disconnected",
          connectorId: "erp-yonyou-tplus",
        },
      }),
    ).toThrow(EnterpriseDataStoreError);

    ensureConnectorPackage({
      store,
      tenantId,
      connectorId: "erp-yonyou-tplus",
      nowIso,
    });
    const source = upsertDataSource({
      store,
      tenantId,
      nowIso,
      source: {
        sourceKey: "yonyou-tplus",
        displayName: "京扇子 用友 T+",
        category: "erp",
        status: "disconnected",
        connectorId: "erp-yonyou-tplus",
      },
    });
    expect(source.connectorId).toBe("erp-yonyou-tplus");
    expect(source.category).toBe("erp");
    expect(source.sourceKey).toBe("yonyou-tplus");
    expect(source.tenantId).toBe(tenantId);
  });

  it("completes simulated oauth and probes without calling Chanjet", async () => {
    const store = normalizeEnterpriseDataStore({});
    ensureConnectorPackage({
      store,
      tenantId,
      connectorId: "erp-yonyou-tplus",
      nowIso,
    });
    const { saveEnterpriseDataStore } = await import("./store.js");
    await saveEnterpriseDataStore(store);

    const oauthStore = await loadDataConnectorOAuthSessionStore();
    const started = startDataConnectorOAuthSession({
      store: oauthStore,
      tenantId,
      connectorId: "erp-yonyou-tplus",
      label: "京扇子 T+",
      nowIso,
    });
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }
    expect(started.simulateAllowed).toBe(true);
    expect(started.authorizeUrl).toBeNull();
    await saveDataConnectorOAuthSessionStore(oauthStore);
    const completed = await simulateCompleteDataConnectorOAuthSession({
      tenantId,
      sessionId: started.session.sessionId,
      nowIso,
    });
    expect(completed.ok).toBe(true);
    if (!completed.ok) {
      return;
    }
    const { loadEnterpriseDataStore } = await import("./store.js");
    const dataStore = await loadEnterpriseDataStore();
    const credential = dataStore.dataConnectorCredentials[completed.credentialId];
    expect(credential?.kind).toBe("oauth2");
    expect(credential?.connectorId).toBe("erp-yonyou-tplus");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("fetch should not be called");
      }),
    );
    const probe = await probeDataSourceConnection({
      store: dataStore,
      tenantId,
      connectorId: "erp-yonyou-tplus",
      credentialId: completed.credentialId,
    });
    expect(probe.ok).toBe(true);
    expect(probe.mode).toBe("live_probe_ok");
  });

  it("builds a live authorize URL when the platform app and orgId are configured", async () => {
    vi.stubEnv("OPENBOT_ENTERPRISE_DATA_YONYOU_TPLUS_APP_KEY", "ak-test");
    vi.stubEnv("OPENBOT_ENTERPRISE_DATA_YONYOU_TPLUS_APP_SECRET", "as-test");
    const oauthStore = await loadDataConnectorOAuthSessionStore();
    const missingOrg = startDataConnectorOAuthSession({
      store: oauthStore,
      tenantId,
      connectorId: "erp-yonyou-tplus",
      label: "京扇子 T+",
      callbackOrigin: "https://gw.example.com",
      nowIso,
    });
    expect(missingOrg.ok).toBe(false);
    if (!missingOrg.ok) {
      expect(missingOrg.code).toBe("CONNECTOR_OAUTH_ORG_ID_REQUIRED");
    }
    const started = startDataConnectorOAuthSession({
      store: oauthStore,
      tenantId,
      connectorId: "erp-yonyou-tplus",
      label: "京扇子 T+",
      callbackOrigin: "https://gw.example.com",
      orgId: "90001198862",
      appName: "tpluscloud",
      nowIso,
    });
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }
    expect(started.session.mode).toBe("yonyou_tplus_authorization_code");
    expect(started.simulateAllowed).toBe(false);
    expect(started.callbackUrl).toBe(
      "https://gw.example.com/__openbot/enterprise-data/oauth/callback",
    );
    const url = new URL(started.authorizeUrl ?? "");
    expect(url.origin + url.pathname).toBe("https://market.chanjet.com/user/v2/authorize");
    expect(url.searchParams.get("orgId")).toBe("90001198862");
    expect(url.searchParams.get("appKey")).toBe("ak-test");
    expect(url.searchParams.get("appName")).toBe("tpluscloud");
  });

  it("refuses silent simulate when only APP_KEY is configured", () => {
    vi.stubEnv("OPENBOT_ENTERPRISE_DATA_YONYOU_TPLUS_APP_KEY", "D2rRuEgL");
    const started = startDataConnectorOAuthSession({
      store: { version: 1, sessions: {} },
      tenantId,
      connectorId: "erp-yonyou-tplus",
      label: "京扇子 T+",
      callbackOrigin: "https://www.openbot.love",
      orgId: "90001198862",
      nowIso,
    });
    expect(started.ok).toBe(false);
    if (!started.ok) {
      expect(started.code).toBe("CONNECTOR_OAUTH_CONFIG_INCOMPLETE");
      expect(started.error).toContain("禁止静默走模拟");
      expect(started.error).toContain("APP_SECRET");
    }
  });

  it("uses the configured Chanjet redirect URI for live authorize readiness", () => {
    vi.stubEnv("OPENBOT_ENTERPRISE_DATA_YONYOU_TPLUS_APP_KEY", "ak-test");
    vi.stubEnv("OPENBOT_ENTERPRISE_DATA_YONYOU_TPLUS_APP_SECRET", "as-test");
    vi.stubEnv(
      "OPENBOT_ENTERPRISE_DATA_YONYOU_TPLUS_REDIRECT_URI",
      "https://www.openbot.love/__openbot/enterprise-data/oauth/callback",
    );
    const started = startDataConnectorOAuthSession({
      store: { version: 1, sessions: {} },
      tenantId,
      connectorId: "erp-yonyou-tplus",
      label: "京扇子 T+",
      // Intentionally omit callbackOrigin — env redirect must still allow live mode.
      orgId: "90001198862",
      nowIso,
    });
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }
    expect(started.simulateAllowed).toBe(false);
    expect(started.session.mode).toBe("yonyou_tplus_authorization_code");
  });

  it("seeds PUBLIC business fields for partner and sale_delivery on ensure-package", () => {
    const store = normalizeEnterpriseDataStore({});
    ensureConnectorPackage({
      store,
      tenantId,
      connectorId: "erp-yonyou-tplus",
      nowIso,
    });
    const pathsByAction = new Map<string, Set<string>>();
    for (const item of Object.values(store.fieldClassifications ?? {})) {
      if (item.tenantId !== tenantId || item.classification !== "PUBLIC") {
        continue;
      }
      const bucket = pathsByAction.get(item.actionKey) ?? new Set<string>();
      bucket.add(item.fieldPath);
      pathsByAction.set(item.actionKey, bucket);
    }
    expect(pathsByAction.get("erp.partner.query_page")).toEqual(
      new Set([
        "records[*].Code",
        "records[*].Name",
        "records[*].ID",
        "records[*].PartnerType.Code",
        "records[*].PartnerType.Name",
      ]),
    );
    expect(pathsByAction.get("erp.sale_delivery.query_list")).toEqual(
      new Set(["records[*].Code", "records[*].Name", "records[*].ID", "records[*].VoucherDate"]),
    );
    expect(pathsByAction.get("erp.sale_order.query_list")).toEqual(
      new Set(["records[*].Code", "records[*].Name", "records[*].ID", "records[*].VoucherDate"]),
    );
    // warehouse/inventory seeds from #228 stay in place
    expect(pathsByAction.get("erp.warehouse.query")).toEqual(
      new Set(["records[*].Code", "records[*].Name", "records[*].ID"]),
    );
  });

  it("registers the sale delivery list action and fills it in on a later ensure", () => {
    const store = normalizeEnterpriseDataStore({});
    ensureConnectorPackage({ store, tenantId, connectorId: "erp-yonyou-tplus", nowIso });
    const keys = listConnectorActions({
      store,
      tenantId,
      connectorId: "erp-yonyou-tplus",
    }).map((action) => action.actionKey);
    expect(keys).toContain("erp.sale_delivery.query_list");
    const saleDelivery = Object.values(store.connectorActions).find(
      (action) => action.actionKey === "erp.sale_delivery.query_list",
    );
    if (saleDelivery) {
      delete store.connectorActions[saleDelivery.actionId];
    }
    const again = ensureConnectorPackage({
      store,
      tenantId,
      connectorId: "erp-yonyou-tplus",
      nowIso,
    });
    expect(again).toEqual({ installed: true, actionCount: 7 });
  });

  it("grants the projection materializer seat on install and again when actions already exist", () => {
    const store = normalizeEnterpriseDataStore({});
    const installed = ensureConnectorPackage({
      store,
      tenantId,
      connectorId: "erp-yonyou-tplus",
      nowIso,
    });
    expect(installed).toEqual({ installed: true, actionCount: 7 });
    expect(findScopePolicy(store, tenantId, "scope-team-default")?.scopeType).toBe("TEAM");
    expect(findScopePolicy(store, tenantId, "scope-self-default")?.scopeType).toBe("SELF");

    const actionKeys = [
      "erp.account.read_version",
      "erp.warehouse.query",
      "erp.inventory.query_page",
      "erp.partner.query_page",
      "erp.sale_order.query_list",
      "erp.sale_delivery.query_list",
      "erp.doc.query",
    ];
    const grants = listSeatActionGrants({
      store,
      tenantId,
      seatId: MATERIALIZER_SEAT_ID,
    });
    expect(grants.map((grant) => grant.actionKey).toSorted()).toEqual(actionKeys.toSorted());
    expect(grants.every((grant) => grant.connectorId === "erp-yonyou-tplus")).toBe(true);
    expect(grants.every((grant) => grant.version === "v1")).toBe(true);
    expect(grants.every((grant) => grant.scopePolicyId === "scope-team-default")).toBe(true);
    expect(grants.every((grant) => grant.approvalPolicyId == null)).toBe(true);
    const grantIds = grants.map((grant) => grant.grantId).toSorted();

    const repeated = ensureConnectorPackage({
      store,
      tenantId,
      connectorId: "erp-yonyou-tplus",
      nowIso: "2026-10-22T01:00:00.000Z",
    });
    expect(repeated).toEqual({ installed: false, actionCount: 7 });
    const repeatedGrants = listSeatActionGrants({
      store,
      tenantId,
      seatId: MATERIALIZER_SEAT_ID,
    });
    expect(repeatedGrants.map((grant) => grant.grantId).toSorted()).toEqual(grantIds);

    for (const grant of Object.values(store.seatActionGrants)) {
      if (grant.seatId === MATERIALIZER_SEAT_ID) {
        delete store.seatActionGrants[grant.grantId];
      }
    }
    const repaired = ensureConnectorPackage({
      store,
      tenantId,
      connectorId: "erp-yonyou-tplus",
      nowIso: "2026-10-22T02:00:00.000Z",
    });
    expect(repaired).toEqual({ installed: false, actionCount: 7 });
    expect(listSeatActionGrants({ store, tenantId, seatId: MATERIALIZER_SEAT_ID })).toHaveLength(
      actionKeys.length,
    );
  });

  it("does not rewrite an existing materializer grant or an existing default scope policy", () => {
    const store = normalizeEnterpriseDataStore({});
    upsertScopePolicy({
      store,
      tenantId,
      nowIso,
      policy: {
        scopePolicyId: "scope-team-default",
        displayName: "租户自定义团队范围",
        scopeType: "TEAM",
        filterClauses: [
          { field: "customer.owner_team", operator: "eq", valueRef: "current_user.team" },
        ],
        filterDescription: "保留管理员已写的范围说明",
      },
    });
    ensureConnectorPackage({ store, tenantId, connectorId: "erp-yonyou-tplus", nowIso });
    const inventory = findSeatActionGrant(store, tenantId, MATERIALIZER_SEAT_ID, {
      connectorId: "erp-yonyou-tplus",
      actionKey: "erp.inventory.query_page",
      version: "v1",
    });
    expect(inventory).toBeTruthy();
    if (!inventory) {
      return;
    }
    inventory.scopePolicyId = "scope-all-readonly";
    inventory.approvalPolicyId = "policy-none-default";

    ensureConnectorPackage({
      store,
      tenantId,
      connectorId: "erp-yonyou-tplus",
      nowIso: "2026-10-22T03:00:00.000Z",
    });
    const kept = findSeatActionGrant(store, tenantId, MATERIALIZER_SEAT_ID, {
      connectorId: "erp-yonyou-tplus",
      actionKey: "erp.inventory.query_page",
      version: "v1",
    });
    expect(kept?.grantId).toBe(inventory.grantId);
    expect(kept?.scopePolicyId).toBe("scope-all-readonly");
    expect(kept?.approvalPolicyId).toBe("policy-none-default");
    expect(findScopePolicy(store, tenantId, "scope-team-default")).toMatchObject({
      displayName: "租户自定义团队范围",
      filterDescription: "保留管理员已写的范围说明",
      updatedAt: nowIso,
    });
    expect(listSeatActionGrants({ store, tenantId, seatId: MATERIALIZER_SEAT_ID })).toHaveLength(7);
  });

  it("refreshes an expired openToken during probe and writes the new tokens", async () => {
    const store = normalizeEnterpriseDataStore({});
    ensureConnectorPackage({ store, tenantId, connectorId: "erp-yonyou-tplus", nowIso });
    const credential = upsertDataConnectorCredential({
      store,
      tenantId,
      connectorId: "erp-yonyou-tplus",
      label: "京扇子 T+",
      kind: "oauth2",
      instanceUrl: "https://openapi.chanjet.com",
      nowIso,
    });
    await saveCredentialSecret(credential.credentialId, {
      appKey: "ak-test",
      appSecret: "as-test",
      oauthAccessToken: "expired-open",
      oauthRefreshToken: "refresh-1",
      orgId: "90001198862",
    });
    let versionCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = String(input);
        if (url.includes("/auth/v2/refreshToken")) {
          return Response.json({
            code: "200",
            result: {
              access_token: "open-token-2",
              refresh_token: "refresh-2",
              expires_in: 518400,
              sid: "6",
            },
          });
        }
        versionCalls += 1;
        if (versionCalls === 1) {
          return Response.json({ code: "401", message: "openToken无效" });
        }
        return Response.json({ result: "16.0" });
      }),
    );
    const probe = await probeDataSourceConnection({
      store,
      tenantId,
      connectorId: "erp-yonyou-tplus",
      credentialId: credential.credentialId,
    });
    expect(probe.ok).toBe(true);
    expect(probe.mode).toBe("live_probe_ok");
    expect(probe.message).toContain("已将新的 openToken 写入凭证库");
    const stored = await loadCredentialSecret(credential.credentialId);
    expect(stored?.oauthAccessToken).toBe("open-token-2");
    expect(stored?.oauthRefreshToken).toBe("refresh-2");
    expect(stored?.appSecret).toBe("as-test");
  });

  it("renews from the permanent-code chain when an appTicket and enterprise code are stored", async () => {
    const store = normalizeEnterpriseDataStore({});
    ensureConnectorPackage({ store, tenantId, connectorId: "erp-yonyou-tplus", nowIso });
    const credential = upsertDataConnectorCredential({
      store,
      tenantId,
      connectorId: "erp-yonyou-tplus",
      label: "京扇子 T+",
      kind: "oauth2",
      instanceUrl: "https://openapi.chanjet.com",
      nowIso,
    });
    await saveCredentialSecret(credential.credentialId, {
      appKey: "ak-test",
      appSecret: "as-test",
      oauthRefreshToken: "refresh-should-not-run",
      oauthPermanentCode: "user-permanent",
      orgId: "90001198862",
    });
    await saveYonyouTplusAppTicket({
      appKey: "ak-test",
      appTicket: "ticket-1",
      receivedAt: nowIso,
    });
    await saveYonyouTplusOrgPermanentAuth({
      orgId: "90001198862",
      permanentAuthCode: "org-permanent",
      updatedAt: nowIso,
    });
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        urls.push(url);
        if (url.endsWith("/auth/appAuth/getAppAccessToken")) {
          expect(jsonBody(init?.body)).toEqual({ appTicket: "ticket-1" });
          return Response.json({
            code: "200",
            result: { appAccessToken: "app-access", expireTime: 7200 },
          });
        }
        if (url.endsWith("/auth/orgAuth/getOrgAccessToken")) {
          expect(jsonBody(init?.body)).toEqual({
            appAccessToken: "app-access",
            permanentAuthCode: "org-permanent",
          });
          return Response.json({
            code: "200",
            result: { orgAccessToken: "org-access", orgId: "90001198862", expireTime: 7200 },
          });
        }
        if (url.endsWith("/auth/token/getTokenByPermanentCode")) {
          expect(jsonBody(init?.body)).toEqual({
            orgAccessToken: "org-access",
            userAuthPermanentCode: "user-permanent",
          });
          return Response.json({
            code: "200",
            result: {
              access_token: "open-from-permanent",
              refresh_token: "refresh-from-permanent",
              user_auth_permanent_code: "user-permanent",
              expires_in: 518400,
            },
          });
        }
        return Response.json({ result: "16.0" });
      }),
    );
    const probe = await probeDataSourceConnection({
      store,
      tenantId,
      connectorId: "erp-yonyou-tplus",
      credentialId: credential.credentialId,
    });
    expect(probe.ok).toBe(true);
    expect(urls.some((url) => url.includes("/auth/v2/refreshToken"))).toBe(false);
    expect(urls.some((url) => url.includes("GetVersionInfo"))).toBe(true);
    const stored = await loadCredentialSecret(credential.credentialId);
    expect(stored?.oauthAccessToken).toBe("open-from-permanent");
    expect(stored?.oauthRefreshToken).toBe("refresh-from-permanent");
    expect(stored?.orgPermanentAuthCode).toBe("org-permanent");
    expect(await loadYonyouTplusAppTicket("ak-test")).toBe("ticket-1");
  });
});
