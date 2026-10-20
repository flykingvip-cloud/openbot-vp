import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "../../utils.js";
import { bindSkillInvocationRecord } from "../evolution-control/task-outcome-binding.js";
import { skillExecutionSkillName } from "../skill-execution-binding/paths.js";
import { parseSkillIdentityToolName } from "../skill-execution-binding/skill-tool-wrappers.js";
import {
  getSkillRuntimeDefinitionForBinding,
  listRobotSkillAssets,
  recordRobotSkillInvocationStats,
  recordSkillHealthSample,
} from "../skill-lifecycle-store.js";
import { recordAttributionOutcome } from "./attribution-stats.js";
import {
  appendSkillInvocationEvent,
  buildCompletedInvocationEvent,
  resolveSkillInvocationEventsPath,
} from "./event-store.js";
import type {
  RecordSkillInvocationCompletedInput,
  SkillInvocationCompletedEvent,
  SkillInvocationStartedEvent,
} from "./types.js";

const IDEMPOTENCY_DIR = "skill-invocation-events";
const IDEMPOTENCY_FILE = "seen-invocation-ids.json";
const OPEN_STARTED_FILE = "open-started.json";

type SeenIndex = { ids: string[] };
type OpenStartedMap = Record<
  string,
  { skillId: string; agentId: string; startedAt: number; runId: string | null }
>;

function resolveSeenPath(configDir: string = CONFIG_DIR): string {
  return path.join(configDir, IDEMPOTENCY_DIR, IDEMPOTENCY_FILE);
}

function resolveOpenStartedPath(configDir: string = CONFIG_DIR): string {
  return path.join(configDir, IDEMPOTENCY_DIR, OPEN_STARTED_FILE);
}

function loadSeenIds(configDir: string = CONFIG_DIR): Set<string> {
  try {
    const filePath = resolveSeenPath(configDir);
    if (!fs.existsSync(filePath)) {
      return new Set();
    }
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as SeenIndex;
    return new Set(Array.isArray(raw.ids) ? raw.ids.filter((id) => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function persistSeenIds(ids: Set<string>, configDir: string = CONFIG_DIR): void {
  const filePath = resolveSeenPath(configDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const list = [...ids].slice(-5_000);
  fs.writeFileSync(filePath, `${JSON.stringify({ ids: list }, null, 2)}\n`, "utf-8");
}

function loadOpenStarted(configDir: string = CONFIG_DIR): OpenStartedMap {
  try {
    const filePath = resolveOpenStartedPath(configDir);
    if (!fs.existsSync(filePath)) {
      return {};
    }
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as OpenStartedMap;
  } catch {
    return {};
  }
}

function persistOpenStarted(map: OpenStartedMap, configDir: string = CONFIG_DIR): void {
  const filePath = resolveOpenStartedPath(configDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(map, null, 2)}\n`, "utf-8");
}

/**
 * Emit skill_invocation_started before a real tool-matched skill use.
 */
export function recordSkillInvocationStarted(params: {
  invocationId?: string;
  skillId: string;
  skillVersion?: string;
  agentId: string;
  tenantId?: string | null;
  userId?: string | null;
  runId?: string | null;
  sessionKey?: string | null;
  startedAt?: number;
  toolCallId?: string | null;
  toolName?: string | null;
  attributionResolution?: string | null;
  configDir?: string;
}): SkillInvocationStartedEvent {
  const configDir = params.configDir ?? CONFIG_DIR;
  const skillId = params.skillId.trim();
  const agentId = params.agentId.trim();
  if (!skillId || !agentId) {
    throw new Error("skillId and agentId are required");
  }
  const invocationId = params.invocationId?.trim() || randomUUID();
  const open = loadOpenStarted(configDir);
  const seen = loadSeenIds(configDir);
  // Do not re-emit started for completed or already-open invocations (idempotent).
  if (seen.has(invocationId) || open[invocationId]) {
    const startedAt = open[invocationId]?.startedAt ?? params.startedAt ?? Date.now();
    return {
      type: "skill_invocation_started",
      invocationId,
      skillId,
      skillVersion: params.skillVersion?.trim() || "unknown",
      agentId,
      tenantId: params.tenantId ?? null,
      userId: params.userId ?? null,
      startedAt,
      runId: params.runId ?? null,
      sessionKey: params.sessionKey ?? null,
      toolCallId: params.toolCallId ?? null,
      toolName: params.toolName ?? null,
      attributionResolution: params.attributionResolution ?? null,
    };
  }
  const startedAt = params.startedAt ?? Date.now();
  const event: SkillInvocationStartedEvent = {
    type: "skill_invocation_started",
    invocationId,
    skillId,
    skillVersion: params.skillVersion?.trim() || "unknown",
    agentId,
    tenantId: params.tenantId ?? null,
    userId: params.userId ?? null,
    startedAt,
    runId: params.runId ?? null,
    sessionKey: params.sessionKey ?? null,
    toolCallId: params.toolCallId ?? null,
    toolName: params.toolName ?? null,
    attributionResolution: params.attributionResolution ?? null,
  };
  appendSkillInvocationEvent(event, configDir);
  open[invocationId] = {
    skillId,
    agentId,
    startedAt,
    runId: params.runId ?? null,
  };
  persistOpenStarted(open, configDir);
  return event;
}

/**
 * Record completed invocation. Idempotent on invocationId.
 * Prefer pairing with a prior started event for latencyMs.
 *
 * Order for resilience: append event first, then stats/health, then mark seen.
 * Retries after partial failure can re-run stats (usage may double once) rather than
 * permanently skip after seen-claim-before-write. Callers should still pass stable ids.
 */
export function recordSkillInvocationCompleted(
  input: RecordSkillInvocationCompletedInput,
  options?: { configDir?: string; persistDir?: string },
): SkillInvocationCompletedEvent {
  const configDir = options?.configDir ?? CONFIG_DIR;
  if (!input.skillId?.trim() || !input.agentId?.trim()) {
    throw new Error("skillId and agentId are required");
  }
  if (input.outcome !== "success" && input.outcome !== "failure" && input.outcome !== "cancelled") {
    throw new Error(`invalid outcome: ${String(input.outcome)}`);
  }

  const open = loadOpenStarted(configDir);
  const invocationId = input.invocationId?.trim() || randomUUID();
  const openEntry = open[invocationId];
  const startedAt = input.startedAt ?? openEntry?.startedAt;
  const completedAt = input.completedAt ?? Date.now();
  const latencyMs =
    typeof input.latencyMs === "number" && Number.isFinite(input.latencyMs)
      ? Math.max(0, input.latencyMs)
      : startedAt != null
        ? Math.max(0, completedAt - startedAt)
        : 0;

  const event = bindSkillInvocationRecord(
    buildCompletedInvocationEvent({
      ...input,
      invocationId,
      startedAt,
      completedAt,
      latencyMs,
    }),
    options?.persistDir,
  );

  const seen = loadSeenIds(configDir);
  if (seen.has(event.invocationId)) {
    return event;
  }

  // Append event first (recoverable audit trail).
  appendSkillInvocationEvent(event, configDir);

  try {
    recordRobotSkillInvocationStats({
      agentId: event.agentId,
      skillId: event.skillId,
      atMs: event.completedAt,
    });
  } catch {
    // relation may not exist
  }

  try {
    recordSkillHealthSample({
      skillId: event.skillId,
      agentId: event.agentId,
      outcome: event.outcome === "success" ? "success" : "failure",
      latencyMs: event.latencyMs,
      failureReason:
        event.outcome === "success"
          ? undefined
          : (event.failureCategory ?? event.outcome ?? "failure"),
      timestamp: event.completedAt,
    });
  } catch {
    // skill may be gone
  }

  // Mark seen only after side effects attempted (allows retry if process dies mid-way).
  seen.add(event.invocationId);
  persistSeenIds(seen, configDir);
  if (open[event.invocationId]) {
    delete open[event.invocationId];
    persistOpenStarted(open, configDir);
  }

  return event;
}

export function skillIdFromBindingSkillName(skillName: string): string | null {
  const prefix = "ob-asset-";
  if (!skillName.startsWith(prefix)) {
    return null;
  }
  const raw = skillName.slice(prefix.length).trim();
  return raw || null;
}

export type SkillSelectionResolution =
  | "selectedSkillId"
  | "tool_args"
  | "identity_tool_name"
  | "unique_owner";

export type ResolvedSkillSelection = {
  skillId: string;
  skillVersion: string;
  resolution: SkillSelectionResolution;
};

/** Extract explicit skill identity from tool arguments (preferred attribution signal). */
export function extractSelectedSkillIdFromToolArgs(args: unknown): string | null {
  if (!args || typeof args !== "object") {
    return null;
  }
  const record = args as Record<string, unknown>;
  for (const key of ["openbotSkillId", "selectedSkillId", "skillId"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function listDeclaredToolsForSkill(skillId: string, installedVersion: string): string[] {
  try {
    const bundle = getSkillRuntimeDefinitionForBinding(skillId, { version: installedVersion });
    return bundle.runtimeDefinition.tools.map((t) => t.trim().toLowerCase()).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Resolve which lifecycle skill a tool call belongs to.
 * Never attributes a shared tool (e.g. read) to every skill that declares it.
 *
 * Order:
 * 1. explicit selectedSkillId
 * 2. tool args openbotSkillId / selectedSkillId / skillId
 * 3. tool name is binding name or skill id (identity-bound tool)
 * 4. unique owner among *loaded* enabled skills that declare the tool
 * 5. otherwise null (uncounted — ambiguous)
 */
export function resolveSelectedSkillForToolCall(params: {
  agentId: string;
  toolName: string;
  /** Lifecycle binding names loaded this run (`ob-asset-*`). Required for unique-owner path. */
  loadedSkillNames?: string[];
  selectedSkillId?: string | null;
  toolArgs?: unknown;
}): ResolvedSkillSelection | null {
  const agentId = params.agentId.trim();
  const toolName = params.toolName.trim();
  if (!agentId || !toolName) {
    return null;
  }
  const toolKey = toolName.toLowerCase();
  const loaded = new Set((params.loadedSkillNames ?? []).map((n) => n.trim()).filter(Boolean));
  const restrictToLoaded = loaded.size > 0;
  const enabled = listRobotSkillAssets(agentId).filter((entry) => entry.enabled);
  const inScope = enabled.filter((entry) => {
    if (!restrictToLoaded) {
      return true;
    }
    const bindingName = skillExecutionSkillName(entry.id);
    return loaded.has(bindingName) || loaded.has(entry.id);
  });

  const pick = (
    skillId: string,
    resolution: SkillSelectionResolution,
  ): ResolvedSkillSelection | null => {
    const entry = inScope.find((e) => e.id === skillId) ?? enabled.find((e) => e.id === skillId);
    if (!entry?.enabled) {
      return null;
    }
    if (restrictToLoaded) {
      const bindingName = skillExecutionSkillName(entry.id);
      if (!loaded.has(bindingName) && !loaded.has(entry.id)) {
        return null;
      }
    }
    return {
      skillId: entry.id,
      skillVersion: entry.installedVersion,
      resolution,
    };
  };

  const explicit =
    params.selectedSkillId?.trim() || extractSelectedSkillIdFromToolArgs(params.toolArgs);
  if (explicit) {
    // Allow binding name as explicit id.
    const asSkillId = skillIdFromBindingSkillName(explicit) ?? explicit;
    const resolved = pick(
      asSkillId,
      params.selectedSkillId?.trim() ? "selectedSkillId" : "tool_args",
    );
    if (resolved) {
      return resolved;
    }
  }

  // Identity-wrapped tool: ob_sk_<skillId>__<baseTool>
  const identityParsed = parseSkillIdentityToolName(toolName);
  if (identityParsed) {
    const resolved = pick(identityParsed.skillId, "identity_tool_name");
    if (resolved) {
      return resolved;
    }
    for (const entry of inScope) {
      const safe = entry.id.replace(/[^a-zA-Z0-9_]/g, "_");
      if (safe === identityParsed.skillId || entry.id === identityParsed.skillId) {
        return {
          skillId: entry.id,
          skillVersion: entry.installedVersion,
          resolution: "identity_tool_name",
        };
      }
    }
  }

  // Identity tool name: model called the skill binding name or skill id as the tool.
  for (const entry of inScope) {
    const bindingName = skillExecutionSkillName(entry.id);
    if (toolKey === entry.id.toLowerCase() || toolKey === bindingName.toLowerCase()) {
      return {
        skillId: entry.id,
        skillVersion: entry.installedVersion,
        resolution: "identity_tool_name",
      };
    }
  }

  // Unique owner among in-scope skills that declare this base tool.
  const ownersToolKey = (identityParsed?.baseTool ?? toolKey).toLowerCase();
  const owners = inScope.filter((entry) => {
    const declared = listDeclaredToolsForSkill(entry.id, entry.installedVersion);
    return declared.includes(ownersToolKey);
  });
  if (owners.length === 1) {
    const only = owners[0];
    return {
      skillId: only.id,
      skillVersion: only.installedVersion,
      resolution: "unique_owner",
    };
  }
  // 0 or many owners → no attribution (prevents cross-skill pollution).
  return null;
}

/**
 * Explicit named use for prompt-only skills (partial / best-effort only).
 * Mere load into the system prompt is not enough.
 */
export function isPromptOnlySkillNamedInUse(params: {
  skillId: string;
  bindingName: string;
  profileName?: string | null;
  assistantTexts?: string[];
  toolsUsed?: Array<{ toolName: string }>;
}): boolean {
  const needles = [params.skillId, params.bindingName, params.profileName ?? ""]
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length >= 3);
  if (needles.length === 0) {
    return false;
  }
  for (const tool of params.toolsUsed ?? []) {
    const name = tool.toolName.trim().toLowerCase();
    if (needles.includes(name)) {
      return true;
    }
  }
  const corpus = (params.assistantTexts ?? []).join("\n").toLowerCase();
  if (!corpus) {
    return false;
  }
  return needles.some((needle) => {
    if (/^[\w-]+$/.test(needle)) {
      return new RegExp(`(?:^|[^a-z0-9_-])${escapeRegExp(needle)}(?:$|[^a-z0-9_-])`).test(corpus);
    }
    return corpus.includes(needle);
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildToolInvocationId(params: {
  runId: string;
  toolCallId?: string | null;
  skillId: string;
  toolName: string;
  index?: number;
}): string {
  const toolCallId = params.toolCallId?.trim();
  if (toolCallId) {
    // One tool call → at most one skill invocation (no multi-skill fan-out).
    return `${params.runId}:call:${toolCallId}`;
  }
  return `${params.runId}:${params.skillId}:${params.toolName}:${params.index ?? 0}`;
}

/**
 * Tool call start → skill_invocation_started (requires resolvable selected skill).
 */
export function recordLifecycleSkillToolStart(params: {
  agentId: string;
  runId: string;
  toolName: string;
  toolCallId: string;
  loadedSkillNames?: string[];
  selectedSkillId?: string | null;
  toolArgs?: unknown;
  sessionKey?: string | null;
  tenantId?: string | null;
  userId?: string | null;
  startedAt?: number;
}): SkillInvocationStartedEvent | null {
  const selection = resolveSelectedSkillForToolCall({
    agentId: params.agentId,
    toolName: params.toolName,
    loadedSkillNames: params.loadedSkillNames,
    selectedSkillId: params.selectedSkillId,
    toolArgs: params.toolArgs,
  });
  if (!selection) {
    recordAttributionOutcome("none");
    return null;
  }
  const invocationId = buildToolInvocationId({
    runId: params.runId,
    toolCallId: params.toolCallId,
    skillId: selection.skillId,
    toolName: params.toolName,
  });
  return recordSkillInvocationStarted({
    invocationId,
    skillId: selection.skillId,
    skillVersion: selection.skillVersion,
    agentId: params.agentId,
    runId: params.runId,
    sessionKey: params.sessionKey,
    tenantId: params.tenantId,
    userId: params.userId,
    startedAt: params.startedAt ?? Date.now(),
    toolCallId: params.toolCallId,
    toolName: params.toolName,
    attributionResolution: selection.resolution,
  });
}

/**
 * Tool call result → skill_invocation_completed for the single resolved skill only.
 */
export function recordLifecycleSkillToolResult(params: {
  agentId: string;
  runId: string;
  toolName: string;
  success: boolean;
  toolCallId?: string | null;
  toolIndex?: number;
  loadedSkillNames?: string[];
  selectedSkillId?: string | null;
  toolArgs?: unknown;
  sessionKey?: string | null;
  tenantId?: string | null;
  userId?: string | null;
  startedAt?: number;
}): SkillInvocationCompletedEvent[] {
  const agentId = params.agentId.trim();
  const toolName = params.toolName.trim();
  if (!agentId || !toolName) {
    return [];
  }
  const selection = resolveSelectedSkillForToolCall({
    agentId,
    toolName,
    loadedSkillNames: params.loadedSkillNames,
    selectedSkillId: params.selectedSkillId,
    toolArgs: params.toolArgs,
  });
  if (!selection) {
    recordAttributionOutcome("none");
    return [];
  }
  recordAttributionOutcome(selection.resolution);
  const startedAt = params.startedAt;
  const invocationId = buildToolInvocationId({
    runId: params.runId,
    toolCallId: params.toolCallId,
    skillId: selection.skillId,
    toolName,
    index: params.toolIndex,
  });
  // Ensure started exists (if start path was missed, open with best-effort time).
  try {
    recordSkillInvocationStarted({
      invocationId,
      skillId: selection.skillId,
      skillVersion: selection.skillVersion,
      agentId,
      runId: params.runId,
      sessionKey: params.sessionKey,
      tenantId: params.tenantId,
      userId: params.userId,
      startedAt: startedAt ?? Date.now(),
      toolCallId: params.toolCallId ?? null,
      toolName,
      attributionResolution: selection.resolution,
    });
  } catch {
    // best-effort
  }
  try {
    return [
      recordSkillInvocationCompleted({
        invocationId,
        skillId: selection.skillId,
        agentId,
        skillVersion: selection.skillVersion,
        outcome: params.success ? "success" : "failure",
        startedAt,
        completedAt: Date.now(),
        runId: params.runId,
        sessionKey: params.sessionKey ?? null,
        tenantId: params.tenantId ?? null,
        userId: params.userId ?? null,
        businessOutcome: selection.resolution,
        failureCategory: params.success ? null : "tool_error",
        toolCallId: params.toolCallId ?? null,
        toolName: params.toolName,
        attributionResolution: selection.resolution,
      }),
    ];
  } catch {
    return [];
  }
}

/**
 * End-of-run fallback attribution.
 * Prefer mid-run toolCallId path; this path uses unique-owner / explicit skill only.
 * Does not fan out one tool to multiple skills.
 */
export function recordLifecycleSkillsLoadedOnRun(params: {
  agentId: string;
  runId: string;
  skillNames: string[];
  outcome: "success" | "failure" | "cancelled";
  latencyMs?: number;
  sessionKey?: string | null;
  tenantId?: string | null;
  userId?: string | null;
  toolsUsed?: Array<{
    toolName: string;
    success?: boolean;
    toolCallId?: string;
    selectedSkillId?: string | null;
    toolArgs?: unknown;
  }>;
  /** Assistant texts for prompt-only named-use detection (partial / unreliable). */
  assistantTexts?: string[];
}): SkillInvocationCompletedEvent[] {
  const agentId = params.agentId.trim();
  if (!agentId) {
    return [];
  }
  const toolsUsed = params.toolsUsed ?? [];
  const assistantTexts = params.assistantTexts ?? [];
  if (toolsUsed.length === 0 && assistantTexts.every((t) => !t?.trim())) {
    return [];
  }

  const recorded: SkillInvocationCompletedEvent[] = [];

  // One completion per tool call (unique skill resolution).
  toolsUsed.forEach((tool, index) => {
    const events = recordLifecycleSkillToolResult({
      agentId,
      runId: params.runId,
      toolName: tool.toolName,
      success: tool.success !== false,
      toolCallId: tool.toolCallId,
      toolIndex: index,
      loadedSkillNames: params.skillNames,
      selectedSkillId: tool.selectedSkillId,
      toolArgs: tool.toolArgs,
      sessionKey: params.sessionKey,
      tenantId: params.tenantId,
      userId: params.userId,
      startedAt:
        typeof params.latencyMs === "number"
          ? Date.now() - Math.max(0, params.latencyMs)
          : undefined,
    });
    recorded.push(...events);
  });

  // Prompt-only named-use is OFF by default (unreliable). Opt-in:
  // OPENBOT_PROMPT_NAMED_USE_ATTRIBUTION=1
  const promptNamedUseEnabled =
    process.env.OPENBOT_PROMPT_NAMED_USE_ATTRIBUTION === "1" ||
    process.env.OPENBOT_PROMPT_NAMED_USE_ATTRIBUTION === "true";
  if (!promptNamedUseEnabled) {
    return recorded;
  }

  // Prompt-only: partial named-use (honest: still best-effort, not proof of selection).
  for (const entry of listRobotSkillAssets(agentId)) {
    if (!entry.enabled) {
      continue;
    }
    const bindingName = skillExecutionSkillName(entry.id);
    if (!params.skillNames.includes(bindingName) && !params.skillNames.includes(entry.id)) {
      continue;
    }
    const declared = listDeclaredToolsForSkill(entry.id, entry.installedVersion);
    if (declared.length > 0) {
      continue;
    }
    if (
      !isPromptOnlySkillNamedInUse({
        skillId: entry.id,
        bindingName,
        profileName: entry.profile?.name,
        assistantTexts,
        toolsUsed,
      })
    ) {
      continue;
    }
    try {
      const invocationId = `${params.runId}:${entry.id}:prompt_named_use`;
      recordSkillInvocationStarted({
        invocationId,
        skillId: entry.id,
        skillVersion: entry.installedVersion,
        agentId,
        runId: params.runId,
        sessionKey: params.sessionKey,
        tenantId: params.tenantId,
        userId: params.userId,
      });
      recordAttributionOutcome("prompt_named_use");
      recorded.push(
        recordSkillInvocationCompleted({
          invocationId,
          skillId: entry.id,
          agentId,
          skillVersion: entry.installedVersion,
          outcome: params.outcome,
          latencyMs: params.latencyMs,
          runId: params.runId,
          sessionKey: params.sessionKey ?? null,
          tenantId: params.tenantId ?? null,
          userId: params.userId ?? null,
          businessOutcome: "prompt_named_use",
          failureCategory: params.outcome === "success" ? null : "run_failed",
        }),
      );
    } catch {
      // best-effort
    }
  }

  return recorded;
}

export { resolveSkillInvocationEventsPath };
