import { describe, expect, it } from "vitest";
import {
  collectArchitectureViolations,
  isSameComponentInternal,
  type ManifestRule,
} from "../../../../scripts/check-architecture-manifest.ts";

/**
 * Regression for t56u: exceptFrom allows intra-component internal references
 * only when BOTH importer and target belong to the same rule-adaptation tree.
 * It must not take that tree out of the public-entry check.
 */

const commandPublic: ManifestRule = {
  name: "runtime-command-public-entry",
  from: "src/**",
  exceptFrom: ["src/agent-runtime/command/rule-adaptation/**"],
  denyImportsFrom: [
    "src/agent-runtime/command/!(index).ts",
    "src/agent-runtime/command/*/!(index).ts",
    "src/agent-runtime/command/*/*/**",
  ],
  description: "command public entry",
};

const policyPublic: ManifestRule = {
  name: "runtime-policy-public-entry",
  from: "src/**",
  exceptFrom: ["src/agent-runtime/policy/rule-adaptation/**"],
  denyImportsFrom: [
    "src/agent-runtime/policy/!(index).ts",
    "src/agent-runtime/policy/*/!(index).ts",
    "src/agent-runtime/policy/*/*/**",
  ],
  description: "policy public entry",
};

const modelPublic: ManifestRule = {
  name: "runtime-model-public-entry",
  from: "src/**",
  exceptFrom: ["src/agent-runtime/model/rule-adaptation/**"],
  denyImportsFrom: [
    "src/agent-runtime/model/!(index).ts",
    "src/agent-runtime/model/*/!(index).ts",
    "src/agent-runtime/model/*/*/**",
  ],
  description: "model public entry",
};

const rules = [commandPublic, policyPublic, modelPublic];

function importsOf(map: Record<string, Array<{ specifier: string; resolved: string }>>) {
  return (file: string) => map[file] ?? [];
}

function violations(
  files: string[],
  map: Record<string, Array<{ specifier: string; resolved: string }>>,
) {
  return collectArchitectureViolations({ rules, files, importsOf: importsOf(map) });
}

describe("architecture public-entry exceptFrom scope", () => {
  it("allows intra-component internal references", () => {
    const from = "src/agent-runtime/command/rule-adaptation/run.ts";
    const target = "src/agent-runtime/command/rule-adaptation/tools.ts";
    expect(isSameComponentInternal(from, target, commandPublic.exceptFrom)).toBe(true);
    expect(violations([from], { [from]: [{ specifier: "./tools.js", resolved: target }] })).toEqual(
      [],
    );
  });

  it("rejects an external caller importing an internal file", () => {
    const from = "src/agents/model-fallback.ts";
    const target = "src/agent-runtime/command/rule-adaptation/run.ts";
    expect(isSameComponentInternal(from, target, commandPublic.exceptFrom)).toBe(false);
    const found = violations([from], {
      [from]: [{ specifier: "../agent-runtime/command/rule-adaptation/run.js", resolved: target }],
    });
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("runtime-command-public-entry");
    expect(found[0]).toContain(from);
    expect(found[0]).toContain(target);
  });

  it("rejects a component crossing into another component's internal files", () => {
    const from = "src/agent-runtime/command/rule-adaptation/run.ts";
    const otherTree = "src/agent-runtime/policy/rule-adaptation/validate.ts";
    const parentInternal = "src/agent-runtime/command/route-interaction.ts";
    const modelInternal = "src/agent-runtime/model/rule-adaptation/budget.ts";

    expect(isSameComponentInternal(from, otherTree, commandPublic.exceptFrom)).toBe(false);
    expect(isSameComponentInternal(from, otherTree, policyPublic.exceptFrom)).toBe(false);
    expect(isSameComponentInternal(from, parentInternal, commandPublic.exceptFrom)).toBe(false);

    const found = violations([from], {
      [from]: [
        { specifier: "../../policy/rule-adaptation/validate.js", resolved: otherTree },
        { specifier: "../route-interaction.js", resolved: parentInternal },
        { specifier: "../../model/rule-adaptation/budget.js", resolved: modelInternal },
      ],
    });
    expect(
      found.some(
        (line) => line.includes("runtime-policy-public-entry") && line.includes(otherTree),
      ),
    ).toBe(true);
    expect(
      found.some(
        (line) => line.includes("runtime-command-public-entry") && line.includes(parentInternal),
      ),
    ).toBe(true);
    expect(
      found.some(
        (line) => line.includes("runtime-model-public-entry") && line.includes(modelInternal),
      ),
    ).toBe(true);
  });

  it("allows calling the public index", () => {
    const external = "src/agents/model-fallback.ts";
    const inside = "src/agent-runtime/command/rule-adaptation/run.ts";
    const found = violations([external, inside], {
      [external]: [
        {
          specifier: "../agent-runtime/command/index.js",
          resolved: "src/agent-runtime/command/index.ts",
        },
        {
          specifier: "../agent-runtime/command/rule-adaptation/index.js",
          resolved: "src/agent-runtime/command/rule-adaptation/index.ts",
        },
      ],
      [inside]: [
        { specifier: "../../policy/index.js", resolved: "src/agent-runtime/policy/index.ts" },
        {
          specifier: "../../policy/rule-adaptation/index.js",
          resolved: "src/agent-runtime/policy/rule-adaptation/index.ts",
        },
        { specifier: "../../model/index.js", resolved: "src/agent-runtime/model/index.ts" },
      ],
    });
    expect(found).toEqual([]);
  });

  it("keeps prior behavior when exceptFrom is not configured", () => {
    const rule: ManifestRule = {
      name: "runtime-command-public-entry",
      from: "src/**",
      denyImportsFrom: [
        "src/agent-runtime/command/!(index).ts",
        "src/agent-runtime/command/*/!(index).ts",
        "src/agent-runtime/command/*/*/**",
      ],
      description: "unconfigured",
    };
    const from = "src/agent-runtime/command/rule-adaptation/run.ts";
    const target = "src/agent-runtime/command/rule-adaptation/tools.ts";
    const found = collectArchitectureViolations({
      rules: [rule],
      files: [from],
      importsOf: () => [{ specifier: "./tools.js", resolved: target }],
    });
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("runtime-command-public-entry");
  });
});
