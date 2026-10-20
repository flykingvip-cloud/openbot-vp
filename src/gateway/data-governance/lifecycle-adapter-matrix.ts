/**
 * P2-e lifecycle adapter contracts + authorization matrix.
 *
 * Narrow P2 scope (Gate A8):
 * - conversation_archive: full lifecycle (archive/restore/purge/hold)
 * - memory: forget slice (+ purge/hold matrix)
 * - workspace | agent | knowledge | operational_identity: adapter contract + matrix only
 */

import type { ActorRef, GovernedResourceType, LifecycleCommand } from "./types.js";

export type LifecycleCommandSupport =
  | "full" // implemented end-to-end in P2
  | "matrix" // authorized in matrix; adapter contract only (no full domain bridge yet)
  | "deny"; // not in scope / not allowed

export type LifecycleAdapterContract = {
  resourceType: GovernedResourceType;
  /** Vertical depth for this type in P2. */
  scope: "full" | "forget_slice" | "adapter_contract";
  commands: Record<Exclude<LifecycleCommand, "resumePurge">, LifecycleCommandSupport> & {
    /** Internal worker continue — always matrix-gated, never a new active-op owner. */
    resumePurge: LifecycleCommandSupport;
  };
  purgeDestructive: "filesystem" | "cloud_fail_closed" | "none";
  notes: string;
};

/**
 * Per-type adapter contract matrix (Gate A7/A8).
 * "four types" = workspace, agent, knowledge, operational_identity.
 */
export const LIFECYCLE_ADAPTER_CONTRACTS: Record<GovernedResourceType, LifecycleAdapterContract> = {
  conversation_archive: {
    resourceType: "conversation_archive",
    scope: "full",
    commands: {
      archive: "full",
      restore: "full",
      retire: "matrix",
      applyLegalHold: "full",
      releaseLegalHold: "full",
      requestPurge: "full",
      cancelDeletion: "full",
      forget: "deny",
      resumePurge: "full",
    },
    purgeDestructive: "filesystem",
    notes: "Gate A5 two-phase + P2-d purge closure",
  },
  memory: {
    resourceType: "memory",
    scope: "forget_slice",
    commands: {
      archive: "deny",
      restore: "deny",
      retire: "matrix",
      applyLegalHold: "full",
      releaseLegalHold: "full",
      requestPurge: "matrix",
      cancelDeletion: "matrix",
      forget: "full",
      resumePurge: "matrix",
    },
    purgeDestructive: "filesystem",
    notes: "P2-c forget two-phase; purge uses shared resumePurge + FS adapter",
  },
  workspace: {
    resourceType: "workspace",
    scope: "adapter_contract",
    commands: {
      archive: "matrix",
      restore: "matrix",
      retire: "matrix",
      applyLegalHold: "matrix",
      releaseLegalHold: "matrix",
      requestPurge: "matrix",
      cancelDeletion: "matrix",
      forget: "deny",
      resumePurge: "matrix",
    },
    purgeDestructive: "filesystem",
    notes: "P2-e contract only — no domain bridge in this phase",
  },
  agent: {
    resourceType: "agent",
    scope: "adapter_contract",
    commands: {
      archive: "matrix",
      restore: "matrix",
      retire: "matrix",
      applyLegalHold: "matrix",
      releaseLegalHold: "matrix",
      requestPurge: "matrix",
      cancelDeletion: "matrix",
      forget: "deny",
      resumePurge: "matrix",
    },
    purgeDestructive: "filesystem",
    notes: "P2-e contract only — no domain bridge in this phase",
  },
  knowledge: {
    resourceType: "knowledge",
    scope: "adapter_contract",
    commands: {
      archive: "matrix",
      restore: "matrix",
      retire: "matrix",
      applyLegalHold: "matrix",
      releaseLegalHold: "matrix",
      requestPurge: "matrix",
      cancelDeletion: "matrix",
      forget: "deny",
      resumePurge: "matrix",
    },
    purgeDestructive: "filesystem",
    notes: "P2-e contract only — no domain bridge in this phase",
  },
  operational_identity: {
    resourceType: "operational_identity",
    scope: "adapter_contract",
    commands: {
      archive: "matrix",
      restore: "matrix",
      retire: "matrix",
      applyLegalHold: "matrix",
      releaseLegalHold: "matrix",
      requestPurge: "matrix",
      cancelDeletion: "matrix",
      forget: "deny",
      resumePurge: "matrix",
    },
    purgeDestructive: "filesystem",
    notes: "P2-e contract only — no domain bridge in this phase",
  },
};

/** Owner-class commands (tenant-scoped). */
const OWNER_COMMANDS = new Set<LifecycleCommand>([
  "archive",
  "restore",
  "forget",
  "requestPurge",
  "cancelDeletion",
  "retire",
]);

/** Hold operators (platform / compliance). */
const HOLD_COMMANDS = new Set<LifecycleCommand>(["applyLegalHold", "releaseLegalHold"]);

/** Purge execute / resume (worker / compliance / platform). */
const PURGE_EXECUTE_COMMANDS = new Set<LifecycleCommand>(["resumePurge"]);

export type LifecycleAuthDecision =
  | { ok: true }
  | { ok: false; reason: "command_denied_for_type" | "actor_not_authorized" | "unknown_command" };

/**
 * Gate A7 authorization matrix (shape only — callers still enforce tenant/ownership proofs).
 */
export function authorizeLifecycleCommand(params: {
  resourceType: GovernedResourceType;
  command: LifecycleCommand;
  actor: ActorRef;
}): LifecycleAuthDecision {
  const contract = LIFECYCLE_ADAPTER_CONTRACTS[params.resourceType];
  const support = contract.commands[params.command];
  if (!support || support === "deny") {
    return { ok: false, reason: "command_denied_for_type" };
  }

  const kind = params.actor.kind;
  if (OWNER_COMMANDS.has(params.command)) {
    if (kind === "user" || kind === "system" || kind === "operator") {
      return { ok: true };
    }
    return { ok: false, reason: "actor_not_authorized" };
  }
  if (HOLD_COMMANDS.has(params.command)) {
    if (kind === "operator" || kind === "system") {
      return { ok: true };
    }
    return { ok: false, reason: "actor_not_authorized" };
  }
  if (PURGE_EXECUTE_COMMANDS.has(params.command)) {
    if (kind === "worker" || kind === "operator" || kind === "system") {
      return { ok: true };
    }
    return { ok: false, reason: "actor_not_authorized" };
  }
  return { ok: false, reason: "unknown_command" };
}

/** The four adapter-contract-only types (Gate A8). */
export const P2E_ADAPTER_CONTRACT_TYPES: readonly GovernedResourceType[] = [
  "workspace",
  "agent",
  "knowledge",
  "operational_identity",
] as const;

export function getLifecycleAdapterContract(
  resourceType: GovernedResourceType,
): LifecycleAdapterContract {
  return LIFECYCLE_ADAPTER_CONTRACTS[resourceType];
}
