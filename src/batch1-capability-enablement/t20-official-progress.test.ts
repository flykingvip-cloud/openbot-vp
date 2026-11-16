import { describe, expect, it } from "vitest";
import {
  runOfficialKnowledgeEntry,
  runOfficialTaskProgressEntry,
  runOpenBotRollbackDrill,
} from "./t20-official-progress.js";

describe("t20 official task progress entry", () => {
  it("creates a task, shows progress, reads the deliverable, and survives reload", async () => {
    const result = (await runOfficialTaskProgressEntry()) as {
      result?: string;
      cycle?: {
        canaryScope?: string;
        afterReload?: { lifecycle?: string; taskCompleted?: boolean };
        deliverable?: { bytes?: number };
        crossTenant?: { foreignVisibleCount?: number; foreignProgressEnabled?: boolean };
      };
    };
    expect(result.result).toBe("pass");
    expect(result.cycle?.canaryScope).toBe("tenant_allowlist");
    expect(result.cycle?.afterReload?.lifecycle).toBe("closed");
    expect(result.cycle?.afterReload?.taskCompleted).toBe(true);
    expect((result.cycle?.deliverable?.bytes ?? 0) > 0).toBe(true);
    expect(result.cycle?.crossTenant?.foreignVisibleCount).toBe(0);
    expect(result.cycle?.crossTenant?.foreignProgressEnabled).toBe(false);
  });
});

describe("t20 official knowledge reuse entry", () => {
  it("reads the original official-path artifact, extracts facts, compares, cites, and denies the other tenant", async () => {
    const result = (await runOfficialKnowledgeEntry()) as {
      result?: string;
      demo?: {
        followupUsesExtractedFacts?: boolean;
        followupHasCalculation?: boolean;
        uriConcatenationOnly?: boolean;
        comparison?: { largerMoveSku?: string };
      };
    };
    expect(result.result).toBe("pass");
    expect(result.demo?.followupUsesExtractedFacts).toBe(true);
    expect(result.demo?.followupHasCalculation).toBe(true);
    expect(result.demo?.uriConcatenationOnly).toBe(false);
    expect(result.demo?.comparison?.largerMoveSku).toBe("LightNorth-LX1");
  });
});

describe("t20 real OpenBot rollback drill", () => {
  it("stops new projections after shutdown while the original deliverable stays readable", async () => {
    const result = (await runOpenBotRollbackDrill()) as {
      result?: string;
      pythonListenerConclusionRetracted?: string;
      shutdown?: {
        existingTaskProgress?: unknown;
        newRequestSeeded?: boolean;
        newRequestProgress?: unknown;
        deliverableStillReadable?: { exists?: boolean };
      };
      reenableCompatibility?: { existingTaskProgressCompleted?: boolean };
      incompleteRollbackIfOnlyEnvZeroWhileConfigEnabled?: boolean;
    };
    expect(result.result).toBe("pass");
    expect(result.pythonListenerConclusionRetracted).toMatch(/not application-rollback evidence/);
    expect(result.shutdown?.existingTaskProgress).toBeNull();
    expect(result.shutdown?.newRequestSeeded).toBe(false);
    expect(result.shutdown?.newRequestProgress).toBeNull();
    expect(result.shutdown?.deliverableStillReadable?.exists).toBe(true);
    expect(result.reenableCompatibility?.existingTaskProgressCompleted).toBe(true);
    expect(result.incompleteRollbackIfOnlyEnvZeroWhileConfigEnabled).toBe(true);
  });
});
