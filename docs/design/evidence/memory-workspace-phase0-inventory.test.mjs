import assert from "node:assert/strict";
import test from "node:test";
import { analyzeSource } from "./memory-workspace-phase0-inventory-scan.mjs";
import {
  evaluateFreeze,
  freezeKey,
  resolveTrustedBaseline,
} from "./memory-workspace-phase0-inventory.mjs";

void test("detects named alias and file-local wrapper calls", () => {
  const text = `
    import { resolveAgentWorkspaceDir as getDir } from "./workspace.js";
    const alias = getDir;
    function wrapDir(agentId) {
      return getDir(agentId);
    }
    export function useWorkspace(agentId) {
      return wrapDir(agentId);
    }
    alias("bot-2");
    useWorkspace("bot-2");
  `;
  const { rows, wrappers, exportedWrappers } = analyzeSource("src/example.ts", text);
  assert.equal(wrappers.get("wrapDir"), "resolveAgentWorkspaceDir");
  assert.equal(wrappers.get("useWorkspace"), "resolveAgentWorkspaceDir");
  assert.equal(exportedWrappers.get("useWorkspace"), "resolveAgentWorkspaceDir");
  assert.ok(
    rows.some((row) => row.symbol === "resolveAgentWorkspaceDir" && /alias\(/.test(row.snippet)),
  );
  assert.ok(
    rows.some(
      (row) => row.symbol === "resolveAgentWorkspaceDir" && /useWorkspace\(/.test(row.snippet),
    ),
  );
});

void test("detects dynamic import callees including then() destructure", () => {
  const awaited = `
    async function load(agentId) {
      const { resolveAgentWorkspaceDir } = await import("./workspace.js");
      return resolveAgentWorkspaceDir(agentId);
    }
  `;
  const thened = `
    function load(agentId) {
      return import("./workspace.js").then(({ resolveMemoryWorkspaceDir: getMem }) => getMem(agentId));
    }
  `;
  const namespaced = `
    async function load(agentId) {
      const mod = await import("./workspace.js");
      return mod.resolveAgentWorkspaceDirForClient(agentId);
    }
  `;
  assert.equal(analyzeSource("src/dyn-a.ts", awaited).rows[0]?.symbol, "resolveAgentWorkspaceDir");
  assert.equal(analyzeSource("src/dyn-b.ts", thened).rows[0]?.symbol, "resolveMemoryWorkspaceDir");
  assert.equal(
    analyzeSource("src/dyn-c.ts", namespaced).rows[0]?.symbol,
    "resolveAgentWorkspaceDirForClient",
  );
});

void test("detects new helper declarations and catalog synthesis", () => {
  const text = `
    export function __resolveShadowWorkspaceDir() {}
    export function resolveExtraWorkspaceDir() {}
    createEmptyWorkspaceCatalog();
    buildUserOwnedWorkspaceCatalogEntry();
  `;
  const { rows, helpers } = analyzeSource("src/helpers.ts", text);
  assert.ok(
    helpers.some((row) => row.name === "__resolveShadowWorkspaceDir" && row.kind === "new-helper"),
  );
  assert.ok(
    helpers.some((row) => row.name === "resolveExtraWorkspaceDir" && row.kind === "new-helper"),
  );
  assert.ok(rows.some((row) => row.symbol === "createEmptyWorkspaceCatalog"));
  assert.ok(rows.some((row) => row.symbol === "buildUserOwnedWorkspaceCatalogEntry"));
});

void test("freeze fails on new production call site or helper", () => {
  const baseline = {
    callSites: [
      {
        pathId: "P1",
        symbol: "resolveAgentWorkspaceDir",
        file: "src/old.ts",
        line: 10,
        op: "read",
        profile: "production",
      },
    ],
    helpers: [],
  };
  const current = {
    callSites: [
      ...baseline.callSites,
      {
        pathId: "P1",
        symbol: "resolveAgentWorkspaceDir",
        file: "src/new.ts",
        line: 3,
        op: "write",
        profile: "production",
      },
    ],
    helpers: [
      {
        name: "__resolveNewWorkspaceDir",
        file: "src/new.ts",
        line: 1,
        kind: "new-helper",
        profile: "production",
      },
    ],
  };
  const result = evaluateFreeze(current, baseline);
  assert.equal(result.ok, false);
  assert.equal(result.addedProductionCallSites.length, 1);
  assert.equal(result.addedProductionHelpers.length, 1);
  assert.equal(freezeKey(result.addedProductionCallSites[0]).includes("src/new.ts"), true);
});

void test("does not treat fat functions as wrappers", () => {
  const text = `
    import { resolveAgentWorkspaceDir } from "./workspace.js";
    export function listAgentsForGateway(cfg) {
      const dir = resolveAgentWorkspaceDir("bot-2");
      const a = doSomething(cfg);
      const b = doMore(a);
      const c = doEvenMore(b);
      const d = finalize(c, dir);
      const e = annotate(d);
      const f = persist(e);
      return { agents: [f], dir };
    }
    listAgentsForGateway({});
  `;
  const { rows, wrappers } = analyzeSource("src/fat.ts", text);
  assert.equal(wrappers.has("listAgentsForGateway"), false);
  assert.equal(rows.filter((row) => /listAgentsForGateway\(/.test(row.snippet)).length, 0);
  assert.ok(rows.some((row) => /resolveAgentWorkspaceDir\(/.test(row.snippet)));
});

void test("detects cross-file exported wrappers via extraBindings", () => {
  const text = `
    import { useWorkspace as getWs } from "./wrappers.js";
    getWs("bot-2");
  `;
  const extra = new Map([["getWs", "resolveAgentWorkspaceDir"]]);
  const { rows } = analyzeSource("src/caller.ts", text, extra);
  assert.equal(rows[0]?.symbol, "resolveAgentWorkspaceDir");
  assert.match(rows[0]?.snippet ?? "", /getWs\(/);
});

void test("trusted freeze ignores a working-tree baseline that hides new call sites", () => {
  const trusted = {
    callSites: [
      {
        pathId: "P1",
        symbol: "resolveAgentWorkspaceDir",
        file: "src/old.ts",
        line: 10,
        op: "read",
        profile: "production",
      },
    ],
    helpers: [],
  };
  const current = {
    callSites: [
      ...trusted.callSites,
      {
        pathId: "P1",
        symbol: "resolveAgentWorkspaceDir",
        file: "src/new.ts",
        line: 3,
        op: "write",
        profile: "production",
      },
    ],
    helpers: [],
  };
  const poisonedWorkingTree = {
    callSites: current.callSites,
    helpers: [],
  };
  assert.equal(evaluateFreeze(current, poisonedWorkingTree).ok, true);
  assert.equal(evaluateFreeze(current, trusted).ok, false);
});

void test("resolveTrustedBaseline requires a git ref or blob", () => {
  assert.throws(
    () => resolveTrustedBaseline({ baselinePath: "missing.json" }),
    /baseline-ref origin\/main or --baseline-blob/,
  );
  const resolved = resolveTrustedBaseline({
    baselinePath: "docs/design/evidence/memory-workspace-phase0-20260814.call-sites.json",
    baselineRef: "HEAD",
  });
  assert.equal(resolved.trusted, true);
  assert.match(resolved.source, /^HEAD:/);
  assert.equal(typeof resolved.blob, "string");
  assert.ok(Array.isArray(resolved.baseline.callSites));
});

void test("freeze ignores test-only additions", () => {
  const baseline = { callSites: [], helpers: [] };
  const current = {
    callSites: [
      {
        pathId: "P1",
        symbol: "resolveAgentWorkspaceDir",
        file: "src/foo.test.ts",
        line: 4,
        op: "read",
        profile: "test",
      },
    ],
    helpers: [
      {
        name: "resolveTestWorkspaceDir",
        file: "src/foo.test.ts",
        line: 2,
        kind: "new-helper",
        profile: "test",
      },
    ],
  };
  assert.equal(evaluateFreeze(current, baseline).ok, true);
});
