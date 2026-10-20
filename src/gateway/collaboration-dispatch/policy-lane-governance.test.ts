/**
 * P1-A5 ③ — governance lane helper (Floor Runtime v2.1 §5.5;
 * BP-15/16 coordinator, BP-17 policyHash overlay, B8 actor fail-closed).
 */
import { afterEach, describe, expect, it } from "vitest";
import type { GatewayCollaborationGroupOperatingState } from "../collaboration-learning.js";
import { classifyGovernanceActor } from "./governance-gate.js";
import { hashEffectiveCollaborationPolicy } from "./policy-compiler-hash.js";
import { drainPolicyLaneDivergences, peekPolicyLaneDivergences } from "./policy-lane-divergence.js";
import {
  classifyGovernanceActorFailClosed,
  legacyCoordinatorFromCandidates,
  legacyStandingCoordinatorBotId,
  resolveActorFailClosed,
  resolveEdgeIsolation,
  resolveGovernanceLaneActor,
  resolveGovernanceLaneCoordinatorBotId,
  resolveGovernanceLaneMode,
  observeGovernanceLanePolicyHashDivergence,
  resolveGovernanceLanePolicyHash,
} from "./policy-lane-governance.js";
import { compileGroupEffectivePolicy } from "./resolve-effective-policy.js";

afterEach(() => {
  drainPolicyLaneDivergences();
});

function osWithCoordinator(
  coordinatorBotId: string | null,
): GatewayCollaborationGroupOperatingState {
  return {
    governance: {
      adminUserIds: [],
      coordinatorBotId,
      finalDecisionPolicy: null,
    },
    groupProfile: {
      displayName: "t",
      purpose: null,
      currentMission: null,
      expectedOutputs: [],
      successCriteria: [],
      collaborationMode: "discussion_driven",
    },
  } as unknown as GatewayCollaborationGroupOperatingState;
}

describe("P1-A5 ③ governance lane mode + gates", () => {
  it("defaults to legacy when unset / invalid (flag off)", () => {
    expect(resolveGovernanceLaneMode({} as never)).toBe("legacy");
    expect(resolveGovernanceLaneMode({ collaboration: {} } as never)).toBe("legacy");
    expect(
      resolveGovernanceLaneMode({
        collaboration: { lane: { dispatch: "effective" } },
      } as never),
    ).toBe("legacy");
    expect(
      resolveGovernanceLaneMode({
        collaboration: { lane: { governance: "bogus" } },
      } as never),
    ).toBe("legacy");
    expect(
      resolveGovernanceLaneMode({
        collaboration: { lane: { governance: "shadow" } },
      } as never),
    ).toBe("shadow");
    expect(
      resolveGovernanceLaneMode({
        collaboration: { lane: { governance: "effective" } },
      } as never),
    ).toBe("effective");
  });

  it("actorFailClosed / edge.isolation default false", () => {
    expect(resolveActorFailClosed({} as never)).toBe(false);
    expect(resolveActorFailClosed({ collaboration: { governance: {} } } as never)).toBe(false);
    expect(
      resolveActorFailClosed({
        collaboration: { governance: { actorFailClosed: true } },
      } as never),
    ).toBe(true);
    expect(resolveEdgeIsolation({} as never)).toBe(false);
    expect(resolveEdgeIsolation({ collaboration: { edge: { isolation: true } } } as never)).toBe(
      true,
    );
  });
});

describe("P1-A5 ③ resolveGovernanceLaneCoordinatorBotId (BP-15/16)", () => {
  it("legacy: 4-source order org → managedSpace → governance → groupProfile (byte-equal)", () => {
    expect(
      legacyStandingCoordinatorBotId({
        runtimeOrganizationCoordinatorAgentId: "org-c",
        managedSpaceCoordinatorBotId: "space-c",
        operatingStateCoordinatorBotId: "gov-c",
        groupProfileCoordinatorBotId: "profile-c",
      }),
    ).toBe("org-c");
    expect(
      legacyStandingCoordinatorBotId({
        runtimeOrganizationCoordinatorAgentId: null,
        managedSpaceCoordinatorBotId: "space-c",
        operatingStateCoordinatorBotId: "gov-c",
        groupProfileCoordinatorBotId: "profile-c",
      }),
    ).toBe("space-c");
    expect(
      legacyStandingCoordinatorBotId({
        runtimeOrganizationCoordinatorAgentId: "  ",
        managedSpaceCoordinatorBotId: null,
        operatingStateCoordinatorBotId: "gov-c",
        groupProfileCoordinatorBotId: "profile-c",
      }),
    ).toBe("gov-c");
    expect(
      legacyStandingCoordinatorBotId({
        groupProfileCoordinatorBotId: "profile-c",
      }),
    ).toBe("profile-c");
  });

  it("legacy: candidates list first non-steward (BP-16 pre-lane)", () => {
    expect(legacyCoordinatorFromCandidates(["bot-a", "bot-b"])).toBe("bot-a");
    expect(legacyCoordinatorFromCandidates([])).toBe("");
  });

  it("legacy≡shadow equivalence when OS governance matches 4-source winner — no divergence", () => {
    const os = osWithCoordinator("bot-c");
    const effective = compileGroupEffectivePolicy({
      operatingState: os,
      legacyOverlay: { coordinatorBotId: "bot-c" },
    });
    const legacy = resolveGovernanceLaneCoordinatorBotId({
      operatingState: os,
      groupProfile: { coordinatorBotId: "bot-c" },
      effective,
      mode: "legacy",
    });
    const shadow = resolveGovernanceLaneCoordinatorBotId({
      operatingState: os,
      groupProfile: { coordinatorBotId: "bot-c" },
      effective,
      mode: "shadow",
    });
    expect(shadow.coordinatorBotId).toBe(legacy.coordinatorBotId);
    expect(shadow.coordinatorBotId).toBe("bot-c");
    expect(shadow.divergences).toEqual([]);
  });

  it("shadow: records lane=governance divergence when 4-source ≠ effective.governance", () => {
    const os = osWithCoordinator(null);
    const effective = compileGroupEffectivePolicy({ operatingState: os });
    const resolved = resolveGovernanceLaneCoordinatorBotId({
      runtimeOrganizationContext: { coordinator: { agentId: "org-only" } },
      operatingState: os,
      effective,
      mode: "shadow",
    });
    expect(resolved.coordinatorBotId).toBe("org-only"); // serves legacy
    expect(resolved.divergences).toHaveLength(1);
    expect(resolved.divergences[0]?.lane).toBe("governance");
    expect(resolved.divergences[0]?.field).toBe("coordinatorBotId");
    expect(peekPolicyLaneDivergences()).toHaveLength(1);
  });

  it("effective: serves effective.governance.coordinatorBotId only", () => {
    const os = osWithCoordinator("gov-c");
    const effective = compileGroupEffectivePolicy({ operatingState: os });
    const resolved = resolveGovernanceLaneCoordinatorBotId({
      runtimeOrganizationContext: { coordinator: { agentId: "org-only" } },
      operatingState: os,
      effective,
      mode: "effective",
    });
    expect(resolved.coordinatorBotId).toBe("gov-c");
  });

  it("exhaustive 2^4 presence matrix for 4-source first-match (non-steward)", () => {
    const ids = ["a", "b", "c", "d"] as const;
    for (let mask = 0; mask < 16; mask++) {
      const sources = {
        runtimeOrganizationCoordinatorAgentId: mask & 1 ? ids[0] : null,
        managedSpaceCoordinatorBotId: mask & 2 ? ids[1] : null,
        operatingStateCoordinatorBotId: mask & 4 ? ids[2] : null,
        groupProfileCoordinatorBotId: mask & 8 ? ids[3] : null,
      };
      const got = legacyStandingCoordinatorBotId(sources);
      const expected = mask & 1 ? "a" : mask & 2 ? "b" : mask & 4 ? "c" : mask & 8 ? "d" : "";
      expect(got).toBe(expected);
    }
  });
});

describe("P1-A5 ③ resolveGovernanceLaneActor (B8)", () => {
  it("legacy: byte-equal to classifyGovernanceActor (fail-open empty→human)", () => {
    expect(classifyGovernanceActor("")).toEqual({ type: "human", id: "" });
    expect(resolveGovernanceLaneActor({ actorId: "", mode: "legacy" }).actor).toEqual({
      type: "human",
      id: "",
    });
  });

  it("fail-closed: empty → observer", () => {
    expect(classifyGovernanceActorFailClosed("")).toEqual({
      type: "human",
      id: "",
      governanceRole: "observer",
    });
  });

  it("shadow: records actorClassification divergence for empty id", () => {
    const resolved = resolveGovernanceLaneActor({ actorId: "", mode: "shadow" });
    expect(resolved.actor).toEqual({ type: "human", id: "" }); // still serves legacy
    expect(resolved.divergences).toHaveLength(1);
    expect(resolved.divergences[0]?.field).toBe("actorClassification");
  });

  it("effective + actorFailClosed=true: serves fail-closed", () => {
    const resolved = resolveGovernanceLaneActor({
      actorId: "",
      mode: "effective",
      cfg: { collaboration: { governance: { actorFailClosed: true } } } as never,
    });
    expect(resolved.actor.governanceRole).toBe("observer");
  });
});

describe("P1-A5 ③ resolveGovernanceLanePolicyHash (BP-17)", () => {
  it("legacy: pure no-op — empty hashes, no divergence (no compile)", () => {
    const os = osWithCoordinator("bot-c");
    const before = peekPolicyLaneDivergences().length;
    const resolved = resolveGovernanceLanePolicyHash({
      operatingState: os,
      legacyOverlay: { coordinatorBotId: "other" },
      mode: "legacy",
    });
    expect(resolved.policyHash).toBe("");
    expect(resolved.learningPolicyHash).toBe("");
    expect(resolved.divergences).toEqual([]);
    expect(peekPolicyLaneDivergences().length).toBe(before);
  });

  it("legacy with served hashes: returns them unchanged, still no sink write", () => {
    const resolved = resolveGovernanceLanePolicyHash({
      operatingState: osWithCoordinator(null),
      legacyOverlay: { coordinatorBotId: "org" },
      servedDispatchPolicyHash: "dispatch-hash",
      servedLearningPolicyHash: "learn-hash",
      mode: "legacy",
    });
    expect(resolved.policyHash).toBe("dispatch-hash");
    expect(resolved.learningPolicyHash).toBe("learn-hash");
    expect(resolved.divergences).toEqual([]);
  });

  it("shadow: records policyHash divergence when overlay coordinator differs from OS", () => {
    const os = osWithCoordinator(null);
    const resolved = resolveGovernanceLanePolicyHash({
      operatingState: os,
      legacyOverlay: { coordinatorBotId: "org-overlay" },
      mode: "shadow",
    });
    expect(resolved.policyHash).not.toBe(resolved.learningPolicyHash);
    expect(resolved.divergences).toHaveLength(1);
    expect(resolved.divergences[0]?.field).toBe("policyHash");
    expect(resolved.divergences[0]?.lane).toBe("governance");
  });

  it("effective: serves learning (OS-only) policyHash", () => {
    const os = osWithCoordinator(null);
    const resolved = resolveGovernanceLanePolicyHash({
      operatingState: os,
      legacyOverlay: { coordinatorBotId: "org-overlay" },
      mode: "effective",
    });
    const learning = hashEffectiveCollaborationPolicy(
      compileGroupEffectivePolicy({ operatingState: os }),
    );
    expect(resolved.policyHash).toBe(learning);
  });
});

describe("P1-A5 final observeGovernanceLanePolicyHashDivergence", () => {
  it("legacy (default): no-op — no sink write", () => {
    const before = peekPolicyLaneDivergences().length;
    observeGovernanceLanePolicyHashDivergence({
      operatingState: osWithCoordinator(null),
      legacyOverlay: { coordinatorBotId: "org-overlay" },
      cfg: {} as never,
    });
    expect(peekPolicyLaneDivergences().length).toBe(before);
  });

  it("shadow: records policyHash divergence when overlay differs from OS", () => {
    const before = peekPolicyLaneDivergences().length;
    observeGovernanceLanePolicyHashDivergence({
      operatingState: osWithCoordinator(null),
      legacyOverlay: { coordinatorBotId: "org-overlay" },
      cfg: { collaboration: { lane: { governance: "shadow" } } } as never,
    });
    const after = peekPolicyLaneDivergences();
    expect(after.length).toBeGreaterThan(before);
    expect(after.some((d) => d.field === "policyHash" && d.lane === "governance")).toBe(true);
  });
});
