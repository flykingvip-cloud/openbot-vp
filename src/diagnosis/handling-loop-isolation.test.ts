/**
 * Isolation-only verification of the existing controlled interfaces used by
 * the first handling-loop scenario. Does not touch HK LIVE or production
 * hosts. Writes evidence under OPENBOT_T137_EVIDENCE_DIR when set.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  describeDiagnosisJob,
  pauseDiagnosisJob,
  resumeDiagnosisJob,
  startDiagnosisJobRun,
} from "./diagnosis-job.js";
import {
  createDiagnosisHandlingLoop,
  seedPausedDiagnosisJob,
  type HandlingActor,
} from "./handling-loop.js";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const caller = { membershipTenantId: "tenant-iso", claimedTenantId: null };
const actor: HandlingActor = {
  operatorId: "iso-operator",
  tenantId: "tenant-iso",
  scopes: ["operator.read", "operator.write", "operator.admin"],
};

describe("isolation evidence · diagnosis.job.pause/resume/describe", () => {
  it("verifies the existing interface and closes the handling loop on a local fixture", () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-handling-iso-"));
    tmpDirs.push(configDir);
    const paused = pauseDiagnosisJob({ caller, configDir });
    expect(paused.ok).toBe(true);
    const before = describeDiagnosisJob({ caller, configDir });
    expect(before.ok).toBe(true);
    if (!before.ok) {
      return;
    }
    expect(before.binding?.paused).toBe(true);
    const blocked = startDiagnosisJobRun({ caller, configDir, evidenceRows: [] });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.reason).toBe("paused_blocks_new_run");
    }

    const machine = createDiagnosisHandlingLoop({ configDir, isolation: true });
    const submitted = machine.submit({ actor });
    expect(submitted.ok).toBe(true);
    machine.approve({
      actor: { ...actor, operatorId: "iso-approver", scopes: ["operator.approvals"] },
      handlingId: submitted.record!.handlingId,
    });
    const executed = machine.execute({ actor, handlingId: submitted.record!.handlingId });
    expect(executed.record?.status).toBe("executed_pending_recheck");
    expect(executed.record?.execution?.receipt.interfaceId).toBe("diagnosis.job.resume");

    const after = describeDiagnosisJob({ caller, configDir });
    expect(after.ok).toBe(true);
    if (!after.ok) {
      return;
    }
    expect(after.binding?.paused).toBe(false);
    const unblocked = startDiagnosisJobRun({ caller, configDir, evidenceRows: [] });
    expect(unblocked.ok).toBe(true);
    const rechecked = machine.recheck({ actor, handlingId: submitted.record!.handlingId });
    expect(rechecked.record?.status).toBe("resolved");

    const recovered = resumeDiagnosisJob({ caller, configDir });
    expect(recovered.ok).toBe(true);
    const evidence = {
      scenarioId: "diagnosis_job_paused",
      interfaceVerified: {
        describe: "diagnosis.job.describe",
        execute: "diagnosis.job.resume",
        recover: "diagnosis.job.pause",
        seed: "pauseDiagnosisJob / seedPausedDiagnosisJob",
      },
      before: {
        paused: before.binding?.paused === true,
        pausedAt: before.binding?.pausedAt ?? null,
        cadence: before.cadence,
        blockedReason: !blocked.ok ? blocked.reason : null,
      },
      after: {
        paused: after.binding?.paused === true,
        pausedAt: after.binding?.pausedAt ?? null,
        cadence: after.cadence,
        newRunOk: unblocked.ok,
        handlingStatus: rechecked.record?.status,
        taskId: executed.record?.execution?.taskId ?? null,
        receipt: executed.record?.execution?.receipt ?? null,
        recheckMet: rechecked.record?.recheck?.met === true,
      },
      environment: "local box isolation tmpdir",
      productionHostsTouched: false,
    };
    const evidenceDir = process.env.OPENBOT_T137_EVIDENCE_DIR;
    if (evidenceDir) {
      fs.mkdirSync(evidenceDir, { recursive: true });
      fs.writeFileSync(
        path.join(evidenceDir, "diagnosis-job-paused-loop.json"),
        `${JSON.stringify(evidence, null, 2)}\n`,
        "utf8",
      );
    }
    expect(seedPausedDiagnosisJob({ actor, configDir }).ok).toBe(true);
    expect(evidence.after.recheckMet).toBe(true);
    expect(evidence.productionHostsTouched).toBe(false);
  });
});
