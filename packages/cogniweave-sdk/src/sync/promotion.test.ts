import { describe, expect, it } from "vitest";
import { withAtomV2Defaults } from "../domain/atom-v2.js";
import type { MemoryAtom, Scope } from "../models.js";
import { grantPromotionConsent, revokePromotionConsent } from "./consent.js";
import { decidePromotion } from "./promotion-decision.js";
import { assertPromotionEnvelopeHygiene, buildPromotionEnvelope } from "./promotion-envelope.js";
import { DEFAULT_PROMOTION_POLICY, resolvePromotionPolicy } from "./promotion-policy.js";

const scope: Scope = {
  workspaceId: "ws_p5",
  projectId: "proj_p5",
  agentId: "agent_main",
  visibility: "private",
};

function makeAtom(overrides?: Partial<MemoryAtom>): MemoryAtom {
  return withAtomV2Defaults({
    id: "atm_p5_1",
    atomType: "strategy",
    scope,
    claim: { type: "causal", statement: "prefer async buffering under load" },
    trigger: { conditions: ["high_latency"], contextTags: ["ops"] },
    applicability: { include: [], exclude: [] },
    provenance: {
      sourceEventIds: ["evt_1"],
      evidenceRefs: ["ev_secret_snippet"],
    },
    versioning: { version: 1 },
    state: { status: "active", conflictsWith: [] },
    metrics: { confidence: 0.9, reuseCount: 1 },
    ...overrides,
  });
}

describe("CW2-P5-01 promotion + consent", () => {
  it("never auto-promotes private atoms without consent", () => {
    const atom = makeAtom();
    expect(atom.privacy?.privacyLevel).toBe("private");
    const decision = decidePromotion(atom);
    expect(decision.decision).toBe("blocked");
    expect(decision.envelope).toBeUndefined();
  });

  it("requires consent even for allowlist shared atoms", () => {
    const atom = makeAtom({
      privacy: {
        privacyLevel: "shared",
        syncEligibility: "eligible",
        consentRequired: true,
      },
    });
    const decision = decidePromotion(atom);
    expect(decision.decision).toBe("needs_consent");
    expect(decision.envelope).toBeUndefined();
  });

  it("grantPromotionConsent then decidePromotion → ready with envelope", () => {
    const granted = grantPromotionConsent(makeAtom(), { privacyLevel: "shared" });
    expect(granted.atom.privacy?.syncEligibility).toBe("promoted");
    expect(granted.outboxIntent).toBe("push");
    const decision = decidePromotion(granted.atom);
    expect(decision.decision).toBe("ready");
    expect(decision.envelope?.atomId).toBe("atm_p5_1");
    expect(assertPromotionEnvelopeHygiene(decision.envelope)).toEqual([]);
  });

  it("revokePromotionConsent blocks sync and signals delete tombstone", () => {
    const granted = grantPromotionConsent(makeAtom());
    const revoked = revokePromotionConsent(granted.atom);
    expect(revoked.atom.privacy?.syncEligibility).toBe("blocked");
    expect(revoked.atom.privacy?.consentRequired).toBe(true);
    expect(revoked.outboxIntent).toBe("delete_tombstone");
    const decision = decidePromotion(revoked.atom, { consentRevoked: true });
    expect(decision.decision).toBe("revoked");
  });

  it("builds envelopes without denylisted raw source content", () => {
    const atom = makeAtom({
      action: "run shell with secrets",
      tenantId: "t_evil",
    } as MemoryAtom & { action: string; tenantId: string });
    const envelope = buildPromotionEnvelope(atom);
    expect(assertPromotionEnvelopeHygiene(envelope)).toEqual([]);
    expect(envelope.provenance).toEqual({ sourceEventIdCount: 1 });
    expect(envelope.trigger.conditionCount).toBe(1);
    expect("conditions" in envelope.trigger).toBe(false);
    expect(JSON.stringify(envelope)).not.toContain("ev_secret_snippet");
    expect(JSON.stringify(envelope)).not.toContain("run shell");
    expect(JSON.stringify(envelope)).not.toContain("t_evil");
  });

  it("enterprise tighten only shrinks allowlist / raises score floor", () => {
    const tightened = resolvePromotionPolicy({
      ...DEFAULT_PROMOTION_POLICY,
      tighten: (base) => ({
        ...base,
        autoPromoteAtomTypes: ["strategy", "preference", "failure_pattern"],
        autoPromoteMinScore: 0.2,
      }),
    });
    expect(tightened.autoPromoteAtomTypes).toEqual(["strategy", "failure_pattern"]);
    expect(tightened.autoPromoteMinScore).toBe(0.55);

    const stricter = resolvePromotionPolicy({
      ...DEFAULT_PROMOTION_POLICY,
      tighten: (base) => ({
        ...base,
        autoPromoteAtomTypes: ["strategy"],
        autoPromoteMinScore: 0.8,
      }),
    });
    expect(stricter.autoPromoteAtomTypes).toEqual(["strategy"]);
    expect(stricter.autoPromoteMinScore).toBe(0.8);
  });
});
