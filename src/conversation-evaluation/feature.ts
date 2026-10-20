/** Default off. Unset / any other value leaves the bypass detached. */
export const CONVERSATION_EVALUATION_ENV = "OPENBOT_CONVERSATION_EVALUATION";

export function isConversationEvaluationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[CONVERSATION_EVALUATION_ENV]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}
