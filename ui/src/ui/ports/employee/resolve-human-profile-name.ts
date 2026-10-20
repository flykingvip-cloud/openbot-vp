/**
 * Resolve the signed-in *human* profile label for Account settings / header avatar.
 * Never derive this from the selected agent, employee-steward session, or 大白管家.
 */

import { BUILTIN_STEWARD_NAME } from "../../builtin-steward-selection.ts";

export type ResolveWorkbenchHumanProfileNameInput = {
  /** User-edited override persisted in settings (optional). */
  workbenchProfileName?: string | null;
  /** Platform / trusted-proxy session displayName. */
  platformDisplayName?: string | null;
  /** Platform session email when available. */
  platformEmail?: string | null;
  /** Platform session user id / login (often the email). */
  platformUser?: string | null;
  /**
   * Names that belong to digital employees / assistants and must never be shown
   * as the human account profile (e.g. current assistantName, 大白管家).
   */
  forbiddenAgentNames?: readonly (string | null | undefined)[] | null;
};

function normalize(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function emailLocalPart(value: string): string | null {
  const at = value.indexOf("@");
  if (at <= 0) {
    return null;
  }
  const local = value.slice(0, at).trim();
  return local || null;
}

/**
 * Product / brand labels that must never appear as the signed-in human header name
 * (sticky settings or last-resort fallbacks). Keep lowercase; matching is case-insensitive.
 */
export const FORBIDDEN_PRODUCT_BRAND_PROFILE_NAMES = ["openbot", "open bot", "open-bot"] as const;

function buildForbiddenSet(
  forbiddenAgentNames: ResolveWorkbenchHumanProfileNameInput["forbiddenAgentNames"],
): Set<string> {
  const set = new Set<string>();
  set.add(BUILTIN_STEWARD_NAME.trim().toLowerCase());
  for (const brand of FORBIDDEN_PRODUCT_BRAND_PROFILE_NAMES) {
    set.add(brand.trim().toLowerCase());
  }
  for (const entry of forbiddenAgentNames ?? []) {
    const trimmed = normalize(entry);
    if (trimmed) {
      set.add(trimmed.toLowerCase());
    }
  }
  return set;
}

/** True when a candidate looks like a robot / session identity rather than a human. */
export function isForbiddenHumanProfileName(
  value: string | null | undefined,
  forbiddenAgentNames?: ResolveWorkbenchHumanProfileNameInput["forbiddenAgentNames"],
): boolean {
  const trimmed = normalize(value);
  if (!trimmed) {
    return true;
  }
  if (/^agent:/i.test(trimmed)) {
    return true;
  }
  return buildForbiddenSet(forbiddenAgentNames).has(trimmed.toLowerCase());
}

/**
 * Pick a human-facing display name for Account / header.
 * Priority: usable settings override → platform displayName → email local-part → platform user.
 * Never falls back to assistant / steward / agent names.
 */
export function resolveWorkbenchHumanProfileName(
  input: ResolveWorkbenchHumanProfileNameInput,
): string {
  const forbidden = input.forbiddenAgentNames;
  const fromSettings = normalize(input.workbenchProfileName);
  if (fromSettings && !isForbiddenHumanProfileName(fromSettings, forbidden)) {
    return fromSettings;
  }

  const fromDisplay = normalize(input.platformDisplayName);
  if (fromDisplay && !isForbiddenHumanProfileName(fromDisplay, forbidden)) {
    return fromDisplay;
  }

  const email = normalize(input.platformEmail) || normalize(input.platformUser);
  const local = emailLocalPart(email);
  if (local && !isForbiddenHumanProfileName(local, forbidden)) {
    return local;
  }

  const fromUser = normalize(input.platformUser);
  if (fromUser && !fromUser.includes("@") && !isForbiddenHumanProfileName(fromUser, forbidden)) {
    return fromUser;
  }

  return "";
}
