/**
 * Minimal RPC-shaped contract for platform model capability verification.
 * Names mirror the planned backend surface; adapters may be local or remote.
 */

import type { CapabilityEvidenceItem } from "../capability-evidence.ts";
import type { CanonicalCapabilityId } from "../capability-ids.ts";
import type { AutoRoutingAdmission, CapabilityVerificationTask } from "../model-admission-store.ts";

/** Authority of a verification result — formal may enter verified sets; demo must not. */
export type VerificationAuthority = "formal" | "demo";

export type VerificationMode = "protocol_probe" | "specialized_eval";

export type DiscoverCapabilitiesRequest = {
  modelRef: string;
  /** Optional provider / catalog hints. */
  declaredCapabilities?: string[];
  callType?: string;
};

export type DiscoveredCapability = {
  id: CanonicalCapabilityId;
  label: string;
  source: CapabilityEvidenceItem["source"];
  sourceNote?: string;
  /** Suggested for verification; never implies passed. */
  suggested: boolean;
};

export type DiscoverCapabilitiesResponse = {
  modelRef: string;
  capabilities: DiscoveredCapability[];
  /** Adapter that produced this discovery. */
  adapter: string;
};

export type CreateVerificationTaskRequest = {
  modelRef: string;
  capabilityIds: CanonicalCapabilityId[];
  mode?: VerificationMode;
  /**
   * Connection fingerprint at request time. Results bind to this version;
   * a later mismatch expires formal evidence.
   */
  configFingerprint?: string;
  /** Estimated call budget hint for UI. */
  estimatedCalls?: number;
};

export type CreateVerificationTaskResponse = {
  task: CapabilityVerificationTask;
  authority: VerificationAuthority;
};

export type GetVerificationTaskRequest = { taskId: string };
export type CancelVerificationTaskRequest = { taskId: string };
export type ListVerificationTasksRequest = { modelRef?: string };

export type SetRoutingEligibilityRequest = {
  modelRef: string;
  autoRouting: AutoRoutingAdmission;
  reason?: string;
  taskCategories?: string[];
};

export type SetRoutingEligibilityResponse =
  | {
      status: "applied";
      modelRef: string;
      autoRouting: AutoRoutingAdmission;
    }
  | {
      /** Backend admission RPC not wired — draft only, not platform-effective. */
      status: "not_wired";
      modelRef: string;
      draft: {
        autoRouting: AutoRoutingAdmission;
        reason?: string;
        taskCategories?: string[];
      };
      message: string;
    };

export type BatchVerificationRequest = {
  items: CreateVerificationTaskRequest[];
};

export type BatchVerificationResponse = {
  /** Per-model tasks; one success never marks the whole batch routing-eligible. */
  tasks: CreateVerificationTaskResponse[];
};

/**
 * Per-capability protocol check outcome from a runner (no paid API required when injected).
 * Formal adapters only merge `authority: "formal"` outcomes into capabilityEvidence.
 */
export type ProtocolCheckOutcome = {
  capabilityId: CanonicalCapabilityId;
  status: "passed" | "failed" | "pending";
  failureReason?: string;
  /** True when image/music returned a job id but no artifact yet. */
  artifactMissing?: boolean;
  testVersion?: string;
  sourceNote?: string;
  expiresAt?: number;
};

export type ProtocolCheckContext = {
  modelRef: string;
  mode: VerificationMode;
  configFingerprint?: string;
  /** Connection probe already succeeded for this fingerprint. */
  connectionOk?: boolean;
  capabilityIds: CanonicalCapabilityId[];
};

export type CapabilityCheckRunner = {
  check(ctx: ProtocolCheckContext): Promise<ProtocolCheckOutcome[]> | ProtocolCheckOutcome[];
};

/** Switchable service surface (local protocol / demo / future RPC). */
export type CapabilityVerificationService = {
  readonly kind: "local_protocol" | "demo" | "rpc" | "unavailable";
  readonly authority: VerificationAuthority;
  discoverCapabilities(
    req: DiscoverCapabilitiesRequest,
  ): Promise<DiscoverCapabilitiesResponse> | DiscoverCapabilitiesResponse;
  createVerificationTask(
    req: CreateVerificationTaskRequest,
  ): Promise<CreateVerificationTaskResponse> | CreateVerificationTaskResponse;
  getVerificationTask(
    req: GetVerificationTaskRequest,
  ): Promise<CapabilityVerificationTask | null> | CapabilityVerificationTask | null;
  listVerificationTasks(
    req?: ListVerificationTasksRequest,
  ): Promise<CapabilityVerificationTask[]> | CapabilityVerificationTask[];
  cancelVerificationTask(
    req: CancelVerificationTaskRequest,
  ): Promise<CapabilityVerificationTask | null> | CapabilityVerificationTask | null;
  setRoutingEligibility(
    req: SetRoutingEligibilityRequest,
  ): Promise<SetRoutingEligibilityResponse> | SetRoutingEligibilityResponse;
  createBatchVerificationTasks(
    req: BatchVerificationRequest,
  ): Promise<BatchVerificationResponse> | BatchVerificationResponse;
};
