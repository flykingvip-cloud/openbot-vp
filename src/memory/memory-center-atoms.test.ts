import { describe, expect, it } from "vitest";
import type { MemoryAtom } from "../../packages/cogniweave-sdk/src/index.js";
import { mapAtomToMemoryCenterRow, parseMemoryCenterScopeKind } from "./memory-center-atoms.js";

function baseAtom(overrides: Partial<MemoryAtom> = {}): MemoryAtom {
  return {
    id: "atom_1",
    atomType: "strategy",
    scope: {
      workspaceId: "ws_hidden",
      projectId: "agent:main",
      agentId: "main",
      visibility: "private",
    },
    claim: { type: "procedural", statement: "Prefer async retries under latency" },
    trigger: { conditions: ["high latency"], contextTags: ["ops"] },
    applicability: { include: ["production"], exclude: [] },
    provenance: { sourceEventIds: ["evt_secret"], evidenceRefs: ["ev_secret"] },
    versioning: { version: 1 },
    state: { status: "active", conflictsWith: [] },
    metrics: { confidence: 0.8, reuseCount: 2 },
    privacy: {
      privacyLevel: "private",
      syncEligibility: "blocked",
    },
    lifecycle: {
      admittedAt: "2026-07-01T00:00:00.000Z",
    },
    ...overrides,
  };
}

describe("memory-center-atoms", () => {
  it("maps atom to safe Memory Center row without internals", () => {
    const row = mapAtomToMemoryCenterRow(baseAtom());
    expect(row).toMatchObject({
      id: "atom_1",
      summary: "Prefer async retries under latency",
      atomType: "strategy",
      whyHint: "high latency · production",
      botId: "main",
      syncEligible: false,
      shared: false,
      status: "active",
      privacyLevel: "private",
      confidence: 0.8,
    });
    expect(row.scope).toEqual({
      kind: "agent",
      visibility: "private",
      agentId: "main",
    });
    expect(JSON.stringify(row)).not.toMatch(
      /provenance|evidenceRef|workspaceId|embedding|journal|sqlite/i,
    );
  });

  it("parses space and group project ids", () => {
    expect(
      parseMemoryCenterScopeKind({
        workspaceId: "ws",
        projectId: "space:acme",
        agentId: "shared",
        visibility: "shared",
      }),
    ).toEqual({
      kind: "space",
      visibility: "shared",
      spaceId: "acme",
      agentId: "shared",
    });
    expect(
      parseMemoryCenterScopeKind({
        workspaceId: "ws",
        projectId: "chat:agent:main:discord:channel:1",
        agentId: "shared",
        visibility: "shared",
      }),
    ).toEqual({
      kind: "group",
      visibility: "shared",
      groupKey: "agent:main:discord:channel:1",
      agentId: "shared",
    });
  });
});
