import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";
import { afterEach, describe, expect, it } from "vitest";
import { coreGatewayHandlers } from "../gateway/server-methods.js";
import { GATEWAY_METHOD_PACKS } from "../gateway/server-methods/packs/registry.js";
import { diagnose } from "./diagnose.js";
import { listPhase1Diagnosers } from "./diagnosers.js";
import { loadGoldenDiagnosticRunGraph, type GoldenDiagnosticRunGraph } from "./fixture-graph.js";
import {
  DIAGNOSIS_DAIBAI_DELIVERY_ENABLED,
  DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED,
} from "./production-cutover.js";
import { DIAGNOSIS_REPORT_API_DEPLOYED } from "./report-query-deploy.js";
import { DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED } from "./report-query-production-adapters.js";
import { stripRunCompletion } from "./runner.js";
import type { DiagnosisCompletion, DiagnoserContext, TrustedTenantContext } from "./types.js";
import { createGovernanceReceiptRef } from "./verification.js";

const _FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const TRUSTED: TrustedTenantContext = { tenantId: "tenant-fixture-a" };
const tmpDirs: string[] = [];

const FIXTURE_FILES = [
  "agent-not-started.json",
  "skill-not-triggered.json",
  "skill-triggered-tool-timeout.json",
  "tool-timeout-user-retry.json",
  "skill-attribution-uncertain.json",
  "inconclusive-missing-route-evidence.json",
] as const;

const STRIPPED_COMPLETIONS: readonly DiagnosisCompletion[] = [
  "CONFIRMED",
  "CONFIRMED",
  "CONFIRMED",
  "CONFIRMED",
  "PROBABLE",
  "INCONCLUSIVE",
];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function loadGraph(name: string): GoldenDiagnosticRunGraph {
  return loadGoldenDiagnosticRunGraph(name);
}

describe("vertical-slice diagnose()", () => {
  it("is no longer a stub on Phase 1 Diagnosers", async () => {
    const graph = loadGraph("agent-not-started.json");
    const context: DiagnoserContext = {
      schemaVersion: 1,
      run: stripRunCompletion(graph.run),
      targets: graph.run.targets,
      evidence: graph.evidences,
      trusted: TRUSTED,
    };
    for (const diagnoser of listPhase1Diagnosers()) {
      const result = await diagnoser.diagnose(context);
      expect(result.schemaVersion).toBe(1);
      expect(result).not.toHaveProperty("doctorFix");
      expect(result.findingDrafts).toEqual([]);
    }
  });

  it("derives six-scene strip-completion from stopWhen + collected Evidence", async () => {
    for (const [index, file] of FIXTURE_FILES.entries()) {
      const graph = loadGraph(file);
      const output = await diagnose({
        schemaVersion: 1,
        run: stripRunCompletion(graph.run),
        evidences: graph.evidences,
        trusted: TRUSTED,
      });
      expect(output.run.completion).toBe(STRIPPED_COMPLETIONS[index]);
      expect(output.run.status).toBe("completed");
      expect(output.result.findingDrafts).toEqual([]);
      expect(output.result.relationCandidates).toEqual([]);
    }
  });

  it("keeps scene 1 CONFIRMED when agentStarted=false and route stays missing", async () => {
    const graph = loadGraph("agent-not-started.json");
    const output = await diagnose({
      schemaVersion: 1,
      run: stripRunCompletion(graph.run),
      evidences: graph.evidences,
      trusted: TRUSTED,
    });
    const agent = output.collected.find((evidence) => evidence.source === "agent_runner");
    expect(agent?.summary.agentStarted).toBe(false);
    expect(agent?.collection.completeness).toBe("complete");
    expect(output.missing.some((req) => req.source === "route_resolution")).toBe(true);
    expect(output.run.completion).toBe("CONFIRMED");
    expect(output.verification).toBeNull();
  });

  it("writes verification only when a governance receipt is present", async () => {
    const graph = loadGraph("agent-not-started.json");
    const output = await diagnose({
      schemaVersion: 1,
      run: stripRunCompletion(graph.run),
      evidences: graph.evidences,
      trusted: TRUSTED,
      governanceReceipt: createGovernanceReceiptRef("gov-effect-diagnose-1"),
    });
    expect(output.run.completion).toBe("CONFIRMED");
    expect(output.verification?.measuredOutcome?.authorityRecordId).toBe("gov-effect-diagnose-1");
    expect(output.verification?.verificationId).not.toBe(graph.verification?.verificationId);
  });

  it("keeps INCONCLUSIVE verification null even with a receipt", async () => {
    const graph = loadGraph("inconclusive-missing-route-evidence.json");
    const output = await diagnose({
      schemaVersion: 1,
      run: stripRunCompletion(graph.run),
      evidences: graph.evidences,
      trusted: TRUSTED,
      governanceReceipt: createGovernanceReceiptRef("gov-effect-should-not-attach"),
    });
    expect(output.run.completion).toBe("INCONCLUSIVE");
    expect(output.verification).toBeNull();
  });

  it("replaces Skill rows from a store and does not copy fixture completion", async () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "diagnosis-diagnose-skill-"));
    tmpDirs.push(configDir);
    fs.mkdirSync(path.join(configDir, "skill-invocation-events"), { recursive: true });
    fs.writeFileSync(
      path.join(configDir, "skill-invocation-events", "events.jsonl"),
      `${JSON.stringify({
        type: "skill_invocation_completed",
        invocationId: "inv-diagnose-store",
        skillId: "skill-fixture-lookup",
        skillVersion: "1.0.0",
        agentId: "agent-fixture-main",
        tenantId: "tenant-fixture-a",
        userId: null,
        startedAt: Date.parse("2026-09-01T11:00:06.000Z"),
        completedAt: Date.parse("2026-09-01T11:00:07.000Z"),
        outcome: "success",
        latencyMs: 1000,
        failureCategory: null,
        runId: "agent-run-fixture-2",
        sessionKey: "session-store-override",
        businessOutcome: null,
        attributionResolution: "unique_owner",
      })}\n`,
      "utf8",
    );
    const graph = loadGraph("skill-not-triggered.json");
    const output = await diagnose({
      schemaVersion: 1,
      run: stripRunCompletion(graph.run),
      evidences: graph.evidences,
      trusted: TRUSTED,
      stores: { skillConfigDir: configDir },
    });
    expect(output.run.completion).not.toBe(graph.run.completion);
    expect(
      output.collected.some(
        (evidence) =>
          evidence.source === "skill_invocation" &&
          evidence.authorityRecordId === "inv-diagnose-store",
      ),
    ).toBe(true);
  });

  it("does not collect fixture tool rows after a session store covers the runner", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "diagnosis-diagnose-session-"));
    tmpDirs.push(dir);
    const sessionFilePath = path.join(dir, "session.jsonl");
    fs.writeFileSync(
      sessionFilePath,
      `${JSON.stringify({ type: "session-meta", agentId: "agent-fixture-main" })}\n${JSON.stringify({ type: "message", message: { role: "user", content: "hello" } })}\n`,
      "utf8",
    );
    const graph = loadGraph("skill-triggered-tool-timeout.json");
    const output = await diagnose({
      schemaVersion: 1,
      run: stripRunCompletion(graph.run),
      evidences: graph.evidences,
      trusted: TRUSTED,
      stores: {
        sessionFile: {
          sessionFilePath,
          sessionId: "session-fixture-1",
          sessionKeyHash: "sha256:fixture",
          agentId: "agent-fixture-main",
        },
      },
    });
    expect(
      output.collected.some((evidence) => evidence.evidenceId === "ev-fixture-3-tool-timeout"),
    ).toBe(false);
    expect(output.collected.some((evidence) => evidence.source === "tool_runtime")).toBe(false);
  });

  it("keeps production flags false and diagnosis methods off live handlers", () => {
    expect(DIAGNOSIS_REPORT_API_DEPLOYED).toBe(true);
    expect(DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED).toBe(true);
    expect(DIAGNOSIS_DAIBAI_DELIVERY_ENABLED).toBe(true);
    expect(DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED).toBe(false);
    expect(GATEWAY_METHOD_PACKS.find((pack) => pack.id === "diagnosis-reports")).toBeDefined();
    expect(coreGatewayHandlers["diagnosis.reports.query"]).toBeDefined();
    expect(coreGatewayHandlers["diagnosis.reports.get"]).toBeDefined();
  });
});

// These historical cutover / functional rehearsals explicitly opt into writes
// against injected local ports. Default-closed behavior is covered separately
// in write-policy.test.ts; this is not production enablement.
vi.mock("./write-policy.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./write-policy.js")>();
  return {
    ...actual,
    DIAGNOSIS_WRITE_POLICY: {
      selfEvolutionConfirm: true,
      conversationDelivery: true,
      daibaiDelivery: true,
    },
  };
});
