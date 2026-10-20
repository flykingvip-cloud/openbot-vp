/**
 * P1-A2 — unique composition root (Floor Runtime v2.1 §5.0 P1-A2 / BP-17 / BP-12).
 */
import { describe, expect, it, vi } from "vitest";
import { operatingStateMatrix, makeOperatingState } from "./__fixtures__/policy-source-matrix.js";
import { MODE_TEMPLATES } from "./effective-policy.js";
import {
  hashEffectiveCollaborationPolicy,
  hashLegacyEffectivePolicySlice,
} from "./policy-compiler-hash.js";
import * as policyCompiler from "./policy-compiler.js";
import {
  compileEffectiveCollaborationPolicy,
  groupPolicyInputFromOperatingState,
} from "./policy-compiler.js";
import { resolveCollaborationPolicyV1 } from "./policy.js";
import {
  compileEffectivePolicyFromScope,
  compileGroupEffectivePolicy,
  groupPolicySourceFromScope,
  legacyOverlayDivergence,
  resolveGroupEffectivePolicy,
  resolveRunContextPolicy,
} from "./resolve-effective-policy.js";
import {
  createRoundPolicySnapshotFromScope,
  resolveEffectivePolicy,
} from "./round-policy-snapshot.js";
import type { CollaborationDispatchScope } from "./types.js";

type State = NonNullable<CollaborationDispatchScope["operatingState"]>;

/** Verbatim pre-P1-A2 learning formula (compileEffectivePolicyFromOperatingState). */
function legacyLearningCompile(operatingState?: State | null) {
  return compileEffectiveCollaborationPolicy(
    groupPolicyInputFromOperatingState({
      collaborationMode: operatingState?.groupProfile.collaborationMode,
      collaborationPolicy: operatingState?.collaborationPolicy ?? null,
      finalDecisionPolicy: operatingState?.governance.finalDecisionPolicy ?? null,
      systemInstructions: undefined,
      coordinatorBotId: operatingState?.governance.coordinatorBotId ?? null,
    }),
  );
}

/** Verbatim pre-P1-A2 dispatch formula (compileEffectivePolicyFromScope). */
function legacyScopeCompile(scope: CollaborationDispatchScope) {
  const profile = scope.groupProfile;
  const os = scope.operatingState;
  return compileEffectiveCollaborationPolicy(
    groupPolicyInputFromOperatingState({
      collaborationMode: profile?.collaborationMode ?? os?.groupProfile.collaborationMode,
      collaborationPolicy: os?.collaborationPolicy ?? null,
      finalDecisionPolicy:
        profile?.finalDecisionPolicy ?? os?.governance.finalDecisionPolicy ?? null,
      systemInstructions: profile?.systemInstructions,
      coordinatorBotId: os?.governance.coordinatorBotId ?? null,
    }),
  );
}

/** Verbatim pre-P1-A2 snapshot / resolveEffectivePolicy formula. */
function legacySnapshotCompile(scope: CollaborationDispatchScope) {
  const profile = scope.groupProfile;
  const os = scope.operatingState;
  return compileEffectiveCollaborationPolicy(
    groupPolicyInputFromOperatingState({
      collaborationMode: profile?.collaborationMode ?? os?.groupProfile.collaborationMode,
      collaborationPolicy: os?.collaborationPolicy ?? null,
      finalDecisionPolicy:
        profile?.finalDecisionPolicy ?? os?.governance.finalDecisionPolicy ?? null,
      systemInstructions: profile?.systemInstructions,
      coordinatorBotId: scope.coordinatorBotId ?? os?.governance.coordinatorBotId ?? null,
    }),
  );
}

function scopeFor(
  operatingState: State | null,
  extras?: Partial<CollaborationDispatchScope>,
): CollaborationDispatchScope {
  return {
    groupId: operatingState?.groupId ?? "grp-none",
    rawSessionKey: "space:grp",
    title: "g",
    bots: [],
    operatingState,
    ...extras,
  };
}

const PROFILE_OVERLAY = {
  groupId: "grp-overlay",
  collaborationMode: "review_driven",
  finalDecisionPolicy: { mode: "delegated_low_risk", allowAgentPublishProposal: false },
  systemInstructions: ["  be brief ", "be brief", "cite sources"],
} as unknown as CollaborationDispatchScope["groupProfile"];

describe("P1-A2 composition root — learning path is byte-identical (BP-17)", () => {
  const matrix = operatingStateMatrix();

  it(`compileGroupEffectivePolicy({ operatingState }) deep-equals the legacy learning compile (${matrix.length} states + null)`, () => {
    for (const state of [...matrix, null]) {
      const next = compileGroupEffectivePolicy({ operatingState: state });
      const legacy = legacyLearningCompile(state);
      expect(next).toStrictEqual(legacy);
      expect(hashEffectiveCollaborationPolicy(next)).toBe(hashEffectiveCollaborationPolicy(legacy));
    }
  });

  it("learning effectivePolicyHash equals resolveGroupEffectivePolicy().policyHash", () => {
    for (const state of matrix.slice(0, 200)) {
      expect(resolveGroupEffectivePolicy({ operatingState: state }).policyHash).toBe(
        hashEffectiveCollaborationPolicy(legacyLearningCompile(state)),
      );
    }
  });

  it("compileGroupEffectivePolicy stays unfrozen (freeze still gated by collaboration.policySnapshot)", () => {
    const effective = compileGroupEffectivePolicy({ operatingState: matrix[0] });
    expect(Object.isFrozen(effective)).toBe(false);
  });
});

describe("P1-A2 composition root — dispatch paths", () => {
  const matrix = operatingStateMatrix().filter((_, i) => i % 7 === 0);

  it("snapshot / resolveEffectivePolicy input is unchanged (deep-equal to pre-P1-A2 formula)", () => {
    for (const state of matrix) {
      for (const extras of [
        {},
        { groupProfile: PROFILE_OVERLAY },
        { coordinatorBotId: "org-coordinator" },
        { groupProfile: PROFILE_OVERLAY, coordinatorBotId: "bot-c" },
      ]) {
        const scope = scopeFor(state, extras);
        const snapshot = createRoundPolicySnapshotFromScope(scope, {
          now: 1,
          idGen: () => "pss_x",
        });
        const legacy = legacySnapshotCompile(scope);
        expect(snapshot.policyHash).toBe(hashEffectiveCollaborationPolicy(legacy));
        expect(resolveEffectivePolicy(scope)).toStrictEqual(legacy);
      }
    }
  });

  it("compileEffectivePolicyFromScope: only governance.coordinatorBotId may change (unconsumed until P1-A5③); all P0 legacy fields identical", () => {
    for (const state of matrix) {
      for (const extras of [
        {},
        { groupProfile: PROFILE_OVERLAY },
        { coordinatorBotId: "org-coordinator" },
      ]) {
        const scope = scopeFor(state, extras);
        const next = compileEffectivePolicyFromScope(scope);
        const legacy = legacyScopeCompile(scope);
        expect(hashLegacyEffectivePolicySlice(next)).toBe(hashLegacyEffectivePolicySlice(legacy));
        const { governance: ng, provenance: np, ...restNext } = next;
        const { governance: lg, provenance: lp, ...restLegacy } = legacy;
        expect(restNext).toStrictEqual(restLegacy);
        expect({ ...ng, coordinatorBotId: null }).toStrictEqual({ ...lg, coordinatorBotId: null });
        expect(next.participation.mentionBotMustRespond).toBe(
          legacy.participation.mentionBotMustRespond,
        );
        void np;
        void lp;
      }
    }
  });

  it("dispatch flag-off and flag-on now agree on policyHash for the same scope (previously split on coordinator overlay)", () => {
    for (const state of matrix) {
      const scope = scopeFor(state, { coordinatorBotId: "org-coordinator" });
      const snapshot = createRoundPolicySnapshotFromScope(scope, { now: 1, idGen: () => "pss_y" });
      expect(hashEffectiveCollaborationPolicy(compileEffectivePolicyFromScope(scope))).toBe(
        snapshot.policyHash,
      );
      expect(hashEffectiveCollaborationPolicy(resolveEffectivePolicy(scope))).toBe(
        snapshot.policyHash,
      );
    }
  });
});

describe("P1-A2 gate — dispatch and learning get the same policyHash for the same group", () => {
  it("no legacy overlay divergence ⇒ identical policyHash across dispatch (snapshot + flag-off) and learning", () => {
    for (const state of operatingStateMatrix().filter((_, i) => i % 5 === 0)) {
      // chat.ts:814-819 resolves the governance coordinator when org/managed sources are empty.
      const scope = scopeFor(state, { coordinatorBotId: state.governance.coordinatorBotId });
      const source = groupPolicySourceFromScope(scope);
      expect(legacyOverlayDivergence(source)).toEqual([]);
      const learningHash = resolveGroupEffectivePolicy({ operatingState: state }).policyHash;
      const dispatchSnapshot = createRoundPolicySnapshotFromScope(scope, {
        now: 1,
        idGen: () => "pss_z",
      });
      expect(dispatchSnapshot.policyHash).toBe(learningHash);
      expect(hashEffectiveCollaborationPolicy(resolveEffectivePolicy(scope))).toBe(learningHash);
      expect(hashEffectiveCollaborationPolicy(compileEffectivePolicyFromScope(scope))).toBe(
        learningHash,
      );
    }
  });

  it("legacyOverlayDivergence names every overlay field that splits dispatch from learning", () => {
    const state = makeOperatingState({ collaborationMode: "task_driven" });
    const scope = scopeFor(state, {
      groupProfile: PROFILE_OVERLAY,
      coordinatorBotId: "org-coordinator",
    });
    const source = groupPolicySourceFromScope(scope);
    expect(legacyOverlayDivergence(source).toSorted()).toEqual(
      [
        "collaborationMode",
        "coordinatorBotId",
        "finalDecisionPolicy",
        "systemInstructions",
      ].toSorted(),
    );
    expect(resolveGroupEffectivePolicy(source).policyHash).not.toBe(
      resolveGroupEffectivePolicy({ operatingState: state }).policyHash,
    );
    // Overlay equal to persisted values is not divergence.
    const aligned = scopeFor(state, {
      groupProfile: { groupId: "g", collaborationMode: "task_driven" } as never,
      coordinatorBotId: "bot-c",
    });
    expect(legacyOverlayDivergence(groupPolicySourceFromScope(aligned))).toEqual([]);
  });
});

describe("P1-A2 resolveGroupEffectivePolicy — frozen identity", () => {
  it("compiles exactly once, deep-freezes a clone, never freezes module constants", () => {
    const spy = vi.spyOn(policyCompiler, "compileEffectiveCollaborationPolicy");
    const resolved = resolveGroupEffectivePolicy({ operatingState: makeOperatingState() });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    expect(Object.isFrozen(resolved.effective)).toBe(true);
    expect(Object.isFrozen(resolved.effective.participation)).toBe(true);
    expect(Object.isFrozen(resolved.input)).toBe(true);
    expect(Object.isFrozen(MODE_TEMPLATES)).toBe(false);
    expect(Object.isFrozen(MODE_TEMPLATES.discussion_driven)).toBe(false);
    expect(resolved.policyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(resolved.provenanceHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("P1-A2 get-reply-run Context Scope policy (BP-12 contextPolicy half)", () => {
  for (const forDirectSession of [false, true]) {
    it(`resolveRunContextPolicy({ forDirectSession: ${forDirectSession} }) is value- and byte-identical to PolicyV1`, () => {
      const legacy = resolveCollaborationPolicyV1({ forDirectSession }).contextPolicy;
      const next = resolveRunContextPolicy({ forDirectSession });
      expect(next).toStrictEqual(legacy);
      expect(JSON.stringify(next)).toBe(JSON.stringify(legacy));
    });
  }
});
