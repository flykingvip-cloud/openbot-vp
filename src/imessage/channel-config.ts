import {
  mapAllowFromEntries,
  resolveOptionalConfigString,
} from "../channels/plugins/channel-config-helpers.js";
import type { OpenBotConfig } from "../config/types.openbot.js";
import { resolveIMessageAccount } from "./accounts.js";

export function resolveIMessageConfigAllowFrom(params: {
  cfg: OpenBotConfig;
  accountId?: string | null;
}): string[] {
  return mapAllowFromEntries(resolveIMessageAccount(params).config.allowFrom);
}

export function resolveIMessageConfigDefaultTo(params: {
  cfg: OpenBotConfig;
  accountId?: string | null;
}): string | undefined {
  return resolveOptionalConfigString(resolveIMessageAccount(params).config.defaultTo);
}
