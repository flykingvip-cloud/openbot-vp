/**
 * Orchestration Plane — stable reason codes (P4.5).
 *
 * Safe to log: no raw user text, no node filesystem paths, no conversation ids.
 */

export const ORCH_REASON = {
  DORMANT: "orch_dormant",
  ALLOWLIST_EMPTY: "orch_allowlist_empty",
  CTR_SHADOW_ONLY: "orch_ctr_shadow_only",
  CTR_ACTIVATION_IS_NOT_ORCH_ENABLE: "orch_ctr_activation_is_not_orch_enable",
  FAIL_CLOSED: "orch_fail_closed",

  LADDER_MEMORY: "orch_ladder_memory",
  LADDER_SKILL: "orch_ladder_skill",
  LADDER_CONNECTOR: "orch_ladder_connector",
  LADDER_WEB_READ: "orch_ladder_web_read",
  LADDER_BROWSER: "orch_ladder_browser",
  LADDER_NODE_FS: "orch_ladder_node_fs",
  LADDER_NODE_EXEC: "orch_ladder_node_exec",

  SKIP_AHEAD_BLOCKED: "orch_skip_ahead_blocked_policy",
  CONNECTOR_PREFERRED_OVER_BROWSER: "orch_connector_preferred_over_browser",
  WEB_READ_PREFERRED_OVER_BROWSER: "orch_web_read_preferred_over_browser",
  SANDBOX_IS_NOT_NODE: "orch_sandbox_is_not_node",

  NODE_ENABLED_OFF: "orch_node_enabled_off",
  BROWSER_ENABLED_OFF: "orch_browser_enabled_off",
  ZERO_NODES: "orch_zero_nodes_human_gate",
  MULTIPLE_UNBOUND_NODES: "orch_multiple_unbound_nodes_human_gate",
  NODE_UNBOUND: "orch_node_unbound_human_gate",
  HUMAN_GATE: "orch_human_gate",

  DISPATCH_REQUIRES_ACTIVATION: "orch_dispatch_requires_ctr_activation",
  NO_INVOKE_WHEN_DORMANT: "orch_no_invoke_when_dormant",
  /** Gate C: route scored under ORCH_SHADOW; never invoke. */
  SHADOW_OBSERVE: "orch_shadow_observe",
  /** DISPATCH / NODE / BROWSER / LIVE_INVOKE armed ⇒ fail-closed, no invoke. */
  LIVE_PATH_ARMED: "orch_live_path_armed_fail_closed",
  SKILL_IS_RECIPE_NOT_EVIDENCE: "orch_skill_is_recipe_not_evidence",
  ACK_IS_NOT_DELIVERY: "orch_ack_is_not_delivery",
  PERSONAL_SUBAGENT_NOT_MISSION: "orch_personal_subagent_not_mission",
  FORBIDDEN_EVIDENCE: "orch_forbidden_evidence",
} as const;

export type OrchReasonCode = (typeof ORCH_REASON)[keyof typeof ORCH_REASON];

export const ALL_ORCH_REASON_CODES: readonly OrchReasonCode[] = Object.values(ORCH_REASON);

const REASON_SET: ReadonlySet<string> = new Set(ALL_ORCH_REASON_CODES);

export function isOrchReasonCode(value: string): value is OrchReasonCode {
  return REASON_SET.has(value);
}
