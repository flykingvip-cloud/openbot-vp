import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "vitest";
import type {
  RuntimeRuleAdaptationReason,
  RuntimeRuleAdaptationValidationResult,
} from "../../contracts/rule-adaptation.js";
import { validateRuntimeRuleProposal } from "./validate.js";

export const SAMPLES_DIR = join(process.cwd(), ".kiro/specs/runtime-rule-adaptation/samples");

/** Map a test-only JSON envelope onto the two public function parameters. */
export function loadEnvelope(fileName: string): { proposal: unknown; host: unknown } {
  const parsed = JSON.parse(readFileSync(join(SAMPLES_DIR, fileName), "utf8")) as {
    proposal: unknown;
    host: unknown;
  };
  return { proposal: parsed.proposal, host: parsed.host };
}

export function loadExpected(fileName: string): RuntimeRuleAdaptationValidationResult {
  return JSON.parse(
    readFileSync(join(SAMPLES_DIR, fileName), "utf8"),
  ) as RuntimeRuleAdaptationValidationResult;
}

export function validateEnvelope(fileName: string): RuntimeRuleAdaptationValidationResult {
  const envelope = loadEnvelope(fileName);
  return validateRuntimeRuleProposal(envelope.proposal, envelope.host);
}

export function codesOf(reasons: RuntimeRuleAdaptationReason[]): string[] {
  return reasons.map((entry) => entry.code);
}

export function pathsOf(reasons: RuntimeRuleAdaptationReason[]): Array<string | undefined> {
  return reasons.map((entry) => entry.path);
}

/** Compare stable decision fields only. Do not assert on `message` text. */
export function assertSameStableDecision(
  actual: RuntimeRuleAdaptationValidationResult,
  expected: RuntimeRuleAdaptationValidationResult,
): void {
  expect(actual.resultKind).toBe(expected.resultKind);
  expect(actual.activationAllowed).toBe(expected.activationAllowed);
  expect(actual.authorizationAssessment).toBe(expected.authorizationAssessment);
  expect(codesOf(actual.reasons)).toEqual(codesOf(expected.reasons));
  expect(pathsOf(actual.reasons)).toEqual(pathsOf(expected.reasons));
  expect(actual.items).toHaveLength(expected.items.length);
  for (const [index, expectedItem] of expected.items.entries()) {
    const actualItem = actual.items[index];
    expect(actualItem?.resultKind).toBe(expectedItem.resultKind);
    expect(actualItem?.ruleId).toBe(expectedItem.ruleId);
    expect(actualItem?.field).toBe(expectedItem.field);
    expect(actualItem?.proposedRuleId).toBe(expectedItem.proposedRuleId);
    expect(codesOf(actualItem?.reasons ?? [])).toEqual(codesOf(expectedItem.reasons));
    expect(pathsOf(actualItem?.reasons ?? [])).toEqual(pathsOf(expectedItem.reasons));
  }
}

/**
 * Assert stable decision fields. Do not use `message` as a business-decision oracle.
 */
export function assertStableResult(
  actual: RuntimeRuleAdaptationValidationResult,
  expected: RuntimeRuleAdaptationValidationResult,
): void {
  expect(actual.resultKind).toBe(expected.resultKind);
  expect(actual.activationAllowed).toBe(false);
  expect(expected.activationAllowed).toBe(false);
  expect(actual.authorizationAssessment).toBe(expected.authorizationAssessment);
  expect(codesOf(actual.reasons)).toEqual(codesOf(expected.reasons));
  expect(pathsOf(actual.reasons)).toEqual(pathsOf(expected.reasons));
  expect(actual.items).toHaveLength(expected.items.length);
  for (const [index, expectedItem] of expected.items.entries()) {
    const actualItem = actual.items[index];
    expect(actualItem?.resultKind).toBe(expectedItem.resultKind);
    expect(actualItem?.ruleId).toBe(expectedItem.ruleId);
    expect(actualItem?.field).toBe(expectedItem.field);
    expect(actualItem?.proposedRuleId).toBe(expectedItem.proposedRuleId);
    expect(codesOf(actualItem?.reasons ?? [])).toEqual(codesOf(expectedItem.reasons));
    expect(pathsOf(actualItem?.reasons ?? [])).toEqual(pathsOf(expectedItem.reasons));
  }
}

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    if (Array.isArray(value)) {
      for (const entry of value) {
        deepFreeze(entry);
      }
    } else {
      for (const child of Object.values(value as Record<string, unknown>)) {
        deepFreeze(child);
      }
    }
  }
  return value;
}

export function snapshot(value: unknown): string {
  return JSON.stringify(value);
}

export function legalPersonalHost(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    fixture: true,
    identity: {
      principalType: "personal",
      principalId: "user:fixture-1",
      scope: { type: "personal", id: "agent:fixture-personal-1" },
    },
    currentEffectiveValues: { "agents.defaults.contextTokens": 32000 },
    authorizationStatus: "unauthorized",
    compatibilityRecord: {
      status: "approved_compatible",
      boundImplementationVersion: "9b65109f41dee30b892a6faff493e46e735cab8d",
      boundExpectedPolicyVersion: {
        policyHash: "fixture-policy-hash-aaaa",
        protocolVersion: "1.1",
        compilerRevision: "1.2.0",
      },
    },
    expectedPolicyState: "active",
    ...overrides,
  };
}

export function legalPersonalProposal(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    kind: "policy_proposal",
    scope: { type: "personal", id: "agent:fixture-personal-1" },
    implementationVersion: "9b65109f41dee30b892a6faff493e46e735cab8d",
    expectedPolicyVersion: {
      policyHash: "fixture-policy-hash-aaaa",
      protocolVersion: "1.1",
      compilerRevision: "1.2.0",
    },
    items: [
      {
        ruleId: "model.context_window.guard",
        field: "agents.defaults.contextTokens",
        action: "tune",
        proposedValue: 24000,
      },
    ],
    ...overrides,
  };
}

export function legalGroupHost(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fixture: true,
    identity: {
      principalType: "group",
      principalId: "group:fixture-1",
      scope: { type: "group", id: "group:fixture-1" },
    },
    lane: "effective",
    currentEffectiveValues: { maxVisibleBotRepliesPerRound: 3 },
    authorizationStatus: "unauthorized",
    compatibilityRecord: {
      status: "approved_compatible",
      boundImplementationVersion: "9b65109f41dee30b892a6faff493e46e735cab8d",
      boundExpectedPolicyVersion: {
        policyHash: "fixture-policy-hash-aaaa",
        protocolVersion: "1.1",
        compilerRevision: "1.2.0",
      },
    },
    expectedPolicyState: "active",
    ...overrides,
  };
}

export function legalGroupProposal(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    kind: "policy_proposal",
    scope: { type: "group", id: "group:fixture-1" },
    implementationVersion: "9b65109f41dee30b892a6faff493e46e735cab8d",
    expectedPolicyVersion: {
      policyHash: "fixture-policy-hash-aaaa",
      protocolVersion: "1.1",
      compilerRevision: "1.2.0",
    },
    items: [
      {
        ruleId: "collab.policy.compile",
        field: "maxVisibleBotRepliesPerRound",
        action: "tune",
        proposedValue: 2,
      },
    ],
    ...overrides,
  };
}

export function legalPersonalCandidate(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    kind: "rule_candidate",
    scope: { type: "personal", id: "agent:fixture-personal-1" },
    implementationVersion: "9b65109f41dee30b892a6faff493e46e735cab8d",
    candidate: {
      proposedRuleId: "diag.paused_job.watch.candidate",
      summary:
        "Fixture candidate: propose declaring an isolated paused-job watch rule. Not a production rule and not in the catalog.",
      body: "Validate-only fixture body. The P1 validator must not persist or register this candidate.",
    },
    ...overrides,
  };
}

export function legalPersonalCandidateHost(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    fixture: true,
    identity: {
      principalType: "personal",
      principalId: "user:fixture-1",
      scope: { type: "personal", id: "agent:fixture-personal-1" },
    },
    ...overrides,
  };
}
