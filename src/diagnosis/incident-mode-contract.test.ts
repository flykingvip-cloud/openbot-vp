/**
 * Case B contract: INCIDENT is a reserved DiagnosticRun.mode token.
 * validateDiagnosticRun may accept it; planner/runner must reject — never else→QUICK.
 */
import { describe, expect, it } from "vitest";
import {
  assertSupportedPlannerRunMode,
  buildDiagnosisPlan,
  SUPPORTED_PLANNER_RUN_MODES,
} from "./planner.js";
import { replayDiagnosticRunGraph, stripRunCompletion } from "./runner.js";
import type { DiagnosticRun, DiagnosticRunMode, TrustedTenantContext } from "./types.js";
import { validateDiagnosticRun } from "./types.js";

const TRUSTED: TrustedTenantContext = { tenantId: "tenant-fixture-a" };

function runWithMode(mode: DiagnosticRunMode): DiagnosticRun {
  return {
    schemaVersion: 1,
    runId: "diag-run-incident-contract",
    diagnosedAgentRunId: null,
    mode,
    targets: [
      {
        schemaVersion: 1,
        targetType: "session",
        targetId: "sess-incident-contract",
        tenantId: "tenant-fixture-a",
        authority: "src/sessions/transcript-events.ts",
        scope: { sessionKeyHash: "sha256:fixture-incident-mode" },
      },
    ],
    requestedBy: {
      schemaVersion: 1,
      principalId: "user-fixture",
      kind: "user",
      tenantId: "tenant-fixture-a",
    },
    mutationPolicy: "READ_ONLY",
    budget: { timeoutMs: 5_000, maxDiagnosers: 3, modelCalls: 0 },
    status: "queued",
    missingEvidence: [],
    startedAt: "2026-09-04T00:00:00.000Z",
  };
}

describe("INCIDENT mode contract (Case B — reserved/unsupported)", () => {
  it("keeps INCIDENT in the protocol union and accepts validateDiagnosticRun(INCIDENT)", () => {
    expect(SUPPORTED_PLANNER_RUN_MODES).toEqual(["QUICK", "TARGETED", "FULL"]);
    expect(SUPPORTED_PLANNER_RUN_MODES).not.toContain("INCIDENT");
    const validated = validateDiagnosticRun(runWithMode("INCIDENT"), TRUSTED);
    expect(validated.mode).toBe("INCIDENT");
  });

  it("assertSupportedPlannerRunMode rejects INCIDENT (no silent QUICK/TARGETED)", () => {
    expect(assertSupportedPlannerRunMode("QUICK")).toBe("QUICK");
    expect(assertSupportedPlannerRunMode("TARGETED")).toBe("TARGETED");
    expect(assertSupportedPlannerRunMode("FULL")).toBe("FULL");
    expect(() => assertSupportedPlannerRunMode("INCIDENT")).toThrow(
      /reserved\/unsupported.*refusing silent QUICK\/TARGETED fallback/,
    );
  });

  it("buildDiagnosisPlan rejects INCIDENT and does not emit a QUICK plan", () => {
    expect(() =>
      buildDiagnosisPlan({
        runId: "diag-run-incident-contract",
        // Force the reserved token past the SupportedPlannerRunMode type gate.
        mode: "INCIDENT" as unknown as "QUICK",
      }),
    ).toThrow(/reserved\/unsupported.*refusing silent QUICK\/TARGETED fallback/);

    let planMode: string | undefined;
    try {
      planMode = buildDiagnosisPlan({
        runId: "diag-run-incident-contract",
        mode: "INCIDENT" as unknown as "QUICK",
      }).mode;
    } catch {
      planMode = undefined;
    }
    expect(planMode).toBeUndefined();
    expect(planMode).not.toBe("QUICK");
  });

  it("replayDiagnosticRunGraph rejects INCIDENT and does not fall through to QUICK", async () => {
    const graph = {
      schemaVersion: 1 as const,
      graphKind: "DiagnosticRunGraph" as const,
      run: stripRunCompletion(runWithMode("INCIDENT")),
      evidences: [],
      verification: null,
    };

    await expect(replayDiagnosticRunGraph({ graph, trusted: TRUSTED })).rejects.toThrow(
      /reserved\/unsupported.*refusing silent QUICK\/TARGETED fallback/,
    );

    let leakedQuick = false;
    try {
      const replayed = await replayDiagnosticRunGraph({ graph, trusted: TRUSTED });
      leakedQuick = replayed.plan.mode === "QUICK";
    } catch {
      leakedQuick = false;
    }
    expect(leakedQuick).toBe(false);
  });

  it("maps supported modes explicitly (QUICK / TARGETED / FULL) without else→QUICK", async () => {
    for (const mode of ["QUICK", "TARGETED", "FULL"] as const) {
      const graph = {
        schemaVersion: 1 as const,
        graphKind: "DiagnosticRunGraph" as const,
        run: stripRunCompletion(runWithMode(mode)),
        evidences: [],
        verification: null,
      };
      const replayed = await replayDiagnosticRunGraph({ graph, trusted: TRUSTED });
      expect(replayed.plan.mode).toBe(mode);
      expect(replayed.run.mode).toBe(mode);
    }
  });
});
