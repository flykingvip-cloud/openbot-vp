/**
 * File-backed user-scoped artifact + grant store.
 * Layout under rootDir:
 *   blobs/{artifactId}
 *   meta/{artifactId}.json
 *   grants/{grantId}.json
 *   audit.jsonl
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { ArtifactAuditEvent, ArtifactGrant, ArtifactRecord } from "./types.js";

export type ArtifactGrantStorePaths = {
  rootDir: string;
  blobsDir: string;
  metaDir: string;
  grantsDir: string;
  auditPath: string;
};

export function resolveStorePaths(rootDir: string): ArtifactGrantStorePaths {
  const root = path.resolve(rootDir);
  return {
    rootDir: root,
    blobsDir: path.join(root, "blobs"),
    metaDir: path.join(root, "meta"),
    grantsDir: path.join(root, "grants"),
    auditPath: path.join(root, "audit.jsonl"),
  };
}

export async function ensureStore(paths: ArtifactGrantStorePaths): Promise<void> {
  await fs.mkdir(paths.blobsDir, { recursive: true });
  await fs.mkdir(paths.metaDir, { recursive: true });
  await fs.mkdir(paths.grantsDir, { recursive: true });
}

function metaPath(paths: ArtifactGrantStorePaths, artifactId: string): string {
  return path.join(paths.metaDir, `${artifactId}.json`);
}

function blobPath(paths: ArtifactGrantStorePaths, artifactId: string): string {
  return path.join(paths.blobsDir, artifactId);
}

function grantPath(paths: ArtifactGrantStorePaths, grantId: string): string {
  return path.join(paths.grantsDir, `${grantId}.json`);
}

function assertIdSegment(id: string, label: string): void {
  if (!id || id.includes("..") || id.includes("/") || id.includes("\\") || id.includes("\0")) {
    throw new Error(`invalid_${label}`);
  }
}

export async function writeArtifact(
  paths: ArtifactGrantStorePaths,
  record: ArtifactRecord,
  content: Buffer,
): Promise<void> {
  assertIdSegment(record.artifactId, "artifact_id");
  await ensureStore(paths);
  const targetBlob = blobPath(paths, record.artifactId);
  const targetMeta = metaPath(paths, record.artifactId);
  if (path.resolve(path.dirname(targetBlob)) !== path.resolve(paths.blobsDir)) {
    throw new Error("path_escape");
  }
  await fs.writeFile(targetBlob, content);
  await fs.writeFile(targetMeta, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

export async function readArtifactRecord(
  paths: ArtifactGrantStorePaths,
  artifactId: string,
): Promise<ArtifactRecord | null> {
  assertIdSegment(artifactId, "artifact_id");
  try {
    const raw = await fs.readFile(metaPath(paths, artifactId), "utf8");
    return JSON.parse(raw) as ArtifactRecord;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

export async function readArtifactBytes(
  paths: ArtifactGrantStorePaths,
  artifactId: string,
): Promise<Buffer | null> {
  assertIdSegment(artifactId, "artifact_id");
  try {
    return await fs.readFile(blobPath(paths, artifactId));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

export async function writeGrant(
  paths: ArtifactGrantStorePaths,
  grant: ArtifactGrant,
): Promise<void> {
  assertIdSegment(grant.grantId, "grant_id");
  await ensureStore(paths);
  await fs.writeFile(
    grantPath(paths, grant.grantId),
    `${JSON.stringify(grant, null, 2)}\n`,
    "utf8",
  );
}

export async function readGrant(
  paths: ArtifactGrantStorePaths,
  grantId: string,
): Promise<ArtifactGrant | null> {
  assertIdSegment(grantId, "grant_id");
  try {
    const raw = await fs.readFile(grantPath(paths, grantId), "utf8");
    return JSON.parse(raw) as ArtifactGrant;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

export async function appendAudit(
  paths: ArtifactGrantStorePaths,
  event: ArtifactAuditEvent,
): Promise<void> {
  await ensureStore(paths);
  await fs.appendFile(paths.auditPath, `${JSON.stringify(event)}\n`, "utf8");
}

export async function readAuditLines(
  paths: ArtifactGrantStorePaths,
): Promise<ArtifactAuditEvent[]> {
  try {
    const raw = await fs.readFile(paths.auditPath, "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ArtifactAuditEvent);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }
}
