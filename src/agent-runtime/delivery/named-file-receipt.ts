/**
 * Personal named-file delivery receipt.
 *
 * A claim of “已生成／可下载” is a host fact only when a real workspace file
 * is on disk, registered, and authorized for preview and download. Model
 * prose is never a receipt. This module does not start execution from prose.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const NAMED_FILE_ACCEPTANCE_PREFIX = "交付文件 ";

export type AccessibleNamedFileReceipt = {
  accessible: true;
  relativePath: string;
  absolutePath: string;
  sha256: string;
  byteLength: number;
  mimeType: string;
};

export type MissingNamedFileReceipt = {
  accessible: false;
  relativePath: string;
  reason: "missing" | "empty" | "unreadable" | "outside_workspace" | "invalid_path";
};

export type NamedFileReceipt = AccessibleNamedFileReceipt | MissingNamedFileReceipt;

const TEXT_MIME_BY_EXT: Record<string, string> = {
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".json": "application/json",
  ".html": "text/html",
  ".htm": "text/html",
};

function normalizeRelative(filePath: string): string | null {
  const trimmed = filePath.trim().replaceAll("\\", "/");
  if (!trimmed || trimmed.includes("..") || path.isAbsolute(trimmed)) {
    return null;
  }
  return trimmed.replace(/^\.\//u, "");
}

function resolveInsideWorkspace(workspaceDir: string, relativePath: string): string | null {
  const root = path.resolve(workspaceDir);
  const absolute = path.resolve(root, relativePath);
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
    return null;
  }
  return absolute;
}

function mimeFromFilename(relativePath: string): string {
  const ext = path.extname(relativePath).toLowerCase();
  return TEXT_MIME_BY_EXT[ext] ?? "application/octet-stream";
}

/** Parse `交付文件 name.md` acceptance criteria into workspace-relative names. */
export function namedFilesFromAcceptance(acceptance: readonly string[] | undefined): string[] {
  const names: string[] = [];
  for (const item of acceptance ?? []) {
    const text = item.trim();
    if (!text.startsWith(NAMED_FILE_ACCEPTANCE_PREFIX)) {
      continue;
    }
    const relative = normalizeRelative(text.slice(NAMED_FILE_ACCEPTANCE_PREFIX.length));
    if (relative && !names.includes(relative)) {
      names.push(relative);
    }
  }
  return names;
}

/** Register one workspace file. Missing or empty bytes cannot become a receipt. */
export function registerNamedFileReceipt(params: {
  workspaceDir: string;
  relativePath: string;
}): NamedFileReceipt {
  const relativePath = normalizeRelative(params.relativePath);
  if (!relativePath) {
    return { accessible: false, relativePath: params.relativePath.trim(), reason: "invalid_path" };
  }
  const root = params.workspaceDir.trim();
  if (!root) {
    return { accessible: false, relativePath, reason: "outside_workspace" };
  }
  const absolutePath = resolveInsideWorkspace(root, relativePath);
  if (!absolutePath) {
    return { accessible: false, relativePath, reason: "outside_workspace" };
  }
  try {
    const stat = fs.statSync(absolutePath);
    if (!stat.isFile()) {
      return { accessible: false, relativePath, reason: "missing" };
    }
    if (stat.size <= 0) {
      return { accessible: false, relativePath, reason: "empty" };
    }
    const bytes = fs.readFileSync(absolutePath);
    if (bytes.length <= 0) {
      return { accessible: false, relativePath, reason: "empty" };
    }
    return {
      accessible: true,
      relativePath,
      absolutePath,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      byteLength: bytes.length,
      mimeType: mimeFromFilename(relativePath),
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { accessible: false, relativePath, reason: "missing" };
    }
    return { accessible: false, relativePath, reason: "unreadable" };
  }
}

/** Only an accessible receipt may claim generation or download. */
export function canClaimNamedFileDelivery(receipt: NamedFileReceipt | null | undefined): boolean {
  return receipt?.accessible === true;
}

/**
 * Structured preview artifact for 成果. Preview filename, checksum, and
 * download authorization all come from the same receipt.
 */
export function previewArtifactFromNamedFileReceipt(
  receipt: AccessibleNamedFileReceipt,
  opts?: { timestamp?: number; title?: string },
): Record<string, unknown> {
  const createdAt = new Date(opts?.timestamp ?? Date.now()).toISOString();
  const title = opts?.title?.trim() || path.basename(receipt.relativePath);
  const downloadAuthorization = {
    kind: "workspace_file" as const,
    relativePath: receipt.relativePath,
    sha256: receipt.sha256,
    byteLength: receipt.byteLength,
  };
  return {
    kind: "file",
    title,
    mimeType: receipt.mimeType,
    createdAt,
    providerMetadata: {
      declared: true,
      deliverableEnvelope: true,
      settleConfirmed: true,
      previewKind: "file",
      workspaceFilename: receipt.relativePath,
      artifactSha256: receipt.sha256,
      byteLength: receipt.byteLength,
      downloadAuthorization,
    },
  };
}

export function namedFileReceiptsToArtifactFields(
  receipts: readonly NamedFileReceipt[],
  opts?: { timestamp?: number },
): { artifact?: Record<string, unknown>; artifacts?: Record<string, unknown>[] } {
  const artifacts = receipts
    .filter((item): item is AccessibleNamedFileReceipt => item.accessible)
    .map((item) => previewArtifactFromNamedFileReceipt(item, opts));
  if (artifacts.length === 0) {
    return {};
  }
  return {
    artifact: artifacts[0],
    ...(artifacts.length > 1 ? { artifacts } : {}),
  };
}

/** Candidates: explicit names first, then noted write paths that stay inside the workspace. */
export function collectNamedFileReceipts(params: {
  workspaceDir: string;
  relativePaths?: readonly string[];
}): NamedFileReceipt[] {
  const seen = new Set<string>();
  const receipts: NamedFileReceipt[] = [];
  for (const relativePath of params.relativePaths ?? []) {
    const normalized = normalizeRelative(relativePath);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    receipts.push(
      registerNamedFileReceipt({ workspaceDir: params.workspaceDir, relativePath: normalized }),
    );
  }
  return receipts;
}

const TURN_FILENAME_RE =
  /(?:文件名(?:为|是|叫)?|filename|file\s*name|named|保存为|save(?:d)?\s+as|交付文件)\s*[:：为是]?\s*[`'"“”‘’]*([A-Za-z0-9][\w.-]{0,120}\.[A-Za-z0-9]{1,8})/giu;

const BARE_DELIVERABLE_RE =
  /\b([A-Za-z0-9][\w.-]{0,120}\.(?:md|markdown|csv|html|htm|txt|json))\b/giu;

/** Filenames explicitly requested or accepted in this turn — not inferred from a delivery claim alone. */
export function candidateNamedFilesFromTurn(texts: readonly (string | undefined)[]): string[] {
  const names: string[] = [];
  for (const text of texts) {
    if (!text) {
      continue;
    }
    TURN_FILENAME_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = TURN_FILENAME_RE.exec(text))) {
      const relative = match[1]?.trim();
      if (
        relative &&
        !relative.includes("..") &&
        !relative.includes("/") &&
        !names.includes(relative)
      ) {
        names.push(relative);
      }
    }
  }
  {
    // Explicit naming does not exclude additional requested file formats.
    for (const text of texts) {
      if (!text) {
        continue;
      }
      BARE_DELIVERABLE_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = BARE_DELIVERABLE_RE.exec(text))) {
        const relative = match[1]?.trim();
        if (relative && !relative.includes("..") && !names.includes(relative)) {
          names.push(relative);
        }
      }
    }
  }
  return names;
}

export function mergeNamedFileReceiptArtifacts(
  declared: { artifact?: Record<string, unknown>; artifacts?: Record<string, unknown>[] },
  receipts: { artifact?: Record<string, unknown>; artifacts?: Record<string, unknown>[] },
): { artifact?: Record<string, unknown>; artifacts?: Record<string, unknown>[] } {
  if (!receipts.artifact) {
    return declared;
  }
  const declaredList = [...(declared.artifacts ?? (declared.artifact ? [declared.artifact] : []))];
  const receiptList = [...(receipts.artifacts ?? (receipts.artifact ? [receipts.artifact] : []))];
  const receiptNames = new Set(
    receiptList
      .map((item) => {
        const meta = item.providerMetadata as Record<string, unknown> | undefined;
        return typeof meta?.workspaceFilename === "string" ? meta.workspaceFilename : "";
      })
      .filter(Boolean),
  );
  const extras = declaredList.filter((item) => {
    const meta = item.providerMetadata as Record<string, unknown> | undefined;
    const name = typeof meta?.workspaceFilename === "string" ? meta.workspaceFilename : "";
    return !name || !receiptNames.has(name);
  });
  const artifacts = [...receiptList, ...extras];
  return {
    artifact: artifacts[0],
    ...(artifacts.length > 1 ? { artifacts } : {}),
  };
}
