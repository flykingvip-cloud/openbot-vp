/**
 * Discuss→task source identity.
 *
 * Distinguishes:
 * - trusted_inbound: authenticated chat inbound message id (clientRunId / MessageSid)
 * - client_idempotency_key: RPC-supplied idempotency key (NOT a trusted inbound)
 *
 * Process-local map is first-write-wins and never overwritten by another principal.
 * Durable ownership lives on task tags (d2tSourceOwner) under the activate lock —
 * this map is only a same-process turn cache, not the authority of record.
 */
export type DiscussToTaskSourceKind = "trusted_inbound" | "client_idempotency_key";

export type DiscussToTaskSourceBinding = {
  sourceMessageId: string;
  tenantId: string;
  groupId: string;
  /** Original principal (inbound user). Immutable once registered. */
  principalActor: string;
  kind: DiscussToTaskSourceKind;
  registeredAtMs: number;
};

const bindings = new Map<string, DiscussToTaskSourceBinding>();

function bindingKey(params: {
  tenantId: string;
  groupId: string;
  sourceMessageId: string;
}): string {
  return `${params.tenantId.trim()}\u0000${params.groupId.trim()}\u0000${params.sourceMessageId.trim()}`;
}

export type SourceBindingRegisterResult =
  | { ok: true; binding: DiscussToTaskSourceBinding; created: boolean }
  | {
      ok: false;
      reason: "source_owner_conflict";
      detail: string;
      binding: DiscussToTaskSourceBinding;
    };

/**
 * Register trusted inbound (chat) or observe an existing binding.
 * Same principal → idempotent. Different principal → conflict (never overwrite).
 */
export function registerDiscussToTaskSourceBinding(params: {
  sourceMessageId: string;
  tenantId: string;
  groupId: string;
  /** @deprecated use principalActor */
  actor?: string;
  principalActor?: string;
  kind?: DiscussToTaskSourceKind;
  nowMs?: number;
}): SourceBindingRegisterResult {
  const now = params.nowMs ?? Date.now();
  const sourceMessageId = params.sourceMessageId.trim();
  const tenantId = params.tenantId.trim();
  const groupId = params.groupId.trim();
  const principalActor = (params.principalActor ?? params.actor ?? "").trim();
  const kind: DiscussToTaskSourceKind = params.kind ?? "trusted_inbound";
  if (!sourceMessageId || !tenantId || !groupId || !principalActor) {
    throw new Error("discuss_to_task_source_binding_incomplete");
  }
  // Client idempotency keys must not be registered as trusted inbound.
  if (kind !== "trusted_inbound") {
    throw new Error("discuss_to_task_source_binding_kind_not_trusted_inbound");
  }
  const key = bindingKey({ tenantId, groupId, sourceMessageId });
  const existing = bindings.get(key);
  if (existing) {
    if (existing.principalActor !== principalActor) {
      return {
        ok: false,
        reason: "source_owner_conflict",
        detail: `sourceMessageId owned by ${existing.principalActor}; cannot reassign to ${principalActor}`,
        binding: existing,
      };
    }
    return { ok: true, binding: existing, created: false };
  }
  const row: DiscussToTaskSourceBinding = {
    sourceMessageId,
    tenantId,
    groupId,
    principalActor,
    kind: "trusted_inbound",
    registeredAtMs: now,
  };
  bindings.set(key, row);
  return { ok: true, binding: row, created: true };
}

export type SourceBindingAssertResult =
  | { ok: true; binding: DiscussToTaskSourceBinding }
  | { ok: false; reason: string; detail?: string };

/**
 * Verify a trusted inbound binding exists for this tenant/group and matches principal.
 * Does not accept client_idempotency_key registrations.
 */
export function assertDiscussToTaskSourceBinding(params: {
  sourceMessageId: string;
  tenantId: string;
  groupId: string;
  /** Principal who must own the source (not the executing bot). */
  principalActor: string;
  /** @deprecated alias for principalActor */
  actor?: string;
  nowMs?: number;
}): SourceBindingAssertResult {
  const principalActor = (params.principalActor ?? params.actor ?? "").trim();
  const key = bindingKey(params);
  const row = bindings.get(key);
  if (!row) {
    return {
      ok: false,
      reason: "source_message_not_bound",
      detail: "sourceMessageId is not a registered trusted inbound for this tenant/group",
    };
  }
  if (row.kind !== "trusted_inbound") {
    return {
      ok: false,
      reason: "source_message_not_trusted_inbound",
      detail: "binding is not a trusted inbound message id",
    };
  }
  if (row.principalActor !== principalActor) {
    return {
      ok: false,
      reason: "source_message_actor_mismatch",
      detail: "sourceMessageId belongs to a different authenticated principal",
    };
  }
  return { ok: true, binding: row };
}

/** Read-only peek (tests / diagnostics). */
export function peekDiscussToTaskSourceBinding(params: {
  sourceMessageId: string;
  tenantId: string;
  groupId: string;
}): DiscussToTaskSourceBinding | null {
  return bindings.get(bindingKey(params)) ?? null;
}

/** Test-only / process-local reset. */
export function clearDiscussToTaskSourceBindingsForTests(): void {
  bindings.clear();
}
