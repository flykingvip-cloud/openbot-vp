/**
 * Enterprise AI model provider / catalog RPC endpoints.
 * Spec: `.kiro/specs/enterprise-ai-model-governance/`
 */

export const ENTERPRISE_MODEL_PROVIDER_ENDPOINTS = {
  list: "enterprise-model-provider.list",
  create: "enterprise-model-provider.create",
  update: "enterprise-model-provider.update",
  test: "enterprise-model-provider.test",
  rotateCredential: "enterprise-model-provider.rotate-credential",
  disable: "enterprise-model-provider.disable",
  delete: "enterprise-model-provider.delete",
} as const;

export const ENTERPRISE_MODEL_CATALOG_ENDPOINTS = {
  list: "enterprise-model-catalog.list",
  discover: "enterprise-model-catalog.discover",
  register: "enterprise-model-catalog.register",
  update: "enterprise-model-catalog.update",
  enable: "enterprise-model-catalog.enable",
  disable: "enterprise-model-catalog.disable",
} as const;

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

export type EnterpriseModelPublicConnection = {
  tenantId: string;
  connectionId: string;
  providerType: string;
  displayName: string;
  baseUrl?: string;
  protocol: string;
  credentialRef: string;
  secretHint?: string;
  status: EnterpriseModelConnectionStatus;
  healthStatus: string;
  lastVerifiedAt?: string;
  lastVerificationResult?: {
    code: string;
    message: string;
    discoveredModelCount?: number;
  };
  hasCredential: boolean;
  createdAt: string;
  updatedAt: string;
  disabledAt?: string;
};

export type EnterpriseModelAsset = {
  tenantId: string;
  assetId: string;
  connectionId: string;
  runtimeModelId: string;
  upstreamModelId: string;
  displayName: string;
  source: "enterprise";
  billingOwner: "enterprise";
  tier?: string;
  capabilities?: string[];
  enabled: boolean;
  healthStatus: string;
  contextWindow?: number;
  cost?: {
    inputPer1kCents?: number;
    outputPer1kCents?: number;
    currency?: string;
  };
  budget?: {
    monthlySpendCapCents?: number;
  };
  createdAt: string;
  updatedAt: string;
};

export type UnusableEnterpriseModelWarning = {
  kind: "connection" | "asset" | "grant";
  id: string;
  title: string;
  detail: string;
  modelId?: string;
  connectionId?: string;
};

export type ProviderListResponse = {
  tenantId: string;
  connections: EnterpriseModelPublicConnection[];
  unusableModels?: UnusableEnterpriseModelWarning[];
};

export type CatalogListResponse = {
  tenantId: string;
  assets: EnterpriseModelAsset[];
};

export type DiscoveredModel = {
  upstreamModelId: string;
  displayName?: string;
};
