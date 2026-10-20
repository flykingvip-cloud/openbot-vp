/**
 * S01 Stage A: production authorized-cwd evaluator.
 *
 * Requires targetIdentity / targetResourceId. Does not select a workspace by
 * path uniqueness. Does not import docs/design/contracts. Not wired to get-reply.
 */
import { createHmac } from "node:crypto";
import path from "node:path";
import type { WorkspaceResourceCatalog } from "../workspace-resolver/catalog.js";
import type { S01TargetIdentity } from "./s01-steward-workspace-identity.js";

export const S01_PRODUCTION_WIRED_TO_GET_REPLY = false;
export const S01_PRINCIPAL_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const S01_ATTESTATION_DOMAIN = "s01-trusted-principal-v1";

export type S01WorkspaceCapability = "read" | "write" | "execute" | "list";

export type S01TrustedPrincipal = {
  userId: string;
  tenantId: string;
  sessionDomain: "platform" | "enterprise" | "employee";
  source: "platform-auth-session";
  sessionId: string;
  resolvedAt: number;
  attestation: string;
};

export type S01MembershipPort = {
  resolveMembership(userId: string): { userId: string; tenantId: string } | null;
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

export type EvaluateS01AuthorizedToolCwdInput = {
  catalog: WorkspaceResourceCatalog;
  principal: S01TrustedPrincipal | null;
  requestedCwd: string;
  operation: S01WorkspaceCapability;
  memberships: S01MembershipPort;
  attestationSecret: string;
  targetIdentity: S01TargetIdentity;
  now?: number;
  expectedFencing?: { contentVersion: string; bindingId: string };
  symlinkFollowed?: boolean;
  personalFallback?: boolean;
  allowAnonymousLocal?: boolean;
};

export type EvaluateS01AuthorizedToolCwdResult =
  | {
      ok: true;
      resolvedPath: string;
      resourceId: string;
      locator: string;
      accessMode: "authorized";
      symlinkSafety: "lexical-only-caller-must-lstat";
      audit: {
        decision: "allowed";
        actor: string;
        tenantId: string;
        resourceId: string;
        sessionId: string;
      };
    }
  | {
      ok: false;
      code: S01AuthorizedToolCwdErrorCode;
      message: string;
      userMessage: string;
      failClosed: true;
      retryable: false;
      symlinkSafety?: "denied-unverified";
      audit: { decision: "denied"; code: S01AuthorizedToolCwdErrorCode };
    };

function fail(
  code: S01AuthorizedToolCwdErrorCode,
  message: string,
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
    audit: { decision: "denied", code },
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

export function attestS01Principal(
  principal: Omit<S01TrustedPrincipal, "attestation">,
  attestationSecret: string,
): string {
  return createHmac("sha256", attestationSecret)
    .update(S01_ATTESTATION_DOMAIN)
    .update("\0")
    .update(principal.userId)
    .update("\0")
    .update(principal.tenantId)
    .update("\0")
    .update(principal.sessionDomain)
    .update("\0")
    .update(principal.source)
    .update("\0")
    .update(principal.sessionId)
    .update("\0")
    .update(String(principal.resolvedAt))
    .digest("hex");
}

export function issueS01TrustedPrincipal(params: {
  userId: string;
  tenantId: string;
  sessionId: string;
  attestationSecret: string;
  sessionDomain?: S01TrustedPrincipal["sessionDomain"];
  resolvedAt?: number;
}): S01TrustedPrincipal | null {
  if (!params.userId || !params.tenantId || !params.sessionId || !params.attestationSecret) {
    return null;
  }
  const resolvedAt = params.resolvedAt ?? Date.now();
  const unsigned = {
    userId: params.userId,
    tenantId: params.tenantId,
    sessionDomain: params.sessionDomain ?? "employee",
    source: "platform-auth-session" as const,
    sessionId: params.sessionId,
    resolvedAt,
  };
  return Object.freeze({
    ...unsigned,
    attestation: attestS01Principal(unsigned, params.attestationSecret),
  });
}

function parsePrincipal(
  input: S01TrustedPrincipal,
  now: number,
  secret: string,
): S01TrustedPrincipal | null {
  const expected = attestS01Principal(input, secret);
  if (!secretEqual(expected, input.attestation)) {
    return null;
  }
  if (now < input.resolvedAt || now - input.resolvedAt > S01_PRINCIPAL_MAX_AGE_MS) {
    return null;
  }
  return input;
}

export function createInMemoryS01MembershipPort(params: {
  memberships?: ReadonlyArray<{ userId: string; tenantId: string }>;
  seats?: Readonly<Record<string, readonly string[]>>;
  groups?: Readonly<Record<string, readonly string[]>>;
}): S01MembershipPort {
  const memberships = params.memberships ?? [];
  const seats = params.seats ?? {};
  const groups = params.groups ?? {};
  return {
    resolveMembership(userId) {
      const matches = memberships.filter((row) => row.userId === userId);
      return matches.length === 1 ? (matches[0] ?? null) : null;
    },
    userHasSeat(userId, seatId) {
      return (seats[userId] ?? []).includes(seatId);
    },
    userInGroup(userId, groupId) {
      return (groups[userId] ?? []).includes(groupId);
    },
  };
}

function isMembershipPort(value: unknown): value is S01MembershipPort {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const port = value as S01MembershipPort;
  return (
    typeof port.resolveMembership === "function" &&
    typeof port.userHasSeat === "function" &&
    typeof port.userInGroup === "function"
  );
}

function parseLocator(value: string): { ok: true; path: string } | { ok: false } {
  if (!value || value.includes("\0")) {
    return { ok: false };
  }
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return { ok: false };
  }
  if (decoded.includes("%") || !decoded.startsWith("/") || decoded.includes("\\")) {
    return { ok: false };
  }
  if (decoded.split("/").some((segment) => segment === "." || segment === "..")) {
    return { ok: false };
  }
  const normalized = path.posix.normalize(decoded);
  if (normalized.includes("..") || !normalized.startsWith("/")) {
    return { ok: false };
  }
  return { ok: true, path: normalized === "/" ? "/" : normalized.replace(/\/+$/u, "") || "/" };
}

function isInsideRoot(requested: string, root: string): boolean {
  const req = parseLocator(requested);
  const base = parseLocator(root);
  if (!req.ok || !base.ok) {
    return false;
  }
  if (req.path === base.path) {
    return true;
  }
  const relative = path.posix.relative(base.path, req.path);
  return relative !== "" && !relative.startsWith("..") && !path.posix.isAbsolute(relative);
}

export function evaluateS01AuthorizedToolCwd(
  input: EvaluateS01AuthorizedToolCwdInput,
): EvaluateS01AuthorizedToolCwdResult {
  void input.allowAnonymousLocal;
  if (input.personalFallback) {
    return fail("ERR_PRINCIPAL_REQUIRED", "personalFallback is not an S01 principal");
  }
  if (!input.principal) {
    return fail("ERR_PRINCIPAL_REQUIRED", "Trusted principal missing");
  }
  const principal = parsePrincipal(
    input.principal,
    input.now ?? Date.now(),
    input.attestationSecret,
  );
  if (!principal) {
    return fail("ERR_PRINCIPAL_REQUIRED", "Trusted principal invalid, forged, or expired");
  }
  if (input.symlinkFollowed) {
    return fail(
      "ERR_INVALID_PATH",
      "Symlink follow is unverified; caller must lstat and deny escape",
      { symlinkSafety: "denied-unverified" },
    );
  }
  if (!isMembershipPort(input.memberships)) {
    return fail(
      "ERR_TENANT_BINDING_REQUIRED",
      "Membership SoT port missing; arrays are not accepted",
    );
  }
  const membership = input.memberships.resolveMembership(principal.userId);
  if (!membership) {
    return fail("ERR_TENANT_BINDING_REQUIRED", "Membership view missing or ambiguous");
  }
  if (membership.tenantId !== principal.tenantId) {
    return fail("ERR_TENANT_MISMATCH", "Principal tenant does not match membership view");
  }

  const snapshot = input.catalog.snapshot();
  if (snapshot.status === "unavailable") {
    return fail("ERR_CATALOG_UNAVAILABLE", "Catalog snapshot unavailable");
  }

  const target = input.targetIdentity;
  if (!target?.workspaceResourceId || !target.agentAssetId || !target.tenantId) {
    return fail("ERR_WORKSPACE_NOT_FOUND", "targetIdentity is required and must not be null");
  }
  if (target.tenantId !== principal.tenantId) {
    return fail("ERR_TENANT_MISMATCH", "targetIdentity tenant does not match principal");
  }
  if (target.employeeOwnerId !== principal.userId) {
    return fail("ERR_WORKSPACE_OWNER_DENIED", "targetIdentity owner does not match principal");
  }

  const resource = input.catalog.getResource(target.workspaceResourceId);
  if (!resource || resource.resourceType !== "workspace") {
    return fail("ERR_WORKSPACE_NOT_FOUND", "Target workspace resource missing");
  }
  if (resource.tenantId !== principal.tenantId) {
    return fail("ERR_TENANT_MISMATCH", "Workspace tenant does not match principal");
  }
  if (resource.lifecycleState === "retired") {
    return fail("ERR_WORKSPACE_ARCHIVED", "Workspace handle is retired");
  }
  if (resource.ownerScope.kind === "user_owned") {
    if (resource.ownerScope.userId !== principal.userId) {
      return fail("ERR_WORKSPACE_OWNER_DENIED", "Principal is not the workspace owner");
    }
  } else if (resource.ownerScope.kind === "position_owned") {
    if (!input.memberships.userHasSeat(principal.userId, resource.ownerScope.seatId)) {
      return fail("ERR_WORKSPACE_OWNER_DENIED", "Principal does not hold the seat");
    }
  } else if (resource.ownerScope.kind === "group_owned") {
    if (!input.memberships.userInGroup(principal.userId, resource.ownerScope.groupId)) {
      return fail("ERR_WORKSPACE_OWNER_DENIED", "Principal is not a group member");
    }
  } else {
    return fail("ERR_WORKSPACE_OWNER_DENIED", "Unknown ownership cannot authorize");
  }

  const canonical = input.catalog
    .listBindingsForResource(target.workspaceResourceId)
    .filter((binding) => binding.role === "canonical");
  if (canonical.length > 1) {
    return fail("ERR_WORKSPACE_NOT_FOUND", "Duplicate canonical bindings");
  }
  const binding = canonical[0];
  if (!binding) {
    return fail("ERR_BINDING_NOT_CANONICAL", "Canonical binding missing");
  }
  if (binding.state === "retired") {
    return fail("ERR_WORKSPACE_ARCHIVED", "Binding revoked");
  }
  if (
    target.expectedBindingRole !== "canonical" ||
    target.expectedBindingState !== "active" ||
    binding.role !== "canonical" ||
    binding.state !== "active"
  ) {
    return fail("ERR_BINDING_NOT_CANONICAL", "Binding is not the expected canonical/active row");
  }
  if (
    resource.governanceVersion !== target.governanceVersion ||
    binding.contentVersion !== target.contentVersion ||
    binding.bindingId !== target.fencingToken.bindingId ||
    binding.contentVersion !== target.fencingToken.contentVersion
  ) {
    return fail("ERR_WORKSPACE_ARCHIVED", "targetIdentity versions or fencing token are stale");
  }
  if (
    input.expectedFencing &&
    (input.expectedFencing.contentVersion !== binding.contentVersion ||
      input.expectedFencing.bindingId !== binding.bindingId)
  ) {
    return fail("ERR_WORKSPACE_ARCHIVED", "Additional expectedFencing constraint is stale");
  }

  const capabilities: S01WorkspaceCapability[] = ["read", "write", "execute", "list"];
  if (!capabilities.includes(input.operation)) {
    return fail("ERR_CAPABILITY_DENIED", "Operation is outside binding-derived capabilities");
  }

  const root = parseLocator(binding.locator);
  if (!root.ok) {
    return fail("ERR_INVALID_PATH", "Canonical locator is not a safe structured path");
  }
  const requested = input.requestedCwd.startsWith("/")
    ? parseLocator(input.requestedCwd)
    : parseLocator(path.posix.join(root.path, input.requestedCwd));
  if (!requested.ok) {
    return fail("ERR_INVALID_PATH", "Requested cwd is not a safe structured locator");
  }
  if (!isInsideRoot(requested.path, root.path)) {
    return fail("ERR_PATH_OUTSIDE_WORKSPACE", "Requested cwd is outside handle locator");
  }

  return {
    ok: true,
    resolvedPath: requested.path,
    resourceId: target.workspaceResourceId,
    locator: root.path,
    accessMode: "authorized",
    symlinkSafety: "lexical-only-caller-must-lstat",
    audit: {
      decision: "allowed",
      actor: principal.userId,
      tenantId: principal.tenantId,
      resourceId: target.workspaceResourceId,
      sessionId: principal.sessionId,
    },
  };
}
