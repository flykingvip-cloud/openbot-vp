import { pathForTab } from "../../../navigation.ts";

export type PlatformSystemSettingsSection = "admins" | "defaults" | "security" | "api";

export const PLATFORM_SYSTEM_SETTINGS_HASH_PREFIX = "#platform-system-settings:";

export function platformSystemSettingsHref(
  basePath: string,
  section: PlatformSystemSettingsSection = "admins",
) {
  return `${pathForTab("platformSystemSettings", basePath)}${PLATFORM_SYSTEM_SETTINGS_HASH_PREFIX}${section}`;
}

export function platformCreateTenantHref(basePath: string) {
  return `${pathForTab("platformTenants", basePath)}#create-formal-advanced`;
}
