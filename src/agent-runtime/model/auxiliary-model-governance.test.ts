import { beforeEach, expect, it, vi } from "vitest";
import { resolveAuxiliaryModelGovernance } from "./auxiliary-model-governance.js";

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  configuredMode: vi.fn(() => "shadow" as const),
}));

vi.mock("../../gateway/governance/spawn-snapshot-handoff.js", () => ({
  lookupRunModelSet: mocks.lookup,
}));

vi.mock("../../agents/embedded-model-governance.js", () => ({
  resolveEmbeddedConfiguredModelMode: mocks.configuredMode,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.configuredMode.mockReturnValue("shadow");
});

it("inherits parent allowlist for memory_flush without inventing task ownership", () => {
  mocks.lookup.mockReturnValue({
    governanceMode: "enforced",
    effectiveModelSet: { allowlist: ["openai/gpt-4.1-mini"] },
    tenantId: "t1",
    actorId: "a1",
    commercialAuthorizationId: "auth-1",
  });
  expect(
    resolveAuxiliaryModelGovernance({ purpose: "memory_flush", parentRunId: "parent-1" }),
  ).toEqual({
    governanceMode: "enforced",
    entitlementAllowlist: ["openai/gpt-4.1-mini"],
    governanceContext: {
      purpose: "memory_flush",
      parentRunId: "parent-1",
      tenantId: "t1",
      actorId: "a1",
      commercialAuthorizationId: "auth-1",
    },
  });
});

it("slug_filename without parent records absent allowlist under configured mode", () => {
  mocks.lookup.mockReturnValue(undefined);
  expect(resolveAuxiliaryModelGovernance({ purpose: "slug_filename" })).toEqual({
    governanceMode: "shadow",
    absentAllowlistReason: "parent-model-set-absent",
    governanceContext: { purpose: "slug_filename" },
  });
  expect(mocks.lookup).not.toHaveBeenCalled();
});

it("legacy parent snapshot keeps legacy mode for auxiliary flush", () => {
  mocks.lookup.mockReturnValue({
    governanceMode: "legacy",
    tenantId: "t1",
  });
  expect(
    resolveAuxiliaryModelGovernance({ purpose: "memory_flush", parentRunId: "parent-legacy" }),
  ).toEqual({
    governanceMode: "legacy",
    governanceContext: {
      purpose: "memory_flush",
      parentRunId: "parent-legacy",
      tenantId: "t1",
    },
  });
});
