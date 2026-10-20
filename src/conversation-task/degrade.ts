/**
 * ConversationTask Runtime — activation auto-degrade controller (P2, per
 * p2-ops-review.md O3 and review rounds 2/3).
 *
 * Watches rolling quality metrics and decides when to alert and when to force
 * `activation` off. The force-off state itself lives in the durable, shared
 * `ActivationControlPlane`, NOT in this controller — so the controller derives its
 * state from the control plane and survives restart with no in-memory state to
 * lose. Frozen thresholds:
 *  - Upgrade Precision < 95%  => degrade (force off)
 *  - over-upgrade rate  > 5%  => degrade;  > 2% => alert
 *  - duplicate task rate > 1% => alert
 *  - reminder over-upgrade > 0 => alert + RCA required before reopen
 *
 * Reopen goes only through `requestReopen`, which delegates to the control plane's
 * `attemptReopen`; the control plane re-validates human confirmation + a
 * control-plane-owned cooldown + RCA against persisted state and records the
 * operator. There is no in-controller cooldown or unconstrained clear.
 */

import {
  DEFAULT_MIN_REOPEN_INTERVAL_MS,
  type ActivationControlPlane,
  type ReopenAttempt,
  type ReopenOutcome,
} from "./control-plane.js";

export const DEGRADE_THRESHOLDS = {
  upgradePrecisionMin: 0.95,
  overUpgradeAlert: 0.02,
  overUpgradeDegrade: 0.05,
  duplicateTaskAlert: 0.01,
} as const;

/** Re-exported for callers/tests; the authoritative cooldown lives in the control plane. */
export const DEGRADE_DEFAULT_MIN_INTERVAL_MS = DEFAULT_MIN_REOPEN_INTERVAL_MS;

export const DEGRADE_REASON = {
  UPGRADE_PRECISION_BELOW_MIN: "upgrade_precision_below_min",
  OVER_UPGRADE_ABOVE_DEGRADE: "over_upgrade_above_degrade",
  OVER_UPGRADE_ABOVE_ALERT: "over_upgrade_above_alert",
  DUPLICATE_TASK_ABOVE_ALERT: "duplicate_task_above_alert",
  REMINDER_OVER_UPGRADE: "reminder_over_upgrade",
} as const;

export type DegradeReason = (typeof DEGRADE_REASON)[keyof typeof DEGRADE_REASON];

export type DegradeMetrics = {
  upgradePrecision: number;
  overUpgradeRate: number;
  reminderOverUpgradeRate: number;
  duplicateTaskRate: number;
  sampleSize: number;
};

export type ActivationDegradeState = "active" | "degraded";

export type DegradeEvaluation = {
  state: ActivationDegradeState;
  /** True only on the active->degraded transition triggered by this evaluation. */
  degradedNow: boolean;
  alerts: DegradeReason[];
  reasonCodes: DegradeReason[];
  rcaRequired: boolean;
};

export type ActivationDegradeOptions = {
  /**
   * REQUIRED durable, shared control plane. The controller's state is derived from
   * it (so restart cannot lose the degrade/reopen gate), and degrade transitions
   * are written through it. Constructing without one is refused (fail-closed).
   */
  controlPlane: ActivationControlPlane;
};

export class ActivationDegradeController {
  private readonly controlPlane: ActivationControlPlane;

  constructor(options: ActivationDegradeOptions) {
    if (!options || !options.controlPlane) {
      throw new Error("ActivationDegradeController requires a controlPlane");
    }
    this.controlPlane = options.controlPlane;
  }

  /** Derived from the durable control plane: forced-off => degraded (restart-safe). */
  get state(): ActivationDegradeState {
    return this.controlPlane.isForcedOff() ? "degraded" : "active";
  }

  /**
   * Evaluate metrics. Emits alerts and, if a degrade threshold is crossed while
   * currently active, force-disables activation in the control plane (durable).
   * Never re-transitions when already degraded, and never re-enables.
   */
  evaluate(metrics: DegradeMetrics): DegradeEvaluation {
    const alerts: DegradeReason[] = [];
    const degradeReasons: DegradeReason[] = [];

    if (metrics.upgradePrecision < DEGRADE_THRESHOLDS.upgradePrecisionMin) {
      degradeReasons.push(DEGRADE_REASON.UPGRADE_PRECISION_BELOW_MIN);
    }
    if (metrics.overUpgradeRate > DEGRADE_THRESHOLDS.overUpgradeDegrade) {
      degradeReasons.push(DEGRADE_REASON.OVER_UPGRADE_ABOVE_DEGRADE);
    } else if (metrics.overUpgradeRate > DEGRADE_THRESHOLDS.overUpgradeAlert) {
      alerts.push(DEGRADE_REASON.OVER_UPGRADE_ABOVE_ALERT);
    }
    if (metrics.duplicateTaskRate > DEGRADE_THRESHOLDS.duplicateTaskAlert) {
      alerts.push(DEGRADE_REASON.DUPLICATE_TASK_ABOVE_ALERT);
    }

    let rcaRequired = false;
    if (metrics.reminderOverUpgradeRate > 0) {
      alerts.push(DEGRADE_REASON.REMINDER_OVER_UPGRADE);
      rcaRequired = true;
    }

    const alreadyOff = this.controlPlane.isForcedOff();
    let degradedNow = false;
    if (degradeReasons.length > 0 && !alreadyOff) {
      // Durably force activation off (server-timestamped; survives restart).
      this.controlPlane.forceOff({
        reason: degradeReasons.join(","),
        rcaPending: rcaRequired,
      });
      degradedNow = true;
    } else if (rcaRequired && alreadyOff) {
      // Already degraded and a new reminder over-upgrade appeared: keep the RCA
      // gate without resetting the cooldown.
      this.controlPlane.setRcaPending();
    }

    return {
      state: this.controlPlane.isForcedOff() ? "degraded" : "active",
      degradedNow,
      alerts,
      reasonCodes: degradeReasons,
      rcaRequired,
    };
  }

  /**
   * Request a manual reopen. Delegates to the control plane's versioned atomic CAS,
   * which re-validates — against persisted state, server time — human confirmation,
   * the control-plane-owned cooldown, and RCA resolution, records the operator, and
   * returns `state_changed_retry_required` if the state changed concurrently. The
   * caller cannot supply a timestamp.
   */
  requestReopen(req: ReopenAttempt): ReopenOutcome {
    return this.controlPlane.attemptReopen(req);
  }
}
