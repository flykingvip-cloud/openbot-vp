import { spawnSync } from "node:child_process";
/**
 * O8 v2 layered baseline — does NOT overwrite v1 evidence.
 * Layers reported separately; never claim full E2E.
 *
 * OPENBOT_MEMORY_BATCH1_BASELINE_V2_OUT — optional JSON output path (must not exist).
 * OPENBOT_MEMORY_BATCH1_BASELINE_V2_PHASE — pre|post (default post-rework).
 */
import { createHash } from "node:crypto";
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
  resolveIsolationStoragePaths,
  writeIsolationConfig,
  type IsolationLayout,
} from "./memory-batch1-isolation.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const DATASET_PATH = path.join(REPO_ROOT, "docs/design/evidence/memory-batch1-dataset-v1.json");

type Layer =
  | "sdk-unit"
  | "manager-integration"
  | "gateway-handler-chain"
  | "cross-process-retrieval"
  | "model-effect"
  | "health-audit-observability"
  | "isolation";

type V2Case = {
  id: string;
  scenario: string;
  layer: Layer;
  repeat: number;
  pass: boolean;
  executed: boolean;
  untestedSteps: string[];
  detail: Record<string, unknown>;
  sampleIdsExecuted: string[];
  requestSend: "untimed" | "executed";
  correctAdoption: "untimed" | "executed";
};

const cases: V2Case[] = [];
const cleanups: Array<() => void | Promise<void>> = [];

function record(entry: V2Case): void {
  cases.push(entry);
}

function loadDataset() {
  return JSON.parse(fs.readFileSync(DATASET_PATH, "utf8")) as {
    version: string;
    positiveFacts: Array<{ id: string; statement: string }>;
    negativeFacts: Array<{ id: string; statement: string }>;
  };
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
    trigger: { conditions: ["default"], contextTags: ["batch1-v2"] },
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
      cogniweave: { mode: "embedded", writeSync: "sync", cloudSync: { enabled: false } },
    },
    agents: {
      defaults: { workspace: layout.workspace, memorySearch: { enabled: true } },
      list: [{ id: "main", default: true, workspace: layout.workspace }],
    },
  };
}

function fingerprintFiles(relPaths: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rel of relPaths) {
    const full = path.join(REPO_ROOT, rel);
    if (!fs.existsSync(full)) {
      out[rel] = "missing";
      continue;
    }
    const body = fs.readFileSync(full);
    out[rel] = createHash("sha256").update(body).digest("hex").slice(0, 16);
  }
  return out;
}

function gitHead(): string {
  const r = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", cwd: REPO_ROOT });
  return (r.stdout || "").trim() || "unknown";
}

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
});

describe("O8 v2 layered memory baseline", () => {
  it("records separated-layer matrix without claiming full E2E", async () => {
    const dataset = loadDataset();
    expect(dataset.positiveFacts.length).toBeGreaterThanOrEqual(20);
    expect(dataset.negativeFacts.length).toBeGreaterThanOrEqual(10);

    const layout = createIsolationLayout("openbot-o8-v2-");
    cleanups.push(() => fs.rmSync(layout.root, { recursive: true, force: true }));
    cleanups.push(applyIsolationEnv(layout));
    writeIsolationConfig(layout);
    const resolvedPaths = resolveIsolationStoragePaths(layout);
    for (const p of Object.values(resolvedPaths)) {
      if (typeof p === "string") {
        assertPathInsideIsolation(p, layout.root);
      }
    }
    record({
      id: "ISO-v2-1",
      scenario: "isolation-path-assert",
      layer: "isolation",
      repeat: 1,
      pass: true,
      executed: true,
      untestedSteps: [],
      detail: { resolvedPaths },
      sampleIdsExecuted: [],
      requestSend: "untimed",
      correctAdoption: "untimed",
    });

    const scopeA: Scope = {
      workspaceId: "ws-batch1-v2",
      projectId: "agent:main",
      agentId: "main",
      visibility: "private",
    };

    // --- Layer: sdk-unit — S3 ACL + S2 real deprecate ---
    {
      const storePath = path.join(layout.dataRoot, "meta-s2-s3.json");
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
        .slice(0, 5)
        .map((f, idx) => atom(`v2-p-${idx}`, scopeA, f.statement));
      await runtime.engine.upsertAtoms(positives);
      await runtime.engine.ensureMemorySubjectBinding({
        scope: scopeA,
        caller: { tenantId: "__local__", ownerType: "agent", ownerId: "main" },
        scopeType: "agent",
      });

      // S2: actually execute deprecate (do NOT pre-seed deprecated).
      const targetId = positives[0].id;
      await runtime.engine.deprecateAtom(targetId, "batch1-v2-s2-real-deprecate");
      const afterDeprecate = await runtime.engine.queryAtoms({
        scope: scopeA,
        caller: { tenantId: "__local__", ownerType: "agent", ownerId: "main" },
        filter: { limit: 50 },
      });
      const ids = new Set(afterDeprecate.map((h) => h.atom.id));
      record({
        id: "S2-v2-real-deprecate",
        scenario: "S2",
        layer: "sdk-unit",
        repeat: 1,
        pass: !ids.has(targetId) && positives.slice(1).every((p) => ids.has(p.id)),
        executed: true,
        untestedSteps: [
          "conflict-marker-write-path",
          "fact-update-replace-with-new-version-via-product-API",
        ],
        detail: {
          deprecatedId: targetId,
          hitCount: afterDeprecate.length,
          deprecatedStillVisible: ids.has(targetId),
        },
        sampleIdsExecuted: dataset.positiveFacts.slice(0, 5).map((f) => f.id),
        requestSend: "untimed",
        correctAdoption: "untimed",
      });

      const unbound = await runtime.engine.queryAtoms({
        scope: scopeA,
        caller: { tenantId: "__local__", ownerType: "agent", ownerId: "intruder" },
        filter: { limit: 10 },
      });
      record({
        id: "S3-v2-wrong-owner",
        scenario: "S3",
        layer: "sdk-unit",
        repeat: 1,
        pass: unbound.length === 0,
        executed: true,
        untestedSteps: [],
        detail: { hitCount: unbound.length },
        sampleIdsExecuted: [],
        requestSend: "untimed",
        correctAdoption: "untimed",
      });
    }

    // --- Layer: manager-integration — S1 via manager.search after markdown ingest ---
    {
      const phrase =
        dataset.positiveFacts.find((f) => f.id === "P01")?.statement ?? "Batch1FactAlpha";
      fs.writeFileSync(path.join(layout.workspace, "MEMORY.md"), `${phrase}\n`, "utf8");
      const cfg = createCfg(layout);
      const resolved = resolveMemoryBackendConfig({ cfg, agentId: "main" });
      if (!resolved.cogniweave) {
        throw new Error("missing cogniweave");
      }
      const manager = await CogniWeaveMemoryManager.create({
        cfg,
        agentId: "main",
        resolved: resolved.cogniweave,
      });
      const hits = await manager.search("Batch1FactAlpha", { maxResults: 5 });
      await manager.close();
      record({
        id: "S1-v2-manager-search",
        scenario: "S1",
        layer: "manager-integration",
        repeat: 1,
        pass: hits.length > 0,
        executed: true,
        untestedSteps: [
          "real-tool-call-chain",
          "reply-handler-new-session-injection",
          "prompt-construction-with-recalled-memory",
        ],
        detail: { hitCount: hits.length, paths: hits.map((h) => h.path) },
        sampleIdsExecuted: ["P01"],
        requestSend: "untimed",
        correctAdoption: "untimed",
      });
    }

    // --- Layer: cross-process-retrieval — S5 rebuild manager in child and search ---
    {
      const phrase =
        dataset.positiveFacts.find((f) => f.id === "P21")?.statement ?? "PhiPersistAcrossRestart";
      fs.writeFileSync(
        path.join(layout.workspace, "MEMORY.md"),
        `${phrase}\nkeep-for-s5\n`,
        "utf8",
      );
      const cfg = createCfg(layout);
      const resolved = resolveMemoryBackendConfig({ cfg, agentId: "main" });
      if (!resolved.cogniweave) {
        throw new Error("missing cogniweave");
      }
      const seed = await CogniWeaveMemoryManager.create({
        cfg,
        agentId: "main",
        resolved: resolved.cogniweave,
      });
      const seedHits = await seed.search("PhiPersist", { maxResults: 5 });
      await seed.close();

      const child = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "-e",
          `
          import { resolveMemoryBackendConfig } from ${JSON.stringify(path.join(REPO_ROOT, "src/memory/backend-config.ts"))};
          import { CogniWeaveMemoryManager } from ${JSON.stringify(path.join(REPO_ROOT, "src/memory/cogniweave-manager.ts"))};
          const cfg = ${JSON.stringify(cfg)};
          const resolved = resolveMemoryBackendConfig({ cfg, agentId: "main" });
          const manager = await CogniWeaveMemoryManager.create({
            cfg,
            agentId: "main",
            resolved: resolved.cogniweave,
          });
          const hits = await manager.search("PhiPersist", { maxResults: 5 });
          await manager.close();
          process.stdout.write(JSON.stringify({ hitCount: hits.length, paths: hits.map((h) => h.path) }));
          `,
        ],
        {
          encoding: "utf8",
          cwd: REPO_ROOT,
          env: {
            ...process.env,
            OPENBOT_STATE_DIR: layout.stateDir,
            OPENBOT_DATA_ROOT: layout.dataRoot,
            OPENBOT_TENANTS_ROOT: layout.tenantsRoot,
            OPENBOT_DATA_MODE: "local",
          },
          timeout: 120_000,
        },
      );
      let childHitCount: number | null = null;
      let childOk = false;
      try {
        const parsed = JSON.parse(child.stdout || "{}");
        childHitCount = parsed.hitCount ?? null;
        childOk = child.status === 0 && typeof childHitCount === "number" && childHitCount > 0;
      } catch {
        childOk = false;
      }
      record({
        id: "S5-v2-manager-cross-process-search",
        scenario: "S5",
        layer: "cross-process-retrieval",
        repeat: 1,
        pass: seedHits.length > 0 && childOk,
        executed: true,
        untestedSteps: [],
        detail: {
          seedHits: seedHits.length,
          childStatus: child.status,
          childHitCount,
          childStdout: (child.stdout || "").slice(0, 500),
          childStderr: (child.stderr || "").slice(0, 800),
          note: "Rebuilds CogniWeaveMemoryManager in child and calls search — not metadata-only",
        },
        sampleIdsExecuted: ["P21"],
        requestSend: "untimed",
        correctAdoption: "untimed",
      });
    }

    // --- Layer: gateway-handler-chain — S4 forget via forgetMemoryEntry (gateway allow path semantics) ---
    {
      const phrase = "O8V2ForgetSourceToken";
      const memoryDir = path.join(layout.dataRoot, "agents", "main", "memory", "agent");
      fs.mkdirSync(memoryDir, { recursive: true });
      const memoryKey = "o8-v2-forget.md";
      fs.writeFileSync(path.join(memoryDir, memoryKey), `${phrase}\n`, "utf8");
      // Distinct control source
      fs.writeFileSync(path.join(layout.workspace, "MEMORY.md"), `control-${phrase}\n`, "utf8");
      const cfg = createCfg(layout);
      const resolved = resolveMemoryBackendConfig({ cfg, agentId: "main" });
      if (!resolved.cogniweave) {
        throw new Error("missing cogniweave");
      }
      const manager = await CogniWeaveMemoryManager.create({
        cfg,
        agentId: "main",
        resolved: resolved.cogniweave,
      });
      const before = await manager.search(phrase, { maxResults: 10 });
      const deleted = await forgetMemoryEntry({ cfg, agentId: "main", memoryKey });
      const after = await manager.search(phrase, { maxResults: 10 });
      await manager.close();
      const sameSourceResidual = after.some(
        (h) => h.path === memoryKey || h.path?.endsWith(memoryKey),
      );
      // Diagnostic observation only — product pass requires approved O5 fix.
      record({
        id: "S4-v2-forget-same-source",
        scenario: "S4",
        layer: "gateway-handler-chain",
        repeat: 1,
        pass: Boolean(deleted.deletedPath) && !sameSourceResidual,
        executed: true,
        untestedSteps: [
          "live-gateway-RPC-transport",
          "managed-mode-rejectWhenManaged-runtime-call",
        ],
        detail: {
          deletedPath: deleted.deletedPath,
          beforePaths: before.map((h) => h.path),
          afterPaths: after.map((h) => h.path),
          sameSourceResidual,
          diagnosticSuccessNotProductPass: true,
          note: "Uses forgetMemoryEntry (gateway allow-path function). Managed reject covered by source assertion in O5 re-diagnose.",
        },
        sampleIdsExecuted: [],
        requestSend: "untimed",
        correctAdoption: "untimed",
      });
    }

    // --- Layer: health-audit-observability — H1 / A1 ---
    {
      const cfg = createCfg(layout);
      const probeInput = buildMemoryProbeAgentInput(cfg, "main");
      const probe = probeAgentReadOnly(probeInput);
      const h1Pass =
        probeInput.configuredBackend === "cogniweave" &&
        probeInput.backend === "cogniweave" &&
        probe.agent.searchableDocumentCount === null &&
        probe.agent.backendHealth === "unknown";
      record({
        id: "H1-v2-backend-scope-health",
        scenario: "H1",
        layer: "health-audit-observability",
        repeat: 1,
        pass: h1Pass,
        executed: true,
        untestedSteps: [],
        detail: {
          configuredBackend: probeInput.configuredBackend,
          backend: probeInput.backend,
          searchableDocumentCount: probe.agent.searchableDocumentCount,
          backendHealth: probe.agent.backendHealth,
          storage: probe.agent.storage,
        },
        sampleIdsExecuted: [],
        requestSend: "untimed",
        correctAdoption: "untimed",
      });

      const emptyAgentWs = path.join(layout.root, "workspace-empty-v2");
      fs.mkdirSync(emptyAgentWs, { recursive: true });
      const cfgJson = JSON.parse(fs.readFileSync(layout.configPath, "utf8"));
      cfgJson.agents.list.push({ id: "empty-agent", workspace: emptyAgentWs });
      fs.writeFileSync(layout.configPath, `${JSON.stringify(cfgJson, null, 2)}\n`);
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
        emptyClass = row?.emptyMarkdownClass ?? null;
      } catch {
        emptyClass = null;
      }
      // After O2 rework: zero atoms without createdAt/expectedEmpty → diagnostic-insufficient.
      const a1Pass =
        emptyClass === "diagnostic-insufficient" || recoveryAction === "diagnostic-insufficient";
      record({
        id: "A1-v2-empty-md-class",
        scenario: "A1",
        layer: "health-audit-observability",
        repeat: 1,
        pass: a1Pass,
        executed: true,
        untestedSteps: [],
        detail: { emptyClass, recoveryAction, auditStatus: audit.status },
        sampleIdsExecuted: [],
        requestSend: "untimed",
        correctAdoption: "untimed",
      });
    }

    // --- Layer: model-effect — explicitly untested ---
    record({
      id: "MODEL-v2-untimed",
      scenario: "model-effect",
      layer: "model-effect",
      repeat: 1,
      pass: true,
      executed: false,
      untestedSteps: ["request-send", "correct-adoption", "paid-model-call"],
      detail: { note: "No real model invoked this batch; layer recorded as untimed/untested." },
      sampleIdsExecuted: [],
      requestSend: "untimed",
      correctAdoption: "untimed",
    });

    const codeVersion = gitHead();
    const fileFingerprints = fingerprintFiles([
      "src/memory/health-probe.ts",
      "src/gateway/server-methods/doctor-memory-health.ts",
      "scripts/memory-platform-audit.mjs",
      "src/memory/memory-batch1-o8-baseline-v2.test.ts",
      "src/memory/memory-batch1-o4-o5-diagnose.test.ts",
      "docs/design/evidence/memory-batch1-dataset-v1.json",
    ]);

    const byLayer: Record<string, { total: number; passed: number; failed: number }> = {};
    for (const c of cases) {
      const slot = (byLayer[c.layer] ??= { total: 0, passed: 0, failed: 0 });
      slot.total += 1;
      if (c.pass) {
        slot.passed += 1;
      } else {
        slot.failed += 1;
      }
    }

    const summary = {
      total: cases.length,
      passed: cases.filter((c) => c.pass).length,
      failed: cases.filter((c) => !c.pass).length,
      executedSamples: cases.reduce((n, c) => n + c.sampleIdsExecuted.length, 0),
      // Explicit: do NOT treat as system effectiveness rate.
      scaffoldInternalOnly: true,
      notSystemEffectiveness: true,
    };

    const outPath = process.env.OPENBOT_MEMORY_BATCH1_BASELINE_V2_OUT?.trim();
    const payload = {
      schema: "memory-e2e-baseline/v2",
      phase: process.env.OPENBOT_MEMORY_BATCH1_BASELINE_V2_PHASE ?? "post-rework",
      createdAtAsiaShanghai: new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }),
      codeVersion,
      datasetVersion: dataset.version,
      datasetPath: "docs/design/evidence/memory-batch1-dataset-v1.json",
      fileFingerprints,
      v1Retained: {
        pre: "docs/design/evidence/memory-e2e-baseline-pre-2026-10-26.json",
        post: "docs/design/evidence/memory-e2e-baseline-post-2026-10-26.json",
        coverageLimits: "docs/design/evidence/memory-e2e-baseline-v1-coverage-limits-2026-10-26.md",
        o5EvidenceInvalid: true,
        prePostScaffoldOnly: "13/22→19/22 scaffold-internal; not system effectiveness",
      },
      layers: byLayer,
      summary,
      acceptanceRules: {
        unapprovedNewFailuresFailAcceptance: true,
        diagnosticSuccessIsNotProductPass: true,
        doNotCallFullE2E: true,
      },
      cases,
    };

    if (outPath) {
      if (fs.existsSync(outPath)) {
        throw new Error(`refusing to overwrite existing baseline: ${outPath}`);
      }
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    }

    // Harness must run; individual layer failures are recorded.
    // Unapproved product failures (e.g. unexpected H1/A1 regressions after O1/O2) fail acceptance.
    const observabilityFailed = cases.filter(
      (c) => (c.layer === "health-audit-observability" || c.layer === "isolation") && !c.pass,
    );
    expect(observabilityFailed).toEqual([]);
    expect(summary.scaffoldInternalOnly).toBe(true);
  });
});
