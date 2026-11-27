import fs from "node:fs";
import { expect, it } from "vitest";
import { KnowledgeSdkClient, KnowledgeSdkError } from "./client.js";

/**
 * A03 remaining trusted-mapping variants against pin 9940818b and HEAD e8768746.
 *
 * Frozen min-slice (24_JOINT_DELTA / M1 acceptance): missing or ambiguous identity
 * or tenant is denied. Domain rule (02_DOMAIN_MODEL_ALIGNMENT 2.1): stable key is
 * (issuer, subject_id); email is not an ACL/auth key; no cross-IdP email linking.
 *
 * Pin 9940818b v2_auth.py authenticates a signed IdentityContext, requires
 * actor.issuer to equal the configured v2 issuer, and looks up
 * store.get_principal(tenant, claim["subject_id"]) only. There is no issuer+raw_sub
 * or email mapping table in this pin, and KnowledgeSdkClient signs a pre-resolved
 * subjectId after assertActor fail-closed checks. Collision / multi-subject
 * mapping therefore cannot be constructed honestly on this pin/HEAD.
 */
const target = process.env.OPENBOT_KNOWLEDGE_SDK_V2_INTEGRATION_URL;

function client(): KnowledgeSdkClient {
  const key = process.env.OPENBOT_KNOWLEDGE_SDK_V2_INTEGRATION_KEY_FILE;
  if (!target || !key || new URL(target).hostname !== "127.0.0.1") {
    throw new Error("Explicit owned loopback fixture required");
  }
  return new KnowledgeSdkClient({
    enabled: true,
    environment: "test",
    allowedTenantIds: ["fixture-tenant-a"],
    baseUrl: target,
    timeoutMs: 5000,
    secret: fs.readFileSync(key, "utf8").trim(),
  });
}

const authorized = {
  issuer: "https://sandbox.example.invalid",
  subjectId: "sandbox-owner",
  tenantId: "fixture-tenant-a",
  policyGeneration: 1,
  actorType: "human" as const,
  agentId: "fixture-agent-private",
  requestId: "a03-mapping",
  roles: ["member"],
  departmentIds: ["fixture-department"],
  orgRoles: ["admin", "metrics_admin"],
  clearanceLevel: "internal",
  sessionId: "sandbox-session-sandbox-owner",
};
const path = "/v2/assets/fixture-tenant-a-private-doc";

it.skipIf(!target)(
  "A03 email used as subjectId is rejected locally as INVALID_TRUSTED_CONTEXT",
  async () => {
    await expect(
      client().request(path, "GET", {
        ...authorized,
        subjectId: "sandbox-owner@example.com",
        requestId: "a03-email-subject",
      }),
    ).rejects.toMatchObject({ code: "INVALID_TRUSTED_CONTEXT" });
  },
);

it.skipIf(!target)(
  "A03 missing issuer is rejected locally as INVALID_TRUSTED_CONTEXT",
  async () => {
    await expect(
      client().request(path, "GET", {
        ...authorized,
        issuer: "",
        requestId: "a03-missing-issuer",
      }),
    ).rejects.toMatchObject({ code: "INVALID_TRUSTED_CONTEXT" });
  },
);

it.skipIf(!target)(
  "A03 unmapped subject_id is denied by the live /v2 principal lookup",
  async () => {
    await expect(
      client().request(path, "GET", {
        ...authorized,
        subjectId: "unmapped-subject",
        orgRoles: [],
        sessionId: "sandbox-session-unmapped-subject",
        requestId: "a03-unmapped-subject",
      }),
    ).rejects.toMatchObject({ status: 403, code: "IDENTITY_REVOKED" });
  },
);

it.skipIf(!target)(
  "A03 issuer that is not the configured trusted issuer is denied live",
  async () => {
    await expect(
      client().request(path, "GET", {
        ...authorized,
        issuer: "https://other-idp.example.invalid",
        requestId: "a03-wrong-issuer",
      }),
    ).rejects.toMatchObject({ status: 403, code: "PERMISSION_DENIED" });
  },
);

it.skip("A03 issuer+raw_sub collision / multi-subject mapping is NOT_RUN on pin 9940818b: v2_auth has no mapping table and the adapter signs a pre-resolved subjectId", () => {
  throw new KnowledgeSdkError("NOT_RUN");
});

it.skip("A03 cross-IdP email linking ambiguity is NOT_RUN on pin 9940818b: no email-to-subject resolver exists on this HEAD", () => {
  throw new KnowledgeSdkError("NOT_RUN");
});
