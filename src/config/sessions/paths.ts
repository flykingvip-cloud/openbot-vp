import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expandHomePrefix, resolveRequiredHomeDir } from "../../infra/home-dir.js";
import { DEFAULT_AGENT_ID, normalizeAgentId } from "../../routing/session-key.js";
import { isPathInsideRoot, resolveOperatorStateRoot } from "../operator-state-scope.js";
import { resolveStateDir } from "../paths.js";

function resolveAgentSessionsDir(
  agentId?: string,
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = () => resolveRequiredHomeDir(env, os.homedir),
): string {
  // Operator-scoped when OPENBOT_OPERATOR_ID is set; otherwise legacy STATE_DIR.
  const root = resolveOperatorStateRoot(env, homedir);
  const id = normalizeAgentId(agentId ?? DEFAULT_AGENT_ID);
  return path.join(root, "agents", id, "sessions");
}

export function resolveSessionTranscriptsDir(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = () => resolveRequiredHomeDir(env, os.homedir),
): string {
  return resolveAgentSessionsDir(DEFAULT_AGENT_ID, env, homedir);
}

export function resolveSessionTranscriptsDirForAgent(
  agentId?: string,
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = () => resolveRequiredHomeDir(env, os.homedir),
): string {
  return resolveAgentSessionsDir(agentId, env, homedir);
}

export function resolveDefaultSessionStorePath(agentId?: string): string {
  return path.join(resolveAgentSessionsDir(agentId), "sessions.json");
}

/**
 * Unscoped conversation store directory: `$STATE_DIR/agents/<agentId>/sessions`.
 * Ignores operator ALS / OPENBOT_OPERATOR_ID. Never `operators/<id>/`.
 */
export function resolveSharedAgentSessionsDir(
  agentId?: string,
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = () => resolveRequiredHomeDir(env, os.homedir),
): string {
  const id = normalizeAgentId(agentId ?? DEFAULT_AGENT_ID);
  return path.join(resolveStateDir(env, homedir), "agents", id, "sessions");
}

/** `$STATE_DIR/agents/<agentId>/sessions/sessions.json` — the shared canonical store. */
export function resolveSharedSessionStorePath(
  agentId?: string,
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = () => resolveRequiredHomeDir(env, os.homedir),
): string {
  return path.join(resolveSharedAgentSessionsDir(agentId, env, homedir), "sessions.json");
}

/**
 * True only for the unscoped `agents/<id>/sessions/sessions.json` file.
 * Rejects `operators/<id>/...` and any path that leaves STATE_DIR.
 */
export function isUnscopedSharedSessionStorePath(
  storePath: string,
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = () => resolveRequiredHomeDir(env, os.homedir),
): boolean {
  const stateDir = path.resolve(resolveStateDir(env, homedir));
  const resolved = path.resolve(storePath);
  const relative = path.relative(stateDir, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return false;
  }
  const parts = relative.split(path.sep);
  return (
    parts.length === 4 &&
    parts[0] === "agents" &&
    parts[2] === "sessions" &&
    parts[3] === "sessions.json" &&
    Boolean(parts[1])
  );
}

/** Real path stays inside the shared agent sessions directory (no operators/ symlink escape). */
export function isInsideSharedAgentSessionsDir(
  candidate: string,
  agentId: string,
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = () => resolveRequiredHomeDir(env, os.homedir),
): boolean {
  return isPathInsideRoot(
    path.resolve(candidate),
    resolveSharedAgentSessionsDir(agentId, env, homedir),
  );
}

export type SessionFilePathOptions = {
  agentId?: string;
  sessionsDir?: string;
};

const MULTI_STORE_PATH_SENTINEL = "(multiple)";

export function resolveSessionFilePathOptions(params: {
  agentId?: string;
  storePath?: string;
}): SessionFilePathOptions | undefined {
  const agentId = params.agentId?.trim();
  const storePath = params.storePath?.trim();
  if (storePath && storePath !== MULTI_STORE_PATH_SENTINEL) {
    const sessionsDir = path.dirname(path.resolve(storePath));
    return agentId ? { sessionsDir, agentId } : { sessionsDir };
  }
  if (agentId) {
    return { agentId };
  }
  return undefined;
}

export const SAFE_SESSION_ID_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/i;

export function isValidSessionId(sessionId: string): boolean {
  const trimmed = sessionId.trim();
  return trimmed.length > 0 && SAFE_SESSION_ID_RE.test(trimmed);
}

export function validateSessionId(sessionId: string): string {
  const trimmed = sessionId.trim();
  if (!isValidSessionId(trimmed)) {
    throw new Error(`Invalid session ID: ${sessionId}`);
  }
  return trimmed;
}

function resolveSessionsDir(opts?: SessionFilePathOptions): string {
  const sessionsDir = opts?.sessionsDir?.trim();
  if (sessionsDir) {
    return path.resolve(sessionsDir);
  }
  return resolveAgentSessionsDir(opts?.agentId);
}

function resolvePathFromAgentSessionsDir(
  agentSessionsDir: string,
  candidateAbsPath: string,
): string | undefined {
  const agentBase =
    safeRealpathSync(path.resolve(agentSessionsDir)) ?? path.resolve(agentSessionsDir);
  const realCandidate = safeRealpathSync(candidateAbsPath) ?? candidateAbsPath;
  const relative = path.relative(agentBase, realCandidate);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return undefined;
  }
  return path.resolve(agentBase, relative);
}

function resolveSiblingAgentSessionsDir(
  baseSessionsDir: string,
  agentId: string,
): string | undefined {
  const resolvedBase = path.resolve(baseSessionsDir);
  if (path.basename(resolvedBase) !== "sessions") {
    return undefined;
  }
  const baseAgentDir = path.dirname(resolvedBase);
  const baseAgentsDir = path.dirname(baseAgentDir);
  if (path.basename(baseAgentsDir) !== "agents") {
    return undefined;
  }
  const rootDir = path.dirname(baseAgentsDir);
  return path.join(rootDir, "agents", normalizeAgentId(agentId), "sessions");
}

function resolveAgentSessionsPathParts(
  candidateAbsPath: string,
): { parts: string[]; sessionsIndex: number } | null {
  const normalized = path.normalize(path.resolve(candidateAbsPath));
  const parts = normalized.split(path.sep).filter(Boolean);
  const sessionsIndex = parts.lastIndexOf("sessions");
  if (sessionsIndex < 2 || parts[sessionsIndex - 2] !== "agents") {
    return null;
  }
  return { parts, sessionsIndex };
}

function extractAgentIdFromAbsoluteSessionPath(candidateAbsPath: string): string | undefined {
  const parsed = resolveAgentSessionsPathParts(candidateAbsPath);
  if (!parsed) {
    return undefined;
  }
  const { parts, sessionsIndex } = parsed;
  const agentId = parts[sessionsIndex - 1];
  return agentId || undefined;
}

function resolveStructuralSessionFallbackPath(
  candidateAbsPath: string,
  expectedAgentId: string,
): string | undefined {
  const parsed = resolveAgentSessionsPathParts(candidateAbsPath);
  if (!parsed) {
    return undefined;
  }
  const { parts, sessionsIndex } = parsed;
  const agentIdPart = parts[sessionsIndex - 1];
  if (!agentIdPart) {
    return undefined;
  }
  const normalizedAgentId = normalizeAgentId(agentIdPart);
  if (normalizedAgentId !== agentIdPart.toLowerCase()) {
    return undefined;
  }
  if (normalizedAgentId !== normalizeAgentId(expectedAgentId)) {
    return undefined;
  }
  const relativeSegments = parts.slice(sessionsIndex + 1);
  // Session transcripts are stored as direct files in "sessions/".
  if (relativeSegments.length !== 1) {
    return undefined;
  }
  const fileName = relativeSegments[0];
  if (!fileName || fileName === "." || fileName === "..") {
    return undefined;
  }
  return path.normalize(path.resolve(candidateAbsPath));
}

function safeRealpathSync(filePath: string): string | undefined {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return undefined;
  }
}

function resolvePathWithinSessionsDir(
  sessionsDir: string,
  candidate: string,
  opts?: { agentId?: string },
): string {
  const trimmed = candidate.trim();
  if (!trimmed) {
    throw new Error("Session file path must not be empty");
  }
  const resolvedBase = path.resolve(sessionsDir);
  const realBase = safeRealpathSync(resolvedBase) ?? resolvedBase;
  // Normalize absolute paths that are within the sessions directory.
  // Older versions stored absolute sessionFile paths in sessions.json;
  // convert them to relative so the containment check passes.
  const realTrimmed = path.isAbsolute(trimmed) ? (safeRealpathSync(trimmed) ?? trimmed) : trimmed;
  const normalized = path.isAbsolute(realTrimmed)
    ? path.relative(realBase, realTrimmed)
    : realTrimmed;
  if (normalized.startsWith("..") && path.isAbsolute(realTrimmed)) {
    const tryAgentFallback = (agentId: string): string | undefined => {
      const normalizedAgentId = normalizeAgentId(agentId);
      const siblingSessionsDir = resolveSiblingAgentSessionsDir(realBase, normalizedAgentId);
      if (siblingSessionsDir) {
        const siblingResolved = resolvePathFromAgentSessionsDir(siblingSessionsDir, realTrimmed);
        if (siblingResolved) {
          return siblingResolved;
        }
      }
      return resolvePathFromAgentSessionsDir(
        resolveAgentSessionsDir(normalizedAgentId),
        realTrimmed,
      );
    };

    const explicitAgentId = opts?.agentId?.trim();
    if (explicitAgentId) {
      const resolvedFromAgent = tryAgentFallback(explicitAgentId);
      if (resolvedFromAgent) {
        return resolvedFromAgent;
      }
    }
    const extractedAgentId = extractAgentIdFromAbsoluteSessionPath(realTrimmed);
    if (extractedAgentId) {
      const resolvedFromPath = tryAgentFallback(extractedAgentId);
      if (resolvedFromPath) {
        return resolvedFromPath;
      }
      // Cross-root compatibility for older absolute paths:
      // keep only canonical .../agents/<agentId>/sessions/<file> shapes.
      const structuralFallback = resolveStructuralSessionFallbackPath(
        realTrimmed,
        extractedAgentId,
      );
      if (structuralFallback) {
        return structuralFallback;
      }
    }
  }
  if (!normalized || normalized.startsWith("..") || path.isAbsolute(normalized)) {
    throw new Error("Session file path must be within sessions directory");
  }
  return path.resolve(realBase, normalized);
}

export function resolveSessionTranscriptPathInDir(
  sessionId: string,
  sessionsDir: string,
  topicId?: string | number,
): string {
  const safeSessionId = validateSessionId(sessionId);
  const safeTopicId =
    typeof topicId === "string"
      ? encodeURIComponent(topicId)
      : typeof topicId === "number"
        ? String(topicId)
        : undefined;
  const fileName =
    safeTopicId !== undefined
      ? `${safeSessionId}-topic-${safeTopicId}.jsonl`
      : `${safeSessionId}.jsonl`;
  return resolvePathWithinSessionsDir(sessionsDir, fileName);
}

export function resolveSessionTranscriptPath(
  sessionId: string,
  agentId?: string,
  topicId?: string | number,
): string {
  return resolveSessionTranscriptPathInDir(sessionId, resolveAgentSessionsDir(agentId), topicId);
}

export function resolveSessionFilePath(
  sessionId: string,
  entry?: { sessionFile?: string },
  opts?: SessionFilePathOptions,
): string {
  const sessionsDir = resolveSessionsDir(opts);
  const candidate = entry?.sessionFile?.trim();
  const explicitSessionsDir = Boolean(opts?.sessionsDir?.trim());
  if (candidate) {
    try {
      const resolved = resolvePathWithinSessionsDir(sessionsDir, candidate, {
        agentId: opts?.agentId,
      });
      // When callers pin an explicit sessionsDir (tenant managed store), structural
      // fallback must not jump to a different state root (global ~/.openbot/agents).
      // Compare via realpath so macOS /var vs /private/var aliases stay in-bounds.
      if (explicitSessionsDir) {
        const resolvedBase = path.resolve(sessionsDir);
        const realBase = safeRealpathSync(resolvedBase) ?? resolvedBase;
        const realResolved = safeRealpathSync(resolved) ?? resolved;
        const relative = path.relative(realBase, realResolved);
        if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
          return resolveSessionTranscriptPathInDir(sessionId, sessionsDir);
        }
      }
      return resolved;
    } catch {
      // Keep handlers alive when persisted metadata is stale/corrupt.
    }
  }
  return resolveSessionTranscriptPathInDir(sessionId, sessionsDir);
}

export function resolveStorePath(store?: string, opts?: { agentId?: string }) {
  const agentId = normalizeAgentId(opts?.agentId ?? DEFAULT_AGENT_ID);
  if (!store) {
    return resolveDefaultSessionStorePath(agentId);
  }
  if (store.includes("{agentId}")) {
    const expanded = store.replaceAll("{agentId}", agentId);
    if (expanded.startsWith("~")) {
      return path.resolve(
        expandHomePrefix(expanded, {
          home: resolveRequiredHomeDir(process.env, os.homedir),
          env: process.env,
          homedir: os.homedir,
        }),
      );
    }
    return path.resolve(expanded);
  }
  if (store.startsWith("~")) {
    return path.resolve(
      expandHomePrefix(store, {
        home: resolveRequiredHomeDir(process.env, os.homedir),
        env: process.env,
        homedir: os.homedir,
      }),
    );
  }
  return path.resolve(store);
}
