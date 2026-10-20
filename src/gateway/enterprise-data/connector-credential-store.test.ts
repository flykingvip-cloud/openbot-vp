// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import {
  listDataConnectorCredentials,
  revokeDataConnectorCredential,
  upsertDataConnectorCredential,
} from "./connector-credential-store.js";
import {
  buildSecretHint,
  saveCredentialSecret,
  loadCredentialSecret,
} from "./connector-credential-vault.js";
import { normalizeEnterpriseDataStore } from "./store.js";

const tenantId = "tenant-acme";
const nowIso = "2026-06-14T12:00:00.000Z";

describe("connector-credential-store", () => {
  beforeEach(() => {
    // fresh store per test via createEmpty
  });

  it("upserts and lists active credentials by connector", () => {
    const store = normalizeEnterpriseDataStore({});
    const record = upsertDataConnectorCredential({
      store,
      tenantId,
      connectorId: "crm-salesforce",
      label: "SF Prod",
      kind: "api_key",
      instanceUrl: "https://example.salesforce.com",
      secretHint: buildSecretHint("token-abcd"),
      nowIso,
    });
    expect(record.credentialId).toBeTruthy();
    const listed = listDataConnectorCredentials({
      store,
      tenantId,
      connectorId: "crm-salesforce",
    });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.label).toBe("SF Prod");
  });

  it("revokes credential and excludes it from list", () => {
    const store = normalizeEnterpriseDataStore({});
    const record = upsertDataConnectorCredential({
      store,
      tenantId,
      connectorId: "crm-salesforce",
      label: "SF Sandbox",
      kind: "api_key",
      nowIso,
    });
    revokeDataConnectorCredential({
      store,
      tenantId,
      credentialId: record.credentialId,
      nowIso,
    });
    expect(
      listDataConnectorCredentials({ store, tenantId, connectorId: "crm-salesforce" }),
    ).toHaveLength(0);
  });
});

describe("connector-credential-vault", () => {
  it("persists and loads secrets without returning via store metadata", async () => {
    const credentialId = "cred-test-1";
    const vaultPath = `/tmp/openbot-cred-vault-${Date.now()}.json`;
    await saveCredentialSecret(
      credentialId,
      {
        instanceUrl: "https://example.salesforce.com",
        apiKey: "secret-token",
      },
      vaultPath,
    );
    const loaded = await loadCredentialSecret(credentialId, vaultPath);
    expect(loaded?.apiKey).toBe("secret-token");
    expect(loaded?.instanceUrl).toBe("https://example.salesforce.com");
  });
});

describe("connector-credential-vault encryption", () => {
  it("stores secrets encrypted at rest (no plaintext token in the file)", async () => {
    const { readFile, rm } = await import("node:fs/promises");
    const credentialId = "cred-enc-1";
    const vaultPath = `/tmp/openbot-cred-vault-enc-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
    const secretToken = "super-secret-token-9999";
    try {
      await saveCredentialSecret(
        credentialId,
        { instanceUrl: "https://api.example.com", apiKey: secretToken },
        vaultPath,
      );
      const raw = await readFile(vaultPath, "utf8");
      // The raw vault file must NOT contain the plaintext token, and must be an AES-GCM envelope.
      expect(raw).not.toContain(secretToken);
      expect(raw).toContain("aes-256-gcm");
      // Round-trips back to plaintext via the vault loader.
      const loaded = await loadCredentialSecret(credentialId, vaultPath);
      expect(loaded?.apiKey).toBe(secretToken);
      expect(loaded?.instanceUrl).toBe("https://api.example.com");
    } finally {
      await rm(vaultPath, { force: true });
      await rm(`${vaultPath}.key`, { force: true });
    }
  });

  it("reads legacy plaintext entries transparently (migration safety)", async () => {
    const { writeFile, rm } = await import("node:fs/promises");
    const vaultPath = `/tmp/openbot-cred-vault-legacy-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
    try {
      // Simulate a vault written before encryption: a bare plaintext secret object.
      await writeFile(
        vaultPath,
        JSON.stringify({
          credentials: {
            "legacy-1": { instanceUrl: "https://legacy.example.com", apiKey: "legacy-token" },
          },
        }),
        "utf8",
      );
      const loaded = await loadCredentialSecret("legacy-1", vaultPath);
      expect(loaded?.apiKey).toBe("legacy-token");
      expect(loaded?.instanceUrl).toBe("https://legacy.example.com");
    } finally {
      await rm(vaultPath, { force: true });
      await rm(`${vaultPath}.key`, { force: true });
    }
  });

  it("persists the extended http-rest auth fields", async () => {
    const { rm } = await import("node:fs/promises");
    const vaultPath = `/tmp/openbot-cred-vault-httprest-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
    try {
      await saveCredentialSecret(
        "cred-http-1",
        {
          instanceUrl: "https://api.example.com",
          apiKey: "key-123",
          authScheme: "header",
          authHeaderName: "X-API-Key",
          probePath: "/health",
        },
        vaultPath,
      );
      const loaded = await loadCredentialSecret("cred-http-1", vaultPath);
      expect(loaded?.authScheme).toBe("header");
      expect(loaded?.authHeaderName).toBe("X-API-Key");
      expect(loaded?.probePath).toBe("/health");
    } finally {
      await rm(vaultPath, { force: true });
      await rm(`${vaultPath}.key`, { force: true });
    }
  });
});
