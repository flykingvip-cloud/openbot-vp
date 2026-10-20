import { describe, expect, it } from "vitest";
import { evaluateSotConsistency, type SotConsistencyInput } from "./sot-consistency.js";

// Real seq51 LIVE at the time this gate was written.
const LIVE = "59be50660d8ebacf867211a206c92b4300bec418";
const OTHER = "76fea1fb0669357fa7ed8c4c882bc4588b614cab";

/** A fully consistent, anchored production LIVE (the happy path). */
function anchored(overrides: Partial<SotConsistencyInput> = {}): SotConsistencyInput {
  return {
    liveSha: LIVE,
    releaseRecordSha: LIVE,
    ledgerOpenShas: [LIVE],
    resolveProvenanceTag: (sha) => (sha.toLowerCase() === LIVE ? LIVE : null),
    trunkContainsLive: (sha) => sha.toLowerCase() === LIVE,
    ...overrides,
  };
}

describe("evaluateSotConsistency", () => {
  it("allows a real, anchored LIVE (seq51) — ledger, tag, RELEASE_RECORD, trunk all agree", () => {
    const decision = evaluateSotConsistency(anchored());
    expect(decision.verdict).toBe("allow");
    expect(decision.live).toBe(LIVE);
    expect(decision.ledgerLive).toBe(LIVE);
    expect(decision.recommendation).toBeNull();
  });

  it("does not depend on the frozen baseline-recovery branch (its lag is not a failure)", () => {
    // The input surface has no baseline-recovery ref at all; a fully anchored LIVE still passes.
    // This is the regression guard against the old semantics that required the frozen branch
    // to contain LIVE (permanently impossible).
    const decision = evaluateSotConsistency(anchored());
    expect(decision.verdict).toBe("allow");
    expect(Object.keys(decision)).not.toContain("baselineRecovery");
  });

  it("blocks a tampered ledger SHA (open row != running LIVE, and no tag for the fake SHA)", () => {
    const decision = evaluateSotConsistency(
      anchored({
        ledgerOpenShas: [OTHER],
        // The tampered row has no matching provenance tag.
        resolveProvenanceTag: (sha) => (sha.toLowerCase() === LIVE ? LIVE : null),
        trunkContainsLive: () => true,
      }),
    );
    expect(decision.verdict).toBe("block");
    expect(decision.reasons.join(" ")).toMatch(/LIVE .* != ledger open row/i);
  });

  it("blocks when the open LIVE row has no provenance tag", () => {
    const decision = evaluateSotConsistency(anchored({ resolveProvenanceTag: () => null }));
    expect(decision.verdict).toBe("block");
    expect(decision.reasons.join(" ")).toMatch(/missing provenance tag/i);
  });

  it("blocks when the provenance tag resolves to a different commit", () => {
    const decision = evaluateSotConsistency(anchored({ resolveProvenanceTag: () => OTHER }));
    expect(decision.verdict).toBe("block");
    expect(decision.reasons.join(" ")).toMatch(/provenance tag .* resolves to/i);
  });

  it("blocks when the running LIVE revision differs from the ledger row", () => {
    const decision = evaluateSotConsistency(anchored({ liveSha: OTHER }));
    expect(decision.verdict).toBe("block");
    expect(decision.reasons.join(" ")).toMatch(/LIVE\/ledger drift|!= ledger open row/i);
  });

  it("blocks when RELEASE_RECORD disagrees with the ledger open row", () => {
    const decision = evaluateSotConsistency(anchored({ releaseRecordSha: OTHER }));
    expect(decision.verdict).toBe("block");
    expect(decision.reasons.join(" ")).toMatch(/RELEASE_RECORD/i);
  });

  it("blocks when LIVE is not contained in the trunk (off-trunk production code)", () => {
    const decision = evaluateSotConsistency(anchored({ trunkContainsLive: () => false }));
    expect(decision.verdict).toBe("block");
    expect(decision.reasons.join(" ")).toMatch(/not contained in origin\/main/i);
  });

  it("blocks when there is no open LIVE row", () => {
    const decision = evaluateSotConsistency(anchored({ ledgerOpenShas: [] }));
    expect(decision.verdict).toBe("block");
    expect(decision.reasons.join(" ")).toMatch(/no open LIVE row/i);
  });

  it("blocks when the ledger has more than one open LIVE row (ambiguous)", () => {
    const decision = evaluateSotConsistency(anchored({ ledgerOpenShas: [LIVE, OTHER] }));
    expect(decision.verdict).toBe("block");
    expect(decision.reasons.join(" ")).toMatch(/open LIVE rows/i);
  });

  it("returns unknown (fail closed) when LIVE cannot be resolved", () => {
    const decision = evaluateSotConsistency(anchored({ liveSha: null }));
    expect(decision.verdict).toBe("unknown");
    expect(decision.live).toBeNull();
  });

  it("is case-insensitive about SHA hex casing", () => {
    const decision = evaluateSotConsistency(
      anchored({
        liveSha: LIVE.toUpperCase(),
        ledgerOpenShas: [LIVE.toUpperCase()],
        releaseRecordSha: LIVE.toUpperCase(),
      }),
    );
    expect(decision.verdict).toBe("allow");
  });
});
