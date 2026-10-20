/**
 * Enterprise AI model governance — domain types (BYOK connections + assets).
 * Spec: `.kiro/specs/enterprise-ai-model-governance/`
 */

export type EnterpriseModelProviderType = "openai" | "anthropic" | "openai-compatible" | "custom";

export type EnterpriseModelConnectionStatus =
  | "draft"
  | "credential_saved"
  | "verifying"
  | "verified"
  | "models_discovered"
  | "active"
  | "invalid_credential"
  | "network_unreachable"
  | "protocol_incompatible"
  | "rate_limited"
  | "disabled";

export type EnterpriseModelHealthStatus =
  | "unknown"
  | "healthy"
  | "degraded"
  | "unhealthy"
  | "unchecked";

export type EnterpriseModelProbeCode =
  | "OK"
  | "ENTERPRISE_MODEL_INVALID_CREDENTIAL"
  | "ENTERPRISE_MODEL_NETWORK_UNREACHABLE"
  | "ENTERPRISE_MODEL_TIMEOUT"
  | "ENTERPRISE_MODEL_RATE_LIMITED"
  | "ENTERPRISE_MODEL_PROTOCOL_MISMATCH"
  | "ENTERPRISE_MODEL_MODEL_UNAVAILABLE"
  | "ENTERPRISE_MODEL_FORBIDDEN"
  | "ENTERPRISE_MODEL_NOT_FOUND"
  | "ENTERPRISE_MODEL_DEPENDENCY_BLOCKED"
  | "ENTERPRISE_MODEL_INVALID_REQUEST";

export type EnterpriseModelProviderConnection = {
  tenantId: string;
  connectionId: string;
  providerType: EnterpriseModelProviderType;
  displayName: string;
  baseUrl?: string;
  /** Protocol hint, e.g. openai-completions / anthropic-messages. */
  protocol: string;
  credentialRef: string;
  /** Desensitized hint only (e.g. …abcd). Never plaintext. */
  secretHint?: string;
  status: EnterpriseModelConnectionStatus;
  healthStatus: EnterpriseModelHealthStatus;
  lastVerifiedAt?: string;
  lastVerificationResult?: {
    code: EnterpriseModelProbeCode;
    message: string;
    discoveredModelCount?: number;
  };
  createdAt: string;
  updatedAt: string;
  disabledAt?: string;
};

export type EnterpriseModelAsset = {
  tenantId: string;
  assetId: string;
  connectionId: string;
  /** Tenant-isolated runtime id; never embeds raw tenant secrets for upstream. */
  runtimeModelId: string;
  upstreamModelId: string;
  displayName: string;
  source: "enterprise";
  billingOwner: "enterprise";
  tier?: string;
  capabilities?: string[];
  enabled: boolean;
  healthStatus: EnterpriseModelHealthStatus;
  contextWindow?: number;
  /** Optional unit cost metadata (cents per 1k tokens, etc.). Not a budget ceiling. */
  cost?: {
    inputPer1kCents?: number;
    outputPer1kCents?: number;
    currency?: string;
  };
  /** Optional runtime budget ceiling for this BYOK asset (enforced before invocation). */
  budget?: {
    monthlySpendCapCents?: number;
  };
  createdAt: string;
  updatedAt: string;
};

export type EnterpriseModelCredentialSecret = {
  apiKey: string;
  /** Optional extra headers (never logged). */
  headers?: Record<string, string>;
};

export type EnterpriseModelPublicConnection = Omit<EnterpriseModelProviderConnection, never> & {
  /** Always true/false from vault presence; never includes secret material. */
  hasCredential: boolean;
};
