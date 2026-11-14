import { expect, it } from "vitest";
import { getP1ShadowFieldAdapter, listP1ShadowFieldAdapters } from "./descriptors.js";
import { validateRuntimeRuleProposal } from "./index.js";
import * as publicApi from "./index.js";
import {
  assertStableResult,
  loadEnvelope,
  loadExpected,
  validateEnvelope,
} from "./validate.test-support.js";

const SAMPLES = [
  "01-legal-tighten",
  "02-unauthorized-shadow-legal",
  "03-unknown-rule-missing-host-facts",
  "04-cancelled-missing-compatibility",
  "05-forged-authorization-field",
  "06-batch-conflict",
  "07-rule-candidate-validated",
] as const;

it.each(SAMPLES)("matches stable codes and paths for %s", (prefix) => {
  const actual = validateEnvelope(`${prefix}.input.json`);
  const expected = loadExpected(`${prefix}.output.json`);
  assertStableResult(actual, expected);
  expect(actual.activationAllowed).toBe(false);
});

it("maps the test envelope onto two function parameters and ignores fixture as a credential", () => {
  const envelope = loadEnvelope("01-legal-tighten.input.json");
  const host = envelope.host as { fixture?: unknown; authorizationStatus?: unknown };
  expect(host.fixture).toBe(true);
  expect(host.authorizationStatus).toBe("authorized");
  const result = validateRuntimeRuleProposal(envelope.proposal, envelope.host);
  expect(result.resultKind).toBe("shadow_accepted");
  expect(result.activationAllowed).toBe(false);
  expect(result.authorizationAssessment).toBe("host_authorized");
  expect(result.reasons.every((entry) => entry.code === "shadow_legal")).toBe(true);
});

it("does not export an envelope-parsing authorization interface", () => {
  expect(typeof publicApi.validateRuntimeRuleProposal).toBe("function");
  expect(publicApi.validateRuntimeRuleProposal.length).toBe(2);
  expect(Object.keys(publicApi)).not.toContain("validateEnvelope");
  expect(Object.keys(publicApi)).not.toContain("parseEnvelope");
  expect(Object.keys(publicApi)).not.toContain("validateRuntimeRuleProposalEnvelope");
});

it("reuses the existing catalog for exactly two shadow field adapters", () => {
  const adapters = listP1ShadowFieldAdapters();
  expect(adapters).toHaveLength(2);
  expect(adapters[0]?.ruleId).toBe("model.context_window.guard");
  expect(adapters[0]?.field).toBe("agents.defaults.contextTokens");
  expect(adapters[0]?.hardMin).toBe(16_000);
  expect(adapters[0]?.catalogDeclaration.id).toBe("model.context_window.guard");
  expect(adapters[1]?.ruleId).toBe("collab.policy.compile");
  expect(adapters[1]?.field).toBe("maxVisibleBotRepliesPerRound");
  expect(adapters[1]?.hardMin).toBe(1);
  expect(adapters[1]?.hardCeiling).toBe(12);
  expect(adapters[1]?.catalogDeclaration.id).toBe("collab.policy.compile");
  expect(
    getP1ShadowFieldAdapter("model.context_window.guard", "maxVisibleBotRepliesPerRound"),
  ).toBeUndefined();
});
