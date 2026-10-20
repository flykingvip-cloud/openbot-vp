/**
 * Build an artifact workspace sidebar payload from a deliverable found in chat messages.
 * Extracted from the control-ui shell (app.ts) — pure helpers, no host state.
 */

import { resolveCronResultArtifactRecord } from "../chat/cron-result-message.ts";
import {
  isDeliverableResultArtifact,
  resolvePreviewArtifactRecords,
} from "../chat/generated-preview-artifact.ts";
import type {
  ArtifactLifecycle,
  ArtifactStorageClass,
  ArtifactType,
  ArtifactWorkspaceSidebar,
  SharedArtifact,
} from "../types.ts";

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringRecord(value: unknown): Record<string, unknown> | undefined {
  const record = toRecord(value);
  return record ?? undefined;
}

function hasArrayField(record: Record<string, unknown> | undefined, key: string): boolean {
  return Array.isArray(record?.[key]);
}

function looksLikePresentationArtifact(record: Record<string, unknown>): boolean {
  // Require real slide preview images; filename/mime must not force artifactType=slide.
  const metadata = stringRecord(record.providerMetadata);
  return (
    hasArrayField(metadata, "slidePreviews") ||
    hasArrayField(metadata, "slides") ||
    hasArrayField(metadata, "slideImages") ||
    hasArrayField(metadata, "pptPreviewImages")
  );
}

function normalizeArtifactType(value: unknown, record?: Record<string, unknown>): ArtifactType {
  const candidate = stringField(value);
  switch (candidate) {
    case "binary":
    case "doc":
    case "sheet":
    case "slide":
    case "image":
    case "archive":
    case "dataset":
    case "report":
      return candidate;
    default:
      if (record && looksLikePresentationArtifact(record)) {
        return "slide";
      }
      return "doc";
  }
}

function normalizeArtifactStorageClass(value: unknown): ArtifactStorageClass {
  const candidate = stringField(value);
  switch (candidate) {
    case "object-store":
    case "collaborative-doc":
    case "external-link":
    case "inline-media":
      return candidate;
    default:
      return "external-link";
  }
}

function normalizeArtifactLifecycle(value: unknown): ArtifactLifecycle {
  const candidate = stringField(value);
  switch (candidate) {
    case "created":
    case "stored":
    case "shared":
    case "delivered":
    case "versioned":
    case "revoked":
    case "expired":
    case "archived":
      return candidate;
    default:
      return "shared";
  }
}

function findArtifactCandidate(
  messages: unknown[],
  artifactId: string,
): Record<string, unknown> | null {
  for (const message of messages) {
    const cronArtifact = resolveCronResultArtifactRecord(message);
    if (cronArtifact && stringField(cronArtifact.artifactId) === artifactId) {
      return cronArtifact;
    }
    for (const artifact of resolvePreviewArtifactRecords(message)) {
      if (
        stringField(artifact.artifactId) === artifactId &&
        isDeliverableResultArtifact(artifact)
      ) {
        return artifact;
      }
    }
  }
  return null;
}

export function createArtifactWorkspaceFromMessage(
  messages: unknown[],
  artifactId: string,
): ArtifactWorkspaceSidebar | null {
  const artifactRecord = findArtifactCandidate(messages, artifactId);
  if (!artifactRecord) {
    return null;
  }
  const now = new Date().toISOString();
  const createdBy = { type: "bot" as const, id: stringField(artifactRecord.provider) || "agent" };
  const artifact: SharedArtifact = {
    artifactId,
    artifactType: normalizeArtifactType(artifactRecord.artifactType, artifactRecord),
    storageClass: normalizeArtifactStorageClass(artifactRecord.storageClass),
    title: stringField(artifactRecord.title) || artifactId,
    mimeType: stringField(artifactRecord.mimeType) || undefined,
    provider: stringField(artifactRecord.provider) || "agent",
    providerResourceId: stringField(artifactRecord.providerResourceId) || undefined,
    openUrl: stringField(artifactRecord.openUrl) || undefined,
    previewUrl: stringField(artifactRecord.previewUrl) || undefined,
    downloadUrl: stringField(artifactRecord.downloadUrl) || undefined,
    editUrl: stringField(artifactRecord.editUrl) || undefined,
    sourceMessage: stringField(artifactRecord.sourceMessage) || undefined,
    createdBy,
    createdAt: stringField(artifactRecord.createdAt) || now,
    updatedAt: stringField(artifactRecord.updatedAt) || now,
    lifecycleState: normalizeArtifactLifecycle(artifactRecord.lifecycleState),
    providerMetadata: stringRecord(artifactRecord.providerMetadata),
  };
  const versionLabel = stringField(artifactRecord.versionLabel);
  return {
    artifact,
    versions: versionLabel
      ? [
          {
            versionId: stringField(artifactRecord.versionId) || `${artifactId}:${versionLabel}`,
            artifactId,
            label: versionLabel,
            createdAt: artifact.updatedAt,
            createdBy,
          },
        ]
      : [],
    deliveries: [],
    grants: [],
    intents: [],
  };
}
