/**
 * P2 design of a later host-controlled candidate entry.
 * This module never persists, activates, or publishes a candidate.
 * It must not be folded into the P1 pure validator.
 */
export const CANDIDATE_ENTRY_REFUSAL_CODE = "p2_persist_forbidden" as const;
export const CANDIDATE_ENTRY_PATH = "candidateEntry.submitRuleCandidate" as const;

export type ControlledCandidateEntryDesign = {
  requiredAuthorization: "host_controlled_entry";
  mustNotUseValidatorAsWriter: true;
  persistMode: "disabled_in_p2";
  mayActivate: false;
  mayPublish: false;
};

export const CONTROLLED_CANDIDATE_ENTRY_DESIGN: ControlledCandidateEntryDesign = {
  requiredAuthorization: "host_controlled_entry",
  mustNotUseValidatorAsWriter: true,
  persistMode: "disabled_in_p2",
  mayActivate: false,
  mayPublish: false,
};

export type CandidateEntryDecision = {
  accepted: false;
  persisted: false;
  activated: false;
  published: false;
  storageId: undefined;
  code: typeof CANDIDATE_ENTRY_REFUSAL_CODE;
  path: typeof CANDIDATE_ENTRY_PATH;
  message: string;
};

export type ControlledCandidateEntry = {
  submitRuleCandidate(
    input: unknown,
    options?: { enablePersist?: boolean },
  ): CandidateEntryDecision;
};

/**
 * Hard refusal. Flags such as enablePersist, fixture, or model-supplied
 * authorization are ignored and never open a write path.
 */
export function refuseCandidateSubmission(
  _input?: unknown,
  _options?: { enablePersist?: boolean },
): CandidateEntryDecision {
  return {
    accepted: false,
    persisted: false,
    activated: false,
    published: false,
    storageId: undefined,
    code: CANDIDATE_ENTRY_REFUSAL_CODE,
    path: CANDIDATE_ENTRY_PATH,
    message:
      "P2 candidate entry is a controlled-entry design only. Persistence, activation, and publication are disabled.",
  };
}

export function createControlledCandidateEntry(): ControlledCandidateEntry {
  return {
    submitRuleCandidate: refuseCandidateSubmission,
  };
}
