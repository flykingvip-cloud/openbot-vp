/**
 * R5 audit artifact builder for the read-only pilot.
 *
 * Delivers an auditable protocol/fixture comparison table. Does **not** claim
 * R5 live external-site session evidence. Cost deltas are harness step-clock
 * only (`SAR_PILOT_STEP_MS`), never live network RTT.
 */

import { lookupAccountBrowserBridge } from "./account-browser-port.js";
import {
  comparePilotRead,
  PILOT_COMPARISON_COST_CLOCK,
  PILOT_COMPARISON_EVIDENCE_KIND,
  type PilotComparison,
} from "./pilot-comparison.js";
import {
  SAR_PILOT_BINDING_ID,
  SAR_PILOT_GROUND_TRUTH,
  SAR_PILOT_PRINCIPAL,
  SAR_PILOT_STEP_MS,
  SAR_PILOT_VERSION,
  type PilotHarness,
} from "./readonly-pilot.js";

/** Expert §R5 gate status when only fixture evidence exists. */
export const SAR_R5_STATUS_FIXTURE_ONLY = "not_met_protocol_fixture_only" as const;

export type SarR5Status = typeof SAR_R5_STATUS_FIXTURE_ONLY | "met_live_session";

export type ReadonlyPilotTask = {
  stationId: "bulletin" | "inbox";
  capabilityId: string;
  version: string;
  args: Record<string, string>;
  expected: unknown;
  requiresFixtureSession: boolean;
};

export type ReadonlyPilotAccountScope = {
  tenantId: string;
  userId: string;
  bindingId: string;
  note: string;
};

export type LiveSessionBlocker = {
  id: string;
  detail: string;
};

export type ReadonlyPilotAuditEvidence = {
  r5Status: SarR5Status;
  evidenceKind: typeof PILOT_COMPARISON_EVIDENCE_KIND;
  costClock: typeof PILOT_COMPARISON_COST_CLOCK;
  stepMs: number;
  liveNetworkRtt: false;
  r5LiveSessionClaim: false;
  fixtureRelaxed: false;
  accountScope: ReadonlyPilotAccountScope;
  taskSet: ReadonlyPilotTask[];
  comparisons: PilotComparison[];
  blockers: LiveSessionBlocker[];
  minReproConditions: string[];
  summary: string;
};

/** Fixed task set for the two pilot stations (same account, same args). */
export function readonlyPilotTaskSet(): ReadonlyPilotTask[] {
  return [
    {
      stationId: "bulletin",
      capabilityId: "pilot.bulletin.read",
      version: SAR_PILOT_VERSION,
      args: { desk: SAR_PILOT_GROUND_TRUTH.bulletin.desk },
      expected: SAR_PILOT_GROUND_TRUTH.bulletin,
      requiresFixtureSession: false,
    },
    {
      stationId: "inbox",
      capabilityId: "pilot.inbox.summary",
      version: SAR_PILOT_VERSION,
      args: { mailbox: SAR_PILOT_GROUND_TRUTH.inbox.mailbox },
      expected: SAR_PILOT_GROUND_TRUTH.inbox,
      requiresFixtureSession: true,
    },
  ];
}

export function readonlyPilotAccountScope(): ReadonlyPilotAccountScope {
  return {
    tenantId: SAR_PILOT_PRINCIPAL.tenantId,
    userId: SAR_PILOT_PRINCIPAL.userId,
    bindingId: SAR_PILOT_BINDING_ID,
    note: "Fixture principal + original binding only. Not an enterprise external-site account worker.",
  };
}

/**
 * Probe whether a live account-browser control bridge is available for a scope.
 * Default box has none registered in BROWSER_BRIDGES → R5 live path blocked.
 */
export function probeLiveReadonlyPilotPrerequisites(scopeKey?: string): {
  liveBridgeAvailable: boolean;
  blockers: LiveSessionBlocker[];
  minReproConditions: string[];
} {
  const key = scopeKey?.trim() || "";
  const bridge = key ? lookupAccountBrowserBridge(key) : undefined;
  const blockers: LiveSessionBlocker[] = [];
  if (!key) {
    blockers.push({
      id: "no_scope_key",
      detail: "No account-browser scopeKey provided for live bridge lookup.",
    });
  } else if (!bridge) {
    blockers.push({
      id: "no_control_bridge",
      detail: `BROWSER_BRIDGES has no control-bridge entry for scopeKey=${key}. Default runtime stays fail-closed (BROWSER_UNAVAILABLE).`,
    });
  } else if (bridge.kind === "fixture-bridge") {
    blockers.push({
      id: "fixture_bridge_only",
      detail: `scopeKey=${key} resolves to a fixture-bridge, not a live account-worker control bridge.`,
    });
  }
  blockers.push({
    id: "no_enterprise_logged_in_session",
    detail:
      "No logged-in enterprise external-site account worker session is available in this environment for the same real account + task set.",
  });
  blockers.push({
    id: "cost_must_be_wall_clock",
    detail:
      "R5 cost/latency improvement must come from measured wall-clock on a live session, not SAR_PILOT_STEP_MS harness clock.",
  });
  return {
    liveBridgeAvailable: Boolean(bridge && bridge.kind === "control-bridge"),
    blockers,
    minReproConditions: [
      "Same real account binding registered in SarExecutionAuthority (tenant/user/binding).",
      "Account-browser control bridge online in BROWSER_BRIDGES for that scopeKey (kind=control-bridge).",
      "Logged-in session already established for the bound account (no cookie export; reuse existing worker).",
      "Task set URLs reachable as read-only pages under allowedOrigins for pilot.bulletin.read / pilot.inbox.summary (or production equivalents).",
      "Entry: comparePilotRead / buildReadonlyPilotAuditEvidence against the live port from createAccountBrowserPort(scopeKey); record wall-clock durationMs, not harness ticks.",
      "Report must set r5LiveSessionClaim=true only after live correctness ≥ browser control and wall-clock cost is measured.",
    ],
  };
}

/**
 * Run the fixed task set through SAR vs generic-browser on the fixture harness.
 * Always returns r5Status=not_met_protocol_fixture_only unless a future live path is wired.
 */
export async function buildReadonlyPilotAuditEvidence(input: {
  harness: PilotHarness;
  /** Optional scopeKey to probe; absence is recorded as a blocker. */
  liveScopeKey?: string;
  /** Fixture session already established for inbox when true. */
  fixtureSessionReady?: boolean;
}): Promise<ReadonlyPilotAuditEvidence> {
  const accountScope = readonlyPilotAccountScope();
  const taskSet = readonlyPilotTaskSet();
  const probe = probeLiveReadonlyPilotPrerequisites(input.liveScopeKey);
  const comparisons: PilotComparison[] = [];

  for (const task of taskSet) {
    if (task.requiresFixtureSession && !input.fixtureSessionReady) {
      continue;
    }
    const station =
      task.stationId === "bulletin"
        ? input.harness.stations.bulletin
        : input.harness.stations.inbox;
    const comparison = await comparePilotRead({
      harness: input.harness,
      principal: input.harness.principal,
      bindingId: input.harness.bindingId,
      station,
      args: task.args,
      expected: task.expected,
    });
    comparisons.push(comparison);
  }

  // Live path is not wired in this delivery; fixture evidence never upgrades to met.
  const r5Status: SarR5Status = SAR_R5_STATUS_FIXTURE_ONLY;
  const allCorrect =
    comparisons.length > 0 && comparisons.every((c) => c.correctnessAtLeastGenericBrowser);
  const summary = allCorrect
    ? `Protocol/fixture comparison: SAR correctness ≥ generic browser on ${comparisons.length} station(s); cost deltas are harness_step_clock (${SAR_PILOT_STEP_MS}ms/op), not live RTT. R5 status: ${r5Status}.`
    : `Protocol/fixture comparison incomplete or correctness bar not met. R5 status: ${r5Status}.`;

  return {
    r5Status,
    evidenceKind: PILOT_COMPARISON_EVIDENCE_KIND,
    costClock: PILOT_COMPARISON_COST_CLOCK,
    stepMs: SAR_PILOT_STEP_MS,
    liveNetworkRtt: false,
    r5LiveSessionClaim: false,
    fixtureRelaxed: false,
    accountScope,
    taskSet,
    comparisons,
    blockers: probe.blockers,
    minReproConditions: probe.minReproConditions,
    summary,
  };
}

/** Markdown table rows for one comparison (for reports / tests). */
export function formatComparisonTableRow(c: PilotComparison): string {
  return `| ${c.stationId} | ${c.capabilityId} | SAR ${c.sar.dispatchCount}/${c.sar.durationMs}ms correct=${c.sar.correct} | browser ${c.genericBrowser.dispatchCount}/${c.genericBrowser.durationMs}ms correct=${c.genericBrowser.correct} | ${c.correctnessAtLeastGenericBrowser} | harness_step_clock (not live RTT) |`;
}
