/**
 * Shared group document — single SoT under group `deliverables/` so all members
 * review and write the same file (rules v1.1 C2 / design 22 board.deliverablePaths).
 *
 * Layout (relative to group workspace root):
 *   deliverables/{logicalId}.md              — body SoT
 *   deliverables/{logicalId}.meta.json       — sections, lock, reviewers
 *   deliverables/{logicalId}.reviews.jsonl   — review comments (not body)
 *
 * Body edits and meta updates take a per-doc file lock (same pattern as withRoundLock).
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MS = 20;
const LOCK_MAX_ATTEMPTS = 250;

export type SharedDocSectionStatus =
  | "todo"
  | "claimed"
  | "in_progress"
  | "in_review"
  | "done"
  | "blocked";

export type SharedDocSection = {
  id: string;
  title: string;
  ownerAgentId: string | null;
  status: SharedDocSectionStatus;
  /** Inclusive line hint for humans; not enforced as a hard slice in v1. */
  anchorHeading?: string;
  workItemId?: string;
  updatedAt: string;
  updatedByAgentId?: string;
};

export type SharedDocMeta = {
  version: 1;
  groupId: string;
  logicalId: string;
  title: string;
  relativePath: string;
  taskId?: string;
  sections: SharedDocSection[];
  /** Soft lock for whole-doc body write (section claim is preferred). */
  bodyLock?: {
    holderAgentId: string;
    heldAt: string;
    expiresAt: string;
  } | null;
  updatedAt: string;
};

export type SharedDocReviewComment = {
  id: string;
  at: string;
  byAgentId: string;
  sectionId?: string;
  /** Comment on the shared doc — never silently rewritten into body. */
  kind: "comment" | "request_changes" | "approve";
  body: string;
  resolvesCommentId?: string;
};

export type SharedDocOpenResult = {
  absolutePath: string;
  relativePath: string;
  metaPath: string;
  reviewsPath: string;
  meta: SharedDocMeta;
  body: string;
  exists: boolean;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowIso(now?: Date | string): string {
  return typeof now === "string" ? now : (now ?? new Date()).toISOString();
}

export function slugifySharedDocId(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "shared-doc";
}

export function sharedDocRelativePath(logicalId: string): string {
  return path.posix.join("deliverables", `${slugifySharedDocId(logicalId)}.md`);
}

export function sharedDocPaths(groupWorkspaceRoot: string, logicalId: string) {
  const id = slugifySharedDocId(logicalId);
  const relativePath = sharedDocRelativePath(id);
  const absolutePath = path.join(groupWorkspaceRoot, "deliverables", `${id}.md`);
  return {
    logicalId: id,
    relativePath,
    absolutePath,
    metaPath: path.join(groupWorkspaceRoot, "deliverables", `${id}.meta.json`),
    reviewsPath: path.join(groupWorkspaceRoot, "deliverables", `${id}.reviews.jsonl`),
    lockPath: path.join(groupWorkspaceRoot, "deliverables", `${id}.doc.lock`),
  };
}

async function withDocLock<T>(lockPath: string, fn: () => T | Promise<T>): Promise<T> {
  await fsp.mkdir(path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < LOCK_MAX_ATTEMPTS; attempt += 1) {
    try {
      const fd = fs.openSync(lockPath, "wx", 0o600);
      try {
        fs.writeFileSync(fd, `${process.pid}\n${Date.now()}\n`, "utf8");
        return await fn();
      } finally {
        fs.closeSync(fd);
        try {
          fs.unlinkSync(lockPath);
        } catch {
          // ignore
        }
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        throw error;
      }
      try {
        const st = fs.statSync(lockPath);
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch {
        // raced unlock
      }
      await sleep(LOCK_RETRY_MS);
    }
  }
  throw new Error(`shared-doc lock timeout: ${lockPath}`);
}

async function writeJsonDurable(dest: string, value: unknown): Promise<void> {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await fsp.open(tmp, "w", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fsp.rename(tmp, dest);
}

async function writeTextDurable(dest: string, content: string): Promise<void> {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await fsp.open(tmp, "w", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fsp.rename(tmp, dest);
}

function emptyMeta(params: {
  groupId: string;
  logicalId: string;
  title: string;
  relativePath: string;
  taskId?: string;
  now?: Date | string;
}): SharedDocMeta {
  const updatedAt = nowIso(params.now);
  return {
    version: 1,
    groupId: params.groupId,
    logicalId: params.logicalId,
    title: params.title,
    relativePath: params.relativePath,
    ...(params.taskId ? { taskId: params.taskId } : {}),
    sections: [],
    bodyLock: null,
    updatedAt,
  };
}

async function readMetaFile(metaPath: string): Promise<SharedDocMeta | null> {
  try {
    const raw = await fsp.readFile(metaPath, "utf8");
    const parsed = JSON.parse(raw) as SharedDocMeta;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.sections)) {
      return null;
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function readMetaFileSync(metaPath: string): SharedDocMeta | null {
  try {
    const raw = fs.readFileSync(metaPath, "utf8");
    const parsed = JSON.parse(raw) as SharedDocMeta;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.sections)) {
      return null;
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

/**
 * Ensure the shared markdown + meta exist. All members open the same relativePath.
 */
export async function openOrCreateSharedDoc(params: {
  groupWorkspaceRoot: string;
  groupId: string;
  logicalId: string;
  title: string;
  taskId?: string;
  initialBody?: string;
  now?: Date | string;
}): Promise<SharedDocOpenResult> {
  const paths = sharedDocPaths(params.groupWorkspaceRoot, params.logicalId);
  return await withDocLock(paths.lockPath, async () => {
    let meta = await readMetaFile(paths.metaPath);
    let exists = true;
    let body = "";
    try {
      body = await fsp.readFile(paths.absolutePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      exists = false;
    }
    if (!meta) {
      meta = emptyMeta({
        groupId: params.groupId,
        logicalId: paths.logicalId,
        title: params.title,
        relativePath: paths.relativePath,
        taskId: params.taskId,
        now: params.now,
      });
      await writeJsonDurable(paths.metaPath, meta);
    }
    if (!exists) {
      const seed =
        params.initialBody?.trim() ||
        `# ${params.title}\n\n<!-- shared-group-doc:${paths.logicalId} -->\n\n`;
      await writeTextDurable(paths.absolutePath, seed.endsWith("\n") ? seed : `${seed}\n`);
      body = seed.endsWith("\n") ? seed : `${seed}\n`;
      exists = true;
    }
    return {
      absolutePath: paths.absolutePath,
      relativePath: paths.relativePath,
      metaPath: paths.metaPath,
      reviewsPath: paths.reviewsPath,
      meta,
      body,
      exists,
    };
  });
}

export async function upsertSharedDocSection(params: {
  groupWorkspaceRoot: string;
  logicalId: string;
  section: Omit<SharedDocSection, "updatedAt"> & { updatedAt?: string };
  actorAgentId: string;
  now?: Date | string;
}): Promise<SharedDocMeta> {
  const paths = sharedDocPaths(params.groupWorkspaceRoot, params.logicalId);
  return await withDocLock(paths.lockPath, async () => {
    const meta = await readMetaFile(paths.metaPath);
    if (!meta) {
      throw new Error(`shared-doc meta missing: ${paths.logicalId}`);
    }
    const updatedAt = params.section.updatedAt ?? nowIso(params.now);
    const nextSection: SharedDocSection = {
      ...params.section,
      updatedAt,
      updatedByAgentId: params.actorAgentId,
    };
    const idx = meta.sections.findIndex((s) => s.id === nextSection.id);
    const sections = [...meta.sections];
    if (idx >= 0) {
      sections[idx] = { ...sections[idx], ...nextSection };
    } else {
      sections.push(nextSection);
    }
    const next: SharedDocMeta = { ...meta, sections, updatedAt };
    await writeJsonDurable(paths.metaPath, next);
    return next;
  });
}

/**
 * C0-style claim on a section. Fails if another owner holds claimed/in_progress/in_review.
 */
export async function claimSharedDocSection(params: {
  groupWorkspaceRoot: string;
  logicalId: string;
  sectionId: string;
  agentId: string;
  now?: Date | string;
}): Promise<SharedDocMeta> {
  const paths = sharedDocPaths(params.groupWorkspaceRoot, params.logicalId);
  return await withDocLock(paths.lockPath, async () => {
    const meta = await readMetaFile(paths.metaPath);
    if (!meta) {
      throw new Error(`shared-doc meta missing: ${paths.logicalId}`);
    }
    const idx = meta.sections.findIndex((s) => s.id === params.sectionId);
    if (idx < 0) {
      throw new Error(`shared-doc section not found: ${params.sectionId}`);
    }
    const section = meta.sections[idx];
    const busy =
      section.ownerAgentId &&
      section.ownerAgentId !== params.agentId &&
      (section.status === "claimed" ||
        section.status === "in_progress" ||
        section.status === "in_review");
    if (busy) {
      throw new Error(
        `shared-doc section held by ${section.ownerAgentId} (status=${section.status})`,
      );
    }
    const updatedAt = nowIso(params.now);
    const nextStatus: SharedDocSectionStatus =
      section.status === "in_progress" || section.status === "in_review"
        ? section.status
        : "claimed";
    const sections = [...meta.sections];
    sections[idx] = {
      ...section,
      ownerAgentId: params.agentId,
      status: nextStatus,
      updatedAt,
      updatedByAgentId: params.agentId,
    };
    const next: SharedDocMeta = { ...meta, sections, updatedAt };
    await writeJsonDurable(paths.metaPath, next);
    return next;
  });
}

/**
 * Replace entire body. Prefer section-scoped edits in higher layers; v1 uses whole-doc
 * write under lock + optional bodyLock holder check.
 */
export async function writeSharedDocBody(params: {
  groupWorkspaceRoot: string;
  logicalId: string;
  content: string;
  actorAgentId: string;
  requireSectionOwner?: string;
  now?: Date | string;
}): Promise<{ absolutePath: string; relativePath: string }> {
  const paths = sharedDocPaths(params.groupWorkspaceRoot, params.logicalId);
  return await withDocLock(paths.lockPath, async () => {
    const meta = await readMetaFile(paths.metaPath);
    if (!meta) {
      throw new Error(`shared-doc meta missing: ${paths.logicalId}`);
    }
    if (params.requireSectionOwner) {
      const section = meta.sections.find((s) => s.id === params.requireSectionOwner);
      if (!section) {
        throw new Error(`shared-doc section not found: ${params.requireSectionOwner}`);
      }
      if (section.ownerAgentId !== params.actorAgentId) {
        throw new Error(
          `shared-doc write denied: section ${section.id} owned by ${section.ownerAgentId}`,
        );
      }
    }
    if (
      meta.bodyLock?.holderAgentId &&
      meta.bodyLock.holderAgentId !== params.actorAgentId &&
      Date.parse(meta.bodyLock.expiresAt) > Date.now()
    ) {
      throw new Error(`shared-doc body locked by ${meta.bodyLock.holderAgentId}`);
    }
    const content = params.content.endsWith("\n") ? params.content : `${params.content}\n`;
    await writeTextDurable(paths.absolutePath, content);
    const updatedAt = nowIso(params.now);
    await writeJsonDurable(paths.metaPath, { ...meta, updatedAt });
    return { absolutePath: paths.absolutePath, relativePath: paths.relativePath };
  });
}

/**
 * Append a review comment to the sidecar (C2). Does not mutate body.
 */
export async function appendSharedDocReview(params: {
  groupWorkspaceRoot: string;
  logicalId: string;
  byAgentId: string;
  body: string;
  kind?: SharedDocReviewComment["kind"];
  sectionId?: string;
  resolvesCommentId?: string;
  now?: Date | string;
}): Promise<SharedDocReviewComment> {
  const paths = sharedDocPaths(params.groupWorkspaceRoot, params.logicalId);
  const comment: SharedDocReviewComment = {
    id: `rev_${randomUUID().slice(0, 12)}`,
    at: nowIso(params.now),
    byAgentId: params.byAgentId,
    kind: params.kind ?? "comment",
    body: params.body.trim(),
    ...(params.sectionId ? { sectionId: params.sectionId } : {}),
    ...(params.resolvesCommentId ? { resolvesCommentId: params.resolvesCommentId } : {}),
  };
  if (!comment.body) {
    throw new Error("shared-doc review body required");
  }
  return await withDocLock(paths.lockPath, async () => {
    await fsp.mkdir(path.dirname(paths.reviewsPath), { recursive: true });
    const handle = await fsp.open(paths.reviewsPath, "a", 0o600);
    try {
      await handle.appendFile(`${JSON.stringify(comment)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    const meta = await readMetaFile(paths.metaPath);
    if (meta && params.sectionId) {
      const idx = meta.sections.findIndex((s) => s.id === params.sectionId);
      if (idx >= 0) {
        const sections = [...meta.sections];
        const status =
          params.kind === "approve"
            ? "done"
            : params.kind === "request_changes"
              ? "in_progress"
              : "in_review";
        sections[idx] = {
          ...sections[idx],
          status:
            sections[idx].status === "done" && params.kind !== "approve"
              ? sections[idx].status
              : status,
          updatedAt: comment.at,
          updatedByAgentId: params.byAgentId,
        };
        if (params.kind === "comment" && sections[idx].status === "todo") {
          sections[idx] = { ...sections[idx], status: "in_review" };
        }
        await writeJsonDurable(paths.metaPath, {
          ...meta,
          sections,
          updatedAt: comment.at,
        });
      }
    }
    return comment;
  });
}

export async function listSharedDocReviews(params: {
  groupWorkspaceRoot: string;
  logicalId: string;
}): Promise<SharedDocReviewComment[]> {
  const paths = sharedDocPaths(params.groupWorkspaceRoot, params.logicalId);
  try {
    const raw = await fsp.readFile(paths.reviewsPath, "utf8");
    const out: SharedDocReviewComment[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) {
        continue;
      }
      try {
        out.push(JSON.parse(line) as SharedDocReviewComment);
      } catch {
        // skip bad line
      }
    }
    return out;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

/**
 * Mark section in_review and return a CollabEdge directive for request_review (C2).
 */
export function buildRequestReviewEdgeDirective(params: {
  toAgentIdOrName: string;
  reason: string;
  logicalId: string;
  sectionId?: string;
}): string {
  const reasonParts = [
    params.reason.trim() || "请评审共享文档",
    `doc=${slugifySharedDocId(params.logicalId)}`,
  ];
  if (params.sectionId) {
    reasonParts.push(`section=${params.sectionId}`);
  }
  const reason = reasonParts.join(";");
  return `[[collab_edge:request_review|to=${params.toAgentIdOrName}|reason=${reason}]]`;
}

/**
 * Board helper: single deliverablePaths entry all members share.
 */
export function boardDeliverablePathForSharedDoc(logicalId: string): string {
  return sharedDocRelativePath(logicalId);
}

export function formatSharedDocCardForPrompt(params: {
  meta: SharedDocMeta;
  reviewCount?: number;
  viewerAgentId?: string;
}): string {
  const lines = [
    "[共享文档]",
    `路径：${params.meta.relativePath}`,
    `标题：${params.meta.title}`,
    `章节数：${params.meta.sections.length}`,
  ];
  if (typeof params.reviewCount === "number") {
    lines.push(`评审意见：${params.reviewCount}`);
  }
  for (const section of params.meta.sections.slice(0, 12)) {
    const mine =
      params.viewerAgentId && section.ownerAgentId === params.viewerAgentId ? "（我的）" : "";
    lines.push(
      `- ${section.id}${mine}: ${section.title} · ${section.ownerAgentId ?? "未认领"} · ${section.status}`,
    );
  }
  lines.push("规则：所有成员读写同一相对路径；评审写入 .reviews.jsonl，禁止各写各的副本。");
  return lines.join("\n");
}

/** List meta sidecars under deliverables/ (active shared docs). */
export async function listSharedDocMetasInWorkspace(
  groupWorkspaceRoot: string,
): Promise<SharedDocMeta[]> {
  const dir = path.join(groupWorkspaceRoot, "deliverables");
  let names: string[] = [];
  try {
    names = await fsp.readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const metas: SharedDocMeta[] = [];
  for (const name of names) {
    if (!name.endsWith(".meta.json")) {
      continue;
    }
    const meta = await readMetaFile(path.join(dir, name));
    if (meta) {
      metas.push(meta);
    }
  }
  return metas;
}

/**
 * Prompt appendix when the group has one or more shared docs.
 * Safe to call from discussion-turn-prompt (returns null on missing dir / errors).
 */
export async function tryBuildSharedDocPromptAppendix(params: {
  groupWorkspaceRoot: string;
  viewerAgentId: string;
  maxDocs?: number;
}): Promise<string | null> {
  try {
    const metas = await listSharedDocMetasInWorkspace(params.groupWorkspaceRoot);
    if (metas.length === 0) {
      return null;
    }
    const limit = Math.max(1, params.maxDocs ?? 3);
    const cards: string[] = [];
    for (const meta of metas.slice(0, limit)) {
      const reviews = await listSharedDocReviews({
        groupWorkspaceRoot: params.groupWorkspaceRoot,
        logicalId: meta.logicalId,
      });
      cards.push(
        formatSharedDocCardForPrompt({
          meta,
          viewerAgentId: params.viewerAgentId,
          reviewCount: reviews.length,
        }),
      );
    }
    cards.push(
      "共享文档读写请走同一 relativePath；可用 gateway 方法 group.sharedDoc.open / claimSection / writeBody / appendReview（勿另存各 bot 副本）。",
    );
    return cards.join("\n\n");
  } catch {
    return null;
  }
}

/** Sync variant for discussion-turn-prompt (must stay sync). */
export function tryBuildSharedDocPromptAppendixSync(params: {
  groupWorkspaceRoot: string;
  viewerAgentId: string;
  maxDocs?: number;
}): string | null {
  try {
    const dir = path.join(params.groupWorkspaceRoot, "deliverables");
    let names: string[] = [];
    try {
      names = fs.readdirSync(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
    const metas: SharedDocMeta[] = [];
    for (const name of names) {
      if (!name.endsWith(".meta.json")) {
        continue;
      }
      const meta = readMetaFileSync(path.join(dir, name));
      if (meta) {
        metas.push(meta);
      }
    }
    if (metas.length === 0) {
      return null;
    }
    const limit = Math.max(1, params.maxDocs ?? 3);
    const cards: string[] = [];
    for (const meta of metas.slice(0, limit)) {
      let reviewCount = 0;
      try {
        const raw = fs.readFileSync(
          path.join(params.groupWorkspaceRoot, "deliverables", `${meta.logicalId}.reviews.jsonl`),
          "utf8",
        );
        reviewCount = raw.split("\n").filter((line) => line.trim()).length;
      } catch {
        reviewCount = 0;
      }
      cards.push(
        formatSharedDocCardForPrompt({
          meta,
          viewerAgentId: params.viewerAgentId,
          reviewCount,
        }),
      );
    }
    cards.push(
      "共享文档读写请走同一 relativePath；可用 gateway 方法 group.sharedDoc.open / claimSection / writeBody / appendReview（勿另存各 bot 副本）。",
    );
    return cards.join("\n\n");
  } catch {
    return null;
  }
}
