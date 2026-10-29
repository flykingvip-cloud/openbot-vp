import { adaptSettingsHost } from "./app-host-adapters.ts";
import { applySettings } from "./app-settings.ts";
import { BUILTIN_STEWARD_NAME } from "./builtin-steward-selection.ts";
import {
  isForeignEmployeeStewardSessionKey,
  sessionKeysShareChatSurface,
} from "./chat-session-key-match.ts";
import type { GatewayHost } from "./gateway-host.ts";
import { isForbiddenHumanProfileName } from "./ports/employee/resolve-human-profile-name.ts";
import {
  resolveSessionSeenAliasOptionsFromTrustedSession,
  scrubSessionSeenAtForOwnSteward,
} from "./session-seen-at.ts";

export type SessionDefaultsSnapshot = {
  defaultAgentId?: string;
  mainKey?: string;
  mainSessionKey?: string;
  scope?: string;
};

function normalizeSessionKeyForDefaults(
  value: string | undefined,
  defaults: SessionDefaultsSnapshot,
): string {
  const raw = (value ?? "").trim();
  const mainSessionKey = defaults.mainSessionKey?.trim();
  if (!mainSessionKey) {
    return raw;
  }
  if (!raw) {
    return mainSessionKey;
  }
  // Sticky foreign 大白管家 keys (prior user) must not survive hello for a new caller.
  if (isForeignEmployeeStewardSessionKey(raw, mainSessionKey)) {
    return mainSessionKey;
  }
  const mainKey = defaults.mainKey?.trim() || "main";
  const defaultAgentId = defaults.defaultAgentId?.trim();
  const isAlias =
    raw === "main" ||
    raw === "agent:main" ||
    raw === mainKey ||
    (defaultAgentId &&
      (raw === `agent:${defaultAgentId}:main` || raw === `agent:${defaultAgentId}:${mainKey}`));
  return isAlias ? mainSessionKey : raw;
}

/** Apply hello snapshot session defaults onto the gateway host settings and selection. */
export function applySessionDefaults(host: GatewayHost, defaults?: SessionDefaultsSnapshot) {
  if (!defaults?.mainSessionKey) {
    return;
  }
  const ownMainSessionKey = defaults.mainSessionKey.trim();
  const resolvedSessionKey = normalizeSessionKeyForDefaults(host.sessionKey, defaults);
  const resolvedSettingsSessionKey = normalizeSessionKeyForDefaults(
    host.settings.sessionKey,
    defaults,
  );
  const resolvedLastActiveSessionKey = normalizeSessionKeyForDefaults(
    host.settings.lastActiveSessionKey,
    defaults,
  );
  const nextSessionKey = resolvedSessionKey || resolvedSettingsSessionKey || host.sessionKey;
  const seenIdentity = resolveSessionSeenAliasOptionsFromTrustedSession({
    hello: host.hello,
    platformAuthState: host.platformAuthState,
    bootstrapAuthSession: host.bootstrapAuthSession,
    bootstrapDataSpace: (host as { bootstrapDataSpace?: { mode?: string | null } | null })
      .bootstrapDataSpace,
    ownStewardSessionKey: ownMainSessionKey,
  });
  const scrubbedSeenAt = scrubSessionSeenAtForOwnSteward(
    host.settings.sessionSeenAt,
    ownMainSessionKey,
    { tenantId: seenIdentity.tenantId, spaceMode: seenIdentity.spaceMode },
  );
  const nextSettings = {
    ...host.settings,
    sessionKey: resolvedSettingsSessionKey || nextSessionKey,
    lastActiveSessionKey: resolvedLastActiveSessionKey || nextSessionKey,
    sessionSeenAt: scrubbedSeenAt,
  };
  // Sticky local profile must not keep a digital-employee name (e.g. 大白管家)
  // after a human signs in — Account settings bind to the platform actor.
  if (isForbiddenHumanProfileName(host.settings.workbenchProfileName, [BUILTIN_STEWARD_NAME])) {
    nextSettings.workbenchProfileName = undefined;
  }
  const shouldUpdateSettings =
    nextSettings.sessionKey !== host.settings.sessionKey ||
    nextSettings.lastActiveSessionKey !== host.settings.lastActiveSessionKey ||
    nextSettings.workbenchProfileName !== host.settings.workbenchProfileName ||
    nextSettings.sessionSeenAt !== host.settings.sessionSeenAt;
  if (nextSessionKey !== host.sessionKey) {
    host.sessionKey = nextSessionKey;
  }
  const selected = host.workbenchTeamSelectedKey?.trim() ?? "";
  if (!selected && nextSessionKey) {
    host.workbenchTeamSelectedKey = nextSessionKey;
  } else if (
    selected &&
    nextSessionKey &&
    isForeignEmployeeStewardSessionKey(selected, ownMainSessionKey)
  ) {
    // Prior user's sticky 大白 selection — never leave it selected for the new caller.
    host.workbenchTeamSelectedKey = nextSessionKey;
  } else if (
    selected &&
    nextSessionKey &&
    sessionKeysShareChatSurface(selected, nextSessionKey) &&
    selected !== nextSessionKey
  ) {
    host.workbenchTeamSelectedKey = nextSessionKey;
  }
  if (shouldUpdateSettings) {
    applySettings(adaptSettingsHost(host), nextSettings);
  }
}
