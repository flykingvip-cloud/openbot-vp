import { describe, expect, it } from "vitest";
import type { CapabilityManifest } from "../types.ts";
import { DiscoveryDispatcher } from "./dispatcher.ts";
import type { DiscoveredCapability, SourceAdapter } from "./types.ts";

function makeManifest(id: string): CapabilityManifest {
  return {
    id: `urn:openclaw:skill:${id}@1.0.0`,
    kind: "skill",
    version: "1.0.0",
    skillKey: id,
    name: id,
    description: `${id} skill`,
    source: { kind: "npm", origin: `@openclaw/skill-${id}`, trustTier: "first-party" },
    interface: { inputs: [], outputs: [] },
    contracts: { sideEffects: ["read_only"], idempotent: true, requiresConfirmation: false },
    behavior: { costModel: "free" },
    requirements: { bins: [], env: [], configPaths: [], operatingSystems: [] },
    install: [],
    risk: { level: "low", network: false, filesystem: false, subprocess: false, secrets: false },
  };
}

function makeDiscovered(id: string, sourceId: string): DiscoveredCapability {
  return {
    sourceId,
    externalId: `@openclaw/skill-${id}`,
    version: "1.0.0",
    manifest: makeManifest(id),
    findings: [],
    provenance: {
      url: `https://npmjs.com/${id}`,
      fetchedAt: "2026-05-11T00:00:00Z",
      registryName: "npm",
    },
  };
}

function makeAdapter(id: string, items: DiscoveredCapability[]): SourceAdapter {
  return {
    id,
    label: `Test adapter ${id}`,
    discover: async () => items,
  };
}

describe("DiscoveryDispatcher", () => {
  it("merges results from multiple adapters", async () => {
    const a1 = makeAdapter("npm", [makeDiscovered("weather", "npm")]);
    const a2 = makeAdapter("github", [makeDiscovered("github", "github")]);
    const dispatcher = new DiscoveryDispatcher([a1, a2]);

    const result = await dispatcher.run();

    expect(result.discovered).toHaveLength(2);
    expect(result.proposals).toHaveLength(2);
    expect(result.errors).toEqual([]);
    expect(result.proposals[0].status).toBe("proposed");
    expect(result.proposals[0].proposalId).toContain("npm");
  });

  it("deduplicates by (sourceId, externalId, version)", async () => {
    const item = makeDiscovered("weather", "npm");
    const a1 = makeAdapter("npm", [item, item]); // same item twice
    const dispatcher = new DiscoveryDispatcher([a1]);

    const result = await dispatcher.run();

    expect(result.discovered).toHaveLength(1);
    expect(result.proposals).toHaveLength(1);
  });

  it("captures adapter errors without crashing", async () => {
    const failing: SourceAdapter = {
      id: "broken",
      label: "Broken adapter",
      discover: async () => {
        throw new Error("network timeout");
      },
    };
    const working = makeAdapter("npm", [makeDiscovered("weather", "npm")]);
    const dispatcher = new DiscoveryDispatcher([failing, working]);

    const result = await dispatcher.run();

    expect(result.discovered).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].adapterId).toBe("broken");
  });

  it("supports adding adapters at runtime", async () => {
    const dispatcher = new DiscoveryDispatcher([]);
    expect(dispatcher.adapterIds).toEqual([]);

    dispatcher.addAdapter(makeAdapter("npm", [makeDiscovered("weather", "npm")]));
    expect(dispatcher.adapterIds).toEqual(["npm"]);

    const result = await dispatcher.run();
    expect(result.proposals).toHaveLength(1);
  });

  it("respects filter.limit passed to adapters", async () => {
    let receivedFilter: unknown;
    const adapter: SourceAdapter = {
      id: "test",
      label: "Test",
      discover: async (filter) => {
        receivedFilter = filter;
        return [];
      },
    };
    const dispatcher = new DiscoveryDispatcher([adapter]);
    await dispatcher.run({ limit: 10, keyword: "weather" });
    expect(receivedFilter).toEqual({ limit: 10, keyword: "weather" });
  });
});
