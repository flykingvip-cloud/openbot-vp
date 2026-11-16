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
      crossTenant?: { foreignArchiveRecord?: unknown };
    };
    expect(knowledge.followupCitesPrior).toBe(true);
    expect(knowledge.crossTenant?.foreignArchiveRecord ?? null).toBeNull();
    const diagnosis = index.diagnosis as {
      listed?: number;
      rejected?: { status?: string };
      afterReload?: { status?: string };
      permissionDeny?: { canaryTenantMismatch?: string; canarySessionMismatch?: string };
    };
    expect((diagnosis.listed ?? 0) > 0).toBe(true);
    expect(diagnosis.rejected?.status).toBe("rejected");
    expect(diagnosis.afterReload?.status).toBe("rejected");
    expect(diagnosis.permissionDeny?.canaryTenantMismatch).toBe("canary_tenant_mismatch");
    expect(diagnosis.permissionDeny?.canarySessionMismatch).toBe("canary_session_mismatch");
    expect(
      fs.existsSync(path.join(DEMO_EVIDENCE_ROOT, "task", "artifacts", "price-watch.md")),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(DEMO_EVIDENCE_ROOT, "knowledge", "artifacts", "price-watch-followup.md"),
      ),
    ).toBe(true);
    expect(fs.existsSync(path.join(DEMO_EVIDENCE_ROOT, "index.json"))).toBe(true);
  });
});
