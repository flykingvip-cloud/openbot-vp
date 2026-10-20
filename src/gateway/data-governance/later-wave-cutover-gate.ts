/**
 * Later-wave LIVE cutover is a separate ops act from I4 enablement.
 * Records a fail-closed decision; never mutates production, Catalog, or git.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { LaterWaveEnablementReceipt } from "./later-wave-production-gate.js";

export const LATER_WAVE_CUTOVER_DECISION_KIND = "p4_later_wave_cutover_decision" as const;

export type LaterWaveTrunkSnapshot = {
  dirty: boolean;
  headSha: string;
  originMainSha: string;
};

export type LaterWaveCutoverDeny =
  | "live_cutover_forbidden"
  | "enablement_not_ready"
  | "trunk_dirty"
  | "not_origin_main_tip";

export type LaterWaveCutoverFinding = {
  check: "enablement" | "trunk" | "live_cutover";
  passed: boolean;
  detail: string;
};

export type LaterWaveCutoverDecision = {
  kind: typeof LATER_WAVE_CUTOVER_DECISION_KIND;
  decisionId: string;
  tenantId: string;
  adapter: LaterWaveEnablementReceipt["adapter"] | "none";
  enablementReady: boolean;
  trunkReady: boolean;
  /** Always false in this drop. LIVE remains a separate ops act. */
  cutoverAllowed: false;
  liveCutoverRequested: boolean;
  findings: LaterWaveCutoverFinding[];
  originMainSha: string;
  headSha: string;
};

function writeJsonReceipt(receiptDir: string, decisionId: string, payload: unknown): void {
  fs.mkdirSync(receiptDir, { recursive: true });
  fs.writeFileSync(
    path.join(receiptDir, `${decisionId}.json`),
    `${JSON.stringify(payload, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
}

/** LIVE cutover is never authorized by later-wave enablement. */
export function assertLaterWaveLiveCutover(params: { requested: boolean }): {
  ok: boolean;
  reasonCode: "live_cutover_forbidden" | "evaluation_only";
} {
  if (params.requested) {
    return { ok: false, reasonCode: "live_cutover_forbidden" };
  }
  return { ok: true, reasonCode: "evaluation_only" };
}

/** Production candidate must be a clean origin/main tip. */
export function assertLaterWaveTrunkDeployGate(params: LaterWaveTrunkSnapshot):
  | {
      ok: true;
    }
  | { ok: false; reasonCode: "trunk_dirty" | "not_origin_main_tip" } {
  const headSha = params.headSha.trim();
  const originMainSha = params.originMainSha.trim();
  if (params.dirty) {
    return { ok: false, reasonCode: "trunk_dirty" };
  }
  if (!headSha || !originMainSha || headSha !== originMainSha) {
    return { ok: false, reasonCode: "not_origin_main_tip" };
  }
  return { ok: true };
}

export function decideLaterWaveCutover(params: {
  enablement: LaterWaveEnablementReceipt | null;
  liveCutoverRequested: boolean;
  trunk: LaterWaveTrunkSnapshot;
  receiptDir: string;
}): {
  ok: boolean;
  reasonCode: LaterWaveCutoverDeny | "evaluation_only";
  decision: LaterWaveCutoverDecision;
} {
  const enablementReady = params.enablement?.productionReady === true;
  const trunk = assertLaterWaveTrunkDeployGate(params.trunk);
  const live = assertLaterWaveLiveCutover({ requested: params.liveCutoverRequested });
  const findings: LaterWaveCutoverFinding[] = [
    {
      check: "enablement",
      passed: enablementReady,
      detail: enablementReady ? "production_ready" : "enablement_not_ready",
    },
    {
      check: "trunk",
      passed: trunk.ok,
      detail: trunk.ok ? "origin_main_tip" : trunk.reasonCode,
    },
    {
      check: "live_cutover",
      passed: false,
      detail: live.reasonCode,
    },
  ];
  const decision: LaterWaveCutoverDecision = {
    kind: LATER_WAVE_CUTOVER_DECISION_KIND,
    decisionId: `p4lw-cutover-${randomUUID()}`,
    tenantId: params.enablement?.tenantId ?? "",
    adapter: params.enablement?.adapter ?? "none",
    enablementReady,
    trunkReady: trunk.ok,
    cutoverAllowed: false,
    liveCutoverRequested: params.liveCutoverRequested,
    findings,
    originMainSha: params.trunk.originMainSha.trim(),
    headSha: params.trunk.headSha.trim(),
  };
  writeJsonReceipt(params.receiptDir, decision.decisionId, decision);

  if (params.liveCutoverRequested) {
    return { ok: false, reasonCode: "live_cutover_forbidden", decision };
  }
  if (!enablementReady) {
    return { ok: false, reasonCode: "enablement_not_ready", decision };
  }
  if (!trunk.ok) {
    return { ok: false, reasonCode: trunk.reasonCode, decision };
  }
  return { ok: true, reasonCode: "evaluation_only", decision };
}
