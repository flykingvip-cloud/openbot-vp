import type { OfficeSlideText } from "../../../../src/gateway/office-slide-draft.ts";
import { classifyWorkspacePathFailure } from "../../../../src/shared/workspace-deliverable-path.ts";
import type { GatewayBrowserClient } from "../gateway.ts";

/** Payload returned by the `workbench.steward-file.read` gateway RPC. */
export type StewardWorkspaceFilePayload = {
  /** Download basename. */
  filename: string;
  /** Canonical path relative to the selected agent workspace. */
  relativePath?: string;
  mimeType: string;
  byteLength: number;
  /** True for text-like files that can be previewed inline (md/txt/csv/json/...). */
  textLike: boolean;
  /** Present when the server rendered a produced document (e.g. .docx) to previewable HTML. */
  renderKind?: "html";
  /** Server-rendered HTML preview (must be sanitized before rendering). */
  html?: string;
  /** Raw file bytes (base64). Omitted for most HTML renders; xlsx HTML previews still include it for download. */
  base64?: string;
  /** Extracted PPTX slide text for in-preview edit + write-back. */
  officeSlides?: OfficeSlideText[];
};

/**
 * Fetches a deliverable from the current direct-chat agent workspace. Returns null on any failure
 * so callers can show an unavailable state without throwing. Omitting `sessionKey` retains the
 * legacy per-user builtin-steward lookup.
 *
 * Pass `render: true` to request a faithful document preview: a produced Word file comes back as
 * sanitized-ready HTML (no base64), while text/other files come back as bytes as usual.
 */
export type StewardWorkspaceFileRead =
  | { ok: true; file: StewardWorkspaceFilePayload }
  | { ok: false; reason: "missing" | "unmappable" | "rejected" };

export async function readStewardWorkspaceFileDetailed(
  client: GatewayBrowserClient | null,
  filename: string,
  options?: { render?: boolean; sessionKey?: string },
): Promise<StewardWorkspaceFileRead> {
  const trimmed = filename.trim();
  if (!client || !trimmed) {
    return { ok: false, reason: "missing" };
  }
  const sessionKey = options?.sessionKey?.trim();
  try {
    const res = await client.request<StewardWorkspaceFilePayload>("workbench.steward-file.read", {
      filename: trimmed,
      ...(sessionKey ? { sessionKey } : {}),
      ...(options?.render ? { render: true } : {}),
    });
    if (!res || typeof res.filename !== "string") {
      return { ok: false, reason: "missing" };
    }
    const hasHtml = typeof res.html === "string" && res.html.length > 0;
    const hasBytes = typeof res.base64 === "string" && res.base64.length > 0;
    // A zero-byte file is not previewable. Treat it as a miss so the card stays FileMissing.
    if (typeof res.byteLength === "number" && res.byteLength <= 0 && !hasHtml) {
      return { ok: false, reason: "missing" };
    }
    if (!hasHtml && !hasBytes) {
      return { ok: false, reason: "missing" };
    }
    return { ok: true, file: res };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return { ok: false, reason: classifyWorkspacePathFailure(message) };
  }
}

export async function readStewardWorkspaceFile(
  client: GatewayBrowserClient | null,
  filename: string,
  options?: { render?: boolean; sessionKey?: string },
): Promise<StewardWorkspaceFilePayload | null> {
  const result = await readStewardWorkspaceFileDetailed(client, filename, options);
  return result.ok ? result.file : null;
}

/** Write edited slide text back into the workspace .pptx package. */
export async function patchStewardWorkspacePptx(
  client: GatewayBrowserClient | null,
  filename: string,
  slides: OfficeSlideText[],
  options?: { sessionKey?: string },
): Promise<StewardWorkspaceFilePayload | null> {
  const trimmed = filename.trim();
  if (!client || !trimmed || slides.length === 0) {
    return null;
  }
  const sessionKey = options?.sessionKey?.trim();
  try {
    const res = await client.request<StewardWorkspaceFilePayload>(
      "workbench.steward-file.patch-pptx",
      {
        filename: trimmed,
        slides,
        ...(sessionKey ? { sessionKey } : {}),
      },
    );
    if (!res || typeof res.filename !== "string") {
      return null;
    }
    return res;
  } catch {
    return null;
  }
}

function base64ToBytes(base64: string) {
  const binary = atob(base64);
  // Allocate an explicit ArrayBuffer (not ArrayBufferLike) so the view is a
  // valid BlobPart / BufferSource under strict DOM lib types.
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** Decode a base64 payload as UTF-8 text (for inline preview of text-like files). */
export function decodeStewardFileText(base64: string): string {
  return new TextDecoder("utf-8").decode(base64ToBytes(base64));
}

/** Trigger a real browser download of the fetched file bytes (no-op when bytes are absent). */
export function downloadStewardWorkspaceFile(file: StewardWorkspaceFilePayload): void {
  if (typeof document === "undefined" || typeof file.base64 !== "string") {
    return;
  }
  const blob = new Blob([base64ToBytes(file.base64)], {
    type: file.mimeType || "application/octet-stream",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Release the blob URL after the download has had time to start.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
