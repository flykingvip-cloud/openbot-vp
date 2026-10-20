/**
 * Tenant-scoped enterprise security audit.
 * This is not platform-auth-login.jsonl. Each tenant has its own file.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { CONTROL_UI_PLATFORM_AUTH_BASE_PATH } from "../control-ui-contract.js";
import { enterpriseControlRoot, safeTenantKey } from "./tenant-controls-store.js";

export type EnterpriseAuditEvent = {
  ts: string;
  tenantId: string;
  kind: "login_success" | "login_ip_denied" | "control_write";
  method?: string;
  actorUserId?: string;
  summary: string;
};

const MAX_RANGE_MS = 31 * 24 * 60 * 60 * 1000;
const MAX_EVENTS = 5000;

export type AuditExportResult =
  | { ok: true; exportId: string; downloadPath: string }
  | { ok: false; reason: "range_too_wide" | "export_unavailable" };

type StoredExport = {
  tenantId: string;
  format: "json" | "csv";
  content: string;
};

function auditPath(tenantId: string): string {
  return path.join(
    enterpriseControlRoot(),
    "audit",
    "enterprise-security",
    `${safeTenantKey(tenantId)}.jsonl`,
  );
}

function exportPath(exportId: string): string {
  if (!/^exp_[0-9a-f-]{36}$/.test(exportId)) {
    throw new Error("export id is invalid");
  }
  return path.join(enterpriseControlRoot(), "enterprise-audit-exports", `${exportId}.json`);
}

export async function appendEnterpriseAuditEvent(event: EnterpriseAuditEvent): Promise<void> {
  const filePath = auditPath(event.tenantId);
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await fs.appendFile(filePath, `${JSON.stringify(event)}\n`, { mode: 0o600 });
}

async function readTenantAudit(tenantId: string): Promise<EnterpriseAuditEvent[]> {
  try {
    const raw = await fs.readFile(auditPath(tenantId), "utf8");
    const events: EnterpriseAuditEvent[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) {
        continue;
      }
      const parsed = JSON.parse(line) as EnterpriseAuditEvent;
      if (parsed.tenantId !== tenantId) {
        continue;
      }
      events.push(parsed);
    }
    return events;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

function toCsv(events: EnterpriseAuditEvent[]): string {
  const lines = ["ts,kind,method,actorUserId,summary"];
  for (const event of events) {
    lines.push(
      [event.ts, event.kind, event.method ?? "", event.actorUserId ?? "", event.summary]
        .map((cell) => csvCell(cell))
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

export async function createEnterpriseAuditExport(params: {
  tenantId: string;
  from: string;
  to: string;
  format: "json" | "csv";
}): Promise<AuditExportResult> {
  const fromMs = Date.parse(params.from);
  const toMs = Date.parse(params.to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs) {
    return { ok: false, reason: "export_unavailable" };
  }
  if (toMs - fromMs > MAX_RANGE_MS) {
    return { ok: false, reason: "range_too_wide" };
  }
  let events: EnterpriseAuditEvent[];
  try {
    events = await readTenantAudit(params.tenantId);
  } catch {
    return { ok: false, reason: "export_unavailable" };
  }
  const selected = events.filter((event) => {
    const at = Date.parse(event.ts);
    return Number.isFinite(at) && at >= fromMs && at <= toMs;
  });
  if (selected.length > MAX_EVENTS) {
    return { ok: false, reason: "range_too_wide" };
  }
  const exportId = `exp_${randomUUID()}`;
  const content = params.format === "csv" ? toCsv(selected) : `${JSON.stringify(selected)}\n`;
  const stored: StoredExport = {
    tenantId: params.tenantId,
    format: params.format,
    content,
  };
  const filePath = exportPath(exportId);
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await fs.writeFile(filePath, JSON.stringify(stored), { mode: 0o600 });
  return {
    ok: true,
    exportId,
    downloadPath: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/enterprise-audit-export/${exportId}`,
  };
}

export async function readEnterpriseAuditExport(
  exportId: string,
): Promise<(StoredExport & { exportId: string }) | null> {
  try {
    const raw = await fs.readFile(exportPath(exportId), "utf8");
    const parsed = JSON.parse(raw) as StoredExport;
    if (!parsed || parsed.tenantId.trim().length === 0 || !parsed.content) {
      return null;
    }
    return { ...parsed, exportId };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}
