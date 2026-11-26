import { expect, it, vi } from "vitest";
import { KnowledgeSdkClient, isPublishedResult } from "./client.js";
import type { LegacyKuUri } from "./openbot-adapter-dto.js";
import { toKb } from "./uri-mapping.js";
const actor = {
  issuer: "https://idp.test",
  subjectId: "reader",
  tenantId: "fixture",
  policyGeneration: 1,
  actorType: "human" as const,
  agentId: "bound",
  requestId: "req",
};
const config = {
  enabled: true,
  environment: "test" as const,
  allowedTenantIds: ["fixture"],
  baseUrl: "http://127.0.0.1:18878",
  timeoutMs: 500,
  secret: "TEST_ONLY_DO_NOT_USE_IN_PROD_0123456789abcdef",
};
it("A06 transport outage fails closed without a second request", async () => {
  const transport = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"));
  await expect(
    new KnowledgeSdkClient(config, transport).request("/v2/retrieval:search", "POST", actor, {}),
  ).rejects.toThrow("SDK_UNAVAILABLE");
  expect(transport).toHaveBeenCalledTimes(1);
});
it("A08 missing historical mapping explicitly fails", () => {
  expect(() => toKb("ku://kb/k/doc/d@opaque" as LegacyKuUri, [])).toThrow();
});
it.each(["draft", "in_review", "approved", "rejected", "superseded", "revoked"])(
  "A09 %s never renders as published",
  (lifecycle_state) => {
    expect(
      isPublishedResult({
        activated: true,
        lifecycle_state,
        created_version: 3,
        current_version: 3,
      }),
    ).toBe(false);
  },
);
it("A10 write without idempotency key never retries on 503", async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "BACKEND_UNAVAILABLE" } }), { status: 503 }),
    );
  await expect(
    new KnowledgeSdkClient(config, transport).request("/v2/assets", "POST", actor, {}),
  ).rejects.toThrow("BACKEND_UNAVAILABLE");
  expect(transport).toHaveBeenCalledTimes(1);
});

it("A03 email used as subjectId never reaches transport", async () => {
  const transport = vi.fn<typeof fetch>();
  await expect(
    new KnowledgeSdkClient(config, transport).request("/v2/assets/doc", "GET", {
      ...actor,
      subjectId: "reader@example.com",
    }),
  ).rejects.toThrow("INVALID_TRUSTED_CONTEXT");
  expect(transport).not.toHaveBeenCalled();
});
it("A03 missing issuer never reaches transport", async () => {
  const transport = vi.fn<typeof fetch>();
  await expect(
    new KnowledgeSdkClient(config, transport).request("/v2/assets/doc", "GET", {
      ...actor,
      issuer: "",
    }),
  ).rejects.toThrow("INVALID_TRUSTED_CONTEXT");
  expect(transport).not.toHaveBeenCalled();
});
