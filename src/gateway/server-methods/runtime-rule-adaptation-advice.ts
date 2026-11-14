import {
  buildEmployeeAdviceView,
  EMPLOYEE_ADVICE_CANCEL_METHOD,
  EMPLOYEE_ADVICE_METHOD,
  resolveTrustedEffectiveContextTokens,
  runEmployeeRuleAdaptationAdvice,
  sanitizeEmployeeAdviceClientInput,
  type EmployeeAdviceView,
  type TrustedEmployeeAdviceFacts,
  type TrustedEmployeeAdviceHost,
} from "../../agent-runtime/command/index.js";
import type { ModelSessionPorts } from "../../agent-runtime/model/index.js";
import {
  createOfficialDeepSeekShadowCompletion,
  resolveOfficialDeepSeekCredential,
} from "../../agent-runtime/model/rule-adaptation/index.js";
import { bindAdmittedTurnHost } from "../../agent-runtime/wiring/admitted-turn-host.js";
/**
 * Employee "规则适配建议" gateway method.
 *
 * The client may submit only a question, a target reference, and a
 * correlation requestId used to cancel. Identity, authorization, model
 * credentials, approved target, real effective values, and the official
 * shadow binding are resolved on the already-authenticated server host.
 * The handler calls the official shadow entry directly; it does not
 * construct a placeholder contrast chat turn.
 */
import { loadConfig, type OpenBotConfig } from "../../config/config.js";
import { resolveTrustedEnterpriseDataExecutionContext } from "../enterprise-data/enterprise-data-seat-context.js";
import { respondUnavailable } from "./billing-helpers.js";
import type { GatewayRequestHandlers } from "./types.js";

export type EmployeeAdviceApprovedTarget = {
  targetAuthorization: "approved" | "denied" | "unknown";
  reason?: string;
  approvedTarget?: TrustedEmployeeAdviceFacts["approvedTarget"];
};

export type EmployeeAdviceHandlerDeps = {
  loadConfig?: () => OpenBotConfig;
  resolveTrustedContext?: typeof resolveTrustedEnterpriseDataExecutionContext;
  resolveOfficialModel?: typeof resolveOfficialDeepSeekCredential;
  resolveApprovedTarget?: (input: {
    identity: TrustedEmployeeAdviceHost["identity"];
    targetRef: { sessionKey?: string; agentId?: string };
    config: OpenBotConfig;
  }) => Promise<EmployeeAdviceApprovedTarget> | EmployeeAdviceApprovedTarget;
  runAdvice?: typeof runEmployeeRuleAdaptationAdvice;
  runShadow?: TrustedEmployeeAdviceHost["runShadow"];
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  abortRegistry?: EmployeeAdviceAbortRegistry;
};

export type EmployeeAdviceAbortRegistry = {
  register: (employeeId: string, requestId: string, controller: AbortController) => void;
  cancel: (employeeId: string, requestId: string) => boolean;
  release: (employeeId: string, requestId: string) => void;
};

function adviceAbortKey(employeeId: string, requestId: string): string {
  return `${employeeId}:${requestId}`;
}

export function createEmployeeAdviceAbortRegistry(): EmployeeAdviceAbortRegistry {
  const controllers = new Map<string, AbortController>();
  const reserved = new Set<string>();
  return {
    register(employeeId, requestId, controller) {
      const key = adviceAbortKey(employeeId, requestId);
      if (reserved.has(key)) {
        controller.abort();
        reserved.delete(key);
      }
      controllers.set(key, controller);
    },
    cancel(employeeId, requestId) {
      const key = adviceAbortKey(employeeId, requestId);
      const controller = controllers.get(key);
      if (controller) {
        controller.abort();
        controllers.delete(key);
        return true;
      }
      reserved.add(key);
      return true;
    },
    release(employeeId, requestId) {
      controllers.delete(adviceAbortKey(employeeId, requestId));
    },
  };
}

const defaultAbortRegistry = createEmployeeAdviceAbortRegistry();

function createEmployeeAdviceSessionPorts(): ModelSessionPorts {
  const admitted = bindAdmittedTurnHost();
  return {
    accounting: { recordCreditUsage: admitted.accounting.recordCreditUsage },
    admission: admitted.admission,
    model: {
      resolveEmbeddedModelGovernance: admitted.model.resolveEmbeddedModelGovernance,
      buildRunModelSetSnapshot: admitted.model.buildRunModelSetSnapshot,
      forgetRunModelSet: admitted.model.forgetRunModelSet,
      rememberRunModelSet: admitted.model.rememberRunModelSet,
      snapshotCreditReportingFromGate: admitted.model.snapshotCreditReportingFromGate,
      resolvePlatformModelsMode: admitted.model.resolvePlatformModelsMode,
      runWithModelFallback: admitted.model.runWithModelFallback,
    },
  };
}

function readCatalogModelContextWindow(
  cfg: OpenBotConfig,
  provider: string,
  modelId: string,
): number | undefined {
  const providers = cfg.models?.providers as
    | Record<string, { models?: Array<{ id?: string; contextWindow?: number }> }>
    | undefined;
  const models = Array.isArray(providers?.[provider]?.models) ? providers[provider].models : [];
  const match = models.find((entry) => entry?.id === modelId);
  const value = match?.contextWindow;
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined;
}

function readConfigContextTokenCap(cfg: OpenBotConfig): number | undefined {
  const value = cfg.agents?.defaults?.contextTokens;
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined;
}

/**
 * Seat membership is not target-rule authorization. Unless a caller injects a
 * real approval, the default resolver returns unknown so the use case can
 * ask for more information instead of inventing a scope from the client
 * agentId.
 */
export function defaultResolveApprovedTarget(): EmployeeAdviceApprovedTarget {
  return {
    targetAuthorization: "unknown",
    reason: "服务端尚未核准目标，拥有员工席位也不等于有权调整目标机器人的规则。",
  };
}

function errorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

function mapIdentityError(error: unknown): TrustedEmployeeAdviceHost["identity"] {
  const code = errorCode(error);
  if (code === "IDENTITY_CONTEXT_MISSING") {
    return {
      authorizationStatus: "unauthorized",
      authorizationReason: "请先使用员工账号登录后再请求规则适配建议。",
      employeeId: "anonymous",
      principalId: "user:anonymous",
    };
  }
  if (code === "NO_CURRENT_SEAT") {
    return {
      authorizationStatus: "unauthorized",
      authorizationReason: "当前账号未绑定企业席位，无权请求规则适配建议。",
      employeeId: "unseated",
      principalId: "user:unseated",
    };
  }
  return {
    authorizationStatus: "unauthorized",
    authorizationReason: "当前账号无权请求规则适配建议。",
    employeeId: "unauthorized",
    principalId: "user:unauthorized",
  };
}

function readClientRequestId(params: unknown): string | undefined {
  const sanitized = sanitizeEmployeeAdviceClientInput(params);
  return sanitized.request.requestId;
}

export async function handleRuntimeRuleAdaptationAdvice(
  params: unknown,
  client: Parameters<GatewayRequestHandlers[string]>[0]["client"],
  deps: EmployeeAdviceHandlerDeps = {},
): Promise<EmployeeAdviceView> {
  const loadCfg = deps.loadConfig ?? loadConfig;
  const resolveCtx = deps.resolveTrustedContext ?? resolveTrustedEnterpriseDataExecutionContext;
  const resolveModel = deps.resolveOfficialModel ?? resolveOfficialDeepSeekCredential;
  const resolveTarget = deps.resolveApprovedTarget ?? defaultResolveApprovedTarget;
  const runAdvice = deps.runAdvice ?? runEmployeeRuleAdaptationAdvice;
  const env = deps.env ?? process.env;
  const abortRegistry = deps.abortRegistry ?? defaultAbortRegistry;

  let identity: TrustedEmployeeAdviceHost["identity"];
  try {
    const ctx = await resolveCtx(client);
    identity = {
      employeeId: ctx.employeeId,
      principalId: `user:${ctx.employeeId}`,
      tenantId: ctx.tenantId,
      seatId: ctx.seatId,
      authorizationStatus: "authorized",
    };
  } catch (error) {
    identity = mapIdentityError(error);
  }

  const cfg = loadCfg();
  const official = identity.authorizationStatus === "authorized" ? resolveModel(env) : null;
  if (identity.authorizationStatus === "authorized" && !official) {
    identity = {
      ...identity,
      authorizationStatus: "unauthorized",
      authorizationReason: "当前宿主没有已授权的官方模型可用，无法生成规则适配建议。",
    };
  }

  const facts: TrustedEmployeeAdviceFacts = {};
  const cap = readConfigContextTokenCap(cfg);
  if (typeof cap === "number") {
    facts.configContextTokenCap = cap;
  }
  if (official) {
    const modelWindow = readCatalogModelContextWindow(cfg, official.provider, official.model);
    if (typeof modelWindow === "number") {
      facts.modelContextWindow = modelWindow;
      const effective = resolveTrustedEffectiveContextTokens({
        modelWindow,
        configCap: cap,
      });
      if (effective.ok) {
        facts.currentContextTokens = effective.tokens;
        facts.currentContextTokenSource = effective.source;
      }
    }
  }
  // Compatibility records and expected policy state are not invented here.
  if (identity.authorizationStatus === "authorized") {
    const sanitized = sanitizeEmployeeAdviceClientInput(params);
    const target = await resolveTarget({
      identity,
      targetRef: sanitized.request.targetRef,
      config: cfg,
    });
    facts.targetAuthorization = target.targetAuthorization;
    if (target.reason) {
      facts.targetAuthorizationReason = target.reason;
    }
    if (target.approvedTarget) {
      facts.approvedTarget = target.approvedTarget;
    }
  }

  const requestId = readClientRequestId(params);
  const abort = new AbortController();
  if (requestId) {
    abortRegistry.register(identity.employeeId, requestId, abort);
  }

  const host: TrustedEmployeeAdviceHost = {
    identity,
    facts,
    model: official
      ? {
          provider: official.provider,
          model: official.model,
          complete: createOfficialDeepSeekShadowCompletion(official),
          sessionPorts: createEmployeeAdviceSessionPorts(),
        }
      : {
          provider: "unavailable",
          model: "unavailable",
          complete: async () => ({
            kind: "protocol_failure",
            usage: { inputTokens: 0, outputTokens: 0, cost: 0 },
            detail: "official_model_unavailable",
          }),
          sessionPorts: createEmployeeAdviceSessionPorts(),
        },
    ...(deps.runShadow ? { runShadow: deps.runShadow } : {}),
    config: cfg,
    signal: abort.signal,
    now: deps.now,
  };

  try {
    return await runAdvice(params, host);
  } finally {
    if (requestId) {
      abortRegistry.release(identity.employeeId, requestId);
    }
  }
}

export async function handleRuntimeRuleAdaptationAdviceCancel(
  params: unknown,
  client: Parameters<GatewayRequestHandlers[string]>[0]["client"],
  deps: EmployeeAdviceHandlerDeps = {},
): Promise<{ cancelled: boolean; requestId?: string }> {
  const resolveCtx = deps.resolveTrustedContext ?? resolveTrustedEnterpriseDataExecutionContext;
  const abortRegistry = deps.abortRegistry ?? defaultAbortRegistry;
  const requestId =
    readClientRequestId(params) ??
    ((): string | undefined => {
      if (typeof params === "object" && params !== null && "requestId" in params) {
        const value = (params as { requestId?: unknown }).requestId;
        return typeof value === "string" && value.trim() ? value.trim() : undefined;
      }
      return undefined;
    })();
  if (!requestId) {
    return { cancelled: false };
  }
  try {
    const ctx = await resolveCtx(client);
    const cancelled = abortRegistry.cancel(ctx.employeeId, requestId);
    return { cancelled, requestId };
  } catch {
    return { cancelled: false, requestId };
  }
}

export const runtimeRuleAdaptationAdviceHandlers: GatewayRequestHandlers = {
  [EMPLOYEE_ADVICE_METHOD]: async ({ params, client, respond }) => {
    try {
      const advice = await handleRuntimeRuleAdaptationAdvice(params, client);
      respond(true, { advice });
    } catch (err) {
      try {
        respond(true, {
          advice: buildEmployeeAdviceView({
            requestId: "advice-handler-soft-failure",
            outcomeCode: "soft_failure",
            reasons: [
              {
                code: "protocol_failure",
                message: "本次建议请求失败，已有聊天与原任务未改动。",
              },
            ],
          }),
        });
      } catch {
        respondUnavailable(respond, err);
      }
    }
  },
  [EMPLOYEE_ADVICE_CANCEL_METHOD]: async ({ params, client, respond }) => {
    try {
      const result = await handleRuntimeRuleAdaptationAdviceCancel(params, client);
      respond(true, result);
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },
};
