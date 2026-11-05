import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { createSubsystemLogger } from "../../../logging/subsystem.js";
import type {
  CompileContextParams,
  CompileContextResult,
  ContextCandidates,
  ContextDropReason,
  ContextUnit,
  ContextUnitKind,
  MemoryProfileEntry,
} from "../../contracts/context.js";
import { seedActiveTaskFromMessages } from "./active-task-seed.js";
import {
  assertToolTransactionIntegrity,
  flattenContextUnits,
  groupContextUnits,
} from "./atomic-units.js";
import {
  projectUnitMessagesRetainMemberConclusions,
  resolveCollabGroupMaxRecentTurns,
} from "./collab-compile-strategy.js";
import { resolveLaneBudget, TOKEN_ESTIMATE_SAFETY_MARGIN } from "./lane-budget.js";
import { CHARS_PER_TOKEN_ESTIMATE } from "./message-size.js";
import { normalizeCompiledMessages } from "./normalize-outbound.js";
import {
  projectUnitMessages,
  unitHasToolTransaction,
  unitUserRequestPreview,
} from "./shrink-unit.js";

const log = createSubsystemLogger("context-compiler");

export const COMPILED_CONTEXT_CAPSULE_MARKER =
  "[Compiled operating context — not a user utterance]";

type WorkingUnit = {
  kind: ContextUnitKind;
  messages: AgentMessage[];
  digested: boolean;
};

function estimateMessageChars(message: AgentMessage): number {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") {
    return content.length;
  }
  try {
    const serialized = JSON.stringify(message);
    return typeof serialized === "string" ? serialized.length : 0;
  } catch {
    return 256;
  }
}

export function estimateMessagesTokens(messages: AgentMessage[]): number {
  const chars = messages.reduce((sum, message) => sum + estimateMessageChars(message), 0);
  return Math.max(1, Math.ceil(chars / CHARS_PER_TOKEN_ESTIMATE));
}

function conservativeTokens(estimated: number): number {
  return Math.ceil(estimated * TOKEN_ESTIMATE_SAFETY_MARGIN);
}

function formatProfileLine(entry: MemoryProfileEntry): string {
  const previous = entry.previousValue ? ` previous=${entry.previousValue}` : "";
  return `${entry.key}=${entry.value} (source=${entry.source} v${entry.version}${previous})`;
}

function asProfileEntries(entries: unknown): MemoryProfileEntry[] {
  return Array.isArray(entries) ? entries : [];
}

function asCandidateText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function sanitizeCandidates(
  candidates: ContextCandidates | undefined,
): ContextCandidates | undefined {
  if (!candidates) {
    return undefined;
  }
  return {
    userProfile: asProfileEntries(candidates.userProfile),
    task: asCandidateText(candidates.task),
    memory: asCandidateText(candidates.memory),
    evidence: asCandidateText(candidates.evidence),
  };
}

export function buildOperatingContextCapsule(candidates: ContextCandidates | undefined): string {
  const safe = sanitizeCandidates(candidates);
  if (!safe) {
    return "";
  }
  const lines: string[] = [];
  if (safe.userProfile.length > 0) {
    lines.push("user_profile:");
    for (const entry of safe.userProfile) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      lines.push(`- ${formatProfileLine(entry)}`);
    }
  }
  if (safe.task.trim()) {
    lines.push("active_task:");
    lines.push(safe.task.trim());
  }
  if (safe.memory.trim()) {
    lines.push("memory:");
    lines.push(safe.memory.trim());
  }
  if (safe.evidence.trim()) {
    lines.push("evidence:");
    lines.push(safe.evidence.trim());
  }
  if (lines.length === 0) {
    return "";
  }
  return `${COMPILED_CONTEXT_CAPSULE_MARKER}\n${lines.join("\n")}`;
}

function capsuleMessage(text: string): AgentMessage {
  return {
    role: "user",
    content: text,
    timestamp: Date.now(),
  } as AgentMessage;
}

function lastUserMessage(messages: AgentMessage[]): AgentMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if ((messages[i] as { role?: unknown }).role === "user") {
      return messages[i];
    }
  }
  return undefined;
}

function sameMessage(a: AgentMessage | undefined, b: AgentMessage | undefined): boolean {
  return Boolean(a && b && a === b);
}

function sameMessageList(left: AgentMessage[], right: AgentMessage[]): boolean {
  return left.length === right.length && left.every((message, index) => message === right[index]);
}

function resolveCandidates(
  messages: AgentMessage[],
  raw: ContextCandidates | undefined,
): ContextCandidates | undefined {
  const candidates = sanitizeCandidates(raw);
  const provided = candidates?.task.trim() ?? "";
  if (provided) {
    return candidates;
  }
  const seeded = seedActiveTaskFromMessages(messages);
  if (!seeded) {
    return candidates;
  }
  if (!candidates) {
    return { userProfile: [], task: seeded, memory: "", evidence: "" };
  }
  return { ...candidates, task: seeded };
}

function toWorking(unit: ContextUnit): WorkingUnit {
  return { kind: unit.kind, messages: unit.messages, digested: false };
}

function asContextUnits(work: WorkingUnit[]): ContextUnit[] {
  return work.map((unit) => ({ kind: unit.kind, messages: unit.messages }));
}

/**
 * Sole authority for outbound model context.
 * Candidates in, budgeted atomic units + operating capsule out.
 * Does not mutate the input array or durable history.
 */
export function compileModelContext(params: CompileContextParams): CompileContextResult {
  const started = Date.now();
  const source = Array.isArray(params.messages) ? params.messages : [];
  const budget = resolveLaneBudget(params.lane, params.contextWindowTokens);
  const collabStrategy = params.collabCompileStrategy;
  const collabEnabled = Boolean(collabStrategy?.enabled);
  const maxRecentTurns =
    params.maxRecentTurns ??
    collabStrategy?.maxRecentTurns ??
    (collabEnabled ? resolveCollabGroupMaxRecentTurns(params.lane) : budget.maxRecentTurns);
  const retainMemberConclusions =
    collabEnabled && collabStrategy?.retainMemberConclusions !== false;
  const dropReasons: ContextDropReason[] = [];
  const candidates = resolveCandidates(source, params.candidates);

  const units = groupContextUnits(source);
  const windowed: ContextUnit[] =
    units.length <= maxRecentTurns ? [...units] : units.slice(-maxRecentTurns);
  if (units.length > windowed.length) {
    dropReasons.push({
      type: "recent_turn",
      reason: "window",
      priority: 30,
    });
    const droppedUserTexts = units
      .slice(0, units.length - windowed.length)
      .map((unit) => unitUserRequestPreview(unit.messages))
      .filter((text): text is string => Boolean(text));
    if (droppedUserTexts.length > 0) {
      log.info("context compiler dropped a unit that contains a user request", {
        runId: params.runId,
        lane: params.lane,
        reason: "window",
        count: droppedUserTexts.length,
        userText: droppedUserTexts[droppedUserTexts.length - 1],
      });
    }
  }

  const capsuleText = buildOperatingContextCapsule(candidates);
  const capsule = capsuleText ? capsuleMessage(capsuleText) : undefined;

  const estimateCompiled = (kept: WorkingUnit[]): number => {
    const msgs = flattenContextUnits(asContextUnits(kept));
    const withCapsule = capsule ? [capsule, ...msgs] : msgs;
    return conservativeTokens(estimateMessagesTokens(withCapsule));
  };

  let kept = windowed.map(toWorking);
  const overBudget = (): boolean => estimateCompiled(kept) > budget.admissionBudgetTokens;

  const noteUserRequest = (
    messages: AgentMessage[],
    action: "shrunk" | "dropped",
    meta: Record<string, unknown>,
  ): void => {
    const userText = unitUserRequestPreview(messages);
    if (!userText) {
      return;
    }
    log.info(
      action === "shrunk"
        ? "context compiler shrunk a unit that contains a user request"
        : "context compiler dropped a unit that contains a user request",
      {
        runId: params.runId,
        lane: params.lane,
        userText,
        ...meta,
      },
    );
  };

  while (overBudget()) {
    const index = kept.findIndex((unit) => !unit.digested && unitHasToolTransaction(unit.messages));
    if (index < 0) {
      break;
    }
    const current = kept[index];
    if (!current) {
      break;
    }
    const digested = projectUnitMessages(current.messages, "digest");
    if (digested.length === 0) {
      noteUserRequest(current.messages, "dropped", { reason: "budget", phase: "digest" });
      dropReasons.push({ type: "recent_turn", reason: "budget", priority: 30 });
      kept.splice(index, 1);
      continue;
    }
    if (!sameMessageList(digested, current.messages)) {
      noteUserRequest(current.messages, "shrunk", { reason: "budget", phase: "digest" });
      dropReasons.push({ type: "recent_turn", reason: "shrunk", priority: 30 });
    }
    kept[index] = { ...current, messages: digested, digested: true };
  }

  // Digests are exhausted before a whole unit is dropped. User text and the
  // final reply stay; only the short tool digests are removed, oldest first.
  let stripIndex = 0;
  while (overBudget() && stripIndex < kept.length) {
    const current = kept[stripIndex];
    if (!current) {
      break;
    }
    const stripped = retainMemberConclusions
      ? projectUnitMessagesRetainMemberConclusions(current.messages)
      : projectUnitMessages(current.messages, "user-and-final");
    if (!sameMessageList(stripped, current.messages) && stripped.length > 0) {
      noteUserRequest(current.messages, "shrunk", { reason: "budget", phase: "strip" });
      dropReasons.push({ type: "recent_turn", reason: "shrunk", priority: 30 });
      kept[stripIndex] = { ...current, messages: stripped, digested: true };
    }
    stripIndex += 1;
  }

  // Current turn, and the previous turn's user text + final reply, stay.
  const minimumKept = (): number => (kept.length >= 2 ? 2 : kept.length);
  while (overBudget() && kept.length > minimumKept()) {
    const dropped = kept[0];
    if (!dropped) {
      break;
    }
    noteUserRequest(dropped.messages, "dropped", { reason: "budget", phase: "drop" });
    dropReasons.push({ type: "recent_turn", reason: "budget", priority: 30 });
    kept = kept.slice(1);
  }

  const compiledUnits = asContextUnits(kept);
  const compiledTurns = flattenContextUnits(compiledUnits);
  const compiledRaw = capsule ? [capsule, ...compiledTurns] : compiledTurns;
  const currentUser = lastUserMessage(source);
  const compiledHasCurrent = compiledRaw.some((message) => sameMessage(message, currentUser));
  const compiled = normalizeCompiledMessages(compiledRaw);
  const taskText = candidates?.task?.trim() ?? "";

  const telemetry = {
    runId: params.runId,
    lane: params.lane,
    preCompileMessageCount: source.length,
    postCompileMessageCount: compiled.length,
    preCompileEstimatedTokens: estimateMessagesTokens(source),
    postCompileEstimatedTokens: estimateMessagesTokens(compiled),
    admissionBudgetTokens: budget.admissionBudgetTokens,
    targetBudgetTokens: budget.targetTokens,
    unitCountBefore: units.length,
    unitCountAfter: kept.length,
    contextDropReasons: dropReasons,
    recallSafety: {
      currentTurnPreserved: !currentUser || compiledHasCurrent,
      activeTaskPreserved: !taskText || capsuleText.includes("active_task"),
      toolTransactionIntegrity: assertToolTransactionIntegrity(compiledTurns),
      requiredMemoryPreserved:
        !candidates || candidates.userProfile.length === 0 || capsuleText.includes("user_profile"),
    },
    compileMs: Math.max(0, Date.now() - started),
  };

  return { messages: compiled, telemetry };
}
