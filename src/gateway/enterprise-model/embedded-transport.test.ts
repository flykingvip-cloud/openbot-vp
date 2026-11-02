import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveEnterpriseRuntimeInvocation = vi.hoisted(() => vi.fn());

vi.mock("./runtime-invocation.js", () => ({
  resolveEnterpriseRuntimeInvocation,
}));

import { resolveEnterpriseEmbeddedTransport } from "./embedded-transport.js";

const RUNTIME_MODEL = "cc41dd5419/mimo-v2.6-flash";
const RUNTIME_ID = `ent/${RUNTIME_MODEL}`;

describe("resolveEnterpriseEmbeddedTransport", () => {
  beforeEach(() => {
    resolveEnterpriseRuntimeInvocation.mockReset();
  });

  it("leaves catalog provider/model pairs untouched", async () => {
    const transport = await resolveEnterpriseEmbeddedTransport({
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      tenantId: "tenant-a",
    });
    expect(transport).toEqual({ provider: "anthropic", model: "claude-sonnet-4-5" });
    expect(resolveEnterpriseRuntimeInvocation).not.toHaveBeenCalled();
  });

  it("maps ent/cc41dd5419/mimo-v2.6-flash onto the upstream BYOK transport", async () => {
    resolveEnterpriseRuntimeInvocation.mockResolvedValue({
      runtimeModelId: RUNTIME_ID,
      provider: "openai",
      model: "mimo-v2.6-flash",
      apiKey: "sk-tenant-mimo",
      baseUrl: "https://mimo.example/v1",
      protocol: "openai-completions",
      billingOwner: "enterprise",
      source: "enterprise",
      tenantId: "tenant-a",
    });

    const transport = await resolveEnterpriseEmbeddedTransport({
      provider: "ent",
      model: RUNTIME_MODEL,
      tenantId: "tenant-a",
    });

    expect(resolveEnterpriseRuntimeInvocation).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      provider: "ent",
      model: RUNTIME_MODEL,
    });
    expect(transport).toEqual({
      provider: "openai",
      model: "mimo-v2.6-flash",
      enterpriseRuntimeModelId: RUNTIME_ID,
      providerAuthOverride: {
        apiKey: "sk-tenant-mimo",
        source: "enterprise-byok",
        baseUrl: "https://mimo.example/v1",
        protocol: "openai-completions",
      },
    });
  });

  it("uses the seat resolver only when the turn has no tenant yet", async () => {
    const resolveTenantId = vi.fn(async () => "tenant-from-seat");
    resolveEnterpriseRuntimeInvocation.mockResolvedValue({
      runtimeModelId: RUNTIME_ID,
      provider: "openai",
      model: "mimo-v2.6-flash",
      apiKey: "sk-tenant-mimo",
      protocol: "openai-completions",
      billingOwner: "enterprise",
      source: "enterprise",
      tenantId: "tenant-from-seat",
    });

    await resolveEnterpriseEmbeddedTransport({
      provider: "ent",
      model: RUNTIME_MODEL,
      tenantId: "  ",
      resolveTenantId,
    });

    expect(resolveTenantId).toHaveBeenCalledTimes(1);
    expect(resolveEnterpriseRuntimeInvocation).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-from-seat" }),
    );
  });

  it("fails closed when an ent model has no managed tenant", async () => {
    await expect(
      resolveEnterpriseEmbeddedTransport({
        provider: "ent",
        model: RUNTIME_MODEL,
        resolveTenantId: async () => "  ",
      }),
    ).rejects.toThrow(/managed tenantId could not be resolved/);
    expect(resolveEnterpriseRuntimeInvocation).not.toHaveBeenCalled();
  });
});
