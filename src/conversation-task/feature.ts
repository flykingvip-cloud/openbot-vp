/**
 * ConversationTask Runtime — feature gates (§14). Every flag is OFF by default.
 *
 * The plan requires split flags so no single switch crosses all risk
 * boundaries. In P0/P1 only `detection` and `qualification` may be turned on, and
 * only in shadow mode (compute + log, never act). `activation`, `projection` and
 * `authorization` must stay OFF until their phases (P2+) are separately approved.
 *
 * P0/P1 keep this env-only on purpose: no gateway config schema is touched, so
 * turning a flag on can never change a production config surface. Config wiring
 * (`gateway.conversationTask.*`) is deferred to P2.
 */

/** Canonical config-key names (contract; not yet wired to config schema). */
export const CONVERSATION_TASK_FLAG_NAMES = {
  detection: "conversationTask.detection.enabled",
  qualification: "conversationTask.qualification.enabled",
  activation: "conversationTask.activation.enabled",
  projection: "conversationTask.projection.enabled",
  authorization: "conversationTask.authorization.enabled",
} as const;

/** Environment variable names backing each flag (shadow scope). */
export const CONVERSATION_TASK_ENV = {
  detection: "OPENBOT_CONVERSATION_TASK_DETECTION",
  qualification: "OPENBOT_CONVERSATION_TASK_QUALIFICATION",
  activation: "OPENBOT_CONVERSATION_TASK_ACTIVATION",
  projection: "OPENBOT_CONVERSATION_TASK_PROJECTION",
  authorization: "OPENBOT_CONVERSATION_TASK_AUTHORIZATION",
} as const;

export type ConversationTaskFlag = keyof typeof CONVERSATION_TASK_ENV;

export type ConversationTaskFlags = Record<ConversationTaskFlag, boolean>;

/** Flags allowed to be enabled during P0/P1 (shadow only). */
export const SHADOW_ALLOWED_FLAGS: readonly ConversationTaskFlag[] = [
  "detection",
  "qualification",
] as const;

/** Flags that must stay OFF until their own phase is approved (P2+). */
export const SHADOW_FORBIDDEN_FLAGS: readonly ConversationTaskFlag[] = [
  "activation",
  "projection",
  "authorization",
] as const;

function envEnabled(env: NodeJS.ProcessEnv, name: string): boolean {
  const raw = env[name]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export function isConversationTaskFlagEnabled(
  flag: ConversationTaskFlag,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return envEnabled(env, CONVERSATION_TASK_ENV[flag]);
}

export function readConversationTaskFlags(
  env: NodeJS.ProcessEnv = process.env,
): ConversationTaskFlags {
  return {
    detection: isConversationTaskFlagEnabled("detection", env),
    qualification: isConversationTaskFlagEnabled("qualification", env),
    activation: isConversationTaskFlagEnabled("activation", env),
    projection: isConversationTaskFlagEnabled("projection", env),
    authorization: isConversationTaskFlagEnabled("authorization", env),
  };
}

/**
 * Returns true only when the flag set is a legal P0/P1 shadow configuration:
 * no activation/projection/authorization flag is enabled.
 */
export function isShadowModeOnly(flags: ConversationTaskFlags): boolean {
  return SHADOW_FORBIDDEN_FLAGS.every((flag) => !flags[flag]);
}
