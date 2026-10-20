/**
 * Path B identity split: admin steward may use the enterprise roster;
 * user steward / ordinary agent only objects they may access.
 */
import {
  BUILTIN_STEWARD_AGENT_ID,
  isBuiltinStewardAgent,
} from "../agents/builtin-steward/identity.js";
import { listOwnershipRecords } from "../gateway/ownership-store.js";
import {
  DIAGNOSIS_ALL_TARGET_CAP,
  extractDiagnoseSpaceGroupId,
  parseDiagnoseRequest,
  type DiagnosisLocator,
  type ParsedDiagnoseRequest,
} from "./diagnose-policy.js";

const EMPLOYEE_STEWARD_SEGMENT = "employee";

export type DiagnoseConversationKind = "admin_steward" | "user_steward" | "agent";

export type DiagnoseConversationCaller = {
  sessionKey?: string;
  agentId?: string;
  senderIsOwner?: boolean;
  sessionDomain?: "platform" | "enterprise" | "employee";
  allowedAgentIds?: string[];
  allowedGroupIds?: string[];
};

export function isEmployeeStewardSessionKey(sessionKey: string): boolean {
  return sessionKey
    .trim()
    .startsWith(`agent:${BUILTIN_STEWARD_AGENT_ID}:${EMPLOYEE_STEWARD_SEGMENT}:`);
}

/** Server-assigned steward session key, not a client workspace path. */
export function extractEmployeeStewardUserId(sessionKey?: string | null): string | null {
  const raw = sessionKey?.trim() ?? "";
  if (!isEmployeeStewardSessionKey(raw)) {
    return null;
  }
  const userId = raw
    .slice(`agent:${BUILTIN_STEWARD_AGENT_ID}:${EMPLOYEE_STEWARD_SEGMENT}:`.length)
    .trim();
  return userId || null;
}

export function isGlobalStewardSessionKey(sessionKey: string): boolean {
  const raw = sessionKey.trim();
  if (!raw) {
    return false;
  }
  const lower = raw.toLowerCase();
  if (raw === "main" || lower === "global" || lower === "agent:main") {
    return true;
  }
  if (isEmployeeStewardSessionKey(raw)) {
    return false;
  }
  return raw === `agent:${BUILTIN_STEWARD_AGENT_ID}:main`;
}

export function classifyDiagnoseConversationCaller(
  caller: DiagnoseConversationCaller,
): DiagnoseConversationKind {
  const sessionKey = caller.sessionKey?.trim() ?? "";
  const steward =
    isEmployeeStewardSessionKey(sessionKey) ||
    isGlobalStewardSessionKey(sessionKey) ||
    isBuiltinStewardAgent(caller.agentId);
  const elevated =
    caller.senderIsOwner === true ||
    caller.sessionDomain === "enterprise" ||
    caller.sessionDomain === "platform";
  if (steward && elevated) {
    return "admin_steward";
  }
  if (steward) {
    return "user_steward";
  }
  return "agent";
}

function listOwnedSubjectIds(input: {
  userId?: string | null;
  tenantId?: string | null;
  subjectKind: "agent" | "group";
}): string[] {
  const userId = input.userId?.trim();
  if (!userId) {
    return [];
  }
  const tenantId = input.tenantId?.trim() || null;
  return listOwnershipRecords()
    .filter((row) => row.bindingStatus !== "revoked" && row.subjectKind === input.subjectKind)
    .filter((row) => row.currentManagerUserId === userId)
    .filter((row) => !tenantId || row.tenantId === tenantId)
    .map((row) => row.subjectId);
}

export function listOwnedDiagnoseAgentIds(input: {
  userId?: string | null;
  tenantId?: string | null;
}): string[] {
  return listOwnedSubjectIds({ ...input, subjectKind: "agent" });
}

export function listOwnedDiagnoseGroupIds(input: {
  userId?: string | null;
  tenantId?: string | null;
}): string[] {
  return listOwnedSubjectIds({ ...input, subjectKind: "group" });
}

function locatorAllowed(locator: DiagnosisLocator, caller: DiagnoseConversationCaller): boolean {
  const agents = new Set((caller.allowedAgentIds ?? []).map((id) => id.trim()).filter(Boolean));
  const groups = new Set((caller.allowedGroupIds ?? []).map((id) => id.trim()).filter(Boolean));
  if (agents.has(locator.agentId)) {
    return true;
  }
  const groupId = extractDiagnoseSpaceGroupId(locator.sessionKey);
  return Boolean(groupId && groups.has(groupId));
}

function selfLocator(caller: DiagnoseConversationCaller): DiagnosisLocator[] {
  const agentId = caller.agentId?.trim();
  const sessionKey = caller.sessionKey?.trim();
  if (!agentId || !sessionKey) {
    return [];
  }
  return [{ agentId, sessionKey }];
}

export function authorizeConversationDiagnoseRequest(input: {
  caller: DiagnoseConversationCaller;
  params: unknown;
}): { ok: true; request: ParsedDiagnoseRequest } | { ok: false; reason: string } {
  const kind = classifyDiagnoseConversationCaller(input.caller);
  const request = parseDiagnoseRequest(input.params);
  if (kind === "admin_steward") {
    return { ok: true, request };
  }
  if (kind === "agent") {
    const locators = selfLocator(input.caller);
    if (locators.length === 0) {
      return { ok: false, reason: "target_required" };
    }
    return {
      ok: true,
      request: {
        ...request,
        scope: "target",
        locators,
        requestedCount: 1,
        skipped: 0,
        deliverTo: { enterpriseAdmin: false, owners: false },
      },
    };
  }
  if (request.scope === "all") {
    return { ok: false, reason: "scope_all_forbidden" };
  }
  let locators: DiagnosisLocator[];
  if (request.locators.length > 0) {
    locators = request.locators.filter((row) => locatorAllowed(row, input.caller));
    if (locators.length === 0) {
      return { ok: false, reason: "target_required" };
    }
  } else {
    locators = selfLocator(input.caller);
    if (locators.length === 0) {
      return { ok: false, reason: "target_required" };
    }
  }
  return {
    ok: true,
    request: {
      ...request,
      locators: locators.slice(0, DIAGNOSIS_ALL_TARGET_CAP),
      requestedCount: locators.length,
      skipped: Math.max(0, locators.length - DIAGNOSIS_ALL_TARGET_CAP),
      deliverTo: { enterpriseAdmin: false, owners: false },
    },
  };
}
