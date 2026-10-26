import { spawnSync } from "node:child_process";
/**
 * O8 v3 layered baseline — does NOT overwrite v1/v2 evidence.
 * Status model: passed | failed | not-run. not-run never increments passed.
 * Layers reported separately; never claim full E2E.
 *
 * OPENBOT_MEMORY_BATCH1_BASELINE_V3_OUT — optional JSON output path (must not exist).
 * OPENBOT_MEMORY_BATCH1_BASELINE_V3_PHASE — pre|post (default post-rework).
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
  | "helper-integration"
  | "data-layer"
  | "gateway-handler-chain"
  | "cross-process-retrieval"
  | "model-effect"
  | "health-audit-observability"
  | "isolation";

type CaseStatus = "passed" | "failed" | "not-run";

type V3Case = {
  id: string;
  scenario: string;
  layer: Layer;
  repeat: number;
  /** @deprecated use status; kept for readers. not-run must be false. */
  pass: boolean;
  status: CaseStatus;
  executed: boolean;
  untestedSteps: string[];
  detail: Record<string, unknown>;
  sampleIdsExecuted: string[];
  requestSend: "untimed" | "executed";
  correctAdoption: "untimed" | "executed";
};

const cases: V3Case[] = [];
const cleanups: Array<() => void | Promise<void>> = [];

function record(
  entry: Omit<V3Case, "status" | "pass"> & { status: CaseStatus; pass?: boolean },
): void {
  const status = entry.status;
  const pass = status === "passed";
  cases.push({ ...entry, status, pass });
}

function summarizeCases(list: V3Case[]) {
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
      executedSamples: list.reduce((n, c) => n + c.sampleIdsExecuted.length, 0),
      executedCaseIds: list.filter((c) => c.executed).map((c) => c.id),
      notRunCaseIds: list.filter((c) => c.status === "not-run").map((c) => c.id),
      sampleIdsExecutedAll: [...new Set(list.flatMap((c) => c.sampleIdsExecuted))],
      scaffoldInternalOnly: true,
      notSystemEffectiveness: true,
    },
  };
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
    trigger: { conditions: ["default"], contextTags: ["batch1-v3"] },
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

describe("O8 v3 layered memory baseline", () => {
  it("records separated-layer matrix without claiming full E2E", async () => {
    const dataset = loadDataset();
    expect(dataset.positiveFacts.length).toBeGreaterThanOrEqual(20);
    expect(dataset.negativeFacts.length).toBeGreaterThanOrEqual(10);

    const layout = createIsolationLayout("openbot-o8-v3-");
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
      id: "ISO-v3-1",
      scenario: "isolation-path-assert",
      layer: "isolation",
      repeat: 1,
      status: "passed",
      executed: true,
      untestedSteps: [],
      detail: { resolvedPaths },
      sampleIdsExecuted: [],
      requestSend: "untimed",
      correctAdoption: "untimed",
    });

    const scopeA: Scope = {
      workspaceId: "ws-batch1-v3",
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
        .map((f, idx) => atom(`v3-p-${idx}`, scopeA, f.statement));
      await runtime.engine.upsertAtoms(positives);
      await runtime.engine.ensureMemorySubjectBinding({
        scope: scopeA,
        caller: { tenantId: "__local__", ownerType: "agent", ownerId: "main" },
        scopeType: "agent",
      });

      // S2: actually execute deprecate (do NOT pre-seed deprecated).
      const targetId = positives[0].id;
      await runtime.engine.deprecateAtom(targetId, "batch1-v3-s2-real-deprecate");
      const afterDeprecate = await runtime.engine.queryAtoms({
        scope: scopeA,
        caller: { tenantId: "__local__", ownerType: "agent", ownerId: "main" },
        filter: { limit: 50 },
      });
      const ids = new Set(afterDeprecate.map((h) => h.atom.id));
      record({
        id: "S2-v3-real-deprecate",
        scenario: "S2",
        layer: "sdk-unit",
        repeat: 1,
        status:
          !ids.has(targetId) && positives.slice(1).every((p) => ids.has(p.id))
            ? "passed"
            : "failed",
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
        id: "S3-v3-wrong-owner",
        scenario: "S3",
        layer: "sdk-unit",
        repeat: 1,
        status: unbound.length === 0 ? "passed" : "failed",
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
        id: "S1-v3-manager-search",
        scenario: "S1",
        layer: "manager-integration",
        repeat: 1,
        status: hits.length > 0 ? "passed" : "failed",
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
        id: "S5-v3-manager-cross-process-search",
        scenario: "S5",
        layer: "cross-process-retrieval",
        repeat: 1,
        status: seedHits.length > 0 && childOk ? "passed" : "failed",
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

    // --- Layer: helper-integration / data-layer — S4 forget via forgetMemoryEntry (NOT gateway handler chain) ---
    {
      const phrase = "O8V3ForgetSourceToken";
      const memoryDir = path.join(layout.dataRoot, "agents", "main", "memory", "agent");
      fs.mkdirSync(memoryDir, { recursive: true });
      const memoryKey = "o8-v3-forget.md";
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
      // Direct helper/data-layer call — must NOT be labeled gateway-handler-chain.
      record({
        id: "S4-v3-forget-same-source",
        scenario: "S4",
        layer: "helper-integration",
        repeat: 1,
        status: Boolean(deleted.deletedPath) && !sameSourceResidual ? "passed" : "failed",
        executed: true,
        untestedSteps: [
          "live-gateway-RPC-transport",
          "gateway-handler-chain",
          "gateway-auth",
          "managed-mode-rejectWhenManaged-runtime-call",
        ],
        detail: {
          deletedPath: deleted.deletedPath,
          beforePaths: before.map((h) => h.path),
          afterPaths: after.map((h) => h.path),
          sameSourceResidual,
          diagnosticSuccessNotProductPass: true,
          calledHelper: "forgetMemoryEntry",
          note: "Direct forgetMemoryEntry helper/data-layer call. NOT gateway-handler-chain coverage. Gateway auth, managed reject, and handler chain remain not-run.",
        },
        sampleIdsExecuted: [],
        requestSend: "untimed",
        correctAdoption: "untimed",
      });
    }

    // --- Explicit not-run: gateway auth / managed reject / handler chain ---
    record({
      id: "GW-v3-auth-not-run",
      scenario: "gateway-auth",
      layer: "gateway-handler-chain",
      repeat: 1,
      status: "not-run",
      executed: false,
      untestedSteps: ["gateway-auth", "session-token-validation"],
      detail: { note: "Gateway authentication path not exercised this batch." },
      sampleIdsExecuted: [],
      requestSend: "untimed",
      correctAdoption: "untimed",
    });
    record({
      id: "GW-v3-managed-reject-not-run",
      scenario: "managed-reject",
      layer: "gateway-handler-chain",
      repeat: 1,
      status: "not-run",
      executed: false,
      untestedSteps: ["rejectWhenManaged-runtime-call"],
      detail: { note: "Managed-mode forget rejection not runtime-tested this batch." },
      sampleIdsExecuted: [],
      requestSend: "untimed",
      correctAdoption: "untimed",
    });
    record({
      id: "GW-v3-handler-chain-not-run",
      scenario: "gateway-handler-chain",
      layer: "gateway-handler-chain",
      repeat: 1,
      status: "not-run",
      executed: false,
      untestedSteps: ["data.memory.forget-gateway-method", "live-RPC-transport"],
      detail: {
        note: "No gateway handler invocation. S4-v3 uses forgetMemoryEntry helper only.",
      },
      sampleIdsExecuted: [],
      requestSend: "untimed",
      correctAdoption: "untimed",
    });

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
        id: "H1-v3-backend-scope-health",
        scenario: "H1",
        layer: "health-audit-observability",
        repeat: 1,
        status: h1Pass ? "passed" : "failed",
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

      const emptyAgentWs = path.join(layout.root, "workspace-empty-v3");
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
        id: "A1-v3-empty-md-class",
        scenario: "A1",
        layer: "health-audit-observability",
        repeat: 1,
        status: a1Pass ? "passed" : "failed",
        executed: true,
        untestedSteps: [],
        detail: { emptyClass, recoveryAction, auditStatus: audit.status },
        sampleIdsExecuted: [],
        requestSend: "untimed",
        correctAdoption: "untimed",
      });
    }

    // --- Layer: model-effect — explicitly not-run (must NOT count as passed) ---
    record({
      id: "MODEL-v3-untimed",
      scenario: "model-effect",
      layer: "model-effect",
      repeat: 1,
      status: "not-run",
      executed: false,
      untestedSteps: ["request-send", "correct-adoption", "paid-model-call"],
      detail: {
        note: "No real model invoked this batch; status=not-run so it does not increase passed.",
      },
      sampleIdsExecuted: [],
      requestSend: "untimed",
      correctAdoption: "untimed",
    });

    const codeVersion = gitHead();
    const fileFingerprints = fingerprintFiles([
      "src/memory/health-probe.ts",
      "src/gateway/server-methods/doctor-memory-health.ts",
      "scripts/memory-platform-audit.mjs",
      "src/memory/memory-batch1-o8-baseline-v3.test.ts",
      "src/memory/memory-batch1-o4-o5-diagnose.test.ts",
      "docs/design/evidence/memory-batch1-dataset-v1.json",
    ]);

    const { byLayer, summary } = summarizeCases(cases);

    const outPath = process.env.OPENBOT_MEMORY_BATCH1_BASELINE_V3_OUT?.trim();
    const payload = {
      schema: "memory-e2e-baseline/v3",
      phase: process.env.OPENBOT_MEMORY_BATCH1_BASELINE_V3_PHASE ?? "post-rework",
      createdAtAsiaShanghai: new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }),
      codeVersion,
      datasetVersion: dataset.version,
      datasetPath: "docs/design/evidence/memory-batch1-dataset-v1.json",
      fileFingerprints,
      supersedes: {
        v2: "docs/design/evidence/memory-e2e-baseline-v2-post-rework-2026-10-26.json",
        v2Matrix: "docs/design/evidence/memory-e2e-baseline-v2-coverage-matrix-2026-10-26.md",
        reason:
          "v2 counted MODEL-v2-untimed as pass:true and mislabeled forgetMemoryEntry as gateway-handler-chain",
      },
      v1Retained: {
        pre: "docs/design/evidence/memory-e2e-baseline-pre-2026-10-26.json",
        post: "docs/design/evidence/memory-e2e-baseline-post-2026-10-26.json",
        coverageLimits: "docs/design/evidence/memory-e2e-baseline-v1-coverage-limits-2026-10-26.md",
        o5EvidenceInvalid: true,
        prePostScaffoldOnly: "13/22→19/22 scaffold-internal; not system effectiveness",
      },
      v2RetainedSuperseded: true,
      layers: byLayer,
      summary,
      uncoveredSamples: {
        gatewayAuth: ["GW-v3-auth-not-run"],
        managedReject: ["GW-v3-managed-reject-not-run"],
        gatewayHandlerChain: ["GW-v3-handler-chain-not-run"],
        modelEffect: ["MODEL-v3-untimed"],
        datasetPositiveNotExecuted: dataset.positiveFacts
          .map((f) => f.id)
          .filter((id) => !summary.sampleIdsExecutedAll.includes(id)),
        datasetNegativeNotExecuted: dataset.negativeFacts.map((f) => f.id),
      },
      acceptanceRules: {
        unapprovedNewFailuresFailAcceptance: true,
        diagnosticSuccessIsNotProductPass: true,
        doNotCallFullE2E: true,
        notRunMustNotIncrementPassed: true,
        helperMustNotClaimGatewayHandlerChain: true,
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
      (c) =>
        (c.layer === "health-audit-observability" || c.layer === "isolation") &&
        c.status === "failed",
    );
    expect(observabilityFailed).toEqual([]);
    expect(summary.scaffoldInternalOnly).toBe(true);
    expect(summary.notRun).toBeGreaterThanOrEqual(1);
    // MODEL not-run must not inflate passed.
    expect(cases.find((c) => c.id === "MODEL-v3-untimed")?.status).toBe("not-run");
    expect(cases.find((c) => c.id === "MODEL-v3-untimed")?.pass).toBe(false);
    // Helper forget must not claim gateway-handler-chain.
    const forget = cases.find((c) => c.id === "S4-v3-forget-same-source");
    expect(forget?.layer).toBe("helper-integration");
    expect(forget?.layer).not.toBe("gateway-handler-chain");
    for (const gw of cases.filter((c) => c.layer === "gateway-handler-chain")) {
      expect(gw.status).toBe("not-run");
    }
  });
});

describe("O8 v3 evidence regressions", () => {
  it("not-run model-effect does not increase passed count", () => {
    const base: V3Case[] = [
      {
        id: "X-pass",
        scenario: "x",
        layer: "sdk-unit",
        repeat: 1,
        pass: true,
        status: "passed",
        executed: true,
        untestedSteps: [],
        detail: {},
        sampleIdsExecuted: [],
        requestSend: "untimed",
        correctAdoption: "untimed",
      },
    ];
    const withModel: V3Case[] = [
      ...base,
      {
        id: "MODEL-v3-untimed",
        scenario: "model-effect",
        layer: "model-effect",
        repeat: 1,
        pass: false,
        status: "not-run",
        executed: false,
        untestedSteps: ["request-send"],
        detail: {},
        sampleIdsExecuted: [],
        requestSend: "untimed",
        correctAdoption: "untimed",
      },
    ];
    const before = summarizeCases(base).summary.passed;
    const after = summarizeCases(withModel).summary.passed;
    expect(after).toBe(before);
    expect(summarizeCases(withModel).summary.notRun).toBe(1);
  });

  it("direct forgetMemoryEntry helper is not classified as gateway-handler-chain coverage", () => {
    const helperCase: V3Case = {
      id: "S4-v3-forget-same-source",
      scenario: "S4",
      layer: "helper-integration",
      repeat: 1,
      pass: true,
      status: "passed",
      executed: true,
      untestedSteps: ["gateway-handler-chain"],
      detail: { calledHelper: "forgetMemoryEntry" },
      sampleIdsExecuted: [],
      requestSend: "untimed",
      correctAdoption: "untimed",
    };
    expect(helperCase.layer).not.toBe("gateway-handler-chain");
    const gatewayRows: V3Case[] = [
      {
        id: "GW-v3-handler-chain-not-run",
        scenario: "gateway-handler-chain",
        layer: "gateway-handler-chain",
        repeat: 1,
        pass: false,
        status: "not-run",
        executed: false,
        untestedSteps: ["data.memory.forget-gateway-method"],
        detail: {},
        sampleIdsExecuted: [],
        requestSend: "untimed",
        correctAdoption: "untimed",
      },
    ];
    for (const row of gatewayRows) {
      expect(row.status).toBe("not-run");
    }
    const summarized = summarizeCases([helperCase, ...gatewayRows]);
    expect(summarized.byLayer["helper-integration"]?.passed).toBe(1);
    expect(summarized.byLayer["gateway-handler-chain"]?.passed ?? 0).toBe(0);
    expect(summarized.byLayer["gateway-handler-chain"]?.notRun).toBe(1);
  });
});
