/**
 * TEAM-REAL F2 / R2 包1+包3 — Host-authorized team deliverable submit.
 *
 * Sandbox drafts stay in the agent workspace until this entry copies/registers
 * them into the collaboration group formal locator. Writing a personal
 * workspace file alone is NOT team delivery success.
 *
 * Auth → task lookup → object persist → file write all use the SAME trusted
 * groupsRoot/groupLocator from authorizeTeamGroupResourceAccess.
 * Immutable versions use O_EXCL (wx); concurrent submit is lock-scoped.
 * Idempotent replay verifies on-disk bytes; missing file is not "success".
 * Dual-root: never falls back to createWorkspaceCollaborationStores / ~/.openbot/collaboration.
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { DeliverableStateMachine, type Deliverable } from "@openbot/collaboration-core";
import { loadConfig } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { withRoundLock } from "../collaboration-dispatch/round-store-io.js";
import type { GatewayClient } from "../server-methods/types.js";
import {
  assertTaskBelongsToGroup,
  authorizeTeamGroupResourceAccess,
  resolveTeamDeliverableStores,
  type TeamResourceAuthOk,
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
  /**
   * Explicit trusted locator when enforceAcl=false.
   * Required under managed_enterprise without auth — never silent home collaboration.
   */
  trusted?: { groupsRoot: string; groupLocator: string } | null;
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
    }
    const parent = path.dirname(cursor);
    if (parent === cursor || path.resolve(parent) === root) {
      try {
        const rootSt = await fs.lstat(root);
        if (rootSt.isSymbolicLink()) {
          const realRoot = await fs.realpath(root);
          if (path.resolve(realRoot) !== root && !assertInsideGroupDir(root, realRoot)) {
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

/**
 * Create-only write: never overwrites an existing version file.
 * Returns exists_same when bytes already match (safe idempotent).
 */
export async function writeFileExclusiveImmutable(
  absolutePath: string,
  content: string,
  contentSha256: string,
): Promise<
  | { ok: true; created: boolean }
  | { ok: false; reason: "version_path_conflict" | "formal_root_write_failed"; detail?: string }
> {
  const dir = path.dirname(absolutePath);
  await fs.mkdir(dir, { recursive: true });
  try {
    await fs.writeFile(absolutePath, content, { encoding: "utf8", flag: "wx" });
    return { ok: true, created: true };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST") {
      try {
        const existing = await fs.readFile(absolutePath, "utf8");
        if (sha256Hex(existing) === contentSha256) {
          return { ok: true, created: false };
        }
        return { ok: false, reason: "version_path_conflict", detail: absolutePath };
      } catch (readError) {
        return {
          ok: false,
          reason: "formal_root_write_failed",
          detail: readError instanceof Error ? readError.message : String(readError),
        };
      }
    }
    return {
      ok: false,
      reason: "formal_root_write_failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

function receiptFromRecord(params: {
  row: TeamDeliverableRecord;
  groupId: string;
  taskId: string;
  contentSha256: string;
  locator: string;
  relativePath: string;
  contentFallback: string;
}): TeamDeliverableSubmitReceipt {
  const body = typeof params.row.content === "string" ? params.row.content : params.contentFallback;
  return {
    ok: true,
    taskId: params.taskId,
    groupId: params.groupId,
    deliverableId: params.row.deliverableId,
    version: params.row.version,
    locator: params.locator,
    relativePath: params.relativePath,
    sizeBytes: Buffer.byteLength(body, "utf8"),
    contentSha256: params.contentSha256,
    status: params.row.status,
    idempotentReplay: true,
  };
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
  let auth: TeamResourceAuthOk | null = null;
  if (enforceAcl) {
    const authResult = await authorizeTeamGroupResourceAccess({
      groupId,
      actor,
      client: params.client,
      tenant: params.tenant,
      cfg,
      identityAliases: params.identityAliases,
      action: "write",
    });
    if (!authResult.ok) {
      return {
        ok: false,
        reason: authResult.reason,
        detail: authResult.detail,
        writtenToGroupDir: false,
      };
    }
    auth = authResult;
  }

  const storesResult = resolveTeamDeliverableStores({
    auth,
    trusted: params.trusted,
    groupId,
    cfg,
    tenantId: auth?.tenantId ?? params.tenant?.tenantId ?? null,
  });
  if (!storesResult.ok) {
    return {
      ok: false,
      reason: storesResult.reason,
      detail: storesResult.detail,
      writtenToGroupDir: false,
    };
  }
  const stores = storesResult;
  const groupDir = stores.groupDir;

  const taskCheck = await assertTaskBelongsToGroup({
    groupId,
    taskId,
    cfg,
    stores,
  });
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
  const now = params.nowMs ?? Date.now();
  const logicalId = compact(params.logicalId) || defaultLogicalId(taskId, title);
  const lockStem = createHash("sha256")
    .update(`${groupId}\n${taskId}\n${logicalId}`)
    .digest("hex")
    .slice(0, 24);
  const lockDir = path.join(groupDir, ".team-deliverable-locks");

  return withRoundLock(lockDir, lockStem, async () => {
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
          ok: false as const,
          reason: "previous_deliverable_not_found",
          detail: previousId,
          writtenToGroupDir: false as const,
        };
      }
      if (previous.taskId && previous.taskId !== taskId) {
        return {
          ok: false as const,
          reason: "previous_task_mismatch",
          detail: `previous taskId=${previous.taskId} current=${taskId}`,
          writtenToGroupDir: false as const,
        };
      }
    }

    let existingList: TeamDeliverableRecord[];
    try {
      existingList = await stores.objectStorage.listObjects<TeamDeliverableRecord>(
        groupId,
        "deliverable",
      );
    } catch (error) {
      return {
        ok: false as const,
        reason: "deliverable_list_failed",
        detail: error instanceof Error ? error.message : String(error),
        writtenToGroupDir: false as const,
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
        compact(row.contentSha256) ||
        (typeof row.content === "string" ? sha256Hex(row.content) : "");
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
      const locator = compact(replay.formalLocator) || path.join(groupDir, storedRel);
      try {
        const onDisk = await fs.readFile(locator, "utf8");
        if (sha256Hex(onDisk) !== contentSha256) {
          return {
            ok: false as const,
            reason: "idempotent_replay_content_mismatch",
            detail: locator,
            writtenToGroupDir: false as const,
          };
        }
      } catch {
        return {
          ok: false as const,
          reason: "idempotent_replay_file_missing",
          detail: locator,
          writtenToGroupDir: false as const,
        };
      }
      return receiptFromRecord({
        row: replay,
        groupId,
        taskId,
        contentSha256,
        locator,
        relativePath: storedRel,
        contentFallback: content,
      });
    }

    const version = previous ? previous.version + 1 : 1;
    const relativePath = sanitizeRelativePath(
      previous ? undefined : params.relativePath,
      logicalId,
      version,
    );
    if (!relativePath) {
      return {
        ok: false as const,
        reason: "invalid_relative_path",
        detail: "relativePath must stay under deliverables/ without traversal",
        writtenToGroupDir: false as const,
      };
    }

    const absolutePath = path.join(groupDir, relativePath);
    if (!assertInsideGroupDir(groupDir, absolutePath)) {
      return {
        ok: false as const,
        reason: "path_escape_rejected",
        detail: "resolved path escaped groupDir",
        writtenToGroupDir: false as const,
      };
    }

    const symlinkCheck = await assertNoSymlinkEscape({
      groupDir,
      absolutePath,
    });
    if (!symlinkCheck.ok) {
      return {
        ok: false as const,
        reason: symlinkCheck.reason,
        writtenToGroupDir: false as const,
      };
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

    try {
      await stores.objectStorage.writeObject(groupId, "deliverable", deliverableId, draft);
    } catch (error) {
      return {
        ok: false as const,
        reason: "deliverable_object_persist_failed",
        detail: error instanceof Error ? error.message : String(error),
        writtenToGroupDir: false as const,
      };
    }

    const written = await writeFileExclusiveImmutable(absolutePath, content, contentSha256);
    if (!written.ok) {
      return {
        ok: false as const,
        reason: written.reason,
        detail: written.detail,
        writtenToGroupDir: false as const,
      };
    }

    // Transition on the SAME trusted stores (do not call state-machine helper that
    // re-roots via createWorkspaceCollaborationStores without tenant context).
    let submitted: TeamDeliverableRecord;
    try {
      const machine = new DeliverableStateMachine();
      const nextStatus = machine.transition(draft.status, "submitted", actor);
      submitted = {
        ...draft,
        status: nextStatus,
        submittedAtMs: now,
        updatedBy: actor,
        updatedAtMs: now,
        relativePath,
        contentSha256,
        formalLocator: absolutePath,
      };
      await stores.objectStorage.writeObject(groupId, "deliverable", deliverableId, submitted);
    } catch (error) {
      return {
        ok: false as const,
        reason: "deliverable_submit_transition_failed",
        detail: error instanceof Error ? error.message : String(error),
        writtenToGroupDir: false as const,
      };
    }

    try {
      const onDisk = await fs.readFile(absolutePath, "utf8");
      if (sha256Hex(onDisk) !== contentSha256) {
        return {
          ok: false as const,
          reason: "content_digest_mismatch_after_write",
          writtenToGroupDir: false as const,
        };
      }
    } catch (error) {
      return {
        ok: false as const,
        reason: "formal_root_unreadable_after_write",
        detail: error instanceof Error ? error.message : String(error),
        writtenToGroupDir: false as const,
      };
    }

    return {
      ok: true as const,
      taskId,
      groupId,
      deliverableId: submitted.deliverableId,
      version: submitted.version,
      locator: absolutePath,
      relativePath,
      sizeBytes,
      contentSha256,
      status: submitted.status,
      idempotentReplay: !written.created,
    };
  });
}

/** Authorized peer read of a previously submitted team deliverable. */
export async function readTeamDeliverable(params: {
  groupId: string;
  deliverableId: string;
  actor: string;
  tenant?: CollaborationTenantResolution | null;
  client?: GatewayClient | null;
  enforceAcl?: boolean;
  trusted?: { groupsRoot: string; groupLocator: string } | null;
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
  let auth: TeamResourceAuthOk | null = null;
  if (params.enforceAcl !== false) {
    const authResult = await authorizeTeamGroupResourceAccess({
      groupId,
      actor,
      client: params.client,
      tenant: params.tenant,
      cfg,
      identityAliases: params.identityAliases,
      action: "read",
    });
    if (!authResult.ok) {
      return {
        ok: false,
        reason: authResult.reason,
        detail: authResult.detail,
        writtenToGroupDir: false,
      };
    }
    auth = authResult;
  }
  const storesResult = resolveTeamDeliverableStores({
    auth,
    trusted: params.trusted,
    groupId,
    cfg,
    tenantId: auth?.tenantId ?? params.tenant?.tenantId ?? null,
  });
  if (!storesResult.ok) {
    return {
      ok: false,
      reason: storesResult.reason,
      detail: storesResult.detail,
      writtenToGroupDir: false,
    };
  }
  const stores = storesResult;
  const row = await stores.objectStorage.readObject<TeamDeliverableRecord>(
    groupId,
    "deliverable",
    deliverableId,
  );
  if (!row) {
    return { ok: false, reason: "deliverable_not_found", writtenToGroupDir: false };
  }
  const body = typeof row.content === "string" ? row.content : "";
  const relativePath =
    compact(row.relativePath) ||
    sanitizeRelativePath(undefined, row.deliverableId, row.version) ||
    `deliverables/${row.deliverableId}.md`;
  const locator = compact(row.formalLocator) || path.join(stores.groupDir, relativePath);
  return {
    ok: true,
    deliverableId: row.deliverableId,
    taskId: row.taskId,
    version: row.version,
    status: row.status,
    content: body,
    contentSha256: compact(row.contentSha256) || sha256Hex(body),
    sizeBytes: Buffer.byteLength(body, "utf8"),
    locator,
    relativePath,
  };
}
