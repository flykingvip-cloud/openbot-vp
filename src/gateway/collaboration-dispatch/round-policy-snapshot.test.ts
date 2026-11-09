import { describe, expect, it } from "vitest";
import { MODE_TEMPLATES, OBSERVER_PERMISSIONS, SYSTEM_INVARIANTS } from "./effective-policy.js";
import { hashEffectiveCollaborationPolicy } from "./policy-compiler-hash.js";
import { compileEffectiveCollaborationPolicy } from "./policy-compiler.js";
import {
  createRoundPolicySnapshot,
  deepFreeze,
  generatePolicySnapshotId,
  hashProvenanceAndClamps,
  POLICY_COMPILER_REVISION,
} from "./round-policy-snapshot.js";

describe("round-policy-snapshot (P0.0b)", () => {
  it("deep-freezes recursively so in-place mutation throws", () => {
    const snap = createRoundPolicySnapshot(
      { maxVisibleBotRepliesPerRound: 4 },
      { now: 1_700_000_000_000, idGen: () => "pss_test_1" },
    );
    expect(Object.isFrozen(snap.effective)).toBe(true);
    expect(Object.isFrozen(snap.effective.participation)).toBe(true);
    expect(Object.isFrozen(snap.effective.provenance)).toBe(true);
    expect(() => {
      (
        snap.effective.participation as { maxVisibleBotRepliesPerRound: number }
      ).maxVisibleBotRepliesPerRound = 1;
    }).toThrow(TypeError);
  });

  it("does not freeze MODE_TEMPLATES / SYSTEM_INVARIANTS / OBSERVER_PERMISSIONS module constants", () => {
    const beforeMode = Object.isFrozen(MODE_TEMPLATES.discussion_driven);
    const beforeInv = Object.isFrozen(SYSTEM_INVARIANTS);
    const beforeObs = Object.isFrozen(OBSERVER_PERMISSIONS);
    createRoundPolicySnapshot({}, { now: 1, idGen: () => "pss_x" });
    expect(Object.isFrozen(MODE_TEMPLATES.discussion_driven)).toBe(beforeMode);
    expect(Object.isFrozen(SYSTEM_INVARIANTS)).toBe(beforeInv);
    expect(Object.isFrozen(OBSERVER_PERMISSIONS)).toBe(beforeObs);
    // And deepFreeze of a clone must not reach the originals.
    const clone = structuredClone(MODE_TEMPLATES.discussion_driven);
    deepFreeze(clone);
    expect(Object.isFrozen(MODE_TEMPLATES.discussion_driven)).toBe(beforeMode);
  });

  it("policySnapshotId is unique per create; policyHash is content-stable", () => {
    const a = createRoundPolicySnapshot(
      { maxVisibleBotRepliesPerRound: 5 },
      { now: 10, idGen: () => generatePolicySnapshotId(10) },
    );
    const b = createRoundPolicySnapshot(
      { maxVisibleBotRepliesPerRound: 5 },
      { now: 11, idGen: () => generatePolicySnapshotId(11) },
    );
    const c = createRoundPolicySnapshot(
      { maxVisibleBotRepliesPerRound: 8 },
      { now: 12, idGen: () => generatePolicySnapshotId(12) },
    );
    expect(a.policySnapshotId).not.toBe(b.policySnapshotId);
    expect(a.policyHash).toBe(b.policyHash);
    expect(a.policyHash).not.toBe(c.policyHash);
    expect(a.policySnapshotId.startsWith("pss_")).toBe(true);
  });

  it("policyHash matches hashEffectiveCollaborationPolicy and excludes compilerRevision", () => {
    const input = { maxVisibleBotRepliesPerRound: 6, mentionBotMustRespond: true };
    const snap = createRoundPolicySnapshot(input, { now: 1, idGen: () => "pss_h" });
    const compiled = compileEffectiveCollaborationPolicy(input);
    expect(snap.policyHash).toBe(hashEffectiveCollaborationPolicy(compiled));
    expect(snap.compilerRevision).toBe(POLICY_COMPILER_REVISION);
    expect(snap.provenanceHash).toBe(
      hashProvenanceAndClamps({
        provenance: compiled.provenance,
        clamps: compiled.clamps,
      }),
    );
  });

  it("G0-1: SYSTEM_INVARIANTS / protocol version stay at 1.1; Owner-selected L1 defaults are revisioned", () => {
    expect(SYSTEM_INVARIANTS.protocolVersion).toBe("1.1");
    const empty = compileEffectiveCollaborationPolicy({});
    expect(empty.protocolVersion).toBe("1.1");
    expect(empty.participation.maxVisibleBotRepliesPerRound).toBe(3);
    expect(empty.participation.openDiscussionWithoutMention).toBe(true);
    expect(empty.participation.mentionBotMustRespond).toBe(false);
    expect(empty.dispatch.supplementEnabled).toBe(true);
    expect(empty.governance.botMaySelfAdvanceWithoutHuman).toBe(false);
    expect(empty.strategy).toEqual(MODE_TEMPLATES.discussion_driven);
  });
});
