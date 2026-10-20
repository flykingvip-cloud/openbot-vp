// @vitest-environment node
import fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
  tmpDir: `/tmp/openbot-connector-oauth-test-${Date.now()}`,
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

describe("connector-oauth", () => {
  beforeEach(() => {
    cleanStore();
  });

  it("starts simulated notion oauth session when client id is missing", async () => {
    const oauthStore = await loadDataConnectorOAuthSessionStore();
    const started = startDataConnectorOAuthSession({
      store: oauthStore,
      tenantId,
      connectorId: "notion",
      label: "Notion Workspace",
      callbackOrigin: "http://localhost:18789",
      nowIso,
    });
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }
    expect(started.session.mode).toBe("simulated");
    expect(started.simulateAllowed).toBe(true);
    expect(started.authorizeUrl).toBeNull();
    await saveDataConnectorOAuthSessionStore(oauthStore);
  });

  it("simulates oauth completion and stores oauth2 credential", async () => {
    const oauthStore = await loadDataConnectorOAuthSessionStore();
    const started = startDataConnectorOAuthSession({
      store: oauthStore,
      tenantId,
      connectorId: "notion",
      label: "Notion Workspace",
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
    expect(completed.session.status).toBe("completed");
    expect(completed.credentialId).toBeTruthy();

    const dataStore = await loadEnterpriseDataStore();
    const credential = dataStore.dataConnectorCredentials[completed.credentialId];
    expect(credential?.kind).toBe("oauth2");
    expect(credential?.connectorId).toBe("notion");
  });

  it("probes notion with simulated oauth credential after package install", async () => {
    const store = normalizeEnterpriseDataStore({});
    ensureConnectorPackage({
      store,
      tenantId,
      connectorId: "notion",
      nowIso,
    });
    await saveEnterpriseDataStore(store);

    const oauthStore = await loadDataConnectorOAuthSessionStore();
    const started = startDataConnectorOAuthSession({
      store: oauthStore,
      tenantId,
      connectorId: "notion",
      label: "Notion Dev",
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
});
