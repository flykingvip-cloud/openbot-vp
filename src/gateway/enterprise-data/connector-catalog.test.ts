import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { findDataConnectorDefinition, resolveDataConnectorCatalog } from "./connector-catalog.js";
import { ensureConnectorDemoPackage } from "./connector-demo-packages.js";
import {
  loadDataConnectorOAuthSessionStore,
  saveDataConnectorOAuthSessionStore,
} from "./connector-oauth-session-persistence.js";
import {
  simulateCompleteDataConnectorOAuthSession,
  startDataConnectorOAuthSession,
} from "./connector-oauth.js";
import { ensureConnectorPackage } from "./connector-packages.js";
import { probeDataSourceConnection } from "./source-connection-probe.js";
import {
  loadEnterpriseDataStore,
  normalizeEnterpriseDataStore,
  saveEnterpriseDataStore,
} from "./store.js";

const testPaths = vi.hoisted(() => ({
  tmpDir: `/tmp/openbot-connector-catalog-test-${Date.now()}`,
}));

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return {
    ...actual,
    CONFIG_DIR: testPaths.tmpDir,
  };
});

const tenantId = "tenant-acme";
const nowIso = "2026-06-05T12:00:00.000Z";

function cleanStore() {
  fs.rmSync(testPaths.tmpDir, { recursive: true, force: true });
  fs.mkdirSync(testPaths.tmpDir, { recursive: true });
}

describe("connector-catalog", () => {
  it("lists catalog entries with zero actions on empty store", () => {
    const store = normalizeEnterpriseDataStore({});
    const entries = resolveDataConnectorCatalog({ store, tenantId });
    expect(entries.length).toBeGreaterThanOrEqual(2);
    const crm = entries.find((entry) => entry.connectorId === "crm-salesforce");
    expect(crm?.ready).toBe(false);
    expect(crm?.registeredActionCount).toBe(0);
  });

  it("installs crm demo package and passes smoke probe", async () => {
    const store = normalizeEnterpriseDataStore({});
    const installed = ensureConnectorDemoPackage({
      store,
      tenantId,
      connectorId: "crm-salesforce",
      nowIso,
    });
    expect(installed.installed).toBe(true);
    expect(installed.actionCount).toBe(3);

    const catalog = resolveDataConnectorCatalog({ store, tenantId });
    const crm = catalog.find((entry) => entry.connectorId === "crm-salesforce");
    expect(crm?.ready).toBe(true);

    const probe = await probeDataSourceConnection({
      store,
      tenantId,
      connectorId: "crm-salesforce",
    });
    expect(probe.ok).toBe(true);
    expect(probe.mode).toBe("mock_smoke_ok");
  });

  it("refuses mock_smoke_ok for production connectors without a live probe path", async () => {
    const store = normalizeEnterpriseDataStore({});
    // Install notion package so actions/handlers exist, but omit credentials so live probe
    // cannot run — clear failure (credential_required), never mock_smoke_ok success.
    ensureConnectorPackage({
      store,
      tenantId,
      connectorId: "notion",
      nowIso,
    });
    const probe = await probeDataSourceConnection({
      store,
      tenantId,
      connectorId: "notion",
    });
    expect(probe.ok).toBe(false);
    expect(probe.mode).toBe("credential_required");
    expect(probe.mode).not.toBe("mock_smoke_ok");
  });

  it("rejects unknown connector probe", async () => {
    const store = normalizeEnterpriseDataStore({});
    const probe = await probeDataSourceConnection({
      store,
      tenantId,
      connectorId: "unknown-crm",
    });
    expect(probe.ok).toBe(false);
    expect(probe.mode).toBe("unknown_connector");
  });

  it("reports actions_missing for production tier without package", async () => {
    const definition = findDataConnectorDefinition("notion");
    expect(definition?.integrationTier).toBe("production");
    const store = normalizeEnterpriseDataStore({});
    const probe = await probeDataSourceConnection({ store, tenantId, connectorId: "notion" });
    expect(probe.ok).toBe(false);
    expect(probe.mode).toBe("actions_missing");
  });

  it("installs notion package and passes simulated oauth probe", async () => {
    cleanStore();
    const store = normalizeEnterpriseDataStore({});
    ensureConnectorPackage({
      store,
      tenantId,
      connectorId: "notion",
      nowIso,
    });
    await saveEnterpriseDataStore(store);

    const catalog = resolveDataConnectorCatalog({ store, tenantId });
    const notion = catalog.find((entry) => entry.connectorId === "notion");
    expect(notion?.ready).toBe(true);

    const oauthStore = await loadDataConnectorOAuthSessionStore();
    const started = startDataConnectorOAuthSession({
      store: oauthStore,
      tenantId,
      connectorId: "notion",
      label: "Notion Test",
      nowIso,
    });
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }
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

    const dataStore = await loadEnterpriseDataStore();
    const probe = await probeDataSourceConnection({
      store: dataStore,
      tenantId,
      connectorId: "notion",
      credentialId: completed.credentialId,
    });
    expect(probe.ok).toBe(true);
    expect(probe.mode).toBe("live_probe_ok");
  });

  it("requires a credential before probing http-rest (production tier)", async () => {
    const store = normalizeEnterpriseDataStore({});
    ensureConnectorPackage({ store, tenantId, connectorId: "http-rest", nowIso });
    const probe = await probeDataSourceConnection({ store, tenantId, connectorId: "http-rest" });
    expect(probe.ok).toBe(false);
    expect(probe.mode).toBe("credential_required");
  });

  it("installs http-rest package and passes live probe with inline credential", async () => {
    const store = normalizeEnterpriseDataStore({});
    ensureConnectorPackage({ store, tenantId, connectorId: "http-rest", nowIso });
    const catalog = resolveDataConnectorCatalog({ store, tenantId });
    const rest = catalog.find((entry) => entry.connectorId === "http-rest");
    expect(rest?.ready).toBe(true);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );
    let probe;
    try {
      probe = await probeDataSourceConnection({
        store,
        tenantId,
        connectorId: "http-rest",
        inlineCredential: { instanceUrl: "https://api.example.com", apiKey: "token-1234" },
      });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(probe.ok).toBe(true);
    expect(probe.mode).toBe("live_probe_ok");
  });

  it("installs salesforce demo package and passes simulated oauth probe", async () => {
    cleanStore();
    const store = normalizeEnterpriseDataStore({});
    ensureConnectorPackage({
      store,
      tenantId,
      connectorId: "crm-salesforce",
      nowIso,
    });
    await saveEnterpriseDataStore(store);

    const catalog = resolveDataConnectorCatalog({ store, tenantId });
    const salesforce = catalog.find((entry) => entry.connectorId === "crm-salesforce");
    expect(salesforce?.ready).toBe(true);
    expect(salesforce?.credentialKind).toBe("oauth2");

    const oauthStore = await loadDataConnectorOAuthSessionStore();
    const started = startDataConnectorOAuthSession({
      store: oauthStore,
      tenantId,
      connectorId: "crm-salesforce",
      label: "Salesforce Test",
      nowIso,
    });
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }
    expect(started.simulateAllowed).toBe(true);
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

    const dataStore = await loadEnterpriseDataStore();
    const probe = await probeDataSourceConnection({
      store: dataStore,
      tenantId,
      connectorId: "crm-salesforce",
      credentialId: completed.credentialId,
    });
    expect(probe.ok).toBe(true);
    expect(probe.mode).toBe("live_probe_ok");
  });

  it("exposes db-postgres as a production api_key connector", () => {
    const definition = findDataConnectorDefinition("db-postgres");
    expect(definition?.integrationTier).toBe("production");
    expect(definition?.credentialKind).toBe("api_key");
    expect(definition?.category).toBe("external");
  });

  it("installs db-postgres package and requires a credential before probing", async () => {
    const store = normalizeEnterpriseDataStore({});
    const installed = ensureConnectorPackage({
      store,
      tenantId,
      connectorId: "db-postgres",
      nowIso,
    });
    expect(installed.installed).toBe(true);
    const catalog = resolveDataConnectorCatalog({ store, tenantId });
    const pg = catalog.find((entry) => entry.connectorId === "db-postgres");
    expect(pg?.ready).toBe(true);

    const probe = await probeDataSourceConnection({ store, tenantId, connectorId: "db-postgres" });
    expect(probe.ok).toBe(false);
    expect(probe.mode).toBe("credential_required");
  });

  it("routes db-postgres to the live adapter (real driver, refused connection)", async () => {
    const store = normalizeEnterpriseDataStore({});
    ensureConnectorPackage({ store, tenantId, connectorId: "db-postgres", nowIso });
    const probe = await probeDataSourceConnection({
      store,
      tenantId,
      connectorId: "db-postgres",
      inlineCredential: {
        instanceUrl: "postgres://127.0.0.1:59999/app",
        apiKey: "secret-pass",
        basicUsername: "readonly_user",
      },
    });
    // Reaches the postgres adapter and exercises the real `pg` driver; an
    // unreachable local port fails fast rather than short-circuiting on creds.
    expect(probe.ok).toBe(false);
    expect(probe.mode).toBe("live_probe_failed");
  });
});
