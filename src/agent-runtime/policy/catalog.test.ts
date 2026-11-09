import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { listRuntimeRuleDeclarations } from "./catalog.js";

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
