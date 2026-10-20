import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { passthroughAttributionResolution } from "./attribution-passthrough.js";
import { loadGoldenDiagnosticRunGraph as loadGraph } from "./fixture-graph.js";
import { DiagnosisJournal, DiagnosisJournalWriteError } from "./journal.js";
import { buildDiagnosisPlan } from "./planner.js";
import { replayDiagnosticRunGraph, stripRunCompletion } from "./runner.js";
import { createSkillInvocationReadAdapter, projectPartialRows } from "./source-adapters.js";
import { STOP_WHEN } from "./stop-when.js";
import type { DiagnosisCompletion, TrustedTenantContext } from "./types.js";
import { createGovernanceReceiptRef } from "./verification.js";

const TRUSTED: TrustedTenantContext = { tenantId: "tenant-fixture-a" };

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

describe("Phase 1 increment 3.6 — read-only PARTIAL adapters", () => {
  it("projects fixture graphs into PARTIAL rows without inventing skill identity", () => {
    const graph = loadGraph("skill-attribution-uncertain.json");
    const rows = projectPartialRows(graph.evidences);
    expect(rows.skillInvocation?.map((row) => row.attributionResolution)).toEqual([
      "unique_owner",
      "prompt_named_use",
    ]);
    expect(
      rows.skillInvocation?.every(
        (row) =>
          passthroughAttributionResolution(row.attributionResolution) !== "identity_tool_name",
      ),
    ).toBe(true);
  });

  it("maps a real Skill Invocation event shape through the read adapter", async () => {
    const adapter = createSkillInvocationReadAdapter([
      {
        invocationId: "inv-1",
        skillId: "skill-fixture-lookup",
        agentId: "agent-fixture-main",
        skillStarted: true,
        attributionResolution: undefined,
        observedAt: "2026-09-01T11:00:00.000Z",
      },
    ]);
    const result = await adapter.collect(
      {
        schemaVersion: 1,
        evidenceType: "event",
        source: "skill_invocation",
        targetType: "skill",
        fields: ["started", "attributionResolution"],
        sensitivity: "internal",
        cost: "low",
        required: true,
      },
      TRUSTED,
    );
    expect(result.missing).toEqual([]);
    expect(result.evidences[0]?.collection.attributionResolution).toBe("unknown");
    expect(result.evidences[0]?.summary.attributionResolution).toBe("unknown");
    expect(result.evidences[0]?.summary.outcome).toBeNull();
    for (const value of Object.values(result.evidences[0]?.summary ?? {})) {
      expect(value).not.toBeUndefined();
    }
  });
});

describe("Phase 1 increment 3.7 — Journal + QUICK/TARGETED replay", () => {
  it("derives each fixture completion from stopWhen + collected Evidence, not from run.completion", async () => {
    for (const [index, file] of FIXTURE_FILES.entries()) {
      const graph = loadGraph(file);
      const stripped = {
        ...graph,
        run: stripRunCompletion(graph.run),
      };
      expect(stripped.run.completion).toBeUndefined();
      const replayed = await replayDiagnosticRunGraph({ graph: stripped, trusted: TRUSTED });
      expect(replayed.run.status).toBe("completed");
      expect(replayed.run.completion).toBe(STRIPPED_COMPLETIONS[index]);
      expect(replayed.verification).toBeNull();
      expect("case" in replayed).toBe(false);
      expect(replayed.journal.countByKind("plan")).toBe(1);
      expect(replayed.journal.countByKind("collect")).toBeGreaterThan(0);
      expect(replayed.journal.countByKind("complete")).toBe(1);
      expect(replayed.plan.mode).toBe(graph.run.mode === "TARGETED" ? "TARGETED" : "QUICK");
    }
  });

  it("keeps scene 1 CONFIRMED when route_resolution stays missing", async () => {
    const graph = loadGraph("agent-not-started.json");
    const replayed = await replayDiagnosticRunGraph({
      graph: { ...graph, run: stripRunCompletion(graph.run) },
      trusted: TRUSTED,
    });
    const agent = replayed.collected.find((evidence) => evidence.source === "agent_runner");
    expect(agent?.collection.completeness).toBe("complete");
    expect(agent?.summary.agentStarted).toBe(false);
    expect(replayed.missing.some((req) => req.source === "route_resolution")).toBe(true);
    expect(replayed.run.completion).toBe("CONFIRMED");
  });

  it("emits agent_runner completeness from the source row, not a hardcoded partial", async () => {
    const graph = loadGraph("agent-not-started.json");
    const replayed = await replayDiagnosticRunGraph({
      graph: { ...graph, run: stripRunCompletion(graph.run) },
      trusted: TRUSTED,
    });
    expect(
      replayed.collected
        .filter((evidence) => evidence.source === "agent_runner")
        .every((evidence) => evidence.collection.completeness === "complete"),
    ).toBe(true);
  });

  it("keeps INCONCLUSIVE as a successful completion with null verification", async () => {
    const graph = loadGraph("inconclusive-missing-route-evidence.json");
    const replayed = await replayDiagnosticRunGraph({
      graph: { ...graph, run: stripRunCompletion(graph.run) },
      trusted: TRUSTED,
    });
    expect(replayed.run.status).toBe("completed");
    expect(replayed.run.completion).toBe("INCONCLUSIVE");
    expect(replayed.verification).toBeNull();
    expect(replayed.missing.some((req) => req.source === "route_resolution")).toBe(true);
  });

  it("widens TARGETED replay for scene 4 without opening a second case", async () => {
    const graph = loadGraph("tool-timeout-user-retry.json");
    const replayed = await replayDiagnosticRunGraph({
      graph: { ...graph, run: stripRunCompletion(graph.run) },
      trusted: TRUSTED,
    });
    expect(replayed.plan.mode).toBe("TARGETED");
    expect(replayed.plan.steps.some((step) => step.stepId === "step-t1")).toBe(true);
    expect(replayed.collected.some((evidence) => evidence.source === "tool_runtime")).toBe(true);
    expect(replayed.run.completion).toBe("CONFIRMED");
    expect(graph.case.findingIds).toHaveLength(1);
  });

  it("rejects replayDiagnosticRunGraph when the Journal fails on append", async () => {
    const graph = loadGraph("agent-not-started.json");
    const journal = new DiagnosisJournal();
    journal.failNextAppend();
    await expect(replayDiagnosticRunGraph({ graph, trusted: TRUSTED, journal })).rejects.toThrow(
      DiagnosisJournalWriteError,
    );
    expect(journal.list()).toEqual([]);
  });

  it("writes machine-readable stopWhen codes the runner can evaluate", () => {
    const plan = buildDiagnosisPlan({
      runId: "diag-run-quick",
      mode: "QUICK",
      toolCandidateLive: true,
    });
    const codes = plan.steps.flatMap((step) => step.stopWhen);
    expect(codes).toContain(STOP_WHEN.AGENT_NOT_STARTED_CONFIRMED);
    expect(codes).toContain(STOP_WHEN.SKILL_NOT_TRIGGERED_CONFIRMED);
    expect(codes).toContain(STOP_WHEN.ATTRIBUTION_UNCERTAIN_PROBABLE);
    expect(codes).toContain(STOP_WHEN.TOOL_TIMEOUT_CONFIRMED);
    expect(codes).toContain(STOP_WHEN.ROUTE_MISSING_INCONCLUSIVE);
    expect(plan.steps.every((step) => step.diagnoserId !== "doctor-static")).toBe(true);
    expect(plan.steps.every((step) => step.diagnoserId !== "channel-delivery")).toBe(true);
    expect(plan.steps.every((step) => step.diagnoserId !== "runtime-health")).toBe(true);
  });
});

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("Phase 1 increment 3.8 — store-backed collect + incremental stop", () => {
  it("stops after the first matching stopWhen and skips later sources", async () => {
    const graph = loadGraph("agent-not-started.json");
    const replayed = await replayDiagnosticRunGraph({
      graph: { ...graph, run: stripRunCompletion(graph.run) },
      trusted: TRUSTED,
    });
    expect(replayed.run.completion).toBe("CONFIRMED");
    expect(
      replayed.journal.list().some((row) => row.kind === "stop" && row.code === "step-q2"),
    ).toBe(true);
    expect(replayed.collected.some((evidence) => evidence.source === "skill_invocation")).toBe(
      false,
    );
    expect(replayed.journal.list().some((row) => row.code.startsWith("skill_invocation:"))).toBe(
      false,
    );
    expect(replayed.missing.some((req) => req.source === "route_resolution")).toBe(true);
  });

  it("reads Skill events.jsonl through the runner instead of fixture skill rows", async () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "diagnosis-runner-skill-"));
    tmpDirs.push(configDir);
    fs.mkdirSync(path.join(configDir, "skill-invocation-events"), { recursive: true });
    fs.writeFileSync(
      path.join(configDir, "skill-invocation-events", "events.jsonl"),
      `${JSON.stringify({
        type: "skill_invocation_completed",
        invocationId: "inv-store-override",
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
    const replayed = await replayDiagnosticRunGraph({
      graph: { ...graph, run: stripRunCompletion(graph.run) },
      trusted: TRUSTED,
      stores: { skillConfigDir: configDir },
    });
    expect(replayed.run.completion).toBe("PROBABLE");
    expect(
      replayed.collected.some(
        (evidence) =>
          evidence.source === "skill_invocation" &&
          evidence.authorityRecordId === "inv-store-override",
      ),
    ).toBe(true);
  });

  it("reads Session JSONL metadata through the runner and can BLOCK at q1", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "diagnosis-runner-session-"));
    tmpDirs.push(dir);
    const sessionFilePath = path.join(dir, "session.jsonl");
    fs.writeFileSync(
      sessionFilePath,
      `${JSON.stringify({ type: "session-meta", agentId: "agent-fixture-main" })}\n`,
      "utf8",
    );
    const graph = loadGraph("agent-not-started.json");
    const replayed = await replayDiagnosticRunGraph({
      graph: { ...graph, run: stripRunCompletion(graph.run) },
      trusted: TRUSTED,
      stores: {
        sessionFile: {
          sessionFilePath,
          sessionId: "session-fixture-1",
          sessionKeyHash: "sha256:fixture-session-key-a0000000000000000000000000000001",
          agentId: "agent-fixture-main",
        },
      },
    });
    expect(replayed.run.completion).toBe("BLOCKED");
    expect(
      replayed.journal.list().some((row) => row.kind === "stop" && row.code === "step-q1"),
    ).toBe(true);
    expect(replayed.collected.some((evidence) => evidence.source === "agent_runner")).toBe(false);
  });

  it("writes CONFIRMED verification from a governance receipt, not the fixture object", async () => {
    const graph = loadGraph("agent-not-started.json");
    const replayed = await replayDiagnosticRunGraph({
      graph: { ...graph, run: stripRunCompletion(graph.run) },
      trusted: TRUSTED,
      governanceReceipt: createGovernanceReceiptRef("gov-effect-runtime-1"),
    });
    expect(replayed.run.completion).toBe("CONFIRMED");
    expect(replayed.verification?.verificationId).toBe(`ver-${graph.run.runId}`);
    expect(replayed.verification?.verificationId).not.toBe(graph.verification?.verificationId);
    expect(replayed.verification?.measuredOutcome?.authorityRecordId).toBe("gov-effect-runtime-1");
    expect(replayed.verification?.measuredOutcome?.store).toBe("evolution_governance");
  });

  it("keeps INCONCLUSIVE verification null even when a receipt is supplied", async () => {
    const graph = loadGraph("inconclusive-missing-route-evidence.json");
    const replayed = await replayDiagnosticRunGraph({
      graph: { ...graph, run: stripRunCompletion(graph.run) },
      trusted: TRUSTED,
      governanceReceipt: createGovernanceReceiptRef("gov-effect-should-not-attach"),
    });
    expect(replayed.run.completion).toBe("INCONCLUSIVE");
    expect(replayed.verification).toBeNull();
  });
});
