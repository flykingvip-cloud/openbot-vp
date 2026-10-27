/**
 * TEAM-REAL F2 — Host-authorized team deliverable submit (review A/C hardened).
 *
 * Sandbox drafts stay in the agent workspace until this entry copies/registers
 * them into the collaboration group formal locator. Writing a personal
 * workspace file alone is NOT team delivery success.
 *
 * Reuses objectStorage deliverable records + group locator (no parallel authority,
 * no formal-root twin remount, no A/B sync, no expanded sandbox mounts).
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Deliverable } from "@openbot/collaboration-core";
import { loadConfig } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import type { GatewayClient } from "../server-methods/types.js";
import { resolveGroupCollaborationPaths } from "./collaboration-paths.js";
import { createWorkspaceCollaborationStores } from "./shared.js";
import { transitionCollaborationDeliverable } from "./state-machine.js";
import {
  assertTaskBelongsToGroup,
  authorizeTeamGroupResourceAccess,
} from "./team-resource-auth.js";
import type { CollaborationTenantResolution } from "./trusted-tenant.js";

/** Extended deliverable fields persisted alongside core Deliverable. */
export type TeamDeliverableRecord = Deliverable & {
  relativePath?: string;
  contentSha256?: string;
  formalLocator?: string;
};

export type TeamDeliverableSubmitInput = {
  groupId: string;
  taskId: string;
  actor: string;
  title: string;
  /** UTF-8 body already read by the authorized host (not a sandbox mount). */
  content: string;
  /** Optional stable logical id; defaults to hash of taskId+title. */
  logicalId?: string;
  contentType?: string;
  /** When set, revise this deliverable into a new version. */
  previousDeliverableId?: string;
  /** Relative path under the group workspace; must stay inside deliverables/. */
  relativePath?: string;
  /** Trusted membership tenant from gateway (never client-supplied alone). */
  tenant?: CollaborationTenantResolution | null;
  client?: GatewayClient | null;
  /** When false, skip ACL (unit tests that seed membership separately). Default true. */
  enforceAcl?: boolean;
  identityAliases?: readonly string[];
  cfg?: OpenBotConfig;
  nowMs?: number;
};

export type TeamDeliverableSubmitReceipt = {
  ok: true;
  taskId: string;
  groupId: string;
  deliverableId: string;
  version: number;
  locator: string;
  relativePath: string;
  sizeBytes: number;
  contentSha256: string;
  status: Deliverable["status"];
  idempotentReplay: boolean;
};

export type TeamDeliverableSubmitFailure = {
  ok: false;
  reason: string;
  detail?: string;
  /** Always false — callers must not claim group-dir write on failure. */
  writtenToGroupDir: false;
};

export type TeamDeliverableSubmitResult =
  | TeamDeliverableSubmitReceipt
  | TeamDeliverableSubmitFailure;

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function defaultLogicalId(taskId: string, title: string): string {
  return `td-${createHash("sha256").update(`${taskId}\n${title}`).digest("hex").slice(0, 16)}`;
}

function sanitizeRelativePath(
  raw: string | undefined,
  logicalId: string,
  version: number,
): string | null {
  const fallback = `deliverables/${logicalId}-v${version}.md`;
  const candidate = compact(raw) || fallback;
  const normalized = candidate.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("\0")) {
    return null;
  }
  if (normalized.split("/").some((part) => part === ".." || part === "")) {
    return null;
  }
  if (!normalized.startsWith("deliverables/")) {
    return null;
  }
  if (normalized.includes("//")) {
    return null;
  }
  return normalized;
}

function assertInsideGroupDir(groupDir: string, absolutePath: string): boolean {
  const root = path.resolve(groupDir);
  const target = path.resolve(absolutePath);
  return target === root || target.startsWith(`${root}${path.sep}`);
}

/**
 * Reject when any ancestor between groupDir and target is a symlink that escapes,
 * or the leaf itself is a symlink that escapes.
 */
export async function assertNoSymlinkEscape(params: {
  groupDir: string;
  absolutePath: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const root = path.resolve(params.groupDir);
  const target = path.resolve(params.absolutePath);
  if (!assertInsideGroupDir(root, target)) {
    return { ok: false, reason: "path_escape_rejected" };
  }
  let cursor = target;
  while (true) {
    try {
      const st = await fs.lstat(cursor);
      if (st.isSymbolicLink()) {
        let real: string;
        try {
          real = await fs.realpath(cursor);
        } catch {
          return { ok: false, reason: "symlink_escape_rejected" };
        }
        if (!assertInsideGroupDir(root, real)) {
          return { ok: false, reason: "symlink_escape_rejected" };
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        return { ok: false, reason: "path_stat_failed" };
      }
      // missing is fine for leaf; parents may also be missing until mkdir
    }
    const parent = path.dirname(cursor);
    if (parent === cursor || path.resolve(parent) === root) {
      // Also check the groupDir itself if it is a symlink.
      try {
        const rootSt = await fs.lstat(root);
        if (rootSt.isSymbolicLink()) {
          const realRoot = await fs.realpath(root);
          if (path.resolve(realRoot) !== root && !assertInsideGroupDir(root, realRoot)) {
            // groupDir itself symlink: realpath must still be the configured locator use-case;
            // for safety require realpath stays equal after resolve of configured root's parent.
            return { ok: false, reason: "symlink_escape_rejected" };
          }
        }
      } catch {
        // ignore
      }
      break;
    }
    cursor = parent;
  }
  return { ok: true };
}

async function writeFileAtomic(absolutePath: string, content: string): Promise<void> {
  const dir = path.dirname(absolutePath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `.${path.basename(absolutePath)}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`,
  );
  await fs.writeFile(tmp, content, "utf8");
  await fs.rename(tmp, absolutePath);
}

/**
 * Submit team deliverable body into the group collaboration formal locator.
 * Host must already hold the draft bytes — this entry does not mount the sandbox.
 */
export async function submitTeamDeliverable(
  params: TeamDeliverableSubmitInput,
): Promise<TeamDeliverableSubmitResult> {
  const groupId = compact(params.groupId);
  const taskId = compact(params.taskId);
  const actor = compact(params.actor);
  const title = compact(params.title);
  const content = params.content ?? "";

  if (!groupId || !taskId || !actor || !title) {
    return {
      ok: false,
      reason: "missing_required_fields",
      detail: "groupId, taskId, actor, title are required",
      writtenToGroupDir: false,
    };
  }
  if (typeof content !== "string" || content.length === 0) {
    return {
      ok: false,
      reason: "empty_content",
      detail: "content body is required; personal workspace write is not team delivery",
      writtenToGroupDir: false,
    };
  }

  const cfg = params.cfg ?? loadConfig();
  const enforceAcl = params.enforceAcl !== false;
  if (enforceAcl) {
    const auth = await authorizeTeamGroupResourceAccess({
      groupId,
      actor,
      client: params.client,
      tenant: params.tenant,
      cfg,
      identityAliases: params.identityAliases,
      action: "write",
    });
    if (!auth.ok) {
      return {
        ok: false,
        reason: auth.reason,
        detail: auth.detail,
        writtenToGroupDir: false,
      };
    }
  }

  const taskCheck = await assertTaskBelongsToGroup({ groupId, taskId, cfg });
  if (!taskCheck.ok) {
    return {
      ok: false,
      reason: taskCheck.reason,
      detail: taskCheck.detail,
      writtenToGroupDir: false,
    };
  }

  const contentSha256 = sha256Hex(content);
  const sizeBytes = Buffer.byteLength(content, "utf8");
  const stores = createWorkspaceCollaborationStores(cfg);
  const now = params.nowMs ?? Date.now();

  let previous: TeamDeliverableRecord | null = null;
  const previousId = compact(params.previousDeliverableId);
  if (previousId) {
    previous =
      (await stores.objectStorage.readObject<TeamDeliverableRecord>(
        groupId,
        "deliverable",
        previousId,
      )) ?? null;
    if (!previous) {
      return {
        ok: false,
        reason: "previous_deliverable_not_found",
        detail: previousId,
        writtenToGroupDir: false,
      };
    }
    if (previous.taskId && previous.taskId !== taskId) {
      return {
        ok: false,
        reason: "previous_task_mismatch",
        detail: `previous taskId=${previous.taskId} current=${taskId}`,
        writtenToGroupDir: false,
      };
    }
  }

  // Idempotent replay: same task + title + body already submitted — return stored receipt.
  let existingList: TeamDeliverableRecord[];
  try {
    existingList = await stores.objectStorage.listObjects<TeamDeliverableRecord>(
      groupId,
      "deliverable",
    );
  } catch (error) {
    return {
      ok: false,
      reason: "deliverable_list_failed",
      detail: error instanceof Error ? error.message : String(error),
      writtenToGroupDir: false,
    };
  }
  const replay = existingList.find((row) => {
    if (row.taskId !== taskId) {
      return false;
    }
    if (compact(row.title) !== title) {
      return false;
    }
    const storedHash =
      compact(row.contentSha256) || (typeof row.content === "string" ? sha256Hex(row.content) : "");
    return (
      storedHash === contentSha256 &&
      (row.status === "submitted" ||
        row.status === "in_review" ||
        row.status === "approved" ||
        row.status === "published")
    );
  });
  if (replay && !previousId) {
    const storedRel =
      compact(replay.relativePath) ||
      sanitizeRelativePath(undefined, replay.deliverableId, replay.version) ||
      `deliverables/${replay.deliverableId}.md`;
    const locator =
      compact(replay.formalLocator) ||
      path.join(resolveGroupCollaborationPaths(groupId, cfg).groupDir, storedRel);
    // Verify on-disk bytes when locator exists; mismatch → refuse silent wrong receipt.
    try {
      const onDisk = await fs.readFile(locator, "utf8");
      if (sha256Hex(onDisk) !== contentSha256) {
        return {
          ok: false,
          reason: "idempotent_replay_content_mismatch",
          detail: locator,
          writtenToGroupDir: false,
        };
      }
    } catch {
      // Object record is authoritative for content; file may be missing in degraded mode.
    }
    return {
      ok: true,
      taskId,
      groupId,
      deliverableId: replay.deliverableId,
      version: replay.version,
      locator,
      relativePath: storedRel,
      sizeBytes: Buffer.byteLength(
        typeof replay.content === "string" ? replay.content : content,
        "utf8",
      ),
      contentSha256,
      status: replay.status,
      idempotentReplay: true,
    };
  }

  const logicalId = compact(params.logicalId) || defaultLogicalId(taskId, title);
  const version = previous ? previous.version + 1 : 1;
  // Immutable version path: never overwrite prior version files.
  const relativePath = sanitizeRelativePath(
    previous ? undefined : params.relativePath,
    logicalId,
    version,
  );
  if (!relativePath) {
    return {
      ok: false,
      reason: "invalid_relative_path",
      detail: "relativePath must stay under deliverables/ without traversal",
      writtenToGroupDir: false,
    };
  }

  let paths;
  try {
    paths = resolveGroupCollaborationPaths(groupId, cfg);
  } catch (error) {
    return {
      ok: false,
      reason: "group_locator_unavailable",
      detail: error instanceof Error ? error.message : String(error),
      writtenToGroupDir: false,
    };
  }

  const absolutePath = path.join(paths.groupDir, relativePath);
  if (!assertInsideGroupDir(paths.groupDir, absolutePath)) {
    return {
      ok: false,
      reason: "path_escape_rejected",
      detail: "resolved path escaped groupDir",
      writtenToGroupDir: false,
    };
  }

  const symlinkCheck = await assertNoSymlinkEscape({
    groupDir: paths.groupDir,
    absolutePath,
  });
  if (!symlinkCheck.ok) {
    return {
      ok: false,
      reason: symlinkCheck.reason,
      writtenToGroupDir: false,
    };
  }

  // Refuse overwrite of an existing different version file (immutable versions).
  try {
    const existingBytes = await fs.readFile(absolutePath, "utf8");
    if (sha256Hex(existingBytes) !== contentSha256) {
      return {
        ok: false,
        reason: "version_path_conflict",
        detail: absolutePath,
        writtenToGroupDir: false,
      };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      return {
        ok: false,
        reason: "formal_root_stat_failed",
        detail: error instanceof Error ? error.message : String(error),
        writtenToGroupDir: false,
      };
    }
  }

  const deliverableId = previous
    ? `del-${createHash("sha256").update(`${previous.deliverableId}:${contentSha256}`).digest("hex").slice(0, 20)}`
    : `del-${logicalId}-${randomUUID().slice(0, 8)}`;

  const draft: TeamDeliverableRecord = {
    deliverableId,
    groupId,
    taskId,
    title,
    description: `team deliverable ${relativePath}`,
    content,
    contentType: compact(params.contentType) || "text/markdown",
    status: "draft",
    version,
    previousVersionId: previous?.deliverableId,
    createdBy: actor,
    updatedBy: actor,
    createdAtMs: now,
    updatedAtMs: now,
    relativePath,
    contentSha256,
    formalLocator: absolutePath,
  };

  // Persist object first, then immutable file — avoids "overwrite then rollback delete".
  try {
    await stores.objectStorage.writeObject(groupId, "deliverable", deliverableId, draft);
  } catch (error) {
    return {
      ok: false,
      reason: "deliverable_object_persist_failed",
      detail: error instanceof Error ? error.message : String(error),
      writtenToGroupDir: false,
    };
  }

  try {
    await writeFileAtomic(absolutePath, content);
  } catch (error) {
    return {
      ok: false,
      reason: "formal_root_write_failed",
      detail: error instanceof Error ? error.message : String(error),
      writtenToGroupDir: false,
    };
  }

  let submitted: Deliverable;
  try {
    submitted = await transitionCollaborationDeliverable({
      groupId,
      deliverableId,
      toStatus: "submitted",
      actor,
    });
  } catch (error) {
    return {
      ok: false,
      reason: "deliverable_submit_transition_failed",
      detail: error instanceof Error ? error.message : String(error),
      writtenToGroupDir: false,
    };
  }

  // Keep locator metadata on the submitted record.
  try {
    const live =
      (await stores.objectStorage.readObject<TeamDeliverableRecord>(
        groupId,
        "deliverable",
        deliverableId,
      )) ?? (submitted as TeamDeliverableRecord);
    const stamped: TeamDeliverableRecord = {
      ...live,
      relativePath,
      contentSha256,
      formalLocator: absolutePath,
    };
    await stores.objectStorage.writeObject(groupId, "deliverable", deliverableId, stamped);
  } catch {
    // non-fatal: receipt still carries locator
  }

  try {
    const onDisk = await fs.readFile(absolutePath, "utf8");
    if (sha256Hex(onDisk) !== contentSha256) {
      return {
        ok: false,
        reason: "content_digest_mismatch_after_write",
        writtenToGroupDir: false,
      };
    }
  } catch (error) {
    return {
      ok: false,
      reason: "formal_root_unreadable_after_write",
      detail: error instanceof Error ? error.message : String(error),
      writtenToGroupDir: false,
    };
  }

  return {
    ok: true,
    taskId,
    groupId,
    deliverableId: submitted.deliverableId,
    version: submitted.version,
    locator: absolutePath,
    relativePath,
    sizeBytes,
    contentSha256,
    status: submitted.status,
    idempotentReplay: false,
  };
}

/** Authorized peer read of a previously submitted team deliverable. */
export async function readTeamDeliverable(params: {
  groupId: string;
  deliverableId: string;
  actor: string;
  tenant?: CollaborationTenantResolution | null;
  client?: GatewayClient | null;
  enforceAcl?: boolean;
  identityAliases?: readonly string[];
  cfg?: OpenBotConfig;
}): Promise<
  | {
      ok: true;
      deliverableId: string;
      taskId?: string;
      version: number;
      status: Deliverable["status"];
      content: string;
      contentSha256: string;
      sizeBytes: number;
      locator: string;
      relativePath: string;
    }
  | TeamDeliverableSubmitFailure
> {
  const groupId = compact(params.groupId);
  const deliverableId = compact(params.deliverableId);
  const actor = compact(params.actor);
  if (!groupId || !deliverableId || !actor) {
    return {
      ok: false,
      reason: "missing_required_fields",
      writtenToGroupDir: false,
    };
  }
  const cfg = params.cfg ?? loadConfig();
  if (params.enforceAcl !== false) {
    const auth = await authorizeTeamGroupResourceAccess({
      groupId,
      actor,
      client: params.client,
      tenant: params.tenant,
      cfg,
      identityAliases: params.identityAliases,
      action: "read",
    });
    if (!auth.ok) {
      return {
        ok: false,
        reason: auth.reason,
        detail: auth.detail,
        writtenToGroupDir: false,
      };
    }
  }
  const stores = createWorkspaceCollaborationStores(cfg);
  const row = await stores.objectStorage.readObject<TeamDeliverableRecord>(
    groupId,
    "deliverable",
    deliverableId,
  );
  if (!row) {
    return { ok: false, reason: "deliverable_not_found", writtenToGroupDir: false };
  }
  const content = typeof row.content === "string" ? row.content : "";
  const paths = resolveGroupCollaborationPaths(groupId, cfg);
  const relativePath =
    compact(row.relativePath) ||
    sanitizeRelativePath(undefined, row.deliverableId, row.version) ||
    `deliverables/${row.deliverableId}.md`;
  const locator = compact(row.formalLocator) || path.join(paths.groupDir, relativePath);
  return {
    ok: true,
    deliverableId: row.deliverableId,
    taskId: row.taskId,
    version: row.version,
    status: row.status,
    content,
    contentSha256: compact(row.contentSha256) || sha256Hex(content),
    sizeBytes: Buffer.byteLength(content, "utf8"),
    locator,
    relativePath,
  };
}
