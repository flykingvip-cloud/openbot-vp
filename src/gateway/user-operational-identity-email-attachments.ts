import fs from "node:fs/promises";
import path from "node:path";
import type { PlatformAuthEmailAttachment } from "./platform-auth-email.js";
import { isPathInside } from "./workspace-inventory/path-safety.js";

export const USER_OI_EMAIL_MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
export const USER_OI_EMAIL_MAX_ATTACHMENTS = 5;

const CONTENT_TYPES: Record<string, string> = {
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pdf": "application/pdf",
  ".html": "text/html",
  ".htm": "text/html",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".zip": "application/zip",
};

export type UserOperationalIdentityEmailAttachmentInput = {
  filePath?: string;
  filename?: string;
  attachmentBase64?: string;
  contentType?: string;
};

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function inferContentType(filename: string, explicit?: string): string {
  const trimmed = explicit?.trim();
  if (trimmed) {
    return trimmed;
  }
  return CONTENT_TYPES[path.extname(filename).toLowerCase()] ?? "application/octet-stream";
}

function decodeAttachmentBase64(raw: string): Buffer {
  const trimmed = raw.trim();
  const dataUrl = /^data:[^;]+;base64,(.+)$/i.exec(trimmed);
  const encoded = (dataUrl?.[1] ?? trimmed).replace(/\s+/g, "");
  if (!encoded) {
    throw new Error("attachmentBase64 is empty.");
  }
  const content = Buffer.from(encoded, "base64");
  if (content.length === 0) {
    throw new Error("attachmentBase64 did not decode to any bytes.");
  }
  if (content.length > USER_OI_EMAIL_MAX_ATTACHMENT_BYTES) {
    throw new Error(
      `attachment exceeds ${USER_OI_EMAIL_MAX_ATTACHMENT_BYTES} bytes after decoding.`,
    );
  }
  return content;
}

function sanitizeFilename(filename: string): string {
  const base = path
    .basename(filename)
    .replaceAll("\0", "")
    .replace(/[\r\n]/g, "")
    .trim();
  if (!base || base === "." || base === "..") {
    throw new Error("attachment filename is required.");
  }
  return base;
}

export async function listOwnerAttachmentRoots(ownerId: string): Promise<string[]> {
  const id = ownerId.trim();
  const tenantsRoot = process.env.OPENBOT_TENANTS_ROOT?.trim();
  if (!id || !tenantsRoot) {
    return [];
  }
  const roots: string[] = [];
  let tenantNames: string[] = [];
  try {
    tenantNames = await fs.readdir(tenantsRoot);
  } catch {
    return [];
  }
  for (const tenantId of tenantNames) {
    const userRoot = path.resolve(tenantsRoot, tenantId, "users", id);
    try {
      const stat = await fs.stat(userRoot);
      if (stat.isDirectory() && isPathInside(tenantsRoot, userRoot)) {
        roots.push(userRoot);
      }
    } catch {
      // Tenant dirs that are not this user's tree are ignored.
    }
  }
  return roots;
}

export async function resolveOwnerAttachmentFilePath(params: {
  filePath: string;
  ownerId: string;
}): Promise<string> {
  const raw = params.filePath.trim();
  if (!raw) {
    throw new Error("filePath is required.");
  }
  const roots = await listOwnerAttachmentRoots(params.ownerId);
  if (roots.length === 0) {
    throw new Error("attachment filePath is outside the signed-in user's workspace.");
  }
  const candidates = path.isAbsolute(raw)
    ? [path.resolve(raw)]
    : roots.map((root) => path.resolve(root, "OpenBot", "workspace", raw));
  for (const candidate of candidates) {
    if (!roots.some((root) => isPathInside(root, candidate))) {
      continue;
    }
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) {
        if (stat.size > USER_OI_EMAIL_MAX_ATTACHMENT_BYTES) {
          throw new Error(`attachment exceeds ${USER_OI_EMAIL_MAX_ATTACHMENT_BYTES} bytes.`);
        }
        return candidate;
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("attachment exceeds")) {
        throw error;
      }
    }
  }
  throw new Error("attachment filePath is outside the signed-in user's workspace.");
}

function collectAttachmentInputs(
  payload: Record<string, unknown>,
): UserOperationalIdentityEmailAttachmentInput[] {
  const items: UserOperationalIdentityEmailAttachmentInput[] = [];
  const jsonRaw = stringValue(payload.attachmentsJson) || stringValue(payload.attachments);
  if (jsonRaw.startsWith("[")) {
    try {
      const parsed = JSON.parse(jsonRaw) as unknown;
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            continue;
          }
          const record = entry as Record<string, unknown>;
          items.push({
            filePath: stringValue(record.filePath) || undefined,
            filename: stringValue(record.filename) || undefined,
            attachmentBase64:
              stringValue(record.attachmentBase64) ||
              stringValue(record.contentBase64) ||
              stringValue(record.buffer) ||
              undefined,
            contentType: stringValue(record.contentType) || undefined,
          });
        }
      }
    } catch {
      throw new Error("attachments JSON is invalid.");
    }
  }
  if (Array.isArray(payload.attachments)) {
    for (const entry of payload.attachments) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        continue;
      }
      const record = entry as Record<string, unknown>;
      items.push({
        filePath: stringValue(record.filePath) || undefined,
        filename: stringValue(record.filename) || undefined,
        attachmentBase64:
          stringValue(record.attachmentBase64) ||
          stringValue(record.contentBase64) ||
          stringValue(record.buffer) ||
          undefined,
        contentType: stringValue(record.contentType) || undefined,
      });
    }
  }
  const single: UserOperationalIdentityEmailAttachmentInput = {
    filePath: stringValue(payload.filePath) || undefined,
    filename: stringValue(payload.filename) || undefined,
    attachmentBase64:
      stringValue(payload.attachmentBase64) ||
      stringValue(payload.contentBase64) ||
      stringValue(payload.buffer) ||
      undefined,
    contentType: stringValue(payload.contentType) || undefined,
  };
  if (single.filePath || single.attachmentBase64) {
    items.push(single);
  }
  return items;
}

export async function resolveUserOperationalIdentityEmailAttachments(params: {
  payload: Record<string, unknown>;
  ownerId: string;
}): Promise<PlatformAuthEmailAttachment[]> {
  const inputs = collectAttachmentInputs(params.payload);
  if (inputs.length === 0) {
    return [];
  }
  if (inputs.length > USER_OI_EMAIL_MAX_ATTACHMENTS) {
    throw new Error(`at most ${USER_OI_EMAIL_MAX_ATTACHMENTS} attachments are allowed.`);
  }
  const resolved: PlatformAuthEmailAttachment[] = [];
  for (const input of inputs) {
    if (input.attachmentBase64) {
      const filename = sanitizeFilename(input.filename || input.filePath || "attachment.bin");
      resolved.push({
        filename,
        contentType: inferContentType(filename, input.contentType),
        content: decodeAttachmentBase64(input.attachmentBase64),
      });
      continue;
    }
    if (!input.filePath) {
      throw new Error("each attachment needs filePath or attachmentBase64.");
    }
    const filePath = await resolveOwnerAttachmentFilePath({
      filePath: input.filePath,
      ownerId: params.ownerId,
    });
    const filename = sanitizeFilename(input.filename || filePath);
    const content = await fs.readFile(filePath);
    if (content.length > USER_OI_EMAIL_MAX_ATTACHMENT_BYTES) {
      throw new Error(`attachment exceeds ${USER_OI_EMAIL_MAX_ATTACHMENT_BYTES} bytes.`);
    }
    resolved.push({
      filename,
      contentType: inferContentType(filename, input.contentType),
      content,
    });
  }
  return resolved;
}
