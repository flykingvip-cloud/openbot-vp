import { withAtomV2Defaults } from "../domain/atom-v2.js";
import type { MemoryAtom } from "../models.js";

/**
 * CW2-P5-01 consent grant/revoke — mutates privacy only (local retrieval unchanged).
 * Outbox delete_tombstone is a P5-02 intent hint.
 */

export type PromotionConsentMutation = {
  atom: MemoryAtom;
  outboxIntent?: "push" | "delete_tombstone";
};

export function grantPromotionConsent(
  atom: MemoryAtom,
  opts?: { privacyLevel?: "shared" | "org" | "public" },
): PromotionConsentMutation {
  const base = withAtomV2Defaults(atom);
  const privacyLevel = opts?.privacyLevel ?? "shared";
  return {
    atom: {
      ...base,
      privacy: {
        ...base.privacy,
        privacyLevel,
        syncEligibility: "promoted",
        consentRequired: false,
      },
    },
    outboxIntent: "push",
  };
}

export function revokePromotionConsent(atom: MemoryAtom): PromotionConsentMutation {
  const base = withAtomV2Defaults(atom);
  return {
    atom: {
      ...base,
      privacy: {
        ...base.privacy,
        privacyLevel: base.privacy?.privacyLevel ?? "private",
        syncEligibility: "blocked",
        consentRequired: true,
      },
    },
    outboxIntent: "delete_tombstone",
  };
}
