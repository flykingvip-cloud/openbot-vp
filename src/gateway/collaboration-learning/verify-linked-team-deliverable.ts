/**
 * P2 R2 — verify board submission↔deliverable link against trusted stores.
 * Reuses readTeamDeliverable (no third deliverable format).
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { OpenBotConfig } from "../../config/types.js";
import type { RuntimeAuthority } from "../collaboration-dispatch/runtime-authority.js";
import { readTeamDeliverable, type TeamDeliverableRecord } from "./team-deliverable-submit.js";
import {
  createTrustedGroupStores,
  resolveTeamDeliverableStores,
  type TeamResourceAuthOk,
  type TrustedGroupStores,
  TRUSTED_GROUP_LOCATOR_REQUIRED,
} from "./team-resource-auth.js";
import type { CollaborationTenantResolution } from "./trusted-tenant.js";

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** Shared fixture body for adjacent claim/S3 tests that bind a deliverable link. */
export const P2_LINKED_DELIVERABLE_FIXTURE_BODY = "# p2 fixture deliverable\n";
export const P2_LINKED_DELIVERABLE_FIXTURE_SHA256 = sha256Hex(P2_LINKED_DELIVERABLE_FIXTURE_BODY);
export const P2_LINKED_DELIVERABLE_FIXTURE_ID = "del-p2-test";
export const P2_LINKED_DELIVERABLE_FIXTURE_VERSION = 1;

export const P2_LINKED_DELIVERABLE_FIXTURE = {
  linkedDeliverableId: P2_LINKED_DELIVERABLE_FIXTURE_ID,
  linkedDeliverableVersion: P2_LINKED_DELIVERABLE_FIXTURE_VERSION,
  linkedContentSha256: P2_LINKED_DELIVERABLE_FIXTURE_SHA256,
} as const;

export type LinkedDeliverableRef = {
  deliverableId: string;
  version: number;
  contentSha256: string;
};

export type VerifyLinkedDeliverableResult =
  | { ok: true; deliverableId: string; version: number; contentSha256: string; taskId?: string }
  | { ok: false; reason: string; message: string };

/** Derive trusted locator from RuntimeAuthority namespace (no legacy/compat fallback). */
export function trustedLocatorFromAuthority(
  authority: RuntimeAuthority,
): { groupsRoot: string; groupLocator: string } | null {
  const groupLocator = compact(authority.namespace?.groupLocator);
  if (!groupLocator) {
    return null;
  }
  return {
    groupLocator,
    groupsRoot: path.dirname(groupLocator),
  };
}

/**
 * Read the exact deliverable from trusted stores and verify task ownership,
 * version, content digest, and on-disk bytes when a formal file exists.
 */
export async function verifyLinkedTeamDeliverable(params: {
  groupId: string;
  taskId: string;
  actor: string;
  linked: LinkedDeliverableRef;
  auth?: TeamResourceAuthOk | null;
  trusted?: { groupsRoot: string; groupLocator: string } | null;
  stores?: TrustedGroupStores | null;
  tenant?: CollaborationTenantResolution | null;
  cfg?: OpenBotConfig;
  /** Default false — board mutate paths already authorized the actor. */
  enforceAcl?: boolean;
}): Promise<VerifyLinkedDeliverableResult> {
  const groupId = compact(params.groupId);
  const taskId = compact(params.taskId);
  const actor = compact(params.actor);
  const deliverableId = compact(params.linked.deliverableId);
  const expectedSha = compact(params.linked.contentSha256).toLowerCase();
  const expectedVersion = params.linked.version;
  if (!groupId || !taskId || !actor || !deliverableId || !expectedSha) {
    return {
      ok: false,
      reason: "deliverable_link_incomplete",
      message: "linked deliverable id/version/hash and task/actor are required",
    };
  }
  if (!Number.isFinite(expectedVersion) || expectedVersion <= 0) {
    return {
      ok: false,
      reason: "deliverable_link_incomplete",
      message: "linkedDeliverableVersion must be a positive finite number",
    };
  }

  const trusted =
    params.trusted ??
    (params.auth
      ? { groupsRoot: params.auth.groupsRoot, groupLocator: params.auth.groupLocator }
      : params.stores
        ? { groupsRoot: params.stores.groupsRoot, groupLocator: params.stores.groupLocator }
        : null);
  if (!trusted?.groupsRoot || !trusted.groupLocator) {
    return {
      ok: false,
      reason: TRUSTED_GROUP_LOCATOR_REQUIRED,
      message: "linked deliverable verify refuses without trusted group locator (no legacy root)",
    };
  }

  const read = await readTeamDeliverable({
    groupId,
    deliverableId,
    actor,
    tenant: params.tenant,
    trusted,
    cfg: params.cfg,
    enforceAcl: params.enforceAcl === true,
  });
  if (!read.ok) {
    const reason =
      read.reason === "deliverable_not_found"
        ? "deliverable_not_found"
        : read.reason === TRUSTED_GROUP_LOCATOR_REQUIRED ||
            read.reason === "legacy_collaboration_root_rejected"
          ? read.reason
          : "deliverable_unreadable";
    return {
      ok: false,
      reason,
      message: read.detail
        ? `${read.reason}: ${read.detail}`
        : `linked deliverable ${deliverableId} could not be read (${read.reason})`,
    };
  }

  const rowTaskId = compact(read.taskId);
  if (!rowTaskId || rowTaskId !== taskId) {
    return {
      ok: false,
      reason: "deliverable_task_mismatch",
      message: rowTaskId
        ? `deliverable ${deliverableId} belongs to task ${rowTaskId}, not ${taskId}`
        : `deliverable ${deliverableId} has no taskId binding`,
    };
  }
  if (read.version !== expectedVersion) {
    return {
      ok: false,
      reason: "deliverable_version_mismatch",
      message: `deliverable ${deliverableId} version is ${read.version}, expected ${expectedVersion}`,
    };
  }
  const actualSha = compact(read.contentSha256).toLowerCase();
  if (!actualSha || actualSha !== expectedSha) {
    return {
      ok: false,
      reason: "deliverable_hash_mismatch",
      message: `deliverable ${deliverableId} contentSha256 does not match linked hash`,
    };
  }
  if (read.status === "archived" || read.status === "superseded") {
    return {
      ok: false,
      reason: "deliverable_status_refused",
      message: `deliverable ${deliverableId} status ${read.status} cannot bind a board submission`,
    };
  }

  const relativePath = compact(read.relativePath);
  const locator = compact(read.locator);
  const filePath = locator || (relativePath ? path.join(trusted.groupLocator, relativePath) : "");
  if (!filePath) {
    return {
      ok: false,
      reason: "deliverable_file_missing",
      message: `formal deliverable file missing for ${deliverableId}`,
    };
  }
  try {
    const onDisk = await fs.readFile(filePath, "utf8");
    if (sha256Hex(onDisk).toLowerCase() !== expectedSha) {
      return {
        ok: false,
        reason: "deliverable_file_digest_mismatch",
        message: `on-disk bytes for ${deliverableId} do not match linked contentSha256`,
      };
    }
  } catch {
    return {
      ok: false,
      reason: "deliverable_file_missing",
      message: `formal deliverable file missing for ${deliverableId}`,
    };
  }

  return {
    ok: true,
    deliverableId: read.deliverableId,
    version: read.version,
    contentSha256: actualSha,
    taskId: rowTaskId,
  };
}

/** Verify using authority.namespace trusted locator (claim-contract mutate paths). */
export async function verifyLinkedTeamDeliverableForAuthority(params: {
  authority: RuntimeAuthority;
  taskId: string;
  actor: string;
  linked: LinkedDeliverableRef;
  cfg?: OpenBotConfig;
}): Promise<VerifyLinkedDeliverableResult> {
  const trusted = trustedLocatorFromAuthority(params.authority);
  if (!trusted) {
    return {
      ok: false,
      reason: TRUSTED_GROUP_LOCATOR_REQUIRED,
      message: "authority.namespace.groupLocator required to verify linked deliverable",
    };
  }
  return verifyLinkedTeamDeliverable({
    groupId: params.authority.groupId,
    taskId: params.taskId,
    actor: params.actor,
    linked: params.linked,
    trusted,
    tenant: params.authority.tenantId
      ? { tenantId: params.authority.tenantId, trust: "none" }
      : null,
    cfg: params.cfg,
    enforceAcl: false,
  });
}

/**
 * Test/fixture helper: write a submitted deliverable record + formal file
 * under the authority's trusted group locator so verify can succeed.
 */
export async function seedLinkedTeamDeliverableFixture(params: {
  authority: RuntimeAuthority;
  taskId: string;
  deliverableId?: string;
  version?: number;
  content?: string;
  actor?: string;
}): Promise<
  | { ok: true; contentSha256: string; deliverableId: string; version: number }
  | { ok: false; reason: string }
> {
  const trusted = trustedLocatorFromAuthority(params.authority);
  if (!trusted) {
    return { ok: false, reason: TRUSTED_GROUP_LOCATOR_REQUIRED };
  }
  const deliverableId = compact(params.deliverableId) || P2_LINKED_DELIVERABLE_FIXTURE_ID;
  const taskId = compact(params.taskId);
  const version = params.version ?? P2_LINKED_DELIVERABLE_FIXTURE_VERSION;
  const body = params.content ?? P2_LINKED_DELIVERABLE_FIXTURE_BODY;
  const contentSha256 = sha256Hex(body);
  const stores = createTrustedGroupStores(trusted);
  const now = Date.now();
  const relativePath = `deliverables/${deliverableId}-v${version}.md`;
  const absolutePath = path.join(trusted.groupLocator, relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, body, "utf8");
  const record: TeamDeliverableRecord = {
    deliverableId,
    groupId: params.authority.groupId,
    taskId,
    title: `fixture ${deliverableId}`,
    content: body,
    contentType: "text/markdown",
    status: "submitted",
    version,
    submittedBy: compact(params.actor) || "fixture",
    createdBy: compact(params.actor) || "fixture",
    updatedBy: compact(params.actor) || "fixture",
    createdAtMs: now,
    updatedAtMs: now,
    submittedAtMs: now,
    relativePath,
    contentSha256,
    formalLocator: absolutePath,
  };
  await stores.objectStorage.writeObject(
    params.authority.groupId,
    "deliverable",
    deliverableId,
    record,
  );
  return { ok: true, contentSha256, deliverableId, version };
}

export function resolveTrustedStoresForAuthority(
  authority: RuntimeAuthority,
): TrustedGroupStores | null {
  const trusted = trustedLocatorFromAuthority(authority);
  if (!trusted) {
    return null;
  }
  return createTrustedGroupStores(trusted);
}

export async function resolveDeliverableStoresOrRefuse(params: {
  groupId: string;
  auth?: TeamResourceAuthOk | null;
  trusted?: { groupsRoot: string; groupLocator: string } | null;
  tenantId?: string | null;
  cfg?: OpenBotConfig;
}): Promise<
  | { ok: true; stores: TrustedGroupStores; trusted: { groupsRoot: string; groupLocator: string } }
  | { ok: false; reason: string; message: string }
> {
  const resolved = resolveTeamDeliverableStores({
    auth: params.auth,
    trusted: params.trusted,
    groupId: params.groupId,
    cfg: params.cfg,
    tenantId: params.tenantId ?? null,
  });
  if (!resolved.ok) {
    return {
      ok: false,
      reason: resolved.reason,
      message: resolved.detail || resolved.reason,
    };
  }
  return {
    ok: true,
    stores: resolved,
    trusted: { groupsRoot: resolved.groupsRoot, groupLocator: resolved.groupLocator },
  };
}
