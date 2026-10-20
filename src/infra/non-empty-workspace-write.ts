import fs from "node:fs";
import fsp from "node:fs/promises";

/** Stable error text for write/edit/materialize paths that must not claim success. */
export const EMPTY_WORKSPACE_WRITE_MESSAGE = "empty workspace write refused";

export class EmptyWorkspaceWriteError extends Error {
  readonly code = "empty_write" as const;

  constructor(filePath: string) {
    super(`${EMPTY_WORKSPACE_WRITE_MESSAGE}: ${filePath}`);
    this.name = "EmptyWorkspaceWriteError";
  }
}

export function workspacePayloadByteLength(data: string | Buffer): number {
  return typeof data === "string" ? Buffer.byteLength(data) : data.byteLength;
}

/** A workspace deliverable is openable only when the bytes are actually present. */
export function isNonEmptyWorkspaceBytes(byteLength: number | null | undefined): boolean {
  return typeof byteLength === "number" && Number.isFinite(byteLength) && byteLength > 0;
}

/**
 * Refuse a write whose payload is zero bytes before it hits disk.
 * Edit replacements may pass an empty `newText` span; this checks the full
 * file payload the tool is about to persist, not that span.
 */
export function assertNonEmptyWritePayload(data: string | Buffer, filePath: string): void {
  if (!isNonEmptyWorkspaceBytes(workspacePayloadByteLength(data))) {
    throw new EmptyWorkspaceWriteError(filePath);
  }
}

/**
 * After a write, a regular file of size 0 is a failure. Removes that empty
 * file so preview does not treat it as an openable artifact.
 * A missing path is left alone — the caller already wrote non-empty bytes, and
 * pinned writers may surface a different final path.
 */
export async function assertWrittenFileNonEmpty(absolutePath: string): Promise<void> {
  let size = -1;
  try {
    const stat = await fsp.stat(absolutePath);
    if (!stat.isFile()) {
      return;
    }
    size = stat.size;
  } catch {
    return;
  }
  if (size > 0) {
    return;
  }
  await fsp.unlink(absolutePath).catch(() => {});
  throw new EmptyWorkspaceWriteError(absolutePath);
}

export function assertWrittenFileNonEmptySync(absolutePath: string): void {
  let size = -1;
  try {
    const stat = fs.statSync(absolutePath);
    if (!stat.isFile()) {
      return;
    }
    size = stat.size;
  } catch {
    return;
  }
  if (size > 0) {
    return;
  }
  try {
    fs.unlinkSync(absolutePath);
  } catch {
    // The write is still a failure if unlink loses a race.
  }
  throw new EmptyWorkspaceWriteError(absolutePath);
}
