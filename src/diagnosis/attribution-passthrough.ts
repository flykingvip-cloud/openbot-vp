/**
 * Skill Evidence must pass through recorded attributionResolution.
 * Never default to identity_tool_name.
 */
import { ATTRIBUTION_RESOLUTIONS, type AttributionResolution } from "./types.js";

const ALLOWED = new Set<string>(ATTRIBUTION_RESOLUTIONS);

/**
 * Map a Skill Invocation row's resolution into protocol.
 * Missing or unknown values become `unknown`, never `identity_tool_name`.
 */
export function passthroughAttributionResolution(raw: unknown): AttributionResolution {
  if (typeof raw !== "string" || raw.length === 0) {
    return "unknown";
  }
  if (!ALLOWED.has(raw)) {
    return "unknown";
  }
  return raw as AttributionResolution;
}

export function isConfirmedSkillIdentity(resolution: AttributionResolution): boolean {
  return resolution === "identity_tool_name";
}
