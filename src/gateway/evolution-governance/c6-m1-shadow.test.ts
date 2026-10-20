import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  discardInMemoryShadowStoreHealthForTests,
  observeA9M1Shadow,
  readSingleTrackCutoverReadiness,
} from "./application-consumption-shadow.js";

describe("C6 A9 shadow gate", () => {
  it("keeps an A9 M1 event as shadow and refuses an E5.2 receipt", () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "c6-a9-"));
    const observed = observeA9M1Shadow({
      configDir,
      event: {
        kind: "a9-m1",
        proposalId: "evo:diag:8bee2c37b1f39478",
        experimentId: "exp:cmd-a9-exp-down",
        applicationId: "app:cmd-a9-active-up",
        recordedAt: "2026-09-22T09:53:14.997Z",
        executedConsumer: true,
        directMutatorsRetired: true,
        e52SwitchAllowed: true,
        cutoverReady: true,
        killSwitchDrillPassed: true,
      },
    });
    expect(observed.classification.accepted).toBe(true);
    expect(observed.isE52CutoverReceipt).toBe(false);
    expect(observed.executedConsumer).toBe(false);
    expect(observed.directMutatorsRetired).toBe(false);
    expect(observed.record?.executedConsumer).toBe(false);
    expect(observed.record?.source).toBe("a9-m1");
    expect(observed.unresolvedDenials).toBeGreaterThan(0);
    expect(observed.readiness.cutoverReady).toBe(false);
    expect(observed.readiness.e52SwitchAllowed).toBe(false);
    const tick = fs.readFileSync(
      fileURLToPath(new URL("./tick-pipeline.ts", import.meta.url)),
      "utf8",
    );
    const skillAuto = fs.readFileSync(
      fileURLToPath(new URL("./skill-auto-evolution.ts", import.meta.url)),
      "utf8",
    );
    expect(tick).toContain("applyGovernanceRuntimeAction(");
    expect(skillAuto).toContain("installSkillToRobotAsset(");

    const forged = observeA9M1Shadow({
      configDir,
      event: {
        kind: "e5.2-cutover-receipt",
        executedConsumer: true,
        directMutatorsRetired: true,
        recordedAt: "2026-09-22T10:00:00.000Z",
      },
    });
    expect(forged.record).toBeNull();
    expect(forged.isE52CutoverReceipt).toBe(false);
    expect(forged.readiness.cutoverReady).toBe(false);
    expect(forged.readiness.e52SwitchAllowed).toBe(false);

    const chain = path.join(configDir, "evolution-shadow-ledger", "events.jsonl");
    fs.rmSync(chain, { force: true });
    fs.appendFileSync(
      path.join(configDir, "evolution-governance", "control-plane-application-consumption.jsonl"),
      "{bad\n",
    );
    discardInMemoryShadowStoreHealthForTests();
    const damaged = readSingleTrackCutoverReadiness(configDir);
    expect(damaged.observationStoreHealthy).toBe(false);
    expect(damaged.cutoverReady).toBe(false);
    expect(damaged.e52SwitchAllowed).toBe(false);

    const empty = observeA9M1Shadow({
      configDir: fs.mkdtempSync(path.join(os.tmpdir(), "c6-empty-")),
      event: { kind: "a9-m1", executedConsumer: true, cutoverReady: true },
    });
    expect(empty.observationWindow.sampleCount).toBe(0);
    expect(empty.readiness.cutoverReady).toBe(false);
    expect(empty.readiness.e52SwitchAllowed).toBe(false);
    expect(empty.executedConsumer).toBe(false);
  });
});
