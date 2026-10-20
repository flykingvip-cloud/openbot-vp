/**
 * P4.5c chat choke-point. Copies observeInboundTurnShadow:
 * synchronous, try/catch, never await tools, never throw into chat.send.
 *
 * Carries server-derived identity for a later allowlist grant. Live invoke
 * remains frozen. Flags default OFF. Gate C: when ORCH_SHADOW is on (host env
 * later; source default still OFF) and DISPATCH is off, considerDispatch
 * scores routeStep even if the allowlist is empty. Never invoke.
 *
 * P3: the intent comes from this turn's user text. Empty text keeps the
 * legacy recall_memory probe. allowlistEmpty stays true unless the tenant is
 * on OPENBOT_CONVERSATION_TASK_ORCH_TENANT_ALLOWLIST and the text has an
 * explicit stepped kind. That pair is the only enqueue admission; it does
 * not flip live invoke.
 *
 * Phase B B2: observeWebReadShadowFromChat is a parallel shadow path gated by
 * ORCH_SHADOW && WEB_READ_SHADOW. It never replaces the legacy recall_memory probe.
 */
import { debuglog } from "node:util";
import type { OpenBotConfig } from "../config/config.js";
import { resolveSecurityProfile } from "../gateway/security-profile.js";
import { considerDispatchFromEnv } from "./dispatch.js";
import { isWebReadShadowEnabled, readOrchestrationFlags } from "./feature.js";
import { resolveOrchestrationObserve } from "./observe-gate.js";
import { ORCH_REASON } from "./reason-codes.js";
import {
  evaluateWebReadShadow,
  type WebReadDecisionClass,
  type WebReadShadowPrediction,
  type WebReadShadowProfile,
} from "./web-read-shadow-eval.js";

const debugWebReadShadow = debuglog("openbot:web-read-shadow");

export type OrchestrationObserveInput = {
  tenantId?: string | null;
  requesterId?: string | null;
  conversationId?: string | null;
  messageId?: string;
  /** This turn's user text. Omitted text keeps the legacy recall_memory probe. */
  text?: string | null;
};

export function observeOrchestrationConsider(input: OrchestrationObserveInput = {}): void {
  try {
    const observed = resolveOrchestrationObserve(input);
    considerDispatchFromEnv({
      intent: observed.intent,
      flags: readOrchestrationFlags(),
      allowlistEmpty: observed.allowlistEmpty,
      tenantId: input.tenantId ?? null,
      requesterId: input.requesterId ?? null,
      conversationId: input.conversationId ?? null,
      messageId: input.messageId ?? "",
    });
  } catch {
    // never throw into the reply path
  }
}

/** Whitelist-only sink payload. No ids / text / urls / full prediction. */
export type SafeWebReadShadowObservation = {
  schemaVersion: 1;
  profileLabel: "A" | "B";
  decisionClass: "web_read" | "not_web_read" | "clarify";
  kind: "selected" | "clarify" | "noop" | "reject";
  reasonCodes: string[];
  policyGap: boolean;
  evidenceGap: boolean;
  humanGate: "yes" | "no" | "unknown";
  predictorCalled: boolean;
  latencyBucketMs: 0 | 1 | 2 | 5 | 10 | 20 | 50 | 100;
  invoke: false;
  enqueue: false;
  wroteLedger: false;
  invokedTool: false;
  tenantPresent: boolean;
  utteranceEmpty: boolean;
};

export type WebReadShadowObservationSink = (obs: SafeWebReadShadowObservation) => void;

export type WebReadShadowChatInput = {
  cfg: OpenBotConfig;
  tenantId: string | null;
  messageId: string | null;
  utterance: string;
};

const LATENCY_BUCKETS = [0, 1, 2, 5, 10, 20, 50, 100] as const;

function nowMs(): number {
  const perf = globalThis.performance;
  if (perf && typeof perf.now === "function") {
    return perf.now();
  }
  return Date.now();
}

function isMissingTenant(tenantId: string | null | undefined): boolean {
  return tenantId == null || tenantId.trim() === "";
}

function mapSecurityProfileToWebRead(cfg: OpenBotConfig): WebReadShadowProfile {
  const resolution = resolveSecurityProfile(cfg, process.env);
  return resolution.profile === "managed_enterprise" ? "B" : "A";
}

function latencyBucketMs(ms: number): SafeWebReadShadowObservation["latencyBucketMs"] {
  const value = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  for (const bucket of LATENCY_BUCKETS) {
    if (value <= bucket) {
      return bucket;
    }
  }
  return 100;
}

function stableCaseIdFrom(messageId: string | null): string {
  if (typeof messageId === "string" && messageId.trim() !== "") {
    return messageId;
  }
  return `web-read-shadow-${Date.now().toString(36)}`;
}

function decisionClassOf(prediction: WebReadShadowPrediction): WebReadDecisionClass {
  const surface = prediction.decision.surface;
  if (surface === "web_read" || surface === "not_web_read" || surface === "clarify") {
    return surface;
  }
  return "clarify";
}

function toSafeWebReadShadowObservation(
  prediction: WebReadShadowPrediction,
  profileLabel: WebReadShadowProfile,
  predictorCalled: boolean,
  elapsedMs: number,
  utterance: string,
): SafeWebReadShadowObservation {
  return {
    schemaVersion: 1,
    profileLabel,
    decisionClass: decisionClassOf(prediction),
    kind: prediction.decision.kind,
    reasonCodes: [...prediction.reasonCodes],
    policyGap: prediction.gap.policyGap,
    evidenceGap: prediction.gap.evidenceGap,
    humanGate: prediction.humanGate,
    predictorCalled,
    latencyBucketMs: latencyBucketMs(elapsedMs),
    invoke: false,
    enqueue: false,
    wroteLedger: false,
    invokedTool: false,
    tenantPresent: !isMissingTenant(prediction.tenantId),
    utteranceEmpty: utterance.trim() === "",
  };
}

function failClosedMissingTenantObservation(utterance: string): SafeWebReadShadowObservation {
  return {
    schemaVersion: 1,
    profileLabel: "B",
    decisionClass: "clarify",
    kind: "reject",
    reasonCodes: [ORCH_REASON.FAIL_CLOSED, ORCH_REASON.HUMAN_GATE],
    policyGap: true,
    evidenceGap: true,
    humanGate: "yes",
    predictorCalled: false,
    latencyBucketMs: 0,
    invoke: false,
    enqueue: false,
    wroteLedger: false,
    invokedTool: false,
    tenantPresent: false,
    utteranceEmpty: utterance.trim() === "",
  };
}

function internalSafeDebugSink(obs: SafeWebReadShadowObservation): void {
  debugWebReadShadow(
    "profile=%s decision=%s kind=%s reasons=%s predictorCalled=%s latencyBucketMs=%s tenantPresent=%s utteranceEmpty=%s invoke=false enqueue=false wroteLedger=false invokedTool=false",
    obs.profileLabel,
    obs.decisionClass,
    obs.kind,
    obs.reasonCodes.join(","),
    obs.predictorCalled,
    obs.latencyBucketMs,
    obs.tenantPresent,
    obs.utteranceEmpty,
  );
}

function emitSafe(sink: WebReadShadowObservationSink, obs: SafeWebReadShadowObservation): void {
  try {
    sink(obs);
  } catch {
    // sink throw must never fail chat
  }
}

/**
 * Phase B B2 web_read shadow adapter. Combination gate:
 * ORCH_SHADOW && WEB_READ_SHADOW. Swallows all shadow errors.
 * Does not authorize; does not mutate chat; does not invoke tools.
 */
export function observeWebReadShadowFromChat(
  input: WebReadShadowChatInput,
  sink?: WebReadShadowObservationSink,
): void {
  try {
    const orchOn = readOrchestrationFlags().shadowEnabled;
    const webReadOn = isWebReadShadowEnabled();
    if (!(orchOn && webReadOn)) {
      return;
    }

    const profile = mapSecurityProfileToWebRead(input.cfg);
    const tenantId = profile === "A" ? null : input.tenantId;
    const effectiveSink = sink ?? internalSafeDebugSink;

    if (profile === "B" && isMissingTenant(tenantId)) {
      emitSafe(effectiveSink, failClosedMissingTenantObservation(input.utterance));
      return;
    }

    const started = nowMs();
    const prediction = evaluateWebReadShadow({
      caseId: stableCaseIdFrom(input.messageId),
      profile,
      tenantId,
      utterance: input.utterance,
    });
    const elapsedMs = Math.max(0, nowMs() - started);
    emitSafe(
      effectiveSink,
      toSafeWebReadShadowObservation(prediction, profile, true, elapsedMs, input.utterance),
    );
  } catch {
    // never throw into the reply path
  }
}
