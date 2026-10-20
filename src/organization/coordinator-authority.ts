import type { RuntimeOrganizationContext } from "./runtime.js";

export type CoordinatorAuthority = {
  isOrganizationSession: boolean;
  isCoordinator: boolean;
  coordinatorAgentId?: string;
  coordinatorDisplayName?: string;
  shouldAvoidDirectUserCoordination: boolean;
};

export function resolveCoordinatorAuthority(
  organizationContext: RuntimeOrganizationContext | undefined,
): CoordinatorAuthority {
  const coordinator = organizationContext?.coordinator;
  const self = organizationContext?.self;
  const isOrganizationSession = Boolean(organizationContext?.organization && self);
  const isCoordinator = Boolean(coordinator && self && coordinator.agentId === self.agentId);
  return {
    isOrganizationSession,
    isCoordinator,
    ...(coordinator ? { coordinatorAgentId: coordinator.agentId } : {}),
    ...(coordinator ? { coordinatorDisplayName: coordinator.displayName } : {}),
    shouldAvoidDirectUserCoordination:
      isOrganizationSession && Boolean(coordinator) && !isCoordinator,
  };
}

export function buildCoordinatorAuthorityPrompt(
  organizationContext: RuntimeOrganizationContext | undefined,
  /** // v1-only — P0.2 ledger roster lines (fail-closed when unread). */
  v1RollCallRosterLines?: string[],
): string[] {
  const authority = resolveCoordinatorAuthority(organizationContext);
  const rosterLines =
    v1RollCallRosterLines && v1RollCallRosterLines.length > 0 ? [...v1RollCallRosterLines] : [];
  if (!authority.shouldAvoidDirectUserCoordination && rosterLines.length === 0) {
    return [];
  }
  const lines: string[] = [];
  if (authority.shouldAvoidDirectUserCoordination) {
    const coordinatorLabel = authority.coordinatorDisplayName
      ? `${authority.coordinatorDisplayName} (${authority.coordinatorAgentId})`
      : authority.coordinatorAgentId;
    lines.push(
      "Coordinator Authority:",
      `- User-visible group coordination belongs to ${coordinatorLabel}.`,
      "- Do not claim you assigned work, contacted members, or received confirmations unless a runtime task/message call succeeded.",
      "- For project-wide task allocation or membership questions, reply as a non-coordinator status contributor or route the work to the coordinator with the available inter-agent tools.",
    );
  }
  if (rosterLines.length > 0) {
    lines.push("Roll-call roster (ledger-backed):", ...rosterLines);
  }
  return lines;
}
