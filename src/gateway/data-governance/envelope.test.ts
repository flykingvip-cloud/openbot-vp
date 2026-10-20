import { describe, expect, it } from "vitest";
import {
  assertCatalogMutableEnvelope,
  assertWritableEnvelope,
  validateGovernanceEnvelope,
} from "./envelope.js";
import { GOVERNANCE_ENVELOPE_SCHEMA_VERSION } from "./types.js";

function validEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    resourceId: "res-ws-1",
    resourceType: "workspace",
    schemaVersion: GOVERNANCE_ENVELOPE_SCHEMA_VERSION,
    tenantId: "t1",
    owner: { kind: "user", userId: "u1" },
    scope: { kind: "user", userId: "u1" },
    lifecycleState: "active",
    classification: "internal",
    governanceVersion: 1,
    canonicalBindingId: "bind-1",
    createdAt: "2026-08-11T00:00:00Z",
    updatedAt: "2026-08-11T00:00:00Z",
    ...overrides,
  };
}

describe("validateGovernanceEnvelope", () => {
  it("accepts a required-tier first-wave envelope", () => {
    const result = validateGovernanceEnvelope(validEnvelope());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.envelope.resourceType).toBe("workspace");
      expect(result.envelope.canonicalBindingId).toBe("bind-1");
    }
  });

  it("fail-closes on missing canonical binding", () => {
    const result = validateGovernanceEnvelope(validEnvelope({ canonicalBindingId: "" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some(
          (e) => e.code === "missing_canonical_binding" || e.code === "missing_field",
        ),
      ).toBe(true);
    }
  });

  it("accepts knowledge Asset envelopes in P1-2", () => {
    const result = validateGovernanceEnvelope(
      validEnvelope({
        resourceId: "knowledge:t1:doc:d1:v1",
        resourceType: "knowledge",
        projection: { contentClass: "document_version", docId: "d1", versionId: "v1" },
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.envelope.resourceType).toBe("knowledge");
      expect(result.envelope.projection?.contentClass).toBe("document_version");
    }
  });

  it("accepts memory Asset envelopes with min projection only", () => {
    const result = validateGovernanceEnvelope(
      validEnvelope({
        resourceId: "memory:t1:atom:a1",
        resourceType: "memory",
        classification: "confidential",
        projection: {
          canonicalKind: "cogniweave",
          atomId: "a1",
          memoryTier: "working",
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.envelope.resourceType).toBe("memory");
      expect(result.envelope.projection?.canonicalKind).toBe("cogniweave");
    }
  });

  it("rejects Catalog projection bodies/secrets and non-allowlisted keys", () => {
    expect(
      validateGovernanceEnvelope(
        validEnvelope({
          resourceType: "knowledge",
          resourceId: "knowledge:t1:doc:d1:v1",
          projection: { contentClass: "document_version", body: "secret text" },
        }),
      ).ok,
    ).toBe(false);
    expect(
      validateGovernanceEnvelope(
        validEnvelope({
          resourceType: "memory",
          resourceId: "memory:t1:atom:a1",
          projection: { canonicalKind: "cogniweave", embedding: "1,2,3" },
        }),
      ).ok,
    ).toBe(false);
    expect(
      validateGovernanceEnvelope(
        validEnvelope({
          resourceType: "operational_identity",
          resourceId: "operational_identity:t1:id-1",
          projection: { identityId: "id-1", accessToken: "tok" },
        }),
      ).ok,
    ).toBe(false);
    expect(
      validateGovernanceEnvelope(
        validEnvelope({
          resourceType: "operational_identity",
          resourceId: "operational_identity:t1:id-1",
          projection: { identityId: "id-1", note: "sk-live-abcdefghijklmnopqrstuvwxyz" },
        }),
      ).ok,
    ).toBe(false);
  });

  it("rejects incomplete or invalid scope kinds", () => {
    expect(validateGovernanceEnvelope(validEnvelope({ scope: { kind: "tenant" } })).ok).toBe(false);
    expect(validateGovernanceEnvelope(validEnvelope({ scope: { kind: "invalid" } })).ok).toBe(
      false,
    );
    expect(
      validateGovernanceEnvelope(
        validEnvelope({
          scope: { kind: "tenant", tenantId: "other" },
        }),
      ).ok,
    ).toBe(false);
  });

  it("rejects owner/scope userId mismatch", () => {
    const result = validateGovernanceEnvelope(
      validEnvelope({ scope: { kind: "user", userId: "other" } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === "inconsistent_owner_scope")).toBe(true);
    }
  });

  it("rejects non-ISO timestamps and unknown fields", () => {
    expect(validateGovernanceEnvelope(validEnvelope({ createdAt: "yesterday" })).ok).toBe(false);
    expect(validateGovernanceEnvelope(validEnvelope({ transcript: "x" })).ok).toBe(false);
  });
});

describe("assertWritableEnvelope", () => {
  it("throws for retired lifecycle", () => {
    expect(() => assertWritableEnvelope(validEnvelope({ lifecycleState: "retired" }))).toThrow(
      /governance_envelope_not_writable:retired/,
    );
  });

  it("throws for pending lifecycle (content write gate)", () => {
    expect(() => assertWritableEnvelope(validEnvelope({ lifecycleState: "pending" }))).toThrow(
      /governance_envelope_not_writable:pending/,
    );
  });

  it("throws for read_only and archived", () => {
    expect(() => assertWritableEnvelope(validEnvelope({ lifecycleState: "read_only" }))).toThrow(
      /governance_envelope_not_writable:read_only/,
    );
    expect(() => assertWritableEnvelope(validEnvelope({ lifecycleState: "archived" }))).toThrow(
      /governance_envelope_not_writable:archived/,
    );
  });

  it("returns envelope for active resources", () => {
    const env = assertWritableEnvelope(validEnvelope({ resourceType: "agent" }));
    expect(env.resourceType).toBe("agent");
  });
});

describe("assertCatalogMutableEnvelope", () => {
  it("allows pending and active catalog transitions", () => {
    expect(
      assertCatalogMutableEnvelope(validEnvelope({ lifecycleState: "pending" })).lifecycleState,
    ).toBe("pending");
    expect(
      assertCatalogMutableEnvelope(validEnvelope({ lifecycleState: "active" })).lifecycleState,
    ).toBe("active");
  });

  it("allows terminal destinations (purged/retired) for lifecycle completion writes", () => {
    expect(
      assertCatalogMutableEnvelope(validEnvelope({ lifecycleState: "retired" })).lifecycleState,
    ).toBe("retired");
    expect(
      assertCatalogMutableEnvelope(validEnvelope({ lifecycleState: "purged" })).lifecycleState,
    ).toBe("purged");
  });
});
