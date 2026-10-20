import { afterEach, describe, expect, it } from "vitest";
import {
  issueRuntimeOwnershipProof,
  lookupRuntimeOwnershipBinding,
  resetRuntimeOwnershipProofsForTests,
  resolveConcreteAgentFromSessionKey,
  verifyRuntimeOwnershipProof,
} from "./runtime-ownership-proof.js";

const SECRET = "test-evolution-ownership-secret";

afterEach(() => {
  resetRuntimeOwnershipProofsForTests();
});

describe("runtime ownership proof", () => {
  it("issues a token bound to tenant, agent, run, and version", () => {
    const issued = issueRuntimeOwnershipProof({
      runId: "run-1",
      agentId: "growth-bot",
      tenantId: "tenant-acme",
      secret: SECRET,
      now: 1_000,
    });
    expect(issued?.binding).toMatchObject({
      runId: "run-1",
      agentId: "growth-bot",
      tenantId: "tenant-acme",
      proofVersion: 1,
    });
    expect(issued?.token.startsWith("evop1.")).toBe(true);
    const verified = verifyRuntimeOwnershipProof({
      token: issued?.token,
      runId: "run-1",
      expectedAgentId: "growth-bot",
      expectedTenantId: "tenant-acme",
      secret: SECRET,
      now: 1_001,
    });
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.source).toBe("token");
    }
  });

  it("rejects a missing proof", () => {
    expect(
      verifyRuntimeOwnershipProof({
        runId: "run-missing",
        expectedAgentId: "growth-bot",
        expectedTenantId: "tenant-acme",
        secret: SECRET,
      }),
    ).toEqual({ ok: false, reason: "binding_not_found" });
  });

  it("rejects a cross-tenant proof", () => {
    const issued = issueRuntimeOwnershipProof({
      runId: "run-2",
      agentId: "growth-bot",
      tenantId: "tenant-acme",
      secret: SECRET,
    });
    expect(
      verifyRuntimeOwnershipProof({
        token: issued?.token,
        runId: "run-2",
        expectedAgentId: "growth-bot",
        expectedTenantId: "tenant-globex",
        secret: SECRET,
      }),
    ).toEqual({ ok: false, reason: "cross_tenant" });
  });

  it("rejects an agent mismatch", () => {
    const issued = issueRuntimeOwnershipProof({
      runId: "run-3",
      agentId: "growth-bot",
      tenantId: "tenant-acme",
      secret: SECRET,
    });
    expect(
      verifyRuntimeOwnershipProof({
        token: issued?.token,
        runId: "run-3",
        expectedAgentId: "other-bot",
        expectedTenantId: "tenant-acme",
        secret: SECRET,
      }),
    ).toEqual({ ok: false, reason: "agent_mismatch" });
  });

  it("rejects an expired token and does not infer a default agent from an empty session key", () => {
    const issued = issueRuntimeOwnershipProof({
      runId: "run-4",
      agentId: "growth-bot",
      tenantId: "tenant-acme",
      secret: SECRET,
      now: 10,
      ttlMs: 5,
    });
    expect(
      verifyRuntimeOwnershipProof({
        token: issued?.token,
        secret: SECRET,
        now: 20,
      }),
    ).toEqual({ ok: false, reason: "expired" });
    expect(resolveConcreteAgentFromSessionKey("main")).toBeNull();
    expect(resolveConcreteAgentFromSessionKey("agent:growth-bot:direct:u1")).toBe("growth-bot");
    expect(lookupRuntimeOwnershipBinding("run-4", undefined, 20)).toBeNull();
  });
});
