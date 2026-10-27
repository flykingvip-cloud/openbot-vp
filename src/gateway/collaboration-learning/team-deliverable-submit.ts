/**
 * TEAM-REAL F2 — Host-authorized team deliverable submit.
 *
 * Sandbox drafts stay in the agent workspace until this entry copies/registers
 * them into the collaboration group formal locator. Writing a personal
 * workspace file alone is NOT team delivery success.
 *
 * Does not remount formal-root twins, expand sandbox mounts, or A/B-sync roots.
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Deliverable } from "@openbot/collaboration-core";
import { loadConfig } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { resolveGroupCollaborationPaths } from "./collaboration-paths.js";
import { createWorkspaceCollaborationStores } from "./shared.js";
import { transitionCollaborationDeliverable } from "./state-machine.js";

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

function sanitizeRelativePath(raw: string | undefined, logicalId: string): string | null {
  const fallback = `deliverables/${logicalId}.md`;
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
  const logicalId = compact(params.logicalId) || defaultLogicalId(taskId, title);
  const relativePath = sanitizeRelativePath(params.relativePath, logicalId);
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

  const contentSha256 = sha256Hex(content);
  const sizeBytes = Buffer.byteLength(content, "utf8");
  const stores = createWorkspaceCollaborationStores(cfg);
  const now = params.nowMs ?? Date.now();

  // Idempotent replay: same task + title + body already submitted.
  const existingList = await stores.objectStorage.listObjects<Deliverable>(groupId, "deliverable");
  const replay = existingList.find((row) => {
    if (row.taskId !== taskId) {
      return false;
    }
    if (compact(row.title) !== title) {
      return false;
    }
    const body = typeof row.content === "string" ? row.content : "";
    return (
      sha256Hex(body) === contentSha256 &&
      (row.status === "submitted" ||
        row.status === "in_review" ||
        row.status === "approved" ||
        row.status === "published")
    );
  });
  if (replay) {
    return {
      ok: true,
      taskId,
      groupId,
      deliverableId: replay.deliverableId,
      version: replay.version,
      locator: absolutePath,
      relativePath,
      sizeBytes,
      contentSha256,
      status: replay.status,
      idempotentReplay: true,
    };
  }

  let previous: Deliverable | null = null;
  const previousId = compact(params.previousDeliverableId);
  if (previousId) {
    previous =
      (await stores.objectStorage.readObject<Deliverable>(groupId, "deliverable", previousId)) ??
      null;
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

  const deliverableId = previous
    ? `del-${createHash("sha256").update(`${previous.deliverableId}:${contentSha256}`).digest("hex").slice(0, 20)}`
    : `del-${logicalId}-${randomUUID().slice(0, 8)}`;
  const version = previous ? previous.version + 1 : 1;

  const draft: Deliverable = {
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
  };

  try {
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    // Reject symlink escape: if path exists as symlink outside groupDir, refuse.
    try {
      const st = await fs.lstat(absolutePath);
      if (st.isSymbolicLink()) {
        const real = await fs.realpath(absolutePath).catch(() => null);
        if (!real || !assertInsideGroupDir(paths.groupDir, real)) {
          return {
            ok: false,
            reason: "symlink_escape_rejected",
            writtenToGroupDir: false,
          };
        }
      }
    } catch {
      // path does not exist yet — ok
    }
    await fs.writeFile(absolutePath, content, "utf8");
  } catch (error) {
    return {
      ok: false,
      reason: "formal_root_write_failed",
      detail: error instanceof Error ? error.message : String(error),
      writtenToGroupDir: false,
    };
  }

  try {
    await stores.objectStorage.writeObject(groupId, "deliverable", deliverableId, draft);
  } catch (error) {
    // Best-effort rollback of the file so we never claim success with only a stray file.
    await fs.rm(absolutePath, { force: true }).catch(() => undefined);
    return {
      ok: false,
      reason: "deliverable_object_persist_failed",
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

  // Verify bytes on disk match receipt before claiming success.
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
  const stores = createWorkspaceCollaborationStores(cfg);
  const row = await stores.objectStorage.readObject<Deliverable>(
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
    sanitizeRelativePath(undefined, row.deliverableId) ?? `deliverables/${row.deliverableId}.md`;
  const locator = path.join(paths.groupDir, relativePath);
  return {
    ok: true,
    deliverableId: row.deliverableId,
    taskId: row.taskId,
    version: row.version,
    status: row.status,
    content,
    contentSha256: sha256Hex(content),
    sizeBytes: Buffer.byteLength(content, "utf8"),
    locator,
    relativePath,
  };
}
