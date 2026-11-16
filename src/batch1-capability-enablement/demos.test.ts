import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEMO_EVIDENCE_ROOT, runAllDemos } from "./run-demos.js";

describe("batch1 business demos", () => {
  it("runs task, knowledge, and diagnosis demos and persists evidence", async () => {
    const index = await runAllDemos();
    expect(index.task).toEqual(expect.objectContaining({ result: "pass" }));
    expect(index.knowledge).toEqual(expect.objectContaining({ result: "pass" }));
    expect(index.diagnosis).toEqual(expect.objectContaining({ result: "pass" }));
    const task = index.task as {
      afterReload?: { lifecycle?: string; taskCompleted?: boolean };
      deliverable?: { cite?: string };
    };
    expect(task.afterReload?.lifecycle).toBe("closed");
    expect(task.afterReload?.taskCompleted).toBe(true);
    const knowledge = index.knowledge as {
      followupCitesPrior?: boolean;
      followupUsesExtractedFacts?: boolean;
      followupHasCalculation?: boolean;
      uriConcatenationOnly?: boolean;
      comparison?: {
        largerMoveSku?: string;
        moves?: Array<{ sku: string; percentChange: number }>;
      };
      readRecord?: { path?: string; bytes?: number; hash?: string; hashMatchesArchive?: boolean };
      crossTenant?: {
        foreignArchiveRecord?: unknown;
        foreignReservedRead?: unknown;
        foreignFolderRead?: unknown;
      };
    };
    expect(knowledge.followupCitesPrior).toBe(true);
    expect(knowledge.followupUsesExtractedFacts).toBe(true);
    expect(knowledge.followupHasCalculation).toBe(true);
    expect(knowledge.uriConcatenationOnly).toBe(false);
    expect(knowledge.readRecord?.hashMatchesArchive).toBe(true);
    expect((knowledge.readRecord?.bytes ?? 0) > 0).toBe(true);
    expect(knowledge.readRecord?.path).toBeTruthy();
    expect(knowledge.comparison?.largerMoveSku).toBe("LightNorth-LX1");
    expect(
      knowledge.comparison?.moves?.some(
        (move) => move.sku === "LightNorth-LX1" && move.percentChange === 15,
      ),
    ).toBe(true);
    expect(
      knowledge.comparison?.moves?.some(
        (move) => move.sku === "Rainbrook-CUP2" && move.percentChange === -10,
      ),
    ).toBe(true);
    expect(knowledge.crossTenant?.foreignArchiveRecord ?? null).toBeNull();
    expect(knowledge.crossTenant?.foreignReservedRead ?? null).toBeNull();
    expect(knowledge.crossTenant?.foreignFolderRead ?? null).toBeNull();
    const diagnosis = index.diagnosis as {
      listed?: number;
      rejected?: { status?: string };
      afterReload?: { status?: string };
      permissionDeny?: { canaryTenantMismatch?: string; canarySessionMismatch?: string };
      role?: string;
      controlledFault?: {
        result?: string;
        notGoldenFixture?: boolean;
        runnerCompletion?: string;
        confirmedToolTimeout?: boolean;
        findings?: unknown[];
        toolTimeoutEvidence?: unknown[];
        collected?: Array<{ source?: string; summary?: { timeout?: boolean } }>;
        handling?: { rejected?: { status?: string }; afterReload?: { status?: string } };
      };
    };
    expect((diagnosis.listed ?? 0) > 0).toBe(true);
    expect(diagnosis.rejected?.status).toBe("rejected");
    expect(diagnosis.afterReload?.status).toBe("rejected");
    expect(diagnosis.permissionDeny?.canaryTenantMismatch).toBe("canary_tenant_mismatch");
    expect(diagnosis.permissionDeny?.canarySessionMismatch).toBe("canary_session_mismatch");
    expect(diagnosis.role).toBe("seeded-fixture-status-management");
    expect(diagnosis.controlledFault?.result).toBe("pass");
    expect(diagnosis.controlledFault?.notGoldenFixture).toBe(true);
    expect(diagnosis.controlledFault?.runnerCompletion).toBe("CONFIRMED");
    expect(diagnosis.controlledFault?.confirmedToolTimeout).toBe(true);
    expect(diagnosis.controlledFault?.handling?.rejected?.status).toBe("rejected");
    expect(diagnosis.controlledFault?.handling?.afterReload?.status).toBe("rejected");
    expect(
      diagnosis.controlledFault?.collected?.some(
        (row) => row.source === "tool_runtime" && row.summary?.timeout === true,
      ),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(DEMO_EVIDENCE_ROOT, "task", "artifacts", "price-watch.md")),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(DEMO_EVIDENCE_ROOT, "knowledge", "artifacts", "price-watch-followup.md"),
      ),
    ).toBe(true);
    expect(fs.existsSync(path.join(DEMO_EVIDENCE_ROOT, "knowledge", "read-record.json"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(DEMO_EVIDENCE_ROOT, "knowledge", "cross-tenant.json"))).toBe(
      true,
    );
    expect(
      fs.existsSync(path.join(DEMO_EVIDENCE_ROOT, "diagnosis", "controlled-fault", "result.json")),
    ).toBe(true);
    expect(fs.existsSync(path.join(DEMO_EVIDENCE_ROOT, "index.json"))).toBe(true);
  });
});
