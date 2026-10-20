import {
  EVOLUTION_TERMINAL_STATUSES,
  type EvolutionCommand,
  type EvolutionProposalStatus,
  type EvolutionTerminalStatus,
} from "./types.js";

const TERMINAL = new Set<EvolutionProposalStatus>(EVOLUTION_TERMINAL_STATUSES);

export function isEvolutionTerminalStatus(
  status: EvolutionProposalStatus,
): status is EvolutionTerminalStatus {
  return TERMINAL.has(status);
}

type TransitionKey = `${EvolutionProposalStatus}:${EvolutionCommand}`;

const TRANSITIONS: Partial<Record<TransitionKey, EvolutionProposalStatus>> = {
  "DISCOVERED:suggest": "SUGGESTED",
  "DISCOVERED:reject": "REJECTED",
  "DISCOVERED:expire": "EXPIRED",
  "DISCOVERED:revoke": "REVOKED",
  "SUGGESTED:submit": "PENDING_AUTHORITY",
  "SUGGESTED:reject": "REJECTED",
  "SUGGESTED:expire": "EXPIRED",
  "SUGGESTED:revoke": "REVOKED",
  "PENDING_AUTHORITY:authorize": "APPROVED_FOR_EXPERIMENT",
  "PENDING_AUTHORITY:reject": "REJECTED",
  "PENDING_AUTHORITY:expire": "EXPIRED",
  "PENDING_AUTHORITY:revoke": "REVOKED",
  "APPROVED_FOR_EXPERIMENT:start_experiment": "EXPERIMENTING",
  "APPROVED_FOR_EXPERIMENT:reject": "REJECTED",
  "APPROVED_FOR_EXPERIMENT:expire": "EXPIRED",
  "APPROVED_FOR_EXPERIMENT:revoke": "REVOKED",
  "EXPERIMENTING:hold": "HELD",
  "EXPERIMENTING:reject": "REJECTED",
  "EXPERIMENTING:approve_application": "APPROVED_FOR_APPLICATION",
  "EXPERIMENTING:expire": "EXPIRED",
  "HELD:approve_application": "APPROVED_FOR_APPLICATION",
  "HELD:reject": "REJECTED",
  "HELD:expire": "EXPIRED",
  "HELD:start_experiment": "EXPERIMENTING",
  "APPROVED_FOR_APPLICATION:apply_canary": "CANARY",
  "APPROVED_FOR_APPLICATION:activate": "ACTIVE",
  "APPROVED_FOR_APPLICATION:expire": "EXPIRED",
  "APPROVED_FOR_APPLICATION:revoke": "REVOKED",
  "CANARY:activate": "ACTIVE",
  "CANARY:verify": "VERIFIED",
  "CANARY:rollback": "ROLLED_BACK",
  "CANARY:rollback_drill": "EXPERIMENTING",
  "ACTIVE:verify": "VERIFIED",
  "ACTIVE:rollback": "ROLLED_BACK",
  "VERIFIED:promote": "PROMOTED",
  "VERIFIED:rollback": "ROLLED_BACK",
  "PROMOTED:rollback": "ROLLED_BACK",
};

const FORBIDDEN_SHORTCUTS: ReadonlyArray<{
  from: EvolutionProposalStatus;
  command: EvolutionCommand;
  reason: string;
}> = [
  {
    from: "APPROVED_FOR_EXPERIMENT",
    command: "apply_canary",
    reason: "APPROVED_FOR_EXPERIMENT does not grant a real application",
  },
  {
    from: "APPROVED_FOR_EXPERIMENT",
    command: "activate",
    reason: "APPROVED_FOR_EXPERIMENT does not grant a real application",
  },
  {
    from: "APPROVED_FOR_EXPERIMENT",
    command: "verify",
    reason: "verification requires an applied application",
  },
  {
    from: "EXPERIMENTING",
    command: "apply_canary",
    reason: "application requires APPROVED_FOR_APPLICATION",
  },
  {
    from: "EXPERIMENTING",
    command: "activate",
    reason: "application requires APPROVED_FOR_APPLICATION",
  },
  {
    from: "SUGGESTED",
    command: "authorize",
    reason: "authority review must pass PENDING_AUTHORITY",
  },
  {
    from: "ACTIVE",
    command: "promote",
    reason: "ACTIVE is not VERIFIED; promotion requires metric verification",
  },
  {
    from: "CANARY",
    command: "promote",
    reason: "CANARY is not VERIFIED; promotion requires metric verification",
  },
];

export type TransitionResult =
  | { ok: true; next: EvolutionProposalStatus }
  | { ok: false; code: "illegal_transition" | "terminal"; reason: string };

export function transitionEvolutionProposal(
  from: EvolutionProposalStatus,
  command: EvolutionCommand,
): TransitionResult {
  if (isEvolutionTerminalStatus(from) && command !== "rollback") {
    return {
      ok: false,
      code: "terminal",
      reason: `cannot ${command} a terminal ${from} proposal`,
    };
  }
  const forbidden = FORBIDDEN_SHORTCUTS.find((row) => row.from === from && row.command === command);
  if (forbidden) {
    return { ok: false, code: "illegal_transition", reason: forbidden.reason };
  }
  const next = TRANSITIONS[`${from}:${command}`];
  if (!next) {
    return {
      ok: false,
      code: "illegal_transition",
      reason: `cannot ${command} a ${from} proposal`,
    };
  }
  return { ok: true, next };
}

export function assertEvolutionTransition(
  from: EvolutionProposalStatus,
  command: EvolutionCommand,
): EvolutionProposalStatus {
  const result = transitionEvolutionProposal(from, command);
  if (!result.ok) {
    throw new EvolutionStateError(result.code, result.reason);
  }
  return result.next;
}

export class EvolutionStateError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "EvolutionStateError";
    this.code = code;
  }
}

export function listForbiddenShortcuts(): readonly {
  from: EvolutionProposalStatus;
  command: EvolutionCommand;
  reason: string;
}[] {
  return FORBIDDEN_SHORTCUTS;
}
