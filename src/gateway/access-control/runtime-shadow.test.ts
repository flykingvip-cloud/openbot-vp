// @vitest-environment node
// Feature: shared-agent-identity-access-control-plane

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpRoot = path.join(os.tmpdir(), `openbot-runtime-shadow-${Date.now()}`);

// Redirect both the audit sink and the policy/registry stores to a temp CONFIG_DIR.
vi.mock("../../utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils.js")>()),
  CONFIG_DIR: tmpRoot,
}));

const { createAgentAsset } = await import("../agent-registry/registry.js");
const { createEmptyAgentRegistryStore } = await import("../agent-registry/types.js");
const { accessControlAuditPaths } = await import("./audit-sink.js");
const {
  buildSurfaceAuditDetail,
  buildV2GrantedSurface,
  compareGrantedSurfaces,
  recordWorkbenchSurfaceShadow,
  resolveRuntimeAgentSurface,
  resolveRuntimeShadowEnabled,
  summarizeIdsForAudit,
} = await import("./runtime-shadow.js");

type Registry = ReturnType<typeof createEmptyAgentRegistryStore>;
type Policy = import("./policy-v2-types.js").EnterpriseAccessPolicyV2;
type Subject = import("./policy-v2-types.js").AccessSubject;

const NOW = "2026-07-31T00:00:00.000Z";
const ENT = "ent-a";

const MEMBER: Subject = { subjectType: "membership", subjectId: "membership-1", status: "active" };
const SEAT: Subject = { subjectType: "seat", subjectId: "seat-1", status: "active" };

/**
 * Registry holding two ordinary assets plus a stray asset carrying the universal builtin's
 * legacy id (`main`), which existing tenants have from before ADR amendment 2.
 */
function registry(): { store: Registry; salesId: string; supportId: string; stewardId: string } {
  const store = createEmptyAgentRegistryStore();
  const sales = createAgentAsset({
    store,
    enterpriseId: ENT,
    agentSlug: "sales-bot",
    displayName: "Sales Bot",
    nowIso: NOW,
    legacyAgentId: "legacy-sales",
  });
  const support = createAgentAsset({
    store,
    enterpriseId: ENT,
    agentSlug: "support-bot",
    displayName: "Support Bot",
    nowIso: NOW,
    legacyAgentId: "legacy-support",
  });
  const steward = createAgentAsset({
    store,
    enterpriseId: ENT,
    agentSlug: "steward",
    displayName: "Steward",
    nowIso: NOW,
    legacyAgentId: "main",
  });
  return {
    store,
    salesId: sales.agentAssetId,
    supportId: support.agentAssetId,
    stewardId: steward.agentAssetId,
  };
}

function policy(overrides: Partial<Policy> = {}): Policy {
  return {
    policyId: "p-1",
    version: 2,
    enterpriseId: ENT,
    subjectType: "membership",
    subjectId: "membership-1",
    resourceType: "agent_asset",
    resourceId: "asset-1",
    permission: "agent.execute",
    effect: "allow",
    createdAt: NOW,
    ...overrides,
  };
}

describe("runtime shadow mode flag", () => {
  it("stays off unless explicitly enabled", () => {
    expect(resolveRuntimeShadowEnabled({})).toBe(false);
    expect(resolveRuntimeShadowEnabled({ OPENBOT_ACCESS_CONTROL_SHADOW_RUNTIME: "0" })).toBe(false);
    expect(resolveRuntimeShadowEnabled({ OPENBOT_ACCESS_CONTROL_SHADOW_RUNTIME: " 1 " })).toBe(
      true,
    );
    expect(resolveRuntimeShadowEnabled({ OPENBOT_ACCESS_CONTROL_SHADOW_RUNTIME: "TRUE" })).toBe(
      true,
    );
    expect(resolveRuntimeShadowEnabled({ OPENCLAW_ACCESS_CONTROL_SHADOW_RUNTIME: "true" })).toBe(
      true,
    );
  });
});

describe("runtime agent surface resolution", () => {
  it("maps legacy ids to canonical ids and reports what the Registry cannot name", () => {
    const { store, salesId } = registry();
    const surface = resolveRuntimeAgentSurface({
      registry: store,
      enterpriseId: ENT,
      legacyAgentIds: ["legacy-sales", "not-in-registry", "  "],
    });
    expect(surface.agentAssetIds).toEqual([salesId]);
    expect(surface.unresolvedLegacyAgentIds).toEqual(["not-in-registry"]);
  });

  it("holds a universal builtin out of the surface without calling it unnameable", () => {
    const { store, salesId } = registry();
    const surface = resolveRuntimeAgentSurface({
      registry: store,
      enterpriseId: ENT,
      legacyAgentIds: ["legacy-sales", "main"],
    });
    // Not an enterprise asset (ADR amendment 2), so neither an agreement nor a gap —
    // and specifically not folded into unresolved, which would read as a cutover loss.
    expect(surface.agentAssetIds).toEqual([salesId]);
    expect(surface.excludedBuiltinAgentIds).toEqual(["main"]);
    expect(surface.unresolvedLegacyAgentIds).toEqual([]);
  });
});

describe("V2 granted surface", () => {
  it("asks the evaluator rather than projecting the policy table", () => {
    const { store, salesId } = registry();
    const surface = buildV2GrantedSurface({
      policies: [
        policy({ resourceId: salesId }),
        // Revoked, so the evaluator must not grant it.
        policy({ policyId: "p-2", resourceId: "other-asset", revokedAt: NOW }),
      ],
      registry: store,
      enterpriseId: ENT,
      subjects: [MEMBER],
    });
    expect(surface.agentAssetIds).toEqual([salesId]);
  });

  it("includes an asset the subject owns even with no stored policy", async () => {
    // Regression: ownership is expressed as derived owner-baseline policies, not implicitly
    // by the evaluator. Omitting them reported an owner's own asset as access enforcement
    // was about to remove, which is how this was caught against real tenant data.
    const { setPrimaryOwner } = await import("../agent-registry/ownership.js");
    const { store, salesId } = registry();
    setPrimaryOwner({
      store,
      ref: { enterpriseId: ENT, agentAssetId: salesId },
      ownerType: "seat",
      ownerId: "seat-1",
      nowIso: NOW,
    });
    const surface = buildV2GrantedSurface({
      policies: [],
      registry: store,
      enterpriseId: ENT,
      subjects: [SEAT],
      nowIso: NOW,
    });
    expect(surface.agentAssetIds).toEqual([salesId]);
  });

  it("does not hand an owned asset to a different subject", () => {
    const { store, salesId } = registry();
    // No owner binding at all, so the baseline produces nothing.
    const surface = buildV2GrantedSurface({
      policies: [policy({ resourceId: salesId })],
      registry: store,
      enterpriseId: ENT,
      subjects: [SEAT],
      nowIso: NOW,
    });
    expect(surface.agentAssetIds).toEqual([]);
  });

  it("drops a grant an explicit deny overrides", () => {
    const { store, salesId } = registry();
    const surface = buildV2GrantedSurface({
      policies: [
        policy({ resourceId: salesId }),
        policy({ policyId: "p-deny", resourceId: salesId, effect: "deny" }),
      ],
      registry: store,
      enterpriseId: ENT,
      subjects: [MEMBER],
    });
    expect(surface.agentAssetIds).toEqual([]);
  });

  it("unions the membership and seat subjects", () => {
    const { store, salesId, supportId } = registry();
    const surface = buildV2GrantedSurface({
      policies: [
        policy({ resourceId: salesId }),
        policy({
          policyId: "p-seat",
          subjectType: "seat",
          subjectId: "seat-1",
          resourceId: supportId,
        }),
      ],
      registry: store,
      enterpriseId: ENT,
      subjects: [MEMBER, SEAT],
    });
    expect(surface.agentAssetIds).toEqual([salesId, supportId].toSorted());
  });

  it("ignores a leftover policy that still names a builtin asset", () => {
    // Existing tenants migrated grants onto the stray `main` asset. Counting those would
    // make the V2 surface claim access the runtime does not express as an asset grant.
    const { store, stewardId } = registry();
    const surface = buildV2GrantedSurface({
      policies: [policy({ resourceId: stewardId })],
      registry: store,
      enterpriseId: ENT,
      subjects: [MEMBER],
      nowIso: NOW,
    });
    expect(surface.agentAssetIds).toEqual([]);
  });

  it("collects spaces under space.read and ignores other tenants", () => {
    const { store } = registry();
    const surface = buildV2GrantedSurface({
      policies: [
        policy({
          policyId: "p-space",
          resourceType: "space",
          resourceId: "space-1",
          permission: "space.read",
        }),
        policy({
          policyId: "p-foreign",
          enterpriseId: "ent-b",
          resourceType: "space",
          resourceId: "space-9",
          permission: "space.read",
        }),
      ],
      registry: store,
      enterpriseId: ENT,
      subjects: [MEMBER],
    });
    expect(surface.spaceIds).toEqual(["space-1"]);
  });

  it("flags a wildcard grant instead of enumerating an open set", () => {
    const { store } = registry();
    const surface = buildV2GrantedSurface({
      policies: [policy({ resourceId: "*" })],
      registry: store,
      enterpriseId: ENT,
      subjects: [MEMBER],
    });
    expect(surface).toMatchObject({ agentAssetIds: [], wildcardAgent: true });
  });
});

describe("granted surface comparison", () => {
  const runtime = {
    agentAssetIds: ["asset-1", "asset-2"],
    unresolvedLegacyAgentIds: [],
    excludedBuiltinAgentIds: [],
  };

  it("reports equivalence when both sides grant the same thing", () => {
    const result = compareGrantedSurfaces({
      runtime,
      runtimeSpaceIds: ["space-1"],
      v2: {
        agentAssetIds: ["asset-1", "asset-2"],
        spaceIds: ["space-1"],
        wildcardAgent: false,
        wildcardSpace: false,
      },
    });
    expect(result.equivalent).toBe(true);
    expect(result.agent.agreed).toEqual(["asset-1", "asset-2"]);
  });

  it("separates access enforcement would remove from access it would add", () => {
    const result = compareGrantedSurfaces({
      runtime,
      runtimeSpaceIds: ["space-1"],
      v2: {
        agentAssetIds: ["asset-2", "asset-3"],
        spaceIds: [],
        wildcardAgent: false,
        wildcardSpace: false,
      },
    });
    expect(result.agent).toEqual({
      agreed: ["asset-2"],
      onlyInRuntime: ["asset-1"],
      onlyInV2: ["asset-3"],
    });
    expect(result.space.onlyInRuntime).toEqual(["space-1"]);
    expect(result.equivalent).toBe(false);
  });

  it("stays equivalent when the only extra live grant is a universal builtin", () => {
    const result = compareGrantedSurfaces({
      runtime: {
        agentAssetIds: ["asset-1", "asset-2"],
        unresolvedLegacyAgentIds: [],
        excludedBuiltinAgentIds: ["main"],
      },
      runtimeSpaceIds: [],
      v2: {
        agentAssetIds: ["asset-1", "asset-2"],
        spaceIds: [],
        wildcardAgent: false,
        wildcardSpace: false,
      },
    });
    // The builtin is outside the asset model, so it costs nothing at cutover.
    expect(result.agent.onlyInRuntime).toEqual([]);
    expect(result.excludedBuiltinAgentIds).toEqual(["main"]);
    expect(result.equivalent).toBe(true);
  });

  it("refuses equivalence when a wildcard makes the V2 surface unenumerable", () => {
    const result = compareGrantedSurfaces({
      runtime,
      runtimeSpaceIds: [],
      v2: {
        agentAssetIds: ["asset-1", "asset-2"],
        spaceIds: [],
        wildcardAgent: true,
        wildcardSpace: false,
      },
    });
    expect(result.agent.onlyInRuntime).toEqual([]);
    expect(result.equivalent).toBe(false);
  });

  it("refuses equivalence when a live grant cannot be named in V2", () => {
    const result = compareGrantedSurfaces({
      runtime: { ...runtime, unresolvedLegacyAgentIds: ["ghost-bot"] },
      runtimeSpaceIds: [],
      v2: {
        agentAssetIds: ["asset-1", "asset-2"],
        spaceIds: [],
        wildcardAgent: false,
        wildcardSpace: false,
      },
    });
    expect(result.equivalent).toBe(false);
    expect(result.unresolvedLegacyAgentIds).toEqual(["ghost-bot"]);
  });
});

describe("audit detail", () => {
  it("bounds the id list so one actor cannot write an unbounded line", () => {
    const ids = Array.from({ length: 13 }, (_, index) => `id-${index}`);
    expect(summarizeIdsForAudit(ids)).toBe(`${ids.slice(0, 10).join(",")},+3 more`);
    expect(summarizeIdsForAudit([])).toBe("");
  });

  it("flattens a comparison into primitives only", () => {
    const detail = buildSurfaceAuditDetail({
      agent: { agreed: ["a"], onlyInRuntime: ["b"], onlyInV2: [] },
      space: { agreed: [], onlyInRuntime: [], onlyInV2: ["s"] },
      unresolvedLegacyAgentIds: ["ghost"],
      excludedBuiltinAgentIds: [],
      wildcardAgent: false,
      wildcardSpace: false,
      equivalent: false,
    });
    expect(detail).toMatchObject({
      equivalent: false,
      agentAgreed: 1,
      agentOnlyInRuntime: 1,
      spaceOnlyInV2: 1,
      unresolvedLegacyAgents: 1,
      agentOnlyInRuntimeIds: "b",
      spaceOnlyInV2Ids: "s",
      unresolvedLegacyAgentIds: "ghost",
    });
    for (const value of Object.values(detail)) {
      expect(["string", "number", "boolean"]).toContain(typeof value);
    }
  });
});

describe("recordWorkbenchSurfaceShadow", () => {
  beforeEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  async function governanceLines(): Promise<Record<string, unknown>[]> {
    const raw = await fs.readFile(accessControlAuditPaths().governance, "utf8").catch(() => "");
    return raw
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  it("does nothing at all when disabled", async () => {
    const result = await recordWorkbenchSurfaceShadow({
      enterpriseId: ENT,
      membershipId: "membership-1",
      legacyAgentIds: ["legacy-sales"],
      spaceIds: [],
      enabled: false,
    });
    expect(result).toBeNull();
    expect(await governanceLines()).toEqual([]);
  });

  it("does nothing when no V2 subject can be formed", async () => {
    // Unbound session / unconfigured platform auth: inventing a subject id would put an
    // identity that does not exist into the audit stream.
    const result = await recordWorkbenchSurfaceShadow({
      enterpriseId: ENT,
      legacyAgentIds: ["legacy-sales"],
      spaceIds: [],
      enabled: true,
    });
    expect(result).toBeNull();
    expect(await governanceLines()).toEqual([]);
  });

  it("records the comparison against the on-disk stores when enabled", async () => {
    const result = await recordWorkbenchSurfaceShadow({
      enterpriseId: ENT,
      membershipId: "membership-1",
      seatId: "seat-1",
      legacyAgentIds: ["legacy-sales"],
      spaceIds: ["space-1"],
      requestId: "req-shadow",
      enabled: true,
    });
    // Empty stores: V2 grants nothing, so every live grant shows as a would-be removal.
    expect(result).toMatchObject({ equivalent: false });
    expect(result?.unresolvedLegacyAgentIds).toEqual(["legacy-sales"]);
    const [event] = await governanceLines();
    expect(event).toMatchObject({
      requestId: "req-shadow",
      enterpriseId: ENT,
      action: "access.shadow-surface",
      actor: { subjectType: "membership", subjectId: "membership-1" },
    });
    expect(event.detail).toMatchObject({ subjects: 2, unresolvedLegacyAgents: 1 });
  });

  it("never lets a failure propagate into the caller", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const appendFile = vi
      .spyOn(fs, "appendFile")
      .mockRejectedValue(new Error("disk full") as never);
    try {
      const result = await recordWorkbenchSurfaceShadow({
        enterpriseId: ENT,
        membershipId: "membership-1",
        legacyAgentIds: [],
        spaceIds: [],
        enabled: true,
      });
      // The audit line is lost, but the comparison still returned and nothing threw.
      expect(result).not.toBeNull();
    } finally {
      appendFile.mockRestore();
      warn.mockRestore();
    }
  });
});
