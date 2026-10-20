/**
 * Cross-agent Artifact Grant types (Account Computer companion ACL).
 * Landing: ARTIFACT_GRANT_MVP
 */

export const ARTIFACT_GRANT_LANDING = "ARTIFACT_GRANT_MVP" as const;

export type ArtifactGrantScope = "read";

export type ArtifactRecord = {
  artifactId: string;
  userId: string;
  publisherAgentId: string;
  name: string;
  contentType: string;
  sha256: string;
  byteLength: number;
  createdAt: number;
};

export type ArtifactGrant = {
  grantId: string;
  artifactId: string;
  userId: string;
  publisherAgentId: string;
  granteeAgentId: string;
  scopes: ArtifactGrantScope[];
  expiresAt: number;
  singleUse: boolean;
  revokedAt?: number;
  redeemedCount: number;
  createdAt: number;
};

export type ArtifactAuditEvent = {
  at: number;
  type: "publish" | "grant.create" | "grant.redeem" | "grant.revoke" | "grant.deny";
  userId: string;
  actorAgentId: string;
  artifactId?: string;
  grantId?: string;
  reason?: string;
};

export type PublishInput = {
  userId: string;
  publisherAgentId: string;
  name: string;
  contentType?: string;
  /** UTF-8 text or raw bytes as Buffer/Uint8Array. */
  content: string | Uint8Array;
};

export type CreateGrantInput = {
  userId: string;
  publisherAgentId: string;
  artifactId: string;
  granteeAgentId: string;
  /** TTL in milliseconds from now. */
  ttlMs: number;
  singleUse?: boolean;
  scopes?: ArtifactGrantScope[];
  nowMs?: number;
};

export type RedeemInput = {
  userId: string;
  actorAgentId: string;
  grantId: string;
  nowMs?: number;
};

export type RevokeInput = {
  userId: string;
  actorAgentId: string;
  grantId: string;
  nowMs?: number;
};

export type RedeemSuccess = {
  ok: true;
  grant: ArtifactGrant;
  artifact: ArtifactRecord;
  content: Buffer;
  text: string | null;
};

export type GrantFailureReason =
  | "artifact_not_found"
  | "grant_not_found"
  | "not_publisher"
  | "not_grantee"
  | "revoked"
  | "expired"
  | "single_use_exhausted"
  | "scope_denied"
  | "invalid_ttl"
  | "invalid_identity"
  | "user_mismatch";

export type GrantFailure = {
  ok: false;
  reason: GrantFailureReason;
};
