import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertLaterWaveLiveCutover,
  assertLaterWaveTrunkDeployGate,
  decideLaterWaveCutover,
} from "./later-wave-cutover-gate.js";
import {
  LATER_WAVE_ENABLEMENT_RECEIPT_KIND,
  type LaterWaveEnablementReceipt,
} from "./later-wave-production-gate.js";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "p4-later-cutover-"));
  tempDirs.push(dir);
  return dir;
}

function enablement(ready: boolean): LaterWaveEnablementReceipt {
  return {
    kind: LATER_WAVE_ENABLEMENT_RECEIPT_KIND,
    receiptId: "p4lw-test",
    tenantId: "tenant-acme",
    adapter: "byos",
    findings: [],
    productionReady: ready,
    liveCutover: false,
  };
}

describe("later-wave LIVE cutover gate", () => {
  it("never authorizes LIVE cutover, even when requested", () => {
    expect(assertLaterWaveLiveCutover({ requested: false })).toEqual({
      ok: true,
      reasonCode: "evaluation_only",
    });
    expect(assertLaterWaveLiveCutover({ requested: true })).toEqual({
      ok: false,
      reasonCode: "live_cutover_forbidden",
    });
  });

  it("requires a clean origin/main tip", () => {
    expect(
      assertLaterWaveTrunkDeployGate({
        dirty: true,
        headSha: "abc",
        originMainSha: "abc",
      }),
    ).toEqual({ ok: false, reasonCode: "trunk_dirty" });
    expect(
      assertLaterWaveTrunkDeployGate({
        dirty: false,
        headSha: "abc",
        originMainSha: "def",
      }),
    ).toEqual({ ok: false, reasonCode: "not_origin_main_tip" });
    expect(
      assertLaterWaveTrunkDeployGate({
        dirty: false,
        headSha: "abc",
        originMainSha: "abc",
      }),
    ).toEqual({ ok: true });
  });
});

describe("decideLaterWaveCutover", () => {
  it("refuses LIVE from a dirty worktree even when enablement is ready", () => {
    const result = decideLaterWaveCutover({
      enablement: enablement(true),
      liveCutoverRequested: false,
      trunk: { dirty: true, headSha: "aaa", originMainSha: "aaa" },
      receiptDir: tmp(),
    });
    expect(result.ok).toBe(false);
    expect(result.reasonCode).toBe("trunk_dirty");
    expect(result.decision.cutoverAllowed).toBe(false);
    expect(result.decision.trunkReady).toBe(false);
  });

  it("refuses LIVE when the candidate is not origin/main", () => {
    const result = decideLaterWaveCutover({
      enablement: enablement(true),
      liveCutoverRequested: false,
      trunk: { dirty: false, headSha: "side-branch", originMainSha: "main-tip" },
      receiptDir: tmp(),
    });
    expect(result.reasonCode).toBe("not_origin_main_tip");
    expect(result.decision.cutoverAllowed).toBe(false);
  });

  it("fail-closes an explicit cutover request even on a clean origin/main tip", () => {
    const result = decideLaterWaveCutover({
      enablement: enablement(true),
      liveCutoverRequested: true,
      trunk: { dirty: false, headSha: "abc", originMainSha: "abc" },
      receiptDir: tmp(),
    });
    expect(result).toMatchObject({
      ok: false,
      reasonCode: "live_cutover_forbidden",
    });
    expect(result.decision.cutoverAllowed).toBe(false);
    expect(result.decision.enablementReady).toBe(true);
    expect(result.decision.trunkReady).toBe(true);
    expect(result.decision.findings.find((row) => row.check === "live_cutover")?.passed).toBe(
      false,
    );
  });

  it("stays evaluation-only when enablement and trunk would otherwise pass", () => {
    const result = decideLaterWaveCutover({
      enablement: enablement(true),
      liveCutoverRequested: false,
      trunk: { dirty: false, headSha: "abc", originMainSha: "abc" },
      receiptDir: tmp(),
    });
    expect(result.ok).toBe(true);
    expect(result.reasonCode).toBe("evaluation_only");
    expect(result.decision.cutoverAllowed).toBe(false);
    expect(result.decision.enablementReady).toBe(true);
    expect(result.decision.trunkReady).toBe(true);
  });
});
