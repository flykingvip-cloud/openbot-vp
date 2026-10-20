import { describe, expect, it } from "vitest";
import type { MemoryAtom, Scope } from "../models.js";
import {
  ATOM_IDENTITY_BOUNDARY_KEYS,
  attachSeparatedScores,
  computeDualSourceCoverage,
  hasAtomIdentityBoundaryViolation,
  resolveAtomTypePolicy,
  scoreAdmission,
  scorePromotion,
  scoreRetrieval,
  withAtomV2Defaults,
} from "./atom-v2.js";

const scope: Scope = {
  workspaceId: "ws_p2",
  projectId: "proj_p2",
  agentId: "agent_main",
  visibility: "private",
};

function baseAtom(overrides?: Partial<MemoryAtom>): MemoryAtom {
  return {
    id: "atm_p2_1",
    atomType: "strategy",
    scope,
    claim: { type: "causal", statement: "prefer async buffering" },
    trigger: { conditions: ["high_latency"], contextTags: ["mitigation"] },
    applicability: { include: [], exclude: [] },
    provenance: { sourceEventIds: ["evt_1"], evidenceRefs: ["ev_1", "ev_2"] },
    versioning: { version: 1 },
    state: { status: "active", conflictsWith: [] },
    metrics: { confidence: 0.8, reuseCount: 2 },
    ...overrides,
  };
}

describe("CW2-P2 atom domain v2", () => {
  it("applies additive privacy/lifecycle defaults without breaking legacy atoms", () => {
    const legacy = baseAtom();
    expect(legacy.privacy).toBeUndefined();
    const next = withAtomV2Defaults(legacy);
    expect(next.privacy).toEqual({
      privacyLevel: "private",
      syncEligibility: "eligible",
      consentRequired: false,
    });
    expect(next.lifecycle?.retentionClass).toBe("durable");
    expect(next.governance?.scoreVersion).toBe(1);
    // Core fields unchanged.
    expect(next.claim.statement).toBe(legacy.claim.statement);
    expect(next.metrics.confidence).toBe(0.8);
  });

  it("preserves explicit privacy overrides", () => {
    const next = withAtomV2Defaults(
      baseAtom({
        privacy: { privacyLevel: "shared", syncEligibility: "promoted", consentRequired: true },
      }),
    );
    expect(next.privacy?.privacyLevel).toBe("shared");
    expect(next.privacy?.syncEligibility).toBe("promoted");
    expect(next.privacy?.consentRequired).toBe(true);
  });

  it("enforces identity boundary by stripping forbidden keys", () => {
    const polluted = {
      ...baseAtom(),
      tenantId: "t_evil",
      seatId: "seat_evil",
      agentProfile: { name: "nope" },
    } as MemoryAtom & Record<string, unknown>;
    expect(hasAtomIdentityBoundaryViolation(polluted).sort()).toEqual(
      ["agentProfile", "seatId", "tenantId"].sort(),
    );
    const cleaned = withAtomV2Defaults(polluted) as MemoryAtom & Record<string, unknown>;
    for (const key of ATOM_IDENTITY_BOUNDARY_KEYS) {
      expect(cleaned[key]).toBeUndefined();
    }
  });

  it("keeps admission/retrieval/promotion scores on independent paths", () => {
    const privateAtom = withAtomV2Defaults(
      baseAtom({
        privacy: { privacyLevel: "private", syncEligibility: "eligible" },
      }),
    );
    const admission = scoreAdmission(privateAtom);
    const retrieval = scoreRetrieval(privateAtom, {
      requiredAtomTypes: ["strategy"],
      queryTags: ["mitigation"],
    });
    const promotion = scorePromotion(privateAtom);
    expect(admission).toBeGreaterThan(0.5);
    expect(retrieval).toBeGreaterThan(0.5);
    // Private atoms never promote even if type policy says eligible.
    expect(promotion).toBe(0);

    const scored = attachSeparatedScores(privateAtom, {
      requiredAtomTypes: ["strategy"],
      queryTags: ["mitigation"],
    });
    expect(scored.governance?.admissionScore).toBe(admission);
    expect(scored.governance?.retrievalScore).toBe(retrieval);
    expect(scored.governance?.promotionScore).toBe(0);
    // Mutating one channel input does not force the others equal.
    expect(scored.governance?.admissionScore).not.toBe(scored.governance?.promotionScore);
  });

  it("resolves atom type policies and dual-source coverage metric", () => {
    expect(resolveAtomTypePolicy("anti_pattern").confirmationRequired).toBe(true);
    expect(resolveAtomTypePolicy("unknown_type").atomType).toBe("unknown_type");
    const coverage = computeDualSourceCoverage([
      { sourceBindingId: "sb_a", unlinkedAt: undefined },
      { sourceBindingId: "sb_b", unlinkedAt: undefined },
      { sourceBindingId: "sb_a", unlinkedAt: "2026-07-19T00:00:00.000Z" },
    ]);
    expect(coverage).toEqual({
      metricVersion: 1,
      sourceBindingCount: 2,
      liveSourceCount: 1,
      coverageRatio: 0.5,
    });
  });
});
