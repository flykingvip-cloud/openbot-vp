import {
  buildEmployeeAdviceView,
  createOfficialDeepSeekShadowCompletion,
  EMPLOYEE_ADVICE_METHOD,
  resolveOfficialDeepSeekCredential,
  runEmployeeRuleAdaptationAdvice,
  type EmployeeAdviceView,
  type TrustedEmployeeAdviceHost,
} from "../../agent-runtime/command/index.js";
import type { ModelSessionPorts } from "../../agent-runtime/model/index.js";
import { bindAdmittedTurnHost } from "../../agent-runtime/wiring/admitted-turn-host.js";
import { replyTurnRuntime } from "../../agent-runtime/wiring/reply-turn.js";
/**
 * Employee "规则适配建议" gateway method.
 *
 * The client may submit only a question and a target reference. Identity,
 * authorization, model credentials, and the official shadow binding are
 * resolved on the already-authenticated server host. The handler reuses the
 * #288 replyTurnRuntime.interaction passthrough with trigger===true and
 * returns suggestion-only results that are never marked effective.
 */
import { loadConfig, type OpenBotConfig } from "../../config/config.js";
import { resolveTrustedEnterpriseDataExecutionContext } from "../enterprise-data/enterprise-data-seat-context.js";
import { respondUnavailable } from "./billing-helpers.js";
import type { GatewayRequestHandlers } from "./types.js";

export type EmployeeAdviceHandlerDeps = {
  loadConfig?: () => OpenBotConfig;
  resolveTrustedContext?: typeof resolveTrustedEnterpriseDataExecutionContext;
  resolveOfficialModel?: typeof resolveOfficialDeepSeekCredential;
  runAdvice?: typeof runEmployeeRuleAdaptationAdvice;
  interact?: TrustedEmployeeAdviceHost["interact"];
  env?: NodeJS.ProcessEnv;
};

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

function readCurrentContextTokens(cfg: OpenBotConfig): number | undefined {
  const value = cfg.agents?.defaults?.contextTokens;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
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

export async function handleRuntimeRuleAdaptationAdvice(
  params: unknown,
  client: Parameters<GatewayRequestHandlers[string]>[0]["client"],
  deps: EmployeeAdviceHandlerDeps = {},
): Promise<EmployeeAdviceView> {
  const loadCfg = deps.loadConfig ?? loadConfig;
  const resolveCtx = deps.resolveTrustedContext ?? resolveTrustedEnterpriseDataExecutionContext;
  const resolveModel = deps.resolveOfficialModel ?? resolveOfficialDeepSeekCredential;
  const runAdvice = deps.runAdvice ?? runEmployeeRuleAdaptationAdvice;
  const env = deps.env ?? process.env;

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

  const host: TrustedEmployeeAdviceHost = {
    identity,
    facts: {
      currentContextTokens: readCurrentContextTokens(cfg),
    },
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
    interact:
      deps.interact ??
      ((interactParams, shadowHost) => replyTurnRuntime.interaction(interactParams, shadowHost)),
    config: cfg,
  };

  return runAdvice(params, host);
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
};
