import { describe, expect, it, vi } from "vitest";
import { KnowledgeSdkClient, assertActor, isPublishedResult } from "./client.js";
const actor = {
  issuer: "https://idp.test",
  subjectId: "user-1",
  tenantId: "fixture-tenant",
  policyGeneration: 1,
  actorType: "human" as const,
  agentId: "agent-1",
  requestId: "request-1",
};
const config = {
  enabled: true,
  environment: "test" as const,
  allowedTenantIds: ["fixture-tenant"],
  baseUrl: "http://127.0.0.1:9999",
  timeoutMs: 1000,
  secret: "TEST_ONLY_DO_NOT_USE_IN_PROD_0123456789abcdef",
};
describe("knowledge SDK isolated adapter", () => {
  it.each([401, 403, 409, 500, 503])("fails closed on %s with one attempt", async (status) => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status }));
    await expect(
      new KnowledgeSdkClient(config, transport).request("/v2/assets", "POST", actor, {}),
    ).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("defaults to no calls when disabled", async () => {
    const transport = vi.fn<typeof fetch>();
    await expect(
      new KnowledgeSdkClient({ ...config, enabled: false }, transport).request(
        "/v2/search",
        "POST",
        actor,
        {},
      ),
    ).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])("rejects generation %s", (policyGeneration) =>
    expect(() => assertActor({ ...actor, policyGeneration })).toThrow(),
  );
  it("requires explicit whitelisted tenant", async () => {
    const transport = vi.fn<typeof fetch>();
    await expect(
      new KnowledgeSdkClient(config, transport).request(
        "/v2/search",
        "POST",
        { ...actor, tenantId: "other" },
        {},
      ),
    ).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
  it("does not render approved or mismatched versions as published", () => {
    expect(
      isPublishedResult({
        activated: true,
        lifecycle_state: "approved",
        created_version: 2,
        current_version: 2,
      }),
    ).toBe(false);
    expect(
      isPublishedResult({
        activated: true,
        lifecycle_state: "published",
        created_version: 2,
        current_version: 1,
      }),
    ).toBe(false);
  });
  it("forwards idempotency key once", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}"));
    await new KnowledgeSdkClient(config, transport).request(
      "/v2/assets",
      "POST",
      actor,
      {},
      "key-1",
    );
    expect(transport.mock.calls[0][1]?.headers).toMatchObject({ "Idempotency-Key": "key-1" });
  });
});
