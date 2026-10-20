import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "../../utils.js";
import { assertSafeTenantId, resolveTenantsRoot } from "../tenant-store-paths.js";
import {
  resolveReservedDeliverableFolderKind,
  type ReservedDeliverableFolderKind,
} from "./deliverable-folders.js";
import type { KnowledgeBase } from "./knowledge-base-store.js";

/**
 * Tenant cloud knowledge directory SoT (Mode B).
 *
 * L1 enterprise knowledge: `tenants/<tid>/shared/knowledge/`
 * L2 employee knowledge:   `tenants/<tid>/users/<uid>/OpenBot/shared/knowledge/`
 * Local fallback:          `<configDir>/knowledge/` (legacy index/ + originals/)
 *
 * SQLite index stays one-db-per-tenant (or per personal owner) under `.index/`
 * (local: `knowledge/index/` for zero-change). Originals live beside the index.
 * Reserved 个人成果 / 团队成果 files are also copied into `folders/`.
 */

export const KNOWLEDGE_SHARED_DIR = "shared/knowledge";
export const KNOWLEDGE_INDEX_DIRNAME = ".index";
export const KNOWLEDGE_LEGACY_INDEX_DIRNAME = "index";
export const KNOWLEDGE_ORIGINALS_DIRNAME = "originals";
export const KNOWLEDGE_FOLDERS_DIRNAME = "folders";
export const PERSONAL_DELIVERABLES_FOLDER = "personal-deliverables";
export const TEAM_DELIVERABLES_FOLDER = "team-deliverables";

export type KnowledgeDirectoryScope = "tenant" | "user" | "local";

export type KnowledgeDirectoryLayout = {
  knowledgeRoot: string;
  indexRoot: string;
  originalsRoot: string;
  foldersRoot: string;
  deliverableFolderRoot: string;
  scope: KnowledgeDirectoryScope;
};

function sanitizeUserSegment(userId: string): string {
  const trimmed = userId.trim();
  if (
    !trimmed ||
    trimmed === "." ||
    trimmed === ".." ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed.includes("\u0000")
  ) {
    return "unknown";
  }
  return trimmed;
}

function tryTenantLiveRoot(tenantId: string, tenantsRoot: string): string | null {
  const trimmed = tenantId.trim();
  if (!trimmed) {
    return null;
  }
  try {
    assertSafeTenantId(trimmed);
    return path.join(tenantsRoot, trimmed);
  } catch {
    return null;
  }
}

function localKnowledgeRoot(configDir: string): string {
  return path.join(configDir, "knowledge");
}

function tenantKnowledgeRoot(tenantLiveRoot: string): string {
  return path.join(tenantLiveRoot, KNOWLEDGE_SHARED_DIR);
}

function userKnowledgeRoot(tenantLiveRoot: string, ownerId: string): string {
  return path.join(
    tenantLiveRoot,
    "users",
    sanitizeUserSegment(ownerId),
    "OpenBot",
    KNOWLEDGE_SHARED_DIR,
  );
}

function folderNameForReservedKind(kind: ReservedDeliverableFolderKind | null): string {
  if (kind === "team_deliverables") {
    return TEAM_DELIVERABLES_FOLDER;
  }
  return PERSONAL_DELIVERABLES_FOLDER;
}

export function resolveKnowledgeDirectoryLayout(params: {
  ownerId: string;
  tenantId?: string | null;
  visibility?: KnowledgeBase["visibility"] | null;
  reservedKind?: ReservedDeliverableFolderKind | null;
  tenantsRoot?: string;
  configDir?: string;
}): KnowledgeDirectoryLayout {
  const ownerId = params.ownerId.trim();
  const tenantId = params.tenantId?.trim() || "";
  const configDir = params.configDir ?? CONFIG_DIR;
  const tenantsRoot = params.tenantsRoot ?? resolveTenantsRoot();
  const tenantLive = tenantId ? tryTenantLiveRoot(tenantId, tenantsRoot) : null;
  const reservedKind = params.reservedKind ?? null;
  const folderName = folderNameForReservedKind(reservedKind);
  const isEnterprise = params.visibility === "enterprise";

  if (tenantLive && isEnterprise) {
    const knowledgeRoot = tenantKnowledgeRoot(tenantLive);
    return {
      knowledgeRoot,
      indexRoot: path.join(knowledgeRoot, KNOWLEDGE_INDEX_DIRNAME),
      originalsRoot: path.join(knowledgeRoot, KNOWLEDGE_ORIGINALS_DIRNAME),
      foldersRoot: path.join(knowledgeRoot, KNOWLEDGE_FOLDERS_DIRNAME),
      deliverableFolderRoot: path.join(knowledgeRoot, KNOWLEDGE_FOLDERS_DIRNAME, folderName),
      scope: "tenant",
    };
  }

  if (tenantLive && ownerId) {
    const knowledgeRoot = userKnowledgeRoot(tenantLive, ownerId);
    const tenantKnowledge = tenantKnowledgeRoot(tenantLive);
    return {
      knowledgeRoot,
      indexRoot: path.join(tenantKnowledge, KNOWLEDGE_INDEX_DIRNAME),
      originalsRoot: path.join(tenantKnowledge, KNOWLEDGE_ORIGINALS_DIRNAME),
      foldersRoot: path.join(knowledgeRoot, KNOWLEDGE_FOLDERS_DIRNAME),
      deliverableFolderRoot: path.join(knowledgeRoot, KNOWLEDGE_FOLDERS_DIRNAME, folderName),
      scope: "user",
    };
  }

  const knowledgeRoot = localKnowledgeRoot(configDir);
  return {
    knowledgeRoot,
    indexRoot: path.join(knowledgeRoot, KNOWLEDGE_LEGACY_INDEX_DIRNAME),
    originalsRoot: path.join(knowledgeRoot, KNOWLEDGE_ORIGINALS_DIRNAME),
    foldersRoot: path.join(knowledgeRoot, KNOWLEDGE_FOLDERS_DIRNAME),
    deliverableFolderRoot: path.join(knowledgeRoot, KNOWLEDGE_FOLDERS_DIRNAME, folderName),
    scope: "local",
  };
}

export function resolveKnowledgeDirectoryLayoutForBase(
  knowledgeBase: Pick<KnowledgeBase, "ownerId" | "tenantId" | "visibility" | "tags" | "title">,
  overrides?: { tenantsRoot?: string; configDir?: string },
): KnowledgeDirectoryLayout {
  return resolveKnowledgeDirectoryLayout({
    ownerId: knowledgeBase.ownerId,
    tenantId: knowledgeBase.tenantId,
    visibility: knowledgeBase.visibility,
    reservedKind: resolveReservedDeliverableFolderKind(knowledgeBase),
    ...overrides,
  });
}

/**
 * Single index-root locator for list / ingest / preview / delete.
 * Prefer an explicit override (tests); otherwise use the KB directory layout
 * so tenant-scoped bases hit tenants/.../shared/knowledge/.index — not CONFIG_DIR.
 */
export function resolveKnowledgeIndexRootForBase(
  knowledgeBase: Pick<KnowledgeBase, "ownerId" | "tenantId" | "visibility" | "tags" | "title">,
  overrides?: { tenantsRoot?: string; configDir?: string; indexRoot?: string },
): string {
  const explicit = overrides?.indexRoot?.trim();
  if (explicit) {
    return explicit;
  }
  return resolveKnowledgeDirectoryLayoutForBase(knowledgeBase, {
    tenantsRoot: overrides?.tenantsRoot,
    configDir: overrides?.configDir,
  }).indexRoot;
}

export function ensureKnowledgeDirectoryLayout(layout: KnowledgeDirectoryLayout): void {
  fs.mkdirSync(layout.indexRoot, { recursive: true });
  fs.mkdirSync(layout.originalsRoot, { recursive: true });
  fs.mkdirSync(layout.deliverableFolderRoot, { recursive: true });
}

function collectSqliteFiles(indexRoot: string, out: string[]): void {
  if (!fs.existsSync(indexRoot)) {
    return;
  }
  for (const scope of ["personal", "tenant"] as const) {
    const dir = path.join(indexRoot, scope);
    if (!fs.existsSync(dir)) {
      continue;
    }
    for (const entry of fs.readdirSync(dir)) {
      if (entry.endsWith(".db")) {
        out.push(path.join(dir, entry));
      }
    }
  }
}

function discoverTenantKnowledgeIndexRoots(tenantsRoot: string): string[] {
  if (!fs.existsSync(tenantsRoot)) {
    return [];
  }
  const roots: string[] = [];
  let tenantIds: string[] = [];
  try {
    tenantIds = fs
      .readdirSync(tenantsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
  for (const tenantId of tenantIds) {
    const live = tryTenantLiveRoot(tenantId, tenantsRoot);
    if (!live) {
      continue;
    }
    roots.push(path.join(tenantKnowledgeRoot(live), KNOWLEDGE_INDEX_DIRNAME));
  }
  return roots;
}

/** Index sqlite files for maintenance ticks. Tests pass `indexRoot` to stay isolated. */
export function listKnowledgeIndexDbPaths(params?: {
  indexRoot?: string;
  tenantsRoot?: string;
  configDir?: string;
}): string[] {
  const out: string[] = [];
  if (params?.indexRoot) {
    collectSqliteFiles(params.indexRoot, out);
    return out;
  }
  const configDir = params?.configDir ?? CONFIG_DIR;
  collectSqliteFiles(path.join(localKnowledgeRoot(configDir), KNOWLEDGE_LEGACY_INDEX_DIRNAME), out);
  collectSqliteFiles(path.join(localKnowledgeRoot(configDir), KNOWLEDGE_INDEX_DIRNAME), out);
  const tenantsRoot = params?.tenantsRoot ?? resolveTenantsRoot();
  for (const root of discoverTenantKnowledgeIndexRoots(tenantsRoot)) {
    collectSqliteFiles(root, out);
  }
  return [...new Set(out)];
}

export function resolveKnowledgeFolderFilePath(params: {
  layout: KnowledgeDirectoryLayout;
  filename: string;
}): string {
  const base = path.basename(params.filename.replace(/\\/g, "/")).trim() || "document.md";
  return path.join(params.layout.deliverableFolderRoot, base);
}

export function writeKnowledgeFolderFile(params: {
  layout: KnowledgeDirectoryLayout;
  filename: string;
  buffer: Buffer;
}): string {
  ensureKnowledgeDirectoryLayout(params.layout);
  const dest = resolveKnowledgeFolderFilePath({
    layout: params.layout,
    filename: params.filename,
  });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, params.buffer);
  return dest;
}

export function deleteKnowledgeFolderFile(params: {
  layout: KnowledgeDirectoryLayout;
  filename: string;
}): boolean {
  const dest = resolveKnowledgeFolderFilePath({
    layout: params.layout,
    filename: params.filename,
  });
  if (!fs.existsSync(dest) || !fs.statSync(dest).isFile()) {
    return false;
  }
  fs.unlinkSync(dest);
  return true;
}

/** Read a reserved-folder original written by save-and-archive. */
export function readKnowledgeFolderFile(params: {
  layout: KnowledgeDirectoryLayout;
  filename: string;
}): { filename: string; absolutePath: string; buffer: Buffer } | null {
  const dest = resolveKnowledgeFolderFilePath({
    layout: params.layout,
    filename: params.filename,
  });
  if (!fs.existsSync(dest) || !fs.statSync(dest).isFile()) {
    return null;
  }
  return {
    filename: path.basename(dest),
    absolutePath: dest,
    buffer: fs.readFileSync(dest),
  };
}

export function listKnowledgeFolderFiles(params: {
  layout: KnowledgeDirectoryLayout;
}): Array<{ filename: string; absolutePath: string; updatedAtMs: number }> {
  const root = params.layout.deliverableFolderRoot;
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    return [];
  }
  const out: Array<{ filename: string; absolutePath: string; updatedAtMs: number }> = [];
  for (const name of fs.readdirSync(root)) {
    if (name.startsWith(".")) {
      continue;
    }
    const absolutePath = path.join(root, name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(absolutePath);
    } catch {
      continue;
    }
    if (!stat.isFile()) {
      continue;
    }
    out.push({
      filename: name,
      absolutePath,
      updatedAtMs: Math.trunc(stat.mtimeMs),
    });
  }
  return out;
}
