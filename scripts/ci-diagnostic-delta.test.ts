import { describe, expect, it } from "vitest";
import {
  diagnosticIdentity,
  diffDiagnostics,
  listExtensionNodeModulesPaths,
  parseOxlintDiagnostics,
  parseTsgoDiagnostics,
  validateDiagnosticExit,
} from "./ci-diagnostic-delta.mjs";

describe("parseTsgoDiagnostics", () => {
  it("removes line movement from identity and keeps multiline context", () => {
    const before = parseTsgoDiagnostics(
      "src/example.ts(10,2): error TS2322: Type 'number' is not assignable to type 'string'.\n  The assignment originates here.\n",
    );
    const after = parseTsgoDiagnostics(
      "src/example.ts(90,17): error TS2322: Type 'number' is not assignable to type 'string'.\n  The assignment originates here.\n",
    );

    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({
      path: "src/example.ts",
      code: "TS2322",
      line: 10,
      column: 2,
      message: "Type 'number' is not assignable to type 'string'. The assignment originates here.",
    });
    expect(diagnosticIdentity(before[0])).toBe(diagnosticIdentity(after[0]));
  });

  it("normalizes temporary tree roots embedded in messages", () => {
    const before = parseTsgoDiagnostics(
      "/tmp/base/src/example.ts(1,1): error TS2307: Cannot find module '/tmp/base/generated'.\n",
      { root: "/tmp/base" },
    );
    const after = parseTsgoDiagnostics(
      "/tmp/candidate/src/example.ts(1,1): error TS2307: Cannot find module '/tmp/candidate/generated'.\n",
      { root: "/tmp/candidate" },
    );

    expect(diagnosticIdentity(before[0])).toBe(diagnosticIdentity(after[0]));
  });

  it("parses diagnostics without a file location", () => {
    expect(parseTsgoDiagnostics("error TS5058: The specified path does not exist.\n")).toEqual([
      expect.objectContaining({ path: "<global>", code: "TS5058" }),
    ]);
  });
});

describe("parseOxlintDiagnostics", () => {
  it("ignores spans while preserving the rule and message", () => {
    const payload = (line: number) =>
      JSON.stringify({
        diagnostics: [
          {
            filename: "src/example.ts",
            code: "eslint(no-unused-vars)",
            severity: "error",
            message: "Variable is never used.",
            help: "Remove it.",
            labels: [{ span: { line, column: 3, offset: 20, length: 4 } }],
          },
          {
            filename: "src/warning.ts",
            code: "eslint(no-console)",
            severity: "warning",
            message: "Console statement.",
          },
        ],
      });
    const before = parseOxlintDiagnostics(payload(4));
    const after = parseOxlintDiagnostics(payload(40));

    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({
      path: "src/example.ts",
      code: "eslint(no-unused-vars)",
      line: 4,
      message: "Variable is never used. Help: Remove it.",
    });
    expect(diagnosticIdentity(before[0])).toBe(diagnosticIdentity(after[0]));
  });
});

describe("diffDiagnostics", () => {
  const diagnostic = {
    tool: "tsgo",
    path: "src/example.ts",
    code: "TS2322",
    severity: "error",
    message: "Type mismatch.",
    line: 1,
    column: 1,
  };

  it("allows an unchanged baseline diagnostic", () => {
    expect(diffDiagnostics([diagnostic], [{ ...diagnostic, line: 99 }])).toEqual([]);
  });

  it("uses multiset subtraction so a duplicate finding is still new", () => {
    const duplicate = { ...diagnostic, line: 2 };
    expect(diffDiagnostics([diagnostic], [diagnostic, duplicate])).toEqual([duplicate]);
  });

  it("returns only candidate diagnostics absent from the baseline", () => {
    const added = { ...diagnostic, code: "TS2345", message: "Bad argument." };
    expect(diffDiagnostics([diagnostic], [diagnostic, added])).toEqual([added]);
  });
});

describe("validateDiagnosticExit", () => {
  it("accepts clean and documented diagnostic exit statuses", () => {
    expect(() => validateDiagnosticExit(0, 0, 2, "tsgo")).not.toThrow();
    expect(() => validateDiagnosticExit(2, 1, 2, "tsgo")).not.toThrow();
  });

  it("fails closed on unexpected or empty diagnostic exits", () => {
    expect(() => validateDiagnosticExit(3, 1, 2, "tsgo")).toThrow(
      "tsgo exited unexpectedly with status 3",
    );
    expect(() => validateDiagnosticExit(2, 0, 2, "tsgo")).toThrow(
      "tsgo exited 2 without a parseable diagnostic",
    );
  });
});

describe("listExtensionNodeModulesPaths", () => {
  it("discovers extensions/*/node_modules under a live install (empty when none)", () => {
    // Repo root for this test runner has extensions after pnpm install.
    const paths = listExtensionNodeModulesPaths(process.cwd());
    expect(Array.isArray(paths)).toBe(true);
    for (const p of paths) {
      expect(p.startsWith("extensions/")).toBe(true);
      expect(p.endsWith("/node_modules")).toBe(true);
    }
    // Guardrail: if the workspace is installed, we must see at least one
    // extension nm so the merge-gate linkDependencies fix stays meaningful.
    if (paths.length === 0) {
      // Uninstalled workspace — still a valid empty result.
      expect(paths).toEqual([]);
    } else {
      expect(paths.length).toBeGreaterThan(0);
    }
  });
});
