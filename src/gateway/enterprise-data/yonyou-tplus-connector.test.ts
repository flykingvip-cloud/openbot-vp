import fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EnterpriseDataStoreError } from "./connector-action-store.js";
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
import { probeDataSourceConnection } from "./source-connection-probe.js";
import { normalizeEnterpriseDataStore } from "./store.js";

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
    expect(installed).toEqual({ installed: true, actionCount: 6 });
    const entry = resolveDataConnectorCatalog({ store, tenantId }).find(
      (item) => item.connectorId === "erp-yonyou-tplus",
    );
    expect(entry?.ready).toBe(true);
    expect(entry?.runtimeHandlerCount).toBe(6);
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
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
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
    const url = new URL(started.authorizeUrl ?? "");
    expect(url.origin + url.pathname).toBe("https://market.chanjet.com/user/v2/authorize");
    expect(url.searchParams.get("orgId")).toBe("90001198862");
    expect(url.searchParams.get("appKey")).toBe("ak-test");
    expect(url.searchParams.get("appName")).toBe("tpluscloud");
  });
});
