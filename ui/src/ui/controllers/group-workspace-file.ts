import type { OfficeSlideText } from "../../../../src/gateway/office-slide-draft.ts";
import { declareWorkspaceRelativePath } from "../../../../src/shared/workspace-deliverable-path.ts";
import type { GatewayBrowserClient } from "../gateway.ts";

/** Payload returned by the `workbench.group-file.read` gateway RPC. */
export type GroupWorkspaceFilePayload = {
  contentHash?: string;
  groupId: string;
  relativePath: string;
  filename: string;
  mimeType: string;
  byteLength: number;
  textLike: boolean;
  renderKind?: "html";
  html?: string;
  base64?: string;
  officeSlides?: OfficeSlideText[];
};

export function normalizeGroupWorkspaceRelativePath(requested: string): string | null {
  const trimmed = requested.trim().replace(/\\/g, "/");
  if (!trimmed || trimmed.startsWith("/") || trimmed.includes("\0")) {
    return null;
  }
  const segments = trimmed.split("/").filter((segment) => segment.length > 0);
  if (segments.some((segment) => segment === ".." || segment === ".")) {
    return null;
  }
  return segments.join("/");
}

export function resolveGroupWorkspaceReadPath(filename: string): string | null {
  const normalized = normalizeGroupWorkspaceRelativePath(filename);
  if (!normalized) {
    return null;
  }
  // Declared relative paths (including bare basenames = workspace root) stay as-is.
  // Do not prefix `deliverables/` — that folder is not the birth-path contract.
  return normalized;
}

export function isGroupHtmlPreviewFilename(filename: string, mimeType?: string): boolean {
  const lower = filename.trim().toLowerCase();
  const mime = (mimeType ?? "").trim().toLowerCase();
  return lower.endsWith(".html") || lower.endsWith(".htm") || mime === "text/html";
}

export function isGroupPdfPreviewFilename(filename: string, mimeType?: string): boolean {
  const lower = filename.trim().toLowerCase();
  const mime = (mimeType ?? "").trim().toLowerCase();
  return lower.endsWith(".pdf") || mime === "application/pdf";
}

export function isGroupImagePreviewFilename(filename: string, mimeType?: string): boolean {
  const lower = filename.trim().toLowerCase();
  const mime = (mimeType ?? "").trim().toLowerCase();
  return /\.(?:png|jpe?g|webp|gif|svg|bmp)$/i.test(lower) || mime.startsWith("image/");
}

/**
 * Same-path aliases only: report/ vs reports/, and an HTML sibling of a PDF.
 * Bare names are not expanded into other directories. The gateway's authorized
 * unique-match is the only basename compat.
 */
export function buildGroupWorkspaceReadCandidates(filename: string): string[] {
  const primary = resolveGroupWorkspaceReadPath(filename);
  if (!primary) {
    return [];
  }
  const candidates = [primary];
  const push = (path: string) => {
    if (path && !candidates.includes(path)) {
      candidates.push(path);
    }
  };

  const swapReportsDir = (path: string): string[] => {
    if (path.startsWith("reports/")) {
      return [`report/${path.slice("reports/".length)}`];
    }
    if (path.startsWith("report/")) {
      return [`reports/${path.slice("report/".length)}`];
    }
    return [];
  };

  const withHtmlSibling = (path: string): string | null => {
    if (path.toLowerCase().endsWith(".pdf")) {
      return `${path.slice(0, -".pdf".length)}.html`;
    }
    return null;
  };

  for (const path of candidates.slice()) {
    for (const alt of swapReportsDir(path)) {
      push(alt);
    }
  }
  for (const path of candidates.slice()) {
    const html = withHtmlSibling(path);
    if (html) {
      push(html);
    }
  }

  return candidates;
}

/**
 * Paths the sidebar may ask the gateway to open.
 * Nested relative paths stay exact (plus the report/reports and html sibling
 * of that same path). Absolute paths are sent through unchanged so the gateway
 * can map them onto a trusted root. They are not rewritten to a basename, and
 * bare names are not fanned out across directories on the client.
 */
export function workspaceFileReadCandidates(filename: string): string[] {
  const located = declareWorkspaceRelativePath(filename);
  if (located.ok) {
    return buildGroupWorkspaceReadCandidates(located.relativePath);
  }
  if (located.code === "unmappable") {
    const absolute = filename.trim().replace(/\\/g, "/");
    return absolute ? [absolute] : [];
  }
  return [];
}

export async function readGroupWorkspaceFile(
  client: GatewayBrowserClient | null,
  groupId: string,
  filename: string,
  options?: { render?: boolean },
): Promise<GroupWorkspaceFilePayload | null> {
  const trimmedGroupId = groupId.trim();
  const candidates = workspaceFileReadCandidates(filename);
  if (!client || !trimmedGroupId || candidates.length === 0) {
    return null;
  }
  for (const relativePath of candidates) {
    try {
      const res = await client.request<GroupWorkspaceFilePayload>("workbench.group-file.read", {
        groupId: trimmedGroupId,
        filename: relativePath,
        ...(options?.render ? { render: true } : {}),
      });
      if (!res || typeof res.filename !== "string") {
        continue;
      }
      const hasHtml = typeof res.html === "string" && res.html.length > 0;
      const hasBytes = typeof res.base64 === "string" && res.base64.length > 0;
      // A zero-byte file is not previewable. Keep looking, then miss, instead of an empty open.
      if (typeof res.byteLength === "number" && res.byteLength <= 0 && !hasHtml) {
        continue;
      }
      if (!hasHtml && !hasBytes) {
        continue;
      }
      return {
        ...res,
        relativePath: res.relativePath || relativePath,
      };
    } catch {
      // try next candidate
    }
  }
  return null;
}

export async function patchGroupWorkspacePptx(
  client: GatewayBrowserClient | null,
  groupId: string,
  filename: string,
  slides: OfficeSlideText[],
  expectedContentHash?: string,
): Promise<GroupWorkspaceFilePayload | null> {
  const trimmedGroupId = groupId.trim();
  const relativePath = resolveGroupWorkspaceReadPath(filename);
  if (!client || !trimmedGroupId || !relativePath || slides.length === 0) {
    return null;
  }
  try {
    const res = await client.request<GroupWorkspaceFilePayload>("workbench.group-file.patch-pptx", {
      groupId: trimmedGroupId,
      filename: relativePath,
      slides,
      expectedContentHash,
    });
    if (!res || typeof res.filename !== "string") {
      return null;
    }
    return {
      ...res,
      relativePath: res.relativePath || relativePath,
    };
  } catch (error) {
    if (String(error).includes("ARTIFACT_VERSION_CONFLICT")) {
      throw error;
    }
    return null;
  }
}

function base64ToBytes(base64: string) {
  const binary = atob(base64);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function decodeGroupFileText(base64: string): string {
  return new TextDecoder("utf-8").decode(base64ToBytes(base64));
}
