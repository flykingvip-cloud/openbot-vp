import crypto from "node:crypto";
import path from "node:path";
import { readJsonFileWithFallback, writeJsonFileAtomically } from "../plugin-sdk/json-store.js";
import { resolveConfigDir } from "../utils.js";

export type AttachmentAssetVersion = {
  assetId: string;
  versionId: string;
  fileName: string;
  mimeType: string;
  contentHash: string;
  sizeBytes: number;
  lastModified: number;
  content: string;
  createdAt: number;
  updatedAt: number;
};

type AttachmentAssetIndex = {
  assets: AttachmentAssetVersion[];
};

export type AttachmentAssetUpsertInput = {
  fileName: string;
  mimeType?: string;
  content: string;
  sizeBytes?: number;
  lastModified?: number;
};

export type AttachmentAssetResolveInput = {
  fileName: string;
  contentHash?: string;
  sizeBytes?: number;
  lastModified?: number;
  allowLatestFallback?: boolean;
};

function resolveAttachmentAssetStorePath() {
  return path.join(resolveConfigDir(), "attachment-assets", "index.json");
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function sanitizeIdPart(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "attachment"
  );
}

function normalizeBase64Content(content: string): string {
  const trimmed = content.trim();
  const match = /^data:[^;]+;base64,([\s\S]+)$/.exec(trimmed);
  return (match?.[1] ?? trimmed).trim();
}

function estimateBase64Bytes(base64: string): number {
  const cleaned = base64.replace(/\s+/g, "");
  const padding = cleaned.endsWith("==") ? 2 : cleaned.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((cleaned.length * 3) / 4) - padding);
}

function hashBase64(base64: string): string {
  return crypto.createHash("sha256").update(base64).digest("hex");
}

async function readIndex(): Promise<AttachmentAssetIndex> {
  const { value } = await readJsonFileWithFallback<AttachmentAssetIndex>(
    resolveAttachmentAssetStorePath(),
    { assets: [] },
  );
  return { assets: Array.isArray(value.assets) ? value.assets : [] };
}

async function writeIndex(index: AttachmentAssetIndex): Promise<void> {
  await writeJsonFileAtomically(resolveAttachmentAssetStorePath(), index);
}

function pickMatchingVersion(
  versions: AttachmentAssetVersion[],
  input: AttachmentAssetResolveInput,
): AttachmentAssetVersion | null {
  const normalizedHash = input.contentHash?.trim();
  if (normalizedHash) {
    const byHash = versions.find((version) => version.contentHash === normalizedHash);
    if (byHash) {
      return byHash;
    }
  }
  if (input.sizeBytes != null) {
    const byFileIdentity = versions.find(
      (version) =>
        version.sizeBytes === input.sizeBytes &&
        (input.lastModified == null ||
          version.lastModified === input.lastModified ||
          version.lastModified === 0),
    );
    if (byFileIdentity) {
      return byFileIdentity;
    }
  }
  return input.allowLatestFallback ? (versions.at(-1) ?? null) : null;
}

export async function upsertAttachmentAsset(
  input: AttachmentAssetUpsertInput,
): Promise<{ status: "created" | "existing" | "new-version"; version: AttachmentAssetVersion }> {
  const fileName = input.fileName.trim();
  if (!fileName) {
    throw new Error("fileName is required");
  }
  const content = normalizeBase64Content(input.content);
  if (!content || content.length % 4 !== 0) {
    throw new Error("content must be valid base64");
  }
  // Iterative alphabet check — avoid regex on multi‑MB ebook payloads.
  for (let i = 0; i < content.length; i += 1) {
    const code = content.charCodeAt(i);
    const ok =
      (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      code === 43 ||
      code === 47 ||
      code === 61;
    if (!ok) {
      throw new Error("content must be valid base64");
    }
  }
  const index = await readIndex();
  const normalizedName = normalizeName(fileName);
  const versions = index.assets.filter((asset) => normalizeName(asset.fileName) === normalizedName);
  const contentHash = hashBase64(content);
  const existing = versions.find((version) => version.contentHash === contentHash);
  if (existing) {
    return { status: "existing", version: existing };
  }
  const now = Date.now();
  const assetId =
    versions[0]?.assetId ?? `asset-${sanitizeIdPart(fileName)}-${contentHash.slice(0, 12)}`;
  const version: AttachmentAssetVersion = {
    assetId,
    versionId: `v${versions.length + 1}`,
    fileName,
    mimeType: input.mimeType?.trim() || "application/octet-stream",
    contentHash,
    sizeBytes: input.sizeBytes ?? estimateBase64Bytes(content),
    lastModified: input.lastModified ?? 0,
    content,
    createdAt: now,
    updatedAt: now,
  };
  index.assets.push(version);
  await writeIndex(index);
  return { status: versions.length > 0 ? "new-version" : "created", version };
}

export async function resolveAttachmentAsset(
  input: AttachmentAssetResolveInput,
): Promise<AttachmentAssetVersion | null> {
  const fileName = input.fileName.trim();
  if (!fileName) {
    return null;
  }
  const index = await readIndex();
  const normalizedName = normalizeName(fileName);
  const versions = index.assets.filter((asset) => normalizeName(asset.fileName) === normalizedName);
  return pickMatchingVersion(versions, input);
}
