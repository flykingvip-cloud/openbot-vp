/**
 * Read-only projection of productization's verified artifact ledger into
 * signed App preinstall package ids.
 * PRODUCTIZATION_ARTIFACTS stays the digest source of truth. This adapter
 * does not copy digest strings and never writes the ledger.
 */

import { PRODUCTIZATION_ARTIFACTS, shortDigest } from "../productization/fixtures.ts";

export type SignedAppPreinstallPackage = {
  id: string;
  versionNarrative: string;
  signed: true;
  signature: "verified";
  /** Read-only pointer. Association must not write this digest back. */
  artifactDigest: string;
  channelTag: string;
};

/** Present only so association can refuse it. Not part of the signed catalog. */
export const UNSIGNED_APP_PREINSTALL_ID = "app-pre-unsigned-draft";

const APP_PREINSTALL_SOURCES = [
  {
    id: "app-pre-202610-a",
    versionNarrative: "2026.10.1",
    trainSeq: "112",
    channelTag: "渠道白牌",
  },
  {
    id: "app-pre-202610-b",
    versionNarrative: "2026.10.2",
    trainSeq: "109",
    channelTag: "渠道白牌",
  },
] as const;

export function listSignedAppPreinstallPackages(): readonly SignedAppPreinstallPackage[] {
  const listed: SignedAppPreinstallPackage[] = [];
  for (const source of APP_PREINSTALL_SOURCES) {
    const artifact = PRODUCTIZATION_ARTIFACTS.find((item) => item.trainSeq === source.trainSeq);
    if (!artifact || artifact.signature !== "verified") {
      continue;
    }
    listed.push(
      Object.freeze({
        id: source.id,
        versionNarrative: source.versionNarrative,
        signed: true as const,
        signature: "verified" as const,
        artifactDigest: artifact.digest,
        channelTag: source.channelTag,
      }),
    );
  }
  return Object.freeze(listed);
}

export function findSignedAppPreinstallPackage(
  packageId: string,
): SignedAppPreinstallPackage | null {
  const trimmed = packageId.trim();
  if (!trimmed || trimmed === UNSIGNED_APP_PREINSTALL_ID) {
    return null;
  }
  return listSignedAppPreinstallPackages().find((item) => item.id === trimmed) ?? null;
}

export function signedAppPackageReference(packageId: string): {
  id: string;
  versionNarrative: string;
  channelTag: string;
  digestPreview: string;
} | null {
  const item = findSignedAppPreinstallPackage(packageId);
  if (!item) {
    return null;
  }
  return {
    id: item.id,
    versionNarrative: item.versionNarrative,
    channelTag: item.channelTag,
    digestPreview: shortDigest(item.artifactDigest),
  };
}
