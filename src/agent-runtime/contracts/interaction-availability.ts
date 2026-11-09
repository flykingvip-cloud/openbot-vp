/** Host-observed facts, never inferred from quoted user text or model output. */
export type InteractionRestriction =
  | "task_state_unavailable"
  | "transcript_unavailable"
  | "task_mutation_unconfirmed"
  | "context_source_unavailable";

export type InteractionAvailability = {
  mode: "restricted";
  reasons: readonly InteractionRestriction[];
};
