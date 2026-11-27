/** Diagnosis writes are opt-in, independent of read-only diagnostics and tick scheduling.
 * Both the master approval and the specific capability must be explicitly enabled.
 * This is startup configuration: changing it requires restarting the gateway.
 *
 * Unversioned by design: this snapshot has no schema or policy version field.
 * conversationDelivery is not an entry in DIAGNOSIS_PRODUCTION_GATES and has no
 * named production approver in that table; do not invent one here.
 */
export function resolveDiagnosisWritePolicy(env: NodeJS.ProcessEnv = process.env) {
  const approved = env.OPENBOT_DIAGNOSIS_WRITES_ENABLED === "true";
  return Object.freeze({
    selfEvolutionConfirm:
      approved && env.OPENBOT_DIAGNOSIS_SELF_EVOLUTION_CONFIRM_ENABLED === "true",
    conversationDelivery:
      approved && env.OPENBOT_DIAGNOSIS_CONVERSATION_DELIVERY_ENABLED === "true",
    daibaiDelivery: approved && env.OPENBOT_DIAGNOSIS_DAIBAI_DELIVERY_ENABLED === "true",
  });
}

export const DIAGNOSIS_WRITE_POLICY = resolveDiagnosisWritePolicy();
