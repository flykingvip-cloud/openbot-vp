import { expect, it } from "vitest";
import { RUNTIME_RULE_ADAPTATION_MAX_INPUT_DEPTH } from "../../contracts/rule-adaptation.js";
import { validateRuntimeRuleProposal } from "./validate.js";
import {
  assertSameStableDecision,
  codesOf,
  deepFreeze,
  legalGroupHost,
  legalGroupProposal,
  legalPersonalCandidate,
  legalPersonalCandidateHost,
  legalPersonalHost,
  legalPersonalProposal,
  snapshot,
} from "./validate.test-support.js";

it("accepts JSON 24000.0 and 2.4e4 after ordinary JSON.parse as safe integers", () => {
  const fromDotZero = JSON.parse('{"proposedValue": 24000.0}') as { proposedValue: number };
  const fromExp = JSON.parse('{"proposedValue": 2.4e4}') as { proposedValue: number };
  expect(fromDotZero.proposedValue).toBe(24000);
  expect(fromExp.proposedValue).toBe(24000);
  expect(Number.isSafeInteger(fromDotZero.proposedValue)).toBe(true);
  const host = legalPersonalHost();
  for (const parsed of [fromDotZero, fromExp]) {
    const proposal = legalPersonalProposal({
      items: [
        {
          ruleId: "model.context_window.guard",
          field: "agents.defaults.contextTokens",
          action: "tune",
          proposedValue: parsed.proposedValue,
        },
      ],
    });
    const result = validateRuntimeRuleProposal(proposal, host);
    expect(result.resultKind).toBe("shadow_accepted");
    expect(codesOf(result.reasons)).toEqual(["shadow_legal"]);
    expect(result.activationAllowed).toBe(false);
  }
});

it("rejects non-integers, string numbers, non-finite programmatic values, and unsafe range", () => {
  const host = legalPersonalHost();
  const cases: unknown[] = [
    24000.5,
    "24000",
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
    Number.MIN_SAFE_INTEGER - 1,
  ];
  for (const proposedValue of cases) {
    const proposal = legalPersonalProposal({
      items: [
        {
          ruleId: "model.context_window.guard",
          field: "agents.defaults.contextTokens",
          action: "tune",
          proposedValue,
        },
      ],
    });
    const result = validateRuntimeRuleProposal(proposal, host);
    expect(result.resultKind, String(proposedValue)).toBe("blocked");
    expect(codesOf(result.reasons), String(proposedValue)).toContain("structural_invalid_type");
    expect(result.activationAllowed).toBe(false);
  }
});

it("rejects an empty items array as a structural type error", () => {
  const result = validateRuntimeRuleProposal(
    legalPersonalProposal({ items: [] }),
    legalPersonalHost(),
  );
  expect(result.resultKind).toBe("blocked");
  expect(codesOf(result.reasons)).toContain("structural_invalid_type");
  expect(result.reasons.some((entry) => entry.path === "proposal.items")).toBe(true);
});

it("rejects a blank host identity as an unusable host value", () => {
  const host = legalPersonalHost({
    identity: {
      principalType: "personal",
      principalId: "   ",
      scope: { type: "personal", id: "agent:fixture-personal-1" },
    },
  });
  const result = validateRuntimeRuleProposal(legalPersonalProposal(), host);
  expect(result.resultKind).toBe("blocked");
  expect(codesOf(result.reasons)).toContain("structural_unusable_host_value");
  expect(result.reasons.some((entry) => entry.path === "host.identity.principalId")).toBe(true);
});

it("rejects a rule and field pairing that is not an approved shadow candidate", () => {
  const proposal = legalPersonalProposal({
    items: [
      {
        ruleId: "model.context_window.guard",
        field: "maxVisibleBotRepliesPerRound",
        action: "tune",
        proposedValue: 2,
      },
    ],
  });
  const result = validateRuntimeRuleProposal(proposal, legalPersonalHost());
  expect(result.resultKind).toBe("blocked");
  expect(codesOf(result.reasons)).toContain("non_candidate_field");
});

it("rejects a compatibility record bound to a different implementation version", () => {
  const host = legalPersonalHost({
    compatibilityRecord: {
      status: "approved_compatible",
      boundImplementationVersion: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      boundExpectedPolicyVersion: {
        policyHash: "fixture-policy-hash-aaaa",
        protocolVersion: "1.1",
        compilerRevision: "1.2.0",
      },
    },
  });
  const result = validateRuntimeRuleProposal(legalPersonalProposal(), host);
  expect(result.resultKind).toBe("blocked");
  expect(codesOf(result.reasons)).toEqual(["compatibility_not_approved"]);
  expect(result.reasons[0]?.path).toBe("host.compatibilityRecord");
  expect(result.activationAllowed).toBe(false);
});

it("rejects a fixture-only host and does not treat fixture as a credential", () => {
  const proposal = legalPersonalProposal();
  const fixtureOnlyResult = validateRuntimeRuleProposal(proposal, { fixture: true });
  expect(fixtureOnlyResult.resultKind).toBe("needs_information");
  expect(fixtureOnlyResult.authorizationAssessment).toBe("assessment_unavailable");
  expect(fixtureOnlyResult.activationAllowed).toBe(false);
  expect(codesOf(fixtureOnlyResult.reasons)).toContain("missing_host_fact");
  expect(["shadow_accepted", "candidate_validated", "no_change"]).not.toContain(
    fixtureOnlyResult.resultKind,
  );

  const candidateOnly = validateRuntimeRuleProposal(legalPersonalCandidate(), { fixture: true });
  expect(candidateOnly.resultKind).toBe("needs_information");
  expect(candidateOnly.authorizationAssessment).toBe("assessment_unavailable");
  expect(candidateOnly.activationAllowed).toBe(false);
  expect(codesOf(candidateOnly.reasons)).toContain("missing_host_fact");
  expect(candidateOnly.resultKind).not.toBe("candidate_validated");
});

it("keeps the same stable decision after fixture is deleted from complete host facts", () => {
  const proposal = legalPersonalProposal();
  const withFixture = legalPersonalHost({ fixture: true, authorizationStatus: "authorized" });
  const withoutFixture = legalPersonalHost({ authorizationStatus: "authorized" });
  delete withoutFixture.fixture;
  expect(withFixture.fixture).toBe(true);
  expect(withoutFixture).not.toHaveProperty("fixture");

  const marked = validateRuntimeRuleProposal(proposal, withFixture);
  const unmarked = validateRuntimeRuleProposal(proposal, withoutFixture);
  expect(marked.resultKind).toBe("shadow_accepted");
  expect(marked.activationAllowed).toBe(false);
  expect(marked.authorizationAssessment).toBe("host_authorized");
  assertSameStableDecision(unmarked, marked);

  const unauthorizedMarked = validateRuntimeRuleProposal(
    proposal,
    legalPersonalHost({ fixture: true, authorizationStatus: "unauthorized" }),
  );
  const unauthorizedHost = legalPersonalHost({ authorizationStatus: "unauthorized" });
  delete unauthorizedHost.fixture;
  const unauthorizedUnmarked = validateRuntimeRuleProposal(proposal, unauthorizedHost);
  expect(unauthorizedMarked.resultKind).toBe("shadow_accepted");
  expect(unauthorizedMarked.authorizationAssessment).toBe("host_unauthorized");
  expect(unauthorizedMarked.activationAllowed).toBe(false);
  assertSameStableDecision(unauthorizedUnmarked, unauthorizedMarked);

  const candidate = legalPersonalCandidate();
  const candidateHost = legalPersonalCandidateHost();
  const candidateHostWithout = legalPersonalCandidateHost();
  delete candidateHostWithout.fixture;
  const candidateMarked = validateRuntimeRuleProposal(candidate, candidateHost);
  const candidateUnmarked = validateRuntimeRuleProposal(candidate, candidateHostWithout);
  expect(candidateMarked.resultKind).toBe("candidate_validated");
  expect(candidateMarked.activationAllowed).toBe(false);
  assertSameStableDecision(candidateUnmarked, candidateMarked);
});

it("does not mutate inputs and is idempotent across repeated calls", () => {
  const proposal = deepFreeze(legalPersonalProposal());
  const host = deepFreeze(legalPersonalHost());
  const beforeProposal = snapshot(proposal);
  const beforeHost = snapshot(host);
  const first = validateRuntimeRuleProposal(proposal, host);
  const second = validateRuntimeRuleProposal(proposal, host);
  expect(snapshot(proposal)).toBe(beforeProposal);
  expect(snapshot(host)).toBe(beforeHost);
  expect(snapshot(first)).toBe(snapshot(second));
  expect(first.resultKind).toBe("shadow_accepted");
});

it("accepts a legal collaboration tighten and still keeps activationAllowed false", () => {
  const result = validateRuntimeRuleProposal(legalGroupProposal(), legalGroupHost());
  expect(result.resultKind).toBe("shadow_accepted");
  expect(result.activationAllowed).toBe(false);
  expect(codesOf(result.reasons)).toEqual(["shadow_legal"]);
  expect(result.items[0]?.field).toBe("maxVisibleBotRepliesPerRound");
});

function nestToDepth(depth: number): Record<string, unknown> {
  const root: Record<string, unknown> = { kind: "policy_proposal" };
  let current = root;
  for (let level = 2; level <= depth; level += 1) {
    const child: Record<string, unknown> = {};
    current.child = child;
    current = child;
  }
  return root;
}

it("rejects a circular proposal object without throwing", () => {
  const proposal = legalPersonalProposal();
  proposal.self = proposal;
  let result: ReturnType<typeof validateRuntimeRuleProposal> | undefined;
  expect(() => {
    result = validateRuntimeRuleProposal(proposal, legalPersonalHost());
  }).not.toThrow();
  expect(result?.resultKind).toBe("blocked");
  expect(result?.activationAllowed).toBe(false);
  expect(codesOf(result?.reasons ?? [])).toEqual(["structural_circular_reference"]);
  expect(result?.reasons[0]?.path).toBe("proposal.self");
});

it("rejects mutually recursive objects without throwing", () => {
  const proposal = legalPersonalProposal();
  const other: Record<string, unknown> = { back: proposal };
  proposal.other = other;
  let result: ReturnType<typeof validateRuntimeRuleProposal> | undefined;
  expect(() => {
    result = validateRuntimeRuleProposal(proposal, legalPersonalHost());
  }).not.toThrow();
  expect(result?.resultKind).toBe("blocked");
  expect(codesOf(result?.reasons ?? [])).toEqual(["structural_circular_reference"]);
  expect(result?.reasons[0]?.path).toBe("proposal.other.back");
  expect(result?.activationAllowed).toBe(false);
});

it("rejects a cyclic array and object mix without throwing", () => {
  const proposal = legalPersonalProposal();
  const bag: unknown[] = [];
  bag.push({ wrapper: proposal });
  proposal.cycle = bag;
  let result: ReturnType<typeof validateRuntimeRuleProposal> | undefined;
  expect(() => {
    result = validateRuntimeRuleProposal(proposal, legalPersonalHost());
  }).not.toThrow();
  expect(result?.resultKind).toBe("blocked");
  expect(codesOf(result?.reasons ?? [])).toEqual(["structural_circular_reference"]);
  expect(result?.reasons[0]?.path).toBe("proposal.cycle[0].wrapper");
  expect(result?.activationAllowed).toBe(false);
});

it("rejects input deeper than the documented maximum without throwing", () => {
  const tooDeep = nestToDepth(RUNTIME_RULE_ADAPTATION_MAX_INPUT_DEPTH + 1);
  let result: ReturnType<typeof validateRuntimeRuleProposal> | undefined;
  expect(() => {
    result = validateRuntimeRuleProposal(tooDeep, legalPersonalHost());
  }).not.toThrow();
  expect(result?.resultKind).toBe("blocked");
  expect(codesOf(result?.reasons ?? [])).toEqual(["structural_input_too_deep"]);
  expect(result?.reasons[0]?.path).toBe(
    `proposal.${Array.from({ length: RUNTIME_RULE_ADAPTATION_MAX_INPUT_DEPTH }, () => "child").join(".")}`,
  );
  expect(result?.activationAllowed).toBe(false);

  const atLimit = nestToDepth(RUNTIME_RULE_ADAPTATION_MAX_INPUT_DEPTH);
  const limited = validateRuntimeRuleProposal(atLimit, legalPersonalHost());
  expect(codesOf(limited.reasons)).not.toContain("structural_input_too_deep");
  expect(limited.resultKind).toBe("blocked");
});

it("rejects non-plain Date, class instance, and Map values without throwing", () => {
  class FixtureHost {
    marker = true;
  }
  const cases: Array<{ value: unknown; path: string }> = [
    { value: new Date(), path: "proposal.stamp" },
    { value: new FixtureHost(), path: "proposal.instance" },
    { value: new Map(), path: "proposal.map" },
  ];
  for (const entry of cases) {
    const proposal = legalPersonalProposal();
    const key = entry.path.slice("proposal.".length);
    proposal[key] = entry.value;
    let result: ReturnType<typeof validateRuntimeRuleProposal> | undefined;
    expect(() => {
      result = validateRuntimeRuleProposal(proposal, legalPersonalHost());
    }).not.toThrow();
    expect(result?.resultKind, entry.path).toBe("blocked");
    expect(codesOf(result?.reasons ?? []), entry.path).toEqual(["structural_non_plain_object"]);
    expect(result?.reasons[0]?.path, entry.path).toBe(entry.path);
    expect(result?.activationAllowed).toBe(false);
  }

  let rootDate: ReturnType<typeof validateRuntimeRuleProposal> | undefined;
  expect(() => {
    rootDate = validateRuntimeRuleProposal(new Date(), legalPersonalHost());
  }).not.toThrow();
  expect(rootDate?.resultKind).toBe("blocked");
  expect(codesOf(rootDate?.reasons ?? [])).toEqual(["structural_non_plain_object"]);
  expect(rootDate?.reasons[0]?.path).toBe("proposal");

  let hostMap: ReturnType<typeof validateRuntimeRuleProposal> | undefined;
  expect(() => {
    hostMap = validateRuntimeRuleProposal(legalPersonalProposal(), new Map());
  }).not.toThrow();
  expect(hostMap?.resultKind).toBe("blocked");
  expect(codesOf(hostMap?.reasons ?? [])).toEqual(["structural_non_plain_object"]);
  expect(hostMap?.reasons[0]?.path).toBe("host");
});
