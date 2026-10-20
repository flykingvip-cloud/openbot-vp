/**
 * P4-a proof types and membership checks. Production issuance is
 * `placement-platform-verify.ts`. This file does not register proofs.
 */
export {
  isPlatformDeploymentRegionReceipt,
  isResourceConsentScope,
  isSubjectConsentProof,
} from "./placement-platform-verify.js";
export type {
  PlatformDeploymentRegionReceipt,
  ResourceConsentScope,
  SubjectConsentProof,
} from "./placement-platform-verify.js";
