/**
 * Repair hook for the write extension.
 * At most a suggestion or a new private candidate.
 * Never publishes, enables, grants, or relaxes the fixture.
 */

import { nextPrivateVersion } from "./draft-store.js";
import { classifySiteFailure, type SarFailureClass } from "./failure-class.js";
import { isEmptySuccess, type SiteRunResult } from "./result.js";
import {
  writeArtifactDigest,
  type SarWriteEffect,
  type WriteCapabilityManifest,
} from "./write-effect.js";

export type WriteRepairCandidate = {
  draftId: string;
  capabilityId: string;
  version: string;
  effect: SarWriteEffect;
  lifecycle: "private";
  enabled: false;
  published: false;
  artifactDigest: string;
  revisionOf: string;
  manifest: WriteCapabilityManifest;
};

export type WriteRepairProposal = {
  action: "none" | "suggestion" | "candidate";
  failureClass: SarFailureClass | null;
  suggestion: string | null;
  candidate: WriteRepairCandidate | null;
  autoPublished: false;
  grantsExpanded: false;
  accountSwitched: false;
  fixtureRelaxed: false;
  writeEnabled: false;
  codeRewritten: false;
  accountBindingId: string | null;
};

const SUGGESTION: Record<SarFailureClass, string> = {
  auth: "Re-authenticate the same account binding. Do not switch accounts or expand write grants.",
  infrastructure: "Repair the browser infrastructure. Do not change the write adapter.",
  params: "Correct the parameters. Do not replay the write.",
  policy: "Stop. Do not switch browsers or widen the write effect.",
  "risk-control": "Stop the automatic loop. Do not rotate accounts.",
  "structure-change":
    "Page structure changed. Keep the original write version. Review a new private candidate. Do not publish.",
  "validation-failed":
    "Validation failed. Keep the current write version. Review a new private candidate. Do not publish.",
  unknown:
    "Result is unknown. Recheck by runId and artifact digest. Do not blind-replay before confirmation and do not publish.",
};

export type WriteRepairSource = {
  manifest: WriteCapabilityManifest;
  version: string;
  accountBindingIds?: readonly string[];
};

function locked(input: {
  action: WriteRepairProposal["action"];
  failureClass: SarFailureClass | null;
  suggestion: string | null;
  candidate: WriteRepairCandidate | null;
  accountBindingId: string | null;
}): WriteRepairProposal {
  return {
    ...input,
    autoPublished: false,
    grantsExpanded: false,
    accountSwitched: false,
    fixtureRelaxed: false,
    writeEnabled: false,
    codeRewritten: false,
  };
}

function privateCandidate(source: WriteRepairSource, draftId: string): WriteRepairCandidate {
  const version = nextPrivateVersion(source.version);
  const manifest: WriteCapabilityManifest = { ...source.manifest, version };
  return {
    draftId,
    capabilityId: manifest.id,
    version,
    effect: manifest.effect,
    lifecycle: "private",
    enabled: false,
    published: false,
    artifactDigest: writeArtifactDigest(manifest),
    revisionOf: source.version,
    manifest,
  };
}

/**
 * Classify one write outcome. Unknown stays a suggestion.
 * A private candidate is not registered, granted, or enabled.
 */
export function proposeWriteRepair(input: {
  result?: SiteRunResult;
  validationFailed?: boolean;
  source?: WriteRepairSource | null;
  accountBindingId?: string;
  mintDraftId: () => string;
}): WriteRepairProposal {
  const accountBindingId = input.accountBindingId?.trim() || null;
  if (input.result && isEmptySuccess(input.result)) {
    return locked({
      action: "none",
      failureClass: null,
      suggestion: null,
      candidate: null,
      accountBindingId,
    });
  }
  let failureClass: SarFailureClass | null = null;
  if (input.validationFailed) {
    failureClass = "validation-failed";
  } else if (input.result) {
    failureClass = classifySiteFailure(input.result);
  }
  if (!failureClass) {
    return locked({
      action: "none",
      failureClass: null,
      suggestion: null,
      candidate: null,
      accountBindingId,
    });
  }
  const needsCandidate =
    failureClass === "structure-change" || failureClass === "validation-failed";
  if (needsCandidate && input.source) {
    return locked({
      action: "candidate",
      failureClass,
      suggestion: SUGGESTION[failureClass],
      candidate: privateCandidate(input.source, input.mintDraftId()),
      accountBindingId,
    });
  }
  return locked({
    action: "suggestion",
    failureClass,
    suggestion: SUGGESTION[failureClass],
    candidate: null,
    accountBindingId,
  });
}
