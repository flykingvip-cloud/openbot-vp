/**
 * Governance closure contract tests (plan v1.0 §7.4, PR-6).
 *
 * Locks §5 (execution entries), §5.2 (capability inventory) and §4.8 (model callers) to
 * the registries in this directory and to the inventory source of truth. Unfinished
 * cells are registered states or `it.todo` named by inventory id — never silently absent.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CapabilityDataInvocationReason } from "../enterprise-data/capability-agent-invoke-runtime.js";
import { DIRECT_MODEL_INVOCATION_REGISTRY } from "./direct-model-invocation-registry.js";
import {
  CAPABILITY_ENTRY_INVENTORY,
  CAPABILITY_INVOKE_ADAPTER_MAPPING,
  EXECUTION_ENTRY_REGISTRY,
  GOVERNANCE_ENTRY_STATUSES,
} from "./execution-entry-registry.js";
import { MODEL_CALLER_REGISTRY, type ModelFallbackFunction } from "./model-caller-registry.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const INVENTORY_DOC = path.join(
  REPO_ROOT,
  ".kiro/specs/constitutional-governance-discovery/execution-entry-inventory.md",
);

const IMPLEMENTATION_VIEW_HEADING = "## 治理收敛实施视图（governance closure v1.0 §5 / §4.8）";

const EXPECTED_ENTRY_IDS = [
  "E1",
  "E1f",
  "E1m",
  "E2",
  "E3",
  "E4",
  "E5",
  "E6a",
  "E6b",
  "E6c",
  "E7",
  "E8",
  "E9",
  "E10",
  "E11",
  "E12",
  "E13",
  "E14",
  "E15",
  "E16",
  "E17",
  "E18",
  "E19",
];

/**
 * Known model-governance gaps. Empty after P3-3: every MODEL_CALLER_REGISTRY row is
 * `explicit-mode`. Keeping the constant (always `[]`) makes reintroducing a gap a
 * deliberate contract change rather than a silent registry drift.
 */
const EXPECTED_REGISTERED_GAPS: string[] = [
  // auto-reply / followup / cron-isolated left with P3-1.
  // "agent-command" left with PR-1a (#134).
  // "memory-flush" left with P3-2.
  // image-tool / pdf-tool left with PR-1c.
  // P3-3: zero registered-gap rows remain.
];

/** Enterprise-scope model paths that must pass `governanceMode` (plan §4 / P3-3). */
const ENTERPRISE_MODEL_CALLER_IDS = [
  "auto-reply",
  // agent-command converged onto authorized-session.ts (auto-reply row) in Slice 2A.
  // memory-flush and llm-slug-generator converged onto authorized-session.ts in Slice 2B-1.
  "image-tool",
  "pdf-tool",
] as const;

function isTestOnlyPath(rel: string): boolean {
  return (
    /\.(test|spec|e2e|live)\.[cm]?tsx?$/.test(rel) ||
    /\.test-harness\.[cm]?tsx?$/.test(rel) ||
    /\.mock\.[cm]?tsx?$/.test(rel) ||
    /(^|\/)(test-utils|test-helpers|__tests__|test-fixtures)(\/|$)/.test(rel)
  );
}

function listProductionSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) {
        continue;
      }
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else if (/\.[cm]?tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
        const rel = path.relative(REPO_ROOT, abs).split(path.sep).join("/");
        if (!isTestOnlyPath(rel)) {
          out.push(rel);
        }
      }
    }
  };
  for (const root of ["src", "extensions"]) {
    const abs = path.join(REPO_ROOT, root);
    if (fs.existsSync(abs)) {
      walk(abs);
    }
  }
  return out;
}

const PRODUCTION_SOURCES = listProductionSources();
const SOURCE_TEXT = new Map(
  PRODUCTION_SOURCES.map((rel) => [rel, fs.readFileSync(path.join(REPO_ROOT, rel), "utf8")]),
);

function countCalls(source: string, fn: ModelFallbackFunction): number {
  // Real call sites pass an options object: `fn({` or `fn<T>({`. Comments like
  // "runWithModelFallback() cycle" and the definition itself do not match.
  const re = new RegExp(`\\b${fn}\\s*(?:<[^>()]*>)?\\(\\s*\\{`, "g");
  return source.match(re)?.length ?? 0;
}

function expectBypassOrExemptDetails(
  label: string,
  item: { status: string; followUp?: string; exemptReason?: string },
): void {
  if (item.status === "Bypass" || item.status === "BYPASS") {
    expect(item.followUp?.trim(), `${label}: Bypass needs a follow-up phase`).toBeTruthy();
  }
  if (item.status === "Exempt" || item.status === "EXEMPT") {
    expect(item.exemptReason?.trim(), `${label}: Exempt needs a reason`).toBeTruthy();
  }
}

describe("§5 execution entry inventory", () => {
  it("registers every inventory id exactly once", () => {
    const ids = EXECUTION_ENTRY_REGISTRY.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(EXPECTED_ENTRY_IDS);
  });

  it.each(EXECUTION_ENTRY_REGISTRY.map((entry) => [entry.id, entry] as const))(
    "%s has exactly one status from the plan vocabulary",
    (id, entry) => {
      expect(typeof entry.status).toBe("string");
      expect(GOVERNANCE_ENTRY_STATUSES).toContain(entry.status);
      expectBypassOrExemptDetails(id, entry);
      for (const [dimension, value] of Object.entries(entry.dimensions ?? {})) {
        expect(GOVERNANCE_ENTRY_STATUSES).toContain(value.status);
        expectBypassOrExemptDetails(`${id}.${dimension}`, value);
      }
    },
  );

  it("an entry with a bypassed dimension is never Governed unless the plan says so", () => {
    // The Governed-with-a-Bypass-dimension exception stays reserved for E1.
    // agentInvocation is Shadow; commercial and model stay Governed.
    const allowedGovernedWithBypass = new Set(["E1"]);
    for (const entry of EXECUTION_ENTRY_REGISTRY) {
      const hasBypass = Object.values(entry.dimensions ?? {}).some((d) => d.status === "Bypass");
      if (hasBypass && !allowedGovernedWithBypass.has(entry.id)) {
        expect(entry.status, entry.id).not.toBe("Governed");
      }
    }
  });

  it("E1 stays Governed while agentInvocation is Shadow and the flag stays default off", () => {
    const e1 = EXECUTION_ENTRY_REGISTRY.find((entry) => entry.id === "E1");
    expect(e1?.status).toBe("Governed");
    expect(e1?.dimensions?.commercial?.status).toBe("Governed");
    expect(e1?.dimensions?.model?.status).toBe("Governed");
    expect(e1?.dimensions?.agentInvocation?.status).toBe("Shadow");
    expect(e1?.dimensions?.agentInvocation?.note).toMatch(/default off/);
    expect(e1?.dimensions?.agentInvocation?.followUp).toBeUndefined();
  });

  it("E8 is Shadow after P5-3/P5-4 (policy can allow/deny; MODE default shadow; SHADOW flag default off)", () => {
    const e8 = EXECUTION_ENTRY_REGISTRY.find((entry) => entry.id === "E8");
    expect(e8?.status).toBe("Shadow");
    expect(e8?.status).not.toBe("Bypass");
    expect(e8?.followUp).toMatch(/默认关|default off/i);
    expect(e8?.followUp).toMatch(/TOOLS_INVOKE_MODE|default shadow/i);
    expect(e8?.followUp).not.toMatch(/MODE\s+default\s+enforced|defaults?\s+to\s+enforced/i);
    expect(e8?.followUp).toMatch(/default shadow/i);
    expect(e8?.note).toMatch(/never allow|skipped/i);
  });

  it("E7 identity stays Bypass until the bus identity handoff lands (Q12)", () => {
    const e7 = EXECUTION_ENTRY_REGISTRY.find((entry) => entry.id === "E7");
    expect(e7?.dimensions?.identity?.status).toBe("Bypass");
    expect(e7?.status).not.toBe("Governed");
  });

  it("E6a, E6b, and E6c are Shadow", () => {
    for (const id of ["E6a", "E6b", "E6c"]) {
      const entry = EXECUTION_ENTRY_REGISTRY.find((item) => item.id === id);
      expect(entry?.status, id).toBe("Shadow");
      expect(entry?.status, id).not.toBe("Governed");
      expect(entry?.followUp, id).toMatch(/P3/);
    }
  });

  it("E2/E3 are Shadow after PR-1a (never Governed/enforced in Sprint 1)", () => {
    for (const id of ["E2", "E3"]) {
      const entry = EXECUTION_ENTRY_REGISTRY.find((item) => item.id === id);
      expect(entry?.status).toBe("Shadow");
      expect(entry?.dimensions?.model?.status).toBe("Shadow");
      expect(entry?.dimensions?.commercial?.status).toBe("Governed");
    }
  });

  it("E7 model dimension is Shadow after PR-1a while identity keeps E7 Bypass", () => {
    const e7 = EXECUTION_ENTRY_REGISTRY.find((entry) => entry.id === "E7");
    expect(e7?.dimensions?.model?.status).toBe("Shadow");
    expect(e7?.status).toBe("Bypass");
  });

  it("registered code anchors exist in production sources", () => {
    const corpus = [...SOURCE_TEXT.values()].join("\n");
    for (const entry of EXECUTION_ENTRY_REGISTRY) {
      for (const symbol of entry.symbols) {
        if (/^[a-z][A-Za-z0-9]+$/.test(symbol)) {
          expect(corpus.includes(symbol), `${entry.id}: ${symbol}`).toBe(true);
        }
      }
    }
  });

  describe("symbol checks closed (plan §6 P0 / §7.4 / PR-P2-0)", () => {
    it("no execution or capability entry still carries pendingSymbolCheck", () => {
      const pending = [
        ...EXECUTION_ENTRY_REGISTRY.filter((entry) => entry.pendingSymbolCheck),
        ...CAPABILITY_ENTRY_INVENTORY.filter((entry) => entry.pendingSymbolCheck),
      ].map((entry) => entry.id);
      expect(pending).toEqual([]);
    });

    it("E5: heartbeat-runner → getReplyFromConfig joins E1; Exempt, not newly Governed", () => {
      const e5 = EXECUTION_ENTRY_REGISTRY.find((entry) => entry.id === "E5");
      expect(e5?.pendingSymbolCheck).toBeUndefined();
      expect(e5?.status).toBe("Exempt");
      expect(e5?.status).not.toBe("Governed");
      expect(e5?.status).not.toBe("Bypass");
      expect(e5?.exemptReason).toMatch(/E1/);
      expect(e5?.exemptReason).toMatch(/getReplyFromConfig/);
      expect(e5?.exemptReason).toMatch(/runAdmittedTurn/);
      expect(e5?.note).toMatch(/E1/);
      expect(e5?.symbols).toEqual(["runHeartbeatOnce", "getReplyFromConfig"]);
      const heartbeat = SOURCE_TEXT.get("src/infra/heartbeat-runner.ts");
      expect(heartbeat).toBeDefined();
      expect(heartbeat).toContain("getReplyFromConfig");
      expect(heartbeat).toMatch(/export async function runHeartbeatOnce/);
      const getReply = SOURCE_TEXT.get("src/auto-reply/reply/get-reply.ts");
      expect(getReply).toBeDefined();
      expect(getReply).toContain("runPreparedReply");
      const prepared = SOURCE_TEXT.get("src/auto-reply/reply/get-reply-run.ts");
      expect(prepared).toBeDefined();
      expect(prepared).toContain("runReplyAgent");
      const runner = SOURCE_TEXT.get("src/auto-reply/reply/agent-runner.ts");
      expect(runner).toBeDefined();
      expect(runner).toContain("replyTurnRuntime.execution.runAdmittedTurn");
    });

    it("E16: commands/agent.ts CLI backend runs pass the commercial gate; stay Exempt", () => {
      const e16 = EXECUTION_ENTRY_REGISTRY.find((entry) => entry.id === "E16");
      expect(e16?.pendingSymbolCheck).toBeUndefined();
      expect(e16?.status).toBe("Exempt");
      expect(e16?.exemptReason).toMatch(/recordCliBackendUsage/);
      expect(e16?.exemptReason).toMatch(/external CLI process/);
      expect(e16?.note).toMatch(/acquireAgentCommandCommercialRun/);
      expect(e16?.note).toMatch(/runCliAgent/);
      expect(e16?.symbols).toEqual(["runCliAgent", "recordCliBackendUsage"]);
      const agent = SOURCE_TEXT.get("src/commands/agent.ts");
      expect(agent).toBeDefined();
      expect(agent).toContain("createUnifiedExecutionLifecycle");
      expect(SOURCE_TEXT.get("src/agent-runtime/model/command-admission-session.ts")).toContain(
        "await acquireAgentCommandCommercialRun",
      );
      expect(SOURCE_TEXT.get("src/agent-runtime/execution/runner/candidate-core.ts")).toContain(
        "runCliAgent",
      );
      expect(SOURCE_TEXT.get("src/agent-runtime/execution/runner/candidate-core.ts")).toContain(
        "recordCliBackendUsage",
      );
      // Gate is acquired in agentCommandInternal before runWithModelFallback → runAgentAttempt → runCliAgent.
      const gateIdx = agent!.indexOf("await controlledExecution.prepare");
      const fallbackIdx = agent!.indexOf("await controlledExecution.infer");
      expect(gateIdx).toBeGreaterThan(-1);
      expect(fallbackIdx).toBeGreaterThan(-1);
      expect(gateIdx).toBeLessThan(fallbackIdx);
    });
  });

  it("E11 symbol check is closed and stays Governed (PR-P5-0)", () => {
    const e11 = EXECUTION_ENTRY_REGISTRY.find((entry) => entry.id === "E11");
    expect(e11?.pendingSymbolCheck).toBeUndefined();
    expect(e11?.status).toBe("Governed");
    expect(e11?.symbols).toEqual([
      "invokeDataCapabilityForAgent",
      "invokeDataCapabilityWithContext",
    ]);
    expect(e11?.note).toMatch(/knowledge-object-only/);
  });

  it("E12 names the knowledge.capability.invoke handler and stays Governed (PR-P5-0)", () => {
    const e12 = EXECUTION_ENTRY_REGISTRY.find((entry) => entry.id === "E12");
    expect(e12?.pendingSymbolCheck).toBeUndefined();
    expect(e12?.status).toBe("Governed");
    expect(e12?.symbols).toContain("invokeKnowledgeCapability");
    expect(e12?.symbols).toContain("knowledge.capability.invoke");
    const knowledge = SOURCE_TEXT.get("src/gateway/server-methods/knowledge.ts");
    expect(knowledge).toBeDefined();
    expect(knowledge).toContain('"knowledge.capability.invoke"');
    expect(knowledge).toContain("invokeKnowledgeCapability");
  });
});

describe("§5.2 capability entry inventory", () => {
  it.each(CAPABILITY_ENTRY_INVENTORY.map((entry) => [entry.id, entry] as const))(
    "%s has one three-state status with details",
    (id, entry) => {
      expect(["REUSE", "BYPASS", "EXEMPT"]).toContain(entry.status);
      expectBypassOrExemptDetails(id, entry);
    },
  );

  it("TOOLS_INVOKE_MODE code default is shadow and never enforced; SHADOW and SHADOW_LOG stay default off", () => {
    const modeSource = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "tools-invoke-shadow.ts"),
      "utf8",
    );
    const sinkSource = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "shadow-sink.ts"),
      "utf8",
    );
    expect(modeSource).toMatch(/TOOLS_INVOKE_MODE_DEFAULT[^\n]*=\s*"shadow"/);
    expect(modeSource).not.toMatch(/TOOLS_INVOKE_MODE_DEFAULT[^\n]*=\s*"enforced"/);
    expect(modeSource).toMatch(
      /TOOLS_INVOKE_MODE_ENV\s*=\s*"OPENBOT_GOVERNANCE_TOOLS_INVOKE_MODE"/,
    );
    expect(modeSource).toContain("defaultMode: TOOLS_INVOKE_MODE_DEFAULT");
    // SHADOW flag still defaults off (isTruthyEnvValue only)
    expect(modeSource).toContain("OPENBOT_GOVERNANCE_TOOLS_INVOKE_SHADOW");
    expect(modeSource).not.toMatch(/TOOLS_INVOKE_SHADOW_ENV[^\n]*=\s*"1"/);
    expect(sinkSource).toContain("OPENBOT_GOVERNANCE_SHADOW_LOG");
    expect(sinkSource).not.toMatch(/GOVERNANCE_SHADOW_LOG_ENV[^;=]*=\s*"1"/);
  });

  it("tool-http is REUSE after P5-3 (envelope via tools-invoke shadow / capability policy)", () => {
    const toolHttp = CAPABILITY_ENTRY_INVENTORY.find((entry) => entry.id === "tool-http");
    expect(toolHttp?.status).toBe("REUSE");
    expect(toolHttp?.status).not.toBe("BYPASS");
    expect(toolHttp?.pendingSymbolCheck).toBeUndefined();
    expect(toolHttp?.followUp).toMatch(/tools-invoke shadow|evaluateToolsInvokeCapability/);
    expect(toolHttp?.followUp).toMatch(/skipped/);
    expect(toolHttp?.followUp).toMatch(/never allow/);
    expect(toolHttp?.followUp).toMatch(/default off/);
  });

  it("MCP stays BYPASS after the P5-0 search found no capability invoke", () => {
    const mcp = CAPABILITY_ENTRY_INVENTORY.find((entry) => entry.id === "MCP");
    expect(mcp?.status).toBe("BYPASS");
    expect(mcp?.entry).toBe("not located");
    expect(mcp?.pendingSymbolCheck).toBeUndefined();
    expect(mcp?.followUp).toMatch(/P5-0/);
    expect(mcp?.followUp).toMatch(/not an allow decision/);
    expect(SOURCE_TEXT.has("src/gateway/executable-asset-binding/mcp-config.ts")).toBe(true);
    const corpus = [...SOURCE_TEXT.values()].join("\n");
    expect(corpus.includes("invokeMcpCapability")).toBe(false);
    expect(corpus.includes("function invokeMcp")).toBe(false);
  });

  it("browser.request is located and stays BYPASS with no capability policy (PR-P5-0)", () => {
    const browser = CAPABILITY_ENTRY_INVENTORY.find((entry) => entry.id === "browser");
    expect(browser?.status).toBe("BYPASS");
    expect(browser?.entry).toBe("browser.request");
    expect(browser?.pendingSymbolCheck).toBeUndefined();
    expect(browser?.followUp).toMatch(/no tenant capability policy/);
    const browserSource = SOURCE_TEXT.get("src/gateway/server-methods/browser.ts");
    expect(browserSource).toContain("browser.request");
    expect(browserSource).toContain("browserHandlers");
    expect(browserSource).not.toContain("invokeDataCapability");
  });
});

describe("PR-P5-0 CapabilityInvokeAdapter mapping freeze", () => {
  const reasonCoverage: Record<CapabilityDataInvocationReason, true> = {
    "not-authorized": true,
    "not-found": true,
    disabled: true,
    "no-tenant": true,
    "no-seat": true,
    "quota-exceeded": true,
    "handler-error": true,
    "knowledge-object-only": true,
  };

  it("maps every data-capability reason plus ok, and only ok is allow", () => {
    const sources = CAPABILITY_INVOKE_ADAPTER_MAPPING.map((row) => row.source);
    expect(new Set(sources).size).toBe(sources.length);
    expect(sources.filter((source) => source !== "ok").toSorted()).toEqual(
      Object.keys(reasonCoverage).toSorted(),
    );
    const allowRows = CAPABILITY_INVOKE_ADAPTER_MAPPING.filter((row) => row.effect === "allow");
    expect(allowRows.map((row) => row.source)).toEqual(["ok"]);
    expect(allowRows.every((row) => row.countsTowardAllowCoverage)).toBe(true);
    for (const row of CAPABILITY_INVOKE_ADAPTER_MAPPING) {
      if (row.source !== "ok") {
        expect(row.countsTowardAllowCoverage, row.source).toBe(false);
        expect(row.reason, row.source).toBe("original");
      }
    }
  });

  it("locks deny reasons, skipped handler-error, and deny for knowledge-object-only", () => {
    const bySource = new Map(CAPABILITY_INVOKE_ADAPTER_MAPPING.map((row) => [row.source, row]));
    for (const source of [
      "not-authorized",
      "not-found",
      "disabled",
      "no-tenant",
      "no-seat",
      "quota-exceeded",
    ] as const) {
      expect(bySource.get(source)?.effect).toBe("deny");
    }
    expect(bySource.get("handler-error")?.effect).toBe("skipped");
    expect(bySource.get("handler-error")?.countsTowardAllowCoverage).toBe(false);
    expect(bySource.get("knowledge-object-only")?.effect).toBe("deny");
    expect(bySource.get("ok")?.reason).toBe("empty");
  });

  it("inventory ADR table matches the frozen mapping", () => {
    const doc = fs.readFileSync(INVENTORY_DOC, "utf8");
    const heading = "### PR-P5-0 ADR：CapabilityInvokeAdapter 映射（冻结）";
    const adr = doc.slice(doc.indexOf(heading));
    expect(adr.startsWith(heading)).toBe(true);
    expect(adr).toContain("evaluateToolsInvokeCapability");
    expect(adr).toContain("P5-2");
    expect(adr).toContain("P5-3");
    expect(adr).toContain("Shadow");
    expect(adr).toContain("REUSE");
    expect(adr).toContain("skipped");
    expect(adr).toContain("不得记");
    expect(adr).toContain("CAPABILITY_INVOKE_ADAPTER_MAPPING");
    for (const row of CAPABILITY_INVOKE_ADAPTER_MAPPING) {
      expect(adr, row.source).toContain(`| \`${row.source}\` | ${row.effect} |`);
    }
    expect(adr).not.toContain("| `handler-error` | allow |");
    expect(adr).not.toContain("| `knowledge-object-only` | allow |");
  });
});

describe("§4.8 model caller registry", () => {
  it("has unique ids and valid states", () => {
    const ids = MODEL_CALLER_REGISTRY.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    const entryIds = new Set(EXECUTION_ENTRY_REGISTRY.map((entry) => entry.id));
    for (const caller of MODEL_CALLER_REGISTRY) {
      expect(["registered-gap", "explicit-mode"]).toContain(caller.registration);
      expect(caller.followUp.trim(), caller.id).toBeTruthy();
      for (const inventoryId of caller.inventoryIds) {
        expect(entryIds.has(inventoryId), `${caller.id} → ${inventoryId}`).toBe(true);
      }
    }
  });

  it("P3-3: MODEL_CALLER_REGISTRY has no registered-gap rows", () => {
    const gaps = MODEL_CALLER_REGISTRY.filter((c) => c.registration === "registered-gap").map(
      (c) => c.id,
    );
    expect(gaps).toEqual([]);
    expect(EXPECTED_REGISTERED_GAPS).toEqual([]);
    expect(gaps).toEqual(EXPECTED_REGISTERED_GAPS);
  });

  it("every production model-fallback call site is registered as explicit-mode", () => {
    const found: string[] = [];
    for (const [rel, source] of SOURCE_TEXT) {
      if (rel === "src/agents/model-fallback.ts") {
        continue;
      }
      for (const fn of ["runWithModelFallback", "runWithImageModelFallback"] as const) {
        const count = countCalls(source, fn);
        if (count === 0) {
          continue;
        }
        found.push(`${rel}#${fn}×${count}`);
        const entry = MODEL_CALLER_REGISTRY.find((c) => c.file === rel && c.fn === fn);
        expect(entry, `${rel}#${fn} must be registered`).toBeDefined();
        expect(entry!.registration, entry!.id).toBe("explicit-mode");
        expect(entry!.callSites, entry!.id).toBe(count);
      }
    }
    const registered = MODEL_CALLER_REGISTRY.map((c) => `${c.file}#${c.fn}×${c.callSites}`);
    expect(found.toSorted()).toEqual(registered.toSorted());
    expect(
      MODEL_CALLER_REGISTRY.every((c) => c.registration === "explicit-mode"),
      "every registry row must be explicit-mode",
    ).toBe(true);
  });

  it("no production file aliases the fallback functions (would hide callers)", () => {
    for (const [rel, source] of SOURCE_TEXT) {
      expect(source, rel).not.toMatch(/\brun(?:Image)?WithModelFallback\s+as\s+\w+/);
      expect(source, rel).not.toMatch(/\brunWithImageModelFallback\s+as\s+\w+/);
    }
  });

  it("registry claims match the code", () => {
    for (const caller of MODEL_CALLER_REGISTRY) {
      const source = SOURCE_TEXT.get(caller.file);
      expect(source, caller.file).toBeDefined();
      expect(source).toMatch(new RegExp(`function ${caller.caller}\\b`));
      const evidence = [caller.file, ...(caller.evidenceFiles ?? [])]
        .map((rel) => SOURCE_TEXT.get(rel) ?? "")
        .join("\n");
      const hasAllowlist = /\bentitlementAllowlist\b/.test(evidence);
      if (caller.governanceToday === "allowlist-when-gated") {
        expect(hasAllowlist, caller.id).toBe(true);
      } else {
        expect(hasAllowlist, caller.id).toBe(false);
      }
      const hasMode = /\bgovernanceMode\b/.test(evidence);
      expect(hasMode, `${caller.id} must pass governanceMode`).toBe(true);
      expect(caller.registration, caller.id).toBe("explicit-mode");
    }
  });

  it("P3-3: enterprise-scope paths omitting governanceMode are a contract failure", () => {
    expect(MODEL_CALLER_REGISTRY.map((c) => c.id).toSorted()).toEqual(
      [...ENTERPRISE_MODEL_CALLER_IDS].toSorted(),
    );
    for (const id of ENTERPRISE_MODEL_CALLER_IDS) {
      const caller = MODEL_CALLER_REGISTRY.find((c) => c.id === id);
      expect(caller, id).toBeDefined();
      expect(caller!.registration, id).toBe("explicit-mode");
      const evidence = [caller!.file, ...(caller!.evidenceFiles ?? [])]
        .map((rel) => SOURCE_TEXT.get(rel) ?? "")
        .join("\n");
      expect(/\bgovernanceMode\b/.test(evidence), `${id} must pass governanceMode`).toBe(true);
    }
  });
});

/**
 * §4.8's coverage rule counts callers of the two model-fallback helpers, so a path that
 * reaches a model provider directly is not a missing row — it is a row the rule never
 * looks for. These assertions close the rule itself, so the next such path is a
 * deliberate contract change instead of a silent gap.
 */
describe("direct model invocation registry (§4.8 blind spot)", () => {
  const PI_COMPAT_IMPORT = "@earendil-works/pi-ai/compat";
  // `complete(` or `completeSimple(` as a bare call, not `.complete(` or `onComplete(`.
  const COMPLETE_CALL = /(?<![A-Za-z0-9_$.])(?:complete|completeSimple)\s*\(/;

  it("has unique ids and valid dispositions", () => {
    const ids = DIRECT_MODEL_INVOCATION_REGISTRY.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    const entryIds = new Set(EXECUTION_ENTRY_REGISTRY.map((entry) => entry.id));
    for (const row of DIRECT_MODEL_INVOCATION_REGISTRY) {
      expect(["instrumented", "exempt"], row.id).toContain(row.disposition);
      expect(["pi-complete", "provider-http"], row.id).toContain(row.invocation);
      if (row.disposition === "exempt") {
        expect(row.exemptReason?.trim(), `${row.id}: exempt needs a reason`).toBeTruthy();
        expect(row.inventoryIds, `${row.id}: exempt carries no entry`).toEqual([]);
      } else {
        expect(row.inventoryIds.length, `${row.id}: instrumented needs an entry`).toBeGreaterThan(
          0,
        );
        expect(
          row.evidenceFiles?.length,
          `${row.id}: instrumented needs the envelope writer`,
        ).toBeGreaterThan(0);
      }
      for (const inventoryId of row.inventoryIds) {
        expect(entryIds.has(inventoryId), `${row.id} → ${inventoryId}`).toBe(true);
      }
    }
  });

  it("every production pi-complete invocation outside the fallback helpers is registered", () => {
    const viaFallbackHelper = new Set(MODEL_CALLER_REGISTRY.map((caller) => caller.file));
    const found: string[] = [];
    for (const [rel, source] of SOURCE_TEXT) {
      if (!source.includes(PI_COMPAT_IMPORT) || !COMPLETE_CALL.test(source)) {
        continue;
      }
      // A file that routes through a registered fallback helper is already covered by §4.8.
      if (viaFallbackHelper.has(rel)) {
        continue;
      }
      // The registry file itself is documentation/contract, not production invocation.
      if (rel === "src/gateway/governance/direct-model-invocation-registry.ts") {
        continue;
      }
      found.push(rel);
    }
    const registered = DIRECT_MODEL_INVOCATION_REGISTRY.filter(
      (row) => row.invocation === "pi-complete",
    ).map((row) => row.file);
    expect(found.toSorted()).toEqual(registered.toSorted());
  });

  it("registered files and their envelope writers exist", () => {
    for (const row of DIRECT_MODEL_INVOCATION_REGISTRY) {
      expect(SOURCE_TEXT.has(row.file), row.file).toBe(true);
      for (const evidence of row.evidenceFiles ?? []) {
        expect(SOURCE_TEXT.has(evidence), evidence).toBe(true);
      }
    }
  });

  it("E19 is the entry for inbound media understanding and stays shadow-only", () => {
    const e19 = EXECUTION_ENTRY_REGISTRY.find((entry) => entry.id === "E19");
    expect(e19?.status).toBe("Shadow");
    expect(e19?.status).not.toBe("Governed");
    expect(e19?.followUp).toMatch(/默认关|default off/);
    expect(e19?.followUp).toMatch(/enforced 未实现|enforced not implemented/);
    expect(e19?.note).toMatch(/skipped/);
    const instrumented = DIRECT_MODEL_INVOCATION_REGISTRY.filter(
      (row) => row.disposition === "instrumented" && row.id.startsWith("media-understanding-"),
    );
    expect(instrumented.length).toBeGreaterThan(0);
    for (const row of instrumented) {
      expect(row.inventoryIds, row.id).toContain("E19");
    }
  });

  it("both applyMediaUnderstanding callers record the E19 envelope", () => {
    const callers = [...SOURCE_TEXT].filter(
      ([rel, source]) =>
        rel !== "src/media-understanding/apply.ts" &&
        /(?<![A-Za-z0-9_$.])applyMediaUnderstanding\s*\(\s*\{/.test(source),
    );
    expect(callers.length, "expected the chat and ACP inbound paths").toBeGreaterThan(0);
    for (const [rel, source] of callers) {
      expect(source, `${rel} must record the E19 envelope`).toContain(
        "recordMediaUnderstandingShadow",
      );
    }
  });
});

describe("inventory source of truth cross-reference (Q11)", () => {
  const doc = fs.readFileSync(INVENTORY_DOC, "utf8");
  const section = doc.slice(doc.indexOf(IMPLEMENTATION_VIEW_HEADING));
  const findRow = (id: string) =>
    section.split("\n").find((line) => new RegExp(`^\\|\\s*${id}\\s*\\|`).test(line));

  it("has the implementation view section", () => {
    expect(doc).toContain(IMPLEMENTATION_VIEW_HEADING);
  });

  it("extends execution-entry-inventory.md with the implementation view", () => {
    expect(doc).toContain("src/gateway/governance/execution-entry-registry.ts");
    expect(doc).toContain("src/gateway/governance/model-caller-registry.ts");
  });

  it.each(EXECUTION_ENTRY_REGISTRY.map((entry) => [entry.id, entry.status] as const))(
    "doc row %s matches registry status %s",
    (id, status) => {
      const row = findRow(id);
      expect(row, `missing row for ${id}`).toBeDefined();
      expect(row?.split("|")[3]?.trim()).toBe(status);
    },
  );

  it.each(MODEL_CALLER_REGISTRY.map((caller) => [caller.id, caller.registration] as const))(
    "doc model caller %s matches registration %s",
    (id, registration) => {
      const row = findRow(id);
      expect(row, `missing row for ${id}`).toBeDefined();
      expect(row).toContain(registration);
    },
  );
});
