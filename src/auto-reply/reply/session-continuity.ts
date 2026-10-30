import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { formatActiveSkillGlossary } from "../../agents/skill-gates/glossary.js";
import { TASK_SURFACE_CONTINUITY_LINE } from "../../agents/task-surface/surface.js";
import { TURN_COMPLETION_CONTINUITY_LINE } from "../../agents/turn-completion/contract.js";
import type { OpenBotConfig } from "../../config/config.js";
import type { SessionEntry } from "../../config/sessions.js";
import { resolveGroupCollaborationPaths } from "../../gateway/collaboration-learning/collaboration-paths.js";
import { writeFileWithinRoot } from "../../infra/fs-safe.js";
import { createContentAddressedSnapshotStore } from "../../infra/workspace-snapshot/content-addressed-store.js";
import type { WorkspaceSnapshotRef } from "../../infra/workspace-snapshot/types.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { truncateUtf16Safe } from "../../utils.js";
import {
  emptyRestoreTaskReconciliation,
  isRestoreTaskIsolationMessage,
  reconcileRestoreTaskPointersReadOnly,
  stripRestorePendingReviewFences,
  type RestoreTaskReconciliation,
} from "./restore-task-isolation.js";

const log = createSubsystemLogger("session-continuity");

export type MemoryScope = "agent" | "group" | "user";
export type TaskStatus = "active" | "paused" | "done";
export type ArtifactKind = "doc" | "ppt" | "report";

export type TaskProjectState = {
  customer?: string;
  deal_stage?: string;
  owner_human?: string;
  goals?: string[];
};

export type TaskDecisionRecord = {
  id: string;
  text: string;
  at: string;
  by?: string;
};

export type TaskLedgerEntry = {
  id: string;
  scope: Extract<MemoryScope, "agent" | "group">;
  owner_id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority?: number;
  project?: TaskProjectState;
  decisions?: TaskDecisionRecord[];
  context: {
    key_points: string[];
    constraints?: string[];
  };
  artifacts: string[];
  session_ids?: string[];
  last_session_id: string;
  updated_at: string;
  /**
   * Batch 7: user keep-only removed this row from the hang surface.
   * Not a file-exists auto-close. Injectors must skip it.
   */
  surface_disposition?: "cancelled";
};

/** Link state between an artifact and its task_id. Missing/legacy => active. */
export type ArtifactLinkState = "active" | "detached" | "archived";

export type ArtifactLedgerEntry = {
  id: string;
  title: string;
  type: ArtifactKind;
  /**
   * Owning task id when bound to a real task_ledger row.
   * Absent/undefined = unbound (Sprint-2: do not mint synthetic unassigned ids).
   * Preserved after detach for history when previously bound.
   */
  task_id?: string;
  source_session: string;
  version: number;
  updated_at: string;
  summary: string;
  /**
   * Artifact↔task link state. Absent on legacy rows — readers must treat
   * missing as `active` (see resolveArtifactLinkState).
   * Reserved contract: active | detached | archived.
   */
  state?: ArtifactLinkState;
  /** ISO timestamp when the link was detached (terminal task). */
  detached_at?: string;
  /** task_id captured at detach time (history; equals task_id when preserved). */
  detached_from_task_id?: string;
  /** Why the link was detached (e.g. task_terminal / task_done / task_closed). */
  detached_reason?: string;
};

/** Resolve link state with backward-compatible default for legacy rows. */
export function resolveArtifactLinkState(
  entry: Pick<ArtifactLedgerEntry, "state"> | null | undefined,
): ArtifactLinkState {
  const state = entry?.state;
  if (state === "detached" || state === "archived") {
    return state;
  }
  return "active";
}

export function isActiveArtifactLink(
  entry: Pick<ArtifactLedgerEntry, "state"> | null | undefined,
): boolean {
  return resolveArtifactLinkState(entry) === "active";
}

/**
 * Resolve a session-bound task id only when it exists in task_ledger and is active.
 * Returns undefined when unbound — callers must not invent a synthetic fallback.
 */
export function resolveActiveBoundTaskId(params: {
  taskContextId?: string | null;
  taskLedgerItems: ReadonlyArray<Pick<TaskLedgerEntry, "id" | "status">>;
}): string | undefined {
  const taskId = params.taskContextId?.trim();
  if (!taskId) {
    return undefined;
  }
  const match = params.taskLedgerItems.find(
    (task) => task.id === taskId && task.status === "active",
  );
  return match?.id;
}

/** Why an active artifact link is considered dangling relative to task_ledger. */
export type ActiveDanglingReason = "missing_task" | "non_active_task";

export type ActiveDanglingArtifact = {
  artifactId: string;
  taskId: string;
  reason: ActiveDanglingReason;
  /** Present when the task row exists but is not active. */
  taskStatus?: string;
};

/**
 * Sprint-4 / CI hygiene: find active artifact links that dangle.
 *
 * An artifact whose resolved link state is `active` must not point at a
 * missing task_id or a non-active task. Unbound artifacts (absent/empty
 * task_id) and non-active links (detached/archived) are not dangling.
 * Pure helper — no I/O; safe to call from unit tests / CI asserts.
 */
export function findActiveDanglingArtifacts(params: {
  artifactLedger: ReadonlyArray<Pick<ArtifactLedgerEntry, "id" | "task_id" | "state">>;
  taskLedger: ReadonlyArray<Pick<TaskLedgerEntry, "id" | "status">>;
}): ActiveDanglingArtifact[] {
  const tasksById = new Map(params.taskLedger.map((task) => [task.id, task]));
  const dangling: ActiveDanglingArtifact[] = [];
  for (const artifact of params.artifactLedger) {
    if (!isActiveArtifactLink(artifact)) {
      continue;
    }
    const taskId = artifact.task_id?.trim();
    if (!taskId) {
      // Sprint-2 unbound: active + no task_id is intentional, not dangling.
      continue;
    }
    const task = tasksById.get(taskId);
    if (!task) {
      dangling.push({ artifactId: artifact.id, taskId, reason: "missing_task" });
      continue;
    }
    if (task.status !== "active") {
      dangling.push({
        artifactId: artifact.id,
        taskId,
        reason: "non_active_task",
        taskStatus: task.status,
      });
    }
  }
  return dangling;
}

/** Throw when any active dangling artifact links are present (CI assert). */
export function assertNoActiveDanglingArtifacts(params: {
  artifactLedger: ReadonlyArray<Pick<ArtifactLedgerEntry, "id" | "task_id" | "state">>;
  taskLedger: ReadonlyArray<Pick<TaskLedgerEntry, "id" | "status">>;
}): void {
  const dangling = findActiveDanglingArtifacts(params);
  if (dangling.length === 0) {
    return;
  }
  const detail = dangling
    .map((item) => {
      const statusPart = item.taskStatus ? ` status=${item.taskStatus}` : "";
      return `${item.artifactId}->${item.taskId} (${item.reason}${statusPart})`;
    })
    .join("; ");
  throw new Error(`active dangling artifacts forbidden: ${detail}`);
}

/** Sprint-5 GC: why an active dangling artifact link was detached. */
export type ActiveDanglingGcReason = "gc_task_missing" | "gc_task_not_active";

export type ActiveDanglingGcDetach = {
  artifactId: string;
  taskId: string;
  reason: ActiveDanglingGcReason;
};

export type DetachActiveDanglingArtifactsResult = {
  /** Next artifact ledger items (same length/order; only violators mutated). */
  items: ArtifactLedgerEntry[];
  /** Count of artifacts detached in this pass. */
  detachedCount: number;
  /** Per-artifact detach details for this pass. */
  detached: ActiveDanglingGcDetach[];
};

function toActiveDanglingGcReason(reason: ActiveDanglingReason): ActiveDanglingGcReason {
  return reason === "missing_task" ? "gc_task_missing" : "gc_task_not_active";
}

/**
 * Sprint-5: pure GC — detach active dangling artifact↔task links.
 *
 * Targets artifacts whose resolved state is `active` with a non-empty
 * `task_id` that is missing from `taskLedger` or whose task `status` is not
 * `"active"` (via {@link findActiveDanglingArtifacts}). Sets `state:
 * "detached"`, `detached_at`, `detached_reason` (`gc_task_missing` /
 * `gc_task_not_active`), and `detached_from_task_id`, while preserving
 * historical `task_id`. Does not touch unbound (no task_id), already
 * detached, or archived rows. Idempotent: a second pass detaches nothing.
 * Pure helper — no I/O; callers decide whether to persist.
 */
export function detachActiveDanglingArtifacts(params: {
  artifactLedger: ReadonlyArray<ArtifactLedgerEntry>;
  taskLedger: ReadonlyArray<Pick<TaskLedgerEntry, "id" | "status">>;
  /** ISO timestamp applied to detached rows (default: now). */
  now?: string;
}): DetachActiveDanglingArtifactsResult {
  const dangling = findActiveDanglingArtifacts({
    artifactLedger: params.artifactLedger,
    taskLedger: params.taskLedger,
  });
  if (dangling.length === 0) {
    return {
      items: [...params.artifactLedger],
      detachedCount: 0,
      detached: [],
    };
  }
  const now = params.now ?? new Date().toISOString();
  const byId = new Map(dangling.map((item) => [item.artifactId, item]));
  const detached: ActiveDanglingGcDetach[] = [];
  const items = params.artifactLedger.map((entry) => {
    const hit = byId.get(entry.id);
    if (!hit) {
      return entry;
    }
    const reason = toActiveDanglingGcReason(hit.reason);
    detached.push({
      artifactId: hit.artifactId,
      taskId: hit.taskId,
      reason,
    });
    return {
      ...entry,
      state: "detached" as const,
      detached_at: now,
      detached_from_task_id: hit.taskId,
      detached_reason: reason,
      updated_at: now,
    } satisfies ArtifactLedgerEntry;
  });
  return {
    items,
    detachedCount: detached.length,
    detached,
  };
}

/**
 * Sprint-4: build a contextual artifact_ledger summary from title/type/task
 * title snippet. Prefer this over pure placeholders like
 * `Referenced during session …`. Readers treat summary as opaque text, so
 * legacy placeholder strings remain backward-compatible.
 */
export function buildArtifactLedgerSummary(params: {
  title: string;
  type: ArtifactKind;
  taskTitle?: string | null;
}): string {
  const title = params.title.trim() || "untitled";
  const type = params.type;
  const taskSnippet = params.taskTitle?.trim();
  if (taskSnippet) {
    return `${title} (${type}) — ${truncateUtf16Safe(taskSnippet, 100)}`;
  }
  return `${title} (${type})`;
}

/** Terminal task statuses that trigger artifact detach (done + closed alias). */
export function isTerminalTaskStatus(status: string | null | undefined): boolean {
  const normalized = typeof status === "string" ? status.trim().toLowerCase() : "";
  return normalized === "done" || normalized === "closed";
}

/** Normalize API/status aliases into the stored TaskStatus union. */
export function normalizeTaskStatus(status: string | null | undefined): TaskStatus | undefined {
  if (typeof status !== "string") {
    return undefined;
  }
  const normalized = status.trim().toLowerCase();
  if (normalized === "closed" || normalized === "done") {
    return "done";
  }
  if (normalized === "active" || normalized === "paused") {
    return normalized;
  }
  return undefined;
}

/** Whether a checkpoint can be rolled back (files) / truncated (transcript). */
export type CheckpointRestorable = { files: boolean; transcript: boolean };

/** Best-effort record of irreversible outside-world actions during the turn. */
export type CheckpointExternalEffects = { present: boolean; kinds: string[] };

export type MemoryCheckpoint = {
  id: string;
  scope: MemoryScope;
  owner_id: string;
  session_id: string;
  source_session_file: string;
  created_at: string;
  summary: string;
  decisions: string[];
  preferences: string[];
  open_tasks: string[];
  completed_tasks: string[];
  artifacts: string[];
  evidence_refs: string[];
  // --- chat-checkpoint-rollback additions (optional, backward-compatible) ---
  /** Session key this checkpoint belongs to (enables per-session listing). */
  session_key?: string;
  /** Transcript boundary: last message id at capture time (for truncation). */
  boundary_message_id?: string;
  /** Transcript boundary as a line index fallback when no message id exists. */
  boundary_seq?: number;
  /** Reference to the workspace file snapshot captured for this checkpoint. */
  snapshot?: WorkspaceSnapshotRef;
  /** Best-effort external side-effect marker (drives the restore warning). */
  external_effects?: CheckpointExternalEffects;
  /** Which parts of this checkpoint can be restored. */
  restorable?: CheckpointRestorable;
};

type LedgerFile<T> = {
  version: 1;
  updated_at: string;
  items: T[];
};

type SessionMessage = {
  id?: string;
  role: string;
  text: string;
  timestamp?: string;
};

/**
 * Transcript boundary for checkpoint restore: anchor on the message immediately
 * before the latest user instruction in the completed turn, so restoring keeps
 * prior context and removes that user message plus everything after it.
 */
export function resolveCheckpointBoundaryMessageId(messages: SessionMessage[]): string | undefined {
  const n = messages.length;
  if (n === 0) {
    return undefined;
  }
  let lastUser = -1;
  for (let i = n - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "user") {
      lastUser = i;
      break;
    }
  }
  if (lastUser < 0) {
    return messages[n - 1]?.id;
  }
  if (lastUser === 0) {
    // First user turn: keep nothing. Must match TRANSCRIPT_START_BOUNDARY_ID.
    return "__openbot_transcript_start__";
  }
  return messages[lastUser - 1]?.id;
}

const TASK_LEDGER_FILE = "task_ledger.json";
const ARTIFACT_LEDGER_FILE = "artifact_ledger.json";
const CHECKPOINT_DIR = path.join("checkpoints");
const MAX_INJECTED_CONTINUITY_CHARS = 6000;
const ARTIFACT_PATTERN =
  /([^\s"'<>`|\\/:]{1,80}\.(?:md|markdown|pdf|docx?|pptx?|xlsx?|csv|txt))/giu;

export function resolveContinuityMemoryRoot(params: {
  cfg: OpenBotConfig;
  workspaceDir: string;
  scope: Extract<MemoryScope, "agent" | "group">;
  ownerId: string;
}): string {
  if (params.scope === "group") {
    return resolveGroupCollaborationPaths(params.ownerId, params.cfg).memoryDir;
  }
  return path.join(params.workspaceDir, "memory");
}

/** Workspace root used for checkpoint file snapshots (group scope → shared group workspace). */
export function resolveSessionContinuityWorkspaceDir(params: {
  cfg: OpenBotConfig;
  sessionKey?: string;
  sessionEntry?: SessionEntry;
  agentId: string;
  agentWorkspaceDir: string;
}): string {
  const scopeInfo = resolveScope({
    sessionEntry: params.sessionEntry,
    sessionKey: params.sessionKey,
    agentId: params.agentId,
  });
  if (scopeInfo.scope === "group") {
    return resolveGroupCollaborationPaths(scopeInfo.ownerId, params.cfg).workspacePath;
  }
  return params.agentWorkspaceDir;
}

function resolveScope(params: {
  sessionEntry?: SessionEntry;
  sessionKey?: string;
  agentId: string;
}): { scope: Extract<MemoryScope, "agent" | "group">; ownerId: string } {
  const groupId = params.sessionEntry?.groupId?.trim() || params.sessionEntry?.space?.trim();
  if (groupId) {
    return { scope: "group", ownerId: groupId };
  }
  const spaceMatch = params.sessionKey?.match(/(?:^|:)space:([^:]+)$/i);
  if (spaceMatch?.[1]) {
    return { scope: "group", ownerId: spaceMatch[1] };
  }
  return { scope: "agent", ownerId: params.agentId };
}

function stableId(prefix: string, parts: string[]): string {
  const hash = crypto.createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 16);
  return `${prefix}_${hash}`;
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonFile(rootDir: string, relativePath: string, data: unknown): Promise<void> {
  await writeFileWithinRoot({
    rootDir,
    relativePath,
    data: `${JSON.stringify(data, null, 2)}\n`,
    encoding: "utf8",
  });
}

async function readLedger<T>(rootDir: string, filename: string): Promise<LedgerFile<T>> {
  return await readJsonFile<LedgerFile<T>>(path.join(rootDir, filename), {
    version: 1,
    updated_at: new Date(0).toISOString(),
    items: [],
  });
}

/** Detach all artifacts linked to a task (terminal status). Preserves task_id history. */
export async function detachArtifactsForTask(params: {
  rootDir: string;
  taskId: string;
  now?: string;
  /** Clear reason recorded on terminal detach (default: task_terminal). */
  reason?: string;
}): Promise<{ detachedCount: number }> {
  const taskId = params.taskId.trim();
  if (!taskId) {
    return { detachedCount: 0 };
  }
  const now = params.now ?? new Date().toISOString();
  const reason = (params.reason ?? "task_terminal").trim() || "task_terminal";
  const ledger = await readLedger<ArtifactLedgerEntry>(params.rootDir, ARTIFACT_LEDGER_FILE);
  let detachedCount = 0;
  const items = ledger.items.map((entry) => {
    if (!entry.task_id || entry.task_id !== taskId) {
      return entry;
    }
    // Skip already non-active links (detached or archived).
    if (!isActiveArtifactLink(entry)) {
      return entry;
    }
    detachedCount += 1;
    return {
      ...entry,
      state: "detached" as const,
      detached_at: now,
      detached_from_task_id: entry.task_id,
      detached_reason: reason,
      updated_at: now,
    } satisfies ArtifactLedgerEntry;
  });
  if (detachedCount === 0) {
    return { detachedCount: 0 };
  }
  await writeJsonFile(params.rootDir, ARTIFACT_LEDGER_FILE, {
    version: 1,
    updated_at: now,
    items: items.toSorted((a, b) => a.updated_at.localeCompare(b.updated_at)),
  } satisfies LedgerFile<ArtifactLedgerEntry>);
  return { detachedCount };
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) => {
      if (!part || typeof part !== "object") {
        return "";
      }
      const typed = part as { type?: unknown; text?: unknown };
      return typed.type === "text" && typeof typed.text === "string" ? typed.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

export async function readSessionMessages(
  sessionFile: string,
  opts?: { signal?: AbortSignal },
): Promise<SessionMessage[]> {
  const content = opts?.signal
    ? await fs.readFile(sessionFile, { encoding: "utf8", signal: opts.signal })
    : await fs.readFile(sessionFile, "utf8");
  const messages: SessionMessage[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    try {
      const entry = JSON.parse(line) as {
        id?: string;
        timestamp?: string;
        type?: string;
        message?: { role?: unknown; content?: unknown };
      };
      if (entry.type !== "message" || !entry.message) {
        continue;
      }
      // Legacy restore receipts may quote checkpoint open_tasks. They stay in
      // the file for compatibility and are excluded from the task main line.
      if (isRestoreTaskIsolationMessage(entry) || isRestoreTaskIsolationMessage(entry.message)) {
        continue;
      }
      const role = typeof entry.message.role === "string" ? entry.message.role : "";
      if (role !== "user" && role !== "assistant") {
        continue;
      }
      const text = stripRestorePendingReviewFences(
        extractTextContent(entry.message.content),
      ).trim();
      if (!text || text.startsWith("/")) {
        continue;
      }
      messages.push({ id: entry.id, role, text, timestamp: entry.timestamp });
    } catch {
      // Skip malformed JSONL entries.
    }
  }
  return messages;
}

function stripStructuredPrefix(text: string): string {
  return text
    .replace(/^Sender \(untrusted metadata\):\n```json\n[\s\S]*?\n```\n\n/u, "")
    .replace(/^\[[^\]]+\]\s*/u, "")
    .trim();
}

function isTaskLikeUserText(text: string): boolean {
  const normalized = stripStructuredPrefix(text);
  if (normalized.length < 12) {
    return false;
  }
  return /(帮我|请|需要|你需要|继续|检查|分析|生成|创建|制作|写|撰写|优化|修改|实现|处理|排查|发布|上传|分享)/u.test(
    normalized,
  );
}

function toTaskTitle(text: string): string {
  const cleaned = stripStructuredPrefix(text)
    .replace(/\s+/gu, " ")
    .replace(/^["“]|["”]$/gu, "")
    .trim();
  return truncateUtf16Safe(cleaned, 72);
}

function inferArtifactKind(filename: string): ArtifactKind {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".ppt") || lower.endsWith(".pptx")) {
    return "ppt";
  }
  if (lower.endsWith(".pdf") || lower.endsWith(".doc") || lower.endsWith(".docx")) {
    return "report";
  }
  return "doc";
}

function extractArtifacts(text: string): Array<{ title: string; type: ArtifactKind }> {
  const found = new Map<string, { title: string; type: ArtifactKind }>();
  // Fenced restore open-tasks are historical. They must not mint artifacts on
  // the current task.
  const visible = stripRestorePendingReviewFences(text);
  for (const match of visible.matchAll(ARTIFACT_PATTERN)) {
    const title = match[1]?.trim();
    if (!title) {
      continue;
    }
    found.set(title.toLowerCase(), { title, type: inferArtifactKind(title) });
  }
  return [...found.values()];
}

function extractPreferences(messages: SessionMessage[]): string[] {
  const prefs: string[] = [];
  for (const message of messages) {
    if (message.role !== "user") {
      continue;
    }
    const text = stripStructuredPrefix(message.text);
    if (/(以后|今后|下次|必须|不要|禁止|需要|应该)/u.test(text)) {
      prefs.push(truncateUtf16Safe(text.replace(/\s+/gu, " "), 180));
    }
  }
  return [...new Set(prefs)].slice(-8);
}

function buildCheckpointSummary(messages: SessionMessage[]): string {
  const userMessages = messages
    .filter((message) => message.role === "user")
    .map((message) => stripStructuredPrefix(message.text).replace(/\s+/gu, " "))
    .filter(Boolean);
  if (userMessages.length === 0) {
    return "Session contained no user-visible task context.";
  }
  const first = userMessages[0] ?? "";
  const last = userMessages[userMessages.length - 1] ?? first;
  return first === last
    ? truncateUtf16Safe(first, 260)
    : `${truncateUtf16Safe(first, 140)} / Latest: ${truncateUtf16Safe(last, 180)}`;
}

export async function commitSessionContinuity(params: {
  cfg: OpenBotConfig;
  workspaceDir: string;
  agentId: string;
  sessionKey?: string;
  previousSessionEntry: SessionEntry;
  reason: "reset" | "deleted" | "rollover";
}): Promise<MemoryCheckpoint | undefined> {
  const sessionFile = params.previousSessionEntry.sessionFile;
  const sessionId = params.previousSessionEntry.sessionId;
  if (!sessionFile || !sessionId) {
    return undefined;
  }
  try {
    const messages = await readSessionMessages(sessionFile);
    if (messages.length === 0) {
      return undefined;
    }

    const scopeInfo = resolveScope({
      sessionEntry: params.previousSessionEntry,
      sessionKey: params.sessionKey,
      agentId: params.agentId,
    });
    const rootDir = resolveContinuityMemoryRoot({
      cfg: params.cfg,
      workspaceDir: params.workspaceDir,
      scope: scopeInfo.scope,
      ownerId: scopeInfo.ownerId,
    });
    await fs.mkdir(path.join(rootDir, CHECKPOINT_DIR), { recursive: true });

    const now = new Date().toISOString();
    const artifactLedger = await readLedger<ArtifactLedgerEntry>(rootDir, ARTIFACT_LEDGER_FILE);
    const artifactsById = new Map(artifactLedger.items.map((artifact) => [artifact.id, artifact]));
    const openTaskTitles: string[] = [];
    const artifactIds: string[] = [];

    const taskMessages = messages.filter(
      (message) => message.role === "user" && isTaskLikeUserText(message.text),
    );
    for (const message of taskMessages.slice(-8)) {
      const title = toTaskTitle(message.text);
      if (title) {
        openTaskTitles.push(title);
      }
    }

    // Sprint-2: only bind artifacts to a real active task_ledger row (session
    // taskContextId). Never mint synthetic task_<hash(scope,owner,unassigned)>.
    const taskLedger = await readLedger<TaskLedgerEntry>(rootDir, TASK_LEDGER_FILE);
    const boundTaskId = resolveActiveBoundTaskId({
      taskContextId: params.previousSessionEntry.taskContextId,
      taskLedgerItems: taskLedger.items,
    });
    const taskTitleById = new Map(taskLedger.items.map((task) => [task.id, task.title]));
    const textForArtifacts = messages.map((message) => message.text).join("\n");
    for (const artifact of extractArtifacts(textForArtifacts).slice(-12)) {
      const artifactId = stableId("artifact", [scopeInfo.scope, scopeInfo.ownerId, artifact.title]);
      const existing = artifactsById.get(artifactId);
      // Sprint-1: never resurrect non-active links (detached/archived) via checkpoint upsert.
      if (existing && !isActiveArtifactLink(existing)) {
        artifactIds.push(artifactId);
        continue;
      }
      const resolvedTaskId = existing?.task_id?.trim() || boundTaskId;
      const taskTitle = resolvedTaskId ? taskTitleById.get(resolvedTaskId) : undefined;
      const next: ArtifactLedgerEntry = {
        id: artifactId,
        title: artifact.title,
        type: artifact.type,
        ...(resolvedTaskId ? { task_id: resolvedTaskId } : {}),
        source_session: sessionId,
        version: existing ? existing.version + 1 : 1,
        updated_at: now,
        // Sprint-4: contextual summary (title/type/task snippet); not a pure session placeholder.
        summary: buildArtifactLedgerSummary({
          title: artifact.title,
          type: artifact.type,
          taskTitle,
        }),
        ...(existing?.state ? { state: existing.state } : {}),
      };
      artifactsById.set(artifactId, next);
      artifactIds.push(artifactId);
    }

    const checkpoint: MemoryCheckpoint = {
      id: stableId("checkpoint", [scopeInfo.scope, scopeInfo.ownerId, sessionId, now]),
      scope: scopeInfo.scope,
      owner_id: scopeInfo.ownerId,
      session_id: sessionId,
      session_key: params.sessionKey,
      source_session_file: sessionFile,
      created_at: now,
      summary: buildCheckpointSummary(messages),
      decisions: [],
      preferences: extractPreferences(messages),
      open_tasks: [...new Set(openTaskTitles)],
      completed_tasks: [],
      artifacts: [...new Set(artifactIds)],
      evidence_refs: messages
        .map((message) => message.id)
        .filter((id): id is string => Boolean(id))
        .slice(-12),
    };

    await writeJsonFile(rootDir, ARTIFACT_LEDGER_FILE, {
      version: 1,
      updated_at: now,
      items: [...artifactsById.values()].toSorted((a, b) =>
        a.updated_at.localeCompare(b.updated_at),
      ),
    } satisfies LedgerFile<ArtifactLedgerEntry>);
    await writeJsonFile(
      rootDir,
      path.join(
        CHECKPOINT_DIR,
        `${checkpoint.created_at.replaceAll(":", "-")}-${checkpoint.id}.json`,
      ),
      checkpoint,
    );

    log.debug("Committed session continuity checkpoint", {
      scope: checkpoint.scope,
      ownerId: checkpoint.owner_id,
      sessionId,
      openTasks: checkpoint.open_tasks.length,
      artifacts: checkpoint.artifacts.length,
      reason: params.reason,
    });
    return checkpoint;
  } catch (err) {
    log.debug("Failed to commit session continuity checkpoint", {
      error: String(err),
      sessionId,
      sessionFile,
    });
    return undefined;
  }
}

async function readLatestCheckpoint(rootDir: string): Promise<MemoryCheckpoint | undefined> {
  const checkpointRoot = path.join(rootDir, CHECKPOINT_DIR);
  try {
    const files = (await fs.readdir(checkpointRoot))
      .filter((name) => name.endsWith(".json"))
      .toSorted();
    const latest = files[files.length - 1];
    return latest
      ? await readJsonFile<MemoryCheckpoint | undefined>(
          path.join(checkpointRoot, latest),
          undefined,
        )
      : undefined;
  } catch {
    return undefined;
  }
}

export async function loadLatestSessionContinuityCheckpoint(params: {
  cfg: OpenBotConfig;
  workspaceDir: string;
  agentId: string;
  sessionKey?: string;
  sessionEntry?: SessionEntry;
}): Promise<MemoryCheckpoint | undefined> {
  const scopeInfo = resolveScope({
    sessionEntry: params.sessionEntry,
    sessionKey: params.sessionKey,
    agentId: params.agentId,
  });
  const rootDir = resolveContinuityMemoryRoot({
    cfg: params.cfg,
    workspaceDir: params.workspaceDir,
    scope: scopeInfo.scope,
    ownerId: scopeInfo.ownerId,
  });
  return await readLatestCheckpoint(rootDir);
}

/** UI-facing summary of a restorable checkpoint for a session. */
export type SessionCheckpointSummary = {
  checkpointId: string;
  createdAt: string;
  boundaryMessageId?: string;
  summary: string;
  restorable: CheckpointRestorable;
  externalEffects: CheckpointExternalEffects;
};

/**
 * List a session's checkpoints (ascending by creation time) for the checkpoint
 * rollback UI. Filters the shared per-scope checkpoint store down to the given
 * session via `session_key` (new records) or `session_id` (older records).
 */
export async function listSessionContinuityCheckpoints(params: {
  cfg: OpenBotConfig;
  workspaceDir: string;
  agentId: string;
  sessionKey?: string;
  sessionEntry?: SessionEntry;
}): Promise<SessionCheckpointSummary[]> {
  const scopeInfo = resolveScope({
    sessionEntry: params.sessionEntry,
    sessionKey: params.sessionKey,
    agentId: params.agentId,
  });
  const rootDir = resolveContinuityMemoryRoot({
    cfg: params.cfg,
    workspaceDir: params.workspaceDir,
    scope: scopeInfo.scope,
    ownerId: scopeInfo.ownerId,
  });
  const checkpointRoot = path.join(rootDir, CHECKPOINT_DIR);
  let files: string[];
  try {
    files = (await fs.readdir(checkpointRoot)).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
  const sessionId = params.sessionEntry?.sessionId;
  const summaries: SessionCheckpointSummary[] = [];
  for (const file of files) {
    const cp = await readJsonFile<MemoryCheckpoint | undefined>(
      path.join(checkpointRoot, file),
      undefined,
    );
    if (!cp) {
      continue;
    }
    if (!checkpointMatchesSession(cp, params.sessionKey, sessionId)) {
      continue;
    }
    summaries.push({
      checkpointId: cp.id,
      createdAt: cp.created_at,
      boundaryMessageId: cp.boundary_message_id,
      summary: cp.summary,
      restorable: cp.restorable ?? { files: false, transcript: true },
      externalEffects: cp.external_effects ?? { present: false, kinds: [] },
    });
  }
  summaries.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return summaries;
}

/**
 * Load one checkpoint by id, scoped to the given session (agent/group scope).
 * Returns undefined when it does not exist or does not belong to the session,
 * so callers can reject cross-session targeting (Requirement 3.3).
 */
export async function loadSessionContinuityCheckpointById(params: {
  cfg: OpenBotConfig;
  workspaceDir: string;
  agentId: string;
  sessionKey?: string;
  sessionEntry?: SessionEntry;
  checkpointId: string;
}): Promise<MemoryCheckpoint | undefined> {
  const scopeInfo = resolveScope({
    sessionEntry: params.sessionEntry,
    sessionKey: params.sessionKey,
    agentId: params.agentId,
  });
  const rootDir = resolveContinuityMemoryRoot({
    cfg: params.cfg,
    workspaceDir: params.workspaceDir,
    scope: scopeInfo.scope,
    ownerId: scopeInfo.ownerId,
  });
  const checkpointRoot = path.join(rootDir, CHECKPOINT_DIR);
  let files: string[];
  try {
    files = (await fs.readdir(checkpointRoot)).filter((name) => name.endsWith(".json"));
  } catch {
    return undefined;
  }
  const sessionId = params.sessionEntry?.sessionId;
  for (const file of files) {
    const cp = await readJsonFile<MemoryCheckpoint | undefined>(
      path.join(checkpointRoot, file),
      undefined,
    );
    if (!cp || cp.id !== params.checkpointId) {
      continue;
    }
    return checkpointMatchesSession(cp, params.sessionKey, sessionId) ? cp : undefined;
  }
  return undefined;
}

/** Default cap on retained checkpoints per session (chat-checkpoint-rollback R9). */
const MAX_CHECKPOINTS_PER_SESSION = 50;

function checkpointMatchesSession(
  cp: MemoryCheckpoint,
  sessionKey: string | undefined,
  sessionId: string | undefined,
): boolean {
  // Same transcript can be addressed by more than one key (legacy agent id vs
  // the key stored at commit). session_id is the stable identity.
  if (sessionId && cp.session_id === sessionId) {
    return true;
  }
  if (sessionKey && cp.session_key === sessionKey) {
    return true;
  }
  return false;
}

async function loadScopeCheckpointEntries(
  checkpointRoot: string,
): Promise<Array<{ file: string; cp: MemoryCheckpoint }>> {
  let files: string[];
  try {
    files = (await fs.readdir(checkpointRoot)).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
  const entries: Array<{ file: string; cp: MemoryCheckpoint }> = [];
  for (const file of files) {
    const cp = await readJsonFile<MemoryCheckpoint | undefined>(
      path.join(checkpointRoot, file),
      undefined,
    );
    if (cp) {
      entries.push({ file, cp });
    }
  }
  return entries;
}

function createScopeSnapshotStore(rootDir: string) {
  return createContentAddressedSnapshotStore({
    storeDir: path.join(rootDir, "snapshots"),
    ignore: [".git", "node_modules", "memory"],
  });
}

/**
 * Enforce the per-session checkpoint cap for a scope (chat-checkpoint-rollback
 * R9.1): keep the newest `maxPerSession` per session, delete older checkpoint
 * records, then drop snapshot manifests/blobs no surviving checkpoint references.
 * Best-effort; never throws to the caller.
 */
export async function pruneSessionContinuityCheckpoints(params: {
  cfg: OpenBotConfig;
  workspaceDir: string;
  agentId: string;
  sessionKey?: string;
  sessionEntry?: SessionEntry;
  maxPerSession?: number;
}): Promise<void> {
  const max = params.maxPerSession ?? MAX_CHECKPOINTS_PER_SESSION;
  try {
    const scopeInfo = resolveScope({
      sessionEntry: params.sessionEntry,
      sessionKey: params.sessionKey,
      agentId: params.agentId,
    });
    const rootDir = resolveContinuityMemoryRoot({
      cfg: params.cfg,
      workspaceDir: params.workspaceDir,
      scope: scopeInfo.scope,
      ownerId: scopeInfo.ownerId,
    });
    const entries = await loadScopeCheckpointEntries(path.join(rootDir, CHECKPOINT_DIR));
    if (entries.length === 0) {
      return;
    }
    const bySession = new Map<string, Array<{ file: string; cp: MemoryCheckpoint }>>();
    for (const entry of entries) {
      const key = entry.cp.session_key ?? entry.cp.session_id ?? "unknown";
      const group = bySession.get(key);
      if (group) {
        group.push(entry);
      } else {
        bySession.set(key, [entry]);
      }
    }
    const toDelete: Array<{ file: string; cp: MemoryCheckpoint }> = [];
    for (const group of bySession.values()) {
      group.sort((a, b) => a.cp.created_at.localeCompare(b.cp.created_at));
      const overflow = group.length - max;
      if (overflow > 0) {
        toDelete.push(...group.slice(0, overflow));
      }
    }
    if (toDelete.length === 0) {
      return;
    }
    const deleteIds = new Set(toDelete.map((entry) => entry.cp.id));
    const keepIds = entries
      .filter((entry) => !deleteIds.has(entry.cp.id))
      .map((entry) => entry.cp.id);
    for (const entry of toDelete) {
      await fs
        .rm(path.join(rootDir, CHECKPOINT_DIR, entry.file), { force: true })
        .catch(() => undefined);
    }
    await createScopeSnapshotStore(rootDir).prune({ keepCheckpointIds: keepIds });
  } catch (err) {
    log.debug("checkpoint prune failed", { error: String(err) });
  }
}

/**
 * Remove all of a session's checkpoints + their snapshot data (R9.2), preserving
 * other sessions' data in the shared scope store. Best-effort; used on session
 * delete.
 */
export async function cleanupSessionContinuityCheckpoints(params: {
  cfg: OpenBotConfig;
  workspaceDir: string;
  agentId: string;
  sessionKey?: string;
  sessionEntry?: SessionEntry;
}): Promise<void> {
  try {
    const scopeInfo = resolveScope({
      sessionEntry: params.sessionEntry,
      sessionKey: params.sessionKey,
      agentId: params.agentId,
    });
    const rootDir = resolveContinuityMemoryRoot({
      cfg: params.cfg,
      workspaceDir: params.workspaceDir,
      scope: scopeInfo.scope,
      ownerId: scopeInfo.ownerId,
    });
    const entries = await loadScopeCheckpointEntries(path.join(rootDir, CHECKPOINT_DIR));
    if (entries.length === 0) {
      return;
    }
    const sessionId = params.sessionEntry?.sessionId;
    const remove = entries.filter((entry) =>
      checkpointMatchesSession(entry.cp, params.sessionKey, sessionId),
    );
    if (remove.length === 0) {
      return;
    }
    const removeIds = new Set(remove.map((entry) => entry.cp.id));
    const keepIds = entries
      .filter((entry) => !removeIds.has(entry.cp.id))
      .map((entry) => entry.cp.id);
    for (const entry of remove) {
      await fs
        .rm(path.join(rootDir, CHECKPOINT_DIR, entry.file), { force: true })
        .catch(() => undefined);
    }
    await createScopeSnapshotStore(rootDir).prune({ keepCheckpointIds: keepIds });
  } catch (err) {
    log.debug("checkpoint cleanup failed", { error: String(err) });
  }
}

export function formatSessionContinuityCheckpointRestoreText(checkpoint: MemoryCheckpoint): string {
  const lines = [
    "Checkpoint restored.",
    checkpoint.summary ? `Summary: ${checkpoint.summary}` : "",
    checkpoint.open_tasks.length > 0
      ? `Open tasks: ${checkpoint.open_tasks.slice(0, 5).join(", ")} source=restore`
      : "",
    checkpoint.completed_tasks.length > 0
      ? `Recently completed: ${checkpoint.completed_tasks.slice(0, 5).join(", ")}`
      : "",
    checkpoint.artifacts.length > 0
      ? `Artifacts: ${checkpoint.artifacts.slice(0, 5).join(", ")}`
      : "",
  ].filter(Boolean);
  return truncateUtf16Safe(lines.join("\n"), MAX_INJECTED_CONTINUITY_CHARS);
}

export async function buildSessionContinuityPrompt(params: {
  cfg: OpenBotConfig;
  workspaceDir: string;
  agentId: string;
  sessionKey?: string;
  sessionEntry?: SessionEntry;
  isNewSession: boolean;
}): Promise<string> {
  const scopeInfo = resolveScope({
    sessionEntry: params.sessionEntry,
    sessionKey: params.sessionKey,
    agentId: params.agentId,
  });
  const isGroupScope = scopeInfo.scope === "group";
  if (!params.isNewSession && !isGroupScope) {
    return "";
  }
  const rootDir = resolveContinuityMemoryRoot({
    cfg: params.cfg,
    workspaceDir: params.workspaceDir,
    scope: scopeInfo.scope,
    ownerId: scopeInfo.ownerId,
  });
  const taskLedger = await readLedger<TaskLedgerEntry>(rootDir, TASK_LEDGER_FILE);
  const artifactLedger = await readLedger<ArtifactLedgerEntry>(rootDir, ARTIFACT_LEDGER_FILE);
  const latestCheckpoint = await readLatestCheckpoint(rootDir);
  const taskFilter = params.sessionEntry?.taskContextId?.trim();
  const boundTasks = taskFilter
    ? taskLedger.items
        .filter(
          (task) =>
            task.status === "active" &&
            task.id === taskFilter &&
            task.surface_disposition !== "cancelled",
        )
        .toSorted((a, b) => b.updated_at.localeCompare(a.updated_at))
    : [];
  if (boundTasks.length === 0 && !latestCheckpoint) {
    return "";
  }
  const artifactsById = new Map(artifactLedger.items.map((artifact) => [artifact.id, artifact]));
  const lines = [
    "Session continuity context:",
    "Use this as current operating state, not as raw chat history. Do not scan reset archives unless explicitly asked.",
  ];
  if (boundTasks.length > 0) {
    const primaryTask = boundTasks[0];
    const correctionPoint = [...(primaryTask?.context.key_points ?? [])]
      .toReversed()
      .find((point) => point.startsWith("User correction (authoritative):"));
    const primaryObjective =
      correctionPoint?.replace(/^User correction \(authoritative\):\s*/u, "").trim() ||
      primaryTask?.description?.trim() ||
      primaryTask?.context.key_points.at(-1)?.trim();
    if (primaryObjective) {
      lines.push(
        "",
        "Bound workspace task context (not ConversationTask identity):",
        primaryObjective,
      );
    }
    lines.push("", "Bound task from workspace cache:");
    for (const task of boundTasks) {
      lines.push(`- ${task.title} [${task.id}]`);
      const keyPoint = task.context.key_points.at(-1);
      if (keyPoint) {
        lines.push(`  Summary: ${keyPoint}`);
      }
      const taskArtifacts = task.artifacts
        .map((id) => artifactsById.get(id))
        .filter((artifact): artifact is ArtifactLedgerEntry => Boolean(artifact))
        .filter((artifact) => isActiveArtifactLink(artifact))
        .slice(0, 3);
      if (taskArtifacts.length > 0) {
        lines.push(`  Artifacts: ${taskArtifacts.map((artifact) => artifact.title).join(", ")}`);
      }
    }
  }
  // Checkpoint open_tasks are historical titles. Inject the summary only.
  // Unbound ledger rows stay filtered above (boundTasks requires taskContextId).
  if (latestCheckpoint?.summary) {
    lines.push("", `Latest checkpoint summary: ${latestCheckpoint.summary}`);
  }
  lines.push("", TURN_COMPLETION_CONTINUITY_LINE);
  lines.push(TASK_SURFACE_CONTINUITY_LINE);
  const skillGlossary = formatActiveSkillGlossary({
    userText: lines.join("\n"),
    boundSkillIds: boundTasks.map((task) => task.title),
  });
  if (skillGlossary) {
    lines.push(skillGlossary);
  }
  return truncateUtf16Safe(lines.join("\n"), MAX_INJECTED_CONTINUITY_CHARS);
}

/**
 * Read-only task-pointer check used by chat.restore before any close decision.
 * Missing relationships are reported as pending review. File existence does
 * not close a row, and this function does not write the ledger.
 */
export async function loadRestoreTaskReconciliation(params: {
  cfg: OpenBotConfig;
  workspaceDir: string;
  agentId: string;
  sessionKey?: string;
  sessionEntry?: SessionEntry;
  checkpointOpenTasks: readonly string[];
}): Promise<RestoreTaskReconciliation> {
  const scopeInfo = resolveScope({
    sessionEntry: params.sessionEntry,
    sessionKey: params.sessionKey,
    agentId: params.agentId,
  });
  const rootDir = resolveContinuityMemoryRoot({
    cfg: params.cfg,
    workspaceDir: params.workspaceDir,
    scope: scopeInfo.scope,
    ownerId: scopeInfo.ownerId,
  });
  const taskLedger = await readLedger<TaskLedgerEntry>(rootDir, TASK_LEDGER_FILE);
  const artifactLedger = await readLedger<ArtifactLedgerEntry>(rootDir, ARTIFACT_LEDGER_FILE);
  const fileExistsByArtifactKey: Record<string, boolean> = {};
  for (const artifact of artifactLedger.items) {
    for (const key of [artifact.id, artifact.title]) {
      const name = key.trim();
      if (!name || fileExistsByArtifactKey[name] !== undefined) {
        continue;
      }
      fileExistsByArtifactKey[name] = await workspaceFileExists(params.workspaceDir, name);
    }
  }
  const reconciliation = reconcileRestoreTaskPointersReadOnly({
    taskContextId: params.sessionEntry?.taskContextId,
    taskLedger: taskLedger.items,
    artifactLedger: artifactLedger.items,
    checkpointOpenTasks: params.checkpointOpenTasks,
    fileExistsByArtifactKey,
  });
  if (reconciliation.autoClosedTaskIds.length > 0) {
    throw new Error("restore reconciliation must not auto-close task rows");
  }
  return reconciliation.pendingReview.length > 0 || reconciliation.currentTaskId
    ? reconciliation
    : emptyRestoreTaskReconciliation();
}

async function workspaceFileExists(workspaceDir: string, relativeName: string): Promise<boolean> {
  const trimmed = relativeName.trim();
  if (!trimmed || trimmed.includes("..") || path.isAbsolute(trimmed)) {
    return false;
  }
  const root = path.resolve(workspaceDir);
  const target = path.resolve(root, trimmed);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    return false;
  }
  try {
    const stat = await fs.stat(target);
    return stat.isFile();
  } catch {
    return false;
  }
}

const EXTERNAL_EFFECT_TOOL_PATTERNS: Array<{ kind: string; re: RegExp }> = [
  { kind: "email", re: /(send[_-]?email|email[._-]?send|mail[._-]?send|smtp)/iu },
  {
    kind: "message",
    re: /(send[_-]?message|message[._-]?send|post[_-]?message|whatsapp|telegram|slack|discord|signal|imessage)/iu,
  },
  { kind: "publish", re: /(publish|post[_-]?tweet|create[_-]?issue|open[_-]?pr|webhook)/iu },
];

/** Extract tool-call names from a transcript JSONL entry across known shapes. */
function collectToolNamesFromEntry(entry: unknown): string[] {
  if (!entry || typeof entry !== "object") {
    return [];
  }
  const names: string[] = [];
  const pushName = (value: unknown) => {
    if (typeof value === "string" && value.trim()) {
      names.push(value.trim());
    }
  };
  const record = entry as Record<string, unknown>;
  pushName(record.toolName);
  const message = record.message;
  if (message && typeof message === "object") {
    const msg = message as Record<string, unknown>;
    pushName(msg.toolName);
    if (Array.isArray(msg.content)) {
      for (const item of msg.content) {
        if (item && typeof item === "object") {
          const it = item as Record<string, unknown>;
          const type = typeof it.type === "string" ? it.type : "";
          if (type === "tool_use" || type === "tool_call" || type === "toolCall") {
            pushName(it.name);
          }
        }
      }
    }
  }
  return names;
}

/**
 * Best-effort detection of irreversible outside-world actions in a turn, by
 * scanning transcript tool-call names. Drives only the restore-confirm warning,
 * so false negatives are acceptable (refined in a later phase).
 */
export async function detectExternalEffectsFromTranscript(
  sessionFile: string,
): Promise<CheckpointExternalEffects> {
  try {
    const content = await fs.readFile(sessionFile, "utf8");
    const kinds = new Set<string>();
    for (const line of content.split("\n")) {
      if (!line.trim()) {
        continue;
      }
      let entry: unknown;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      for (const name of collectToolNamesFromEntry(entry)) {
        for (const pattern of EXTERNAL_EFFECT_TOOL_PATTERNS) {
          if (pattern.re.test(name)) {
            kinds.add(pattern.kind);
          }
        }
      }
    }
    return { present: kinds.size > 0, kinds: [...kinds] };
  } catch {
    return { present: false, kinds: [] };
  }
}

async function captureWorkspaceSnapshotForCheckpoint(params: {
  workspaceDir: string;
  memoryRootDir: string;
  checkpointId: string;
}): Promise<WorkspaceSnapshotRef> {
  const store = createContentAddressedSnapshotStore({
    storeDir: path.join(params.memoryRootDir, "snapshots"),
    // memory/ holds agent bookkeeping (ledgers, checkpoints, snapshots), not
    // user work product; never snapshot it (also avoids recursion/growth).
    ignore: [".git", "node_modules", "memory"],
  });
  return await store.capture({
    workspaceRoot: params.workspaceDir,
    checkpointId: params.checkpointId,
  });
}

/**
 * Roll the workspace back to a checkpoint's file snapshot (chat-checkpoint-rollback
 * P3). Reconstructs the same content-addressed store used at capture time and
 * restores within the workspace root only. No-op when the checkpoint has no
 * file snapshot (`snapshot.store !== "content-addressed"`).
 */
export async function restoreWorkspaceSnapshotForCheckpoint(params: {
  cfg: OpenBotConfig;
  workspaceDir: string;
  agentId: string;
  sessionKey?: string;
  sessionEntry?: SessionEntry;
  checkpoint: MemoryCheckpoint;
  /** Aborts the snapshot walk/hash before workspace files are replaced. */
  signal?: AbortSignal;
}): Promise<{
  restoredFiles: number;
  removedFiles: number;
  unchangedFiles?: number;
  skippedFiles?: number;
  durationMs?: number;
}> {
  const snapshot = params.checkpoint.snapshot;
  if (!snapshot || snapshot.store !== "content-addressed") {
    return { restoredFiles: 0, removedFiles: 0 };
  }
  const scopeInfo = resolveScope({
    sessionEntry: params.sessionEntry,
    sessionKey: params.sessionKey,
    agentId: params.agentId,
  });
  const rootDir = resolveContinuityMemoryRoot({
    cfg: params.cfg,
    workspaceDir: params.workspaceDir,
    scope: scopeInfo.scope,
    ownerId: scopeInfo.ownerId,
  });
  const store = createContentAddressedSnapshotStore({
    storeDir: path.join(rootDir, "snapshots"),
    ignore: [".git", "node_modules", "memory"],
  });
  return await store.restore({
    workspaceRoot: params.workspaceDir,
    ref: snapshot,
    signal: params.signal,
  });
}

export async function commitSessionContinuityForCurrentSession(params: {
  cfg: OpenBotConfig;
  workspaceDir: string;
  agentId: string;
  sessionKey?: string;
  sessionEntry?: SessionEntry;
  reason: "turn_completed";
  /** Capture a workspace file snapshot for rollback (default true). */
  enableWorkspaceSnapshot?: boolean;
}): Promise<MemoryCheckpoint | undefined> {
  const sessionFile = params.sessionEntry?.sessionFile;
  const sessionId = params.sessionEntry?.sessionId;
  if (!sessionFile || !sessionId) {
    return undefined;
  }
  try {
    const messages = await readSessionMessages(sessionFile);
    if (messages.length === 0) {
      return undefined;
    }

    const scopeInfo = resolveScope({
      sessionEntry: params.sessionEntry,
      sessionKey: params.sessionKey,
      agentId: params.agentId,
    });
    const rootDir = resolveContinuityMemoryRoot({
      cfg: params.cfg,
      workspaceDir: params.workspaceDir,
      scope: scopeInfo.scope,
      ownerId: scopeInfo.ownerId,
    });
    await fs.mkdir(path.join(rootDir, CHECKPOINT_DIR), { recursive: true });

    const now = new Date().toISOString();
    const checkpoint: MemoryCheckpoint = {
      id: stableId("checkpoint", [scopeInfo.scope, scopeInfo.ownerId, sessionId, now]),
      scope: scopeInfo.scope,
      owner_id: scopeInfo.ownerId,
      session_id: sessionId,
      source_session_file: sessionFile,
      created_at: now,
      summary: buildCheckpointSummary(messages),
      decisions: [],
      preferences: extractPreferences(messages),
      open_tasks: [],
      completed_tasks: [],
      artifacts: extractArtifacts(messages.map((message) => message.text).join("\n")).map(
        (a) => a.title,
      ),
      evidence_refs: messages
        .map((message) => message.id)
        .filter((id): id is string => Boolean(id))
        .slice(-12),
    };

    // chat-checkpoint-rollback: attach rollback metadata + workspace snapshot.
    // Capture failure degrades gracefully (files not restorable) and never
    // blocks the turn; the transcript boundary alone still enables truncation.
    // Phase A collab/space: transcript restore enabled (恢复线); files/snapshot stay
    // off until Phase B. Boundary remains human-user-role only.
    const collabGroup = scopeInfo.scope === "group";
    checkpoint.session_key = params.sessionKey;
    checkpoint.boundary_message_id = resolveCheckpointBoundaryMessageId(messages);
    checkpoint.external_effects = collabGroup
      ? { present: false, kinds: [] }
      : await detectExternalEffectsFromTranscript(sessionFile);
    checkpoint.restorable = { files: false, transcript: true };
    if (!collabGroup && params.enableWorkspaceSnapshot !== false) {
      try {
        const snapshot = await captureWorkspaceSnapshotForCheckpoint({
          workspaceDir: params.workspaceDir,
          memoryRootDir: rootDir,
          checkpointId: checkpoint.id,
        });
        checkpoint.snapshot = snapshot;
        checkpoint.restorable = {
          files: snapshot.store === "content-addressed",
          transcript: true,
        };
      } catch (err) {
        log.debug("workspace snapshot capture failed; checkpoint files not restorable", {
          error: String(err),
          checkpointId: checkpoint.id,
        });
        checkpoint.snapshot = { store: "none" };
      }
    } else {
      checkpoint.snapshot = { store: "none" };
    }

    await writeJsonFile(
      rootDir,
      path.join(
        CHECKPOINT_DIR,
        `${checkpoint.created_at.replaceAll(":", "-")}-${checkpoint.id}.json`,
      ),
      checkpoint,
    );
    // Enforce the per-session retention cap (drops oldest checkpoints + orphan
    // snapshot blobs) so checkpoint storage stays bounded (R9.1).
    await pruneSessionContinuityCheckpoints({
      cfg: params.cfg,
      workspaceDir: params.workspaceDir,
      agentId: params.agentId,
      sessionKey: params.sessionKey,
      sessionEntry: params.sessionEntry,
    });
    return checkpoint;
  } catch (err) {
    log.debug("Failed to commit current-session continuity checkpoint", {
      error: String(err),
      sessionId,
      sessionFile,
    });
    return undefined;
  }
}
