/** Trusted, process-local handoff of one provider candidate's aggregate usage. */
export type EmbeddedFailureIdentity = { runId: string; provider: string; model: string };
export type EmbeddedFailureUsage = {
  identity: EmbeddedFailureIdentity;
  usage: unknown;
  aggregation: "provider_aggregate_internal_retries_unknown";
};
const observed = new WeakMap<object, EmbeddedFailureUsage>();
export function retainEmbeddedFailureUsage(
  error: unknown,
  identity: EmbeddedFailureIdentity,
  usage: unknown,
): unknown {
  if ((typeof error === "object" && error !== null) || typeof error === "function") {
    observed.set(error, {
      identity: { ...identity },
      usage: structuredClone(usage),
      aggregation: "provider_aggregate_internal_retries_unknown",
    });
  }
  return error;
}
export function readEmbeddedFailureUsage(
  error: unknown,
  expected: EmbeddedFailureIdentity,
): EmbeddedFailureUsage | undefined {
  if (!error || (typeof error !== "object" && typeof error !== "function")) {
    return undefined;
  }
  const value = observed.get(error);
  if (
    !value ||
    value.identity.runId !== expected.runId ||
    value.identity.provider !== expected.provider ||
    value.identity.model !== expected.model
  ) {
    return undefined;
  }
  return structuredClone(value);
}
