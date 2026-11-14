/**
 * Employee-facing rule-adaptation advice: sanitize untrusted client input,
 * let a trusted server host build the official shadow binding, and map the
 * isolated shadow result into a four-state suggestion that is never marked
 * effective. Does not activate policy, write configuration, or publish rules.
 */
import { randomUUID } from "node:crypto";
import type { OpenBotConfig } from "../../../config/config.js";
import { PRODUCTION_RUNTIME_RULE_WHITELIST } from "../../contracts/rule-adaptation-activation.js";
import {
  DEFAULT_SHADOW_BUDGET_LIMITS,
  INVENTORY_PIN,
  type RuleAdaptationHostView,
  type ShadowOutcomeCode,
  type ShadowRunRequest,
  type ShadowRunResult,
} from "../../contracts/rule-adaptation-shadow.js";
import type {
  HostCompatibilityRecord,
  HostExpectedPolicyState,
} from "../../contracts/rule-adaptation.js";
import type { SessionTaskBoard } from "../../contracts/task.js";
import { createAuthorizedModelSession, type ModelSessionPorts } from "../../model/index.js";
import type { GovernedShadowModelPortDeps } from "../../model/rule-adaptation/index.js";
import { validateRuntimeRuleProposal } from "../../policy/rule-adaptation/index.js";
import { readRuntimeRuleAdaptationBoard } from "../../state/mutations/runtime-rule-adaptation.js";
import { emptyControlSnapshot } from "./control-snapshot.js";
import {
  bindShadowHostAbortSignal,
  runOfficialShadowRuleAdaptation,
  type OfficialShadowHostBinding,
} from "./official-shadow.js";

/**
 * Official read-only access to the SessionTaskBoard used as the authoritative
 * record for employee advice policy facts. Does not create a session or a task.
 */
export function readOfficialEmployeeAdviceTaskBoard(sessionFile: string): SessionTaskBoard {
  return readRuntimeRuleAdaptationBoard(sessionFile);
}

export const EMPLOYEE_ADVICE_METHOD = "runtime-rule-adaptation.advice" as const;
export const EMPLOYEE_ADVICE_CANCEL_METHOD = "runtime-rule-adaptation.advice.cancel" as const;
export const EMPLOYEE_ADVICE_NOT_EFFECTIVE_LABEL = "尚未生效" as const;

export const EMPLOYEE_ADVICE_STATES = [
  "no_change",
  "needs_information",
  "blocked",
  "adjustment_suggested",
  "interpretation_pending",
  "failed",
] as const;

export type EmployeeAdviceState = (typeof EMPLOYEE_ADVICE_STATES)[number];

export const EMPLOYEE_ADVICE_STATE_LABELS: Record<EmployeeAdviceState, string> = {
  no_change: "无需调整",
  needs_information: "需补信息",
  blocked: "被阻止",
  adjustment_suggested: "建议调整",
  interpretation_pending: "规则解释／待核验",
  failed: "建议失败",
};

/** Fields a client may legally submit. Everything else is ignored. */
export type EmployeeAdviceClientFields = {
  question?: unknown;
  targetRef?: unknown;
  /** Client correlation id used only to cancel this advice request. */
  requestId?: unknown;
};

export type SanitizedEmployeeAdviceTargetRef = {
  sessionKey?: string;
  agentId?: string;
};

export type SanitizedEmployeeAdviceRequest = {
  question: string;
  targetRef: SanitizedEmployeeAdviceTargetRef;
  requestId?: string;
};

export type EmployeeAdviceReasonView = {
  code: string;
  message: string;
  path?: string;
};

export type EmployeeAdviceView = {
  state: EmployeeAdviceState;
  label: string;
  notEffective: true;
  notEffectiveLabel: typeof EMPLOYEE_ADVICE_NOT_EFFECTIVE_LABEL;
  summary: string;
  reasons: EmployeeAdviceReasonView[];
  proposal?: unknown;
  outcomeCode?: ShadowOutcomeCode | "client_rejected" | "soft_failure";
  activationAllowed: false;
  requestId: string;
  modelCalled: boolean;
  /**
   * Set only for a consultation with no trusted task binding.
   * The explanation does not promise that a proposal applies to a task.
   */
  taskApplicability?: "unbound";
  /**
   * False when P1 could not fully validate because task constraints or
   * policy facts were missing. Never set true to paper over a gap.
   */
  proposalFullyValidated?: false;
};

export type TrustedEmployeeAdviceIdentity = {
  employeeId: string;
  principalId: string;
  tenantId?: string;
  seatId?: string;
  authorizationStatus: "authorized" | "unauthorized";
  authorizationReason?: string;
};

export type TrustedEmployeeAdviceFacts = {
  /**
   * Effective context-token value after comparing the actual model window
   * with any config cap. Must not be the config cap alone.
   */
  currentContextTokens?: number;
  currentContextTokenSource?: "model" | "modelsConfig" | "agentContextTokens";
  modelContextWindow?: number;
  configContextTokenCap?: number;
  approvedTarget?: {
    agentId: string;
    sessionKey?: string;
    scopeId: string;
  };
  /** Seat authorization is not target-rule authorization. */
  targetAuthorization?: "approved" | "denied" | "unknown";
  targetAuthorizationReason?: string;
  compatibilityRecord?: HostCompatibilityRecord;
  expectedPolicyState?: HostExpectedPolicyState;
  expectedPolicyVersion?: {
    policyHash: string;
    protocolVersion: string;
    compilerRevision: string;
  };
  hardMinContextTokens?: number;
  /** Optional host-owned schema hints. Never accepted from the client. */
  requiredProposalShape?: unknown;
};

export type EmployeeAdviceRunShadow = (
  request: ShadowRunRequest,
  binding: OfficialShadowHostBinding,
) => Promise<ShadowRunResult>;

export type TrustedEmployeeAdviceHost = {
  identity: TrustedEmployeeAdviceIdentity;
  facts: TrustedEmployeeAdviceFacts;
  model: {
    provider: string;
    model: string;
    complete: GovernedShadowModelPortDeps["complete"];
    sessionPorts: ModelSessionPorts;
  };
  runShadow?: EmployeeAdviceRunShadow;
  now?: () => number;
  config?: OpenBotConfig | Record<string, never>;
  signal?: AbortSignal;
};

const UNTRUSTED_CLIENT_KEYS = [
  "identity",
  "authorizationStatus",
  "authorization",
  "authorized",
  "apiKey",
  "api_key",
  "token",
  "secret",
  "binding",
  "shadowBinding",
  "hostBinding",
  "trigger",
  "modelKey",
  "credentials",
  "hostFacts",
  "view",
  "controlBoard",
  "activationAllowed",
  "principalId",
  "employeeId",
  "tenantId",
  "seatId",
  "provider",
  "model",
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function ignoredUntrustedClientKeys(input: unknown): string[] {
  if (!isPlainObject(input)) {
    return [];
  }
  return UNTRUSTED_CLIENT_KEYS.filter((key) => key in input);
}

export function sanitizeEmployeeAdviceClientInput(
  input: unknown,
):
  | { ok: true; request: SanitizedEmployeeAdviceRequest; ignoredKeys: string[] }
  | { ok: false; request: SanitizedEmployeeAdviceRequest; ignoredKeys: string[]; reason: string } {
  const ignoredKeys = ignoredUntrustedClientKeys(input);
  const source = isPlainObject(input) ? input : {};
  const question = nonEmptyString(source.question) ?? "";
  const rawRef = isPlainObject(source.targetRef) ? source.targetRef : {};
  const targetRef: SanitizedEmployeeAdviceTargetRef = {
    ...(nonEmptyString(rawRef.sessionKey) ? { sessionKey: nonEmptyString(rawRef.sessionKey) } : {}),
    ...(nonEmptyString(rawRef.agentId) ? { agentId: nonEmptyString(rawRef.agentId) } : {}),
  };
  const requestId = nonEmptyString(source.requestId);
  const request = { question, targetRef, ...(requestId ? { requestId } : {}) };
  if (!question) {
    return {
      ok: false,
      request,
      ignoredKeys,
      reason: "请先说明需要适配的问题或目标，再请求规则适配建议。",
    };
  }
  return { ok: true, request, ignoredKeys };
}

export function mapShadowOutcomeToEmployeeAdviceState(
  outcomeCode: ShadowOutcomeCode | "client_rejected" | "soft_failure" | undefined,
): EmployeeAdviceState {
  switch (outcomeCode) {
    case "no_change_needed":
      return "no_change";
    case "needs_information":
    case "insufficient_sources":
      return "needs_information";
    case "shadow_recorded":
    case "candidate_validated_not_recorded":
      return "adjustment_suggested";
    case "cancelled":
    case "protocol_failure":
    case "budget_exhausted":
    case "soft_failure":
      return "failed";
    case "client_rejected":
    case "insufficient_permission":
    case "hard_rule_conflict":
    case "malicious_material_rejected":
    case "fabricated_rule_id":
    case "unknown_parameter":
    case "validator_blocked":
    case "tool_unavailable":
    default:
      return "blocked";
  }
}

const UNBOUND_CONSULTATION_MESSAGE =
  "这是不承诺任务适用性的规则解释。因缺少任务绑定或完整策略事实，提案尚未完整校验。建议尚未生效。";

function defaultSummary(state: EmployeeAdviceState, fallback: string): string {
  if (fallback.trim()) {
    return fallback;
  }
  switch (state) {
    case "no_change":
      return "当前规则无需调整。建议尚未生效。";
    case "needs_information":
      return "还缺少必要事实，无法给出完整建议。建议尚未生效。";
    case "blocked":
      return "本次建议被阻止。建议尚未生效。";
    case "adjustment_suggested":
      return "已生成规则适配建议，但尚未生效。";
    case "interpretation_pending":
      return UNBOUND_CONSULTATION_MESSAGE;
    case "failed":
      return "本次建议请求失败，不影响已有聊天或原任务。建议尚未生效。";
  }
}

export function buildEmployeeAdviceView(input: {
  requestId: string;
  outcomeCode?: ShadowOutcomeCode | "client_rejected" | "soft_failure";
  reasons?: EmployeeAdviceReasonView[];
  proposal?: unknown;
  summary?: string;
  modelCalled?: boolean;
  state?: EmployeeAdviceState;
  taskApplicability?: "unbound";
  proposalFullyValidated?: false;
}): EmployeeAdviceView {
  const state = input.state ?? mapShadowOutcomeToEmployeeAdviceState(input.outcomeCode);
  const reasons = input.reasons ?? [];
  return {
    state,
    label: EMPLOYEE_ADVICE_STATE_LABELS[state],
    notEffective: true,
    notEffectiveLabel: EMPLOYEE_ADVICE_NOT_EFFECTIVE_LABEL,
    summary: defaultSummary(state, input.summary ?? reasons[0]?.message ?? ""),
    reasons,
    ...(input.proposal !== undefined ? { proposal: input.proposal } : {}),
    ...(input.outcomeCode ? { outcomeCode: input.outcomeCode } : {}),
    activationAllowed: false,
    requestId: input.requestId,
    modelCalled: input.modelCalled === true,
    ...(input.taskApplicability ? { taskApplicability: input.taskApplicability } : {}),
    ...(input.proposalFullyValidated === false ? { proposalFullyValidated: false } : {}),
  };
}

function hasTrustedTaskPolicyFacts(facts: TrustedEmployeeAdviceFacts): boolean {
  return Boolean(facts.compatibilityRecord && facts.expectedPolicyState);
}

/**
 * Outcomes that stay 被阻止／失败 even if a proposal object is present.
 * A missing task binding or compatibility record is not enough to keep these
 * as a pending interpretation.
 */
const EXPLICIT_ADVICE_REJECTION_OUTCOMES = new Set<
  ShadowOutcomeCode | "client_rejected" | "soft_failure"
>([
  "protocol_failure",
  "cancelled",
  "budget_exhausted",
  "client_rejected",
  "insufficient_permission",
  "hard_rule_conflict",
  "malicious_material_rejected",
  "fabricated_rule_id",
  "unknown_parameter",
  "tool_unavailable",
  "soft_failure",
]);

/**
 * Reason codes that independently prove a structural violation, unknown rule,
 * out-of-bounds parameter, or other decidable reject. Missing-binding and
 * missing-host-fact codes are excluded: those are the consultative gap, not
 * a reason to call the proposal a suggested adjustment, and not by themselves
 * a reason to hide a later explicit reject.
 */
const EXPLICIT_ADVICE_REJECTION_REASON_CODES = new Set<string>([
  "structural_non_plain_object",
  "structural_circular_reference",
  "structural_input_too_deep",
  "structural_forbidden_field",
  "structural_unknown_field",
  "structural_invalid_type",
  "structural_mixed_input_kinds",
  "structural_duplicate_field",
  "structural_unusable_host_value",
  "identity_scope_mismatch",
  "unknown_rule_id",
  "non_candidate_field",
  "cancelled_or_tombstone",
  "below_hard_min",
  "above_hard_ceiling",
  "above_current_effective",
  "delete_or_relax_as_tighten",
  "unauthorized_action",
  "hard_boundary_conflict",
  "compatibility_not_approved",
  "current_below_hard_min",
  "validator_must_not_create_candidate",
  "malicious_material_rejected",
  "fabricated_rule_id",
  "unknown_parameter",
  "hard_rule_conflict",
  "protocol_failure",
  "insufficient_permission",
]);

function isExplicitAdviceRejection(
  outcomeCode: ShadowOutcomeCode | "client_rejected" | "soft_failure",
  reasons: ReadonlyArray<{ code: string }>,
): boolean {
  if (EXPLICIT_ADVICE_REJECTION_OUTCOMES.has(outcomeCode)) {
    return true;
  }
  return reasons.some((reason) => EXPLICIT_ADVICE_REJECTION_REASON_CODES.has(reason.code));
}

function consultativeAdviceState(shadow: ShadowRunResult): EmployeeAdviceState {
  if (isExplicitAdviceRejection(shadow.outcomeCode, shadow.reasons)) {
    return mapShadowOutcomeToEmployeeAdviceState(shadow.outcomeCode);
  }
  if (shadow.outcomeCode === "no_change_needed") {
    return "no_change";
  }
  // Missing task binding or compatibility facts: never promote a proposal to
  // 建议调整, and never rewrite validator_blocked as shadow_recorded.
  return "interpretation_pending";
}

function consultativeAdviceView(
  requestId: string,
  shadow: ShadowRunResult,
  modelCalled: boolean,
): EmployeeAdviceView {
  const reasons: EmployeeAdviceReasonView[] = [
    { code: "unbound_consultation", message: UNBOUND_CONSULTATION_MESSAGE },
    ...shadow.reasons.map((reason) => ({
      code: reason.code,
      message: reason.message,
      ...(reason.path ? { path: reason.path } : {}),
    })),
  ];
  const hasProposal = shadow.proposal !== undefined;
  const state = consultativeAdviceState(shadow);
  const rejected = isExplicitAdviceRejection(shadow.outcomeCode, shadow.reasons);
  return buildEmployeeAdviceView({
    requestId,
    outcomeCode: shadow.outcomeCode,
    reasons,
    ...(hasProposal ? { proposal: shadow.proposal } : {}),
    // The unbound hint stays in reasons. It must not replace a reject summary.
    summary: rejected
      ? defaultSummary(state, shadow.reasons[0]?.message ?? "")
      : UNBOUND_CONSULTATION_MESSAGE,
    modelCalled,
    state,
    taskApplicability: "unbound",
    proposalFullyValidated: false,
  });
}

export function resolveTrustedEffectiveContextTokens(input: {
  modelWindow?: number;
  configCap?: number;
}):
  | { ok: true; tokens: number; source: "model" | "agentContextTokens" }
  | { ok: false; reason: string } {
  const modelWindow =
    typeof input.modelWindow === "number" &&
    Number.isFinite(input.modelWindow) &&
    input.modelWindow > 0
      ? Math.floor(input.modelWindow)
      : undefined;
  if (modelWindow === undefined) {
    return {
      ok: false,
      reason: "宿主缺少实际模型窗口，不能把配置帽当作 currentEffectiveValue。",
    };
  }
  const configCap =
    typeof input.configCap === "number" && Number.isFinite(input.configCap) && input.configCap > 0
      ? Math.floor(input.configCap)
      : undefined;
  if (configCap !== undefined && configCap < modelWindow) {
    return { ok: true, tokens: configCap, source: "agentContextTokens" };
  }
  return { ok: true, tokens: modelWindow, source: "model" };
}

function hasTrustedEffectiveValue(facts: TrustedEmployeeAdviceFacts): boolean {
  if (
    typeof facts.currentContextTokens !== "number" ||
    !Number.isFinite(facts.currentContextTokens)
  ) {
    return false;
  }
  if (
    facts.currentContextTokenSource === "model" ||
    facts.currentContextTokenSource === "modelsConfig"
  ) {
    return true;
  }
  if (facts.currentContextTokenSource === "agentContextTokens") {
    return typeof facts.modelContextWindow === "number" && facts.modelContextWindow > 0;
  }
  return false;
}

function approvedScopeId(facts: TrustedEmployeeAdviceFacts): string | undefined {
  return facts.targetAuthorization === "approved"
    ? facts.approvedTarget?.scopeId?.trim()
    : undefined;
}

export function buildTrustedEmployeeHostView(
  identity: TrustedEmployeeAdviceIdentity,
  facts: TrustedEmployeeAdviceFacts,
  _request: SanitizedEmployeeAdviceRequest,
): RuleAdaptationHostView {
  const current = hasTrustedEffectiveValue(facts) ? facts.currentContextTokens : undefined;
  const scopeId = approvedScopeId(facts);
  const hostFacts: Record<string, unknown> = {
    identity: {
      principalType: "personal",
      principalId: identity.principalId,
      ...(scopeId ? { scope: { type: "personal", id: scopeId } } : {}),
    },
    authorizationStatus: identity.authorizationStatus,
  };
  if (typeof current === "number") {
    hostFacts.currentEffectiveValues = { "agents.defaults.contextTokens": current };
  }
  // Only attach compatibility and policy state when the trusted host supplied them.
  // Never invent approved_compatible or active.
  if (facts.compatibilityRecord) {
    hostFacts.compatibilityRecord = facts.compatibilityRecord;
  }
  if (facts.expectedPolicyState) {
    hostFacts.expectedPolicyState = facts.expectedPolicyState;
  }
  return {
    rules: [
      {
        id: "model.context_window.guard",
        category: "operational",
        scope: "personal",
        fieldHints: ["agents.defaults.contextTokens"],
        summary: "Context window hard-min and current-effective ceiling for tightening.",
        version: `inventory:${INVENTORY_PIN}`,
        body: "Tune agents.defaults.contextTokens only within hardMin and current effective value.",
        parameters: [{ name: "agents.defaults.contextTokens" }],
      },
    ],
    effectivePolicy:
      typeof current === "number"
        ? [
            {
              field: "agents.defaults.contextTokens",
              currentEffectiveValue: current,
              source: "host",
            },
          ]
        : [],
    hostFacts,
    ruleViewVersion: `inventory:${INVENTORY_PIN}`,
    ...(identity.tenantId ? { tenantId: identity.tenantId } : {}),
  };
}

export function buildTrustedEmployeeShadowRequest(input: {
  requestId: string;
  request: SanitizedEmployeeAdviceRequest;
  identity: TrustedEmployeeAdviceIdentity;
  facts: TrustedEmployeeAdviceFacts;
  signal?: AbortSignal;
}): ShadowRunRequest {
  const knownFacts: Record<string, unknown> = {
    implementationVersion: INVENTORY_PIN,
  };
  if (hasTrustedEffectiveValue(input.facts)) {
    knownFacts.currentEffectiveValue = input.facts.currentContextTokens;
  }
  const hardMin =
    typeof input.facts.hardMinContextTokens === "number"
      ? input.facts.hardMinContextTokens
      : 16_000; // CONTEXT_WINDOW_HARD_MIN_TOKENS; kept local so callers stay on the command facade.
  knownFacts.hardMin = hardMin;
  if (input.facts.expectedPolicyVersion) {
    knownFacts.expectedPolicyVersion = input.facts.expectedPolicyVersion;
  }
  knownFacts.requiredItemFields = ["ruleId", "field", "action", "proposedValue"];
  knownFacts.forbiddenItemFields = ["value", "currentEffectiveValue"];
  if (input.facts.requiredProposalShape) {
    knownFacts.requiredProposalShape = input.facts.requiredProposalShape;
  }
  const scopeId = approvedScopeId(input.facts);
  return {
    requestId: input.requestId,
    situation: {
      summary: input.request.question,
      symptoms: [input.request.question],
      ...(scopeId ? { scope: { type: "personal" as const, id: scopeId } } : {}),
      knownFacts,
    },
    budget: { ...DEFAULT_SHADOW_BUDGET_LIMITS, maxDurationMs: 45_000 },
    ...(input.signal ? { signal: input.signal } : {}),
  };
}

function shadowToAdviceView(requestId: string, shadow: ShadowRunResult, modelCalled: boolean) {
  return buildEmployeeAdviceView({
    requestId,
    outcomeCode: shadow.outcomeCode,
    reasons: shadow.reasons.map((reason) => ({
      code: reason.code,
      message: reason.message,
      ...(reason.path ? { path: reason.path } : {}),
    })),
    proposal: shadow.proposal,
    modelCalled,
  });
}

export async function runEmployeeRuleAdaptationAdvice(
  clientInput: unknown,
  host: TrustedEmployeeAdviceHost,
): Promise<EmployeeAdviceView> {
  if (PRODUCTION_RUNTIME_RULE_WHITELIST.length !== 0) {
    // Read-only assertion for this entry: never treat a non-empty compiled
    // whitelist as authorization to activate. The advice view stays inactive.
  }
  const sanitized = sanitizeEmployeeAdviceClientInput(clientInput);
  const requestId = sanitized.request.requestId ?? randomUUID();
  if (!sanitized.ok) {
    return buildEmployeeAdviceView({
      requestId,
      outcomeCode: "needs_information",
      reasons: [{ code: "needs_information", message: sanitized.reason }],
      summary: sanitized.reason,
      modelCalled: false,
    });
  }
  if (host.identity.authorizationStatus !== "authorized") {
    const message = host.identity.authorizationReason?.trim() || "当前账号无权请求规则适配建议。";
    return buildEmployeeAdviceView({
      requestId,
      outcomeCode: "insufficient_permission",
      reasons: [{ code: "insufficient_permission", message }],
      summary: message,
      modelCalled: false,
    });
  }
  if (host.facts.targetAuthorization === "denied") {
    const message =
      host.facts.targetAuthorizationReason?.trim() ||
      "拥有员工席位也不等于有权调整目标机器人的规则。";
    return buildEmployeeAdviceView({
      requestId,
      outcomeCode: "insufficient_permission",
      reasons: [{ code: "insufficient_permission", message }],
      summary: message,
      modelCalled: false,
    });
  }
  if (host.facts.targetAuthorization !== "approved" || !approvedScopeId(host.facts)) {
    const message = "服务端尚未核准目标，缺少目标访问权限证明，无法给出规则适配建议。";
    return buildEmployeeAdviceView({
      requestId,
      outcomeCode: "needs_information",
      reasons: [{ code: "needs_information", message }],
      summary: message,
      modelCalled: false,
    });
  }
  if (!hasTrustedEffectiveValue(host.facts)) {
    const message = "宿主缺少计入实际模型窗口的 currentEffectiveValue，不能把配置帽当作有效值。";
    return buildEmployeeAdviceView({
      requestId,
      outcomeCode: "needs_information",
      reasons: [{ code: "insufficient_sources", message }],
      summary: message,
      modelCalled: false,
    });
  }
  // A consultation without a trusted task binding must not create a task or
  // invent expectedPolicyState=active / approved_compatible just to pass P1.
  // Those missing facts stay missing; the shadow still runs, and the result
  // is marked as a rule explanation that does not claim full validation.
  const consultative = !hasTrustedTaskPolicyFacts(host.facts);

  const view = buildTrustedEmployeeHostView(host.identity, host.facts, sanitized.request);
  const binding: OfficialShadowHostBinding = {
    view,
    controlBoard: emptyControlSnapshot(),
    now: host.now ?? Date.now,
    validate: validateRuntimeRuleProposal,
    model: {
      runId: `rule-adaptation-advice:${requestId}`,
      sessionPorts: host.model.sessionPorts,
      createSession: createAuthorizedModelSession,
      config: Object.freeze(host.config ?? {}),
      env: Object.freeze({}),
      provider: host.model.provider,
      model: host.model.model,
      complete: host.model.complete,
    },
  };
  const signal = bindShadowHostAbortSignal(host.signal, undefined);
  if (signal?.aborted) {
    return buildEmployeeAdviceView({
      requestId,
      outcomeCode: "cancelled",
      reasons: [
        {
          code: "cancelled",
          message: "建议请求已取消。已有聊天与原任务未改动。",
        },
      ],
      modelCalled: false,
    });
  }
  const shadowRequest = buildTrustedEmployeeShadowRequest({
    requestId,
    request: sanitized.request,
    identity: host.identity,
    facts: host.facts,
    signal,
  });
  const runShadow = host.runShadow ?? runOfficialShadowRuleAdaptation;

  try {
    const shadow = await runShadow(shadowRequest, binding);
    if (consultative) {
      return consultativeAdviceView(requestId, shadow, true);
    }
    return shadowToAdviceView(requestId, shadow, true);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "advice_request_failed";
    return buildEmployeeAdviceView({
      requestId,
      outcomeCode: "soft_failure",
      reasons: [
        {
          code: "protocol_failure",
          message: `本次建议请求失败：${detail}。已有聊天与原任务未改动。`,
        },
      ],
      modelCalled: false,
    });
  }
}

export const employeeAdviceUntrustedKeys = UNTRUSTED_CLIENT_KEYS;
