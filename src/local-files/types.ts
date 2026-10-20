/**
 * Shared types for the local disk read grant protocol.
 *
 * Design: docs/design/openbot-local-disk-read-grant-2026-09-29.md (v0.2.1 r2).
 * Section references in comments point at that document.
 */

/** The complete command surface of the `local-files-readonly` profile (design 4.2). */
export const LOCAL_FILES_OPERATIONS = [
  "fs.stat",
  "fs.list",
  "fs.read",
  "archive.list",
  "archive.readEntry",
] as const;

export type LocalFilesOperation = (typeof LOCAL_FILES_OPERATIONS)[number];

export function isLocalFilesOperation(value: unknown): value is LocalFilesOperation {
  return typeof value === "string" && (LOCAL_FILES_OPERATIONS as readonly string[]).includes(value);
}

/** Capability profile name. Part of connection identity, not a node self-declaration (design 9.5). */
export const LOCAL_FILES_READONLY_PROFILE = "local-files-readonly";

/**
 * The three token kinds share one signing scheme but have separate nonce spaces,
 * so a resolve ticket's nonce can never be redeemed for a read (design 9.3).
 */
export const CAPABILITY_KINDS = ["resolve-ticket", "turn-authorization", "invocation"] as const;
export type CapabilityKind = (typeof CAPABILITY_KINDS)[number];

/** Only `exact` exists. There is deliberately no `directory-tree` scope (design 9.2). */
export type CapabilityScope = "exact";

export type CapabilityTargetKind = "file" | "directory";

export type GrantSource = "user-directed" | "user-approved-once";

/**
 * Device number + inode, as observed by the node during resolve.
 *
 * This is the anti-swap anchor: the final open re-checks it via `fstat` on the
 * already-open descriptor, so a path that was replaced between resolve and read
 * fails instead of silently reading the substitute (design 9.1 step 4).
 */
export type FileIdentity = {
  dev: string;
  ino: string;
};

/**
 * Binding claims present on every token. A capability is only valid for this
 * exact tuple, so it cannot be replayed into another tenant, user, digital
 * human, session, turn or device (design 9.2).
 */
export type CapabilityBinding = {
  tenantId: string;
  userId: string;
  agentId: string;
  sessionKey: string;
  turnId: string;
  nodeId: string;
  /** Raw Ed25519 public key (base64url) of the bound device. */
  devicePublicKey: string;
};

/** Per-turn budget for a bounded task (design 9.2). */
export type TurnBudget = {
  maxEntriesRead: number;
  maxTotalExpandedBytes: number;
  maxCalls: number;
};

/**
 * Stage one of two-phase path resolution.
 *
 * Carries the raw, un-normalized user path. The gateway cannot expand `~` or
 * resolve symlinks for a foreign filesystem, so only the node may do it, and
 * only while holding this ticket (design 9.1).
 */
export type ResolveTicketClaims = {
  kind: "resolve-ticket";
  ticketId: string;
  binding: CapabilityBinding;
  /** Raw path exactly as the user wrote it. Never normalized gateway-side. */
  rawPath: string;
  /** The operation the caller intends to perform once resolution succeeds. */
  intendedOperation: LocalFilesOperation;
  nonce: string;
  issuedAtMs: number;
  expiresAtMs: number;
};

/**
 * Stage two: what the user authorized for this turn, against an already-resolved
 * target. Held and signed by the gateway (design 9.2).
 */
export type TurnAuthorizationClaims = {
  kind: "turn-authorization";
  authorizationId: string;
  binding: CapabilityBinding;
  /** Canonical path as returned by the node, not gateway string concatenation. */
  canonicalPath: string;
  fileId: FileIdentity;
  targetKind: CapabilityTargetKind;
  scope: CapabilityScope;
  operations: LocalFilesOperation[];
  budget: TurnBudget;
  grantSource: GrantSource;
  issuedAtMs: number;
  expiresAtMs: number;
};

/**
 * Derived per `node.invoke`. Always single-use with its own nonce; the node
 * refuses any read that does not carry one (design 9.2).
 */
export type InvocationCapabilityClaims = {
  kind: "invocation";
  capabilityId: string;
  /** Links back to the Turn authorization this was derived from. */
  authorizationId: string;
  binding: CapabilityBinding;
  canonicalPath: string;
  fileId: FileIdentity;
  targetKind: CapabilityTargetKind;
  scope: CapabilityScope;
  /** Exactly one operation per invocation capability. */
  operation: LocalFilesOperation;
  /** Entry path inside the archive, for `archive.readEntry` only. */
  archiveEntryPath?: string;
  useCount: 1;
  nonce: string;
  issuedAtMs: number;
  expiresAtMs: number;
};

export type CapabilityClaims =
  | ResolveTicketClaims
  | TurnAuthorizationClaims
  | InvocationCapabilityClaims;

/** Wire envelope. `claimsJSON` is canonical JSON; the signature covers those exact bytes. */
export type SignedCapability = {
  alg: "Ed25519";
  keyId: string;
  claimsJSON: string;
  /** Base64url Ed25519 signature over `claimsJSON`. */
  signature: string;
};

/**
 * Device binding: the sole routing authority for "which device, which user,
 * which digital humans" (design 4.3). Display names are never routing keys.
 */
/**
 * Exact path the user chose to remember with Always.
 *
 * Scope stays `exact`: remembering a directory list does not grant child reads,
 * and a hard-deny path is never stored here.
 */
export type RememberedLocalGrant = {
  canonicalPath: string;
  operations: LocalFilesOperation[];
  targetKind: CapabilityTargetKind;
};

export type LocalDeviceBinding = {
  tenantId: string;
  userId: string;
  nodeId: string;
  /** Raw Ed25519 public key (base64url). */
  devicePublicKey: string;
  allowedAgentIds: string[];
  capabilityProfile: typeof LOCAL_FILES_READONLY_PROFILE;
  status: "active" | "revoked";
  createdAtMs: number;
  revokedAtMs?: number;
  /** Standing exact-path grants from Allow Always. Absent on older records. */
  rememberedGrants?: RememberedLocalGrant[];
};

/** Uniform denial surfaced to the model. Never leaks existence, size, inode or type (design 9.1). */
export const LOCAL_FILES_OPAQUE_DENIAL = "该位置不可授权";

/**
 * Transport code the node returns with a refusal, for the gateway audit only.
 *
 * A closed set, and deliberately coarse. It exists because the audit has to tell a
 * redemption refusal apart from an open failure (design 10.4 wants both as separate
 * records) while the node's own `detail` string must not travel: `detail` embeds
 * errno text and therefore paths, and design 4.12 forbids a full local path in an
 * operational log. An enum cannot carry a path.
 *
 * This never reaches the model. The tool result is always the opaque denial.
 */
export const LOCAL_FILES_FAILURE_CLASSES = [
  /** Policy, identity, signature or budget refusal. The default. */
  "PERMISSION_DENIED",
  /** The gateway declined to redeem the capability, so no disk access happened. */
  "REDEMPTION_REFUSED",
  /** Redemption succeeded but the open, stat or read failed (design 9.6 case 17). */
  "OPEN_FAILED",
] as const;

export type LocalFilesFailureClass = (typeof LOCAL_FILES_FAILURE_CLASSES)[number];

/** Maximum accepted clock skew between gateway and node (design 9.3). */
export const CAPABILITY_CLOCK_SKEW_MS = 60_000;

/** Default bounded-task budget for inspecting a ZIP (design 9.2). */
export const ARCHIVE_TASK_BUDGET: TurnBudget = {
  maxEntriesRead: 30,
  maxTotalExpandedBytes: 5 * 1024 * 1024,
  maxCalls: 32,
};

/** Default budget for a single non-archive operation. */
export const SINGLE_CALL_BUDGET: TurnBudget = {
  maxEntriesRead: 1,
  maxTotalExpandedBytes: 2 * 1024 * 1024,
  maxCalls: 1,
};

/** Return and size ceilings (design 4.10). */
export const LOCAL_FILES_LIMITS = {
  /** `fs.list` returns at most this many direct children, never recursive. */
  maxListEntries: 200,
  /** Business-layer cap for one text read. Not the 25 MiB websocket frame cap. */
  maxSingleReadBytes: 2 * 1024 * 1024,
  /** Cumulative cap across one turn; chunked reads may not be used to exceed it. */
  maxTurnTotalBytes: 10 * 1024 * 1024,
} as const;
