import {
  buildEmployeeAdviceView,
  EMPLOYEE_ADVICE_CANCEL_METHOD,
  EMPLOYEE_ADVICE_METHOD,
  runEmployeeRuleAdaptationAdvice,
  sanitizeEmployeeAdviceClientInput,
  type EmployeeAdviceView,
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
import {
  createOfficialEmployeeAdvicePolicyFactSource,
  officialEmployeeAdviceAgentAccessCheck,
  resolveEmployeeAdviceApprovedTarget,
  resolveEmployeeAdviceProductionFacts,
  type EmployeeAdviceAgentAccessCheck,
  type EmployeeAdviceApprovedTarget,
  type EmployeeAdvicePolicyFactSource,
} from "./runtime-rule-adaptation-advice-facts.js";
import type { GatewayClient, GatewayRequestHandlers } from "./types.js";

export type { EmployeeAdviceApprovedTarget } from "./runtime-rule-adaptation-advice-facts.js";

export type EmployeeAdviceHandlerDeps = {
  loadConfig?: () => OpenBotConfig;
  resolveTrustedContext?: typeof resolveTrustedEnterpriseDataExecutionContext;
  resolveOfficialModel?: typeof resolveOfficialDeepSeekCredential;
  resolveApprovedTarget?: (input: {
    identity: TrustedEmployeeAdviceHost["identity"];
    targetRef: { sessionKey?: string; agentId?: string };
    config: OpenBotConfig;
    client?: GatewayClient | null;
    checkAgentAccess?: EmployeeAdviceAgentAccessCheck;
  }) => Promise<EmployeeAdviceApprovedTarget> | EmployeeAdviceApprovedTarget;
  resolveProductionFacts?: typeof resolveEmployeeAdviceProductionFacts;
  policyFactSource?: EmployeeAdvicePolicyFactSource;
  checkAgentAccess?: EmployeeAdviceAgentAccessCheck;
  runAdvice?: typeof runEmployeeRuleAdaptationAdvice;
  runShadow?: TrustedEmployeeAdviceHost["runShadow"];
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  abortRegistry?: EmployeeAdviceAbortRegistry;
};

export type EmployeeAdviceAbortKey = {
  tenantId: string;
  employeeId: string;
  requestId: string;
};

export type EmployeeAdviceAbortRegisterResult =
  | { accepted: true; alreadyCancelled?: boolean }
  | { accepted: false; reason: "duplicate_in_flight" | "missing_identity" };

export type EmployeeAdviceAbortRegistry = {
  register: (
    key: EmployeeAdviceAbortKey,
    controller: AbortController,
  ) => EmployeeAdviceAbortRegisterResult;
  cancel: (key: EmployeeAdviceAbortKey) => boolean;
  release: (key: EmployeeAdviceAbortKey) => void;
};

/** Upper bound on unmatched early-cancel reservations. No scheduler is added. */
export const EMPLOYEE_ADVICE_ABORT_RESERVED_LIMIT = 128;
/** Reservations older than this are dropped on the next register/cancel/release. */
export const EMPLOYEE_ADVICE_ABORT_RESERVED_TTL_MS = 60_000;

export type EmployeeAdviceAbortRegistryOptions = {
  now?: () => number;
  reservedLimit?: number;
  reservedTtlMs?: number;
};

const ABORT_KEY_UNIT = "\u001f";

export function adviceAbortKey(key: EmployeeAdviceAbortKey): string | undefined {
  const tenantId = key.tenantId.trim();
  const employeeId = key.employeeId.trim();
  const requestId = key.requestId.trim();
  if (!tenantId || !employeeId || !requestId) {
    return undefined;
  }
  return `${tenantId}${ABORT_KEY_UNIT}${employeeId}${ABORT_KEY_UNIT}${requestId}`;
}

export function createEmployeeAdviceAbortRegistry(
  options: EmployeeAdviceAbortRegistryOptions = {},
): EmployeeAdviceAbortRegistry {
  const controllers = new Map<string, AbortController>();
  const reserved = new Map<string, number>();
  const now = options.now ?? Date.now;
  const reservedLimit = Math.max(1, options.reservedLimit ?? EMPLOYEE_ADVICE_ABORT_RESERVED_LIMIT);
  const reservedTtlMs = Math.max(1, options.reservedTtlMs ?? EMPLOYEE_ADVICE_ABORT_RESERVED_TTL_MS);

  function pruneReserved(at: number): void {
    for (const [key, reservedAt] of reserved) {
      if (at - reservedAt > reservedTtlMs) {
        reserved.delete(key);
      }
    }
    while (reserved.size > reservedLimit) {
      const oldest = reserved.keys().next().value;
      if (typeof oldest !== "string") {
        break;
      }
      reserved.delete(oldest);
    }
  }

  return {
    register(parts, controller) {
      const key = adviceAbortKey(parts);
      if (!key) {
        return { accepted: false, reason: "missing_identity" };
      }
      const at = now();
      pruneReserved(at);
      if (controllers.has(key)) {
        // Do not silently replace an in-flight controller.
        return { accepted: false, reason: "duplicate_in_flight" };
      }
      const reservedAt = reserved.get(key);
      if (typeof reservedAt === "number") {
        reserved.delete(key);
        if (at - reservedAt <= reservedTtlMs) {
          controller.abort();
          controllers.set(key, controller);
          return { accepted: true, alreadyCancelled: true };
        }
      }
      controllers.set(key, controller);
      return { accepted: true };
    },
    cancel(parts) {
      const key = adviceAbortKey(parts);
      if (!key) {
        return false;
      }
      const at = now();
      pruneReserved(at);
      const controller = controllers.get(key);
      if (controller) {
        controller.abort();
        controllers.delete(key);
        return true;
      }
      if (!reserved.has(key)) {
        reserved.set(key, at);
        pruneReserved(at);
      }
      return true;
    },
    release(parts) {
      const key = adviceAbortKey(parts);
      if (!key) {
        return;
      }
      controllers.delete(key);
      pruneReserved(now());
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

/**
 * Production default: resolve the target through the existing view-access
 * check. Does not invent an approved scope from a seat or a client agentId.
 * When called with no input, the result stays unknown because there is
 * nothing to resolve.
 */
export async function defaultResolveApprovedTarget(
  input?: Parameters<typeof resolveEmployeeAdviceApprovedTarget>[0],
): Promise<EmployeeAdviceApprovedTarget> {
  if (!input) {
    return {
      targetAuthorization: "unknown",
      reason: "服务端尚未核准目标，拥有员工席位也不等于有权查看目标并请求规则适配建议。",
    };
  }
  return resolveEmployeeAdviceApprovedTarget(input);
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
  const resolveFacts = deps.resolveProductionFacts ?? resolveEmployeeAdviceProductionFacts;
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

  const sanitized = sanitizeEmployeeAdviceClientInput(params);
  const facts =
    identity.authorizationStatus === "authorized"
      ? await resolveFacts({
          identity,
          targetRef: sanitized.request.targetRef,
          config: cfg,
          client,
          officialModel: official,
          policyFactSource: deps.policyFactSource ?? createOfficialEmployeeAdvicePolicyFactSource(),
          checkAgentAccess: deps.checkAgentAccess ?? officialEmployeeAdviceAgentAccessCheck,
        })
      : {};
  if (identity.authorizationStatus === "authorized" && deps.resolveApprovedTarget) {
    const target = await deps.resolveApprovedTarget({
      identity,
      targetRef: sanitized.request.targetRef,
      config: cfg,
      client,
      checkAgentAccess: deps.checkAgentAccess,
    });
    facts.targetAuthorization = target.targetAuthorization;
    if (target.reason) {
      facts.targetAuthorizationReason = target.reason;
    } else {
      delete facts.targetAuthorizationReason;
    }
    if (target.approvedTarget) {
      facts.approvedTarget = target.approvedTarget;
    } else {
      delete facts.approvedTarget;
    }
  }

  const requestId = readClientRequestId(params);
  const abort = new AbortController();
  const abortKey =
    requestId && identity.tenantId
      ? {
          tenantId: identity.tenantId,
          employeeId: identity.employeeId,
          requestId,
        }
      : undefined;
  if (abortKey) {
    const registered = abortRegistry.register(abortKey, abort);
    if (!registered.accepted && registered.reason === "duplicate_in_flight") {
      return buildEmployeeAdviceView({
        requestId: abortKey.requestId,
        outcomeCode: "soft_failure",
        reasons: [
          {
            code: "duplicate_request",
            message: "相同建议请求仍在处理中，未覆盖已有请求。已有聊天与原任务未改动。",
          },
        ],
        modelCalled: false,
      });
    }
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
    if (abortKey) {
      abortRegistry.release(abortKey);
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
    if (!ctx.tenantId || !ctx.employeeId) {
      return { cancelled: false, requestId };
    }
    const cancelled = abortRegistry.cancel({
      tenantId: ctx.tenantId,
      employeeId: ctx.employeeId,
      requestId,
    });
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
