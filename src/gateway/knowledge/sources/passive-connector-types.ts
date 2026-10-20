/**
 * P5: shared three-layer contract for durable passive connectors.
 *
 * Layer 1 — SourceDescriptor (logical, cloud-visible; no secrets / no local abs paths)
 * Layer 2 — PassiveConnectorBinding (runtime config + locator; secrets stay out of descriptor)
 * Layer 3 — SourceDocumentLink (shared with localFolder: source ↔ doc projection)
 *
 * localFolder remains first-class with dedicated RPCs; git/cloud/mail reuse this contract.
 */

import type { KnowledgeSourceKind } from "./source-descriptor.js";

export type PassiveConnectorKind = Extract<
  KnowledgeSourceKind,
  "localFolder" | "gitRepo" | "cloudDrive" | "mailAttachment"
>;

export const PASSIVE_CONNECTOR_KINDS: readonly PassiveConnectorKind[] = [
  "localFolder",
  "gitRepo",
  "cloudDrive",
  "mailAttachment",
] as const;

export function isPassiveConnectorKind(kind: string): kind is PassiveConnectorKind {
  return (PASSIVE_CONNECTOR_KINDS as readonly string[]).includes(kind);
}

export type PassiveConnectorDeletePolicy = "sync" | "snapshot";
export type PassiveConnectorBindingStatus = "idle" | "scanning" | "error" | "not_ready";

/**
 * Layer 2 — runtime binding.
 * - `locator` is provider-specific but never a secret: git HTTPS URL, drive folder id, mailbox.
 * - Device-local absolute paths for localFolder stay on LocalFolderBinding, not here.
 */
export type PassiveConnectorBinding = {
  bindingId: string;
  sourceDescriptorId: string;
  knowledgeBaseId: string;
  kind: PassiveConnectorKind;
  /** Friendly cloud-visible label (mirrored on SourceDescriptor.title). */
  label: string;
  /**
   * Non-secret locator:
   * - gitRepo: remote URL or owner/repo
   * - cloudDrive: provider:folderId
   * - mailAttachment: mailbox or account id
   */
  locator: string;
  deviceId?: string;
  deletePolicy: PassiveConnectorDeletePolicy;
  /** Opaque string config (branch, globs, provider id) — no tokens/passwords. */
  config: Record<string, string>;
  status: PassiveConnectorBindingStatus;
  lastSyncAt?: number;
  lastEventAt?: number;
  lastError?: string;
  createdAtMs: number;
  updatedAtMs: number;
};

// --- Shared sync inventory (same shape as local-folder managed_push) ---

export type PassiveConnectorSyncCandidate = {
  relativePath: string;
  rawHash?: string;
  sizeBytes?: number;
  mtimeMs?: number;
};

export type PassiveConnectorSyncNeedUpload = {
  relativePath: string;
  reason: "missing" | "hash_mismatch" | "no_hash";
  docId: string;
};

export type PassiveConnectorBindRequest = {
  kind: PassiveConnectorKind;
  knowledgeBaseId: string;
  label: string;
  locator: string;
  deviceId?: string;
  deletePolicy?: PassiveConnectorDeletePolicy;
  config?: Record<string, string>;
};

export type PassiveConnectorBindResponse = {
  sourceDescriptorId: string;
  bindingId: string;
  kind: PassiveConnectorKind;
  label: string;
  knowledgeBaseId: string;
  /** True when the provider can list/fetch content today. */
  providerReady: boolean;
};

export type PassiveConnectorScanNowRequest = {
  bindingId?: string;
  sourceDescriptorId?: string;
};

export type PassiveConnectorUnbindRequest = {
  bindingId?: string;
  sourceDescriptorId?: string;
  purgeProjected?: boolean;
};

export type PassiveConnectorStatusRequest = {
  bindingId?: string;
  sourceDescriptorId?: string;
  knowledgeBaseId?: string;
  kind?: PassiveConnectorKind;
};

export type PassiveConnectorStatusItem = {
  bindingId: string;
  sourceDescriptorId: string;
  knowledgeBaseId: string;
  kind: PassiveConnectorKind;
  label: string;
  locator: string;
  status: PassiveConnectorBindingStatus;
  deletePolicy: PassiveConnectorDeletePolicy;
  providerReady: boolean;
  lastSyncAt?: number;
  lastEventAt?: number;
  lastError?: string;
  activeDocumentCount?: number;
};

export type PassiveConnectorSyncPlanRequest = {
  bindingId?: string;
  sourceDescriptorId?: string;
  candidates: PassiveConnectorSyncCandidate[];
};

export type PassiveConnectorSyncPlanResponse = {
  bindingId: string;
  sourceDescriptorId: string;
  kind: PassiveConnectorKind;
  needUpload: PassiveConnectorSyncNeedUpload[];
  unchanged: string[];
  missingOnDevice: string[];
};

export type PassiveConnectorSyncCommitFile = {
  relativePath: string;
  fileName?: string;
  mimeType?: string;
  contentBase64?: string;
  textContent?: string;
  rawHash?: string;
};

export type PassiveConnectorSyncCommitRequest = {
  bindingId?: string;
  sourceDescriptorId?: string;
  files: PassiveConnectorSyncCommitFile[];
  deletedRelativePaths?: string[];
  applyDeletes?: boolean;
};

export type PassiveConnectorSyncCommitResponse = {
  bindingId: string;
  sourceDescriptorId: string;
  kind: PassiveConnectorKind;
  ingested: number;
  skipped: number;
  tombstoned: number;
  snapshotted: number;
  errors: string[];
};

export const PASSIVE_CONNECTOR_PROVIDER_NOT_READY_MESSAGE =
  "provider adapter is scaffolded (P5); full list/fetch lands with the connector adapter";
