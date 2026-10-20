/**
 * Resolve an existing Daibai session for a diagnosis signal or case.
 * Does not create a session and does not call user.daibai.ask.
 */
import fs from "node:fs";
import path from "node:path";
import type { DiagnosisConversationResolution } from "./approval-ledger.js";
import { hashSessionKey } from "./live-run.js";

export type DiagnosisConversationLookup = {
  tenantId: string;
  signalId?: string;
  caseId?: string;
};

export type DiagnosisConversationBinding = {
  signalId?: string;
  caseId?: string;
  sessionKey: string;
};

function readJson(filePath: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function listLiveSessionKeys(stateDir: string): string[] {
  const agentsRoot = path.join(stateDir, "agents");
  if (!fs.existsSync(agentsRoot)) {
    return [];
  }
  const keys: string[] = [];
  for (const agent of fs.readdirSync(agentsRoot, { withFileTypes: true })) {
    if (!agent.isDirectory()) {
      continue;
    }
    const storePath = path.join(agentsRoot, agent.name, "sessions", "sessions.json");
    const parsed = readJson(storePath);
    if (!isRecord(parsed)) {
      continue;
    }
    for (const key of Object.keys(parsed)) {
      if (key.trim()) {
        keys.push(key);
      }
    }
  }
  return keys;
}

function caseSessionHash(report: Record<string, unknown>, caseId: string): string | null {
  const cases = Array.isArray(report.cases) ? report.cases : [];
  for (const item of cases) {
    if (!isRecord(item) || item.caseId !== caseId) {
      continue;
    }
    return typeof item.sessionKeyHash === "string" && item.sessionKeyHash.trim()
      ? item.sessionKeyHash
      : null;
  }
  return null;
}

export function findProjectionSessionHash(input: {
  projectionsDir: string;
  tenantId: string;
  caseId: string;
}): string | null {
  const tenantDir = path.join(input.projectionsDir, input.tenantId);
  if (!fs.existsSync(tenantDir)) {
    return null;
  }
  for (const name of fs.readdirSync(tenantDir)) {
    if (!name.endsWith(".json")) {
      continue;
    }
    const parsed = readJson(path.join(tenantDir, name));
    if (!isRecord(parsed)) {
      continue;
    }
    const hash = caseSessionHash(parsed, input.caseId);
    if (hash) {
      return hash;
    }
  }
  return null;
}

function bindingMatches(
  binding: DiagnosisConversationBinding,
  query: DiagnosisConversationLookup,
): boolean {
  if (query.signalId && binding.signalId && binding.signalId !== query.signalId) {
    return false;
  }
  if (query.caseId && binding.caseId && binding.caseId !== query.caseId) {
    return false;
  }
  const signalHit = Boolean(query.signalId && binding.signalId === query.signalId);
  const caseHit = Boolean(query.caseId && binding.caseId === query.caseId);
  return signalHit || caseHit;
}

export function resolveDiagnosisConversationSession(input: {
  tenantId: string;
  signalId?: string;
  caseId?: string;
  bindings: readonly DiagnosisConversationBinding[];
  projectionsDir: string;
  sessionKeys: readonly string[];
}): DiagnosisConversationResolution {
  const query = {
    tenantId: input.tenantId,
    signalId: input.signalId,
    caseId: input.caseId,
  };
  const binding = input.bindings.find((row) => bindingMatches(row, query));
  if (binding) {
    if (!input.sessionKeys.includes(binding.sessionKey)) {
      return { ok: false, reason: "session_key_unavailable" };
    }
    return { ok: true, sessionKey: binding.sessionKey };
  }
  if (!input.caseId) {
    return { ok: false, reason: "conversation_not_found" };
  }
  const sessionKeyHash = findProjectionSessionHash({
    projectionsDir: input.projectionsDir,
    tenantId: input.tenantId,
    caseId: input.caseId,
  });
  if (!sessionKeyHash) {
    return { ok: false, reason: "conversation_not_found" };
  }
  const sessionKey = input.sessionKeys.find((key) => hashSessionKey(key) === sessionKeyHash);
  if (!sessionKey) {
    return { ok: false, reason: "session_key_unavailable" };
  }
  return { ok: true, sessionKey };
}
