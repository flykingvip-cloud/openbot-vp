/**
 * Platform governance policy for OpenBot supervisors and worker agents.
 *
 * This is deliberately resource-scoped: a role alone never grants access to
 * an arbitrary tenant, user, device, or agent.
 */

export type GovernanceRole =
  | "platform-super-admin"
  | "platform-admin"
  | "tenant-admin"
  | "employee-supervisor"
  | "worker-agent";

export type GovernanceAction =
  | "observe"
  | "read"
  | "write"
  | "invoke"
  | "pair"
  | "revoke"
  | "approve";

export type GovernanceResourceKind =
  | "platform"
  | "tenant"
  | "user"
  | "device"
  | "supervisor-agent"
  | "worker-agent";

export type GovernanceResource = {
  kind: GovernanceResourceKind;
  tenantId?: string;
  ownerUserId?: string;
  deviceId?: string;
  agentId?: string;
};

export type GovernanceSubject = {
  role: GovernanceRole;
  userId?: string;
  tenantId?: string;
  deviceId?: string;
  agentId?: string;
};

const READ_ACTIONS = new Set<GovernanceAction>(["observe", "read"]);

function same(a?: string, b?: string): boolean {
  return Boolean(a && b && a === b);
}

/** Returns whether a subject may perform an action on a resource. */
export function isGovernanceActionAllowed(
  subject: GovernanceSubject,
  action: GovernanceAction,
  resource: GovernanceResource,
): boolean {
  if (subject.role === "platform-super-admin") {
    return true;
  }

  if (subject.role === "platform-admin") {
    // Platform-admin authority is unrestricted for tenant-owned resources.
    // Platform control-plane role grants remain super-admin-only elsewhere.
    return resource.kind !== "platform";
  }

  if (subject.role === "tenant-admin") {
    if (!same(subject.tenantId, resource.tenantId)) {
      return false;
    }
    return resource.kind !== "platform" && action !== "approve";
  }

  if (subject.role === "employee-supervisor") {
    if (!same(subject.userId, resource.ownerUserId)) {
      return false;
    }
    const actionAllowed =
      action === "observe" || action === "read" || action === "write" || action === "invoke";
    return (
      actionAllowed &&
      (resource.kind === "user" ||
        resource.kind === "device" ||
        resource.kind === "supervisor-agent" ||
        resource.kind === "worker-agent")
    );
  }

  // Worker agents are task principals, not administrators. They can inspect
  // and update their own worker resource only; supervisor delegation is the
  // boundary for sibling-agent and device control.
  return same(subject.agentId, resource.agentId) && READ_ACTIONS.has(action);
}

export function governanceRoleForSession(params: {
  platformRole?: "super-admin" | "admin" | null;
  membershipRole?: "enterprise-admin" | "member" | null;
  isSupervisor?: boolean;
}): GovernanceRole | null {
  if (params.platformRole === "super-admin") {
    return "platform-super-admin";
  }
  if (params.platformRole === "admin") {
    return "platform-admin";
  }
  if (params.membershipRole === "enterprise-admin") {
    return "tenant-admin";
  }
  if (params.membershipRole === "member" && params.isSupervisor) {
    return "employee-supervisor";
  }
  if (params.membershipRole === "member") {
    return "worker-agent";
  }
  return null;
}
