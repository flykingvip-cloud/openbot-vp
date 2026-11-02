/**
 * Registered enterprise assets must become an upstream provider the embedded
 * runner can call. `ent/<hash>/mimo-v2.6-flash` is not a global catalog model.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-embedded-transport-${process.pid}`);

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

const { createEnterpriseModelConnection, updateEnterpriseModelConnection } =
  await import("./connection-store.js");
const { registerEnterpriseModelAsset } = await import("./asset-store.js");
const { saveEnterpriseModelSecret, __resetEnterpriseModelVaultKeyCacheForTest } =
  await import("./credential-vault.js");
const { resolveEnterpriseEmbeddedTransport } = await import("./embedded-transport.js");

beforeEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  __resetEnterpriseModelVaultKeyCacheForTest();
});

describe("resolveEnterpriseEmbeddedTransport store", () => {
  it("resolves a healthy mimo-v2.6-flash asset to the openai-compatible transport", async () => {
    const conn = await createEnterpriseModelConnection({
      tenantId: "tenant-mimo",
      providerType: "openai-compatible",
      displayName: "MiMo",
      baseUrl: "https://mimo.example/v1",
    });
    await saveEnterpriseModelSecret(conn.credentialRef, { apiKey: "sk-mimo-live" });
    await updateEnterpriseModelConnection({
      tenantId: "tenant-mimo",
      connectionId: conn.connectionId,
      status: "verified",
      healthStatus: "healthy",
      skipEndpointInvalidation: true,
    });
    const asset = await registerEnterpriseModelAsset({
      tenantId: "tenant-mimo",
      connectionId: conn.connectionId,
      upstreamModelId: "mimo-v2.6-flash",
      enabled: true,
      healthStatus: "healthy",
    });
    expect(asset.runtimeModelId).toMatch(/^ent\/[a-f0-9]{10}\/mimo-v2\.6-flash$/);

    const slash = asset.runtimeModelId.indexOf("/");
    const transport = await resolveEnterpriseEmbeddedTransport({
      provider: asset.runtimeModelId.slice(0, slash),
      model: asset.runtimeModelId.slice(slash + 1),
      tenantId: "tenant-mimo",
    });

    expect(transport).toEqual({
      provider: "openai",
      model: "mimo-v2.6-flash",
      enterpriseRuntimeModelId: asset.runtimeModelId,
      providerAuthOverride: {
        apiKey: "sk-mimo-live",
        source: "enterprise-byok",
        baseUrl: "https://mimo.example/v1",
        protocol: "openai-completions",
      },
    });
  });
});
