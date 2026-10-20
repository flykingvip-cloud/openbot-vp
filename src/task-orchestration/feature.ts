/**
 * Orchestration Plane — feature gates (P4.5). Every flag is OFF by default.
 *
 * These four switches are **not** reused from ConversationTask Runtime's five
 * flags (detection/qualification/activation/projection/authorization). CTR
 * `activation` ON must never be treated as orchestration enable.
 *
 * Env-only on purpose (same P0/P1 rationale as CTR): no gateway config schema
 * is touched, so turning a flag on can never change a production config surface.
 */

import { isConversationTaskFlagEnabled } from "../conversation-task/feature.js";
import type { OrchestrationFlags } from "./types.js";

/** Canonical config-key names (contract; not wired to config schema). */
export const ORCHESTRATION_FLAG_NAMES = {
  shadowEnabled: "conversationTask.orchestration.shadowEnabled",
  dispatchEnabled: "conversationTask.orchestration.dispatchEnabled",
  nodeEnabled: "conversationTask.orchestration.nodeEnabled",
  browserEnabled: "conversationTask.orchestration.browserEnabled",
} as const;

/** Environment variable names backing each flag. */
export const ORCHESTRATION_ENV = {
  shadowEnabled: "OPENBOT_CONVERSATION_TASK_ORCH_SHADOW",
  dispatchEnabled: "OPENBOT_CONVERSATION_TASK_ORCH_DISPATCH",
  nodeEnabled: "OPENBOT_CONVERSATION_TASK_ORCH_NODE",
  browserEnabled: "OPENBOT_CONVERSATION_TASK_ORCH_BROWSER",
} as const;

export type OrchestrationFlag = keyof typeof ORCHESTRATION_ENV;

function envEnabled(env: NodeJS.ProcessEnv, name: string): boolean {
  const raw = env[name]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

/**
 * Read-only orchestration invoke. On by default so a normal gateway calls the
 * read-only adapter. Set OPENBOT_ORCH_READONLY_INVOKE=0 to disable.
 * Independent of the four ORCHESTRATION_ENV switches and of ORCHESTRATION_LIVE_INVOKE,
 * which stay fail-closed.
 */
export const ORCH_READONLY_INVOKE_ENV = "OPENBOT_ORCH_READONLY_INVOKE" as const;

export function isReadonlyInvokeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[ORCH_READONLY_INVOKE_ENV]?.trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "no" && raw !== "off";
}

export function isOrchestrationFlagEnabled(
  flag: OrchestrationFlag,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return envEnabled(env, ORCHESTRATION_ENV[flag]);
}

export function readOrchestrationFlags(env: NodeJS.ProcessEnv = process.env): OrchestrationFlags {
  return {
    shadowEnabled: isOrchestrationFlagEnabled("shadowEnabled", env),
    dispatchEnabled: isOrchestrationFlagEnabled("dispatchEnabled", env),
    nodeEnabled: isOrchestrationFlagEnabled("nodeEnabled", env),
    browserEnabled: isOrchestrationFlagEnabled("browserEnabled", env),
  };
}

/**
 * True when the kernel must not observe, write, or invoke.
 * Node/browser master switches alone cannot wake the dispatcher.
 */
export function isOrchestrationDormant(flags: OrchestrationFlags): boolean {
  return !flags.shadowEnabled && !flags.dispatchEnabled;
}

/**
 * CTR activation flag (read only to *refuse* treating it as orch enable).
 * Does not import activation.ts or the Task store.
 */
export function isConversationTaskActivationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isConversationTaskFlagEnabled("activation", env);
}

/**
 * Enqueue is permitted only when dispatch is on AND CTR activation is on AND
 * the kernel is not dormant. P4.5 still does not materialize jobs or invoke.
 */
export function isDispatchPermitted(
  flags: OrchestrationFlags,
  options: { ctrActivationEnabled: boolean; allowlistEmpty: boolean },
): boolean {
  if (isOrchestrationDormant(flags)) {
    return false;
  }
  if (options.allowlistEmpty) {
    return false;
  }
  if (!flags.dispatchEnabled) {
    return false;
  }
  if (!options.ctrActivationEnabled) {
    return false;
  }
  return true;
}

/**
 * CTR activation must never be treated as orchestration enable.
 * Returns true only when orch flags themselves enable shadow or dispatch.
 */
export function isOrchestrationEnabledByFlags(flags: OrchestrationFlags): boolean {
  return flags.shadowEnabled || flags.dispatchEnabled;
}

/**
 * Tenant allowlist for admitting a complex-task loop.
 * Unset or empty ⇒ nobody is admitted. This is not an orchestration master
 * switch: dispatch stays default OFF, and an allowlisted tenant still does
 * nothing until that flag is explicitly on and the turn has an explicit kind.
 */
export const ORCH_TENANT_ALLOWLIST_ENV = "OPENBOT_CONVERSATION_TASK_ORCH_TENANT_ALLOWLIST" as const;

/** Canonical env name for Phase B web_read shadow child flag (default OFF). */
export const WEB_READ_SHADOW_ENV = "OPENBOT_CONVERSATION_TASK_WEB_READ_SHADOW" as const;

/** Contract config-key name (not wired to config schema). */
export const WEB_READ_SHADOW_FLAG_NAME =
  "conversationTask.orchestration.webReadShadowEnabled" as const;

/**
 * Phase B B2 child flag. Independent of the four orchestration flags.
 * Default OFF. Closing this flag must not stop legacy Gate C recall_memory probe.
 */
export function isWebReadShadowEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return envEnabled(env, WEB_READ_SHADOW_ENV);
}
