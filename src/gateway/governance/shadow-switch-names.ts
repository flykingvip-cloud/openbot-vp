/**
 * Names of the existing governance shadow switches.
 *
 * This module imports nothing. Security-profile startup opens these switches
 * without loading the shadow adapters. Those adapters import config and the
 * gateway, and linking them from security-profile makes Vitest vmForks fail
 * with "Linked modules must use the same context".
 *
 * The string values match the constants still exported by the adapter modules.
 */
export const GOVERNANCE_SHADOW_LOG_ENV = "OPENBOT_GOVERNANCE_SHADOW_LOG";
export const NODE_INVOKE_SHADOW_ENV = "OPENBOT_GOVERNANCE_NODE_INVOKE_SHADOW";
export const CAPABILITY_INVOKE_SHADOW_ENV = "OPENBOT_GOVERNANCE_CAPABILITY_INVOKE_SHADOW";
export const TOOLS_INVOKE_SHADOW_ENV = "OPENBOT_GOVERNANCE_TOOLS_INVOKE_SHADOW";
export const MEDIA_UNDERSTANDING_SHADOW_ENV = "OPENBOT_GOVERNANCE_MEDIA_UNDERSTANDING_SHADOW";
export const AGENT_INVOCATION_SHADOW_ENV = "OPENBOT_GOVERNANCE_AGENT_INVOCATION_SHADOW";
export const NODE_INVOKE_PREFLIGHT_OBSERVE_ENV = "OPENBOT_NODE_INVOKE_PREFLIGHT_OBSERVE";
export const INTER_AGENT_BUS_PREFLIGHT_OBSERVE_ENV = "OPENBOT_INTER_AGENT_BUS_PREFLIGHT_OBSERVE";

export const EXISTING_GOVERNANCE_SHADOW_SWITCHES = [
  GOVERNANCE_SHADOW_LOG_ENV,
  NODE_INVOKE_SHADOW_ENV,
  CAPABILITY_INVOKE_SHADOW_ENV,
  TOOLS_INVOKE_SHADOW_ENV,
  MEDIA_UNDERSTANDING_SHADOW_ENV,
  AGENT_INVOCATION_SHADOW_ENV,
  NODE_INVOKE_PREFLIGHT_OBSERVE_ENV,
  INTER_AGENT_BUS_PREFLIGHT_OBSERVE_ENV,
] as const;

/**
 * Turn on existing shadow switches that are still unset. Does not change code
 * defaults and does not enable enforce / hard-deny.
 */
export function openExistingGovernanceShadowSwitches(env: NodeJS.ProcessEnv): string[] {
  const opened: string[] = [];
  for (const key of EXISTING_GOVERNANCE_SHADOW_SWITCHES) {
    if (!env[key]?.trim()) {
      env[key] = "1";
      opened.push(key);
    }
  }
  return opened;
}
