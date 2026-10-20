/**
 * Phase 1 registry semantics (finding A / #936):
 * four Diagnosers = manifests + shared diagnoseFromContext.
 * Negative contracts — no second runner, no remediation execution.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { diagnose, diagnoseFromContext } from "./diagnose.js";
import {
  assertPhase1DiagnosersShareUnifiedRunner,
  getDiagnoserManifest,
  isPhase1Diagnoser,
  listPhase1Diagnosers,
  PHASE1_DIAGNOSER_IDS,
} from "./diagnosers.js";
import { loadGoldenDiagnosticRunGraph as loadGraph } from "./fixture-graph.js";
import {
  PHASE2_DIAGNOSER_IDS,
  PHASE2_FORBIDDEN_OPS,
  isPhase2Diagnoser,
  listPhase2DiagnoserManifests,
} from "./phase2.js";
import { buildDiagnosisPlan } from "./planner.js";
import { DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED } from "./production-cutover.js";
import { stripRunCompletion } from "./runner.js";
import type { DiagnoserContext, TrustedTenantContext } from "./types.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TRUSTED: TrustedTenantContext = { tenantId: "tenant-fixture-a" };

function readRepo(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

describe("Phase 1 registry semantics (A) — unified diagnoseFromContext", () => {
  it("keeps exactly four Phase 1 Diagnosers and shares one diagnose implementation", () => {
    expect([...PHASE1_DIAGNOSER_IDS]).toEqual([
      "trace-interaction",
      "agent-runtime",
      "skill-runtime",
      "tool-runtime",
    ]);
    const rows = listPhase1Diagnosers();
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(isPhase1Diagnoser(row.manifest.id)).toBe(true);
    }
    expect(() => assertPhase1DiagnosersShareUnifiedRunner()).not.toThrow();
  });

  it("proves manifest.id is not an independent algorithm (same result path)", async () => {
    const graph = loadGraph("agent-not-started.json");
    const context: DiagnoserContext = {
      schemaVersion: 1,
      run: stripRunCompletion(graph.run),
      targets: graph.run.targets,
      evidence: graph.evidences,
      trusted: TRUSTED,
    };
    const viaDiagnose = await diagnose({
      schemaVersion: 1,
      run: context.run,
      evidences: context.evidence,
      trusted: TRUSTED,
    });
    expect(listPhase1Diagnosers()).toHaveLength(4);
    const viaRegistry = await diagnoseFromContext(context);
    expect(viaRegistry.assessments[0]?.code).toBe(viaDiagnose.result.assessments[0]?.code);
    expect(viaRegistry.hypotheses[0]?.code).toBe(viaDiagnose.result.hypotheses[0]?.code);
    expect(viaRegistry.findingDrafts).toEqual([]);
  });

  it("rejects unregistered diagnoser ids as not plannable / not Phase 1", () => {
    expect(isPhase1Diagnoser("not-a-diagnoser")).toBe(false);
    expect(isPhase2Diagnoser("not-a-diagnoser")).toBe(false);
    expect(() => getDiagnoserManifest("not-a-diagnoser")).toThrow(/unknown Phase 1 Diagnoser/);
    const quick = buildDiagnosisPlan({ runId: "diag-run-unreg", mode: "QUICK" });
    for (const step of quick.steps) {
      if (step.diagnoserId) {
        expect(isPhase1Diagnoser(step.diagnoserId)).toBe(true);
      }
    }
  });

  it("does not let QUICK schedule Phase 2; Phase 2 manifests exclude QUICK", () => {
    for (const id of PHASE2_DIAGNOSER_IDS) {
      expect(isPhase2Diagnoser(id)).toBe(true);
    }
    for (const manifest of listPhase2DiagnoserManifests()) {
      expect(manifest.modes.includes("QUICK")).toBe(false);
      expect(manifest.modes).toEqual(["TARGETED", "FULL"]);
    }
    const quick = buildDiagnosisPlan({ runId: "diag-run-quick-p2", mode: "QUICK" });
    const quickIds = quick.steps.map((step) => step.diagnoserId).filter(Boolean);
    for (const id of PHASE2_DIAGNOSER_IDS) {
      expect(quickIds).not.toContain(id);
    }
    const full = buildDiagnosisPlan({ runId: "diag-run-full-p2", mode: "FULL" });
    for (const id of PHASE2_DIAGNOSER_IDS) {
      expect(full.steps.some((step) => step.diagnoserId === id)).toBe(true);
    }
  });

  it("matches each Phase 1 manifest evidence source to the QUICK/TARGETED execution plan", () => {
    const quick = buildDiagnosisPlan({ runId: "diag-run-q-manifest", mode: "QUICK" });
    const targeted = buildDiagnosisPlan({
      runId: "diag-run-t-manifest",
      mode: "TARGETED",
      toolTargetSpecified: true,
    });
    for (const row of listPhase1Diagnosers()) {
      const planned = [...quick.steps, ...targeted.steps].filter(
        (step) => step.diagnoserId === row.manifest.id,
      );
      expect(planned.length).toBeGreaterThan(0);
      for (const step of planned) {
        expect(
          row.manifest.evidenceRequirements.some((req) => req.source === step.evidenceSourceId),
        ).toBe(true);
      }
    }
  });

  it("does not clone fixture completion / findings / verification into diagnose()", async () => {
    const graph = loadGraph("tool-timeout-user-retry.json");
    expect(graph.run.completion).toBeTruthy();
    expect(graph.findings.length).toBeGreaterThan(0);
    expect(graph.verification).toBeTruthy();
    const stripped = stripRunCompletion(graph.run);
    expect(stripped.completion).toBeUndefined();
    const output = await diagnose({
      schemaVersion: 1,
      run: stripped,
      evidences: graph.evidences,
      trusted: TRUSTED,
    });
    // Completion may equal the fixture label if stopWhen re-derives it — that is not cloning.
    expect(output.result.findingDrafts).toEqual([]);
    expect(output.verification).toBeNull();
    expect(JSON.stringify(output.result)).not.toContain(graph.findings[0]?.findingId ?? "__none__");
    expect(JSON.stringify(output.verification)).not.toContain("receipt");
  });

  it("does not run remediation (doctor_fix / repair / restart_gateway / startChannel / stopChannel)", () => {
    expect(DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED).toBe(false);
    for (const op of PHASE2_FORBIDDEN_OPS) {
      expect(["startChannel", "stopChannel", "doctor_fix", "repair", "restart_gateway"]).toContain(
        op,
      );
    }
    const diagnoseSrc = readRepo("src/diagnosis/diagnose.ts");
    const diagnosersSrc = readRepo("src/diagnosis/diagnosers.ts");
    const runnerSrc = readRepo("src/diagnosis/runner.ts");
    for (const src of [diagnoseSrc, diagnosersSrc, runnerSrc]) {
      expect(src).not.toContain("doctor_fix");
      expect(src).not.toContain("restart_gateway");
      expect(src).not.toContain("startChannel");
      expect(src).not.toContain("stopChannel");
      expect(src).not.toContain("executeRemediation");
      expect(src).not.toContain("remediationExecute");
    }
    expect(diagnosersSrc).toContain("diagnose: diagnoseFromContext");
    expect(diagnosersSrc).not.toMatch(/diagnose:\s*async/);
  });
});
