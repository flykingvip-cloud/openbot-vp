/**
 * S01 D1–D4 non-production design contract.
 *
 * Lives under docs/design/contracts so it is not a production src entry.
 * Not wired to get-reply.ts, src/memory/**, or workspace-resolver/** callers.
 * Not a second MemoryWorkspaceHandle production entry; U0 remains
 * src/memory/memory-workspace-handle.ts.
 *
 * Trust boundary: presented wire material is never compared to itself.
 * HMAC/attestation secrets and proxy allowlists live only on S01ServerSourceContext
 * / attestationSecret (test secrets allowed). Production issue() must take those
 * from platform-auth, not from tool/body/cwd fields.
 *
 * Workspace Handle resourceId is independent of CogniWeave Memory Asset
 * resourceId. Tests inject the approved InMemoryWorkspaceResourceCatalog adapter
 * and an in-memory S01PlatformAuthMembershipPort (not a caller-injected array).
 */
import { createHmac } from "node:crypto";
import path from "node:path";
import { z } from "zod";

export const S01_D1D5_WIRED_TO_GET_REPLY = false;
export const S01_D1D5_PRODUCTION_CATALOG_WRITE = "none" as const;
export const S01_D1D5_PRODUCTION_SRC_MODULE = false;
export const S01_D1D5_SECOND_MEMORY_WORKSPACE_HANDLE_ENTRY = false;
export const S01_MEMORY_ASSET_RESOURCE_ID_INDEPENDENT_OF_WORKSPACE_HANDLE = true;
export const S01_WORKSPACE_HANDLE_PERSISTENT_PK = "resourceId" as const;
export const S01_PRINCIPAL_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const S01_ATTESTATION_DOMAIN = "s01-trusted-principal-v1";
/** Non-production only. Production must inject the platform-auth issuer secret. */
export const S01_ATTESTATION_TEST_SECRET = "s01-nonprod-attestation-test-secret";
/** Non-production only. Production must derive HMAC from the session-cookie secret. */
export const S01_SESSION_HMAC_TEST_SECRET = "s01-nonprod-session-hmac-test-secret";
export const S01_INDEPENDENT_CATALOG_TABLES = [
  "workspace_handles",
  "authorized_cwds",
  "tenant_memberships",
] as const;
/** Brand marker only. Not an attested identity field. */
export const S01_TRUSTED_PRINCIPAL_BRAND = "S01TrustedPrincipal/v1" as const;
/** Readiness A does not flip unique-handoff implementationVerified. */
export const S01_IMPLEMENTATION_VERIFIED = false;
export const S01_PRODUCTION_WIRED = false;
export const S01_BUILTIN_STEWARD_AGENT_ID = "main" as const;

export type SessionDomain = "platform" | "enterprise" | "employee";
export type S01PrincipalKind = "platform" | "managed-enterprise" | "managed-employee";
export type TrustedPrincipalSource =
  | "platform-auth-session"
  | "trusted-proxy-header"
  | "device-token";

export type VerifiedSessionContext = {
  userId: string;
  tenantId: string;
  sessionDomain: SessionDomain;
  source: TrustedPrincipalSource;
  sessionId: string;
};

export type WireIdentityProbe = {
  userId?: string;
  tenantId?: string;
  resourceId?: string;
  ownerId?: string;
  principal?: unknown;
  executedBy?: unknown;
};

/**
 * Caller-presented material only. MUST NOT contain expectedHmac, expectedToken,
 * or the proxy allowlist — those belong on S01ServerSourceContext.
 */
export type S01PresentedSourceProof =
  | {
      source: "platform-auth-session";
      sessionId: string;
      hmac: string;
    }
  | {
      source: "trusted-proxy-header";
      clientIp: string;
      trustedUserHeader: string;
    }
  | {
      source: "device-token";
      token: string;
    };

/** @deprecated Use S01PresentedSourceProof. Kept as an alias for handoff wording. */
export type S01SourceProof = S01PresentedSourceProof;

/**
 * Server-owned verification material. Production binds this to platform-auth
 * secrets / gateway proxy config. Tests inject dedicated test secrets.
 */
export type S01ServerSourceContext =
  | {
      source: "platform-auth-session";
      sessionHmacSecret: string;
    }
  | {
      source: "trusted-proxy-header";
      ipAllowlist: readonly string[];
    }
  | {
      source: "device-token";
      expectedToken: string;
    };

export type S01TrustMaterial = {
  attestationSecret: string;
  source: S01ServerSourceContext;
};

export type TrustedPrincipal = {
  userId: string;
  tenantId: string;
  sessionDomain: SessionDomain;
  source: TrustedPrincipalSource;
  sessionId: string;
  resolvedAt: number;
  attestation: string;
};

export const verifiedSessionContextSchema = z.object({
  userId: z.string().min(1),
  tenantId: z.string().min(1),
  sessionDomain: z.enum(["platform", "enterprise", "employee"]),
  source: z.enum(["platform-auth-session", "trusted-proxy-header", "device-token"]),
  sessionId: z.string().min(1),
});

export const trustedPrincipalSchema = verifiedSessionContextSchema.extend({
  resolvedAt: z.number().finite(),
  attestation: z.string().min(1),
});

export type WorkspaceCapability = "read" | "write" | "execute" | "list";
export type S01CatalogLifecycleState = "active" | "read_only" | "retired";
export type S01CatalogBindingRole = "canonical" | "compatibility";
export type S01CatalogBindingState = "active" | "read_only" | "retired";

export type S01CatalogOwnerScope =
  | { kind: "user_owned"; userId: string }
  | { kind: "position_owned"; seatId: string }
  | { kind: "group_owned"; groupId: string }
  | { kind: "unknown"; reason: string };

export type S01CatalogResourceView = {
  resourceId: string;
  resourceType: string;
  tenantId: string | null;
  ownerScope: S01CatalogOwnerScope;
  lifecycleState: S01CatalogLifecycleState;
};

export type S01CatalogBindingView = {
  bindingId: string;
  resourceId: string;
  role: S01CatalogBindingRole;
  locator: string;
  state: S01CatalogBindingState;
  contentVersion: string;
};

/** Structural Catalog port. Production resolver modules are not imported here. */
export type S01CatalogViewPort = {
  snapshot(): {
    status: "available" | "unavailable";
    resources: Record<string, S01CatalogResourceView>;
    bindings?: Record<string, S01CatalogBindingView>;
  };
  getResource(resourceId: string): S01CatalogResourceView | null;
  listBindingsForResource(resourceId: string): S01CatalogBindingView[];
};

export type WorkspaceHandleFencing = {
  contentVersion: string;
  bindingId: string;
};

export type WorkspaceHandleView = {
  id: string;
  kind: "workspace";
  tenantId: string | null;
  ownerId: string;
  ownerScope: S01CatalogOwnerScope;
  rootPath: string;
  capabilities: WorkspaceCapability[];
  state: S01CatalogLifecycleState;
  bindingId: string;
  bindingRole: S01CatalogBindingRole;
  bindingState: S01CatalogBindingState;
  fencing: WorkspaceHandleFencing;
  provenance: {
    source: "workspace-resource-catalog";
    bindingRole: S01CatalogBindingRole;
    contentVersion: string;
  };
};

export type PlatformAuthMembershipView = {
  userId: string;
  tenantId: string;
};

/**
 * Read-only Platform Auth membership SoT port. Callers MUST NOT pass a
 * tool/wire-supplied memberships[] array. Tests inject an in-memory adapter.
 */
export type S01PlatformAuthMembershipPort = {
  resolveMembership(userId: string): PlatformAuthMembershipView | null;
  userHasSeat(userId: string, seatId: string): boolean;
  userInGroup(userId: string, groupId: string): boolean;
};

export type S01AuthorizedToolCwdErrorCode =
  | "ERR_PRINCIPAL_REQUIRED"
  | "ERR_TENANT_BINDING_REQUIRED"
  | "ERR_WORKSPACE_NOT_FOUND"
  | "ERR_TENANT_MISMATCH"
  | "ERR_CAPABILITY_DENIED"
  | "ERR_WORKSPACE_ARCHIVED"
  | "ERR_BINDING_NOT_CANONICAL"
  | "ERR_PATH_OUTSIDE_WORKSPACE"
  | "ERR_CATALOG_UNAVAILABLE"
  | "ERR_INVALID_PATH"
  | "ERR_WORKSPACE_OWNER_DENIED";

export const s01AuthorizedToolCwdErrorCodeSchema = z.enum([
  "ERR_PRINCIPAL_REQUIRED",
  "ERR_TENANT_BINDING_REQUIRED",
  "ERR_WORKSPACE_NOT_FOUND",
  "ERR_TENANT_MISMATCH",
  "ERR_CAPABILITY_DENIED",
  "ERR_WORKSPACE_ARCHIVED",
  "ERR_BINDING_NOT_CANONICAL",
  "ERR_PATH_OUTSIDE_WORKSPACE",
  "ERR_CATALOG_UNAVAILABLE",
  "ERR_INVALID_PATH",
  "ERR_WORKSPACE_OWNER_DENIED",
]);

export type S01StewardWorkspaceIdentityPort = {
  resolveStewardResourceId(input: {
    tenantId: string;
    userId: string;
    agentId: string;
  }): string | null;
};

export type S01AuthorizationContext = {
  targetResourceId?: string;
  stewardAgentId?: string;
  identity?: S01StewardWorkspaceIdentityPort;
  symlinkFollowed?: boolean;
  personalFallback?: boolean;
  hostCwdFallback?: boolean;
};

export type EvaluateS01AuthorizedToolCwdParams = {
  catalog: S01CatalogViewPort;
  principal: TrustedPrincipal | null;
  requestedCwd: string;
  operation: WorkspaceCapability;
  memberships: S01PlatformAuthMembershipPort;
  attestationSecret: string;
  /** Stable Catalog resourceId. Required; path-only unique selection is forbidden. */
  targetResourceId: string;
  /** Design discussion only. This contract never grants S01 production fallback. */
  allowAnonymousLocal?: boolean;
  now?: number;
  expectedFencing?: WorkspaceHandleFencing;
  authorizationContext?: S01AuthorizationContext;
  identity?: S01StewardWorkspaceIdentityPort;
  stewardAgentId?: string;
  symlinkFollowed?: boolean;
};

export type S01AuthorizedToolCwdAudit = {
  decision: "allowed" | "denied";
  sessionId?: string;
  resolvedAt?: number;
  principalSource?: TrustedPrincipalSource;
  actor?: string;
  tenantId?: string;
  resourceId?: string;
  provenance?: TrustedPrincipalSource;
  auditRecordId?: string;
  code?: S01AuthorizedToolCwdErrorCode;
  symlinkSafety?: "lexical-only-caller-must-lstat" | "denied-unverified";
};

export type EvaluateS01AuthorizedToolCwdResult =
  | {
      ok: true;
      resolvedPath: string;
      handle: WorkspaceHandleView;
      accessMode: "authorized";
      userMessage: string;
      symlinkSafety: "lexical-only-caller-must-lstat";
      audit: S01AuthorizedToolCwdAudit;
    }
  | {
      ok: false;
      code: S01AuthorizedToolCwdErrorCode;
      message: string;
      userMessage: string;
      failClosed: true;
      retryable: false;
      symlinkSafety?: "denied-unverified";
      audit: S01AuthorizedToolCwdAudit;
    };

function fail(
  code: S01AuthorizedToolCwdErrorCode,
  message: string,
  audit: Omit<S01AuthorizedToolCwdAudit, "decision" | "code"> = {},
  extras: { symlinkSafety?: "denied-unverified" } = {},
): Extract<EvaluateS01AuthorizedToolCwdResult, { ok: false }> {
  return {
    ok: false,
    code,
    message,
    userMessage: message,
    failClosed: true,
    retryable: false,
    ...extras,
    audit: {
      decision: "denied",
      code,
      ...audit,
    },
  };
}

export function classifyS01PrincipalKind(domain: SessionDomain): S01PrincipalKind {
  if (domain === "platform") {
    return "platform";
  }
  if (domain === "enterprise") {
    return "managed-enterprise";
  }
  return "managed-employee";
}

export function principalExpiry(resolvedAt: number): number {
  return resolvedAt + S01_PRINCIPAL_MAX_AGE_MS;
}

export function wireIdentityPresent(probe: WireIdentityProbe | undefined): boolean {
  if (!probe) {
    return false;
  }
  const strings = [probe.userId, probe.tenantId, probe.resourceId, probe.ownerId];
  if (strings.some((value) => typeof value === "string" && value.length > 0)) {
    return true;
  }
  if (probe.principal != null && probe.principal !== "") {
    return true;
  }
  if (probe.executedBy != null && probe.executedBy !== "") {
    return true;
  }
  return false;
}

export function createInMemoryS01StewardIdentityPort(
  rows: ReadonlyArray<{
    tenantId: string;
    userId: string;
    agentId: string;
    resourceId: string;
  }>,
): S01StewardWorkspaceIdentityPort {
  return {
    resolveStewardResourceId(input): string | null {
      const matches = rows.filter(
        (row) =>
          row.tenantId === input.tenantId &&
          row.userId === input.userId &&
          row.agentId === input.agentId,
      );
      return matches.length === 1 ? (matches[0]?.resourceId ?? null) : null;
    },
  };
}

function secretEqual(left: string, right: string): boolean {
  if (left.length !== right.length || left.length === 0) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

export function signS01SessionHmac(secret: string, sessionId: string): string {
  return createHmac("sha256", secret).update(sessionId).digest("base64url");
}

export function attestVerifiedSession(
  session: VerifiedSessionContext,
  resolvedAt: number,
  attestationSecret: string,
): string {
  return createHmac("sha256", attestationSecret)
    .update(S01_ATTESTATION_DOMAIN)
    .update("\0")
    .update(session.userId)
    .update("\0")
    .update(session.tenantId)
    .update("\0")
    .update(session.sessionDomain)
    .update("\0")
    .update(session.source)
    .update("\0")
    .update(session.sessionId)
    .update("\0")
    .update(String(resolvedAt))
    .digest("hex");
}

export function s01AuditRecordId(
  principal: TrustedPrincipal,
  requestedCwd: string,
  operation: WorkspaceCapability,
): string {
  return createHmac("sha256", principal.attestation)
    .update("s01-authorized-cwd-audit-v1")
    .update("\0")
    .update(principal.sessionId)
    .update("\0")
    .update(requestedCwd)
    .update("\0")
    .update(operation)
    .digest("hex");
}

export function verifySourceProof(
  session: VerifiedSessionContext,
  presented: S01PresentedSourceProof,
  server: S01ServerSourceContext,
): boolean {
  if (presented.source !== session.source || server.source !== session.source) {
    return false;
  }
  switch (presented.source) {
    case "platform-auth-session": {
      if (server.source !== "platform-auth-session") {
        return false;
      }
      if (presented.sessionId !== session.sessionId || presented.hmac.length < 1) {
        return false;
      }
      if (server.sessionHmacSecret.length < 1) {
        return false;
      }
      const expected = signS01SessionHmac(server.sessionHmacSecret, session.sessionId);
      return secretEqual(presented.hmac, expected);
    }
    case "trusted-proxy-header": {
      if (server.source !== "trusted-proxy-header") {
        return false;
      }
      return (
        server.ipAllowlist.length > 0 &&
        server.ipAllowlist.includes(presented.clientIp) &&
        presented.trustedUserHeader.length > 0 &&
        presented.trustedUserHeader === session.userId
      );
    }
    case "device-token": {
      if (server.source !== "device-token") {
        return false;
      }
      return (
        presented.token.length > 0 &&
        server.expectedToken.length > 0 &&
        secretEqual(presented.token, server.expectedToken)
      );
    }
  }
}

/**
 * The only constructor for a trusted principal. Identity is taken from a
 * verified session context after source-specific proof succeeds against
 * server-owned secrets. Tool/wire fields are refused even when they match.
 */
export function issueTrustedPrincipal(params: {
  verifiedSession: VerifiedSessionContext;
  presentedProof: S01PresentedSourceProof;
  trust: S01TrustMaterial;
  resolvedAt?: number;
  wireIdentity?: WireIdentityProbe;
}): TrustedPrincipal | null {
  if (wireIdentityPresent(params.wireIdentity)) {
    return null;
  }
  if (
    typeof params.trust.attestationSecret !== "string" ||
    params.trust.attestationSecret.length < 1
  ) {
    return null;
  }
  const session = verifiedSessionContextSchema.safeParse(params.verifiedSession);
  if (!session.success) {
    return null;
  }
  if (!verifySourceProof(session.data, params.presentedProof, params.trust.source)) {
    return null;
  }
  const resolvedAt = params.resolvedAt ?? Date.now();
  if (!Number.isFinite(resolvedAt)) {
    return null;
  }
  return Object.freeze({
    ...session.data,
    resolvedAt,
    attestation: attestVerifiedSession(session.data, resolvedAt, params.trust.attestationSecret),
  });
}

export function parseTrustedPrincipal(
  input: unknown,
  now: number,
  attestationSecret: string,
): TrustedPrincipal | null {
  if (typeof attestationSecret !== "string" || attestationSecret.length < 1) {
    return null;
  }
  const parsed = trustedPrincipalSchema.safeParse(input);
  if (!parsed.success) {
    return null;
  }
  const expected = attestVerifiedSession(parsed.data, parsed.data.resolvedAt, attestationSecret);
  if (!secretEqual(expected, parsed.data.attestation)) {
    return null;
  }
  if (now < parsed.data.resolvedAt || now - parsed.data.resolvedAt > S01_PRINCIPAL_MAX_AGE_MS) {
    return null;
  }
  return Object.freeze(parsed.data);
}

export function ownerIdFromScope(resource: S01CatalogResourceView): string | null {
  switch (resource.ownerScope.kind) {
    case "user_owned":
      return resource.ownerScope.userId;
    case "position_owned":
      return resource.ownerScope.seatId;
    case "group_owned":
      return resource.ownerScope.groupId;
    case "unknown":
      return null;
  }
}

export function deriveCapabilitiesFromBinding(
  binding: S01CatalogBindingView,
): WorkspaceCapability[] {
  if (binding.state === "retired") {
    return [];
  }
  if (binding.role !== "canonical") {
    return [];
  }
  if (binding.state === "read_only") {
    return ["read", "list"];
  }
  return ["read", "write", "execute", "list"];
}

function uniqueCanonicalBinding(
  catalog: S01CatalogViewPort,
  resourceId: string,
): S01CatalogBindingView | null {
  const canonical = catalog
    .listBindingsForResource(resourceId)
    .filter((binding) => binding.role === "canonical");
  if (canonical.length !== 1) {
    return null;
  }
  return canonical[0] ?? null;
}

export function projectWorkspaceHandleView(
  catalog: S01CatalogViewPort,
  resourceId: string,
): WorkspaceHandleView | null {
  const resource = catalog.getResource(resourceId);
  if (!resource || resource.resourceType !== "workspace") {
    return null;
  }
  const ownerId = ownerIdFromScope(resource);
  const binding = uniqueCanonicalBinding(catalog, resourceId);
  if (!ownerId || !binding || !binding.contentVersion) {
    return null;
  }
  if (!isAbsoluteLocator(binding.locator)) {
    return null;
  }
  return {
    id: resource.resourceId,
    kind: "workspace",
    tenantId: resource.tenantId,
    ownerId,
    ownerScope: resource.ownerScope,
    rootPath: binding.locator,
    capabilities: deriveCapabilitiesFromBinding(binding),
    state: resource.lifecycleState,
    bindingId: binding.bindingId,
    bindingRole: binding.role,
    bindingState: binding.state,
    fencing: {
      contentVersion: binding.contentVersion,
      bindingId: binding.bindingId,
    },
    provenance: {
      source: "workspace-resource-catalog",
      bindingRole: binding.role,
      contentVersion: binding.contentVersion,
    },
  };
}

export type WorkspaceHandleProjectionFailure = {
  ok: false;
  code:
    | "ERR_WORKSPACE_NOT_FOUND"
    | "ERR_BINDING_NOT_CANONICAL"
    | "ERR_WORKSPACE_OWNER_DENIED"
    | "ERR_INVALID_PATH";
};

export function inspectWorkspaceHandleProjection(
  catalog: S01CatalogViewPort,
  resourceId: string,
): { ok: true; handle: WorkspaceHandleView } | WorkspaceHandleProjectionFailure {
  const resource = catalog.getResource(resourceId);
  if (!resource || resource.resourceType !== "workspace") {
    return { ok: false, code: "ERR_WORKSPACE_NOT_FOUND" };
  }
  const ownerId = ownerIdFromScope(resource);
  if (!ownerId) {
    return { ok: false, code: "ERR_WORKSPACE_OWNER_DENIED" };
  }
  const bindings = catalog.listBindingsForResource(resourceId);
  const canonical = bindings.filter((binding) => binding.role === "canonical");
  if (canonical.length > 1) {
    return { ok: false, code: "ERR_WORKSPACE_NOT_FOUND" };
  }
  if (canonical.length !== 1) {
    return { ok: false, code: "ERR_BINDING_NOT_CANONICAL" };
  }
  const binding = canonical[0];
  if (!binding || !binding.contentVersion) {
    return { ok: false, code: "ERR_BINDING_NOT_CANONICAL" };
  }
  const locator = parseS01Locator(binding.locator);
  if (!locator.ok) {
    return { ok: false, code: "ERR_INVALID_PATH" };
  }
  const handle = projectWorkspaceHandleView(catalog, resourceId);
  if (!handle) {
    return { ok: false, code: "ERR_WORKSPACE_NOT_FOUND" };
  }
  return { ok: true, handle };
}

function isAbsoluteLocator(locator: string): boolean {
  return parseS01Locator(locator).ok;
}

export function parseS01Locator(
  value: string,
): { ok: true; path: string } | { ok: false; reason: "invalid" } {
  if (typeof value !== "string" || value.length < 1 || value.includes("\0")) {
    return { ok: false, reason: "invalid" };
  }
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (decoded.includes("%")) {
    return { ok: false, reason: "invalid" };
  }
  if (!decoded.startsWith("/") || decoded.includes("\\")) {
    return { ok: false, reason: "invalid" };
  }
  const segments = decoded.split("/");
  for (const segment of segments) {
    if (segment === "." || segment === "..") {
      return { ok: false, reason: "invalid" };
    }
  }
  const normalized = path.posix.normalize(decoded);
  if (normalized.includes("..") || !normalized.startsWith("/")) {
    return { ok: false, reason: "invalid" };
  }
  const trimmed = normalized === "/" ? "/" : normalized.replace(/\/+$/u, "") || "/";
  return { ok: true, path: trimmed };
}

function resolveRequestedLocator(
  requestedCwd: string,
  handleRoot: string,
): { ok: true; path: string } | { ok: false } {
  if (typeof requestedCwd !== "string" || requestedCwd.length < 1) {
    return { ok: false };
  }
  if (requestedCwd.startsWith("/")) {
    return parseS01Locator(requestedCwd);
  }
  if (requestedCwd.includes("\0") || requestedCwd.includes("\\")) {
    return { ok: false };
  }
  const joined = path.posix.join(handleRoot, requestedCwd);
  return parseS01Locator(joined);
}

function isInsideRoot(requested: string, root: string): boolean {
  const req = parseS01Locator(requested);
  const base = parseS01Locator(root);
  if (!req.ok || !base.ok) {
    return false;
  }
  if (req.path === base.path) {
    return true;
  }
  const relative = path.posix.relative(base.path, req.path);
  return relative !== "" && !relative.startsWith("..") && !path.posix.isAbsolute(relative);
}

export function isS01PlatformAuthMembershipPort(
  value: unknown,
): value is S01PlatformAuthMembershipPort {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const port = value as S01PlatformAuthMembershipPort;
  return (
    typeof port.resolveMembership === "function" &&
    typeof port.userHasSeat === "function" &&
    typeof port.userInGroup === "function"
  );
}

export function createInMemoryS01MembershipPort(params: {
  memberships?: readonly PlatformAuthMembershipView[];
  seats?: Readonly<Record<string, readonly string[]>>;
  groups?: Readonly<Record<string, readonly string[]>>;
}): S01PlatformAuthMembershipPort {
  const memberships = params.memberships ?? [];
  const seats = params.seats ?? {};
  const groups = params.groups ?? {};
  return {
    resolveMembership(userId: string): PlatformAuthMembershipView | null {
      const matches = memberships.filter((row) => row.userId === userId);
      if (matches.length !== 1) {
        return null;
      }
      return matches[0] ?? null;
    },
    userHasSeat(userId: string, seatId: string): boolean {
      return (seats[userId] ?? []).includes(seatId);
    },
    userInGroup(userId: string, groupId: string): boolean {
      return (groups[userId] ?? []).includes(groupId);
    },
  };
}

function principalMayUseHandle(
  principal: TrustedPrincipal,
  handle: WorkspaceHandleView,
  catalog: S01CatalogViewPort,
  memberships: S01PlatformAuthMembershipPort,
): boolean {
  const resource = catalog.getResource(handle.id);
  if (!resource) {
    return false;
  }
  switch (resource.ownerScope.kind) {
    case "user_owned":
      return resource.ownerScope.userId === principal.userId;
    case "position_owned":
      return memberships.userHasSeat(principal.userId, resource.ownerScope.seatId);
    case "group_owned":
      return memberships.userInGroup(principal.userId, resource.ownerScope.groupId);
    case "unknown":
      return false;
  }
}

export function queryAllWorkspaceHandleViews(catalog: S01CatalogViewPort): WorkspaceHandleView[] {
  const snapshot = catalog.snapshot();
  const views: WorkspaceHandleView[] = [];
  for (const resource of Object.values(snapshot.resources)) {
    const view = projectWorkspaceHandleView(catalog, resource.resourceId);
    if (view) {
      views.push(view);
    }
  }
  return views;
}

export function queryAuthorizedCwdViews(
  catalog: S01CatalogViewPort,
  principal: TrustedPrincipal,
  memberships: S01PlatformAuthMembershipPort,
): WorkspaceHandleView[] {
  return queryAllWorkspaceHandleViews(catalog).filter(
    (view) =>
      view.tenantId === principal.tenantId &&
      principalMayUseHandle(principal, view, catalog, memberships),
  );
}

function auditActor(principal: TrustedPrincipal): Omit<S01AuthorizedToolCwdAudit, "decision"> {
  return {
    sessionId: principal.sessionId,
    resolvedAt: principal.resolvedAt,
    principalSource: principal.source,
    actor: principal.userId,
    tenantId: principal.tenantId,
    provenance: principal.source,
  };
}

export async function evaluateS01AuthorizedToolCwd(
  params: EvaluateS01AuthorizedToolCwdParams,
): Promise<EvaluateS01AuthorizedToolCwdResult> {
  void params.allowAnonymousLocal;
  const authz = params.authorizationContext ?? {};
  const targetResourceId = params.targetResourceId || authz.targetResourceId || "";
  const identity = params.identity ?? authz.identity;
  const stewardAgentId =
    params.stewardAgentId ?? authz.stewardAgentId ?? S01_BUILTIN_STEWARD_AGENT_ID;
  const symlinkFollowed = params.symlinkFollowed === true || authz.symlinkFollowed === true;
  const fallbackRequested = authz.personalFallback === true || authz.hostCwdFallback === true;

  if (!params.principal) {
    return fail("ERR_PRINCIPAL_REQUIRED", "Trusted principal missing");
  }
  const principal = parseTrustedPrincipal(
    params.principal,
    params.now ?? Date.now(),
    params.attestationSecret,
  );
  if (!principal) {
    return fail("ERR_PRINCIPAL_REQUIRED", "Trusted principal invalid, forged, or expired");
  }
  const actor = auditActor(principal);
  if (fallbackRequested) {
    return fail(
      "ERR_PRINCIPAL_REQUIRED",
      "Anonymous local, host cwd, and personalFallback are not S01 principals",
      actor,
    );
  }
  if (symlinkFollowed) {
    return fail(
      "ERR_INVALID_PATH",
      "Symlink follow is unverified; caller must lstat and deny escape",
      actor,
      { symlinkSafety: "denied-unverified" },
    );
  }

  const operationParsed = z.enum(["read", "write", "execute", "list"]).safeParse(params.operation);
  if (!operationParsed.success) {
    return fail("ERR_CAPABILITY_DENIED", "Operation is not a workspace capability", actor);
  }
  if (!isS01PlatformAuthMembershipPort(params.memberships)) {
    return fail(
      "ERR_TENANT_BINDING_REQUIRED",
      "Membership SoT port missing; arrays are not accepted",
      actor,
    );
  }

  const membership = params.memberships.resolveMembership(principal.userId);
  if (!membership) {
    return fail("ERR_TENANT_BINDING_REQUIRED", "Membership view missing or ambiguous", actor);
  }
  if (membership.tenantId !== principal.tenantId) {
    return fail("ERR_TENANT_MISMATCH", "Principal tenant does not match membership view", actor);
  }

  const snapshot = params.catalog.snapshot();
  if (snapshot.status === "unavailable") {
    return fail("ERR_CATALOG_UNAVAILABLE", "Catalog snapshot unavailable", actor);
  }

  if (typeof targetResourceId !== "string" || targetResourceId.length < 1) {
    return fail(
      "ERR_WORKSPACE_NOT_FOUND",
      "targetResourceId is required; path-only unique selection is forbidden",
      actor,
    );
  }

  if (identity) {
    const mapped = identity.resolveStewardResourceId({
      tenantId: principal.tenantId,
      userId: principal.userId,
      agentId: stewardAgentId,
    });
    if (!mapped) {
      return fail(
        "ERR_WORKSPACE_NOT_FOUND",
        "Registry steward identity missing or ambiguous",
        actor,
      );
    }
    if (mapped !== targetResourceId) {
      return fail(
        "ERR_WORKSPACE_OWNER_DENIED",
        "targetResourceId is not the Registry steward workspace",
        { ...actor, resourceId: targetResourceId },
      );
    }
  }

  const projected = inspectWorkspaceHandleProjection(params.catalog, targetResourceId);
  if (!projected.ok) {
    return fail(projected.code, "Target workspace handle cannot be projected", {
      ...actor,
      resourceId: targetResourceId,
    });
  }
  const handle = projected.handle;
  if (handle.tenantId !== principal.tenantId) {
    return fail("ERR_TENANT_MISMATCH", "Workspace tenant does not match principal", {
      ...actor,
      resourceId: handle.id,
    });
  }
  if (!principalMayUseHandle(principal, handle, params.catalog, params.memberships)) {
    return fail(
      "ERR_WORKSPACE_OWNER_DENIED",
      "Principal is not the owner, seat holder, or group member",
      { ...actor, resourceId: handle.id },
    );
  }
  if (handle.state === "retired" || handle.bindingState === "retired") {
    return fail("ERR_WORKSPACE_ARCHIVED", "Workspace handle is retired or revoked", {
      ...actor,
      resourceId: handle.id,
    });
  }
  if (
    params.expectedFencing &&
    (params.expectedFencing.contentVersion !== handle.fencing.contentVersion ||
      params.expectedFencing.bindingId !== handle.fencing.bindingId)
  ) {
    return fail("ERR_WORKSPACE_ARCHIVED", "Handle fencing token is stale", {
      ...actor,
      resourceId: handle.id,
    });
  }

  const locator = resolveRequestedLocator(params.requestedCwd, handle.rootPath);
  if (!locator.ok) {
    return fail("ERR_INVALID_PATH", "Requested cwd is not a safe structured locator", {
      ...actor,
      resourceId: handle.id,
    });
  }
  if (!isInsideRoot(locator.path, handle.rootPath)) {
    return fail("ERR_PATH_OUTSIDE_WORKSPACE", "Requested cwd is outside handle locator", {
      ...actor,
      resourceId: handle.id,
    });
  }
  if (!handle.capabilities.includes(operationParsed.data)) {
    return fail("ERR_CAPABILITY_DENIED", "Operation is outside binding-derived capabilities", {
      ...actor,
      resourceId: handle.id,
    });
  }

  const auditRecordId = s01AuditRecordId(principal, locator.path, operationParsed.data);
  return {
    ok: true,
    resolvedPath: locator.path,
    handle,
    accessMode: "authorized",
    userMessage: "Authorized workspace locator",
    symlinkSafety: "lexical-only-caller-must-lstat",
    audit: {
      decision: "allowed",
      ...actor,
      resourceId: handle.id,
      auditRecordId,
      symlinkSafety: "lexical-only-caller-must-lstat",
    },
  };
}
