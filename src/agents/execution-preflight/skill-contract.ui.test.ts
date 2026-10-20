import { describe, expect, it } from "vitest";
import { normalizeSupportedUiComponents, readSkillContract } from "./skill-contract.js";

describe("normalizeSupportedUiComponents", () => {
  it("keeps known ogui ids and drops unknowns", () => {
    expect(
      normalizeSupportedUiComponents(["ogui-form", "canvas-v99", "ogui-choice", "ogui-form"]),
    ).toEqual({
      supportedUiComponents: ["ogui-form", "ogui-choice"],
      unknownIds: ["canvas-v99"],
    });
  });

  it("returns empty for empty input", () => {
    expect(normalizeSupportedUiComponents([])).toEqual({
      supportedUiComponents: [],
      unknownIds: [],
    });
  });
});

describe("readSkillContract · UI capability fields", () => {
  it("parses supported-ui-components and requires-ui-confirmation", () => {
    const contract = readSkillContract("ogui-form", {
      "supported-ui-components": "ogui-form, ogui-choice",
      "requires-ui-confirmation": "true",
    });
    expect(contract).toMatchObject({
      skillId: "ogui-form",
      supportedUiComponents: ["ogui-form", "ogui-choice"],
      requiresUiConfirmation: true,
    });
  });

  it("skills without UI fields stay undefined when no other contract keys", () => {
    expect(readSkillContract("plain", { description: "hello" })).toBeUndefined();
  });

  it("UI-only frontmatter still yields a contract (does not break prompt-only peers)", () => {
    const contract = readSkillContract("ui-only", {
      "supported-ui-components": "ogui-form",
    });
    expect(contract?.supportedUiComponents).toEqual(["ogui-form"]);
    expect(contract?.requiresUiConfirmation).toBeUndefined();
    expect(contract?.triggers).toEqual([]);
  });

  it("drops unknown component ids from the contract list", () => {
    const contract = readSkillContract("mixed", {
      "supported-ui-components": "ogui-form, not-a-real-component",
    });
    expect(contract?.supportedUiComponents).toEqual(["ogui-form"]);
  });

  it("parses requires-ui-confirmation false", () => {
    const contract = readSkillContract("opt", {
      "requires-ui-confirmation": "false",
      triggers: "demo",
    });
    expect(contract?.requiresUiConfirmation).toBe(false);
  });
});
