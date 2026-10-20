import { afterEach, describe, expect, it } from "vitest";
import { createExecutionIdentityContext } from "./execution-identity-context.js";
import {
  discardStagedSpawnExecutionIdentity,
  peekStagedSpawnExecutionIdentity,
  resetSpawnExecutionIdentityHandoffForTest,
  stageSpawnExecutionIdentity,
  takeStagedSpawnExecutionIdentity,
} from "./execution-identity-handoff.js";
import { gatewayClientForSessionOwner } from "./tenant-context.js";

afterEach(() => {
  resetSpawnExecutionIdentityHandoffForTest();
});

describe("spawn execution identity handoff", () => {
  it("stages a frozen parent identity for the child idempotency key", () => {
    const identity = createExecutionIdentityContext({
      user: "member@acme.example",
      platformUserId: "emp-ops",
      sessionDomain: "employee",
      enterpriseId: "001",
      membershipId: "mem-ops",
      agentId: "ops-bot",
    });
    stageSpawnExecutionIdentity("child-idem-1", identity);
    expect(takeStagedSpawnExecutionIdentity("child-idem-1")).toBe(identity);
    expect(takeStagedSpawnExecutionIdentity("child-idem-1")).toBeUndefined();
  });

  it("does not stage an unauthenticated object", () => {
    stageSpawnExecutionIdentity(
      "child-idem-empty",
      createExecutionIdentityContext({ agentId: "ops-bot" }),
    );
    expect(takeStagedSpawnExecutionIdentity("child-idem-empty")).toBeUndefined();
  });

  it("discards a staged identity when the child run fails to start", () => {
    const identity = createExecutionIdentityContext({
      user: "member@acme.example",
      enterpriseId: "001",
    });
    stageSpawnExecutionIdentity("child-idem-fail", identity);
    discardStagedSpawnExecutionIdentity("child-idem-fail");
    expect(takeStagedSpawnExecutionIdentity("child-idem-fail")).toBeUndefined();
  });

  // The agent handler reads the staged identity twice: early, to resolve the
  // tenant-scoped session store, and again at dispatch. The early read must not
  // consume it, or dispatch loses the frozen identity.
  describe("peek", () => {
    it("returns the staged identity without consuming it", () => {
      const identity = createExecutionIdentityContext({
        user: "member@acme.example",
        platformUserId: "emp-ops",
        sessionDomain: "employee",
        enterpriseId: "001",
      });
      stageSpawnExecutionIdentity("child-idem-peek", identity);

      expect(peekStagedSpawnExecutionIdentity("child-idem-peek")).toBe(identity);
      expect(peekStagedSpawnExecutionIdentity("child-idem-peek")).toBe(identity);
      // Dispatch still gets it, and only then is it consumed.
      expect(takeStagedSpawnExecutionIdentity("child-idem-peek")).toBe(identity);
      expect(peekStagedSpawnExecutionIdentity("child-idem-peek")).toBeUndefined();
    });

    it("is undefined for unknown or blank keys", () => {
      expect(peekStagedSpawnExecutionIdentity("nope")).toBeUndefined();
      expect(peekStagedSpawnExecutionIdentity(undefined)).toBeUndefined();
      expect(peekStagedSpawnExecutionIdentity("   ")).toBeUndefined();
    });
  });
});

describe("gatewayClientForSessionOwner owner binding", () => {
  it("binds a spawned child to the staged parent platform user", () => {
    const bound = gatewayClientForSessionOwner(null, "emp-ops", "employee");
    expect(bound?.platformUserId).toBe("emp-ops");
    expect(bound?.sessionDomain).toBe("employee");
  });

  it("falls back to the owner email when no platform user id was frozen", () => {
    const bound = gatewayClientForSessionOwner(null, undefined, "employee", "member@acme.example");
    expect(bound?.user).toBe("member@acme.example");
    expect(bound?.sessionDomain).toBe("employee");
  });

  it("keeps an already authenticated client untouched", () => {
    const client = { connect: {} as never, platformUserId: "real-caller" };
    expect(gatewayClientForSessionOwner(client, "emp-ops", "employee", "a@b.example")).toBe(client);
  });

  it("stays identity-less when nothing is known (never invents an owner)", () => {
    expect(gatewayClientForSessionOwner(null, undefined, "employee", undefined)).toBeNull();
  });
});
