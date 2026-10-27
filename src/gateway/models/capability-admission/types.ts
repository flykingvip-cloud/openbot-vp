/**
 * Gateway-side capability admission types.
 * Mirrors the UI verification contract; kept independent so UI/browser code
 * is not imported into the gateway process.
 */

export type CanonicalCapabilityId =
  | "reasoning"
  | "vision"
  | "coding"
  | "tool_use"
  | "stream"
  | "long_context"
  | "image_generation"
  | "music_generation"
  | "text_chat";

export type AutoRoutingAdmission = "disabled" | "eligible" | "restricted" | "paused";

export type CapabilityEvidenceSource =
  | "inferred"
  | "protocol_probe"
  | "specialized_eval"
  | "catalog"
  | "manual";

export type CapabilityVerificationStatus =
  | "suggested"
  | "passed"
  | "failed"
  | "expired"
  | "untested"
  | "pending"
  | "checker_unavailable";

export type CapabilityEvidenceItem = {
  id: CanonicalCapabilityId;
  label: string;
  source: CapabilityEvidenceSource;
  status: CapabilityVerificationStatus;
  sourceNote?: string;
  verifiedAt?: number;
  expiresAt?: number;
  failureReason?: string;
  testVersion?: string;
  qualityScore?: number;
};

export type ModelAdmissionRecord = {
  modelRef: string;
  connectionFingerprint?: string;
  connectionVerifiedAt?: number;
  tenantSelectable: boolean;
  autoRouting: AutoRoutingAdmission;
  autoRoutingTaskCategories: string[];
  autoRoutingReason?: string;
  capabilityEvidence: CapabilityEvidenceItem[];
  updatedAt: number;
  /** True when this record was written by gateway admission RPC (platform-effective). */
  platformEffective: boolean;
};

export type CapabilityVerificationTask = {
  taskId: string;
  modelRef: string;
  capabilityIds: CanonicalCapabilityId[];
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "partial" | "interrupted";
  createdAt: number;
  updatedAt: number;
  results?: CapabilityEvidenceItem[];
  error?: string;
  estimatedCalls?: number;
  configFingerprint?: string;
  executionGeneration?: number;
};

export type VerificationMode = "protocol_probe" | "specialized_eval";

export type ProtocolCheckOutcome = {
  capabilityId: CanonicalCapabilityId;
  status: "passed" | "failed" | "pending" | "untested" | "checker_unavailable";
  failureReason?: string;
  artifactMissing?: boolean;
  testVersion?: string;
  sourceNote?: string;
  expiresAt?: number;
  verifiedAt?: number;
  reuseExistingEvidence?: boolean;
  qualityScore?: number;
};

export type ProtocolCheckContext = {
  modelRef: string;
  mode: VerificationMode;
  configFingerprint?: string;
  /**
   * @deprecated Ignored by the default gateway runner for formal evidence.
   * Kept optional so injected test runners may still read it if they choose;
   * RPC clients cannot mint formal passed via this field.
   */
  connectionOk?: boolean;
  capabilityIds: CanonicalCapabilityId[];
};

export type RoutingPreviewCandidate = {
  modelId: string;
  health?: string;
  costTier?: string;
  contextWindow?: number | null;
};

export type RoutingPreviewRequest = {
  taskText?: string;
  taskProfileId?: string;
  planId?: string;
  outputType?: "text" | "image" | "music" | "audio";
  budget?: "low" | "medium" | "high";
  requiredCapabilities?: string[];
  minContextWindow?: number;
};

export type RoutingPreviewExclusion = {
  modelId: string;
  reason: string;
  code:
    | "capability_unverified"
    | "auto_routing_disabled"
    | "no_permission"
    | "context_insufficient"
    | "verification_expired"
    | "health"
    | "budget"
    | "other";
};

export type RoutingDecisionPreview = {
  requestId: string;
  taskCategory: string;
  executorPath: string;
  selectedExecutor?: string | null;
  selectedModelId: string | null;
  primary: string[];
  fallback: string[];
  excluded: RoutingPreviewExclusion[];
  decisionReason: string;
  /** Always dry-run: does not call generation models. */
  dryRun: true;
  /** False when produced by gateway admission RPC. */
  uiDemo: boolean;
  backendStatus: "wired";
  requiredCapabilities: CanonicalCapabilityId[];
  budget?: "low" | "medium" | "high";
  outputType?: "text" | "image" | "music" | "audio";
};
