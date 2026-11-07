import { expect, it } from "vitest";
import { listRuntimeRuleDeclarations } from "./catalog.js";

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
