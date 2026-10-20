import { describe, expect, it } from "vitest";
import {
  SUPERVISOR_REPO_AUTO_TEMPLATE_ID,
  getSupervisorTaskTemplate,
  listSupervisorTaskTemplates,
  parseAcceptanceCriteriaInput,
} from "./templates.js";

describe("supervisor templates", () => {
  it("lists built-in presets with template source", () => {
    const templates = listSupervisorTaskTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(3);
    expect(templates.every((t) => t.acceptance.source === "template")).toBe(true);
    expect(templates.some((t) => t.id === "node-test-lint")).toBe(true);
  });

  it("resolves template by id", () => {
    const template = getSupervisorTaskTemplate("node-full-ci");
    expect(template?.acceptance.steps.map((s) => s.id)).toEqual(["test", "lint", "build"]);
    expect(getSupervisorTaskTemplate(SUPERVISOR_REPO_AUTO_TEMPLATE_ID)).toBeNull();
    expect(getSupervisorTaskTemplate("missing")).toBeNull();
  });

  it("parses explicit acceptance input", () => {
    const parsed = parseAcceptanceCriteriaInput({
      source: "user",
      steps: [{ id: "test", argv: ["npm", "test"], required: true }],
    });
    expect(parsed?.source).toBe("user");
    expect(parsed?.steps[0]?.argv).toEqual(["npm", "test"]);
    expect(parseAcceptanceCriteriaInput({ steps: [] })).toBeNull();
  });
});
