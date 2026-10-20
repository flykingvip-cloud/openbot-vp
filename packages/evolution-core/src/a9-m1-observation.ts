/**
 * A9 M1 is a shadow observation of an existing Proposal, Experiment, and
 * Application binding. It is not an E5.2 cutover receipt and cannot authorize
 * a consumer or retire a direct mutator.
 */

export const A9_M1_EVENT_KIND = "a9-m1" as const;

export type A9M1Event = {
  kind?: unknown;
  proposalId?: unknown;
  experimentId?: unknown;
  applicationId?: unknown;
  recordedAt?: unknown;
  cutoverReady?: unknown;
  e52SwitchAllowed?: unknown;
  executedConsumer?: unknown;
  directMutatorsRetired?: unknown;
  killSwitchDrillPassed?: unknown;
  rollbackDrillPassed?: unknown;
  idempotentReplayPassed?: unknown;
  audited?: unknown;
  observationWindowRevalidated?: unknown;
};

export type A9M1Classification = {
  kind: typeof A9_M1_EVENT_KIND;
  accepted: boolean;
  isE52CutoverReceipt: false;
  executedConsumer: false;
  directMutatorsRetired: false;
  proposalId: string | null;
  experimentId: string | null;
  applicationId: string | null;
  recordedAt: string | null;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/**
 * Client fields that look like drills, execution, or a cutover receipt are
 * ignored. Only kind `a9-m1` is accepted, and acceptance is still not E5.2.
 */
export function classifyA9M1Event(event: A9M1Event): A9M1Classification {
  return {
    kind: A9_M1_EVENT_KIND,
    accepted: event.kind === A9_M1_EVENT_KIND,
    isE52CutoverReceipt: false,
    executedConsumer: false,
    directMutatorsRetired: false,
    proposalId: text(event.proposalId),
    experimentId: text(event.experimentId),
    applicationId: text(event.applicationId),
    recordedAt: text(event.recordedAt),
  };
}

/** No client event, including an A9 M1 event, is an E5.2 cutover receipt. */
export function isE52CutoverReceipt(event: { kind?: unknown } | null | undefined): false {
  void event?.kind;
  return false;
}
