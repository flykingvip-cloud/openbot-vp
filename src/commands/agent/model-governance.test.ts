import { describe, expect, it } from "vitest";
import {
  AGENT_COMMAND_MODEL_MODE_ENV,
  resolveAgentCommandActorId,
  resolveAgentCommandConfiguredModelMode,
  resolveAgentCommandModelGovernance,
} from "../../agent-runtime/model/command-governance.js";
import { createExecutionIdentityContext } from "../../gateway/execution-identity-context.js";

const acquired = {
  status: "acquired" as const,
  authorizationDecisionId: "auth-1",
  modelGate: {
    tenantId: "tenant-a",
    allowlist: ["openai/gpt-5"],
    preferredModelOrder: ["x/y"],
    effectiveRouting: { mode: "native" as const, selectorStrategy: "balanced" as const },
  },
};

describe("agent command model governance", () => {
  it("defaults to shadow and never to enforced", () => {
    expect(resolveAgentCommandConfiguredModelMode({})).toBe("shadow");
    expect(resolveAgentCommandConfiguredModelMode({ [AGENT_COMMAND_MODEL_MODE_ENV]: "nope" })).toBe(
      "shadow",
    );
    expect(
      resolveAgentCommandConfiguredModelMode({ [AGENT_COMMAND_MODEL_MODE_ENV]: "legacy" }),
    ).toBe("legacy");
  });

  it("subagent lane (gate not run) keeps today's params", () => {
    expect(resolveAgentCommandModelGovernance(undefined, {})).toEqual({});
  });

  it("gate skipped → legacy without allowlist", () => {
    expect(resolveAgentCommandModelGovernance({ status: "skipped" }, {})).toEqual({
      governanceMode: "legacy",
    });
  });

  it("gate acquired → shadow with the gate allowlist and linked ids; no preferred order", () => {
    const params = resolveAgentCommandModelGovernance(acquired, {});
    expect(params).toEqual({
      governanceMode: "shadow",
      entitlementAllowlist: ["openai/gpt-5"],
      governanceContext: { tenantId: "tenant-a", commercialAuthorizationId: "auth-1" },
    });
    expect(params.entitlementAllowlist).not.toBe(acquired.modelGate.allowlist);
    expect("preferredModelOrder" in params).toBe(false);
  });

  it("gate acquired without a model gate → mode without allowlist", () => {
    expect(resolveAgentCommandModelGovernance({ status: "acquired" }, {})).toEqual({
      governanceMode: "shadow",
      governanceContext: {},
    });
  });

  it("explicit env selects legacy or enforced for an acquired gate", () => {
    expect(
      resolveAgentCommandModelGovernance(acquired, { [AGENT_COMMAND_MODEL_MODE_ENV]: "legacy" })
        .governanceMode,
    ).toBe("legacy");
    expect(
      resolveAgentCommandModelGovernance(acquired, { [AGENT_COMMAND_MODEL_MODE_ENV]: "enforced" })
        .governanceMode,
    ).toBe("enforced");
  });

  describe("actorId / tenantId (plan goal 4)", () => {
    it("derives actorId from the server-side execution identity, preferring opaque ids", () => {
      expect(
        resolveAgentCommandActorId(
          createExecutionIdentityContext({
            user: "alice@example.com",
            platformUserId: "emp-1",
            membershipId: "mem-1",
          }),
        ),
      ).toBe("platform-user:emp-1");
      expect(
        resolveAgentCommandActorId(
          createExecutionIdentityContext({ user: "a@example.com", membershipId: "mem-1" }),
        ),
      ).toBe("membership:mem-1");
      expect(resolveAgentCommandActorId(createExecutionIdentityContext({ seatId: "seat-9" }))).toBe(
        "seat:seat-9",
      );
    });

    it("never fabricates an actor (no identity, or email only)", () => {
      expect(resolveAgentCommandActorId(undefined)).toBeUndefined();
      expect(
        resolveAgentCommandActorId(createExecutionIdentityContext({ user: "a@example.com" })),
      ).toBeUndefined();
    });

    it("acquired gate carries actorId and tenantId when known", () => {
      const identity = createExecutionIdentityContext({ platformUserId: "emp-1" });
      expect(resolveAgentCommandModelGovernance(acquired, {}, identity).governanceContext).toEqual({
        tenantId: "tenant-a",
        actorId: "platform-user:emp-1",
        commercialAuthorizationId: "auth-1",
      });
    });

    it("tenantId falls back to the gate's resolved enterprise, not the client", () => {
      expect(
        resolveAgentCommandModelGovernance(
          {
            status: "acquired",
            enterpriseId: "ent-7",
            modelGate: {
              allowlist: [],
              effectiveRouting: { mode: "native" as const, selectorStrategy: "balanced" as const },
            },
          },
          {},
        ).governanceContext,
      ).toEqual({ tenantId: "ent-7" });
    });

    it("acquired gate without identity has no actorId key", () => {
      const context = resolveAgentCommandModelGovernance(acquired, {}).governanceContext;
      expect(context && "actorId" in context).toBe(false);
    });

    it("skipped gate keeps legacy and adds actorId only when known", () => {
      expect(
        resolveAgentCommandModelGovernance(
          { status: "skipped" },
          {},
          createExecutionIdentityContext({ membershipId: "mem-2" }),
        ),
      ).toEqual({ governanceMode: "legacy", governanceContext: { actorId: "membership:mem-2" } });
      expect(resolveAgentCommandModelGovernance({ status: "skipped" }, {})).toEqual({
        governanceMode: "legacy",
      });
    });
  });
});
