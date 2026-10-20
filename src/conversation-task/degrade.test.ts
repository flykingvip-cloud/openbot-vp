import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InMemoryActivationControlPlane, SqliteActivationControlPlane } from "./control-plane.js";
import {
  ActivationDegradeController,
  DEGRADE_REASON,
  type ActivationDegradeOptions,
  type DegradeMetrics,
} from "./degrade.js";

function metrics(over: Partial<DegradeMetrics> = {}): DegradeMetrics {
  return {
    upgradePrecision: 1,
    overUpgradeRate: 0,
    reminderOverUpgradeRate: 0,
    duplicateTaskRate: 0,
    sampleSize: 200,
    ...over,
  };
}

/** Controller on an ENABLED in-memory control plane (fresh plane is forced-off). */
function mkEnabled(now: () => number = () => 0, minReopenIntervalMs = 0) {
  const controlPlane = new InMemoryActivationControlPlane({ now, minReopenIntervalMs });
  controlPlane.attemptReopen({ confirmedByHuman: true, actorId: "bootstrap" });
  const c = new ActivationDegradeController({ controlPlane });
  return { c, controlPlane };
}

describe("ActivationDegradeController — requires a control plane (P0-B)", () => {
  it("refuses construction without a control plane (fail-closed)", () => {
    const badOptions = {} as unknown as ActivationDegradeOptions;
    expect(() => new ActivationDegradeController(badOptions)).toThrow(/controlPlane/);
  });
});

describe("ActivationDegradeController — thresholds (O3)", () => {
  it("degrades when Upgrade Precision < 95%", () => {
    const { c } = mkEnabled();
    const out = c.evaluate(metrics({ upgradePrecision: 0.9 }));
    expect(out.degradedNow).toBe(true);
    expect(out.state).toBe("degraded");
    expect(out.reasonCodes).toContain(DEGRADE_REASON.UPGRADE_PRECISION_BELOW_MIN);
  });

  it("degrades when over-upgrade rate > 5%", () => {
    const { c } = mkEnabled();
    const out = c.evaluate(metrics({ overUpgradeRate: 0.06 }));
    expect(out.degradedNow).toBe(true);
    expect(out.reasonCodes).toContain(DEGRADE_REASON.OVER_UPGRADE_ABOVE_DEGRADE);
  });

  it("alerts (no degrade) when over-upgrade rate is between 2% and 5%", () => {
    const { c } = mkEnabled();
    const out = c.evaluate(metrics({ overUpgradeRate: 0.03 }));
    expect(out.degradedNow).toBe(false);
    expect(out.state).toBe("active");
    expect(out.alerts).toContain(DEGRADE_REASON.OVER_UPGRADE_ABOVE_ALERT);
  });

  it("alerts + requires RCA when reminder over-upgrade > 0", () => {
    const { c } = mkEnabled();
    const out = c.evaluate(metrics({ reminderOverUpgradeRate: 0.01 }));
    expect(out.alerts).toContain(DEGRADE_REASON.REMINDER_OVER_UPGRADE);
    expect(out.rcaRequired).toBe(true);
  });

  it("alerts on a duplicate task rate > 1%", () => {
    const { c } = mkEnabled();
    const out = c.evaluate(metrics({ duplicateTaskRate: 0.02 }));
    expect(out.alerts).toContain(DEGRADE_REASON.DUPLICATE_TASK_ABOVE_ALERT);
  });
});

describe("ActivationDegradeController — anti-flap + manual reopen (O3)", () => {
  it("does not re-degrade or auto-reopen once degraded", () => {
    const { c } = mkEnabled();
    expect(c.evaluate(metrics({ upgradePrecision: 0.9 })).degradedNow).toBe(true);
    const again = c.evaluate(metrics({ upgradePrecision: 0.99 }));
    expect(again.state).toBe("degraded");
    expect(again.degradedNow).toBe(false);
  });

  it("refuses reopen without human confirmation", () => {
    const { c } = mkEnabled();
    c.evaluate(metrics({ upgradePrecision: 0.9 }));
    expect(c.requestReopen({ confirmedByHuman: false, actorId: "op" }).reason).toBe(
      "manual_confirm_required",
    );
  });

  it("refuses reopen within the control-plane-owned (server-time) cooldown", () => {
    const INTERVAL = 1_000;
    let now = 0;
    const cp = new InMemoryActivationControlPlane({
      now: () => now,
      minReopenIntervalMs: INTERVAL,
    });
    now = INTERVAL; // pass the fresh cooldown to enable
    cp.attemptReopen({ confirmedByHuman: true, actorId: "boot" });
    const c = new ActivationDegradeController({ controlPlane: cp });
    c.evaluate(metrics({ upgradePrecision: 0.9 })); // forceOff at degradedAtMs = INTERVAL
    now = INTERVAL + 500; // 500 < 1000 => still cooling down
    expect(c.requestReopen({ confirmedByHuman: true, actorId: "op" }).reason).toBe(
      "cooldown_active",
    );
    now = 2 * INTERVAL + 1;
    expect(c.requestReopen({ confirmedByHuman: true, actorId: "op" }).reopened).toBe(true);
  });

  it("requires reminder RCA to be resolved before reopening", () => {
    const { c } = mkEnabled();
    c.evaluate(metrics({ upgradePrecision: 0.9, reminderOverUpgradeRate: 0.01 }));
    expect(
      c.requestReopen({ confirmedByHuman: true, rcaResolved: false, actorId: "op" }).reason,
    ).toBe("reminder_rca_required");
    const ok = c.requestReopen({ confirmedByHuman: true, rcaResolved: true, actorId: "op" });
    expect(ok.reopened).toBe(true);
    expect(c.state).toBe("active");
  });

  it("reopens with confirmation + actor and records the actor", () => {
    const { c, controlPlane } = mkEnabled();
    c.evaluate(metrics({ overUpgradeRate: 0.06 }));
    expect(c.requestReopen({ confirmedByHuman: true, actorId: "op-jane" }).reopened).toBe(true);
    expect(controlPlane.snapshot().lastReopenActor).toBe("op-jane");
  });
});

describe("ActivationDegradeController — restart recovery + shared state (P1)", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ct-degrade-cp-"));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("a rebuilt controller on a forced-off control plane recovers as degraded (not active)", () => {
    const cp1 = new SqliteActivationControlPlane({
      storeRoot: root,
      minReopenIntervalMs: 0,
      now: () => 1,
    });
    const c1 = new ActivationDegradeController({ controlPlane: cp1 });
    c1.evaluate(metrics({ upgradePrecision: 0.9 }));
    expect(c1.state).toBe("degraded");
    cp1.close();

    const cp2 = new SqliteActivationControlPlane({ storeRoot: root, minReopenIntervalMs: 0 });
    const c2 = new ActivationDegradeController({ controlPlane: cp2 });
    expect(c2.state).toBe("degraded");
    expect(c2.requestReopen({ confirmedByHuman: false, actorId: "op" }).reason).toBe(
      "manual_confirm_required",
    );
    expect(c2.requestReopen({ confirmedByHuman: true, actorId: "op" }).reopened).toBe(true);
    cp2.close();
  });

  it("a reopen by one controller is seen by another sharing the control plane", () => {
    const cp = new InMemoryActivationControlPlane({ minReopenIntervalMs: 0, now: () => 0 });
    const writer = new ActivationDegradeController({ controlPlane: cp });
    const reader = new ActivationDegradeController({ controlPlane: cp });
    cp.attemptReopen({ confirmedByHuman: true, actorId: "boot" }); // enable
    writer.evaluate(metrics({ upgradePrecision: 0.9 }));
    expect(reader.state).toBe("degraded");
    writer.requestReopen({ confirmedByHuman: true, actorId: "op" });
    expect(reader.state).toBe("active");
  });
});
