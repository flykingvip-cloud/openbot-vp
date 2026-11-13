import { expect, it } from "vitest";
import { createControlledCandidateEntry, refuseCandidateSubmission } from "./candidate-entry.js";
import { limitedPersonalView, maliciousRuleView } from "./test-support.js";
import { createShadowToolExecutor } from "./tools.js";

it("blocks retrieval until diagnosis has been recorded", () => {
  let diagnosed = false;
  const tools = createShadowToolExecutor({
    view: limitedPersonalView(),
    diagnosed: () => diagnosed,
  });
  const blocked = tools.execute("searchRules", { query: "context" });
  expect(blocked.status).toBe("rejected");
  expect(blocked.code).toBe("diagnose_required");
  expect(blocked.path).toBe("tools.searchRules");
  diagnosed = true;
  const ok = tools.execute("searchRules", { query: "contextTokens" });
  expect(ok.status).toBe("ok");
  expect(ok.readonly).toBe(true);
});

it("filters the host-provided view with structured fields and text match", () => {
  const tools = createShadowToolExecutor({ view: limitedPersonalView(), diagnosed: () => true });
  const miss = tools.execute("searchRules", { query: "no-such-rule", category: "operational" });
  const payload = (miss.result as { payload: { matches: unknown[] } }).payload;
  expect(payload.matches).toEqual([]);
  const hit = tools.execute("searchRules", {
    id: "model.context_window.guard",
    field: "agents.defaults.contextTokens",
  });
  const found = (hit.result as { payload: { matches: Array<{ id: string }> } }).payload.matches;
  expect(found).toHaveLength(1);
  expect(found[0]?.id).toBe("model.context_window.guard");
});

it("marks retrieved materials as untrusted and flags protocol-override text", () => {
  const tools = createShadowToolExecutor({ view: maliciousRuleView(), diagnosed: () => true });
  const result = tools.execute("getRuleDefinition", { id: "model.context_window.guard" });
  expect(result.status).toBe("ok");
  const wrapped = result.result as {
    untrustedMaterial: boolean;
    protocolOverrideDetected: boolean;
  };
  expect(wrapped.untrustedMaterial).toBe(true);
  expect(wrapped.protocolOverrideDetected).toBe(true);
});

it("refuses submitRuleCandidate persistence even when enablePersist is requested", () => {
  const entry = createControlledCandidateEntry();
  const tools = createShadowToolExecutor({
    view: limitedPersonalView(),
    diagnosed: () => true,
    candidateEntry: entry,
  });
  const result = tools.execute("submitRuleCandidate", { enablePersist: true, body: "store me" });
  expect(result.status).toBe("rejected");
  expect(result.code).toBe("p2_persist_forbidden");
  expect(result.path).toBe("candidateEntry.submitRuleCandidate");
  expect(tools.candidateToolInvoked()).toBe(true);
  const decision = result.result as ReturnType<typeof refuseCandidateSubmission>;
  expect(decision.accepted).toBe(false);
  expect(decision.persisted).toBe(false);
  expect(decision.activated).toBe(false);
  expect(decision.published).toBe(false);
  expect(decision.storageId).toBeUndefined();
});

it("rejects unknown business tools without executing them", () => {
  const tools = createShadowToolExecutor({ view: limitedPersonalView(), diagnosed: () => true });
  const result = tools.execute("writeConfig", { path: "/tmp/policy.json" });
  expect(result.status).toBe("rejected");
  expect(result.code).toBe("tool_not_permitted");
  expect(result.path).toBe("tools.writeConfig");
  expect(tools.businessAttempts()).toEqual(["writeConfig"]);
});

it("returns not_found for a definition id absent from the host view", () => {
  const tools = createShadowToolExecutor({ view: limitedPersonalView(), diagnosed: () => true });
  const result = tools.execute("getRuleDefinition", { id: "invented.shadow.rule" });
  expect(result.status).toBe("not_found");
  expect(result.code).toBe("fabricated_rule_id");
  expect(result.path).toBe("tools.getRuleDefinition.id");
});
