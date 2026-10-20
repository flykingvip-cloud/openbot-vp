/**
 * Gated candidate-run producer (Phase C1) — the single LLM->candidate boundary for
 * the schedule/meeting lifecycle (invite drafting, minutes, conversation extraction).
 *
 * Hard rules from the design (3.3 / 6):
 * - Every LLM step goes through the commercial gate `tryAcquireEnterpriseAgentRun`
 *   and `releaseEnterpriseAgentRun` in `finally` (this file is a registered
 *   no-bypass entrypoint — see commercial-run-entrypoints.registry.ts).
 * - Non-enterprise / no commercial governance (`skipped`) => decision B: DO NOT call
 *   the model. Budget/quota/model-gate denial => `denied`, also no model call.
 * - The model only ever yields untrusted text; it is validated into a typed
 *   candidate via a C0 validator (`parse`) before anyone may persist it.
 * - Token usage is reported per-user via the canonical emit path
 *   (`UsageReportedEvent` carrying userId) so cost attribution (total -> Seat/Usage
 *   -> user) works (R9 / R18 / R21).
 *
 * The model invocation (`runModel`) and usage reporter are injected so this
 * orchestration is fully unit-testable without a live model or live billing; the
 * real wiring (a `main` agent turn, the real `reportUsageEvent`) is supplied by the
 * callers that build prompts for each candidate kind (C2/C3).
 */

import type { CandidateValidation } from "../../organization/lifecycle-candidates.js";
import {
  type AcquireAgentRunResult,
  releaseEnterpriseAgentRun,
  tryAcquireEnterpriseAgentRun,
} from "../billing/agent-run-governance.js";
import { reportUsageEvent } from "../billing/report-usage-event.js";
import type {
  EmployeeModelGateInput,
  EmployeeModelGateResult,
} from "../model-entitlement/employee-model-gate.js";

const DEFAULT_AGENT_ID = "main";
const DEFAULT_USAGE_KEY = "ai_token";

/** Context handed to the injected model runner once the gate is acquired. */
export type GatedModelRunContext = {
  runId: string;
  agentId: string;
  enterpriseId: string;
  prompt: string;
  modelGate?: EmployeeModelGateResult;
};

/** Raw model output: the text to validate plus the metered token quantity. */
export type GatedModelOutput = { text: string; usageQuantity: number };

export type GatedModelRunner = (ctx: GatedModelRunContext) => Promise<GatedModelOutput>;

export type GatedUsageReporter = (args: {
  enterpriseId: string;
  userId: string;
  eventId: string;
  key: string;
  quantity: number;
  agentId?: string;
}) => Promise<void>;

export type GatedCandidateRunDeps = {
  /** The model invocation (real wiring injected by callers; required). */
  runModel: GatedModelRunner;
  /** Overridable for tests; defaults to the real commercial gate. */
  acquire?: typeof tryAcquireEnterpriseAgentRun;
  release?: typeof releaseEnterpriseAgentRun;
  /** Overridable for tests; defaults to the canonical per-user usage emit path. */
  reportUsage?: GatedUsageReporter;
};

export type GatedCandidateRunParams<T> = {
  runId: string;
  /** The user the usage is attributed to (per-user cost attribution). */
  userId: string;
  /** Defaults to "main". */
  agentId?: string;
  enterpriseId?: string;
  /** Metering key for the reported usage; defaults to "ai_token". */
  usageKey?: string;
  modelGateInput?: EmployeeModelGateInput;
  /** Fully-built prompt (callers build it per candidate kind). */
  prompt: string;
  /** C0 validator (typically wrapping JSON.parse) turning raw text into a typed candidate. */
  parse: (raw: string) => CandidateValidation<T>;
};

export type GatedCandidateRunResult<T> =
  | { status: "produced"; candidate: T; enterpriseId: string; usageQuantity: number }
  | { status: "invalid"; errors: string[]; enterpriseId: string }
  | { status: "skipped" }
  | { status: "denied"; reason: string; message: string }
  | { status: "failed"; message: string; enterpriseId: string };

async function defaultReportUsage(args: {
  enterpriseId: string;
  userId: string;
  eventId: string;
  key: string;
  quantity: number;
  agentId?: string;
}): Promise<void> {
  await reportUsageEvent({
    enterpriseId: args.enterpriseId,
    userId: args.userId,
    eventId: args.eventId,
    key: args.key,
    quantity: args.quantity,
    ...(args.agentId ? { agentId: args.agentId } : {}),
  });
}

/**
 * Runs one gated LLM turn and returns a validated candidate (or a skip/deny/invalid/
 * failure outcome). The commercial slot is always released when it was acquired.
 */
export async function runGatedCandidateRun<T>(
  params: GatedCandidateRunParams<T>,
  deps: GatedCandidateRunDeps,
): Promise<GatedCandidateRunResult<T>> {
  const acquire = deps.acquire ?? tryAcquireEnterpriseAgentRun;
  const release = deps.release ?? releaseEnterpriseAgentRun;
  const reportUsage = deps.reportUsage ?? defaultReportUsage;
  const agentId = params.agentId?.trim() || DEFAULT_AGENT_ID;
  const usageKey = params.usageKey?.trim() || DEFAULT_USAGE_KEY;

  const gate: AcquireAgentRunResult = await acquire({
    runId: params.runId,
    agentId,
    ...(params.enterpriseId !== undefined ? { enterpriseId: params.enterpriseId } : {}),
    ...(params.modelGateInput ? { modelGateInput: params.modelGateInput } : {}),
  });

  if (!gate.acquired) {
    // skipped = 非企业 / 无商业治理 → 决策 B：不调用模型。
    if (gate.skipped) {
      return { status: "skipped" };
    }
    return { status: "denied", reason: gate.reason, message: gate.message };
  }

  const enterpriseId = gate.enterpriseId;
  try {
    let output: GatedModelOutput;
    try {
      output = await deps.runModel({
        runId: params.runId,
        agentId,
        enterpriseId,
        prompt: params.prompt,
        ...(gate.modelGate ? { modelGate: gate.modelGate } : {}),
      });
    } catch (err) {
      // The model never produced output; nothing to meter. Slot is freed in finally.
      return {
        status: "failed",
        message: err instanceof Error ? err.message : String(err),
        enterpriseId,
      };
    }

    // The model consumed tokens, so usage is reported per-user regardless of whether
    // the output parsed (a hallucinated/invalid draft still cost tokens).
    await reportUsage({
      enterpriseId,
      userId: params.userId,
      eventId: `${params.runId}:${usageKey}`,
      key: usageKey,
      quantity: output.usageQuantity,
      agentId,
    });

    const parsed = params.parse(output.text);
    if (!parsed.ok) {
      return { status: "invalid", errors: parsed.errors, enterpriseId };
    }
    return {
      status: "produced",
      candidate: parsed.value,
      enterpriseId,
      usageQuantity: output.usageQuantity,
    };
  } finally {
    await release(params.runId);
  }
}
