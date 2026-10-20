import fs from "node:fs/promises";
import path from "node:path";
import type { MentionStateJournalScope } from "./mention-state-journal.js";
import type { RuntimeIdentity, RuntimeOrganizationContext } from "./runtime.js";
import { resolveOrganizationMemoryDir } from "./task-assignment.js";

/** Result of a mention permission check. */
export type MentionPermissionResult = {
  allowed: boolean;
  reason?: string;
};

/** Parameters for evaluating mention permission. */
export type CanMentionParams = {
  senderIdentity: RuntimeIdentity;
  targetAgentId: string;
  organizationContext: RuntimeOrganizationContext;
  policy?: MentionAuthorityPolicy | null;
};

export type MentionAuthorityTargetKind = "all" | "system" | "coordinator" | "member" | "any";

export type MentionAuthorityRule = {
  effect: "allow" | "deny";
  targetAgentId?: string;
  targetKind?: MentionAuthorityTargetKind;
  sourceAgentIds?: string[];
  requiredPermissions?: string[];
  reason?: string;
};

export type MentionAuthorityPolicy = {
  rules?: MentionAuthorityRule[];
};

/** Well-known pseudo agent IDs for special mention targets. */
const MENTION_ALL_AGENT_ID = "__all__";
const MENTION_SYSTEM_AGENT_ID = "__system__";

/** Permissions that grant admin-level access for restricted mentions. */
const ADMIN_PERMISSIONS = new Set(["coordinate", "admin"]);

/**
 * Check whether a sender has admin-level permissions.
 * Returns true if the sender's permissions array contains "coordinate" or "admin".
 */
function hasAdminPermission(senderIdentity: RuntimeIdentity): boolean {
  return senderIdentity.permissions.some((perm) => ADMIN_PERMISSIONS.has(perm));
}

/**
 * Check whether the target agent is a member of the organization.
 */
function isMemberOfOrganization(
  targetAgentId: string,
  organizationContext: RuntimeOrganizationContext,
): boolean {
  return organizationContext.members.some((member) => member.agentId === targetAgentId);
}

function resolveTargetKind(
  targetAgentId: string,
  organizationContext: RuntimeOrganizationContext,
): MentionAuthorityTargetKind {
  if (targetAgentId === MENTION_ALL_AGENT_ID) {
    return "all";
  }
  if (targetAgentId === MENTION_SYSTEM_AGENT_ID) {
    return "system";
  }
  if (organizationContext.coordinator?.agentId === targetAgentId) {
    return "coordinator";
  }
  if (isMemberOfOrganization(targetAgentId, organizationContext)) {
    return "member";
  }
  return "any";
}

function senderMatchesRule(senderIdentity: RuntimeIdentity, rule: MentionAuthorityRule): boolean {
  if (
    rule.sourceAgentIds &&
    rule.sourceAgentIds.length > 0 &&
    !rule.sourceAgentIds.includes(senderIdentity.agentId)
  ) {
    return false;
  }
  if (
    rule.requiredPermissions &&
    rule.requiredPermissions.length > 0 &&
    !rule.requiredPermissions.some((permission) => senderIdentity.permissions.includes(permission))
  ) {
    return false;
  }
  return true;
}

function targetMatchesRule(params: {
  targetAgentId: string;
  targetKind: MentionAuthorityTargetKind;
  rule: MentionAuthorityRule;
}): boolean {
  if (params.rule.targetAgentId && params.rule.targetAgentId !== params.targetAgentId) {
    return false;
  }
  if (
    params.rule.targetKind &&
    params.rule.targetKind !== "any" &&
    params.rule.targetKind !== params.targetKind
  ) {
    return false;
  }
  return Boolean(params.rule.targetAgentId || params.rule.targetKind);
}

function evaluatePolicy(params: {
  policy: MentionAuthorityPolicy | null | undefined;
  senderIdentity: RuntimeIdentity;
  targetAgentId: string;
  targetKind: MentionAuthorityTargetKind;
}): MentionPermissionResult | null {
  for (const rule of params.policy?.rules ?? []) {
    if (
      !targetMatchesRule({
        targetAgentId: params.targetAgentId,
        targetKind: params.targetKind,
        rule,
      }) ||
      !senderMatchesRule(params.senderIdentity, rule)
    ) {
      continue;
    }

    return {
      allowed: rule.effect === "allow",
      ...(rule.reason ? { reason: rule.reason } : {}),
    };
  }
  return null;
}

function isMentionAuthorityRule(value: unknown): value is MentionAuthorityRule {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  const targetKind = record.targetKind;
  return (
    (record.effect === "allow" || record.effect === "deny") &&
    (record.targetAgentId === undefined || typeof record.targetAgentId === "string") &&
    (targetKind === undefined ||
      targetKind === "all" ||
      targetKind === "system" ||
      targetKind === "coordinator" ||
      targetKind === "member" ||
      targetKind === "any") &&
    (record.sourceAgentIds === undefined ||
      (Array.isArray(record.sourceAgentIds) &&
        record.sourceAgentIds.every((entry) => typeof entry === "string"))) &&
    (record.requiredPermissions === undefined ||
      (Array.isArray(record.requiredPermissions) &&
        record.requiredPermissions.every((entry) => typeof entry === "string"))) &&
    (record.reason === undefined || typeof record.reason === "string")
  );
}

export function parseMentionAuthorityPolicy(value: unknown): MentionAuthorityPolicy {
  if (!value || typeof value !== "object") {
    return { rules: [] };
  }
  const record = value as Record<string, unknown>;
  return {
    rules: Array.isArray(record.rules) ? record.rules.filter(isMentionAuthorityRule) : [],
  };
}

export async function loadMentionAuthorityPolicy(
  filePath: string,
): Promise<MentionAuthorityPolicy> {
  try {
    return parseMentionAuthorityPolicy(JSON.parse(await fs.readFile(filePath, "utf8")));
  } catch {
    return { rules: [] };
  }
}

export async function loadMentionAuthorityPolicyForOrganization(
  params: MentionStateJournalScope,
): Promise<MentionAuthorityPolicy> {
  return loadMentionAuthorityPolicy(
    path.join(resolveOrganizationMemoryDir(params), "mention-policy.json"),
  );
}

/**
 * Evaluate whether a sender can mention a target agent.
 *
 * MVP rules (derived from RuntimeOrganizationContext):
 * - `@all` ("__all__") → everyone (default)
 * - `@coordinator` (coordinator's agentId) → open to all group members
 * - `@system` ("__system__") → admin only (requires "coordinate" or "admin" in permissions)
 * - Any other agentId → allowed if the target is a member of the organization
 */
export function canMention(params: CanMentionParams): MentionPermissionResult {
  const { senderIdentity, targetAgentId, organizationContext } = params;
  const targetKind = resolveTargetKind(targetAgentId, organizationContext);
  const policyDecision = evaluatePolicy({
    policy: params.policy,
    senderIdentity,
    targetAgentId,
    targetKind,
  });
  if (policyDecision) {
    return policyDecision;
  }

  // @all → everyone can mention (default policy)
  if (targetAgentId === MENTION_ALL_AGENT_ID) {
    return { allowed: true };
  }

  // @system → admin only
  if (targetAgentId === MENTION_SYSTEM_AGENT_ID) {
    if (hasAdminPermission(senderIdentity)) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: "Only members with admin or coordinate permission can mention @system",
    };
  }

  // @coordinator → open to all group members
  const coordinator = organizationContext.coordinator;
  if (coordinator && targetAgentId === coordinator.agentId) {
    return { allowed: true };
  }

  // Any other agentId → allowed if target is a member of the organization
  if (isMemberOfOrganization(targetAgentId, organizationContext)) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: `Agent "${targetAgentId}" is not a member of the organization`,
  };
}
