/**
 * Server-resolved account browser scope for the generic browser tool.
 * Tool arguments never supply this key.
 */

import { deriveAccountBrowserScopeKey } from "../../site-capability/session-handle.js";
import { accountComputerObserverUserId } from "../sandbox/account-scope.js";

export function resolveDefaultAccountBrowserScopeKey(input: {
  accountBrowserScopeKey?: string;
  tenantId?: string;
  userId?: string;
}): string | undefined {
  const explicit = input.accountBrowserScopeKey?.trim();
  if (explicit) {
    return explicit;
  }
  const tenantId = input.tenantId?.trim() ?? "";
  const userId = accountComputerObserverUserId(input.userId) ?? "";
  if (!tenantId || !userId || tenantId.includes(":") || tenantId.includes("/")) {
    return undefined;
  }
  return deriveAccountBrowserScopeKey(tenantId, userId);
}
