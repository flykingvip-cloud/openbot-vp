import { describe, expect, it } from "vitest";
import {
  EMBEDDED_MODEL_MODE_ENV,
  resolveEmbeddedConfiguredModelMode,
  resolveEmbeddedModelGovernance,
} from "./embedded-model-governance.js";

describe("embedded model governance (P3-1)", () => {
  it("defaults to shadow and never to enforced", () => {
    expect(resolveEmbeddedConfiguredModelMode({})).toBe("shadow");
    expect(resolveEmbeddedConfiguredModelMode({ [EMBEDDED_MODEL_MODE_ENV]: "nope" })).toBe(
      "shadow",
    );
    expect(resolveEmbeddedConfiguredModelMode({ [EMBEDDED_MODEL_MODE_ENV]: "legacy" })).toBe(
      "legacy",
    );
    expect(resolveEmbeddedConfiguredModelMode({ [EMBEDDED_MODEL_MODE_ENV]: "enforced" })).toBe(
      "enforced",
    );
  });

  it("gate skipped → legacy without allowlist or enforcement", () => {
    expect(resolveEmbeddedModelGovernance({ gateStatus: "skipped" }, {})).toEqual({
      governanceMode: "legacy",
    });
    expect(
      resolveEmbeddedModelGovernance(
        { gateStatus: "skipped", actorId: "platform-user:u1", allowlist: ["x/y"] },
        {},
      ),
    ).toEqual({
      governanceMode: "legacy",
      governanceContext: { actorId: "platform-user:u1" },
    });
  });

  it("gate acquired + allowlist array → shadow + preexisting hard-filter", () => {
    const params = resolveEmbeddedModelGovernance(
      {
        gateStatus: "acquired",
        allowlist: ["openai/gpt-5"],
        tenantId: "tenant-a",
        commercialAuthorizationId: "auth-1",
        actorId: "platform-user:u1",
      },
      {},
    );
    expect(params).toEqual({
      governanceMode: "shadow",
      entitlementAllowlist: ["openai/gpt-5"],
      allowlistEnforcement: "preexisting",
      governanceContext: {
        tenantId: "tenant-a",
        actorId: "platform-user:u1",
        commercialAuthorizationId: "auth-1",
      },
    });
    expect(params.entitlementAllowlist).not.toBeUndefined();
  });

  it("gate acquired without allowlist array → mode without filter params", () => {
    expect(
      resolveEmbeddedModelGovernance(
        { gateStatus: "acquired", tenantId: "tenant-a", commercialAuthorizationId: "auth-1" },
        {},
      ),
    ).toEqual({
      governanceMode: "shadow",
      governanceContext: { tenantId: "tenant-a", commercialAuthorizationId: "auth-1" },
    });
  });

  it("empty allowlist array still gets preexisting enforcement", () => {
    expect(resolveEmbeddedModelGovernance({ gateStatus: "acquired", allowlist: [] }, {})).toEqual({
      governanceMode: "shadow",
      entitlementAllowlist: [],
      allowlistEnforcement: "preexisting",
    });
  });

  it("explicit env selects legacy or enforced for an acquired gate", () => {
    expect(
      resolveEmbeddedModelGovernance(
        { gateStatus: "acquired", allowlist: ["a/b"] },
        { [EMBEDDED_MODEL_MODE_ENV]: "legacy" },
      ).governanceMode,
    ).toBe("legacy");
    expect(
      resolveEmbeddedModelGovernance(
        { gateStatus: "acquired", allowlist: ["a/b"] },
        { [EMBEDDED_MODEL_MODE_ENV]: "enforced" },
      ).governanceMode,
    ).toBe("enforced");
  });
});
