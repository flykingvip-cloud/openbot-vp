import { createHash, randomUUID } from "node:crypto";
import type { ConversationEntrypoint, LinkQuality } from "./types.js";
import { ENTRYPOINTS } from "./types.js";

const DIAGNOSTIC_RUN_PREFIX = "diag-";

export function tenantHash16(tenantId: string): string {
  return createHash("sha256").update(tenantId).digest("hex").slice(0, 16);
}

export function createEvaluationEventId(): string {
  return randomUUID();
}

export function hashConversationKey(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function isDiagnosticReplayRunId(runId: string, data?: Record<string, unknown>): boolean {
  const id = runId.trim();
  if (id.startsWith(DIAGNOSTIC_RUN_PREFIX)) {
    return true;
  }
  if (data && typeof data.diagnosedAgentRunId === "string") {
    return true;
  }
  return false;
}

export function classifyLinkQuality(runId: string, forced?: LinkQuality): LinkQuality {
  if (forced === "weak") {
    return "weak";
  }
  const id = runId.trim();
  if (!id || id.startsWith("weak:")) {
    return "weak";
  }
  return "strong";
}

export function weakFallbackRunId(input: {
  conversationId: string;
  startedAt: number;
  agentId: string;
}): string {
  const material = `${input.conversationId}\0${input.startedAt}\0${input.agentId}`;
  return `weak:${createHash("sha256").update(material).digest("hex").slice(0, 24)}`;
}

export function readAttempt(data: Record<string, unknown>): number | undefined {
  const value = data.attempt;
  if (typeof value === "number" && Number.isInteger(value) && value >= 1) {
    return value;
  }
  return undefined;
}

export function agentIdFromSessionKey(sessionKey: string | undefined): string | null {
  if (!sessionKey?.startsWith("agent:")) {
    return null;
  }
  const agentId = sessionKey.split(":")[1]?.trim();
  return agentId || null;
}

export function roundIdFromCollabRun(runId: string): string | undefined {
  const colon = runId.lastIndexOf(":");
  if (colon <= 0) {
    return undefined;
  }
  const suffix = runId.slice(colon + 1);
  if (!suffix || suffix === "user") {
    return undefined;
  }
  return runId.slice(0, colon);
}

function isEntrypoint(value: unknown): value is ConversationEntrypoint {
  return typeof value === "string" && (ENTRYPOINTS as readonly string[]).includes(value);
}

export function classifyEntrypoint(input: {
  runId: string;
  sessionKey?: string;
  sawDispatch: boolean;
  entrypointHint?: unknown;
}): ConversationEntrypoint {
  const sessionKey = input.sessionKey ?? "";
  if (sessionKey.includes(":subagent:")) {
    return "subagent";
  }
  if (roundIdFromCollabRun(input.runId)) {
    return "collab-bot";
  }
  if (isEntrypoint(input.entrypointHint)) {
    return input.entrypointHint;
  }
  if (input.sawDispatch) {
    return "gateway-chat";
  }
  return "cli";
}

/** Higher rank wins. Unknown shapes rank as 0 and cannot replace a ranked version. */
export function ruleVersionRank(ruleVersion: string): number {
  const match = /(\d+)\.(\d+)$/.exec(ruleVersion.trim());
  if (!match) {
    return 0;
  }
  return Number(match[1]) * 1000 + Number(match[2]);
}

export function safeRunFileName(runId: string): string {
  const cleaned = runId.replace(/[^A-Za-z0-9._:-]/g, "_");
  if (!cleaned || cleaned === "." || cleaned === ".." || cleaned.length > 180) {
    return createHash("sha256").update(runId).digest("hex").slice(0, 32);
  }
  return cleaned;
}
