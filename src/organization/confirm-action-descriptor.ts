/**
 * ConfirmActionDescriptor registry (confirmation-card SPEC §6).
 *
 * New confirmation kinds register here. Tokens never enter model context —
 * callers must keep confirmationToken on the UI / steward path only.
 */

import type { ConsumeConfirmationResult } from "../gateway/server-methods/steward-confirmation-store.js";

export type ConfirmActionUiChrome = "inline_card" | "modal";

export type ConfirmActionPreflightResult =
  | { ok: true }
  | { ok: false; code: string; message: string };

export type ConfirmActionConfirmParams<TEntity> = {
  entity: TEntity;
  proposalId: string;
  confirmationToken: string;
  now?: number;
};

/**
 * Logical descriptor for one confirmation kind.
 * Domain side-effects after a successful consume (e.g. meeting release fan-out)
 * remain at the gateway/tool call site; `onConfirm` covers ticket consume.
 */
export type ConfirmActionDescriptor<TEntity = unknown> = {
  /** Prefix pattern, e.g. `meeting.approve:` (entity id appended). */
  actionIdPattern: string;
  buildActionId: (entityId: string) => string;
  buildPayload: (entity: TEntity) => Record<string, unknown>;
  preflight?: (entity: TEntity) => ConfirmActionPreflightResult;
  consequenceHint?: (entity: TEntity) => string | undefined;
  irreversible: boolean | ((entity: TEntity) => boolean);
  onConfirm?: (params: ConfirmActionConfirmParams<TEntity>) => ConsumeConfirmationResult;
  /** Cancel / dismiss — typically invalidate unused steward tickets. */
  onCancel?: (entityId: string) => number;
  uiChrome: ConfirmActionUiChrome;
};

const registry = new Map<string, ConfirmActionDescriptor>();

export function registerConfirmAction<TEntity>(
  descriptor: ConfirmActionDescriptor<TEntity>,
): ConfirmActionDescriptor<TEntity> {
  const pattern = descriptor.actionIdPattern.trim();
  if (!pattern) {
    throw new Error("ConfirmActionDescriptor.actionIdPattern is required");
  }
  registry.set(pattern, descriptor as ConfirmActionDescriptor);
  return descriptor;
}

/** Lookup by full actionId (`meeting.approve:m1`) or by pattern key. */
export function lookupConfirmAction(
  actionIdOrPattern: string,
): ConfirmActionDescriptor | undefined {
  const raw = actionIdOrPattern.trim();
  if (!raw) {
    return undefined;
  }
  const exact = registry.get(raw);
  if (exact) {
    return exact;
  }
  for (const [pattern, descriptor] of registry) {
    if (raw.startsWith(pattern)) {
      return descriptor;
    }
  }
  return undefined;
}

export function listConfirmActions(): ConfirmActionDescriptor[] {
  return [...registry.values()];
}

/** Test helper: drop all registrations. */
export function __clearConfirmActionRegistryForTest(): void {
  registry.clear();
}

export function resolveConfirmIrreversible<TEntity>(
  descriptor: ConfirmActionDescriptor<TEntity>,
  entity: TEntity,
): boolean {
  return typeof descriptor.irreversible === "function"
    ? descriptor.irreversible(entity)
    : descriptor.irreversible;
}
