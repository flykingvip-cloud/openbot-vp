import type { OpenBotApp } from "./app.ts";
import { channelsCapability } from "./capability/channels/index.ts";
import { configCapability } from "./capability/config/index.ts";
import {
  adaptChannelsLoadCapabilityState,
  adaptChannelsWhatsAppAuthCapabilityState,
  adaptConfigLoadCapabilityState,
  adaptConfigSaveCapabilityState,
} from "./capability/view-state.ts";
import { detachChannelConfigFault } from "./channel-fault-scope.ts";
import type { NostrProfile } from "./types.ts";
import { createNostrProfileFormState } from "./views/channels.nostr-profile-form.ts";

export async function handleWhatsAppStart(host: OpenBotApp, force: boolean) {
  await channelsCapability.startWhatsAppLogin(
    adaptChannelsWhatsAppAuthCapabilityState(host),
    force,
  );
  await channelsCapability.load(adaptChannelsLoadCapabilityState(host), true);
}

export async function handleWhatsAppWait(host: OpenBotApp) {
  await channelsCapability.waitWhatsAppLogin(adaptChannelsWhatsAppAuthCapabilityState(host));
  await channelsCapability.load(adaptChannelsLoadCapabilityState(host), true);
}

export async function handleWhatsAppLogout(host: OpenBotApp) {
  await channelsCapability.logoutWhatsApp(adaptChannelsWhatsAppAuthCapabilityState(host));
  await channelsCapability.load(adaptChannelsLoadCapabilityState(host), true);
}

function restoreHostErrorAfterChannelConfig(host: OpenBotApp, priorHostError: string | null) {
  const detached = detachChannelConfigFault({
    priorHostError,
    nextHostError: host.lastError,
  });
  host.lastError = detached.hostError;
  return detached.channelFault;
}

export async function handleChannelConfigSave(host: OpenBotApp) {
  const priorHostError = host.lastError;
  await configCapability.save(adaptConfigSaveCapabilityState(host));
  const saveFault = restoreHostErrorAfterChannelConfig(host, priorHostError);
  await configCapability.load(adaptConfigLoadCapabilityState(host));
  const reloadFault = restoreHostErrorAfterChannelConfig(host, priorHostError);
  await channelsCapability.load(adaptChannelsLoadCapabilityState(host), true);
  const channelFault = saveFault ?? reloadFault;
  if (channelFault) {
    host.channelsError = channelFault;
  }
}

export async function handleChannelConfigReload(host: OpenBotApp) {
  const priorHostError = host.lastError;
  await configCapability.load(adaptConfigLoadCapabilityState(host));
  const reloadFault = restoreHostErrorAfterChannelConfig(host, priorHostError);
  await channelsCapability.load(adaptChannelsLoadCapabilityState(host), true);
  if (reloadFault) {
    host.channelsError = reloadFault;
  }
}

function parseValidationErrors(details: unknown): Record<string, string> {
  if (!Array.isArray(details)) {
    return {};
  }
  const errors: Record<string, string> = {};
  for (const entry of details) {
    if (typeof entry !== "string") {
      continue;
    }
    const [rawField, ...rest] = entry.split(":");
    if (!rawField || rest.length === 0) {
      continue;
    }
    const field = rawField.trim();
    const message = rest.join(":").trim();
    if (field && message) {
      errors[field] = message;
    }
  }
  return errors;
}

function resolveNostrAccountId(host: OpenBotApp): string {
  const accounts = host.channelsSnapshot?.channelAccounts?.nostr ?? [];
  return accounts[0]?.accountId ?? host.nostrProfileAccountId ?? "default";
}

function buildNostrProfileUrl(accountId: string, suffix = ""): string {
  return `/api/channels/nostr/${encodeURIComponent(accountId)}/profile${suffix}`;
}

function resolveGatewayHttpAuthHeader(host: OpenBotApp): string | null {
  const deviceToken = host.hello?.auth?.deviceToken?.trim();
  if (deviceToken) {
    return `Bearer ${deviceToken}`;
  }
  const token = host.settings.token.trim();
  if (token) {
    return `Bearer ${token}`;
  }
  const password = host.password.trim();
  if (password) {
    return `Bearer ${password}`;
  }
  return null;
}

function buildGatewayHttpHeaders(host: OpenBotApp): Record<string, string> {
  const authorization = resolveGatewayHttpAuthHeader(host);
  return authorization ? { Authorization: authorization } : {};
}

export function handleNostrProfileEdit(
  host: OpenBotApp,
  accountId: string,
  profile: NostrProfile | null,
) {
  host.nostrProfileAccountId = accountId;
  host.nostrProfileFormState = createNostrProfileFormState(profile ?? undefined);
}

export function handleNostrProfileCancel(host: OpenBotApp) {
  host.nostrProfileFormState = null;
  host.nostrProfileAccountId = null;
}

export function handleNostrProfileFieldChange(
  host: OpenBotApp,
  field: keyof NostrProfile,
  value: string,
) {
  const state = host.nostrProfileFormState;
  if (!state) {
    return;
  }
  host.nostrProfileFormState = {
    ...state,
    values: {
      ...state.values,
      [field]: value,
    },
    fieldErrors: {
      ...state.fieldErrors,
      [field]: "",
    },
  };
}

export function handleNostrProfileToggleAdvanced(host: OpenBotApp) {
  const state = host.nostrProfileFormState;
  if (!state) {
    return;
  }
  host.nostrProfileFormState = {
    ...state,
    showAdvanced: !state.showAdvanced,
  };
}

export async function handleNostrProfileSave(host: OpenBotApp) {
  const state = host.nostrProfileFormState;
  if (!state || state.saving) {
    return;
  }
  const accountId = resolveNostrAccountId(host);

  host.nostrProfileFormState = {
    ...state,
    saving: true,
    error: null,
    success: null,
    fieldErrors: {},
  };

  try {
    const response = await fetch(buildNostrProfileUrl(accountId), {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...buildGatewayHttpHeaders(host),
      },
      body: JSON.stringify(state.values),
    });
    const data = (await response.json().catch(() => null)) as {
      ok?: boolean;
      error?: string;
      details?: unknown;
      persisted?: boolean;
    } | null;

    if (!response.ok || data?.ok === false || !data) {
      const errorMessage = data?.error ?? `Profile update failed (${response.status})`;
      host.nostrProfileFormState = {
        ...state,
        saving: false,
        error: errorMessage,
        success: null,
        fieldErrors: parseValidationErrors(data?.details),
      };
      return;
    }

    if (!data.persisted) {
      host.nostrProfileFormState = {
        ...state,
        saving: false,
        error: "Profile publish failed on all relays.",
        success: null,
      };
      return;
    }

    host.nostrProfileFormState = {
      ...state,
      saving: false,
      error: null,
      success: "Profile published to relays.",
      fieldErrors: {},
      original: { ...state.values },
    };
    await channelsCapability.load(adaptChannelsLoadCapabilityState(host), true);
  } catch (err) {
    host.nostrProfileFormState = {
      ...state,
      saving: false,
      error: `Profile update failed: ${String(err)}`,
      success: null,
    };
  }
}

export async function handleNostrProfileImport(host: OpenBotApp) {
  const state = host.nostrProfileFormState;
  if (!state || state.importing) {
    return;
  }
  const accountId = resolveNostrAccountId(host);

  host.nostrProfileFormState = {
    ...state,
    importing: true,
    error: null,
    success: null,
  };

  try {
    const response = await fetch(buildNostrProfileUrl(accountId, "/import"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...buildGatewayHttpHeaders(host),
      },
      body: JSON.stringify({ autoMerge: true }),
    });
    const data = (await response.json().catch(() => null)) as {
      ok?: boolean;
      error?: string;
      imported?: NostrProfile;
      merged?: NostrProfile;
      saved?: boolean;
    } | null;

    if (!response.ok || data?.ok === false || !data) {
      const errorMessage = data?.error ?? `Profile import failed (${response.status})`;
      host.nostrProfileFormState = {
        ...state,
        importing: false,
        error: errorMessage,
        success: null,
      };
      return;
    }

    const merged = data.merged ?? data.imported ?? null;
    const nextValues = merged ? { ...state.values, ...merged } : state.values;
    const showAdvanced = Boolean(
      nextValues.banner || nextValues.website || nextValues.nip05 || nextValues.lud16,
    );

    host.nostrProfileFormState = {
      ...state,
      importing: false,
      values: nextValues,
      error: null,
      success: data.saved
        ? "Profile imported from relays. Review and publish."
        : "Profile imported. Review and publish.",
      showAdvanced,
    };

    if (data.saved) {
      await channelsCapability.load(adaptChannelsLoadCapabilityState(host), true);
    }
  } catch (err) {
    host.nostrProfileFormState = {
      ...state,
      importing: false,
      error: `Profile import failed: ${String(err)}`,
      success: null,
    };
  }
}
