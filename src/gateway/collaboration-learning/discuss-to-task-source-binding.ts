/**
 * Authenticated inbound → discuss-to-task sourceMessageId binding.
 * Model/tool args must not invent or borrow another actor's message identity.
 */
export type DiscussToTaskSourceBinding = {
  sourceMessageId: string;
  tenantId: string;
  groupId: string;
  actor: string;
  registeredAtMs: number;
  expiresAtMs: number;
};

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;
const bindings = new Map<string, DiscussToTaskSourceBinding>();

function bindingKey(params: {
  tenantId: string;
  groupId: string;
  sourceMessageId: string;
}): string {
  return `${params.tenantId.trim()}\u0000${params.groupId.trim()}\u0000${params.sourceMessageId.trim()}`;
}

export function registerDiscussToTaskSourceBinding(params: {
  sourceMessageId: string;
  tenantId: string;
  groupId: string;
  actor: string;
  nowMs?: number;
  ttlMs?: number;
}): DiscussToTaskSourceBinding {
  const now = params.nowMs ?? Date.now();
  const sourceMessageId = params.sourceMessageId.trim();
  const tenantId = params.tenantId.trim();
  const groupId = params.groupId.trim();
  const actor = params.actor.trim();
  if (!sourceMessageId || !tenantId || !groupId || !actor) {
    throw new Error("discuss_to_task_source_binding_incomplete");
  }
  const row: DiscussToTaskSourceBinding = {
    sourceMessageId,
    tenantId,
    groupId,
    actor,
    registeredAtMs: now,
    expiresAtMs: now + Math.max(60_000, params.ttlMs ?? DEFAULT_TTL_MS),
  };
  bindings.set(bindingKey(row), row);
  return row;
}

export type SourceBindingAssertResult =
  | { ok: true; binding: DiscussToTaskSourceBinding }
  | { ok: false; reason: string; detail?: string };

/** Verify sourceMessageId was registered for this tenant/group and matches actor namespace. */
export function assertDiscussToTaskSourceBinding(params: {
  sourceMessageId: string;
  tenantId: string;
  groupId: string;
  actor: string;
  nowMs?: number;
}): SourceBindingAssertResult {
  const now = params.nowMs ?? Date.now();
  const key = bindingKey(params);
  const row = bindings.get(key);
  if (!row) {
    return {
      ok: false,
      reason: "source_message_not_bound",
      detail: "sourceMessageId is not a registered authenticated inbound for this tenant/group",
    };
  }
  if (row.expiresAtMs < now) {
    bindings.delete(key);
    return { ok: false, reason: "source_message_binding_expired" };
  }
  if (row.actor !== params.actor.trim()) {
    return {
      ok: false,
      reason: "source_message_actor_mismatch",
      detail: "sourceMessageId belongs to a different authenticated actor",
    };
  }
  return { ok: true, binding: row };
}

/** Test-only / process-local reset. */
export function clearDiscussToTaskSourceBindingsForTests(): void {
  bindings.clear();
}
