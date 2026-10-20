/**
 * Interaction Ownership Coordinator (ROADMAP v3 M4 first slice).
 *
 * Coordinates who may drive keyboard / mouse / clipboard / navigation on the
 * #423 shared Account Computer (one user desktop, multi agent + human).
 * This is a coordination layer — not greenfield multi-session.
 *
 * Lease path:
 *   BACKGROUND_AGENT → LEASE_REQUEST → INTERACTIVE
 *                    → HUMAN_TAKEOVER → GRACE → BACKGROUND_AGENT
 *
 * Clipboard *sync* stays deferred; clipboard *ownership* is modeled as a flag.
 * Human takeover always preempts an agent interactive lease.
 */

export const INTERACTION_OWNERSHIP_COORDINATOR_LANDING =
  "INTERACTION_OWNERSHIP_COORDINATOR_M1" as const;

/** Default grace window after human hand-back before BACKGROUND_AGENT. */
export const DEFAULT_OWNERSHIP_GRACE_MS = 1_500;

export type InteractionLeasePhase =
  | "BACKGROUND_AGENT"
  | "LEASE_REQUEST"
  | "INTERACTIVE"
  | "HUMAN_TAKEOVER"
  | "GRACE";

/** Who currently owns a capability channel. */
export type CapabilityOwnerKind = "none" | "agent" | "human";

/**
 * Per-channel ownership. Clipboard is an ownership flag only —
 * bidirectional sync is explicitly out of scope for this landing.
 */
export type CapabilityOwners = {
  keyboard: CapabilityOwnerKind;
  mouse: CapabilityOwnerKind;
  clipboard: CapabilityOwnerKind;
  navigation: CapabilityOwnerKind;
};

export type InteractionOwnershipSnapshot = {
  phase: InteractionLeasePhase;
  /** Agent holding or last associated with the desktop lease. */
  holderAgentId: string | null;
  /** Agent waiting for an interactive lease grant. */
  pendingAgentId: string | null;
  /** Human chat session that preempted / holds takeover. */
  humanSessionKey: string | null;
  owners: CapabilityOwners;
  leaseGeneration: number;
  /** Wall-clock ms when GRACE ends; null outside GRACE. */
  graceUntilMs: number | null;
};

export type InteractionOwnershipEvent =
  | { type: "AGENT_LEASE_REQUEST"; agentId: string }
  | { type: "AGENT_LEASE_GRANT" }
  | { type: "AGENT_LEASE_DENY" }
  | { type: "AGENT_RELEASE" }
  | { type: "HUMAN_TAKEOVER"; sessionKey: string }
  | { type: "HUMAN_HAND_BACK"; graceMs?: number }
  | { type: "GRACE_ELAPSE" }
  | { type: "RESET" };

const NONE_OWNERS: CapabilityOwners = {
  keyboard: "none",
  mouse: "none",
  clipboard: "none",
  navigation: "none",
};

function agentOwners(): CapabilityOwners {
  return {
    keyboard: "agent",
    mouse: "agent",
    clipboard: "agent",
    navigation: "agent",
  };
}

function humanOwners(): CapabilityOwners {
  return {
    keyboard: "human",
    mouse: "human",
    clipboard: "human",
    navigation: "human",
  };
}

/** Background: agent may navigate via tools; no exclusive interactive input. */
function backgroundOwners(hasAgent: boolean): CapabilityOwners {
  return {
    keyboard: "none",
    mouse: "none",
    clipboard: "none",
    navigation: hasAgent ? "agent" : "none",
  };
}

export function createInteractionOwnershipSnapshot(): InteractionOwnershipSnapshot {
  return {
    phase: "BACKGROUND_AGENT",
    holderAgentId: null,
    pendingAgentId: null,
    humanSessionKey: null,
    owners: { ...NONE_OWNERS },
    leaseGeneration: 0,
    graceUntilMs: null,
  };
}

function ownersForPhase(
  phase: InteractionLeasePhase,
  holderAgentId: string | null,
): CapabilityOwners {
  switch (phase) {
    case "INTERACTIVE":
      return agentOwners();
    case "HUMAN_TAKEOVER":
      return humanOwners();
    case "LEASE_REQUEST":
    case "GRACE":
      return { ...NONE_OWNERS, navigation: holderAgentId ? "agent" : "none" };
    case "BACKGROUND_AGENT":
    default:
      return backgroundOwners(Boolean(holderAgentId));
  }
}

/**
 * Pure lease transition. Human takeover preempts agent INTERACTIVE / LEASE_REQUEST.
 */
export function reduceInteractionOwnership(
  prev: InteractionOwnershipSnapshot,
  event: InteractionOwnershipEvent,
  now: number = Date.now(),
): InteractionOwnershipSnapshot {
  if (event.type === "RESET") {
    return createInteractionOwnershipSnapshot();
  }

  switch (event.type) {
    case "AGENT_LEASE_REQUEST": {
      const agentId = event.agentId.trim();
      if (!agentId) {
        return prev;
      }
      // Human holds the desk — queue as pending only; do not steal.
      if (prev.phase === "HUMAN_TAKEOVER") {
        return {
          ...prev,
          pendingAgentId: agentId,
          holderAgentId: prev.holderAgentId ?? agentId,
        };
      }
      // Already interactive for this agent — idempotent.
      if (prev.phase === "INTERACTIVE" && prev.holderAgentId === agentId) {
        return prev;
      }
      // Another agent holds INTERACTIVE — pending only (no steal in v1).
      if (prev.phase === "INTERACTIVE" && prev.holderAgentId && prev.holderAgentId !== agentId) {
        return {
          ...prev,
          pendingAgentId: agentId,
        };
      }
      return {
        ...prev,
        phase: "LEASE_REQUEST",
        pendingAgentId: agentId,
        holderAgentId: agentId,
        humanSessionKey: null,
        graceUntilMs: null,
        owners: ownersForPhase("LEASE_REQUEST", agentId),
      };
    }

    case "AGENT_LEASE_GRANT": {
      if (prev.phase === "HUMAN_TAKEOVER") {
        // Never grant over human.
        return prev;
      }
      const agentId = prev.pendingAgentId ?? prev.holderAgentId;
      if (!agentId) {
        return prev;
      }
      return {
        ...prev,
        phase: "INTERACTIVE",
        holderAgentId: agentId,
        pendingAgentId: null,
        humanSessionKey: null,
        graceUntilMs: null,
        leaseGeneration: prev.leaseGeneration + 1,
        owners: agentOwners(),
      };
    }

    case "AGENT_LEASE_DENY": {
      if (prev.phase !== "LEASE_REQUEST") {
        return { ...prev, pendingAgentId: null };
      }
      return {
        ...prev,
        phase: "BACKGROUND_AGENT",
        pendingAgentId: null,
        graceUntilMs: null,
        owners: backgroundOwners(Boolean(prev.holderAgentId)),
      };
    }

    case "AGENT_RELEASE": {
      if (prev.phase === "HUMAN_TAKEOVER") {
        return {
          ...prev,
          holderAgentId: null,
          pendingAgentId: null,
        };
      }
      return {
        ...createInteractionOwnershipSnapshot(),
        leaseGeneration: prev.leaseGeneration,
      };
    }

    case "HUMAN_TAKEOVER": {
      const sessionKey = event.sessionKey.trim();
      if (!sessionKey) {
        return prev;
      }
      return {
        ...prev,
        phase: "HUMAN_TAKEOVER",
        humanSessionKey: sessionKey,
        // Keep holderAgentId for observability; clear pending grant.
        pendingAgentId: null,
        graceUntilMs: null,
        leaseGeneration: prev.leaseGeneration + 1,
        owners: humanOwners(),
      };
    }

    case "HUMAN_HAND_BACK": {
      if (prev.phase !== "HUMAN_TAKEOVER") {
        return prev;
      }
      const graceMs = event.graceMs ?? DEFAULT_OWNERSHIP_GRACE_MS;
      return {
        ...prev,
        phase: "GRACE",
        humanSessionKey: null,
        pendingAgentId: null,
        graceUntilMs: now + graceMs,
        owners: ownersForPhase("GRACE", prev.holderAgentId),
      };
    }

    case "GRACE_ELAPSE": {
      if (prev.phase !== "GRACE") {
        return prev;
      }
      return {
        ...prev,
        phase: "BACKGROUND_AGENT",
        humanSessionKey: null,
        pendingAgentId: null,
        graceUntilMs: null,
        owners: backgroundOwners(Boolean(prev.holderAgentId)),
      };
    }

    default:
      return prev;
  }
}

/** True when a human session may drive keyboard/mouse into the desktop. */
export function canHumanDriveInput(
  snapshot: InteractionOwnershipSnapshot | null | undefined,
  sessionKey: string | null | undefined,
): boolean {
  if (!snapshot || snapshot.phase !== "HUMAN_TAKEOVER") {
    return false;
  }
  const key = sessionKey?.trim() ?? "";
  if (!key || snapshot.humanSessionKey !== key) {
    return false;
  }
  return snapshot.owners.keyboard === "human" && snapshot.owners.mouse === "human";
}

/** True when the named agent holds the interactive lease (tools may drive). */
export function canAgentDriveInput(
  snapshot: InteractionOwnershipSnapshot | null | undefined,
  agentId: string | null | undefined,
): boolean {
  if (!snapshot || snapshot.phase !== "INTERACTIVE") {
    return false;
  }
  const id = agentId?.trim() ?? "";
  if (!id || snapshot.holderAgentId !== id) {
    return false;
  }
  return snapshot.owners.keyboard === "agent" && snapshot.owners.mouse === "agent";
}

/** Human always preempts; used by callers before grant. */
export function humanPreemptsAgent(snapshot: InteractionOwnershipSnapshot): boolean {
  return snapshot.phase === "HUMAN_TAKEOVER";
}

/**
 * Advance GRACE → BACKGROUND_AGENT when wall clock passed graceUntilMs.
 * No-op outside GRACE or before deadline.
 */
export function tickInteractionOwnershipGrace(
  snapshot: InteractionOwnershipSnapshot,
  now: number = Date.now(),
): InteractionOwnershipSnapshot {
  if (snapshot.phase !== "GRACE" || snapshot.graceUntilMs == null) {
    return snapshot;
  }
  if (now < snapshot.graceUntilMs) {
    return snapshot;
  }
  return reduceInteractionOwnership(snapshot, { type: "GRACE_ELAPSE" }, now);
}

/** Observability attributes for accept / DOM. */
export function ownershipDataAttrs(snapshot: InteractionOwnershipSnapshot): {
  "data-ownership-phase": InteractionLeasePhase;
  "data-ownership-keyboard": CapabilityOwnerKind;
  "data-ownership-mouse": CapabilityOwnerKind;
  "data-ownership-clipboard": CapabilityOwnerKind;
  "data-ownership-navigation": CapabilityOwnerKind;
  "data-ownership-agent": string;
  "data-ownership-human": string;
} {
  return {
    "data-ownership-phase": snapshot.phase,
    "data-ownership-keyboard": snapshot.owners.keyboard,
    "data-ownership-mouse": snapshot.owners.mouse,
    "data-ownership-clipboard": snapshot.owners.clipboard,
    "data-ownership-navigation": snapshot.owners.navigation,
    "data-ownership-agent": snapshot.holderAgentId ?? "",
    "data-ownership-human": snapshot.humanSessionKey ?? "",
  };
}

/**
 * Per-account ownership store (one shared desktop per user — #423).
 * UI preview and input gating consult this store.
 */
const ownershipByAccount = new Map<string, InteractionOwnershipSnapshot>();

export function getInteractionOwnership(accountKey: string): InteractionOwnershipSnapshot {
  const key = accountKey.trim();
  if (!key) {
    return createInteractionOwnershipSnapshot();
  }
  const existing = ownershipByAccount.get(key);
  if (existing) {
    return existing;
  }
  const created = createInteractionOwnershipSnapshot();
  ownershipByAccount.set(key, created);
  return created;
}

export function dispatchInteractionOwnership(
  accountKey: string,
  event: InteractionOwnershipEvent,
  now: number = Date.now(),
): InteractionOwnershipSnapshot {
  const key = accountKey.trim() || "\0pending";
  const prev = ownershipByAccount.get(key) ?? createInteractionOwnershipSnapshot();
  const next = reduceInteractionOwnership(prev, event, now);
  ownershipByAccount.set(key, next);
  return next;
}

/**
 * Merge ownership when remapping account keys (pending → real, or adoptComputerAccount).
 * Iron rule: human wins — if either side is HUMAN_TAKEOVER, that snapshot is kept.
 * Never discard a pending HUMAN lease because the destination already has an agent lease.
 */
export function mergeInteractionOwnershipOnMove(
  source: InteractionOwnershipSnapshot,
  dest: InteractionOwnershipSnapshot | undefined,
): InteractionOwnershipSnapshot {
  if (source.phase === "HUMAN_TAKEOVER") {
    return source;
  }
  if (dest?.phase === "HUMAN_TAKEOVER") {
    return dest;
  }
  // No exclusive human: empty / background dest takes source; otherwise keep non-background dest
  // only when source is still BACKGROUND (nothing meaningful to migrate).
  if (!dest || dest.phase === "BACKGROUND_AGENT") {
    return source;
  }
  if (source.phase === "BACKGROUND_AGENT") {
    return dest;
  }
  // Both agent-side (LEASE_REQUEST / INTERACTIVE / GRACE): prefer the migrating source.
  return source;
}

/** Move ownership state when a pending account key is bound to a real user desktop. */
export function moveInteractionOwnership(
  fromKey: string,
  toKey: string,
): InteractionOwnershipSnapshot {
  const from = fromKey === "" ? " pending" : fromKey;
  const to = toKey.trim();
  if (!to || from === to) {
    return getInteractionOwnership(to || from);
  }
  const source = ownershipByAccount.get(from);
  const dest = ownershipByAccount.get(to);
  if (!source) {
    return dest ?? getInteractionOwnership(to);
  }
  ownershipByAccount.delete(from);
  const merged = mergeInteractionOwnershipOnMove(source, dest);
  ownershipByAccount.set(to, merged);
  return merged;
}

export function resetInteractionOwnershipForTests(): void {
  ownershipByAccount.clear();
}
