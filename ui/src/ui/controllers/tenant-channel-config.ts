import type { GatewayBrowserClient } from "../gateway.ts";
import { cloneConfigObject, serializeConfigForm, setPathValue } from "./config/form-utils.ts";
import {
  clearTenantImProbeState,
  describeTenantImCredentialGaps,
  isEnterpriseImChannelId,
  type TenantImBindingProbeState,
} from "./tenant-im-binding.ts";

/**
 * Tenant-scoped channel config controller (ops-decommission Phase 3.2).
 *
 * Reads/writes a tenant's config subtree via `config.get`/`config.set` with a
 * `tenantId` (the gateway resolves the trusted tenant and routes to the tenant
 * override store — see ops-decommission 2.1/2.2). Kept independent from the
 * global config controller so the enterprise channel page has its own form state
 * and never touches the platform-global config.
 *
 * The tenant `config.get`/`config.set` responses are `{ config, hash, tenantId }`.
 */

type TenantConfigResponse = {
  config?: Record<string, unknown> | null;
  hash?: string | null;
  tenantId?: string | null;
};

export type TenantChannelConfigState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  /** The tenant whose config is currently loaded (null = none). */
  tenantConfigTenantId: string | null;
  tenantConfigForm: Record<string, unknown> | null;
  tenantConfigBaseHash: string | null;
  tenantConfigLoading: boolean;
  tenantConfigSaving: boolean;
  tenantConfigDirty: boolean;
  /** Tenant channel credential load/save failure. Not host.lastError. */
  tenantConfigError: string | null;
} & Partial<TenantImBindingProbeState>;

export async function loadTenantConfig(
  state: TenantChannelConfigState,
  tenantId: string,
): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  const trimmed = tenantId.trim();
  if (!trimmed) {
    return;
  }
  state.tenantConfigLoading = true;
  state.tenantConfigError = null;
  clearTenantImProbeState(state);
  try {
    const res = await state.client.request<TenantConfigResponse>("config.get", {
      tenantId: trimmed,
    });
    state.tenantConfigTenantId = trimmed;
    state.tenantConfigForm = res.config ? cloneConfigObject(res.config) : {};
    state.tenantConfigBaseHash = res.hash ?? null;
    state.tenantConfigDirty = false;
  } catch (err) {
    state.tenantConfigError = String(err);
  } finally {
    state.tenantConfigLoading = false;
  }
}

/** Patch a value at a config path in the tenant form (marks the form dirty). */
export function patchTenantConfigValue(
  state: TenantChannelConfigState,
  path: Array<string | number>,
  value: unknown,
): void {
  const base = cloneConfigObject(state.tenantConfigForm ?? {});
  setPathValue(base, path, value);
  state.tenantConfigForm = base;
  state.tenantConfigDirty = true;
  // Editing returns to the config flow; clear prior test results so failures
  // only appear from an explicit save/test action.
  clearTenantImProbeState(state);
}

/** Ensure wecom/feishu accounts have account-scoped webhook paths for multi-tenant isolation. */
export function ensureImAccountWebhookPaths(
  form: Record<string, unknown> | null,
): Record<string, unknown> {
  const root = cloneConfigObject(form ?? {});
  const channels = root.channels;
  if (!channels || typeof channels !== "object" || Array.isArray(channels)) {
    return root;
  }
  const channelMap = channels as Record<string, unknown>;
  for (const channelId of ["wecom", "feishu", "dingtalk"] as const) {
    const ch = channelMap[channelId];
    if (!ch || typeof ch !== "object" || Array.isArray(ch)) {
      continue;
    }
    const chObj = ch as Record<string, unknown>;
    const accounts = chObj.accounts;
    if (!accounts || typeof accounts !== "object" || Array.isArray(accounts)) {
      continue;
    }
    const accountMap = accounts as Record<string, unknown>;
    for (const [accountId, raw] of Object.entries(accountMap)) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        continue;
      }
      const acct = raw as Record<string, unknown>;
      const path = typeof acct.webhookPath === "string" ? acct.webhookPath.trim() : "";
      const prefix =
        channelId === "wecom" ? "wecom" : channelId === "feishu" ? "feishu" : "dingtalk";
      const accountScoped = `/${prefix}/a/${encodeURIComponent(accountId)}`;
      // Empty or legacy shared defaults ("/wecom") collide across accounts — normalize.
      if (!path || path === `/${prefix}`) {
        acct.webhookPath = accountScoped;
      }
    }
  }
  return root;
}

export async function saveTenantConfig(
  state: TenantChannelConfigState,
  tenantId: string,
  options?: { validateChannelId?: string | null },
): Promise<boolean> {
  if (!state.client || !state.connected) {
    return false;
  }
  const trimmed = tenantId.trim();
  if (!trimmed) {
    return false;
  }
  if (!state.tenantConfigBaseHash) {
    state.tenantConfigError = "tenant config base hash missing; reload and retry";
    return false;
  }
  const validateChannelId = options?.validateChannelId?.trim() || null;
  if (validateChannelId && isEnterpriseImChannelId(validateChannelId)) {
    const form = ensureImAccountWebhookPaths(state.tenantConfigForm);
    state.tenantConfigForm = form;
    const gap = describeTenantImCredentialGaps(form, validateChannelId);
    if (gap) {
      state.tenantConfigError = `保存未通过：${gap}`;
      clearTenantImProbeState(state);
      return false;
    }
  }
  state.tenantConfigSaving = true;
  state.tenantConfigError = null;
  try {
    const form = ensureImAccountWebhookPaths(state.tenantConfigForm);
    state.tenantConfigForm = form;
    const raw = serializeConfigForm(form);
    await state.client.request("config.set", {
      raw,
      baseHash: state.tenantConfigBaseHash,
      tenantId: trimmed,
    });
    state.tenantConfigDirty = false;
    await loadTenantConfig(state, trimmed);
    return true;
  } catch (err) {
    state.tenantConfigError = String(err);
    return false;
  } finally {
    state.tenantConfigSaving = false;
  }
}
