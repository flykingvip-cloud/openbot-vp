import { describe, expect, it } from "vitest";
import {
  auditFiles,
  canWriteBaselineOnto,
  classifyFile,
  parseExportSurface,
  resolveRelativeDependencies,
  type TreeReader,
} from "./file-forward-guard.ts";

function tree(files: Record<string, string>): TreeReader {
  return {
    read: (path) => files[path] ?? null,
    list: () => Object.keys(files),
  };
}

describe("parseExportSurface", () => {
  it("collects declaration exports across every declaration keyword", () => {
    const surface = parseExportSurface(`
export function a() {}
export async function b() {}
export function* c() {}
export class D {}
export abstract class E {}
export const f = 1;
export let g = 2;
export var h = 3;
export type I = string;
export interface J {}
export enum K {}
export declare const l: number;
`);
    expect([...surface.names].toSorted()).toEqual([
      "D",
      "E",
      "I",
      "J",
      "K",
      "a",
      "b",
      "c",
      "f",
      "g",
      "h",
      "l",
    ]);
  });

  it("takes the name after `as` for aliased re-exports", () => {
    const surface = parseExportSurface(
      `export { redactSecretText as redactSecrets } from "./x.js";`,
    );
    expect(surface.names.has("redactSecrets")).toBe(true);
    expect(surface.names.has("redactSecretText")).toBe(false);
  });

  it("collects braced and type-only export lists with or without `from`", () => {
    const surface = parseExportSurface(`
export { a, b as c };
export type { D, E as F } from "./types.ts";
export * as NS from "./ns.ts";
`);
    expect([...surface.names].toSorted()).toEqual(["D", "F", "NS", "a", "c"]);
  });

  it("records `export * from` separately because it cannot be enumerated", () => {
    const surface = parseExportSurface(`export * from "./barrel.ts";`);
    expect(surface.names.size).toBe(0);
    expect(surface.starReexports).toEqual(["./barrel.ts"]);
  });
});

describe("classifyFile", () => {
  const baseline = tree({ "a.ts": "export function keep() {}\nexport function drop() {}\n" });

  it("reports a dropped export with nowhere else to find it as a regression", () => {
    const finding = classifyFile("a.ts", baseline, tree({ "a.ts": "export function keep() {}\n" }));
    expect(finding.verdict).toBe("regression");
    expect(finding.lost).toEqual([{ name: "drop", disposition: "gone" }]);
  });

  it("does not call a move a regression", () => {
    const finding = classifyFile(
      "a.ts",
      baseline,
      tree({ "a.ts": "export function keep() {}\n", "shared.ts": "export function drop() {}\n" }),
    );
    expect(finding.verdict).toBe("diverged");
    expect(finding.lost).toEqual([{ name: "drop", disposition: "moved", movedTo: "shared.ts" }]);
  });

  it("does not flag an alias re-export of a moved implementation", () => {
    // The false positive that produced a wrong REGRESSION during the audit: the name the
    // importers use is unchanged, only the implementation moved.
    const finding = classifyFile(
      "format.ts",
      tree({ "format.ts": "export function redactSecrets(t: string) {\n  return t;\n}\n" }),
      tree({
        "format.ts": `export { redactSecretText as redactSecrets } from "./shared.ts";`,
        "shared.ts": "export function redactSecretText(t: string) {\n  return t;\n}\n",
      }),
    );
    expect(finding.verdict).not.toBe("regression");
    expect(finding.lost).toEqual([]);
  });

  it("calls a pure addition ahead", () => {
    const finding = classifyFile(
      "a.ts",
      baseline,
      tree({
        "a.ts": "export function keep() {}\nexport function drop() {}\nexport const extra = 1;\n",
      }),
    );
    expect(finding.verdict).toBe("ahead");
    expect(finding.added).toEqual(["extra"]);
  });

  it("reports byte-identical content as identical", () => {
    expect(classifyFile("a.ts", baseline, baseline).verdict).toBe("identical");
  });

  it("treats a wholesale deletion as lost exports, not as an empty diff", () => {
    const finding = classifyFile("a.ts", baseline, tree({}));
    expect(finding.verdict).toBe("deleted");
    expect(finding.lost.map((entry) => entry.name)).toEqual(["drop", "keep"]);
  });

  it("surfaces a star re-export so the lost set is never read as complete", () => {
    const finding = classifyFile(
      "a.ts",
      tree({ "a.ts": `export * from "./old.ts";\nexport const x = 1;\n` }),
      tree({ "a.ts": `export * from "./old.ts";\nexport const y = 1;\n` }),
    );
    expect(finding.starReexportWarning).toEqual(["./old.ts"]);
  });
});

describe("auditFiles", () => {
  it("counts verdicts and isolates the blocking set", () => {
    const summary = auditFiles(
      ["gone.ts", "same.ts", "added.ts"],
      tree({
        "gone.ts": "export const a = 1;\nexport const b = 2;\n",
        "same.ts": "export const c = 3;\n",
      }),
      tree({
        "gone.ts": "export const a = 1;\n",
        "same.ts": "export const c = 3;\n",
        "added.ts": "export const d = 4;\n",
      }),
    );
    expect(summary.counts).toEqual({
      identical: 1,
      regression: 1,
      diverged: 0,
      ahead: 0,
      new: 1,
      deleted: 0,
    });
    expect(summary.regressions.map((finding) => finding.path)).toEqual(["gone.ts"]);
  });
});

describe("resolveRelativeDependencies", () => {
  const target = tree({
    "src/infra/redact.ts": "",
    "src/infra/nested/index.ts": "",
    "src/a.ts": "",
  });

  it("maps a .js specifier onto the .ts file that backs it", () => {
    const findings = resolveRelativeDependencies(
      "src/cmd/format.ts",
      `import { x } from "../infra/redact.js";`,
      target,
    );
    expect(findings).toEqual([
      { specifier: "../infra/redact.js", resolvedTo: "src/infra/redact.ts" },
    ]);
  });

  it("resolves a directory specifier through index.ts", () => {
    const findings = resolveRelativeDependencies(
      "src/cmd/a.ts",
      `import { y } from "../infra/nested";`,
      target,
    );
    expect(findings[0].resolvedTo).toBe("src/infra/nested/index.ts");
  });

  it("reports an unresolvable specifier as null rather than guessing", () => {
    const findings = resolveRelativeDependencies(
      "src/a.ts",
      `import { z } from "./missing.js";`,
      target,
    );
    expect(findings).toEqual([{ specifier: "./missing.js", resolvedTo: null }]);
  });

  it("also inspects dynamic imports", () => {
    const findings = resolveRelativeDependencies(
      "src/a.ts",
      `const m = await import("./missing.js");`,
      target,
    );
    expect(findings[0].specifier).toBe("./missing.js");
  });
});

describe("canWriteBaselineOnto", () => {
  it("clears a repair whose dependencies all exist on the target", () => {
    const result = canWriteBaselineOnto(
      "src/a.ts",
      tree({ "src/a.ts": `import { x } from "./b.js";` }),
      tree({ "src/b.ts": "" }),
    );
    expect(result).toEqual({ path: "src/a.ts", feasible: true, unresolved: [] });
  });

  it("names the cascade instead of failing at build time", () => {
    const result = canWriteBaselineOnto(
      "src/a.ts",
      tree({
        "src/a.ts": `import { x } from "./tenant-context.js";\nimport { y } from "./ok.js";`,
      }),
      tree({ "src/ok.ts": "" }),
    );
    expect(result.feasible).toBe(false);
    expect(result.unresolved).toEqual(["./tenant-context.js"]);
  });
});
