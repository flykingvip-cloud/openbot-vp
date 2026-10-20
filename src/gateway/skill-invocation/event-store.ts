import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "../../utils.js";
import type {
  RecordSkillInvocationCompletedInput,
  SkillInvocationCompletedEvent,
  SkillInvocationEvent,
} from "./types.js";

const EVENTS_DIR_NAME = "skill-invocation-events";
const EVENTS_FILE_NAME = "events.jsonl";

export function resolveSkillInvocationEventsPath(configDir: string = CONFIG_DIR): string {
  return path.join(configDir, EVENTS_DIR_NAME, EVENTS_FILE_NAME);
}

export function appendSkillInvocationEvent(
  event: SkillInvocationEvent,
  configDir: string = CONFIG_DIR,
): void {
  const filePath = resolveSkillInvocationEventsPath(configDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(event)}\n`, "utf8");
}

export function readSkillInvocationEvents(params?: {
  configDir?: string;
  skillId?: string;
  agentId?: string;
  limit?: number;
}): SkillInvocationEvent[] {
  const filePath = resolveSkillInvocationEventsPath(params?.configDir ?? CONFIG_DIR);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const lines = fs.readFileSync(filePath, "utf8").split("\n").filter(Boolean);
  const limit = params?.limit && params.limit > 0 ? params.limit : lines.length;
  const selected = lines.slice(Math.max(0, lines.length - limit));
  const events: SkillInvocationEvent[] = [];
  for (const line of selected) {
    try {
      const parsed = JSON.parse(line) as SkillInvocationEvent;
      if (params?.skillId && parsed.skillId !== params.skillId) {
        continue;
      }
      if (params?.agentId && parsed.agentId !== params.agentId) {
        continue;
      }
      events.push(parsed);
    } catch {
      // skip corrupt lines
    }
  }
  return events;
}

export function buildCompletedInvocationEvent(
  input: RecordSkillInvocationCompletedInput,
): SkillInvocationCompletedEvent {
  const completedAt = input.completedAt ?? Date.now();
  const startedAt = input.startedAt ?? completedAt;
  return {
    type: "skill_invocation_completed",
    invocationId: input.invocationId?.trim() || randomUUID(),
    skillId: input.skillId.trim(),
    skillVersion: input.skillVersion?.trim() || "unknown",
    agentId: input.agentId.trim(),
    tenantId: input.tenantId ?? null,
    userId: input.userId ?? null,
    startedAt,
    completedAt,
    outcome: input.outcome,
    latencyMs: Math.max(0, input.latencyMs ?? Math.max(0, completedAt - startedAt)),
    failureCategory: input.failureCategory ?? null,
    runId: input.runId ?? null,
    sessionKey: input.sessionKey ?? null,
    businessOutcome: input.businessOutcome ?? null,
    toolCallId: input.toolCallId ?? null,
    toolName: input.toolName ?? null,
    attributionResolution: input.attributionResolution ?? null,
    ...(input.experimentId ? { experimentId: input.experimentId } : {}),
    ...(input.applicationId ? { applicationId: input.applicationId } : {}),
    ...(input.taskId ? { taskId: input.taskId } : {}),
  };
}
