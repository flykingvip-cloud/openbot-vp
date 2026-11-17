import { expect, it } from "vitest";
import {
  evaluateExecutionRuleAdoption,
  validateExecutionRuleProposal,
  type ExecutionRuleAdoptionInput,
} from "./execution-adoption.js";
const personal: ExecutionRuleAdoptionInput = {
  mode: "dynamic",
  authorized: true,
  scope: { type: "personal", id: "turn-a" },
  proposalScope: { type: "personal", id: "turn-a" },
  bindingCurrent: true,
  cancelled: false,
  ruleId: "model.context_window.guard",
  field: "agents.defaults.contextTokens",
  action: "tune",
  currentValue: 32000,
  proposedValue: 24000,
};
it("allows bounded personal execution adoption", () =>
  expect(evaluateExecutionRuleAdoption(personal)).toEqual({ allowed: true, value: 24000 }));
it("supports group scope through the same mechanism", () =>
  expect(
    evaluateExecutionRuleAdoption({
      ...personal,
      scope: { type: "group", id: "g" },
      proposalScope: { type: "group", id: "g" },
      ruleId: "collab.policy.compile",
      field: "maxVisibleBotRepliesPerRound",
      currentValue: 3,
      proposedValue: 2,
    }),
  ).toEqual({ allowed: true, value: 2 }));
it.each([
  { authorized: false },
  { bindingCurrent: false },
  { cancelled: true },
  { mode: "legacy" as const },
  { proposedValue: 64000 },
  { proposedValue: 1 },
  { proposalScope: { type: "group" as const, id: "turn-a" } },
])("rejects invalid adoption %j", (patch) =>
  expect(evaluateExecutionRuleAdoption({ ...personal, ...patch }).allowed).toBe(false),
);

const proposal = {
  kind: "policy_proposal",
  scope: personal.scope,
  items: [{ ruleId: personal.ruleId, field: personal.field, action: "tune", proposedValue: 24000 }],
};
it("validates run-local tightening without granting permanent activation", () => {
  expect(validateExecutionRuleProposal(proposal, personal)).toMatchObject({
    resultKind: "shadow_accepted",
    activationAllowed: false,
  });
});
it.each([
  null,
  [],
  { ...proposal, authorized: true },
  { ...proposal, items: [{ ...proposal.items[0], activationAllowed: true }] },
  { ...proposal, scope: { type: "personal", id: "other" } },
  { ...proposal, items: [{ ...proposal.items[0], proposedValue: 64000 }] },
])("rejects malformed or unauthorized proposal %j", (p) => {
  expect(validateExecutionRuleProposal(p, personal).resultKind).toBe("blocked");
});
it("rejects cancelled run-local adoption", () =>
  expect(validateExecutionRuleProposal(proposal, { ...personal, cancelled: true }).resultKind).toBe(
    "blocked",
  ));
