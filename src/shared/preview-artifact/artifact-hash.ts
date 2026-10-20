import { canonicalizePreviewText } from "./canonicalize.js";
import { sha256HexUtf8 } from "./sha256-hex.js";

/** Legacy djb2 hash used before P0-2; kept for assistant-doc id backward compatibility. */
export function legacyHashPreviewText(text: string): string {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 33) ^ text.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

/** @deprecated Use hashArtifactBody — kept as alias for transitional imports. */
export const hashPreviewText = legacyHashPreviewText;

/** SHA-256 (first 16 hex chars) over canonicalized deliverable body. */
export function hashArtifactBody(body: string): string {
  const canonical = canonicalizePreviewText(body);
  return sha256HexUtf8(canonical).slice(0, 16);
}

export function buildArtifactIdFromBody(body: string): string {
  return `assistant-doc:${hashArtifactBody(body)}`;
}

export function buildLegacyArtifactId(title: string, sourceMessage: string): string {
  return `assistant-doc:${legacyHashPreviewText(`${title}\n${sourceMessage}`)}`;
}

export function extractArtifactHash(artifactId: string): string | null {
  const trimmed = artifactId.trim();
  if (!trimmed.startsWith("assistant-doc:")) {
    return null;
  }
  const hash = trimmed.slice("assistant-doc:".length).trim();
  return hash || null;
}

export function artifactHashMatches(
  requestedHash: string,
  params: {
    body: string;
    legacyTitle?: string;
    legacySourceMessage?: string;
    legacyArtifactId?: string;
  },
): boolean {
  if (!requestedHash.trim()) {
    return false;
  }
  if (hashArtifactBody(params.body) === requestedHash) {
    return true;
  }
  if (params.legacyArtifactId) {
    const legacyHash = extractArtifactHash(params.legacyArtifactId);
    if (legacyHash && legacyHash === requestedHash) {
      return true;
    }
  }
  if (params.legacyTitle !== undefined && params.legacySourceMessage !== undefined) {
    return (
      legacyHashPreviewText(`${params.legacyTitle}\n${params.legacySourceMessage}`) ===
      requestedHash
    );
  }
  return false;
}

export function buildArtifactIds(params: {
  body: string;
  legacyTitle: string;
  legacySourceMessage: string;
}): {
  artifactId: string;
  legacyArtifactId: string;
  artifactHash: string;
  legacyArtifactHash: string;
} {
  const artifactHash = hashArtifactBody(params.body);
  const legacyArtifactHash = legacyHashPreviewText(
    `${params.legacyTitle}\n${params.legacySourceMessage}`,
  );
  return {
    artifactId: `assistant-doc:${artifactHash}`,
    legacyArtifactId: `assistant-doc:${legacyArtifactHash}`,
    artifactHash,
    legacyArtifactHash,
  };
}
