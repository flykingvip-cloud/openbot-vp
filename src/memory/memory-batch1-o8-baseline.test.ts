/**
 * O8 v1 baseline harness (isolation + synthetic data only) — RETAINED, do not overwrite evidence.
 *
 * Coverage limits (documented for rework audit):
 * - S1 uses SDK queryAtoms after upsertAtoms, NOT real tool/reply processing chain → partial.
 * - S2 seeds deprecated atoms instead of executing update/deprecate/conflict ops → partial.
 * - S5 cross-process reads local metadata store via queryAtoms; does NOT rebuild manager.search → partial.
 * - O5/S4 evidence in v1 is INVALID for defect establishment (path-name residual without same-source exclusion).
 * - pre 13/22 → post 19/22 is scaffold-internal only; NOT system effectiveness improvement.
 *
 * Prefer O8 v2: src/memory/memory-batch1-o8-baseline-v2.test.ts + docs/design/evidence/memory-e2e-baseline-*-v2-*.json
 * Set OPENBOT_MEMORY_BATCH1_BASELINE_OUT to write JSON results without overwriting prior baselines.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { MemoryAtom, Scope } from "../../packages/cogniweave-sdk/src/index.js";
import { createCogniWeaveRuntime } from "../../packages/cogniweave-sdk/src/runtime/bootstrap.js";
import type { OpenBotConfig } from "../config/config.js";
import { forgetMemoryEntry } from "../data/memory-lifecycle.js";
import { buildMemoryProbeAgentInput } from "../gateway/server-methods/doctor-memory-health.js";
import { resolveMemoryBackendConfig } from "./backend-config.js";
import { CogniWeaveMemoryManager } from "./cogniweave-manager.js";
import { probeAgentReadOnly } from "./health-probe.js";
import {
  applyIsolationEnv,
  assertPathInsideIsolation,
  createIsolationLayout,
  writeIsolationConfig,
  type IsolationLayout,
} from "./memory-batch1-isolation.js";
import { closeAllMemorySearchManagers } from "./search-manager.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const DATASET_PATH = path.join(REPO_ROOT, "docs/design/evidence/memory-batch1-dataset-v1.json");

type BaselineCase = {
  id: string;
  scenario: string;
  repeat: number;
  pass: boolean;
  detail: Record<string, unknown>;
  requestSend: "untimed";
  correctAdoption: "untimed";
};

const cases: BaselineCase[] = [];
const cleanups: Array<() => void | Promise<void>> = [];

function record(entry: BaselineCase): void {
  cases.push(entry);
}

function loadDataset(): {
  version: string;
  positiveFacts: Array<{ id: string; statement: string }>;
  negativeFacts: Array<{ id: string; statement: string }>;
  scenarioCoverage: Array<{ id: string; repeats: number }>;
  scoringRules: Record<string, string>;
} {
  return JSON.parse(fs.readFileSync(DATASET_PATH, "utf8"));
}

function atom(
  id: string,
  scope: Scope,
  statement: string,
  status: MemoryAtom["state"]["status"] = "active",
): MemoryAtom {
  return {
    id,
    atomType: "heuristic",
    scope,
    claim: { type: "heuristic", statement },
    trigger: { conditions: ["default"], contextTags: ["batch1"] },
    applicability: { include: [], exclude: [] },
    provenance: { sourceEventIds: [], evidenceRefs: [] },
    versioning: { version: 1 },
    state: { status, conflictsWith: [] },
    metrics: { confidence: 0.7, reuseCount: 0 },
  };
}

function createCfg(layout: IsolationLayout): OpenBotConfig {
  return {
    data: { root: layout.dataRoot, mode: "local", schemaVersion: 1 },
    memory: {
      backend: "cogniweave",
      cogniweave: {
        mode: "embedded",
        writeSync: "sync",
        cloudSync: { enabled: false },
      },
    },
    agents: {
      defaults: { workspace: layout.workspace, memorySearch: { enabled: true } },
      list: [{ id: "main", default: true, workspace: layout.workspace }],
    },
  };
}

afterEach(async () => {
  await closeAllMemorySearchManagers();
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
});

describe("O8 memory batch1 isolation baseline", () => {
  it("asserts isolation roots and records synthetic scenario matrix", async () => {
    const dataset = loadDataset();
    expect(dataset.positiveFacts.length).toBeGreaterThanOrEqual(20);
    expect(dataset.negativeFacts.length).toBeGreaterThanOrEqual(10);

    const layout = createIsolationLayout();
    cleanups.push(() => fs.rmSync(layout.root, { recursive: true, force: true }));
    const restoreEnv = applyIsolationEnv(layout);
    cleanups.push(restoreEnv);
    writeIsolationConfig(layout);

    const resolvedPaths = [
      layout.stateDir,
      layout.dataRoot,
      layout.tenantsRoot,
      layout.workspace,
      layout.sessionsDir,
      layout.collaborationDir,
      layout.configPath,
    ];
    for (const p of resolvedPaths) {
      assertPathInsideIsolation(p, layout.root);
    }
    record({
      id: "ISO-1",
      scenario: "isolation-path-assert",
      repeat: 1,
      pass: true,
      detail: { resolvedPaths, isolationRoot: layout.root },
      requestSend: "untimed",
      correctAdoption: "untimed",
    });

    const scopeA: Scope = {
      workspaceId: "ws-batch1-a",
      projectId: "agent:main",
      agentId: "main",
      visibility: "private",
    };
    const scopeB: Scope = {
      workspaceId: "ws-batch1-a",
      projectId: "agent:other",
      agentId: "other",
      visibility: "private",
    };

    // S1 + S3 + S2 via local metadata; unique store per repeat to avoid cross-repeat id clash.
    // S5 uses a dedicated persist store below.
    const persistStorePath = path.join(layout.dataRoot, "meta-persist.json");
    assertPathInsideIsolation(persistStorePath, layout.root);

    for (let repeat = 1; repeat <= 3; repeat++) {
      const storePath = path.join(layout.dataRoot, `meta-s1-${repeat}.json`);
      assertPathInsideIsolation(storePath, layout.root);
      const runtime = createCogniWeaveRuntime({
        environment: "local",
        metadataBackend: "local",
        metadataStorePath: storePath,
        graphBackend: "memory",
        evidenceBackend: "memory",
        vectorBackend: "memory",
        defaultScope: scopeA,
      });
      const positives = dataset.positiveFacts
        .slice(0, 8)
        .map((f, idx) => atom(`p-${repeat}-${idx}`, scopeA, f.statement));
      const deprecated = atom(
        `dep-${repeat}`,
        scopeA,
        dataset.negativeFacts.find((f) => f.id === "N04")?.statement ?? "deprecated",
        "deprecated",
      );
      const otherScope = atom(
        `other-${repeat}`,
        scopeB,
        dataset.negativeFacts.find((f) => f.id === "N02")?.statement ?? "other",
      );
      await runtime.engine.upsertAtoms([...positives, deprecated, otherScope]);

      // Legal binding + read
      await runtime.engine.ensureMemorySubjectBinding({
        scope: scopeA,
        caller: { tenantId: "__local__", ownerType: "agent", ownerId: "main" },
        scopeType: "agent",
      });
      const legal = await runtime.engine.queryAtoms({
        scope: scopeA,
        caller: { tenantId: "__local__", ownerType: "agent", ownerId: "main" },
        filter: { limit: 50 },
      });
      const legalIds = new Set(legal.map((h) => h.atom.id));
      const legalPass = positives.every((p) => legalIds.has(p.id)) && !legalIds.has(deprecated.id);
      record({
        id: `S1-legal-${repeat}`,
        scenario: "S1",
        repeat,
        pass: legalPass,
        detail: { hitCount: legal.length, hasDeprecated: legalIds.has(deprecated.id) },
        requestSend: "untimed",
        correctAdoption: "untimed",
      });

      // Unbound reject
      const unboundStorePath = path.join(layout.dataRoot, `unbound-${repeat}.json`);
      const unboundRuntime = createCogniWeaveRuntime({
        environment: "local",
        metadataBackend: "local",
        metadataStorePath: unboundStorePath,
        graphBackend: "memory",
        evidenceBackend: "memory",
        vectorBackend: "memory",
        defaultScope: scopeA,
      });
      await unboundRuntime.engine.upsertAtoms([atom(`u-${repeat}`, scopeA, "unbound-only")]);
      const unboundHits = await unboundRuntime.engine.queryAtoms({
        scope: scopeA,
        caller: { tenantId: "__local__", ownerType: "agent", ownerId: "main" },
        filter: { limit: 10 },
      });
      record({
        id: `S3-unbound-${repeat}`,
        scenario: "S3",
        repeat,
        pass: unboundHits.length === 0,
        detail: { hitCount: unboundHits.length },
        requestSend: "untimed",
        correctAdoption: "untimed",
      });

      // Wrong owner / cross tenant
      const wrongOwner = await runtime.engine.queryAtoms({
        scope: scopeA,
        caller: { tenantId: "__local__", ownerType: "agent", ownerId: "intruder" },
        filter: { limit: 10 },
      });
      const crossTenant = await runtime.engine.queryAtoms({
        scope: scopeA,
        caller: { tenantId: "tenant-batch1-b", ownerType: "agent", ownerId: "main" },
        filter: { limit: 10 },
      });
      record({
        id: `S3-wrong-owner-${repeat}`,
        scenario: "S3",
        repeat,
        pass: wrongOwner.length === 0,
        detail: { hitCount: wrongOwner.length },
        requestSend: "untimed",
        correctAdoption: "untimed",
      });
      record({
        id: `S3-cross-tenant-${repeat}`,
        scenario: "S3",
        repeat,
        pass: crossTenant.length === 0,
        detail: { hitCount: crossTenant.length },
        requestSend: "untimed",
        correctAdoption: "untimed",
      });

      // S2 conflict/deprecate observable
      record({
        id: `S2-deprecated-filtered-${repeat}`,
        scenario: "S2",
        repeat,
        pass:
          !legalIds.has(deprecated.id) && Boolean(positives[0] && legalIds.has(positives[0].id)),
        detail: { deprecatedPresent: legalIds.has(deprecated.id) },
        requestSend: "untimed",
        correctAdoption: "untimed",
      });
    }

    // Seed dedicated persist store for S5, then reopen in-process and cross-process.
    {
      const seedRuntime = createCogniWeaveRuntime({
        environment: "local",
        metadataBackend: "local",
        metadataStorePath: persistStorePath,
        graphBackend: "memory",
        evidenceBackend: "memory",
        vectorBackend: "memory",
        defaultScope: scopeA,
      });
      const persistAtom = atom(
        "persist-s5",
        scopeA,
        dataset.positiveFacts.find((f) => f.id === "P21")?.statement ?? "PhiPersistAcrossRestart",
      );
      await seedRuntime.engine.upsertAtoms([persistAtom]);
      await seedRuntime.engine.ensureMemorySubjectBinding({
        scope: scopeA,
        caller: { tenantId: "__local__", ownerType: "agent", ownerId: "main" },
        scopeType: "agent",
      });
      const reopen = createCogniWeaveRuntime({
        environment: "local",
        metadataBackend: "local",
        metadataStorePath: persistStorePath,
        graphBackend: "memory",
        evidenceBackend: "memory",
        vectorBackend: "memory",
        defaultScope: scopeA,
      });
      await reopen.engine.ensureMemorySubjectBinding({
        scope: scopeA,
        caller: { tenantId: "__local__", ownerType: "agent", ownerId: "main" },
        scopeType: "agent",
      });
      const hits = await reopen.engine.queryAtoms({
        scope: scopeA,
        caller: { tenantId: "__local__", ownerType: "agent", ownerId: "main" },
        filter: { limit: 50 },
      });
      const child = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "-e",
          `
          import { createCogniWeaveRuntime } from ${JSON.stringify(path.join(REPO_ROOT, "packages/cogniweave-sdk/src/runtime/bootstrap.ts"))};
          const scope = ${JSON.stringify(scopeA)};
          const runtime = createCogniWeaveRuntime({
            environment: "local",
            metadataBackend: "local",
            metadataStorePath: ${JSON.stringify(persistStorePath)},
            graphBackend: "memory",
            evidenceBackend: "memory",
            vectorBackend: "memory",
            defaultScope: scope,
          });
          const hits = await runtime.engine.queryAtoms({
            scope,
            caller: { tenantId: "__local__", ownerType: "agent", ownerId: "main" },
            filter: { limit: 50 },
          });
          process.stdout.write(JSON.stringify({ hitCount: hits.length }));
          `,
        ],
        { encoding: "utf8", cwd: REPO_ROOT, env: process.env },
      );
      let childHitCount: number | null = null;
      let childOk = false;
      try {
        childHitCount = JSON.parse(child.stdout || "{}").hitCount ?? null;
        childOk = child.status === 0 && typeof childHitCount === "number" && childHitCount > 0;
      } catch {
        childOk = false;
      }
      record({
        id: "S5-cross-process",
        scenario: "S5",
        repeat: 1,
        pass: hits.length > 0 && childOk,
        detail: {
          sameProcessHits: hits.length,
          childStatus: child.status,
          childStdout: (child.stdout || "").slice(0, 500),
          childStderr: (child.stderr || "").slice(0, 500),
          childHitCount,
        },
        requestSend: "untimed",
        correctAdoption: "untimed",
      });
    }

    // H1 health misreport on current code (may fail until O1)
    {
      const cfg = createCfg(layout);
      const resolved = resolveMemoryBackendConfig({ cfg, agentId: "main" });
      const probeInput = buildMemoryProbeAgentInput(cfg, "main");
      const probe = probeAgentReadOnly(probeInput);
      const misreport = resolved.backend === "cogniweave" && probeInput.backend === "builtin";
      // Baseline records the known defect; pass=false means defect still present.
      record({
        id: "H1-backend-misreport",
        scenario: "H1",
        repeat: 1,
        pass: !misreport && probeInput.backend === "cogniweave",
        detail: {
          configuredBackend: resolved.backend,
          probeBackend: probeInput.backend,
          reportedBackend: probe.agent.backend,
          search: probe.agent.search,
          misreport,
        },
        requestSend: "untimed",
        correctAdoption: "untimed",
      });
    }

    // A1 audit empty-md classification on current script
    {
      // Empty MEMORY.md workspace
      const emptyAgentWs = path.join(layout.root, "workspace-empty");
      fs.mkdirSync(emptyAgentWs, { recursive: true });
      const cfgPath = layout.configPath;
      const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
      cfg.agents.list.push({ id: "empty-agent", workspace: emptyAgentWs });
      fs.writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`);
      const audit = spawnSync(
        process.execPath,
        [path.join(REPO_ROOT, "scripts/memory-platform-audit.mjs"), "--json"],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            OPENBOT_STATE_DIR: layout.stateDir,
            OPENBOT_TENANTS_ROOT: layout.tenantsRoot,
          },
        },
      );
      let emptyClass: string | null = null;
      let recoveryAction: string | null = null;
      try {
        const report = JSON.parse(audit.stdout || "{}");
        const row = (report.agents ?? []).find(
          (a: { agentId: string }) => a.agentId === "empty-agent",
        );
        recoveryAction = row?.recovery?.action ?? null;
        emptyClass = row?.emptyMarkdownClass ?? row?.recovery?.action ?? null;
      } catch {
        emptyClass = null;
      }
      // Pre-fix: empty-workspace P0 is the known misclassification when no scope atoms checked.
      const fixed =
        emptyClass === "new-empty-agent" ||
        emptyClass === "diagnostic-insufficient" ||
        recoveryAction === "new-empty-agent";
      record({
        id: "A1-empty-md-class",
        scenario: "A1",
        repeat: 1,
        pass: fixed,
        detail: {
          auditStatus: audit.status,
          emptyClass,
          recoveryAction,
          stderr: (audit.stderr || "").slice(0, 400),
        },
        requestSend: "untimed",
        correctAdoption: "untimed",
      });
    }

    // S4 forget entry via data-space forgetMemoryEntry (existing gateway path semantics)
    for (let repeat = 1; repeat <= 3; repeat++) {
      const forgetLayout = createIsolationLayout(`openbot-mem-forget-${repeat}-`);
      cleanups.push(() => fs.rmSync(forgetLayout.root, { recursive: true, force: true }));
      const restore = applyIsolationEnv(forgetLayout);
      cleanups.push(restore);
      writeIsolationConfig(forgetLayout);
      const memoryDir = path.join(forgetLayout.dataRoot, "agents", "main", "memory", "agent");
      fs.mkdirSync(memoryDir, { recursive: true });
      const memoryKey = `upsilon-forget-${repeat}.md`;
      const memoryFile = path.join(memoryDir, memoryKey);
      const phrase = `UpsilonForgetUniqueToken-${repeat}`;
      fs.writeFileSync(memoryFile, `${phrase}\n`, "utf8");
      // Also index via manager workspace MEMORY.md for recall residual check
      fs.writeFileSync(path.join(forgetLayout.workspace, "MEMORY.md"), `${phrase}\n`, "utf8");
      const cfg = createCfg(forgetLayout);
      const resolved = resolveMemoryBackendConfig({ cfg, agentId: "main" });
      if (!resolved.cogniweave) {
        throw new Error("missing cogniweave");
      }
      const manager = await CogniWeaveMemoryManager.create({
        cfg,
        agentId: "main",
        resolved: resolved.cogniweave,
      });
      const before = await manager.search(phrase, { maxResults: 5 });
      const fileForget = await forgetMemoryEntry({
        cfg,
        agentId: "main",
        memoryKey,
      });
      const afterImmediate = await manager.search(phrase, { maxResults: 5 });
      // Existing sync mechanisms only — no forced extra sync beyond what search does.
      const afterSearchSync = await manager.search(phrase, { maxResults: 5 });
      const residual =
        afterImmediate.some((h) => (h.path ?? "").includes("MEMORY.md")) ||
        afterSearchSync.some((h) => (h.path ?? "").includes("MEMORY.md"));
      // Classification per authorization:
      // entrySuccessFileDeleted = file gone; residualRecall = indexed MEMORY still hits
      const entryMode =
        fileForget.deletedPath && residual
          ? "entry-success-but-residual-recall"
          : fileForget.deletedPath && !residual
            ? "entry-success-and-consistent"
            : "entry-failed-or-missing";
      record({
        id: `S4-forget-${repeat}`,
        scenario: "S4",
        repeat,
        pass: entryMode === "entry-success-and-consistent",
        detail: {
          entryMode,
          deletedPath: fileForget.deletedPath,
          beforeHits: before.map((h) => h.path),
          afterImmediateHits: afterImmediate.map((h) => h.path),
          afterSearchSyncHits: afterSearchSync.map((h) => h.path),
          note: "data.memory.forget path only deletes Data Space file; manager lifecycle not chained",
        },
        requestSend: "untimed",
        correctAdoption: "untimed",
      });
      await closeAllMemorySearchManagers();
    }

    const outPath = process.env.OPENBOT_MEMORY_BATCH1_BASELINE_OUT?.trim();
    if (outPath) {
      const payload = {
        schema: "memory-e2e-baseline/v1",
        phase: process.env.OPENBOT_MEMORY_BATCH1_BASELINE_PHASE ?? "pre",
        capturedAtAsiaShanghai: new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }),
        gitHead: spawnSync("git", ["rev-parse", "HEAD"], {
          encoding: "utf8",
          cwd: REPO_ROOT,
        }).stdout.trim(),
        datasetVersion: dataset.version,
        datasetPath: "docs/design/evidence/memory-batch1-dataset-v1.json",
        scoringRules: dataset.scoringRules,
        codeIdentity: {
          doctorMemoryHealth: "src/gateway/server-methods/doctor-memory-health.ts",
          healthProbe: "src/memory/health-probe.ts",
          auditScript: "scripts/memory-platform-audit.mjs",
          aclTest: "src/memory/query-atoms-acl.test.ts",
        },
        summary: {
          total: cases.length,
          passed: cases.filter((c) => c.pass).length,
          failed: cases.filter((c) => !c.pass).length,
        },
        cases,
      };
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      if (fs.existsSync(outPath)) {
        throw new Error(`refusing to overwrite existing baseline: ${outPath}`);
      }
      fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    }

    // Harness itself must run; individual case pass/fail is recorded for baseline comparison.
    expect(cases.length).toBeGreaterThan(10);
  }, 180_000);
});
