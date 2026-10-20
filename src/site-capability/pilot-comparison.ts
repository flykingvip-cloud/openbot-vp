/**
 * Compare one pilot read with a longer generic-browser walk.
 *
 * P3 redefinition / R5 honesty: this is **protocol fixture verification** for
 * the read-only pilot, not a live external-site session and not an R5 pass.
 * Both paths use the account-browser serial dispatcher and the finite
 * operation set. The generic walk is not a second browser, a Bridge daemon,
 * or a live network session. Latency uses the harness step clock
 * (`SAR_PILOT_STEP_MS`) — not a live network RTT.
 */

import { randomUUID } from "node:crypto";
import { DEFAULT_BROWSER_EVALUATE_ENABLED } from "../browser/constants.js";
import type { SarExecutionAuthority } from "./execution-authority.js";
import type { TrustedPagePort } from "./operations.js";
import {
  pilotNavigationUrl,
  SAR_PILOT_STEP_MS,
  type PilotHarness,
  type PilotStation,
} from "./readonly-pilot.js";
import type { SiteCompleteness, SiteRunResult, SiteRunStatus } from "./result.js";
import { SAR_SERVER_PAGE_TARGET, type SiteCapabilityRuntime } from "./runtime.js";
import type { ServerPrincipal } from "./session-handle.js";

/** Fixed honesty labels for every fixture comparison. Never claim R5 live. */
export const PILOT_COMPARISON_EVIDENCE_KIND = "protocol_fixture" as const;
export const PILOT_COMPARISON_COST_CLOCK = "harness_step_clock" as const;

export type PilotSide = {
  output: unknown;
  status: SiteRunStatus;
  completeness: SiteCompleteness;
  dispatchCount: number;
  durationMs: number;
  correct: boolean;
  runId: string | null;
};

export type PilotComparison = {
  stationId: PilotStation["id"];
  capabilityId: string;
  version: string;
  sar: PilotSide;
  genericBrowser: PilotSide;
  correctnessAtLeastGenericBrowser: boolean;
  cost: {
    dispatchCountImproved: boolean;
    durationImproved: boolean;
    /** Always harness step-clock; never live RTT. */
    clock: typeof PILOT_COMPARISON_COST_CLOCK;
    note: string;
  };
  /** Honest evidence boundary — fixture protocol only. */
  evidenceKind: typeof PILOT_COMPARISON_EVIDENCE_KIND;
  liveNetworkRtt: false;
  r5LiveSessionClaim: false;
  fixtureRelaxed: false;
  conclusion: string;
};

function sameOutput(actual: unknown, expected: unknown): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function costNote(sar: PilotSide, browser: PilotSide): string {
  const dispatch =
    sar.dispatchCount < browser.dispatchCount
      ? `SAR used ${sar.dispatchCount} dispatches and the generic browser walk used ${browser.dispatchCount}.`
      : `Dispatch count did not improve (${sar.dispatchCount} vs ${browser.dispatchCount}).`;
  const duration =
    sar.durationMs < browser.durationMs
      ? `Harness step-clock latency improved (${sar.durationMs}ms vs ${browser.durationMs}ms). Each trusted operation costs ${SAR_PILOT_STEP_MS}ms on this clock. That is not a live network RTT. Do not claim a live-session cost win or R5 pass from this fixture.`
      : `Harness step-clock latency did not improve (${sar.durationMs}ms vs ${browser.durationMs}ms). Do not claim a live-session latency win from this fixture. This is not an R5 live-session claim.`;
  return `${dispatch} ${duration}`;
}

function conclusionFor(input: {
  sarCorrect: boolean;
  browserCorrect: boolean;
  dispatchImproved: boolean;
  durationImproved: boolean;
}): string {
  const correctness =
    input.sarCorrect && input.browserCorrect
      ? "SAR and the generic browser both matched ground truth. Correctness is equal and meets the fixture bar."
      : input.sarCorrect
        ? "SAR matched ground truth and the generic browser did not. Correctness meets the fixture bar."
        : "SAR did not match ground truth. The correctness bar is not met.";
  const cost = input.dispatchImproved
    ? "Dispatch count improved on the harness clock."
    : "Dispatch count did not improve.";
  const latency = input.durationImproved
    ? "Harness step-clock latency improved. This is not a live network RTT."
    : "Harness step-clock latency did not improve. Do not claim a live-session latency win from this fixture.";
  return `${correctness} ${cost} ${latency} Evidence kind: protocol_fixture. Not an R5 live-session claim.`;
}

async function runGenericBrowser(input: {
  authority: SarExecutionAuthority;
  port: TrustedPagePort;
  principal: ServerPrincipal;
  bindingId: string;
  station: PilotStation;
  args: Readonly<Record<string, string>>;
  startedAt: number;
  now: () => number;
}): Promise<{ status: SiteRunStatus; data: unknown; durationMs: number }> {
  const handle = input.authority.resolveSessionHandle({
    principal: input.principal,
    bindingId: input.bindingId,
    pageTargetId: SAR_SERVER_PAGE_TARGET,
  });
  if (!handle.ok) {
    return { status: "failed", data: null, durationMs: 0 };
  }
  const runId = `genrun_${randomUUID()}`;
  const bound = input.authority.bindRun({
    handleToken: handle.handle.token,
    runId,
    capabilityId: input.station.capabilityId,
    version: input.station.version,
  });
  if (!bound.ok) {
    return { status: "failed", data: null, durationMs: 0 };
  }
  const steps: Array<Record<string, unknown>> = [
    { op: "navigate", url: pilotNavigationUrl(input.station, input.args) },
    { op: "read_page", fields: [...input.station.browserReadFields] },
    { op: "request_context", name: "page" },
    { op: "capture_result", fields: [...input.station.captureFields] },
  ];
  try {
    let data: unknown = null;
    for (const rawOp of steps) {
      const dispatched = await input.authority.dispatch({
        runId,
        handleToken: handle.handle.token,
        rawOp,
        port: input.port,
        productEvaluateEnabled: DEFAULT_BROWSER_EVALUATE_ENABLED,
      });
      if (!dispatched.ok) {
        return {
          status: "failed",
          data: null,
          durationMs: Math.max(0, input.now() - input.startedAt),
        };
      }
      if (dispatched.value.kind === "capture_result") {
        data = dispatched.value.data;
      }
    }
    return {
      status: "succeeded",
      data,
      durationMs: Math.max(0, input.now() - input.startedAt),
    };
  } finally {
    input.authority.releaseRun(runId);
  }
}

/**
 * Run the granted SAR plan, then the longer generic walk, against one expected record.
 * Metrics are reset around each side so the counts stay separate.
 * Result is always tagged as protocol_fixture — never an R5 live claim.
 */
export async function comparePilotRead(input: {
  harness: PilotHarness;
  runtime?: SiteCapabilityRuntime;
  principal: ServerPrincipal;
  bindingId: string;
  station: PilotStation;
  args: Record<string, string>;
  expected: unknown;
}): Promise<PilotComparison> {
  const runtime = input.runtime ?? input.harness.runtime;
  input.harness.resetMetrics();
  const invoked = await runtime.invoke(input.principal, {
    capabilityId: input.station.capabilityId,
    version: input.station.version,
    args: input.args,
    accountBindingId: input.bindingId,
  });
  const sarMetrics = input.harness.metrics();
  const sar = sideFromRun(invoked, sarMetrics.dispatches, input.expected);
  input.harness.resetMetrics();
  const started = input.harness.metrics().now;
  const generic = await runGenericBrowser({
    authority: input.harness.authority,
    port: input.harness.port,
    principal: input.principal,
    bindingId: input.bindingId,
    station: input.station,
    args: input.args,
    startedAt: started,
    now: () => input.harness.metrics().now,
  });
  const browserMetrics = input.harness.metrics();
  const genericBrowser: PilotSide = {
    output: generic.data,
    status: generic.status,
    completeness: "complete",
    dispatchCount: browserMetrics.dispatches,
    durationMs: generic.durationMs,
    correct: generic.status === "succeeded" && sameOutput(generic.data, input.expected),
    runId: null,
  };
  const dispatchCountImproved = sar.dispatchCount < genericBrowser.dispatchCount;
  const durationImproved = sar.durationMs < genericBrowser.durationMs;
  // A ground-truth match is equal when the browser also matches, and better when it does not.
  // A miss fails the bar even when the browser missed too.
  const correctnessAtLeastGenericBrowser = sar.correct;
  return {
    stationId: input.station.id,
    capabilityId: input.station.capabilityId,
    version: input.station.version,
    sar,
    genericBrowser,
    correctnessAtLeastGenericBrowser,
    cost: {
      dispatchCountImproved,
      durationImproved,
      clock: PILOT_COMPARISON_COST_CLOCK,
      note: costNote(sar, genericBrowser),
    },
    evidenceKind: PILOT_COMPARISON_EVIDENCE_KIND,
    liveNetworkRtt: false,
    r5LiveSessionClaim: false,
    fixtureRelaxed: false,
    conclusion: conclusionFor({
      sarCorrect: sar.correct,
      browserCorrect: genericBrowser.correct,
      dispatchImproved: dispatchCountImproved,
      durationImproved,
    }),
  };
}

function sideFromRun(run: SiteRunResult, dispatchCount: number, expected: unknown): PilotSide {
  return {
    output: run.data,
    status: run.status,
    completeness: run.completeness,
    dispatchCount,
    durationMs: run.durationMs,
    correct:
      run.status === "succeeded" &&
      run.completeness === "complete" &&
      sameOutput(run.data, expected),
    runId: run.runId,
  };
}
