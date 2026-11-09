import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const OFFICE_LIMITS = {
  maxInputBytes: 20 * 1024 * 1024,
  maxOutputBytes: 20 * 1024 * 1024,
  timeoutMs: 30_000,
  maxBlocks: 400,
  maxTableRows: 200,
  maxSlides: 40,
  maxSheets: 12,
  maxRows: 2000,
  maxCols: 40,
  maxPdfPages: 30,
  maxPreviewChars: 8000,
} as const;

export type OfficePrincipal = {
  /** Null means an individual user, not an enterprise tenant. */
  tenantId: string | null;
  userId: string;
  tenantAdmin?: boolean;
  platformAdmin?: boolean;
};

export type OfficeLogEvent = {
  scope: string;
  action: string;
  kind?: string;
  status: "ok" | "error";
  bytes?: number;
  errorCode?: string;
  durationMs?: number;
};

export class OfficeSuiteError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "OfficeSuiteError";
  }
}

export function assertPrincipal(principal: OfficePrincipal): void {
  if (!sanitizeId(principal.userId)) {
    throw new OfficeSuiteError("auth", "需要已登录的用户身份后才能处理文件。请重新登录再试。");
  }
  if (principal.tenantId !== null && !sanitizeId(principal.tenantId)) {
    throw new OfficeSuiteError("auth", "租户身份无效。请使用当前企业会话重试。");
  }
}

export function scopeKey(principal: OfficePrincipal): string {
  assertPrincipal(principal);
  const user = sanitizeId(principal.userId);
  if (!principal.tenantId) {
    return path.join("individual", user);
  }
  return path.join("tenant", sanitizeId(principal.tenantId), "user", user);
}

export function sanitizeId(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (
    !trimmed ||
    trimmed.length > 120 ||
    trimmed.includes("..") ||
    trimmed.includes("/") ||
    trimmed.includes("\\")
  ) {
    return "";
  }
  if (!/^[A-Za-z0-9._@:-]+$/.test(trimmed)) {
    return "";
  }
  return trimmed;
}

export function resolveInside(root: string, ...parts: string[]): string {
  const resolved = path.resolve(root, ...parts);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new OfficeSuiteError("path", "路径超出当前用户的文件隔离目录。");
  }
  return resolved;
}

export function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function safeLog(event: OfficeLogEvent): OfficeLogEvent {
  return {
    scope: event.scope,
    action: event.action,
    ...(event.kind ? { kind: event.kind } : {}),
    status: event.status,
    ...(typeof event.bytes === "number" ? { bytes: event.bytes } : {}),
    ...(event.errorCode ? { errorCode: event.errorCode } : {}),
    ...(typeof event.durationMs === "number" ? { durationMs: event.durationMs } : {}),
  };
}

export async function writeAtomic(file: string, bytes: Buffer): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, bytes, { flag: "wx" });
  try {
    await fs.rename(temp, file);
  } catch (error) {
    await fs.rm(temp, { force: true });
    throw error;
  }
}

export function assertBytes(bytes: Buffer, max: number, label: string): void {
  if (bytes.length === 0) {
    throw new OfficeSuiteError("empty", `${label}是空的，没有写入新文件。`);
  }
  if (bytes.length > max) {
    throw new OfficeSuiteError(
      "limit",
      `${label}超过 ${Math.floor(max / (1024 * 1024))}MB 上限，已保留原文件。请拆分后再试。`,
    );
  }
}
