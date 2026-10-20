/**
 * Phase 1 store readers.
 * Skill: `readSkillInvocationEvents` (never `appendSkillInvocationEvent`).
 * Session: JSONL metadata only (role/count). Never copies message body.
 * 3.9: Agent/Tool come from injected hook/diagnostic-event observations or
 * Session JSONL roles — not fixture projection when those stores are set.
 */
import fs from "node:fs";
import { readSkillInvocationEvents } from "../gateway/skill-invocation/event-store.js";
import type { SkillInvocationEvent } from "../gateway/skill-invocation/types.js";
import type { DiagnosisEvidenceAdapter } from "./adapters.js";
import {
  readAgentRunnerFromSessionJsonl,
  readAgentRunnerObservations,
  readToolRuntimeFromSessionJsonl,
  readToolRuntimeObservations,
} from "./runtime-observations.js";
import {
  createPartialSourceAdapters,
  projectPartialRows,
  type PartialSourceBundle,
  type SessionStoreRow,
  type SkillInvocationSourceRow,
} from "./source-adapters.js";
import type { DiagnosticEvidence } from "./types.js";

export type DiagnosisStorePaths = {
  skillConfigDir?: string;
  observedSinceMs?: number;
  sessionFile?: {
    sessionFilePath: string;
    sessionId: string;
    sessionKeyHash: string;
    agentId: string;
    observedAt?: string;
  };
  agentObservationFile?: string;
  toolObservationFile?: string;
};

export function resolvePartialSourceBundle(input: {
  evidences: readonly DiagnosticEvidence[];
  stores?: DiagnosisStorePaths;
}): PartialSourceBundle {
  const projected = projectPartialRows(input.evidences);
  if (!input.stores) {
    return projected;
  }
  const sessionRow = input.stores.sessionFile
    ? readSessionStoreMetadata(input.stores.sessionFile)
    : undefined;
  return {
    ...projected,
    session: input.stores.sessionFile ? (sessionRow ? [sessionRow] : []) : projected.session,
    skillInvocation: input.stores.skillConfigDir
      ? readSkillInvocationStoreRows({
          configDir: input.stores.skillConfigDir,
          observedSinceMs: input.stores.observedSinceMs,
        })
      : projected.skillInvocation,
    agentRunner: resolveAgentRunner(projected, input.stores),
    toolRuntime: resolveToolRuntime(projected, input.stores),
  };
}

function resolveAgentRunner(
  projected: PartialSourceBundle,
  stores: DiagnosisStorePaths,
): PartialSourceBundle["agentRunner"] {
  if (stores.agentObservationFile) {
    return readAgentRunnerObservations(stores.agentObservationFile);
  }
  if (stores.sessionFile) {
    return readAgentRunnerFromSessionJsonl(stores.sessionFile);
  }
  return projected.agentRunner;
}

function resolveToolRuntime(
  projected: PartialSourceBundle,
  stores: DiagnosisStorePaths,
): PartialSourceBundle["toolRuntime"] {
  if (stores.toolObservationFile) {
    return readToolRuntimeObservations(stores.toolObservationFile);
  }
  if (stores.sessionFile) {
    return readToolRuntimeFromSessionJsonl(stores.sessionFile);
  }
  return projected.toolRuntime;
}

export function createStoreBackedAdapters(input: {
  evidences: readonly DiagnosticEvidence[];
  stores?: DiagnosisStorePaths;
}): DiagnosisEvidenceAdapter[] {
  return createPartialSourceAdapters(resolvePartialSourceBundle(input));
}

export function skillRowsFromInvocationEvents(
  events: readonly SkillInvocationEvent[],
): SkillInvocationSourceRow[] {
  return events.map((event) => ({
    invocationId: event.invocationId,
    skillId: event.skillId,
    skillVersion: event.skillVersion,
    agentId: event.agentId,
    runId: event.runId,
    sessionKey: event.sessionKey,
    outcome: event.type === "skill_invocation_completed" ? event.outcome : null,
    latencyMs: event.type === "skill_invocation_completed" ? event.latencyMs : null,
    toolName: event.toolName ?? null,
    skillStarted: true,
    attributionResolution: event.attributionResolution,
    observedAt: new Date(event.startedAt).toISOString(),
  }));
}

export function readSkillInvocationStoreRows(params: {
  configDir: string;
  skillId?: string;
  agentId?: string;
  observedSinceMs?: number;
}): SkillInvocationSourceRow[] {
  const events = readSkillInvocationEvents(params);
  const since = params.observedSinceMs;
  const filtered =
    typeof since === "number" ? events.filter((event) => event.startedAt >= since) : events;
  return skillRowsFromInvocationEvents(filtered);
}

export function readSessionStoreMetadata(input: {
  sessionFilePath: string;
  sessionId: string;
  sessionKeyHash: string;
  agentId: string;
  observedAt?: string;
}): SessionStoreRow | null {
  if (!fs.existsSync(input.sessionFilePath)) {
    return null;
  }
  const lines = fs.readFileSync(input.sessionFilePath, "utf8").split("\n");
  let userMessages = 0;
  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as {
        type?: string;
        message?: { role?: string };
        role?: string;
      };
      const role = parsed.message?.role ?? parsed.role;
      if (parsed.type === "message" && role === "user") {
        userMessages += 1;
      }
    } catch {
      // skip corrupt lines
    }
  }
  return {
    sessionId: input.sessionId,
    sessionKeyHash: input.sessionKeyHash,
    agentId: input.agentId,
    messageReceived: userMessages > 0,
    retryCount: Math.max(0, userMessages - 1),
    observedAt: input.observedAt ?? new Date(0).toISOString(),
    authorityRecordId: `session-jsonl:${input.sessionKeyHash}`,
  };
}
