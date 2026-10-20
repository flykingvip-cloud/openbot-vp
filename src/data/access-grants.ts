import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { OpenBotConfig } from "../config/config.js";
import { resolveDataRoot } from "../config/data-space.js";

export type AccessGrantResourceType = "knowledge" | "path" | "memory";

export type AccessGrantRecord = {
  id: string;
  agentId: string;
  resourceType: AccessGrantResourceType;
  resourcePath: string;
  grantedBy: string;
  grantedAt: string;
  reason: string;
  revokedAt: string | null;
};

export function resolveAccessGrantsPath(dataRoot: string): string {
  return path.join(dataRoot, ".meta", "access-grants.jsonl");
}

async function readGrantLines(filePath: string): Promise<AccessGrantRecord[]> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const records: AccessGrantRecord[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        const parsed = JSON.parse(trimmed) as Partial<AccessGrantRecord>;
        if (
          parsed &&
          typeof parsed === "object" &&
          typeof parsed.id === "string" &&
          typeof parsed.agentId === "string" &&
          typeof parsed.resourceType === "string" &&
          typeof parsed.resourcePath === "string"
        ) {
          records.push({
            id: parsed.id,
            agentId: parsed.agentId,
            resourceType: parsed.resourceType,
            resourcePath: parsed.resourcePath,
            grantedBy: typeof parsed.grantedBy === "string" ? parsed.grantedBy : "user",
            grantedAt:
              typeof parsed.grantedAt === "string" ? parsed.grantedAt : new Date().toISOString(),
            reason: typeof parsed.reason === "string" ? parsed.reason : "user_explicit_share",
            revokedAt: typeof parsed.revokedAt === "string" ? parsed.revokedAt : null,
          });
        }
      } catch {
        // skip malformed lines
      }
    }
    return records;
  } catch {
    return [];
  }
}

async function writeGrantLines(filePath: string, records: AccessGrantRecord[]): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const payload = records.map((record) => JSON.stringify(record)).join("\n");
  await fs.writeFile(filePath, payload ? `${payload}\n` : "", "utf-8");
}

export async function listAccessGrants(params: {
  cfg?: OpenBotConfig;
  agentId?: string;
  includeRevoked?: boolean;
}): Promise<AccessGrantRecord[]> {
  const dataRoot = resolveDataRoot(params.cfg);
  const filePath = resolveAccessGrantsPath(dataRoot);
  const records = await readGrantLines(filePath);
  return records.filter((record) => {
    if (params.agentId && record.agentId !== params.agentId) {
      return false;
    }
    if (!params.includeRevoked && record.revokedAt) {
      return false;
    }
    return true;
  });
}

export async function recordAccessGrant(params: {
  cfg?: OpenBotConfig;
  agentId: string;
  resourceType: AccessGrantResourceType;
  resourcePath: string;
  grantedBy?: string;
  reason?: string;
}): Promise<AccessGrantRecord> {
  const dataRoot = resolveDataRoot(params.cfg);
  const filePath = resolveAccessGrantsPath(dataRoot);
  const records = await readGrantLines(filePath);
  const now = new Date().toISOString();
  const record: AccessGrantRecord = {
    id: `grant-${randomUUID()}`,
    agentId: params.agentId,
    resourceType: params.resourceType,
    resourcePath: params.resourcePath,
    grantedBy: params.grantedBy ?? "user",
    grantedAt: now,
    reason: params.reason ?? "user_explicit_share",
    revokedAt: null,
  };
  records.push(record);
  await writeGrantLines(filePath, records);
  return record;
}

export async function revokeAccessGrant(params: {
  cfg?: OpenBotConfig;
  grantId: string;
}): Promise<AccessGrantRecord | null> {
  const dataRoot = resolveDataRoot(params.cfg);
  const filePath = resolveAccessGrantsPath(dataRoot);
  const records = await readGrantLines(filePath);
  const target = records.find((record) => record.id === params.grantId);
  if (!target) {
    return null;
  }
  if (!target.revokedAt) {
    target.revokedAt = new Date().toISOString();
    await writeGrantLines(filePath, records);
  }
  return target;
}
