import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { auditPageTabRouting, auditRepository } from "./check-knowledge-universe-page-tabs.mjs";

const contractSource = `
  export type KnowledgeUniversePageTab = "workbench" | "relations" | "spaceImport";
`;

const completeRouterSource = `
  switch (surface.pageTab) {
    case "relations": return renderRelations();
    case "spaceImport": return renderSpaceImport();
    default: return renderWorkbench();
  }
`;

const validCallerSource = "surface.onPageTabChange('relations');";

function audit(
  routerSource: string,
  callerSource = validCallerSource,
  pageTabContractSource = contractSource,
) {
  return auditPageTabRouting({
    contractSource: pageTabContractSource,
    routerSource,
    callSources: [{ path: "ui/src/ui/example.ts", source: callerSource }],
  });
}

function writeFixture(repo: string, path: string, source: string) {
  const target = join(repo, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, source, "utf8");
}

describe("Knowledge Universe page-tab routing audit", () => {
  it("accepts a complete router and valid literal callers", () => {
    const result = audit(completeRouterSource);

    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("checks direct and computed onPageTabChange calls", () => {
    const result = audit(
      completeRouterSource,
      `
        onPageTabChange("spaceImport");
        surface["onPageTabChange"]("relations");
      `,
    );

    expect(result.ok).toBe(true);
    expect(result.calls.map((call) => call.value)).toEqual(["spaceImport", "relations"]);
  });

  it("parses TSX text separately from calls inside JSX expressions", () => {
    const result = auditPageTabRouting({
      contractSource,
      routerSource: completeRouterSource,
      callSources: [
        {
          path: "ui/src/ui/example.tsx",
          source: `
            const example = <code>surface.onPageTabChange("retiredPopup")</code>;
            const button = (
              <button onClick={() => surface.onPageTabChange("spaceImport")}>Import</button>
            );
          `,
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.calls.map((call) => call.value)).toEqual(["spaceImport"]);
  });

  it.each([
    ["as", '"retiredPopup" as KnowledgeUniversePageTab'],
    ["type assertion", '<KnowledgeUniversePageTab>"retiredPopup"'],
    ["satisfies", '"retiredPopup" satisfies KnowledgeUniversePageTab'],
    ["parentheses", '(("retiredPopup"))'],
  ])("rejects an out-of-contract literal wrapped in %s", (_wrapper, argument) => {
    const result = audit(completeRouterSource, `surface.onPageTabChange(${argument});`);

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ kind: "unknown-call", value: "retiredPopup" }),
    );
  });

  it("fails when a union member lands without its router case", () => {
    const result = audit(`
      switch (surface.pageTab) {
        case "relations": return renderRelations();
        default: return renderWorkbench();
      }
    `);

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual({ kind: "missing-route", value: "spaceImport" });
  });

  it("fails when a literal caller uses a value outside the contract", () => {
    const result = audit(completeRouterSource, "surface.onPageTabChange('retiredPopup');");

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ kind: "unknown-call", value: "retiredPopup" }),
    );
  });

  it.each([
    {
      name: "the default tab is absent from the contract",
      routerSource: completeRouterSource,
      pageTabContractSource: 'export type KnowledgeUniversePageTab = "relations" | "spaceImport";',
      issue: { kind: "missing-default-contract", value: "workbench" },
    },
    {
      name: "more than one central router switch exists",
      routerSource: `${completeRouterSource}\n${completeRouterSource}`,
      pageTabContractSource: contractSource,
      issue: { kind: "router-switch-count", count: 2 },
    },
    {
      name: "the central router has no default clause",
      routerSource: `
        switch (surface.pageTab) {
          case "relations": return renderRelations();
          case "spaceImport": return renderSpaceImport();
        }
      `,
      pageTabContractSource: contractSource,
      issue: { kind: "missing-default-route", value: "workbench" },
    },
    {
      name: "the central router contains a non-literal case",
      routerSource: `
        switch (surface.pageTab) {
          case relationTab: return renderRelations();
          case "spaceImport": return renderSpaceImport();
          default: return renderWorkbench();
        }
      `,
      pageTabContractSource: contractSource,
      issue: { kind: "non-literal-route", expression: "relationTab" },
    },
    {
      name: "the central router contains an unknown case",
      routerSource: `
        switch (surface.pageTab) {
          case "relations": return renderRelations();
          case "spaceImport": return renderSpaceImport();
          case "retiredPopup": return renderRetiredPopup();
          default: return renderWorkbench();
        }
      `,
      pageTabContractSource: contractSource,
      issue: { kind: "unknown-route", value: "retiredPopup" },
    },
  ])("fails when $name", ({ routerSource, pageTabContractSource, issue }) => {
    const result = audit(routerSource, validCallerSource, pageTabContractSource);

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(issue);
  });

  it("exits nonzero when the repository fixture has a half-landed route", () => {
    const repo = mkdtempSync(join(tmpdir(), "openbot-page-tab-guard-"));
    const guardScript = resolve("scripts/check-knowledge-universe-page-tabs.mjs");
    try {
      execFileSync("git", ["init", "-q"], { cwd: repo });
      writeFixture(repo, "ui/src/ui/ports/employee/views/home-page-contracts.ts", contractSource);
      writeFixture(
        repo,
        "ui/src/ui/views/knowledge-universe-page.ts",
        `
          switch (surface.pageTab) {
            case "relations": return renderRelations();
            default: return renderWorkbench();
          }
        `,
      );
      writeFixture(repo, "ui/src/ui/example.ts", validCallerSource);
      execFileSync("git", ["add", "ui/src/ui"], { cwd: repo });

      const run = spawnSync(process.execPath, [guardScript], {
        cwd: repo,
        encoding: "utf8",
      });

      expect(run.error).toBeUndefined();
      expect(run.status).toBe(1);
      expect(run.stderr).toContain("'spaceImport' has no router case");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("accepts the repository's current contract, callers, and central router", () => {
    const result = auditRepository(process.cwd());
    expect(result.issues).toEqual([]);
  });
});
