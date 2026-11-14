/**
 * Employee-facing rule-adaptation advice: sanitize untrusted client input,
 * let a trusted server host build the official shadow binding, and map the
 * isolated shadow result into a four-state suggestion that is never marked
 * effective. Does not activate policy, write configuration, or publish rules.
 */
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import { createAuthorizedModelSession, type ModelSessionPorts } from "../../model/index.js";
import type { GovernedShadowModelPortDeps } from "../../model/rule-adaptation/index.js";
import { validateRuntimeRuleProposal } from "../../policy/rule-adaptation/index.js";
import type { GovernedInteractionWithShadow, GovernedShadowHostInjection } from "../index.js";
import { emptyControlSnapshot } from "./control-snapshot.js";
import type { OfficialShadowHostBinding } from "./official-shadow.js";

export const EMPLOYEE_ADVICE_METHOD = "runtime-rule-adaptation.advice" as const;
export const EMPLOYEE_ADVICE_NOT_EFFECTIVE_LABEL = "尚未生效" as const;

export const EMPLOYEE_ADVICE_STATES = [
  "no_change",
  "needs_information",
  "blocked",
  "adjustment_suggested",
  "failed",
] as const;

export type EmployeeAdviceState = (typeof EMPLOYEE_ADVICE_STATES)[number];

export const EMPLOYEE_ADVICE_STATE_LABELS: Record<EmployeeAdviceState, string> = {
  no_change: "无需调整",
  needs_information: "需补信息",
  blocked: "被阻止",
  adjustment_suggested: "建议调整",
  failed: "建议失败",
};

/** Fields a client may legally submit. Everything else is ignored. */
export type EmployeeAdviceClientFields = {
  question?: unknown;
  targetRef?: unknown;
};

export type SanitizedEmployeeAdviceTargetRef = {
  sessionKey?: string;
  agentId?: string;
};

export type SanitizedEmployeeAdviceRequest = {
  question: string;
  targetRef: SanitizedEmployeeAdviceTargetRef;
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
  currentContextTokens?: number;
  expectedPolicyVersion?: {
    policyHash: string;
    protocolVersion: string;
    compilerRevision: string;
  };
  hardMinContextTokens?: number;
  /** Optional host-owned schema hints. Never accepted from the client. */
  requiredProposalShape?: unknown;
};

export type IsolatedAdviceInteractionParams = {
  config: OpenBotConfig;
  runId: string;
  agentId: string;
  agentDir: string;
  sessionKey: string;
  sessionFile: string;
  requestId: string;
  input: {
    message: string;
    context: readonly { role: "system" | "user" | "assistant"; content: string }[];
    abortSignal?: AbortSignal;
  };
  captured: { expectedFocusRevision: number; expectedWriteEpoch: number };
  identity: { gatewayClientPlatformUserId: string };
  authorized: boolean;
  provider: string;
  model: string;
  timeoutMs: number;
};

export type EmployeeAdviceInteract = (
  params: IsolatedAdviceInteractionParams,
  shadowHost: GovernedShadowHostInjection,
) => Promise<GovernedInteractionWithShadow>;

export type TrustedEmployeeAdviceHost = {
  identity: TrustedEmployeeAdviceIdentity;
  facts: TrustedEmployeeAdviceFacts;
  model: {
    provider: string;
    model: string;
    complete: GovernedShadowModelPortDeps["complete"];
    sessionPorts: ModelSessionPorts;
  };
  interact: EmployeeAdviceInteract;
  now?: () => number;
  config?: OpenBotConfig | Record<string, never>;
  agentDir?: string;
  isolatedSessionFile?: string;
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
  const request = { question, targetRef };
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
}): EmployeeAdviceView {
  const state = mapShadowOutcomeToEmployeeAdviceState(input.outcomeCode);
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
  };
}

function personalScopeId(
  request: SanitizedEmployeeAdviceRequest,
  identity: TrustedEmployeeAdviceIdentity,
) {
  return request.targetRef.agentId?.trim() || `agent:${identity.employeeId}`;
}

export function buildTrustedEmployeeHostView(
  identity: TrustedEmployeeAdviceIdentity,
  facts: TrustedEmployeeAdviceFacts,
  request: SanitizedEmployeeAdviceRequest,
): RuleAdaptationHostView {
  const current = facts.currentContextTokens;
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
    hostFacts: {
      identity: {
        principalType: "personal",
        principalId: identity.principalId,
        scope: { type: "personal", id: personalScopeId(request, identity) },
      },
      ...(typeof current === "number"
        ? { currentEffectiveValues: { "agents.defaults.contextTokens": current } }
        : {}),
      authorizationStatus: identity.authorizationStatus,
      compatibilityRecord: {
        status: "approved_compatible",
        boundImplementationVersion: INVENTORY_PIN,
        ...(facts.expectedPolicyVersion
          ? { boundExpectedPolicyVersion: facts.expectedPolicyVersion }
          : {}),
      },
      expectedPolicyState: "active",
    },
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
  if (typeof input.facts.currentContextTokens === "number") {
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
  return {
    requestId: input.requestId,
    situation: {
      summary: input.request.question,
      symptoms: [input.request.question],
      scope: { type: "personal", id: personalScopeId(input.request, input.identity) },
      knownFacts,
    },
    budget: { ...DEFAULT_SHADOW_BUDGET_LIMITS, maxDurationMs: 45_000 },
    ...(input.signal ? { signal: input.signal } : {}),
  };
}

export function buildIsolatedAdviceInteractionParams(input: {
  requestId: string;
  identity: TrustedEmployeeAdviceIdentity;
  request: SanitizedEmployeeAdviceRequest;
  provider: string;
  model: string;
  config?: OpenBotConfig | Record<string, never>;
  agentDir?: string;
  isolatedSessionFile?: string;
  signal?: AbortSignal;
}): IsolatedAdviceInteractionParams {
  const sessionFile =
    input.isolatedSessionFile ??
    join(tmpdir(), `openbot-rule-adaptation-advice-${input.requestId}.jsonl`);
  return {
    config: (input.config ?? {}) as IsolatedAdviceInteractionParams["config"],
    runId: `rule-adaptation-advice:${input.requestId}`,
    agentId: input.request.targetRef.agentId?.trim() || "bot",
    agentDir: input.agentDir ?? join(tmpdir(), `openbot-rule-adaptation-advice-${input.requestId}`),
    sessionKey: `runtime-rule-adaptation-advice:${input.requestId}`,
    sessionFile,
    requestId: `message-rule-adaptation-advice:${input.requestId}`,
    captured: { expectedFocusRevision: 0, expectedWriteEpoch: 0 },
    authorized: input.identity.authorizationStatus === "authorized",
    identity: {
      gatewayClientPlatformUserId: input.identity.employeeId,
    },
    provider: input.provider,
    model: input.model,
    timeoutMs: 20_000,
    input: {
      message: "规则适配建议对照回合，不写入原对话。",
      context: [],
      ...(input.signal ? { abortSignal: input.signal } : {}),
    },
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
  const requestId = randomUUID();
  const sanitized = sanitizeEmployeeAdviceClientInput(clientInput);
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
  if (typeof host.facts.currentContextTokens !== "number") {
    const message = "宿主缺少当前生效的 contextTokens 事实，无法给出完整建议。";
    return buildEmployeeAdviceView({
      requestId,
      outcomeCode: "needs_information",
      reasons: [{ code: "insufficient_sources", message }],
      summary: message,
      modelCalled: false,
    });
  }

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
  const shadowRequest = buildTrustedEmployeeShadowRequest({
    requestId,
    request: sanitized.request,
    identity: host.identity,
    facts: host.facts,
    signal: host.signal,
  });
  const params = buildIsolatedAdviceInteractionParams({
    requestId,
    identity: host.identity,
    request: sanitized.request,
    provider: host.model.provider,
    model: host.model.model,
    config: host.config,
    agentDir: host.agentDir,
    isolatedSessionFile: host.isolatedSessionFile,
    signal: host.signal,
  });

  try {
    const wrapped = await host.interact(params, {
      trigger: true,
      request: shadowRequest,
      binding,
    });
    return shadowToAdviceView(requestId, wrapped.shadow, true);
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
