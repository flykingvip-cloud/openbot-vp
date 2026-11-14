/**
 * Production fact resolution for employee rule-adaptation advice.
 *
 * Reuses existing target access checks and model-window resolution. The
 * official policy fact source reads SessionTaskBoard through
 * readOfficialEmployeeAdviceTaskBoard and copies only fields that already exist
 * on an activated snapshot (policyHash / protocolVersion / compilerRevision).
 * This module never invents approved_compatible, active, or any other
 * constant approval, and it does not create a task to obtain those facts.
 * Seat membership is not target-rule authorization. View-and-request-advice
 * access is sufficient; activation or rule-modification rights are not
 * required and are not granted here.
 *
 * HostCompatibilityRecord and HostExpectedPolicyState are not persisted on
 * ActivatedRuntimeRulePolicySnapshot or elsewhere in this repository; they
 * exist only as ephemeral activation-binding fields. When those records are
 * absent, facts stay unset and the advice path must not pretend they were
 * approved.
 */
import {
  readOfficialEmployeeAdviceTaskBoard,
  resolveTrustedEffectiveContextTokens,
} from "../../agent-runtime/command/index.js";
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
import { listAgentIds } from "../../agents/agent-scope.js";
import type { OpenBotConfig } from "../../config/config.js";
import { resolveSessionFilePath } from "../../config/sessions/paths.js";
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

type EmployeeAdviceTaskBoard = {
  current?: { taskId?: string; [key: string]: unknown };
  scope?: { tenantId?: string; userId?: string; [key: string]: unknown };
  runtimeRuleAdaptationByTaskId?: {
    [taskId: string]: { current?: unknown; history?: unknown[] };
  };
  [key: string]: unknown;
};

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

/**
 * Explicit empty source for tests that need a missing-record fixture.
 * Not the production default. Official handlers must assemble
 * createOfficialEmployeeAdvicePolicyFactSource().
 */
export function createEmptyEmployeeAdvicePolicyFactSource(): EmployeeAdvicePolicyFactSource {
  return {
    read() {
      return undefined;
    },
  };
}

/**
 * Locate the session transcript whose companion task board is the
 * authoritative record for this advice request. Read-only: does not create
 * a session or a task. Returns undefined when the request has no session key
 * that can be parsed to a session id.
 */
export function resolveEmployeeAdviceSessionFile(input: {
  agentId: string;
  sessionKey?: string;
  sessionsDir?: string;
}): string | undefined {
  const sessionKey = nonEmpty(input.sessionKey);
  if (!sessionKey) {
    return undefined;
  }
  const parsed = parseAgentSessionKey(sessionKey);
  const sessionId = nonEmpty(parsed?.rest);
  if (!sessionId) {
    return undefined;
  }
  const agentId = explicitAgentId(input.agentId) ?? explicitAgentId(parsed?.agentId);
  if (!agentId) {
    return undefined;
  }
  try {
    return resolveSessionFilePath(sessionId, undefined, {
      agentId,
      ...(input.sessionsDir ? { sessionsDir: input.sessionsDir } : {}),
    });
  } catch {
    return undefined;
  }
}

function copyExpectedPolicyVersion(value: unknown): EmployeeAdvicePolicyVersion | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const policyHash = nonEmpty(record.policyHash);
  const protocolVersion = nonEmpty(record.protocolVersion);
  const compilerRevision = nonEmpty(record.compilerRevision);
  if (!policyHash || !protocolVersion || !compilerRevision) {
    return undefined;
  }
  return { policyHash, protocolVersion, compilerRevision };
}

function boardScopeAllowsRead(
  board: EmployeeAdviceTaskBoard,
  tenantId: string,
  employeeId: string,
): boolean {
  const scope = board.scope;
  if (!scope) {
    return true;
  }
  const scopeTenant = nonEmpty(scope.tenantId);
  const scopeUser = nonEmpty(scope.userId);
  if (scopeTenant && scopeTenant !== tenantId) {
    return false;
  }
  if (scopeUser && scopeUser !== employeeId) {
    return false;
  }
  return true;
}

/**
 * Copy policy facts that already exist on the official SessionTaskBoard.
 * Only snapshot policy version fields are copied. Compatibility records and
 * expectedPolicyState are not stored on the snapshot and are never invented
 * as approved_compatible or active. Does not create or bind a new task.
 */
export function copyEmployeeAdvicePolicyFactsFromBoard(
  board: EmployeeAdviceTaskBoard,
  input: { tenantId: string; employeeId: string },
): EmployeeAdvicePolicyFacts | undefined {
  if (!boardScopeAllowsRead(board, input.tenantId, input.employeeId)) {
    return undefined;
  }
  const taskId = nonEmpty(board.current?.taskId);
  if (!taskId) {
    return undefined;
  }
  const snapshot = board.runtimeRuleAdaptationByTaskId?.[taskId]?.current;
  const expectedPolicyVersion = copyExpectedPolicyVersion(snapshot);
  if (!expectedPolicyVersion) {
    return undefined;
  }
  return { expectedPolicyVersion };
}

/**
 * Official read of the existing SessionTaskBoard. Missing or unreadable
 * boards yield undefined; this function does not create files or tasks.
 */
export function readEmployeeAdviceAuthoritativeBoard(input: {
  tenantId: string;
  employeeId: string;
  agentId: string;
  sessionKey?: string;
  sessionsDir?: string;
}): EmployeeAdviceTaskBoard | undefined {
  const sessionFile = resolveEmployeeAdviceSessionFile({
    agentId: input.agentId,
    ...(input.sessionKey ? { sessionKey: input.sessionKey } : {}),
    ...(input.sessionsDir ? { sessionsDir: input.sessionsDir } : {}),
  });
  if (!sessionFile) {
    return undefined;
  }
  try {
    return readOfficialEmployeeAdviceTaskBoard(sessionFile);
  } catch {
    return undefined;
  }
}

export type OfficialEmployeeAdvicePolicyFactSourceOptions = {
  sessionsDir?: string;
  readBoard?: typeof readEmployeeAdviceAuthoritativeBoard;
};

/**
 * Production policy fact source. Assembled by the official handler.
 * Reads existing SessionTaskBoard records through the official board IO
 * and copies only fields that are already stored. Never fills compatibility
 * or policy-state constants, and never creates a task to obtain them.
 */
export function createOfficialEmployeeAdvicePolicyFactSource(
  options: OfficialEmployeeAdvicePolicyFactSourceOptions = {},
): EmployeeAdvicePolicyFactSource {
  const readBoard = options.readBoard ?? readEmployeeAdviceAuthoritativeBoard;
  return {
    read(input) {
      const tenantId = nonEmpty(input.tenantId);
      const employeeId = nonEmpty(input.employeeId);
      const agentId = explicitAgentId(input.agentId);
      if (!tenantId || !employeeId || !agentId) {
        return undefined;
      }
      const board = readBoard({
        tenantId,
        employeeId,
        agentId,
        ...(input.sessionKey ? { sessionKey: input.sessionKey } : {}),
        ...(options.sessionsDir ? { sessionsDir: options.sessionsDir } : {}),
      });
      if (!board) {
        return undefined;
      }
      return copyEmployeeAdvicePolicyFactsFromBoard(board, { tenantId, employeeId });
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
 * the actual model window, and policy facts from the official authoritative
 * board source unless a caller injects a source. Never fills compatibility
 * or policy-state constants, and never defaults to the empty test source.
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
  const source = input.policyFactSource ?? createOfficialEmployeeAdvicePolicyFactSource();
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
