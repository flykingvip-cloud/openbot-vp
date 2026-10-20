// Feature: shared-agent-identity-access-control-plane

/**
 * Append-only audit sinks for the unified access control plane.
 *
 * Two streams, because their volume and retention differ sharply:
 *  - `access-control-decisions.jsonl` records one line per authorization check
 *    (high volume, short retention).
 *  - `access-control-governance.jsonl` records policy mutation, ownership
 *    transfer, correction, repair, and export (low volume, long retention per the
 *    ADR).
 *
 * Both follow the existing platform-auth login audit convention: JSONL under
 * `CONFIG_DIR/audit`, 0o600 files inside a 0o700 directory, best-effort writes that
 * never throw into the caller. Only identifiers are recorded, never credentials,
 * emails, or session tokens.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { CONFIG_DIR } from "../../utils.js";
import type { AccessDenyReason, AccessResourceType, AccessSubjectType } from "./policy-v2-types.js";

export type AccessControlMode = "shadow" | "enforce";

export type AccessDecisionAuditEvent = {
  ts: string;
  requestId?: string;
  /** Whether the decision was enforced or only observed. */
  mode: AccessControlMode;
  enterpriseId: string;
  subjectType: AccessSubjectType;
  subjectId: string;
  /** Present only for a service principal acting for a membership. */
  onBehalfOfMembershipId?: string;
  resourceType: AccessResourceType;
  /** Canonical `agentAssetId` for `agent_asset`, otherwise the v1 resource id. */
  resourceId: string;
  permission: string;
  /** What the evaluator decided, independent of whether it was enforced. */
  evaluated: "allow" | "deny";
  reason?: AccessDenyReason;
  matchedPolicyId?: string;
  /** What the caller actually experienced; differs from `evaluated` in shadow mode. */
  effect: "allowed" | "denied";
};

export type AccessGovernanceAction =
  | "policy.create"
  | "policy.revoke"
  | "ownership.transfer"
  | "ownership.release"
  | "asset.create"
  | "growth.correct"
  | "growth.repair"
  | "growth.export"
  /** A runtime-vs-V2 granted-surface comparison, recorded while shadowing a cutover. */
  | "access.shadow-surface";

export type AccessGovernanceAuditEvent = {
  ts: string;
  requestId?: string;
  enterpriseId: string;
  action: AccessGovernanceAction;
  actor: { subjectType: AccessSubjectType | "platform-operator"; subjectId: string };
  target?: {
    agentAssetId?: string;
    policyId?: string;
    ownerType?: "membership" | "seat";
    ownerId?: string;
  };
  detail?: Record<string, string | number | boolean | null>;
};

export type ManagementGovernanceAuditEvent = {
  ts: string;
  requestId?: string;
  actor: {
    role:
      | "platform-super-admin"
      | "platform-admin"
      | "tenant-admin"
      | "employee-supervisor"
      | "local-operator";
    subjectId: string;
    scope: "platform" | "tenant" | "employee";
  };
  action: "observe" | "read" | "write" | "invoke" | "pair" | "revoke" | "approve";
  target: {
    kind: "tenant" | "user" | "device" | "supervisor-agent" | "worker-agent";
    resourceId: string;
    tenantId?: string;
    ownerUserId?: string;
  };
  effect: "allowed" | "denied";
  reason?: string;
};

const DECISIONS_FILE = "access-control-decisions.jsonl";
const GOVERNANCE_FILE = "access-control-governance.jsonl";
const MANAGEMENT_GOVERNANCE_FILE = "management-governance.jsonl";

function auditPath(fileName: string): string {
  return path.join(CONFIG_DIR, "audit", fileName);
}

async function appendJsonLine(fileName: string, event: unknown): Promise<void> {
  try {
    const filePath = auditPath(fileName);
    await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    await fs.appendFile(filePath, `${JSON.stringify(event)}\n`, { mode: 0o600 });
  } catch (error) {
    // Best-effort: an audit failure must not change an authorization outcome.
    console.warn(`[access-control] failed to write ${fileName}: ${String(error)}`);
  }
}

export async function emitAccessDecisionAudit(event: AccessDecisionAuditEvent): Promise<void> {
  await appendJsonLine(DECISIONS_FILE, event);
}

export async function emitAccessGovernanceAudit(event: AccessGovernanceAuditEvent): Promise<void> {
  await appendJsonLine(GOVERNANCE_FILE, event);
}

export async function emitManagementGovernanceAudit(
  event: ManagementGovernanceAuditEvent,
): Promise<void> {
  await appendJsonLine(MANAGEMENT_GOVERNANCE_FILE, event);
}

/** Exposed for tests and operational tooling that needs the on-disk locations. */
export function accessControlAuditPaths(): {
  decisions: string;
  governance: string;
  managementGovernance: string;
} {
  return {
    decisions: auditPath(DECISIONS_FILE),
    governance: auditPath(GOVERNANCE_FILE),
    managementGovernance: auditPath(MANAGEMENT_GOVERNANCE_FILE),
  };
}
