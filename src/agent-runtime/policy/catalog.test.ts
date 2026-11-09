import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import {
  RULE_CATALOG_INVENTORY_BASELINE,
  getRuntimeRuleDeclaration,
  listRuntimeRuleDeclarations,
} from "./catalog.js";

const REQUIRED_OWNERS = new Set([
  "command",
  "execution",
  "delivery",
  "policy",
  "capabilities",
  "state",
  "gateway",
  "conversation-task",
]);

it("lists only current source implementations, never retired entry paths", () => {
  for (const rule of listRuntimeRuleDeclarations()) {
    expect(existsSync(resolve(rule.implementation)), rule.implementation).toBe(true);
  }
});

it("returns a detached inventory without changing rule authority", () => {
  const rules = listRuntimeRuleDeclarations();
  expect(new Set(rules.map((rule) => rule.id)).size).toBe(rules.length);
  expect(
    rules
      .filter((rule) => rule.category === "invariant")
      .every((rule) => rule.management === "code_required"),
  ).toBe(true);
  rules[0].id = "changed";
  expect(listRuntimeRuleDeclarations()[0].id).toBe("task.binding.current");
});

it("exposes typed catalog metadata for every rule id", () => {
  const rules = listRuntimeRuleDeclarations();
  expect(rules.length).toBeGreaterThan(19);
  for (const rule of rules) {
    expect(rule.scope.length, rule.id).toBeGreaterThan(0);
    expect(rule.enforcementPoints.length, rule.id).toBeGreaterThan(0);
    expect(rule.version, rule.id).toBe(`inventory:${RULE_CATALOG_INVENTORY_BASELINE}`);
    expect(rule.version.includes("tip"), rule.id).toBe(false);
    expect(REQUIRED_OWNERS.has(rule.currentOwner), rule.id).toBe(true);
    expect(REQUIRED_OWNERS.has(rule.targetOwner), rule.id).toBe(true);
    expect(typeof rule.configuration, rule.id).toBe("string");
    expect(rule.retirementCondition.length, rule.id).toBeGreaterThan(0);
    expect(Array.isArray(rule.tests), rule.id).toBe(true);
    expect(Array.isArray(rule.dependencies.rules), rule.id).toBe(true);
    expect(Array.isArray(rule.dependencies.artifacts), rule.id).toBe(true);
  }
});

it("keeps rule-id dependency edges complete inside the catalog", () => {
  const rules = listRuntimeRuleDeclarations();
  const ids = new Set(rules.map((rule) => rule.id));
  for (const rule of rules) {
    for (const dep of rule.dependencies.rules) {
      expect(ids.has(dep), `${rule.id} -> ${dep}`).toBe(true);
    }
  }
});

it("separates current ownership from target ownership for state and pending paths", () => {
  const asyncWait = getRuntimeRuleDeclaration("execution.async_wait.job_transition");
  const queueClaim = getRuntimeRuleDeclaration("execution.queue.claim");
  const park = getRuntimeRuleDeclaration("task.park.abort_inflight");
  const collab = getRuntimeRuleDeclaration("collab.policy.compile");
  expect(asyncWait?.currentOwner).toBe("state");
  expect(asyncWait?.targetOwner).toBe("state");
  expect(queueClaim?.currentOwner).toBe("state");
  expect(queueClaim?.targetOwner).toBe("state");
  expect(park?.currentOwner).toBe("conversation-task");
  expect(park?.targetOwner).toBe("policy");
  expect(park?.disposition).toBe("pending_migration");
  expect(collab?.currentOwner).toBe("gateway");
  expect(collab?.targetOwner).toBe("policy");
  expect(collab?.disposition).toBe("pending_migration");
  expect(collab?.implementation).toContain("gateway/collaboration-dispatch");
});

it("registers pending-migration rules at real paths without ClaimContract", () => {
  const ids = new Set(listRuntimeRuleDeclarations().map((rule) => rule.id));
  for (const id of [
    "task.focus.wake",
    "task.focus.switch",
    "task.reply.completion",
    "collab.policy.compile",
    "collab.submit.review_versioning",
    "collab.governance.gate",
    "collab.peer.review_gate",
    "collab.plan.gate",
  ]) {
    expect(ids.has(id), id).toBe(true);
  }
  expect(ids.has("claim.contract")).toBe(false);
  expect(
    listRuntimeRuleDeclarations().some((rule) => rule.id.toLowerCase().includes("claimcontract")),
  ).toBe(false);
  expect(
    listRuntimeRuleDeclarations().some((rule) => rule.implementation.includes("claim-contract.ts")),
  ).toBe(false);
});

it("does not let nested field edits pollute the catalog", () => {
  const first = listRuntimeRuleDeclarations();
  const sample = first.find((rule) => rule.id === "task.binding.current");
  expect(sample).toBeTruthy();
  const originalPoint = sample!.enforcementPoints[0];
  const originalDepCount = sample!.dependencies.rules.length;
  const originalArtifact = sample!.dependencies.artifacts[0];
  const originalTest = sample!.tests[0];

  (sample!.enforcementPoints as string[])[0] = "mutated-point";
  (sample!.dependencies.rules as string[]).push("mutated.rule");
  (sample!.dependencies.artifacts as string[])[0] = "mutated-artifact";
  (sample!.tests as string[])[0] = "mutated-test";
  sample!.dependencies = {
    rules: ["mutated.rule"],
    artifacts: ["mutated-artifact"],
  };

  const again = getRuntimeRuleDeclaration("task.binding.current");
  expect(again?.enforcementPoints[0]).toBe(originalPoint);
  expect(again?.dependencies.rules.length).toBe(originalDepCount);
  expect(again?.dependencies.rules.includes("mutated.rule")).toBe(false);
  expect(again?.dependencies.artifacts[0]).toBe(originalArtifact);
  expect(again?.tests[0]).toBe(originalTest);
});

it("records accurate configuration and tests for reviewed rules", () => {
  const peer = getRuntimeRuleDeclaration("collab.peer.review_gate");
  expect(peer?.configuration).toContain("collaboration.task.requirePeerReview");
  expect(peer?.configuration).toMatch(/default false/i);
  expect(peer?.configuration).toMatch(/does not control peer-review fact writes/i);
  expect(peer?.configuration).toMatch(/acceptBoardItemSubmission|accept/i);

  const reply = getRuntimeRuleDeclaration("task.reply.completion");
  expect(reply?.configuration).toContain("OPENBOT_CONVERSATION_TASK_ACTIVATION");
  expect(reply?.configuration).toMatch(/activation/i);
  expect(reply?.configuration).toMatch(/default OFF/i);
  expect(reply?.configuration.toLowerCase()).not.toMatch(/^none\b/);

  const gov = getRuntimeRuleDeclaration("collab.governance.gate");
  expect(gov?.tests).toContain("src/gateway/collaboration-dispatch/governance-gate.test.ts");
  expect(gov?.tests.length).toBeGreaterThan(0);

  // Other newly registered pending-migration entries keep real test paths when present.
  for (const id of [
    "task.focus.wake",
    "task.focus.switch",
    "task.reply.completion",
    "collab.policy.compile",
    "collab.submit.review_versioning",
    "collab.peer.review_gate",
    "collab.plan.gate",
    "task.park.abort_inflight",
  ]) {
    const rule = getRuntimeRuleDeclaration(id);
    expect(rule, id).toBeTruthy();
    expect(rule!.tests.length, id).toBeGreaterThan(0);
    for (const testPath of rule!.tests) {
      expect(testPath.includes("/"), `${id} -> ${testPath}`).toBe(true);
      expect(existsSync(resolve(testPath)), `${id} -> ${testPath}`).toBe(true);
    }
  }
});
