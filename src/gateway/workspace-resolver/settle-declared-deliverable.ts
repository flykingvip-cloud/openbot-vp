import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../../config/config.js";
import {
  extractDeliverableEnvelope,
  normalizeDeliverableWorkspacePath,
  type DeliverableSettleState,
} from "../../shared/preview-artifact/deliverable-envelope.js";
import {
  buildDraftUpsertManifest,
  pruneExpiredDraftEntriesInManifest,
  readGroupDeliverableManifest,
  resolveLogicalId,
  writeGroupDeliverableManifest,
} from "../knowledge/deliverables/group-manifest.js";
import { resolveSecurityProfile } from "../security-profile.js";
import { resolveTrustedGroupLocator } from "../workspace/group-locator.js";
import { alignFormalRootForManagedAddressing } from "./formal-deliverable-root.js";
import { resolveWorkspaceWriteLocator } from "./workspace-write-contract.js";
import { isFilesystemWorkspaceLocator, resolvePlacedFilesystemWriteRoot } from "./write-roots.js";

/**
 * Collaboration deliverable settlement (PR C).
 *
 * Model `file=` is only a **declaration**. System confirmation requires:
 * 1. non-empty bytes at the exact workspace-relative path (basename-only match is insufficient);
 * 2. for collaboration groups: bytes landed on the **group formal root** (same root
 *    `group-file.read` uses — birth/SOT authority for preview);
 * 3. group `.manifest.json` draft entry with the **same** relativePath.
 *
 * Team KB「团队成果」is an archive/list dimension (saveAndArchive), not alternate
 * preview storage. Group SOT remains authoritative for preview refs.
 *
 * Outcomes:
 * - `confirmed` — disk + (group) manifest OK; envelope `settle="confirmed"`; `file=` is final relative path;
 *   group formal-root checksum MUST equal this deliverable version
 * - `conflict` — group path already has different bytes/version; do not overwrite or confirm
 * - `retryable` — group disk OK but manifest write failed; OR group-scoped root unavailable (missing
 *   tenant / locator fail) — must not present as archived or as personal-only success
 * - `unwritten` — no previewable bytes at the declared relative path
 * - `readable` — agent-only when the work was never group-scoped (no groupId)
 *
 * Group metadata (`runtime/`, `governance/`, `profile/`) is never a deliverable target.
 */

const TEXT_LIKE_EXTENSIONS = new Set([
  ".md",
  ".markdown",
  ".txt",
  ".text",
  ".log",
  ".csv",
  ".tsv",
  ".json",
  ".yaml",
  ".yml",
  ".html",
  ".htm",
  ".xml",
]);

const GROUP_RESERVED_PREFIXES = ["runtime/", "governance/", "profile/", "sessions/", ".git/"];

export type DeclaredDeliverableSettlement = {
  text: string;
  status: "none" | "readable" | "confirmed" | "unwritten" | "retryable" | "conflict";
  relativePath?: string;
  /** sha256 of the intended deliverable bytes (version checksum). */
  versionChecksum?: string;
  /** sha256 of existing group formal-root bytes when status is conflict. */
  existingChecksum?: string;
  /** Whether group manifest was updated for this settle. */
  manifestOk?: boolean;
  reason?: string;
};

function isReservedGroupRelative(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/").toLowerCase();
  return GROUP_RESERVED_PREFIXES.some(
    (prefix) => normalized === prefix.slice(0, -1) || normalized.startsWith(prefix),
  );
}

function locatedWrite(
  root: string,
  relativePath: string,
): { absolutePath: string; relativePath: string } | null {
  if (!root.trim() || !isFilesystemWorkspaceLocator(root)) {
    return null;
  }
  const decision = resolveWorkspaceWriteLocator({
    workspaceRoot: path.resolve(root),
    requestedPath: relativePath,
  });
  if (!decision.ok) {
    return null;
  }
  const relative = normalizeDeliverableWorkspacePath(decision.relativePath);
  if (!relative) {
    return null;
  }
  const absolutePath = path.resolve(path.resolve(root), relative);
  const escaped = path.relative(path.resolve(root), absolutePath);
  if (escaped.startsWith("..") || path.isAbsolute(escaped)) {
    return null;
  }
  return { absolutePath, relativePath: relative };
}

function readNonEmpty(absolutePath: string): Buffer | null {
  try {
    const stat = fs.statSync(absolutePath);
    if (!stat.isFile() || stat.size <= 0) {
      return null;
    }
    return fs.readFileSync(absolutePath);
  } catch {
    return null;
  }
}

function writeBytes(absolutePath: string, bytes: Buffer): boolean {
  if (bytes.length === 0) {
    return false;
  }
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, bytes);
  return readNonEmpty(absolutePath) !== null;
}

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Replace or inject envelope attributes for a matching `file=` declaration.
 * `file=` is rewritten to `nextRelativePath` when provided (final disk path).
 */
export function patchDeliverableDeclarationAttrs(
  text: string,
  declaredRelativePath: string,
  patch: {
    nextRelativePath?: string;
    unwritten?: boolean;
    settle?: DeliverableSettleState | null;
  },
): string {
  const escaped = declaredRelativePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `<<\\s*DELIVERABLE\\b([^>]*\\bfile\\s*=\\s*["']${escaped}["'][^>]*)>+`,
    "i",
  );
  return text.replace(re, (_full, attrs: string) => {
    let nextAttrs = String(attrs);
    const fileTarget = patch.nextRelativePath ?? declaredRelativePath;
    nextAttrs = nextAttrs.replace(
      new RegExp(`(\\bfile\\s*=\\s*)(["'])${escaped}\\2`, "i"),
      `$1$2${fileTarget}$2`,
    );
    if (patch.unwritten === true) {
      if (!/\bunwritten\s*=/i.test(nextAttrs)) {
        nextAttrs = `${nextAttrs} unwritten="1"`;
      }
    } else if (patch.unwritten === false) {
      nextAttrs = nextAttrs.replace(/\s*\bunwritten\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+)/gi, "");
    }
    if (patch.settle === null) {
      nextAttrs = nextAttrs.replace(/\s*\bsettle\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+)/gi, "");
    } else if (patch.settle) {
      if (/\bsettle\s*=/i.test(nextAttrs)) {
        nextAttrs = nextAttrs.replace(
          /\bsettle\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+)/gi,
          `settle="${patch.settle}"`,
        );
      } else {
        nextAttrs = `${nextAttrs} settle="${patch.settle}"`;
      }
    }
    return `<<DELIVERABLE${nextAttrs}>>`;
  });
}

export function markDeliverableDeclarationUnwritten(text: string, relativePath: string): string {
  return patchDeliverableDeclarationAttrs(text, relativePath, {
    unwritten: true,
    settle: "declared",
  });
}

function markConfirmed(
  text: string,
  declaredRelativePath: string,
  finalRelativePath: string,
): string {
  return patchDeliverableDeclarationAttrs(text, declaredRelativePath, {
    nextRelativePath: finalRelativePath,
    unwritten: false,
    settle: "confirmed",
  });
}

function markRetryable(
  text: string,
  declaredRelativePath: string,
  finalRelativePath: string,
): string {
  return patchDeliverableDeclarationAttrs(text, declaredRelativePath, {
    nextRelativePath: finalRelativePath,
    unwritten: false,
    settle: "retryable",
  });
}

function markConflict(
  text: string,
  declaredRelativePath: string,
  finalRelativePath: string,
): string {
  return patchDeliverableDeclarationAttrs(text, declaredRelativePath, {
    nextRelativePath: finalRelativePath,
    unwritten: false,
    settle: "conflict",
  });
}

/**
 * Upsert a group draft manifest entry pointing at the confirmed relative path.
 * Idempotent when the same logicalId already maps to the same relativePath.
 * Returns false on write failure (caller → retryable).
 */
export function upsertGroupSettleManifestDraft(params: {
  groupWorkspaceRoot: string;
  relativePath: string;
  title?: string | null;
  logicalId?: string | null;
}): boolean {
  try {
    const root = path.resolve(params.groupWorkspaceRoot);
    if (!isFilesystemWorkspaceLocator(root)) {
      return false;
    }
    const logicalId = resolveLogicalId({
      explicit: params.logicalId,
      title: params.title,
      filename: params.relativePath,
    });
    const manifest = readGroupDeliverableManifest(root);
    const existing = manifest.drafts?.[logicalId] ?? manifest.canonical?.[logicalId];
    if (existing?.relativePath === params.relativePath) {
      // Idempotent confirm: already pinned to the same relative path.
      // Still refresh draft updatedAt when only a draft exists.
      if (manifest.canonical?.[logicalId]?.relativePath === params.relativePath) {
        return true;
      }
    }
    const nowMs = Date.now();
    const withDraft = buildDraftUpsertManifest(manifest, {
      logicalId,
      title: params.title?.trim() || path.posix.basename(params.relativePath),
      relativePath: params.relativePath,
      workspaceFilename: params.relativePath,
      nowMs,
    });
    const { manifest: prunedManifest, prunedRelativePaths } = pruneExpiredDraftEntriesInManifest(
      withDraft,
      { nowMs },
    );
    void prunedRelativePaths;
    writeGroupDeliverableManifest(root, prunedManifest);
    const verify = readGroupDeliverableManifest(root);
    const entry = verify.drafts?.[logicalId] ?? verify.canonical?.[logicalId];
    return entry?.relativePath === params.relativePath;
  } catch {
    return false;
  }
}

/**
 * Land or reject one declared `file=` against the bot workspace and the group workspace.
 * Explicit roots (including null) skip live locator resolution — tests use that.
 *
 * When `groupWorkspaceRoot` is set, confirmation requires the exact relative path under
 * that group root (no basename-only search in sibling directories).
 */
export function settleDeclaredDeliverableText(params: {
  text: string;
  agentWorkspaceRoot?: string | null;
  groupWorkspaceRoot?: string | null;
}): DeclaredDeliverableSettlement {
  const envelope = extractDeliverableEnvelope(params.text);
  const relativePath = envelope?.file;
  if (!relativePath) {
    return { text: params.text, status: "none" };
  }

  const groupRoot = params.groupWorkspaceRoot?.trim() || null;
  const agentRoot = params.agentWorkspaceRoot?.trim() || null;

  const agentLocated = agentRoot ? locatedWrite(agentRoot, relativePath) : null;
  const groupReserved = groupRoot ? isReservedGroupRelative(relativePath) : false;
  const groupLocated = groupRoot && !groupReserved ? locatedWrite(groupRoot, relativePath) : null;

  if (!agentLocated && !groupLocated) {
    return {
      text: markDeliverableDeclarationUnwritten(params.text, relativePath),
      status: "unwritten",
      relativePath,
      reason: groupReserved ? "group_reserved_path" : "no_writable_root",
    };
  }

  // Exact relative path only — never promote a basename hit from another directory.
  // Intended version: agent tool-write > group SOT > envelope body. Preferring group
  // over a short envelope summary preserves idempotent re-confirm of already-landed
  // SOT; agent-vs-group checksum compare below catches stale group vs newer bot write.
  const ext = path.posix.extname(relativePath).toLowerCase();
  let bytes: Buffer | null = null;
  let byteSource: "agent" | "envelope" | "group" | null = null;
  if (agentLocated) {
    const agentBytes = readNonEmpty(agentLocated.absolutePath);
    if (agentBytes) {
      bytes = agentBytes;
      byteSource = "agent";
    }
  }
  if (!bytes && groupLocated) {
    const groupBytes = readNonEmpty(groupLocated.absolutePath);
    if (groupBytes) {
      bytes = groupBytes;
      byteSource = "group";
    }
  }
  if (!bytes && TEXT_LIKE_EXTENSIONS.has(ext)) {
    const body = envelope?.body ?? "";
    if (body.trim() && Buffer.byteLength(body) > 0) {
      bytes = Buffer.from(body, "utf8");
      byteSource = "envelope";
    }
  }

  if (!bytes || !byteSource) {
    return {
      text: markDeliverableDeclarationUnwritten(params.text, relativePath),
      status: "unwritten",
      relativePath,
      reason: TEXT_LIKE_EXTENSIONS.has(ext) ? "empty_content" : "binary_requires_tool_write",
    };
  }

  const checksum = sha256Hex(bytes);

  // Land intended bytes on the agent workspace when missing or when mirroring
  // from group/envelope (never clobber a differing agent file that was the source).
  if (agentLocated) {
    const existingAgent = readNonEmpty(agentLocated.absolutePath);
    if (!existingAgent) {
      if (!writeBytes(agentLocated.absolutePath, bytes)) {
        return {
          text: markDeliverableDeclarationUnwritten(params.text, relativePath),
          status: "unwritten",
          relativePath,
          reason: "write_failed",
        };
      }
    } else if (byteSource !== "agent" && sha256Hex(existingAgent) !== checksum) {
      if (!writeBytes(agentLocated.absolutePath, bytes)) {
        return {
          text: markDeliverableDeclarationUnwritten(params.text, relativePath),
          status: "unwritten",
          relativePath,
          reason: "write_failed",
        };
      }
    }
  }

  // Collaboration group: require exact path on group formal root with matching
  // checksum, then manifest. Differing existing group bytes → explicit conflict.
  if (groupRoot) {
    if (!groupLocated) {
      return {
        text: markDeliverableDeclarationUnwritten(params.text, relativePath),
        status: "unwritten",
        relativePath,
        reason: "group_formal_root_miss",
      };
    }
    const finalRelativePath = groupLocated.relativePath;
    const existingGroup = readNonEmpty(groupLocated.absolutePath);
    if (existingGroup) {
      const existingChecksum = sha256Hex(existingGroup);
      if (existingChecksum !== checksum) {
        return {
          text: markConflict(params.text, relativePath, finalRelativePath),
          status: "conflict",
          relativePath: finalRelativePath,
          versionChecksum: checksum,
          existingChecksum,
          reason: "version_conflict",
        };
      }
    } else if (!writeBytes(groupLocated.absolutePath, bytes)) {
      return {
        text: markDeliverableDeclarationUnwritten(params.text, relativePath),
        status: "unwritten",
        relativePath,
        reason: "write_failed",
      };
    }

    const landed = readNonEmpty(groupLocated.absolutePath);
    if (!landed || sha256Hex(landed) !== checksum) {
      return {
        text: markDeliverableDeclarationUnwritten(params.text, relativePath),
        status: "unwritten",
        relativePath,
        reason: "group_formal_root_miss",
      };
    }

    const manifestOk = upsertGroupSettleManifestDraft({
      groupWorkspaceRoot: groupRoot,
      relativePath: finalRelativePath,
      title: envelope?.title,
      logicalId: envelope?.logicalId,
    });
    if (!manifestOk) {
      return {
        text: markRetryable(params.text, relativePath, finalRelativePath),
        status: "retryable",
        relativePath: finalRelativePath,
        versionChecksum: checksum,
        manifestOk: false,
        reason: "manifest_write_failed",
      };
    }
    return {
      text: markConfirmed(params.text, relativePath, finalRelativePath),
      status: "confirmed",
      relativePath: finalRelativePath,
      versionChecksum: checksum,
      manifestOk: true,
    };
  }

  // Agent-only (no group root): legacy readable success — only when never group-scoped.
  if (!agentLocated || !readNonEmpty(agentLocated.absolutePath)) {
    return {
      text: markDeliverableDeclarationUnwritten(params.text, relativePath),
      status: "unwritten",
      relativePath,
      reason: "write_failed",
    };
  }
  return {
    text: params.text,
    status: "readable",
    relativePath,
    versionChecksum: checksum,
  };
}

export type CollaborationDeliverableRoots = {
  agentWorkspaceRoot: string | null;
  groupWorkspaceRoot: string | null;
  /** Set when groupId was present but the group formal root could not be resolved. */
  groupRootFailureReason?: "missing_tenant" | "locator_failed";
};

export function resolveCollaborationDeliverableRoots(params: {
  agentId: string;
  groupId?: string | null;
  tenantId?: string | null;
  userId?: string | null;
  sessionKey?: string | null;
  stateDir?: string;
}): CollaborationDeliverableRoots {
  const placed = resolvePlacedFilesystemWriteRoot({
    agentId: params.agentId,
    tenantId: params.tenantId,
    userId: params.userId,
    sessionKey: params.sessionKey,
    stateDir: params.stateDir,
    ensureDirectory: Boolean(params.userId?.trim()),
  });
  const agentWorkspaceRoot = placed ? alignFormalRootForManagedAddressing(placed) : null;
  let groupWorkspaceRoot: string | null = null;
  let groupRootFailureReason: CollaborationDeliverableRoots["groupRootFailureReason"];
  const groupId = params.groupId?.trim();
  if (groupId) {
    try {
      const cfg = loadConfig();
      const profile = resolveSecurityProfile(cfg, process.env);
      // PR A: group formal root always from trusted locator (same as group-file.read).
      // Missing tenant on managed_enterprise → hard miss (never invent operators path,
      // never degrade to agent-only success for a group-scoped settle).
      if (profile.profile === "managed_enterprise" && !params.tenantId?.trim()) {
        groupWorkspaceRoot = null;
        groupRootFailureReason = "missing_tenant";
      } else {
        const locator = resolveTrustedGroupLocator({
          groupId,
          tenantId: params.tenantId?.trim() || null,
          profile: profile.profile,
          cfg,
        });
        if (isFilesystemWorkspaceLocator(locator)) {
          groupWorkspaceRoot = path.resolve(locator);
        } else {
          groupRootFailureReason = "locator_failed";
        }
      }
    } catch {
      groupWorkspaceRoot = null;
      groupRootFailureReason = "locator_failed";
    }
  }
  return { agentWorkspaceRoot, groupWorkspaceRoot, groupRootFailureReason };
}

/** Settle a collaboration reply before it is persisted or broadcast. */
export function settleCollaborationDeclaredDeliverable(params: {
  text: string;
  agentId: string;
  groupId?: string | null;
  tenantId?: string | null;
  userId?: string | null;
  sessionKey?: string | null;
  stateDir?: string;
  agentWorkspaceRoot?: string | null;
  groupWorkspaceRoot?: string | null;
  /** When roots are injected: true means the turn was group-scoped even if group root is null. */
  groupScoped?: boolean;
}): DeclaredDeliverableSettlement {
  // Most replies are not deliverables. Skip locator resolution until file= is present.
  if (!params.text.includes("DELIVERABLE")) {
    return { text: params.text, status: "none" };
  }
  const declared = extractDeliverableEnvelope(params.text);
  if (!declared?.file) {
    return { text: params.text, status: "none" };
  }
  const groupId = params.groupId?.trim() || null;
  const injectedRoots = "agentWorkspaceRoot" in params || "groupWorkspaceRoot" in params;
  const roots: CollaborationDeliverableRoots = injectedRoots
    ? {
        agentWorkspaceRoot: params.agentWorkspaceRoot ?? null,
        groupWorkspaceRoot: params.groupWorkspaceRoot ?? null,
        groupRootFailureReason:
          (params.groupScoped || Boolean(groupId)) && !params.groupWorkspaceRoot
            ? "locator_failed"
            : undefined,
      }
    : resolveCollaborationDeliverableRoots(params);

  // Group-scoped settle must never degrade to agent-only `readable` success when the
  // group formal root is missing (missing tenant / locator failure). Keep「群任务」and fail closed.
  const groupScoped =
    Boolean(groupId) || params.groupScoped === true || Boolean(roots.groupRootFailureReason);
  if (groupScoped && !roots.groupWorkspaceRoot) {
    const reason = roots.groupRootFailureReason ?? "group_root_unavailable";
    return {
      text: markRetryable(params.text, declared.file, declared.file),
      status: "retryable",
      relativePath: declared.file,
      manifestOk: false,
      reason,
    };
  }

  return settleDeclaredDeliverableText({
    text: params.text,
    agentWorkspaceRoot: roots.agentWorkspaceRoot,
    groupWorkspaceRoot: roots.groupWorkspaceRoot,
  });
}
