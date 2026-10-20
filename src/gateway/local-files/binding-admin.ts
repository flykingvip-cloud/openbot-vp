/**
 * Creating and revoking a `LocalDeviceBinding`.
 *
 * ## Why this is a separate action rather than part of pairing approval
 *
 * Design section 3 states plainly that today's pairing proves only "this node
 * connected to this gateway" — it does not prove tenant, user, digital human or
 * session. That is the entire reason `LocalDeviceBinding` exists as its own
 * authority (design 4.3). Folding binding creation into pairing approval would
 * recreate exactly the conflation the design rejects: anyone who can approve a
 * device pairing would silently also grant read access to that person's disk.
 *
 * So binding is an explicit, separate grant.
 *
 * ## Why the ceremony has this shape
 *
 * The dangerous field is `devicePublicKey`: it is what ties the grant to one
 * physical machine. It is therefore NOT an input. It is read from the live,
 * already-authenticated node connection, because a human transcribing a key is both
 * error-prone and an opportunity to substitute a different device.
 *
 * Three further refusals, each closing a specific mistake:
 * - the node must currently be connected, so the key is observed rather than asserted
 * - its declared command set must equal the read-only profile exactly, so a
 *   general-purpose shell node cannot be bound by accident
 * - an existing active binding must be revoked first, so a binding cannot be
 *   silently re-pointed at a different user
 */

import { checkProfileCommandSet } from "../../local-files/capability-profile.js";
import type { LocalDeviceBindingStore } from "../../local-files/device-binding.js";
import { LOCAL_FILES_CAP } from "../../local-files/events.js";
import { LOCAL_FILES_READONLY_PROFILE, type LocalDeviceBinding } from "../../local-files/types.js";

/** The subset of a live node session this ceremony needs. */
export type BindableNodeSession = {
  nodeId: string;
  caps: string[];
  commands: string[];
  displayName?: string;
  /** Key verified for the live connection, not the pairing record. */
  devicePublicKey?: string;
};

export type BindingNodeLookup = {
  get(nodeId: string): BindableNodeSession | undefined;
};

export type CreateBindingFailure =
  | "node-not-connected"
  | "node-not-local-files-profile"
  | "node-command-set-mismatch"
  | "node-connection-has-no-device-key"
  | "binding-already-active"
  | "invalid-tenant"
  | "invalid-user"
  | "no-allowed-agents";

export type CreateBindingResult =
  | { ok: true; binding: LocalDeviceBinding }
  | { ok: false; reason: CreateBindingFailure; detail?: string };

function normalized(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function createLocalDeviceBinding(params: {
  nodeId: string;
  tenantId: string;
  userId: string;
  allowedAgentIds: readonly string[];
  bindings: LocalDeviceBindingStore;
  nodes: BindingNodeLookup;
  nowMs?: number;
}): Promise<CreateBindingResult> {
  const nodeId = normalized(params.nodeId);
  const tenantId = normalized(params.tenantId);
  const userId = normalized(params.userId);
  const allowedAgentIds = [
    ...new Set(params.allowedAgentIds.map(normalized).filter(Boolean)),
  ].toSorted();

  if (!tenantId) {
    return { ok: false, reason: "invalid-tenant" };
  }
  if (!userId) {
    return { ok: false, reason: "invalid-user" };
  }
  if (allowedAgentIds.length === 0) {
    // An empty list would authorize nothing, but silently creating a useless
    // binding hides the mistake; refuse so the operator names the digital humans.
    return { ok: false, reason: "no-allowed-agents" };
  }

  const session = params.nodes.get(nodeId);
  if (!session) {
    return { ok: false, reason: "node-not-connected" };
  }
  if (!session.caps.includes(LOCAL_FILES_CAP)) {
    return { ok: false, reason: "node-not-local-files-profile" };
  }
  const commandCheck = checkProfileCommandSet(session.commands);
  if (!commandCheck.ok) {
    return {
      ok: false,
      reason: "node-command-set-mismatch",
      detail: `extra=[${commandCheck.extra.join(",")}] missing=[${commandCheck.missing.join(",")}]`,
    };
  }
  const devicePublicKey = normalized(session.devicePublicKey);
  if (!devicePublicKey) {
    // Token-authenticated connections never proved key possession; there is no key
    // to bind to.
    return { ok: false, reason: "node-connection-has-no-device-key" };
  }

  const existing = params.bindings.get(nodeId);
  if (existing && existing.status === "active") {
    return { ok: false, reason: "binding-already-active" };
  }

  const binding: LocalDeviceBinding = {
    tenantId,
    userId,
    nodeId,
    devicePublicKey,
    allowedAgentIds,
    capabilityProfile: LOCAL_FILES_READONLY_PROFILE,
    status: "active",
    createdAtMs: params.nowMs ?? Date.now(),
  };
  await params.bindings.putPersisted(binding);
  return { ok: true, binding };
}

export async function revokeLocalDeviceBinding(params: {
  nodeId: string;
  bindings: LocalDeviceBindingStore;
  nowMs?: number;
}): Promise<{ ok: boolean; reason?: "not-bound-or-already-revoked" }> {
  const revoked = await params.bindings.revokePersisted(
    normalized(params.nodeId),
    params.nowMs ?? Date.now(),
  );
  return revoked ? { ok: true } : { ok: false, reason: "not-bound-or-already-revoked" };
}

/**
 * Operator-visible view of a binding.
 *
 * The device public key is reduced to a short fingerprint: an operator needs to
 * tell two devices apart, not to copy the key anywhere.
 */
export type BindingSummary = {
  nodeId: string;
  tenantId: string;
  userId: string;
  allowedAgentIds: string[];
  status: "active" | "revoked";
  createdAtMs: number;
  revokedAtMs?: number;
  devicePublicKeyFingerprint: string;
};

export function summarizeBinding(binding: LocalDeviceBinding): BindingSummary {
  const summary: BindingSummary = {
    nodeId: binding.nodeId,
    tenantId: binding.tenantId,
    userId: binding.userId,
    allowedAgentIds: [...binding.allowedAgentIds],
    status: binding.status,
    createdAtMs: binding.createdAtMs,
    devicePublicKeyFingerprint: `${binding.devicePublicKey.slice(0, 8)}…${binding.devicePublicKey.slice(-4)}`,
  };
  if (binding.revokedAtMs !== undefined) {
    summary.revokedAtMs = binding.revokedAtMs;
  }
  return summary;
}
