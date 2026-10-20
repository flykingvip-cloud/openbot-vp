/**
 * Phase 1 increment 3.9 — read-only Agent/Tool authorities.
 * Accepts injected hook / diagnostic-event observation JSONL, or Session
 * JSONL role metadata. Never emits diagnostic-events, never appends Skill
 * Invocation, never copies prompt / params / result / message body.
 */
import fs from "node:fs";
import type { AgentRunnerRow, ToolRuntimeRow } from "./source-adapters.js";

type JsonRecord = Record<string, unknown>;

export function readJsonlRecords(filePath: string): JsonRecord[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const rows: JsonRecord[] = [];
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    if (!line.trim()) {
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(line);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        rows.push(parsed as JsonRecord);
      }
    } catch {
      // skip corrupt lines
    }
  }
  return rows;
}

export function readAgentRunnerObservations(filePath: string): AgentRunnerRow[] {
  return readJsonlRecords(filePath)
    .map((record) => agentRowFromObservation(record, filePath))
    .filter((row): row is AgentRunnerRow => row !== null);
}

export function readToolRuntimeObservations(filePath: string): ToolRuntimeRow[] {
  return readJsonlRecords(filePath)
    .map((record) => toolRowFromObservation(record, filePath))
    .filter((row): row is ToolRuntimeRow => row !== null);
}

export function readAgentRunnerFromSessionJsonl(input: {
  sessionFilePath: string;
  agentId: string;
  observedAt?: string;
}): AgentRunnerRow[] {
  const records = readJsonlRecords(input.sessionFilePath);
  const started = records.some((record) => isAgentActivityRole(roleOf(record)));
  const completed = records.some((record) => stringField(record, "type") === "agent_end");
  const errorClass = firstErrorClass(records);
  const runId = firstString(records, ["runId", "agentRunId"]);
  return [
    {
      agentId: input.agentId,
      runId,
      agentStarted: started,
      agentCompleted: completed,
      errorClass,
      observedAt: input.observedAt ?? new Date(0).toISOString(),
      authorityRecordId: `session-jsonl-agent:${input.agentId}`,
      complete: completed,
    },
  ];
}

export function readToolRuntimeFromSessionJsonl(input: {
  sessionFilePath: string;
  observedAt?: string;
}): ToolRuntimeRow[] {
  const rows: ToolRuntimeRow[] = [];
  for (const [index, record] of readJsonlRecords(input.sessionFilePath).entries()) {
    const toolName = toolNameOf(record);
    if (!toolName) {
      continue;
    }
    const errorClass = errorClassOf(record);
    rows.push({
      toolNameClass: toolName,
      timeout: isTimeoutClass(errorClass) || record.timeout === true,
      errorClass,
      latencyMs:
        numberField(record, "durationMs") ?? numberField(nestedMessage(record), "durationMs"),
      observedAt: input.observedAt ?? new Date(0).toISOString(),
      authorityRecordId: `session-jsonl-tool:${toolName}:${index}`,
      runId: stringField(record, "runId") ?? null,
      toolCallId:
        stringField(record, "toolCallId") ??
        stringField(nestedMessage(record) ?? {}, "toolCallId") ??
        null,
    });
  }
  return rows;
}

function agentRowFromObservation(record: JsonRecord, filePath: string): AgentRunnerRow | null {
  const type = stringField(record, "type");
  if (type !== "run.attempt" && type !== "before_agent_start" && type !== "agent_end") {
    return null;
  }
  const agentId = stringField(record, "agentId") ?? "unknown";
  const runId = stringField(record, "runId");
  const ended = type === "agent_end";
  const started = type === "before_agent_start" || type === "run.attempt" || ended;
  return {
    agentId,
    runId: runId ?? null,
    agentStarted: started,
    agentCompleted: ended && record.success !== false,
    errorClass: errorClassOf(record),
    observedAt: observedAtOf(record),
    authorityRecordId: `${pathBase(filePath)}:${type}:${runId ?? agentId}`,
    complete: type === "agent_end" || type === "run.attempt",
  };
}

function toolRowFromObservation(record: JsonRecord, filePath: string): ToolRuntimeRow | null {
  const type = stringField(record, "type");
  if (type !== "after_tool_call" && type !== "before_tool_call" && type !== "tool.loop") {
    return null;
  }
  const toolName = stringField(record, "toolName") ?? "unknown";
  const errorClass = errorClassOf(record);
  return {
    toolNameClass: toolName,
    timeout: record.timeout === true || isTimeoutClass(errorClass),
    errorClass,
    latencyMs: numberField(record, "durationMs"),
    observedAt: observedAtOf(record),
    authorityRecordId: `${pathBase(filePath)}:${type}:${stringField(record, "toolCallId") ?? toolName}`,
    runId: stringField(record, "runId") ?? null,
    toolCallId: stringField(record, "toolCallId") ?? null,
  };
}

function roleOf(record: JsonRecord): string | undefined {
  const message = nestedMessage(record);
  const fromMessage = message ? stringField(message, "role") : undefined;
  return fromMessage ?? stringField(record, "role");
}

function isAgentActivityRole(role: string | undefined): boolean {
  return role === "assistant" || role === "toolResult" || role === "tool";
}

function toolNameOf(record: JsonRecord): string | undefined {
  const direct = stringField(record, "toolName");
  if (direct) {
    return direct;
  }
  const message = nestedMessage(record);
  if (!message) {
    return undefined;
  }
  const named = stringField(message, "toolName") ?? stringField(message, "name");
  if (named) {
    return named;
  }
  const content = message.content;
  if (!Array.isArray(content)) {
    return undefined;
  }
  for (const part of content) {
    if (!part || typeof part !== "object") {
      continue;
    }
    const block = part as JsonRecord;
    const blockType = stringField(block, "type");
    if (blockType === "tool_use" || blockType === "toolCall" || blockType === "tool_call") {
      return stringField(block, "name");
    }
  }
  return undefined;
}

function nestedMessage(record: JsonRecord): JsonRecord | undefined {
  const message = record.message;
  if (message && typeof message === "object" && !Array.isArray(message)) {
    return message as JsonRecord;
  }
  return undefined;
}

function errorClassOf(record: JsonRecord): string | null {
  const raw = record.error ?? nestedMessage(record)?.error;
  if (typeof raw === "string") {
    return /timeout/i.test(raw) ? "timeout" : "error";
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const classified =
      stringField(raw as JsonRecord, "class") ?? stringField(raw as JsonRecord, "name");
    return classified ?? "error";
  }
  if (record.timeout === true || nestedMessage(record)?.is_error === true) {
    return record.timeout === true ? "timeout" : "error";
  }
  return null;
}

function firstErrorClass(records: readonly JsonRecord[]): string | null {
  for (const record of records) {
    const errorClass = errorClassOf(record);
    if (errorClass) {
      return errorClass;
    }
  }
  return null;
}

function firstString(records: readonly JsonRecord[], keys: readonly string[]): string | null {
  for (const record of records) {
    for (const key of keys) {
      const value = stringField(record, key) ?? stringField(nestedMessage(record) ?? {}, key);
      if (value) {
        return value;
      }
    }
  }
  return null;
}

function isTimeoutClass(errorClass: string | null): boolean {
  return typeof errorClass === "string" && /timeout/i.test(errorClass);
}

function stringField(record: JsonRecord, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberField(record: JsonRecord | undefined, key: string): number | null {
  if (!record) {
    return null;
  }
  const value = record[key];
  return typeof value === "number" ? value : null;
}

function observedAtOf(record: JsonRecord): string {
  const ts = record.ts;
  if (typeof ts === "number") {
    return new Date(ts).toISOString();
  }
  return stringField(record, "observedAt") ?? new Date(0).toISOString();
}

function pathBase(filePath: string): string {
  const slash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return slash >= 0 ? filePath.slice(slash + 1) : filePath;
}
