// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-enterprise-model-store-${Date.now()}`);

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

const { createEnterpriseModelConnection, updateEnterpriseModelConnection } =
  await import("../enterprise-model/connection-store.js");
const {
  listActiveTenantOwnedModelIds,
  registerEnterpriseModelAsset,
  setEnterpriseModelAssetEnabled,
} = await import("../enterprise-model/asset-store.js");
const { resolveEnterpriseModelCeiling } = await import("../enterprise-model/ceiling.js");
const { upsertEnterpriseModelEntitlement } =
  await import("../model-entitlement/enterprise-model-entitlement-store.js");
const { buildRuntimeModelId, isEnterpriseRuntimeModelId } =
  await import("../enterprise-model/ids.js");
const {
  saveEnterpriseModelSecret,
  loadEnterpriseModelSecret,
  buildSecretHint,
  __resetEnterpriseModelVaultKeyCacheForTest,
} = await import("../enterprise-model/credential-vault.js");
const { resolveTenantModelRuntimeConfig } = await import("../enterprise-model/runtime-resolve.js");

beforeEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  __resetEnterpriseModelVaultKeyCacheForTest();
});

describe("enterprise-model stores", () => {
  it("builds stable tenant-isolated runtimeModelId", () => {
    const a = buildRuntimeModelId({
      tenantId: "tenant-a",
      connectionId: "conn-1",
      upstreamModelId: "GPT-4o",
    });
    const b = buildRuntimeModelId({
      tenantId: "tenant-b",
      connectionId: "conn-1",
      upstreamModelId: "GPT-4o",
    });
    expect(isEnterpriseRuntimeModelId(a)).toBe(true);
    expect(a).not.toBe(b);
    expect(a).not.toContain("tenant-a");
  });

  it("merges subscription + tenant-owned into ceiling", async () => {
    await upsertEnterpriseModelEntitlement({
      tenantId: "ent-1",
      allowedModelIds: ["openai/gpt-4o", "anthropic/claude"],
    });
    const conn = await createEnterpriseModelConnection({
      tenantId: "ent-1",
      providerType: "openai-compatible",
      displayName: "BYOK",
      baseUrl: "https://x.example/v1",
    });
    const asset = await registerEnterpriseModelAsset({
      tenantId: "ent-1",
      connectionId: conn.connectionId,
      upstreamModelId: "local-llama",
      enabled: true,
      healthStatus: "healthy",
    });
    const ceiling = await resolveEnterpriseModelCeiling({ tenantId: "ent-1" });
    expect(ceiling.subscriptionModelIds).toEqual(["openai/gpt-4o", "anthropic/claude"]);
    expect(ceiling.tenantOwnedModelIds).toContain(asset.runtimeModelId);
    expect(ceiling.ceilingModelIds).toEqual(
      expect.arrayContaining(["openai/gpt-4o", "anthropic/claude", asset.runtimeModelId]),
    );

    // unknown health must not enter ceiling / active set
    const unknownAsset = await registerEnterpriseModelAsset({
      tenantId: "ent-1",
      connectionId: conn.connectionId,
      upstreamModelId: "unverified-model",
      enabled: true,
      healthStatus: "unknown",
    });
    const activeBefore = await listActiveTenantOwnedModelIds("ent-1");
    expect(activeBefore).toContain(asset.runtimeModelId);
    expect(activeBefore).not.toContain(unknownAsset.runtimeModelId);

    await updateEnterpriseModelConnection({
      tenantId: "ent-1",
      connectionId: conn.connectionId,
      status: "verified",
      healthStatus: "healthy",
      skipEndpointInvalidation: true,
    });
    expect(await listActiveTenantOwnedModelIds("ent-1")).toContain(unknownAsset.runtimeModelId);

    await setEnterpriseModelAssetEnabled("ent-1", asset.assetId, false);
    const active = await listActiveTenantOwnedModelIds("ent-1");
    expect(active).not.toContain(asset.runtimeModelId);
  });

  it("vault round-trips secrets and resolves runtime config", async () => {
    const conn = await createEnterpriseModelConnection({
      tenantId: "ent-1",
      providerType: "openai-compatible",
      displayName: "BYOK",
      baseUrl: "https://x.example/v1",
    });
    await saveEnterpriseModelSecret(conn.credentialRef, { apiKey: "sk-live-zzzz" });
    expect(buildSecretHint("sk-live-zzzz")).toBe("…zzzz");
    const loaded = await loadEnterpriseModelSecret(conn.credentialRef);
    expect(loaded?.apiKey).toBe("sk-live-zzzz");

    const asset = await registerEnterpriseModelAsset({
      tenantId: "ent-1",
      connectionId: conn.connectionId,
      upstreamModelId: "m1",
      enabled: true,
      healthStatus: "healthy",
    });
    // Mark connection verified + healthy for runtime resolve
    const { updateEnterpriseModelConnection } =
      await import("../enterprise-model/connection-store.js");
    await updateEnterpriseModelConnection({
      tenantId: "ent-1",
      connectionId: conn.connectionId,
      status: "active",
      healthStatus: "healthy",
      skipEndpointInvalidation: true,
    });

    const runtime = await resolveTenantModelRuntimeConfig({
      tenantId: "ent-1",
      runtimeModelId: asset.runtimeModelId,
    });
    expect(runtime?.upstreamModelId).toBe("m1");
    expect(runtime?.apiKey).toBe("sk-live-zzzz");
    expect(runtime?.billingOwner).toBe("enterprise");
    expect(runtime?.source).toBe("enterprise");
  });

  it("serializes concurrent vault saves without losing credentials", async () => {
    const writes = Array.from({ length: 20 }, (_, i) =>
      saveEnterpriseModelSecret(`ref-${i}`, { apiKey: `sk-concurrent-${i}` }),
    );
    await Promise.all(writes);
    for (let i = 0; i < 20; i += 1) {
      const loaded = await loadEnterpriseModelSecret(`ref-${i}`);
      expect(loaded?.apiKey).toBe(`sk-concurrent-${i}`);
    }
  });

  it("resolves an unknown asset once its connection is verified and healthy", async () => {
    const conn = await createEnterpriseModelConnection({
      tenantId: "ent-1",
      providerType: "openai-compatible",
      displayName: "Mimo",
      baseUrl: "https://mimo.example/v1",
    });
    await saveEnterpriseModelSecret(conn.credentialRef, { apiKey: "sk-mimo-live" });
    const asset = await registerEnterpriseModelAsset({
      tenantId: "ent-1",
      connectionId: conn.connectionId,
      upstreamModelId: "mimo-v2.6-flash",
      enabled: true,
      healthStatus: "unknown",
    });
    await expect(
      resolveTenantModelRuntimeConfig({
        tenantId: "ent-1",
        runtimeModelId: asset.runtimeModelId,
      }),
    ).rejects.toThrow(/not verified|not healthy/i);

    await updateEnterpriseModelConnection({
      tenantId: "ent-1",
      connectionId: conn.connectionId,
      status: "verified",
      healthStatus: "healthy",
      skipEndpointInvalidation: true,
    });
    const runtime = await resolveTenantModelRuntimeConfig({
      tenantId: "ent-1",
      runtimeModelId: asset.runtimeModelId,
    });
    expect(runtime?.upstreamModelId).toBe("mimo-v2.6-flash");
    expect(runtime?.apiKey).toBe("sk-mimo-live");
  });

  it("invalidates connection verification and degrades assets on endpoint change", async () => {
    const { updateEnterpriseModelConnection } =
      await import("../enterprise-model/connection-store.js");
    const { degradeEnterpriseModelAssetsForConnection } =
      await import("../enterprise-model/asset-store.js");
    const conn = await createEnterpriseModelConnection({
      tenantId: "ent-1",
      providerType: "openai-compatible",
      displayName: "BYOK",
      baseUrl: "https://old.example/v1",
    });
    await updateEnterpriseModelConnection({
      tenantId: "ent-1",
      connectionId: conn.connectionId,
      status: "active",
      healthStatus: "healthy",
      skipEndpointInvalidation: true,
    });
    const asset = await registerEnterpriseModelAsset({
      tenantId: "ent-1",
      connectionId: conn.connectionId,
      upstreamModelId: "m1",
      enabled: true,
      healthStatus: "healthy",
    });
    expect(await listActiveTenantOwnedModelIds("ent-1")).toContain(asset.runtimeModelId);

    const updated = await updateEnterpriseModelConnection({
      tenantId: "ent-1",
      connectionId: conn.connectionId,
      baseUrl: "https://new.example/v1",
    });
    expect(updated.healthStatus).toBe("unchecked");
    expect(["credential_saved", "draft"]).toContain(updated.status);
    await degradeEnterpriseModelAssetsForConnection("ent-1", conn.connectionId);
    expect(await listActiveTenantOwnedModelIds("ent-1")).not.toContain(asset.runtimeModelId);

    await expect(
      resolveTenantModelRuntimeConfig({
        tenantId: "ent-1",
        runtimeModelId: asset.runtimeModelId,
      }),
    ).rejects.toThrow(/not verified|disabled|unavailable/i);
  });
});
