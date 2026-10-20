import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { SCHEMA_V2_ENABLED } from "./schema-v2.js";
import {
  U0_AGENT_ID_LONG_TERM_SCOPE_BASELINE,
  U0_ALLOWED_AGENT_ID_LONG_TERM_SCOPE_FILES,
  U0_ALLOWED_MANAGER_CLASSES,
  U0_ALLOWED_SELF_RESOLVE_FILES,
  U0_ALLOWED_STABLE_ID_FILES,
  U0_CHECKED_INVENTORY_RELPATH,
  U0_FROZEN_MEMORY_BACKENDS,
  U0_INVENTORY_META,
  U0_MEMORY_BACKEND_TYPE_LITERAL,
  U0_P0_DEBT_MARKERS,
  U0_READ_ONLY_INVENTORY_SITES,
  U0_SELF_RESOLVE_BASELINE,
  U0_SELF_RESOLVE_CALLEES,
  U0_STABLE_ID_WS_BASELINE,
  buildU0ReadonlyInventoryDocument,
  findAgentIdLongTermScopeSites,
  findMemoryManagerClassNames,
  findStableIdWorkspaceIdentities,
  readCheckedU0ReadonlyInventory,
  scanAgentIdLongTermScope,
  scanSelfResolveCalls,
  scanStableIdWsCalls,
  type U0FrozenCallCount,
} from "./u0-boundary-freeze.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SYNTHETIC_ROOTS: string[] = [];

function readRepo(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
}

function writeSyntheticMemoryTree(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "u0-freeze-"));
  SYNTHETIC_ROOTS.push(root);
  for (const [rel, text] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
  }
  return root;
}

function countFor(rows: readonly U0FrozenCallCount[], file: string): number {
  return rows.find((row) => row.file === file)?.count ?? 0;
}

afterEach(() => {
  while (SYNTHETIC_ROOTS.length > 0) {
    const root = SYNTHETIC_ROOTS.pop();
    if (root) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

describe("U0 boundary freeze", () => {
  it("freezes production backends to builtin | qmd | cogniweave", () => {
    expect(U0_FROZEN_MEMORY_BACKENDS).toEqual(["builtin", "qmd", "cogniweave"]);
    expect(readRepo("src/config/types.memory.ts")).toContain(U0_MEMORY_BACKEND_TYPE_LITERAL);
    expect(readRepo("src/memory/types.ts")).toContain('backend: "builtin" | "qmd" | "cogniweave"');
    const managerClasses = findMemoryManagerClassNames(REPO_ROOT);
    for (const name of managerClasses) {
      expect(U0_ALLOWED_MANAGER_CLASSES).toContain(name);
    }
  });

  it("freezes current stableId(stateDir) debt and blocks new long-term identity sites", () => {
    expect(scanStableIdWsCalls(REPO_ROOT)).toEqual([...U0_STABLE_ID_WS_BASELINE]);
    expect(findStableIdWorkspaceIdentities(REPO_ROOT)).toEqual([...U0_ALLOWED_STABLE_ID_FILES]);
    const src = readRepo("src/memory/cogniweave-manager.ts");
    expect(src).toContain('stableId("ws", path.resolve(this.stateDir))');
    expect(src).toMatch(/agentId: this\.agentId|agentId: params\.agentId/);
    expect(src).not.toContain("createMemoryWorkspaceHandle");
    expect(src).toContain("memory-workspace-handle");
  });

  it("freezes each self-resolve call independently", () => {
    for (const callee of U0_SELF_RESOLVE_CALLEES) {
      expect(scanSelfResolveCalls(REPO_ROOT, callee), callee).toEqual([
        ...U0_SELF_RESOLVE_BASELINE[callee],
      ]);
      expect(scanSelfResolveCalls(REPO_ROOT, callee).map((row) => row.file)).toEqual([
        ...U0_ALLOWED_SELF_RESOLVE_FILES[callee],
      ]);
    }
    const src = readRepo("src/memory/cogniweave-manager.ts");
    for (const marker of U0_P0_DEBT_MARKERS) {
      expect(src).toContain(marker);
    }
  });

  it("fails when any one new self-resolve call site is added", () => {
    for (const callee of U0_SELF_RESOLVE_CALLEES) {
      const root = writeSyntheticMemoryTree({
        "src/memory/cogniweave-manager.ts": readRepo("src/memory/cogniweave-manager.ts"),
        "src/memory/new-self-resolve.ts": `export const probe = ${callee}(config, id);\n`,
      });
      const hits = scanSelfResolveCalls(root, callee);
      expect(hits.some((row) => row.file === "src/memory/new-self-resolve.ts")).toBe(true);
      expect(hits).not.toEqual([...U0_SELF_RESOLVE_BASELINE[callee]]);
    }
  });

  it("freezes the agentId long-term scope baseline", () => {
    expect(scanAgentIdLongTermScope(REPO_ROOT)).toEqual([...U0_AGENT_ID_LONG_TERM_SCOPE_BASELINE]);
    expect(findAgentIdLongTermScopeSites(REPO_ROOT)).toEqual([
      ...U0_ALLOWED_AGENT_ID_LONG_TERM_SCOPE_FILES,
    ]);
    expect(readRepo("src/memory/cogniweave-manager.ts")).toContain("scope.agentId");
    expect(readRepo("src/memory/memory-center-atoms.ts")).toContain("scope.agentId");
  });

  it("fails when a new agentId long-term scope site is added", () => {
    const root = writeSyntheticMemoryTree({
      "src/memory/cogniweave-manager.ts": "export const keep = scope.agentId;\n",
      "src/memory/memory-center-atoms.ts": "export const keep = scope.agentId;\n",
      "src/memory/new-agentid-scope.ts": "export const leaked = { agentId: runtimeId() };\n",
    });
    const hits = scanAgentIdLongTermScope(root);
    expect(hits.some((row) => row.file === "src/memory/new-agentid-scope.ts")).toBe(true);
    expect(hits).not.toEqual([...U0_AGENT_ID_LONG_TERM_SCOPE_BASELINE]);
  });

  it("keeps schema v2 closed so it cannot become a second canonical store", () => {
    expect(SCHEMA_V2_ENABLED).toBe(false);
    expect(readRepo("src/memory/manager-sync-ops.ts")).not.toMatch(/schema-v2/);
    expect(readRepo("src/memory/memory-schema.ts")).not.toMatch(/schema-v2/);
    expect(U0_INVENTORY_META.productionSoT).toBe(false);
    expect(U0_INVENTORY_META.deployAuthorized).toBe(false);
  });

  it("records a real read-only inventory with required fields and live symbols", () => {
    const required = [
      "backend",
      "file",
      "symbol",
      "operation",
      "identitySource",
      "scopeSource",
      "pathResolution",
      "fallback",
      "owner",
      "retirementPhase",
    ] as const;
    expect(U0_READ_ONLY_INVENTORY_SITES.length).toBeGreaterThanOrEqual(10);
    expect(U0_INVENTORY_META.siteCount).toBe(U0_READ_ONLY_INVENTORY_SITES.length);
    expect(
      U0_READ_ONLY_INVENTORY_SITES.filter(
        (row) => row.file === "src/memory/manager-embedding-ops.ts",
      ).map((row) => row.symbol),
    ).toEqual(["indexFile", "upsertEmbeddingCache", "pruneEmbeddingCacheIfNeeded"]);
    for (const row of U0_READ_ONLY_INVENTORY_SITES) {
      for (const key of required) {
        expect(row[key], `${row.file}:${row.symbol}.${key}`).toBeTruthy();
      }
      const text = readRepo(row.file);
      expect(text, row.file).toContain(row.symbol);
    }
    const document = buildU0ReadonlyInventoryDocument();
    expect(document.productionSoT).toBe(false);
    expect(document.sites).toHaveLength(U0_READ_ONLY_INVENTORY_SITES.length);
  });

  it("keeps the checked inventory JSON identical to buildU0ReadonlyInventoryDocument()", () => {
    expect(U0_CHECKED_INVENTORY_RELPATH).toBe(
      "docs/design/evidence/openbot-cogniweave-u0-readonly-inventory-2026-08-19.json",
    );
    expect(readCheckedU0ReadonlyInventory(REPO_ROOT)).toEqual(buildU0ReadonlyInventoryDocument());
  });

  it("does not miss renamed or wrapped self-resolve arguments", () => {
    const root = writeSyntheticMemoryTree({
      "src/memory/renamed-args.ts": `
        export const a = resolveAgentWorkspaceDir(
          renamedCfg,
          renamedId,
          extra,
        );
        export const b = resolveStateDir(env);
        export const c = resolveDataRoot(cfg);
      `,
    });
    expect(scanSelfResolveCalls(root, "resolveAgentWorkspaceDir")).toEqual([
      { file: "src/memory/renamed-args.ts", count: 1 },
    ]);
    expect(scanSelfResolveCalls(root, "resolveStateDir")).toEqual([
      { file: "src/memory/renamed-args.ts", count: 1 },
    ]);
    expect(scanSelfResolveCalls(root, "resolveDataRoot")).toEqual([
      { file: "src/memory/renamed-args.ts", count: 1 },
    ]);
  });

  it("fails when an allowed file gains a second self-resolve or stableId call", () => {
    const manager = `${readRepo("src/memory/manager.ts")}\nvoid resolveAgentWorkspaceDir(x, y);\n`;
    const cogniweave = `${readRepo("src/memory/cogniweave-manager.ts")}\nvoid stableId("ws", otherDir);\nvoid resolveStateDir(env);\n`;
    const root = writeSyntheticMemoryTree({
      "src/memory/manager.ts": manager,
      "src/memory/cogniweave-manager.ts": cogniweave,
    });
    expect(
      countFor(scanSelfResolveCalls(root, "resolveAgentWorkspaceDir"), "src/memory/manager.ts"),
    ).toBe(
      countFor(U0_SELF_RESOLVE_BASELINE.resolveAgentWorkspaceDir, "src/memory/manager.ts") + 1,
    );
    expect(
      countFor(scanSelfResolveCalls(root, "resolveStateDir"), "src/memory/cogniweave-manager.ts"),
    ).toBe(
      countFor(U0_SELF_RESOLVE_BASELINE.resolveStateDir, "src/memory/cogniweave-manager.ts") + 1,
    );
    expect(countFor(scanStableIdWsCalls(root), "src/memory/cogniweave-manager.ts")).toBe(
      countFor(U0_STABLE_ID_WS_BASELINE, "src/memory/cogniweave-manager.ts") + 1,
    );
    expect(scanSelfResolveCalls(root, "resolveAgentWorkspaceDir")).not.toEqual([
      ...U0_SELF_RESOLVE_BASELINE.resolveAgentWorkspaceDir,
    ]);
    expect(scanStableIdWsCalls(root)).not.toEqual([...U0_STABLE_ID_WS_BASELINE]);
  });

  it("counts agentId scope, this/params assignments, and arbitrary runtime expressions", () => {
    const root = writeSyntheticMemoryTree({
      "src/memory/agentid-shapes.ts": `
        export const access = scope.agentId;
        export const nested = params.scope.agentId;
        export const fromThis = { agentId: this.agentId };
        export const fromParams = { agentId: params.agentId };
        export const fromRuntime = {
          agentId:
            runtimeExpr(),
        };
      `,
    });
    expect(scanAgentIdLongTermScope(root)).toEqual([
      { file: "src/memory/agentid-shapes.ts", count: 5 },
    ]);
  });

  it("fails when an allowed file gains another agentId long-term scope use", () => {
    const extra = `${readRepo("src/memory/memory-center-atoms.ts")}\nexport const leaked = { agentId: runtimeId() };\n`;
    const root = writeSyntheticMemoryTree({
      "src/memory/memory-center-atoms.ts": extra,
    });
    expect(countFor(scanAgentIdLongTermScope(root), "src/memory/memory-center-atoms.ts")).toBe(
      countFor(U0_AGENT_ID_LONG_TERM_SCOPE_BASELINE, "src/memory/memory-center-atoms.ts") + 1,
    );
    expect(scanAgentIdLongTermScope(root)).not.toEqual([...U0_AGENT_ID_LONG_TERM_SCOPE_BASELINE]);
  });
});
