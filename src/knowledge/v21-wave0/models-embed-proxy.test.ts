import { describe, expect, it, vi } from "vitest";
import {
  MODELS_EMBED_PROVIDER_TRACK,
  MODELS_EMBED_PROXY_ENABLED_DEFAULT,
  createControlledModelsEmbedProxy,
} from "./models-embed-proxy.js";

const request = {
  tenant_id: "syn_org",
  policy_generation: 1,
  run_id: "syn_run",
  user_id: "syn_user",
  provider: { track: MODELS_EMBED_PROVIDER_TRACK, id: "local", model: "test-dim-2" },
  inputs: ["alpha", "beta"],
} as const;

const vectors = [
  [1, 0],
  [0, 1],
];

describe("controlled models.embed proxy", () => {
  it("is default-off and never calls auth, billing, or an embed provider", async () => {
    expect(MODELS_EMBED_PROXY_ENABLED_DEFAULT).toBe(false);
    const embedBatch = vi.fn(async () => vectors);
    const authorize = vi.fn(async () => ({ ok: true as const }));
    const recordUsage = vi.fn(async () => {});
    const proxy = createControlledModelsEmbedProxy({
      provider: { id: "local", model: "test-dim-2", embedBatch },
      auth: { authorize },
      billing: { recordUsage },
    });
    expect(proxy.enabled).toBe(false);
    await expect(proxy.embed(request)).resolves.toEqual({
      ok: false,
      reason: "PROXY_DISABLED",
    });
    expect(embedBatch).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
    expect(recordUsage).not.toHaveBeenCalled();
  });

  it("fails closed when explicitly enabled but no provider is injected (no live embed path)", async () => {
    const authorize = vi.fn(async () => ({ ok: true as const }));
    const proxy = createControlledModelsEmbedProxy({
      enabled: true,
      auth: { authorize },
    });
    await expect(proxy.embed(request)).resolves.toEqual({
      ok: false,
      reason: "PROVIDER_NOT_INJECTED",
    });
    expect(authorize).not.toHaveBeenCalled();
  });

  it("fails closed when the authorized-session-aligned auth hook denies the call", async () => {
    const embedBatch = vi.fn(async () => vectors);
    const proxy = createControlledModelsEmbedProxy({
      enabled: true,
      provider: { id: "local", model: "test-dim-2", embedBatch },
      auth: { authorize: async () => ({ ok: false, reason: "CONTRACT_ENDED" }) },
    });
    await expect(proxy.embed(request)).resolves.toEqual({ ok: false, reason: "AUTH_DENIED" });
    expect(embedBatch).not.toHaveBeenCalled();
  });

  it("when enabled with injected provider and auth, returns vectors and records billing hooks", async () => {
    const embedBatch = vi.fn(async (texts: string[]) => {
      expect(texts).toEqual(["alpha", "beta"]);
      return vectors;
    });
    const recordUsage = vi.fn(async () => {});
    const proxy = createControlledModelsEmbedProxy({
      enabled: true,
      provider: { id: "local", model: "test-dim-2", embedBatch },
      auth: {
        authorize: async () => ({ ok: true, authorizationDecisionId: "dec-1", planId: "plan-1" }),
      },
      billing: { recordUsage },
    });
    const result = await proxy.embed(request);
    expect(result).toEqual({
      ok: true,
      tenant_id: "syn_org",
      provider: { track: MODELS_EMBED_PROVIDER_TRACK, id: "local", model: "test-dim-2" },
      vectors,
      dim: 2,
    });
    expect(recordUsage).toHaveBeenCalledWith({
      runId: "syn_run",
      provider: "local",
      model: "test-dim-2",
      textCount: 2,
      charCount: 9,
      authorizationDecisionId: "dec-1",
    });
    expect(JSON.stringify(result)).not.toMatch(/api_key|password|secret|token/i);
  });

  it("rejects credential-bearing payloads and invalid requests even when enabled", async () => {
    const embedBatch = vi.fn(async () => vectors);
    const proxy = createControlledModelsEmbedProxy({
      enabled: true,
      provider: { id: "local", model: "test-dim-2", embedBatch },
      auth: { authorize: async () => ({ ok: true }) },
    });
    await expect(
      proxy.embed({
        ...request,
        provider: { ...request.provider, api_key: "sk-test" } as typeof request.provider,
      }),
    ).resolves.toEqual({ ok: false, reason: "CREDENTIAL_FORBIDDEN" });
    await expect(proxy.embed({ ...request, policy_generation: 0 })).resolves.toEqual({
      ok: false,
      reason: "INVALID_REQUEST",
    });
    expect(embedBatch).not.toHaveBeenCalled();
  });
});
