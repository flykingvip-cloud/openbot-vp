import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import {
  executionOperationKey,
  type OperationIdentity,
} from "../agent-runtime/contracts/operation.js";
import { ToolOperationOutcomeUnknownError } from "../agent-runtime/state/repository/tool-operation.js";
import {
  resolveGrantedHttpIdentity,
  executeHttpGrantedOperation,
  verifyHttpExecutionGrant,
} from "../agent-runtime/wiring/http-execution-grant.js";
import { buildExecutionPreflight } from "../agents/execution-preflight/resolve.js";
import { createOpenClawTools } from "../agents/openclaw-tools.js";
import {
  resolveEffectiveToolPolicy,
  resolveGroupToolPolicy,
  resolveSubagentToolPolicy,
} from "../agents/pi-tools.policy.js";
import { dispatchChildOnce } from "../agents/subagent-dispatch-journal.js";
import {
  applyToolPolicyPipeline,
  buildDefaultToolPolicyPipelineSteps,
} from "../agents/tool-policy-pipeline.js";
import {
  collectExplicitAllowlist,
  mergeAlsoAllowPolicy,
  resolveToolProfilePolicy,
} from "../agents/tool-policy.js";
import { ToolInputError } from "../agents/tools/common.js";
import { loadConfig } from "../config/config.js";
import { resolveStateDir } from "../config/paths.js";
import { resolveMainSessionKey } from "../config/sessions.js";
import { isTruthyEnvValue } from "../infra/env.js";
import { logWarn } from "../logger.js";
import { isTestDefaultMemorySlotDisabled } from "../plugins/config-state.js";
import { getPluginToolMeta } from "../plugins/tools.js";
import { isSubagentSessionKey } from "../routing/session-key.js";
import { DEFAULT_GATEWAY_HTTP_TOOL_DENY } from "../security/dangerous-tools.js";
import { normalizeMessageChannel } from "../utils/message-channel.js";
import type { AuthRateLimiter } from "./auth-rate-limit.js";
import {
  authorizeHttpGatewayConnect,
  isLocalDirectRequest,
  type ResolvedGatewayAuth,
} from "./auth.js";
import {
  createExecutionIdentityFromGatewayAuth,
  hasAuthenticatedIdentity,
  inheritExecutionIdentityRunFields,
} from "./execution-identity-context.js";
import { applyToolsInvokeGovernance } from "./governance/tools-invoke-shadow.js";
import {
  readJsonBodyOrError,
  sendGatewayAuthFailure,
  sendInvalidRequest,
  sendJson,
  sendMethodNotAllowed,
} from "./http-common.js";
import { getBearerToken, getHeader } from "./http-utils.js";
import { runGatewayToolkitPhase2Gate } from "./toolkit-phase2-gate.js";

const DEFAULT_BODY_BYTES = 2 * 1024 * 1024;
const MEMORY_TOOL_NAMES = new Set(["memory_search", "memory_get"]);

/**
 * Observe-only. Unset/off keeps POST /tools/invoke on today's policy/deny path.
 * Truthy values match isTruthyEnvValue (1, true, yes, on).
 */
export const HTTP_TOOLS_INVOKE_PREFLIGHT_OBSERVE_ENV =
  "OPENBOT_HTTP_TOOLS_INVOKE_PREFLIGHT_OBSERVE";

export function isHttpToolsInvokePreflightObserveEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isTruthyEnvValue(env[HTTP_TOOLS_INVOKE_PREFLIGHT_OBSERVE_ENV]);
}

/** Process-local trace key. Not a completion, ledger, or authorization id. */
export function httpToolsInvokeObserveTaskId(sessionKey: string, toolName: string): string {
  return `http-tools-invoke:${sessionKey}:${toolName}`;
}

function observeHttpToolsInvokePreflight(params: {
  sessionKey: string;
  toolName: string;
  policyToolNames: string[];
  catalogToolNames: string[];
}): void {
  if (!isHttpToolsInvokePreflightObserveEnabled()) {
    return;
  }
  try {
    // Record the existing preflight trace only. The returned tool set is unused.
    buildExecutionPreflight({
      taskId: httpToolsInvokeObserveTaskId(params.sessionKey, params.toolName),
      sessionId: params.sessionKey,
      message: params.toolName,
      skills: [],
      policyToolNames: params.policyToolNames,
      catalogToolNames: params.catalogToolNames,
    });
  } catch (err) {
    logWarn(`tools-invoke: observe preflight failed: ${String(err)}`);
  }
}

type ToolsInvokeBody = {
  operationIdentity?: unknown;
  tool?: unknown;
  action?: unknown;
  args?: unknown;
  sessionKey?: unknown;
  dryRun?: unknown;
};

function resolveSessionKeyFromBody(body: ToolsInvokeBody): string | undefined {
  if (typeof body.sessionKey === "string" && body.sessionKey.trim()) {
    return body.sessionKey.trim();
  }
  return undefined;
}

function resolveMemoryToolDisableReasons(cfg: ReturnType<typeof loadConfig>): string[] {
  if (!process.env.VITEST) {
    return [];
  }
  const reasons: string[] = [];
  const plugins = cfg.plugins;
  const slotRaw = plugins?.slots?.memory;
  const slotDisabled =
    slotRaw === null || (typeof slotRaw === "string" && slotRaw.trim().toLowerCase() === "none");
  const pluginsDisabled = plugins?.enabled === false;
  const defaultDisabled = isTestDefaultMemorySlotDisabled(cfg);

  if (pluginsDisabled) {
    reasons.push("plugins.enabled=false");
  }
  if (slotDisabled) {
    reasons.push(slotRaw === null ? "plugins.slots.memory=null" : 'plugins.slots.memory="none"');
  }
  if (!pluginsDisabled && !slotDisabled && defaultDisabled) {
    reasons.push("memory plugin disabled by test default");
  }
  return reasons;
}

function mergeActionIntoArgsIfSupported(params: {
  toolSchema: unknown;
  action: string | undefined;
  args: Record<string, unknown>;
}): Record<string, unknown> {
  const { toolSchema, action, args } = params;
  if (!action) {
    return args;
  }
  if (args.action !== undefined) {
    return args;
  }
  // TypeBox schemas are plain objects; many tools define an `action` property.
  const schemaObj = toolSchema as { properties?: Record<string, unknown> } | null;
  const hasAction = Boolean(
    schemaObj &&
    typeof schemaObj === "object" &&
    schemaObj.properties &&
    "action" in schemaObj.properties,
  );
  if (!hasAction) {
    return args;
  }
  return { ...args, action };
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message || String(err);
  }
  if (typeof err === "string") {
    return err;
  }
  return String(err);
}

function resolveToolInputErrorStatus(err: unknown): number | null {
  if (err instanceof ToolInputError) {
    const status = (err as { status?: unknown }).status;
    return typeof status === "number" ? status : 400;
  }
  if (typeof err !== "object" || err === null || !("name" in err)) {
    return null;
  }
  const name = (err as { name?: unknown }).name;
  if (name !== "ToolInputError" && name !== "ToolAuthorizationError") {
    return null;
  }
  const status = (err as { status?: unknown }).status;
  if (typeof status === "number") {
    return status;
  }
  return name === "ToolAuthorizationError" ? 403 : 400;
}

export async function handleToolsInvokeHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    auth: ResolvedGatewayAuth;
    maxBodyBytes?: number;
    trustedProxies?: string[];
    allowRealIpFallback?: boolean;
    rateLimiter?: AuthRateLimiter;
  },
): Promise<boolean> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (url.pathname !== "/tools/invoke") {
    return false;
  }

  if (req.method !== "POST") {
    sendMethodNotAllowed(res, "POST");
    return true;
  }

  const cfg = loadConfig();
  const token = getBearerToken(req);
  const resolvedTrustedProxies = opts.trustedProxies ?? cfg.gateway?.trustedProxies;
  const resolvedAllowRealIpFallback = opts.allowRealIpFallback ?? cfg.gateway?.allowRealIpFallback;
  const authResult = await authorizeHttpGatewayConnect({
    auth: opts.auth,
    connectAuth: token ? { token, password: token } : null,
    req,
    trustedProxies: resolvedTrustedProxies,
    allowRealIpFallback: resolvedAllowRealIpFallback,
    rateLimiter: opts.rateLimiter,
  });
  if (!authResult.ok) {
    sendGatewayAuthFailure(res, authResult);
    return true;
  }

  // Security boundary: POST /tools/invoke is an operator / automation surface
  // (loopback CLI, the Fabric loopback invoker, and shared-secret / token
  // automation). It is NOT a tenant browser surface — the Control UI invokes
  // tools over the WebSocket control plane, never this HTTP endpoint.
  //
  // An identity-scoped session (a platform-auth browser cookie, or a
  // reverse-proxy forwarded trusted-proxy user) authenticates as one specific
  // tenant / employee and carries no operator authority. Yet the request body
  // can name an arbitrary `sessionKey`, and the handler below builds and runs
  // tools bound to that session. Without this guard, any logged-in tenant user
  // could invoke tools against another agent's / tenant's session by naming its
  // sessionKey (cross-tenant access).
  //
  // Operator callers are those on a loopback-direct connection (local CLI, the
  // Fabric loopback invoker, the sanctioned loopback operator) or those who
  // presented a shared-secret / device credential (method token / password /
  // device-token / none). A remote caller authenticated ONLY via a forwarded
  // identity session (method "trusted-proxy", not loopback-direct) is refused
  // here and must use the WS control plane or an operator token over loopback.
  const callerIsLocalDirect = isLocalDirectRequest(
    req,
    resolvedTrustedProxies,
    resolvedAllowRealIpFallback === true,
  );
  if (authResult.method === "trusted-proxy" && !callerIsLocalDirect) {
    sendJson(res, 403, {
      ok: false,
      error: {
        type: "forbidden",
        message:
          "tools.invoke is not available to browser or tenant sessions. " +
          "Use the WebSocket control plane, or an operator token over loopback.",
      },
    });
    return true;
  }

  const bodyUnknown = await readJsonBodyOrError(req, res, opts.maxBodyBytes ?? DEFAULT_BODY_BYTES);
  if (bodyUnknown === undefined) {
    return true;
  }
  const body = (bodyUnknown ?? {}) as ToolsInvokeBody;

  const toolName = typeof body.tool === "string" ? body.tool.trim() : "";
  if (!toolName) {
    sendInvalidRequest(res, "tools.invoke requires body.tool");
    return true;
  }

  if (process.env.VITEST && MEMORY_TOOL_NAMES.has(toolName)) {
    const reasons = resolveMemoryToolDisableReasons(cfg);
    if (reasons.length > 0) {
      const suffix = reasons.length > 0 ? ` (${reasons.join(", ")})` : "";
      sendJson(res, 400, {
        ok: false,
        error: {
          type: "invalid_request",
          message:
            `memory tools are disabled in tests${suffix}. ` +
            'Enable by setting plugins.slots.memory="memory-core" (and ensure plugins.enabled is not false).',
        },
      });
      return true;
    }
  }

  const action = typeof body.action === "string" ? body.action.trim() : undefined;

  const argsRaw = body.args;
  const args =
    argsRaw && typeof argsRaw === "object" && !Array.isArray(argsRaw)
      ? (argsRaw as Record<string, unknown>)
      : {};

  const rawSessionKey = resolveSessionKeyFromBody(body);
  const sessionKey =
    !rawSessionKey || rawSessionKey === "main" ? resolveMainSessionKey(cfg) : rawSessionKey;

  // Resolve message channel/account hints (optional headers) for policy inheritance.
  const messageChannel = normalizeMessageChannel(
    getHeader(req, "x-openclaw-message-channel") ?? "",
  );
  const accountId = getHeader(req, "x-openclaw-account-id")?.trim() || undefined;
  const agentTo = getHeader(req, "x-openclaw-message-to")?.trim() || undefined;
  const agentThreadId = getHeader(req, "x-openclaw-thread-id")?.trim() || undefined;

  const {
    agentId,
    globalPolicy,
    globalProviderPolicy,
    agentPolicy,
    agentProviderPolicy,
    profile,
    providerProfile,
    profileAlsoAllow,
    providerProfileAlsoAllow,
  } = resolveEffectiveToolPolicy({ config: cfg, sessionKey });
  const profilePolicy = resolveToolProfilePolicy(profile);
  const providerProfilePolicy = resolveToolProfilePolicy(providerProfile);

  const profilePolicyWithAlsoAllow = mergeAlsoAllowPolicy(profilePolicy, profileAlsoAllow);
  const providerProfilePolicyWithAlsoAllow = mergeAlsoAllowPolicy(
    providerProfilePolicy,
    providerProfileAlsoAllow,
  );
  const groupPolicy = resolveGroupToolPolicy({
    config: cfg,
    sessionKey,
    messageProvider: messageChannel ?? undefined,
    accountId: accountId ?? null,
  });
  const subagentPolicy = isSubagentSessionKey(sessionKey)
    ? resolveSubagentToolPolicy(cfg)
    : undefined;

  let httpExecutionIdentity = createExecutionIdentityFromGatewayAuth(authResult);
  const serviceGrant = getHeader(req, "x-openbot-execution-grant")?.trim();
  if (
    serviceGrant &&
    !httpExecutionIdentity.enterpriseId &&
    body.operationIdentity &&
    typeof body.operationIdentity === "object"
  ) {
    const candidate = body.operationIdentity as OperationIdentity;
    if (
      [
        candidate.tenantId,
        candidate.taskId,
        candidate.executionId,
        candidate.stepId,
        candidate.operationId,
      ].some((value) => typeof value !== "string" || !value.trim())
    ) {
      sendInvalidRequest(res, "Invalid operation identity");
      return true;
    }
    const granted = await resolveGrantedHttpIdentity({
      token: serviceGrant,
      identity: candidate,
      tool: toolName,
      sessionKey,
      action,
      args,
    });
    if (
      !granted ||
      (httpExecutionIdentity.enterpriseId &&
        httpExecutionIdentity.enterpriseId !== granted.enterpriseId)
    ) {
      sendJson(res, 403, {
        ok: false,
        error: { type: "forbidden", message: "Execution grant identity invalid" },
      });
      return true;
    }
    httpExecutionIdentity = { ...httpExecutionIdentity, ...granted };
  }

  // Build tool list (core + plugin tools).
  const allTools = createOpenClawTools({
    agentSessionKey: sessionKey,
    agentChannel: messageChannel ?? undefined,
    agentAccountId: accountId,
    agentTo,
    agentThreadId,
    // HTTP callers consume tool output directly; preserve raw media invoke payloads.
    allowMediaInvokeCommands: true,
    config: cfg,
    ...(hasAuthenticatedIdentity(httpExecutionIdentity)
      ? inheritExecutionIdentityRunFields({ executionIdentity: httpExecutionIdentity })
      : {}),
    pluginToolAllowlist: collectExplicitAllowlist([
      profilePolicy,
      providerProfilePolicy,
      globalPolicy,
      globalProviderPolicy,
      agentPolicy,
      agentProviderPolicy,
      groupPolicy,
      subagentPolicy,
    ]),
  });

  const subagentFiltered = applyToolPolicyPipeline({
    // oxlint-disable-next-line typescript/no-explicit-any
    tools: allTools as any,
    // oxlint-disable-next-line typescript/no-explicit-any
    toolMeta: (tool) => getPluginToolMeta(tool as any),
    warn: logWarn,
    steps: [
      ...buildDefaultToolPolicyPipelineSteps({
        profilePolicy: profilePolicyWithAlsoAllow,
        profile,
        providerProfilePolicy: providerProfilePolicyWithAlsoAllow,
        providerProfile,
        globalPolicy,
        globalProviderPolicy,
        agentPolicy,
        agentProviderPolicy,
        groupPolicy,
        agentId,
      }),
      { policy: subagentPolicy, label: "subagent tools.allow" },
    ],
  });

  // Gateway HTTP-specific deny list — applies to ALL sessions via HTTP.
  const gatewayToolsCfg = cfg.gateway?.tools;
  const defaultGatewayDeny: string[] = DEFAULT_GATEWAY_HTTP_TOOL_DENY.filter(
    (name) => !gatewayToolsCfg?.allow?.includes(name),
  );
  const gatewayDenyNames = defaultGatewayDeny.concat(
    Array.isArray(gatewayToolsCfg?.deny) ? gatewayToolsCfg.deny : [],
  );
  const gatewayDenySet = new Set(gatewayDenyNames);
  const gatewayFiltered = subagentFiltered.filter((t) => !gatewayDenySet.has(t.name));

  const tool = gatewayFiltered.find((t) => t.name === toolName);
  if (!tool) {
    sendJson(res, 404, {
      ok: false,
      error: { type: "not_found", message: `Tool not available: ${toolName}` },
    });
    return true;
  }

  // tenantCapabilities is evaluated for governance envelopes / enforced deny.
  // The HTTP deny list above does not read it. Only MODE=enforced + deny changes HTTP.
  const toolsInvokeGov = await applyToolsInvokeGovernance({
    toolName,
    enterpriseId: httpExecutionIdentity.enterpriseId,
    platformUserId: httpExecutionIdentity.platformUserId,
    membershipId: httpExecutionIdentity.membershipId,
    capabilityPolicy: gatewayToolsCfg?.tenantCapabilities,
  });
  if (toolsInvokeGov.reject) {
    sendJson(res, toolsInvokeGov.reject.status, toolsInvokeGov.reject.body);
    return true;
  }

  try {
    const toolArgs = mergeActionIntoArgsIfSupported({
      // oxlint-disable-next-line typescript/no-explicit-any
      toolSchema: (tool as any).parameters,
      action,
      args,
    });
    observeHttpToolsInvokePreflight({
      sessionKey,
      toolName,
      policyToolNames: gatewayFiltered.map((entry) => entry.name),
      catalogToolNames: subagentFiltered.map((entry) => entry.name),
    });
    let operationIdentity: OperationIdentity | undefined;
    if (body.operationIdentity !== undefined) {
      const candidate = body.operationIdentity;
      const fields = ["tenantId", "taskId", "executionId", "stepId", "operationId"] as const;
      if (
        !candidate ||
        typeof candidate !== "object" ||
        fields.some((field) => typeof (candidate as Record<string, unknown>)[field] !== "string")
      ) {
        sendInvalidRequest(res, "Invalid operation identity");
        return true;
      }
      operationIdentity = candidate as OperationIdentity;
      executionOperationKey(operationIdentity);
      if (
        !httpExecutionIdentity.enterpriseId ||
        operationIdentity.tenantId !== httpExecutionIdentity.enterpriseId
      ) {
        sendJson(res, 403, {
          ok: false,
          error: {
            type: "forbidden",
            message: "Operation tenant conflicts with authenticated identity",
          },
        });
        return true;
      }
    }
    const grantToken = getHeader(req, "x-openbot-execution-grant")?.trim();
    if (operationIdentity && process.env.OPENBOT_RUNTIME_DATABASE_URL?.trim() && !grantToken) {
      sendJson(res, 403, {
        ok: false,
        error: {
          type: "execution_grant_required",
          message: "Database runtime operations require a live execution grant",
        },
      });
      return true;
    }
    const checkGrant = async () => {
      if (!operationIdentity || !grantToken) {
        return;
      }
      if (
        !(await verifyHttpExecutionGrant({
          token: grantToken,
          identity: operationIdentity,
          tool: toolName,
          sessionKey,
          action,
          args: toolArgs,
        }))
      ) {
        throw new ToolInputError("Execution grant expired or request ownership changed");
      }
    };
    if (grantToken && !operationIdentity) {
      sendInvalidRequest(res, "Execution grant requires operation identity");
      return true;
    }
    if (grantToken) {
      await checkGrant();
    }
    const invokeId = `http-${Date.now()}`;
    const runTool = async () => {
      const execute = async () => {
        await checkGrant();
        return tool.execute(invokeId, toolArgs);
      };
      if (grantToken && operationIdentity) {
        return executeHttpGrantedOperation({
          token: grantToken,
          identity: operationIdentity,
          tool: toolName,
          sessionKey,
          action,
          args: toolArgs,
          execute,
        });
      }
      if (!operationIdentity) {
        return execute();
      }
      return dispatchChildOnce({
        root: path.join(resolveStateDir(), "runtime-http-operations"),
        identity: operationIdentity,
        requesterSessionKey: sessionKey,
        request: {
          tool: toolName,
          action,
          args: toolArgs,
          user: httpExecutionIdentity.platformUserId,
          membership: httpExecutionIdentity.membershipId,
        },
        dispatch: execute,
      });
    };

    // Phase 2 toolkit gate (Policy to Approval to Receipt). Default OFF (NO LIVE):
    // set OPENBOT_TOOLKIT_PHASE2_GATE to 1/true/enforce to enable at this boundary.
    const bodyApproval = (body as { approvalId?: unknown }).approvalId;
    const preapprovedApprovalId =
      getHeader(req, "x-openclaw-toolkit-approval")?.trim() ||
      (typeof bodyApproval === "string" ? bodyApproval.trim() : undefined);
    const gate = await runGatewayToolkitPhase2Gate({
      toolName,
      action,
      args: toolArgs,
      sessionKey,
      execute: runTool,
      preapprovedApprovalId,
    });
    if (gate.gated) {
      if (!gate.allowed) {
        sendJson(res, gate.statusCode, {
          ok: false,
          error: gate.error,
          receipt: gate.receipt,
        });
        return true;
      }
      sendJson(res, 200, { ok: true, result: gate.result, receipt: gate.receipt });
      return true;
    }

    const result = await runTool();
    sendJson(res, 200, { ok: true, result });
  } catch (err) {
    if (err instanceof ToolOperationOutcomeUnknownError) {
      sendJson(res, 409, {
        ok: false,
        error: { type: "operation_outcome_unknown", message: err.message },
        waitCondition: err.waitCondition,
      });
      return true;
    }
    const inputStatus = resolveToolInputErrorStatus(err);
    if (inputStatus !== null) {
      sendJson(res, inputStatus, {
        ok: false,
        error: { type: "tool_error", message: getErrorMessage(err) || "invalid tool arguments" },
      });
      return true;
    }
    logWarn(`tools-invoke: tool execution failed: ${String(err)}`);
    sendJson(res, 500, {
      ok: false,
      error: { type: "tool_error", message: "tool execution failed" },
    });
  }

  return true;
}
