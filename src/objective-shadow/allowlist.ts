import type { ObjectiveSource, ShadowIngress } from "./types.js";

/** Phase 0 deliverable §4 — authoritative ingress × source allowlist. */
const ALLOWED: Record<ShadowIngress, readonly ObjectiveSource[]> = {
  cron_isolated: ["cron"],
  chat: ["conversation_task", "legacy_context", "inbound_turn"],
  collaboration_turn: ["collaboration", "inbound_turn"],
  subagent: [],
  heartbeat: ["inbound_turn"],
  gateway_agent: ["inbound_turn", "legacy_context"],
  acp: [],
};

export function allowedSourcesFor(ingress: ShadowIngress): ReadonlySet<ObjectiveSource> {
  return new Set(ALLOWED[ingress]);
}

export function isSourceAllowed(ingress: ShadowIngress, source: ObjectiveSource): boolean {
  return allowedSourcesFor(ingress).has(source);
}
