import { resolveTrustedEffectiveContextTokens } from "../../agent-runtime/command/index.js";
import type {
  TrustedEmployeeAdviceFacts,
  TrustedEmployeeAdviceHost,
} from "../../agent-runtime/command/index.js";
import type {
  HostCompatibilityRecord,
  HostExpectedPolicyState,
} from "../../agent-runtime/contracts/rule-adaptation.js";
import {
  CONTEXT_WINDOW_HARD_MIN_TOKENS,
  resolveContextWindowInfo,
} from "../../agent-runtime/policy/index.js";
/**
 * Production fact resolution for employee rule-adaptation advice.
 *
 * Reuses existing target access checks and model-window resolution. Policy
 * compatibility and expected policy state are read from a trusted fact source
 * when present; this module never invents approved_compatible, active, or any
 * other constant approval. Seat membership is not target-rule authorization.
 * View-and-request-advice access is sufficient; activation or rule-modification
 * rights are not required and are not granted here.
 */
import { listAgentIds } from "../../agents/agent-scope.js";
import type { OpenBotConfig } from "../../config/config.js";
import {
  isValidAgentId,
  normalizeAgentId,
  parseAgentSessionKey,
} from "../../routing/session-key.js";
import { assertClientMayAccessAgentDetailed } from "./operator-access.js";
import type { GatewayClient } from "./types.js";

export type EmployeeAdviceApprovedTarget = {
  targetAuthorization: "approved" | "denied" | "unknown";
  reason?: string;
  approvedTarget?: TrustedEmployeeAdviceFacts["approvedTarget"];
};

export type EmployeeAdvicePolicyVersion = {
  policyHash: string;
  protocolVersion: string;
  compilerRevision: string;
};

export type EmployeeAdvicePolicyFacts = {
  compatibilityRecord?: HostCompatibilityRecord;
  expectedPolicyState?: HostExpectedPolicyState;
  expectedPolicyVersion?: EmployeeAdvicePolicyVersion;
  hardMinContextTokens?: number;
  /** Optional host-owned schema hints. Never accepted from the client. */
  requiredProposalShape?: unknown;
  /**
   * Informational only. Advice must not require this to be true, and a true
   * value still does not authorize activation.
   */
  activationAuthorized?: boolean;
};

export type EmployeeAdvicePolicyFactSource = {
  read: (input: {
    tenantId: string;
    employeeId: string;
    agentId: string;
    sessionKey?: string;
  }) => Promise<EmployeeAdvicePolicyFacts | undefined> | EmployeeAdvicePolicyFacts | undefined;
};

export type EmployeeAdviceAgentAccessResult =
  | {
      ok: true;
      agentId: string;
      tenantId: string | null;
      userId: string | null;
      /** Never required for advice. Official production check leaves this false. */
      activationAuthorized?: boolean;
    }
  | { ok: false; denied: boolean; reason: string };

export type EmployeeAdviceAgentAccessCheck = (input: {
  client: GatewayClient | null | undefined;
  agentId: string;
  identity: TrustedEmployeeAdviceHost["identity"];
}) => Promise<EmployeeAdviceAgentAccessResult> | EmployeeAdviceAgentAccessResult;

export type ResolveEmployeeAdviceProductionFactsInput = {
  identity: TrustedEmployeeAdviceHost["identity"];
  targetRef: { sessionKey?: string; agentId?: string };
  config: OpenBotConfig;
  client?: GatewayClient | null;
  officialModel?: { provider: string; model: string } | null;
  policyFactSource?: EmployeeAdvicePolicyFactSource;
  checkAgentAccess?: EmployeeAdviceAgentAccessCheck;
};

export type EmployeeAdviceProductionFacts = TrustedEmployeeAdviceFacts;

const UNIT = "\u001f";

function nonEmpty(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function explicitAgentId(value: unknown): string | undefined {
  const raw = nonEmpty(value);
  if (!raw || !isValidAgentId(raw)) {
    return undefined;
  }
  return normalizeAgentId(raw);
}

/**
 * Identify a target agent without falling back to the default agent id.
 * A session key must parse to an agent; an agentId must be a valid id.
 */
export function resolveEmployeeAdviceTargetAgentId(targetRef: {
  sessionKey?: string;
  agentId?: string;
}): { ok: true; agentId: string; sessionKey?: string } | { ok: false; reason: string } {
  const sessionKey = nonEmpty(targetRef.sessionKey);
  const fromRef = explicitAgentId(targetRef.agentId);
  const parsed = sessionKey ? parseAgentSessionKey(sessionKey) : null;
  const fromSession = parsed?.agentId ? explicitAgentId(parsed.agentId) : undefined;

  if (fromRef && fromSession && fromRef !== fromSession) {
    return {
      ok: false,
      reason: "目标引用不一致，服务端无法核准目标。",
    };
  }
  const agentId = fromRef ?? fromSession;
  if (!agentId) {
    return {
      ok: false,
      reason: "服务端尚未核准目标，缺少可核验的目标引用。",
    };
  }
  return {
    ok: true,
    agentId,
    ...(sessionKey ? { sessionKey } : {}),
  };
}

export function employeeAdvicePolicyFactKey(input: {
  tenantId: string;
  agentId: string;
  sessionKey?: string;
}): string {
  return input.sessionKey
    ? `${input.tenantId}${UNIT}${input.agentId}${UNIT}${input.sessionKey}`
    : `${input.tenantId}${UNIT}${input.agentId}`;
}

/** Empty production default: missing facts stay missing. Never invents records. */
export function createEmptyEmployeeAdvicePolicyFactSource(): EmployeeAdvicePolicyFactSource {
  return {
    read() {
      return undefined;
    },
  };
}

/**
 * Readable in-memory fact source for tests and host fixtures.
 * Records are looked up by trusted tenant + agent, then by optional sessionKey.
 * Values are returned as stored; nothing is replaced with constants.
 */
export function createEmployeeAdvicePolicyFactSource(
  records: Iterable<{
    tenantId: string;
    agentId: string;
    sessionKey?: string;
    facts: EmployeeAdvicePolicyFacts;
  }>,
): EmployeeAdvicePolicyFactSource {
  const exact = new Map<string, EmployeeAdvicePolicyFacts>();
  const byAgent = new Map<string, EmployeeAdvicePolicyFacts>();
  for (const record of records) {
    const tenantId = nonEmpty(record.tenantId);
    const agentId = explicitAgentId(record.agentId);
    if (!tenantId || !agentId) {
      continue;
    }
    const facts = record.facts;
    const agentKey = employeeAdvicePolicyFactKey({ tenantId, agentId });
    byAgent.set(agentKey, facts);
    if (record.sessionKey) {
      exact.set(
        employeeAdvicePolicyFactKey({ tenantId, agentId, sessionKey: record.sessionKey }),
        facts,
      );
    }
  }
  return {
    read(input) {
      const tenantId = nonEmpty(input.tenantId);
      const agentId = explicitAgentId(input.agentId);
      if (!tenantId || !agentId) {
        return undefined;
      }
      if (input.sessionKey) {
        const hit = exact.get(
          employeeAdvicePolicyFactKey({
            tenantId,
            agentId,
            sessionKey: input.sessionKey,
          }),
        );
        if (hit) {
          return hit;
        }
      }
      return byAgent.get(employeeAdvicePolicyFactKey({ tenantId, agentId }));
    },
  };
}

/**
 * Official view-access check. Requires an authenticated client and reuses
 * assertClientMayAccessAgentDetailed. Does not check or grant activation or
 * rule-modification rights.
 */
export async function officialEmployeeAdviceAgentAccessCheck(input: {
  client: GatewayClient | null | undefined;
  agentId: string;
  identity: TrustedEmployeeAdviceHost["identity"];
}): Promise<EmployeeAdviceAgentAccessResult> {
  if (!input.client) {
    return {
      ok: false,
      denied: true,
      reason: "缺少已认证会话，无法核验目标查看权限。",
    };
  }
  let message = "当前账号没有查看该目标并请求建议的权限。";
  const access = await assertClientMayAccessAgentDetailed(
    input.client,
    input.agentId,
    (_ok, _payload, error) => {
      if (error && typeof error === "object" && "message" in error) {
        const value = (error as { message?: unknown }).message;
        if (typeof value === "string" && value.trim()) {
          message = value.trim();
        }
      }
    },
  );
  if (!access) {
    return { ok: false, denied: true, reason: message };
  }
  const membershipTenant = access.tenantId?.trim() || undefined;
  const identityTenant = input.identity.tenantId?.trim() || undefined;
  if (membershipTenant && identityTenant && membershipTenant !== identityTenant) {
    return {
      ok: false,
      denied: true,
      reason: "目标所属租户与当前员工席位不一致，无法查看该目标。",
    };
  }
  return {
    ok: true,
    agentId: access.agentId,
    tenantId: access.tenantId,
    userId: access.userId,
    activationAuthorized: false,
  };
}

export async function resolveEmployeeAdviceApprovedTarget(input: {
  identity: TrustedEmployeeAdviceHost["identity"];
  targetRef: { sessionKey?: string; agentId?: string };
  config: OpenBotConfig;
  client?: GatewayClient | null;
  checkAgentAccess?: EmployeeAdviceAgentAccessCheck;
}): Promise<EmployeeAdviceApprovedTarget> {
  const resolved = resolveEmployeeAdviceTargetAgentId(input.targetRef);
  if (!resolved.ok) {
    return {
      targetAuthorization: "unknown",
      reason: resolved.reason,
    };
  }
  const known = listAgentIds(input.config);
  if (known.length > 0 && !known.includes(resolved.agentId)) {
    return {
      targetAuthorization: "unknown",
      reason: "服务端无法确认该目标，缺少目标访问权限证明。",
    };
  }
  const check = input.checkAgentAccess ?? officialEmployeeAdviceAgentAccessCheck;
  const access = await check({
    client: input.client,
    agentId: resolved.agentId,
    identity: input.identity,
  });
  if (!access.ok) {
    if (access.denied) {
      return {
        targetAuthorization: "denied",
        reason: access.reason || "拥有员工席位也不等于有权查看目标并请求规则适配建议。",
      };
    }
    return {
      targetAuthorization: "unknown",
      reason: access.reason || "服务端尚未核准目标，缺少目标访问权限证明。",
    };
  }
  return {
    targetAuthorization: "approved",
    approvedTarget: {
      agentId: access.agentId,
      scopeId: access.agentId,
      ...(resolved.sessionKey ? { sessionKey: resolved.sessionKey } : {}),
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

function resolveEffectiveContextFacts(
  config: OpenBotConfig,
  officialModel?: { provider: string; model: string } | null,
): Pick<
  TrustedEmployeeAdviceFacts,
  | "currentContextTokens"
  | "currentContextTokenSource"
  | "modelContextWindow"
  | "configContextTokenCap"
  | "hardMinContextTokens"
> {
  const facts: Pick<
    TrustedEmployeeAdviceFacts,
    | "currentContextTokens"
    | "currentContextTokenSource"
    | "modelContextWindow"
    | "configContextTokenCap"
    | "hardMinContextTokens"
  > = {
    hardMinContextTokens: CONTEXT_WINDOW_HARD_MIN_TOKENS,
  };
  const cap = (() => {
    const value = config.agents?.defaults?.contextTokens;
    return typeof value === "number" && Number.isFinite(value) && value > 0
      ? Math.floor(value)
      : undefined;
  })();
  if (typeof cap === "number") {
    facts.configContextTokenCap = cap;
  }
  if (!officialModel) {
    return facts;
  }
  const catalogWindow = readCatalogModelContextWindow(
    config,
    officialModel.provider,
    officialModel.model,
  );
  if (typeof catalogWindow !== "number") {
    return facts;
  }
  // Reuse the official context-window reader so a config cap is applied the
  // same way as the rest of the runtime. A "default" source is rejected
  // because that path has no actual model window.
  const info = resolveContextWindowInfo({
    cfg: config,
    provider: officialModel.provider,
    modelId: officialModel.model,
    modelContextWindow: catalogWindow,
    defaultTokens: catalogWindow,
  });
  if (info.source === "default") {
    return facts;
  }
  facts.modelContextWindow = catalogWindow;
  const effective = resolveTrustedEffectiveContextTokens({
    modelWindow: catalogWindow,
    configCap: cap,
  });
  if (effective.ok) {
    facts.currentContextTokens = effective.tokens;
    facts.currentContextTokenSource = effective.source;
  }
  return facts;
}

/**
 * Production resolver used by the gateway handler. Reads target access,
 * the actual model window, and policy facts from existing chains / a
 * readable source. Never fills compatibility or policy-state constants.
 */
export async function resolveEmployeeAdviceProductionFacts(
  input: ResolveEmployeeAdviceProductionFactsInput,
): Promise<EmployeeAdviceProductionFacts> {
  const facts: TrustedEmployeeAdviceFacts = {
    ...resolveEffectiveContextFacts(input.config, input.officialModel),
  };
  const target = await resolveEmployeeAdviceApprovedTarget({
    identity: input.identity,
    targetRef: input.targetRef,
    config: input.config,
    client: input.client,
    checkAgentAccess: input.checkAgentAccess,
  });
  facts.targetAuthorization = target.targetAuthorization;
  if (target.reason) {
    facts.targetAuthorizationReason = target.reason;
  }
  if (target.approvedTarget) {
    facts.approvedTarget = target.approvedTarget;
  }

  const tenantId = nonEmpty(input.identity.tenantId);
  const employeeId = nonEmpty(input.identity.employeeId);
  const source = input.policyFactSource ?? createEmptyEmployeeAdvicePolicyFactSource();
  if (
    target.targetAuthorization === "approved" &&
    target.approvedTarget &&
    tenantId &&
    employeeId
  ) {
    const policyFacts = await source.read({
      tenantId,
      employeeId,
      agentId: target.approvedTarget.agentId,
      ...(target.approvedTarget.sessionKey ? { sessionKey: target.approvedTarget.sessionKey } : {}),
    });
    if (policyFacts?.compatibilityRecord) {
      facts.compatibilityRecord = policyFacts.compatibilityRecord;
    }
    if (policyFacts?.expectedPolicyState) {
      facts.expectedPolicyState = policyFacts.expectedPolicyState;
    }
    if (policyFacts?.expectedPolicyVersion) {
      facts.expectedPolicyVersion = policyFacts.expectedPolicyVersion;
    }
    if (typeof policyFacts?.hardMinContextTokens === "number") {
      facts.hardMinContextTokens = policyFacts.hardMinContextTokens;
    }
    if (policyFacts?.requiredProposalShape !== undefined) {
      facts.requiredProposalShape = policyFacts.requiredProposalShape;
    }
  }
  return facts;
}
