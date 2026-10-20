/**
 * Apply durable governance redirect intents onto resolved agent ids.
 * Safe to call from routing hot paths (sync, best-effort, never throws).
 */

import { getAgentRedirectRecord } from "./runtime-actions.js";

const MAX_REDIRECT_HOPS = 4;

/**
 * Follow redirect chain source → target until none or cycle.
 * Returns final agent id and original source when a redirect applied.
 */
export function resolveGovernanceRedirectedAgentId(agentId: string): {
  agentId: string;
  redirectedFrom: string | null;
  hops: number;
} {
  const start = agentId.trim();
  if (!start) {
    return { agentId: start, redirectedFrom: null, hops: 0 };
  }
  let current = start;
  let redirectedFrom: string | null = null;
  const seen = new Set<string>();
  let hops = 0;
  try {
    while (hops < MAX_REDIRECT_HOPS) {
      if (seen.has(current)) {
        break;
      }
      seen.add(current);
      const rec = getAgentRedirectRecord(current);
      const target = rec?.targetAgentId?.trim();
      if (!target || target === current) {
        break;
      }
      if (!redirectedFrom) {
        redirectedFrom = current;
      }
      current = target;
      hops += 1;
    }
  } catch {
    return { agentId: start, redirectedFrom: null, hops: 0 };
  }
  return {
    agentId: current,
    redirectedFrom: redirectedFrom && redirectedFrom !== current ? redirectedFrom : null,
    hops,
  };
}

/** Convenience: only the final agent id. */
export function applyGovernanceAgentRedirect(agentId: string): string {
  return resolveGovernanceRedirectedAgentId(agentId).agentId;
}
