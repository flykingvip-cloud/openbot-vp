/**
 * Memory effect-acceptance matrix harness (extends O8 layered baseline).
 *
 * Status model: passed | failed | not-run. not-run never increments passed.
 * scaffoldInternalOnly / notSystemEffectiveness — NEVER claim production/online
 * effect verified, full E2E, model adoption, or fact-level forget product.
 *
 * OPENBOT_MEMORY_EFFECT_MATRIX_OUT — optional JSON output path (must not exist).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  createMemoryPartitionKeyV1,
  createMemorySubjectBinding,
  LocalMetadataStore,
  resolveLocalMemorySubject,
  type MemoryAtom,
  type Scope,
} from "../../packages/cogniweave-sdk/src/index.js";
import { createCogniWeaveRuntime } from "../../packages/cogniweave-sdk/src/runtime/bootstrap.js";
import type { OpenBotConfig } from "../config/config.js";
import { forgetMemoryEntry } from "../data/memory-lifecycle.js";
import { listAgentMemoryEntries } from "../data/memory-list.js";
import { resolveMemoryBackendConfig } from "./backend-config.js";
import { CogniWeaveMemoryManager } from "./cogniweave-manager.js";
import {
  applyIsolationEnv,
  assertNoRealHomeLeak,
  assertPathInsideIsolation,
  createIsolationLayout,
  resolveIsolationStoragePaths,
  writeIsolationConfig,
  type IsolationLayout,
} from "./memory-batch1-isolation.js";
import { listMemoryCenterAtomsReadonly } from "./memory-center-o4-readonly.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

type Layer =
  | "isolation"
  | "manager-integration"
  | "helper-integration"
  | "data-layer"
  | "sdk-unit"
  | "o4-statusView"
  | "path1-forget-vs-multi-source"
  | "gateway-handler-chain"
  | "model-effect"
  | "production-online";

type CaseStatus = "passed" | "failed" | "not-run";

type EffectCase = {
  id: string;
  scenario: string;
  layer: Layer;
  status: CaseStatus;
  /** @deprecated use status; not-run must be false */
  pass: boolean;
  executed: boolean;
  untestedSteps: string[];
  detail: Record<string, unknown>;
  covers: string[];
  doesNotClaim: string[];
};

const cases: EffectCase[] = [];
const cleanups: Array<() => void | Promise<void>> = [];

function record(
  entry: Omit<EffectCase, "status" | "pass"> & { status: CaseStatus; pass?: boolean },
): void {
  const status = entry.status;
  cases.push({ ...entry, status, pass: status === "passed" });
}

function summarizeCases(list: EffectCase[]) {
  const passed = list.filter((c) => c.status === "passed").length;
  const failed = list.filter((c) => c.status === "failed").length;
  const notRun = list.filter((c) => c.status === "not-run").length;
  const byLayer: Record<string, { total: number; passed: number; failed: number; notRun: number }> =
    {};
  for (const c of list) {
    const slot = (byLayer[c.layer] ??= { total: 0, passed: 0, failed: 0, notRun: 0 });
    slot.total += 1;
    if (c.status === "passed") {
      slot.passed += 1;
    } else if (c.status === "failed") {
      slot.failed += 1;
    } else {
      slot.notRun += 1;
    }
  }
  return {
    byLayer,
    summary: {
      total: list.length,
      passed,
      failed,
      notRun,
      executedCaseIds: list.filter((c) => c.executed).map((c) => c.id),
      notRunCaseIds: list.filter((c) => c.status === "not-run").map((c) => c.id),
      scaffoldInternalOnly: true,
      notSystemEffectiveness: true,
      productionOnlineEffectVerified: false,
      factLevelForgetProduct: false,
    },
  };
}

function createCfg(layout: IsolationLayout): OpenBotConfig {
  return {
    data: { root: layout.dataRoot, mode: "local", schemaVersion: 1 },
    memory: {
      backend: "cogniweave",
      cogniweave: { mode: "embedded", writeSync: "sync", cloudSync: { enabled: false } },
    },
    agents: {
      defaults: { workspace: layout.workspace, memorySearch: { enabled: true } },
      list: [{ id: "main", default: true, workspace: layout.workspace }],
    },
  };
}

function synthAtom(
  id: string,
  scope: Scope,
  status: MemoryAtom["state"]["status"],
  statement?: string,
): MemoryAtom {
  return {
    id,
    atomType: "heuristic",
    scope,
    claim: { type: "heuristic", statement: statement ?? `claim-${id}` },
    trigger: { conditions: ["default"], contextTags: ["effect-matrix"] },
    applicability: { include: [], exclude: [] },
    provenance: { sourceEventIds: [], evidenceRefs: [] },
    versioning: { version: 1 },
    state: { status, conflictsWith: [] },
    metrics: { confidence: 0.5, reuseCount: 0 },
  };
}

async function seedSqliteStore(params: {
  storePath: string;
  scope: Scope;
  atoms: MemoryAtom[];
  skipBinding?: boolean;
}): Promise<void> {
  const store = new LocalMetadataStore({
    path: params.storePath,
    backend: "local",
    environment: "local",
  });
  const dataPlaneId = await store.ensureDataPlaneId();
  for (const atom of params.atoms) {
    await store.saveAtom(atom);
  }
  if (!params.skipBinding) {
    const caller = resolveLocalMemorySubject(params.scope.agentId, "agent");
    const partition = createMemoryPartitionKeyV1(dataPlaneId, params.scope);
    const binding = createMemorySubjectBinding({
      partition,
      scope: params.scope,
      subject: caller,
      scopeType: "agent",
    });
    await store.saveMemorySubjectBinding(binding);
  }
  store.close();
}

function gitHead(): string {
  try {
    return fs.readFileSync(path.join(REPO_ROOT, ".git", "HEAD"), "utf8").trim();
  } catch {
    return "unknown";
  }
}

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
});

describe("memory effect-acceptance matrix (extends O8)", () => {
  it("records effect matrix without claiming production/online effect", async () => {
    const layout = createIsolationLayout("openbot-effect-mx-");
    cleanups.push(() => fs.rmSync(layout.root, { recursive: true, force: true }));
    cleanups.push(applyIsolationEnv(layout));
    writeIsolationConfig(layout);
    const resolvedPaths = resolveIsolationStoragePaths(layout);
    for (const p of Object.values(resolvedPaths)) {
      if (typeof p === "string") {
        assertPathInsideIsolation(p, layout.root);
        assertNoRealHomeLeak(p);
      }
    }
    record({
      id: "EFF-ISO-1",
      scenario: "isolation-path-assert",
      layer: "isolation",
      status: "passed",
      executed: true,
      untestedSteps: [],
      detail: { resolvedPaths },
      covers: ["synthetic isolation roots; no real ~/.openbot or ~/OpenBot"],
      doesNotClaim: ["production paths", "online host state"],
    });

    const scopeA: Scope = {
      workspaceId: "ws-effect-mx",
      projectId: "agent:main",
      agentId: "main",
      visibility: "private",
    };
    const cfg = createCfg(layout);

    // --- Layer: manager-integration — recall via manager.search ---
    {
      const phrase = "EffectMatrixRecallAlphaToken";
      fs.writeFileSync(path.join(layout.workspace, "MEMORY.md"), `${phrase}\n`, "utf8");
      const resolved = resolveMemoryBackendConfig({ cfg, agentId: "main" });
      if (!resolved.cogniweave) {
        throw new Error("missing cogniweave");
      }
      const manager = await CogniWeaveMemoryManager.create({
        cfg,
        agentId: "main",
        resolved: resolved.cogniweave,
      });
      const hits = await manager.search("EffectMatrixRecallAlpha", { maxResults: 5 });
      await manager.close();
      record({
        id: "EFF-RECALL-1",
        scenario: "recall-manager-search",
        layer: "manager-integration",
        status: hits.length > 0 ? "passed" : "failed",
        executed: true,
        untestedSteps: [
          "real-tool-call-chain",
          "reply-handler-injection",
          "prompt-construction-with-recalled-memory",
          "production-online-recall",
        ],
        detail: { hitCount: hits.length, paths: hits.map((h) => h.path) },
        covers: ["CogniWeaveMemoryManager.search after workspace MEMORY.md ingest"],
        doesNotClaim: [
          "production/online recall",
          "model adoption",
          "gateway tool chain",
          "full E2E",
        ],
      });
    }

    // --- Layer: data-layer — path1 list ---
    {
      fs.mkdirSync(path.join(layout.workspace, "memory"), { recursive: true });
      fs.writeFileSync(path.join(layout.workspace, "MEMORY.md"), "list-root\n", "utf8");
      fs.writeFileSync(path.join(layout.workspace, "memory", "listed.md"), "list-nested\n", "utf8");
      const dsLegacy = path.join(layout.dataRoot, "agents", "main", "memory", "agent");
      fs.mkdirSync(dsLegacy, { recursive: true });
      fs.writeFileSync(path.join(dsLegacy, "legacy.md"), "ds-legacy-must-not-list\n", "utf8");

      const listed = await listAgentMemoryEntries({ cfg, agentId: "main" });
      const keys = listed.entries.map((e) => e.key.toLowerCase());
      const hasWorkspace =
        keys.some((k) => k === "memory.md") && keys.some((k) => k === "memory/listed.md");
      const hasDsLegacy = keys.some(
        (k) => k.includes("agents/main/memory/agent") || k.endsWith("legacy.md"),
      );
      record({
        id: "EFF-LIST-1",
        scenario: "path1-list-workspace-corpus",
        layer: "data-layer",
        status: hasWorkspace && !hasDsLegacy ? "passed" : "failed",
        executed: true,
        untestedSteps: ["gateway memory.list RPC transport"],
        detail: { keys: listed.entries.map((e) => e.key), hasDsLegacy },
        covers: [
          "listAgentMemoryEntries returns workspace MEMORY.md + memory/**/*.md",
          "DS legacy memory/agent not listed (path1)",
        ],
        doesNotClaim: ["gateway list RPC", "UI Memory Center full chain"],
      });
    }

    // --- Layer: sdk-unit — ACL ---
    {
      const runtime = createCogniWeaveRuntime({
        environment: "local",
        metadataBackend: "memory",
        graphBackend: "memory",
        evidenceBackend: "memory",
        vectorBackend: "memory",
        defaultScope: scopeA,
      });
      const scopeB: Scope = {
        workspaceId: "ws-effect-mx",
        projectId: "agent:other",
        agentId: "other",
        visibility: "private",
      };
      await runtime.engine.upsertAtoms([
        synthAtom("acl-a1", scopeA, "active"),
        synthAtom("acl-b1", scopeB, "active"),
        synthAtom("acl-a-dep", scopeA, "deprecated"),
      ]);
      await runtime.engine.ensureMemorySubjectBinding({
        scope: scopeA,
        caller: { tenantId: "__local__", ownerType: "agent", ownerId: "main" },
        scopeType: "agent",
      });
      const bound = await runtime.engine.queryAtoms({
        scope: scopeA,
        caller: { tenantId: "__local__", ownerType: "agent", ownerId: "main" },
        filter: { limit: 10 },
      });
      const unbound = await runtime.engine.queryAtoms({
        scope: scopeA,
        caller: { tenantId: "__local__", ownerType: "agent", ownerId: "intruder" },
        filter: { limit: 10 },
      });
      const boundOk = bound.map((h) => h.atom.id).includes("acl-a1") && bound.length === 1;
      record({
        id: "EFF-ACL-1",
        scenario: "acl-bound-active-in-scope",
        layer: "sdk-unit",
        status: boundOk ? "passed" : "failed",
        executed: true,
        untestedSteps: [],
        detail: { ids: bound.map((h) => h.atom.id) },
        covers: ["queryAtoms ACL: bound legal subject sees active in-scope only"],
        doesNotClaim: ["gateway auth", "production ACL enforcement online"],
      });
      record({
        id: "EFF-ACL-2",
        scenario: "acl-wrong-owner-deny",
        layer: "sdk-unit",
        status: unbound.length === 0 ? "passed" : "failed",
        executed: true,
        untestedSteps: [],
        detail: { hitCount: unbound.length },
        covers: ["queryAtoms ACL: wrong-owner fail-closed empty hits"],
        doesNotClaim: ["gateway auth chain", "live multi-tenant prod"],
      });
    }

    // --- Layer: o4-statusView ---
    {
      const storePath = path.join(layout.dataRoot, "effect-o4-canonical.sqlite");
      await seedSqliteStore({
        storePath,
        scope: scopeA,
        atoms: [
          synthAtom("eff-active-1", scopeA, "active"),
          synthAtom("eff-active-2", scopeA, "active"),
          synthAtom("eff-tent-1", scopeA, "tentative"),
          synthAtom("eff-tent-2", scopeA, "tentative"),
          synthAtom("eff-dep-1", scopeA, "deprecated"),
        ],
      });
      const active = await listMemoryCenterAtomsReadonly({
        metadataStorePath: storePath,
        scope: scopeA,
        agentId: "main",
        statusView: "active",
        limit: 10,
        backend: "cogniweave",
        cogniweaveMode: "embedded",
      });
      const tentative = await listMemoryCenterAtomsReadonly({
        metadataStorePath: storePath,
        scope: scopeA,
        agentId: "main",
        statusView: "tentative",
        limit: 10,
        backend: "cogniweave",
        cogniweaveMode: "embedded",
      });
      const unboundStore = path.join(layout.dataRoot, "effect-o4-unbound.sqlite");
      await seedSqliteStore({
        storePath: unboundStore,
        scope: scopeA,
        atoms: [synthAtom("eff-u1", scopeA, "active")],
        skipBinding: true,
      });
      const unbound = await listMemoryCenterAtomsReadonly({
        metadataStorePath: unboundStore,
        scope: scopeA,
        agentId: "main",
        statusView: "active",
        limit: 10,
        backend: "cogniweave",
        cogniweaveMode: "embedded",
      });

      const activeOk =
        active.ok &&
        active.total === 2 &&
        active.atoms.every((a) => a.status === "active") &&
        !active.atoms.some((a) => a.id.startsWith("eff-tent"));
      const tentOk =
        tentative.ok &&
        tentative.total === 2 &&
        tentative.atoms.every((a) => a.status === "tentative");
      const unboundOk = !unbound.ok && unbound.code === "MEMORY_SUBJECT_UNBOUND";

      record({
        id: "EFF-O4-1",
        scenario: "o4-statusView-active-filter",
        layer: "o4-statusView",
        status: activeOk ? "passed" : "failed",
        executed: true,
        untestedSteps: ["full Memory Center UI client chain", "real auth session"],
        detail: {
          ok: active.ok,
          total: active.ok ? active.total : null,
          ids: active.ok ? active.atoms.map((a) => a.id) : [],
        },
        covers: ["listMemoryCenterAtomsReadonly statusView=active exact filter"],
        doesNotClaim: ["UI statusView end-to-end", "production Memory Center"],
      });
      record({
        id: "EFF-O4-2",
        scenario: "o4-statusView-tentative-filter",
        layer: "o4-statusView",
        status: tentOk ? "passed" : "failed",
        executed: true,
        untestedSteps: ["full Memory Center UI client chain"],
        detail: {
          ok: tentative.ok,
          total: tentative.ok ? tentative.total : null,
          ids: tentative.ok ? tentative.atoms.map((a) => a.id) : [],
        },
        covers: ["listMemoryCenterAtomsReadonly statusView=tentative exact filter"],
        doesNotClaim: ["UI statusView end-to-end", "production Memory Center"],
      });
      record({
        id: "EFF-O4-3",
        scenario: "o4-statusView-unbound-deny",
        layer: "o4-statusView",
        status: unboundOk ? "passed" : "failed",
        executed: true,
        untestedSteps: [],
        detail: { ok: unbound.ok, code: unbound.ok ? null : unbound.code },
        covers: ["O4 readonly refuses unbound subject (MEMORY_SUBJECT_UNBOUND)"],
        doesNotClaim: ["gateway auth", "live binding issuance"],
      });
    }

    // --- Layer: path1 forget vs multi-source (from forget assessment) ---
    {
      const phrase = "EffectMultiSourceSamePhraseToken";
      const keyA = "MEMORY.md";
      const keyB = "memory/effect-multi-b.md";
      fs.mkdirSync(path.join(layout.workspace, "memory"), { recursive: true });
      fs.writeFileSync(path.join(layout.workspace, keyA), `${phrase}\nfrom-A\n`, "utf8");
      fs.writeFileSync(path.join(layout.workspace, keyB), `${phrase}\nfrom-B\n`, "utf8");
      // DS legacy control (must remain untouched by path1 forget)
      const dsLegacyFile = path.join(
        layout.dataRoot,
        "agents",
        "main",
        "memory",
        "agent",
        "ds-control.md",
      );
      fs.mkdirSync(path.dirname(dsLegacyFile), { recursive: true });
      fs.writeFileSync(dsLegacyFile, `${phrase}\nds-legacy\n`, "utf8");

      const resolved = resolveMemoryBackendConfig({ cfg, agentId: "main" });
      if (!resolved.cogniweave) {
        throw new Error("missing cogniweave");
      }
      const manager = await CogniWeaveMemoryManager.create({
        cfg,
        agentId: "main",
        resolved: resolved.cogniweave,
      });
      const before = await manager.search("EffectMultiSourceSamePhrase", { maxResults: 10 });

      // Forget source A only (path1 file scope)
      const deletedA = await forgetMemoryEntry({ cfg, agentId: "main", memoryKey: keyA });
      const aGone = !fs.existsSync(path.join(layout.workspace, keyA));
      const bRemains = fs.existsSync(path.join(layout.workspace, keyB));
      const dsUntouched = fs.existsSync(dsLegacyFile);

      const after = await manager.search("EffectMultiSourceSamePhrase", { maxResults: 10 });
      await manager.close();

      const bStillSearchable = after.some(
        (h) => h.path === keyB || h.path?.endsWith(keyB) || h.path?.includes("effect-multi-b"),
      );
      // Per forget assessment §3: delete A leave B is EXPECTED — not a forget bug.
      const multiSourceExpected =
        Boolean(deletedA.deletedPath) && aGone && bRemains && dsUntouched && bStillSearchable;

      record({
        id: "EFF-FORGET-PATH1-1",
        scenario: "path1-forget-file-scope",
        layer: "path1-forget-vs-multi-source",
        status: Boolean(deletedA.deletedPath) && aGone && dsUntouched ? "passed" : "failed",
        executed: true,
        untestedSteps: [
          "gateway data.memory.forget handler chain",
          "fact-level forget across all sources",
          "D4 cogniweave forget-lifecycle chaining",
        ],
        detail: {
          deletedPath: deletedA.deletedPath,
          aGone,
          dsUntouched,
          beforeHits: before.length,
          note: "path1 forgetMemoryEntry helper only; not gateway chain",
        },
        covers: [
          "forgetMemoryEntry deletes workspace-indexed MEMORY.md",
          "DS legacy memory/agent untouched by path1 forget",
        ],
        doesNotClaim: [
          "gateway forget RPC",
          "fact-level forget product",
          "D4 lifecycle chaining",
          "production online effect",
        ],
      });

      record({
        id: "EFF-MULTI-1",
        scenario: "multi-source-delete-A-leave-B-expected",
        layer: "path1-forget-vs-multi-source",
        status: multiSourceExpected ? "passed" : "failed",
        executed: true,
        untestedSteps: ["fact-level forget all-sources product"],
        detail: {
          aGone,
          bRemains,
          bStillSearchable,
          afterHits: after.length,
          assessmentRef:
            "docs/design/memory-fact-level-forget-assessment-2026-10-27.md §3 — 删 A 留 B 是预期，不得判遗忘故障",
        },
        covers: [
          "same phrase in MEMORY.md (A) + memory/*.md (B); forget A leaves B searchable",
          "documents expected multi-source residual (not a defect)",
        ],
        doesNotClaim: [
          "fact-level all-source forget",
          "production forget UX completion",
          "model no-longer-adopts residual B",
        ],
      });

      // Reject non-indexed / escape keys
      const rejectDs = await forgetMemoryEntry({
        cfg,
        agentId: "main",
        memoryKey: "agents/main/memory/agent/ds-control.md",
      });
      const rejectTrav = await forgetMemoryEntry({
        cfg,
        agentId: "main",
        memoryKey: "../MEMORY.md",
      });
      record({
        id: "EFF-FORGET-PATH1-2",
        scenario: "path1-forget-rejects-non-corpus",
        layer: "helper-integration",
        status:
          rejectDs.deletedPath === null && rejectTrav.deletedPath === null ? "passed" : "failed",
        executed: true,
        untestedSteps: [],
        detail: {
          rejectDs: rejectDs.deletedPath,
          rejectTrav: rejectTrav.deletedPath,
          dsStillExists: fs.existsSync(dsLegacyFile),
        },
        covers: ["path1 forget rejects non-indexed keys and traversal"],
        doesNotClaim: ["gateway managed-mode reject runtime"],
      });
    }

    // --- Explicit not-run rows (extend O8 honesty) ---
    for (const nr of [
      {
        id: "EFF-GW-1-not-run",
        scenario: "gateway-handler-chain",
        layer: "gateway-handler-chain" as const,
        untestedSteps: [
          "data.memory.forget-gateway-method",
          "memory.list-gateway-method",
          "live-RPC-transport",
          "gateway-auth",
        ],
        covers: [] as string[],
        doesNotClaim: ["any gateway coverage"],
        detail: { note: "Explicit not-run; helper/data-layer cases above are not gateway." },
      },
      {
        id: "EFF-MODEL-1-not-run",
        scenario: "model-effect-adoption",
        layer: "model-effect" as const,
        untestedSteps: ["request-send", "correct-adoption", "timed-model-probe"],
        covers: [] as string[],
        doesNotClaim: ["model adoption", "reply uses recalled memory"],
        detail: { note: "Model effect untimed/not-run; never counts as passed." },
      },
      {
        id: "EFF-PROD-1-not-run",
        scenario: "production-online-effect",
        layer: "production-online" as const,
        untestedSteps: ["prod-host-write", "online-recall-verification", "deploy"],
        covers: [] as string[],
        doesNotClaim: ["production/online effect verified", "deploy"],
        detail: {
          note: "HARD BAN: no prod writes, no deploy, no claim of production/online effect verified.",
        },
      },
      {
        id: "EFF-FACT-1-not-run",
        scenario: "fact-level-forget-product",
        layer: "path1-forget-vs-multi-source" as const,
        untestedSteps: [
          "fact-level-all-source-forget",
          "D4-forget-lifecycle-chaining",
          "completion-UX",
        ],
        covers: [] as string[],
        doesNotClaim: ["fact-level forget product", "D4 chaining"],
        detail: {
          note: "Assessment-only prior work (#111); product not authorized. Multi-source residual is expected.",
        },
      },
    ]) {
      record({
        id: nr.id,
        scenario: nr.scenario,
        layer: nr.layer,
        status: "not-run",
        executed: false,
        untestedSteps: nr.untestedSteps,
        detail: nr.detail,
        covers: nr.covers,
        doesNotClaim: nr.doesNotClaim,
      });
    }

    const summary = summarizeCases(cases);
    expect(summary.summary.failed).toBe(0);
    expect(summary.summary.scaffoldInternalOnly).toBe(true);
    expect(summary.summary.notSystemEffectiveness).toBe(true);
    expect(summary.summary.productionOnlineEffectVerified).toBe(false);
    expect(summary.summary.notRun).toBeGreaterThanOrEqual(4);
    // not-run must never inflate passed
    for (const c of cases) {
      if (c.status === "not-run") {
        expect(c.pass).toBe(false);
        expect(c.executed).toBe(false);
      }
    }
    // Required coverage ids present
    for (const id of [
      "EFF-RECALL-1",
      "EFF-LIST-1",
      "EFF-ACL-1",
      "EFF-ACL-2",
      "EFF-O4-1",
      "EFF-O4-2",
      "EFF-O4-3",
      "EFF-FORGET-PATH1-1",
      "EFF-MULTI-1",
      "EFF-PROD-1-not-run",
      "EFF-FACT-1-not-run",
    ]) {
      expect(cases.some((c) => c.id === id)).toBe(true);
    }

    const outPath = process.env.OPENBOT_MEMORY_EFFECT_MATRIX_OUT;
    if (outPath) {
      if (fs.existsSync(outPath)) {
        throw new Error(`OPENBOT_MEMORY_EFFECT_MATRIX_OUT already exists: ${outPath}`);
      }
      const payload = {
        version: "memory-effect-acceptance-matrix-v1",
        generatedAt: new Date().toISOString(),
        timezoneNote: "box/user Asia/Shanghai; ISO timestamps are UTC",
        gitHeadHint: gitHead(),
        extends: "memory-batch1-o8-baseline-v3",
        hardBans: [
          "no-deploy",
          "no-prod-memory-writes",
          "no-claim-production-online-effect-verified",
          "no-fact-level-forget-product",
          "no-D4-forget-lifecycle-chaining",
        ],
        cases,
        ...summary,
      };
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    }
  });

  it("not-run cases never count as passed", () => {
    const sample: EffectCase = {
      id: "EFF-PROD-1-not-run",
      scenario: "production-online-effect",
      layer: "production-online",
      status: "not-run",
      pass: false,
      executed: false,
      untestedSteps: ["prod"],
      detail: {},
      covers: [],
      doesNotClaim: ["production/online effect verified"],
    };
    expect(sample.pass).toBe(false);
    expect(summarizeCases([sample]).summary.passed).toBe(0);
    expect(summarizeCases([sample]).summary.notRun).toBe(1);
  });
});
