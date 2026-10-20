import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { CURRENT_SESSION_VERSION } from "@earendil-works/pi-coding-agent";
import type { OpenBotConfig } from "../../config/config.js";
import { loadSessionStore, updateSessionStore } from "../../config/sessions.js";
import { assertNoPrivateRunBagInPublicPayload } from "../collaboration-dispatch/private-run-bag.js";
import { listRedundantGroupMirrorKeys } from "../server-methods/collaboration-space-session-entry.js";
import { resolveSessionTranscriptCandidates } from "../session-utils.js";
import { listTenantAgentSessionsDirs } from "../tenant-store-paths.js";
import {
  isGroupPublicTranscriptSessionFile,
  materializeGroupCollaborationWorkspace,
  resolveGroupPublicTranscriptPath,
} from "./collaboration-paths.js";
import { rewriteOpenclawPathToOpenbotIfPresent } from "./openbot-path-rewrite.js";
import { assertNoPrivateMemoryDirtyWriteToGroupPublic } from "./private-memory-promote.js";
import { resolveSessionParticipationGroupId } from "./session-participation-overlay.js";
import type { SessionParticipationOverlayField } from "./session-participation-overlay.js";

const healLocks = new Map<string, Promise<string>>();

function matchesGroupPublicSession(params: {
  key: string;
  entry: {
    sessionId?: string;
    groupId?: string;
    space?: string;
    sessionFile?: string;
    collaborationGroupProfile?: { groupId?: string };
    collaborationParticipationOverlay?: SessionParticipationOverlayField;
  };
  groupId: string;
}): boolean {
  const normalizedGroupId = params.groupId.trim().toLowerCase();
  const normalizedKey = params.key.trim().toLowerCase();
  if (normalizedKey === `space:${normalizedGroupId}`) {
    return true;
  }
  if (normalizedKey.endsWith(`:space:${normalizedGroupId}`)) {
    return true;
  }
  const candidates = [
    params.entry.groupId,
    params.entry.space,
    params.entry.collaborationGroupProfile?.groupId,
    resolveSessionParticipationGroupId(params.entry.collaborationParticipationOverlay),
  ]
    .map((value) => value?.trim().toLowerCase())
    .filter(Boolean);
  return candidates.includes(normalizedGroupId);
}

type TranscriptLine = {
  raw: string;
  kind: "session" | "message" | "other";
  dedupeKey?: string;
  timestampMs?: number;
};

function canonicalizePath(filePath: string): string {
  const resolved = path.resolve(filePath);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function messageDedupeKey(message: Record<string, unknown>): string {
  const id = typeof message.id === "string" ? message.id.trim() : "";
  if (id) {
    return `id:${id}`;
  }
  const role = typeof message.role === "string" ? message.role : "";
  const timestamp = message.timestamp;
  const ts =
    typeof timestamp === "number"
      ? String(timestamp)
      : typeof timestamp === "string"
        ? timestamp
        : "";
  const content = JSON.stringify(message.content ?? message.text ?? "");
  const digest = createHash("sha256").update(`${role}\0${ts}\0${content}`, "utf8").digest("hex");
  return `h:${digest.slice(0, 24)}`;
}

function messageTimestampMs(message: Record<string, unknown>): number {
  const timestamp = message.timestamp;
  if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
    return timestamp;
  }
  if (typeof timestamp === "string" && timestamp.trim()) {
    const parsed = Date.parse(timestamp);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function parseTranscriptLine(raw: string): TranscriptLine | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (parsed?.type === "session") {
      return { raw: trimmed, kind: "session" };
    }
    const message =
      parsed && typeof parsed.message === "object" && parsed.message
        ? (parsed.message as Record<string, unknown>)
        : parsed;
    if (message && typeof message === "object" && typeof message.role === "string") {
      return {
        raw: trimmed,
        kind: "message",
        dedupeKey: messageDedupeKey(message),
        timestampMs: messageTimestampMs(message),
      };
    }
    return { raw: trimmed, kind: "other" };
  } catch {
    return { raw: trimmed, kind: "other" };
  }
}

function readTranscriptLines(filePath: string): TranscriptLine[] {
  try {
    const text = fs.readFileSync(filePath, "utf-8");
    return text
      .split("\n")
      .map((line) => parseTranscriptLine(line))
      .filter((line): line is TranscriptLine => Boolean(line));
  } catch {
    return [];
  }
}

function buildSessionHeaderLine(sessionId: string): string {
  return JSON.stringify({
    type: "session",
    version: CURRENT_SESSION_VERSION,
    id: sessionId,
    timestamp: new Date().toISOString(),
    cwd: process.cwd(),
  });
}

function writeTranscriptAtomically(filePath: string, body: string): void {
  // P0 follow-up: refuse private run bag content on GROUP_PUBLIC write path.
  assertNoPrivateRunBagInPublicPayload(body, "GROUP_PUBLIC transcript write");
  // P3: refuse private LTM dirty writes and private-DM history mirrors.
  assertNoPrivateMemoryDirtyWriteToGroupPublic(body, "GROUP_PUBLIC transcript write");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, body, { encoding: "utf-8", mode: 0o600 });
  fs.renameSync(tmpPath, filePath);
}

function fileHasMessageLines(filePath: string): boolean {
  return readTranscriptLines(filePath).some((line) => line.kind === "message");
}

async function collectLegacyTranscriptCandidates(params: {
  groupId: string;
  sessionId: string;
  storePath: string;
  existingSessionFile?: string;
  tenantId?: string | null;
  sharedTranscriptPath: string;
}): Promise<string[]> {
  const sharedCanon = canonicalizePath(params.sharedTranscriptPath);
  const candidates = new Set<string>();
  const push = (candidate: string | null | undefined) => {
    const trimmed = candidate?.trim();
    if (!trimmed) {
      return;
    }
    const resolved = path.resolve(trimmed);
    if (canonicalizePath(resolved) === sharedCanon) {
      return;
    }
    candidates.add(resolved);
  };

  push(
    params.existingSessionFile
      ? rewriteOpenclawPathToOpenbotIfPresent(params.existingSessionFile)
      : params.existingSessionFile,
  );
  push(params.existingSessionFile);
  push(path.join(path.dirname(params.storePath), `${params.sessionId}.jsonl`));

  const considerStore = (storePath: string) => {
    try {
      if (!fs.existsSync(storePath)) {
        return;
      }
      const store = loadSessionStore(storePath);
      for (const [key, entry] of Object.entries(store)) {
        if (!entry) {
          continue;
        }
        if (!matchesGroupPublicSession({ key, entry, groupId: params.groupId })) {
          continue;
        }
        push(entry.sessionFile);
        if (!entry.sessionId) {
          continue;
        }
        for (const candidate of resolveSessionTranscriptCandidates(
          entry.sessionId,
          storePath,
          entry.sessionFile,
        )) {
          push(candidate);
        }
      }
    } catch {
      // best-effort scan
    }
  };

  considerStore(params.storePath);
  for (const extraStore of discoverAgentSessionStores(params.storePath)) {
    considerStore(extraStore);
  }

  if (params.tenantId?.trim()) {
    try {
      const dirs = await listTenantAgentSessionsDirs({
        tenantId: params.tenantId.trim(),
        agentId: "main",
      });
      for (const dir of dirs) {
        push(path.join(dir, `${params.sessionId}.jsonl`));
        considerStore(path.join(dir, "sessions.json"));
      }
    } catch {
      // best-effort cross-user scan
    }
  }

  return [...candidates].filter((candidate) => {
    try {
      return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
}

function leftoverTranscriptOutranksShared(params: {
  leftoverFiles: string[];
  sharedTranscriptPath: string;
}): boolean {
  const sharedSize = fileHasMessageLines(params.sharedTranscriptPath)
    ? fs.statSync(params.sharedTranscriptPath).size
    : 0;
  return params.leftoverFiles.some((file) => {
    try {
      return fs.statSync(file).size > sharedSize;
    } catch {
      return false;
    }
  });
}

function resolveAgentsDirFromStorePath(storePath: string): string | null {
  let cursor = path.resolve(path.dirname(storePath));
  for (let i = 0; i < 8; i++) {
    if (path.basename(cursor) === "agents") {
      return cursor;
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) {
      break;
    }
    cursor = parent;
  }
  return path.resolve(path.dirname(storePath), "../..");
}

function discoverAgentSessionStores(storePath: string): string[] {
  const agentsDir = resolveAgentsDirFromStorePath(storePath);
  const stores = new Set<string>([path.resolve(storePath)]);
  if (!agentsDir) {
    return [...stores];
  }
  try {
    for (const name of fs.readdirSync(agentsDir, { withFileTypes: true })) {
      if (!name.isDirectory()) {
        continue;
      }
      const candidate = path.join(agentsDir, name.name, "sessions", "sessions.json");
      if (fs.existsSync(candidate)) {
        stores.add(path.resolve(candidate));
      }
    }
  } catch {
    // Primary store still participates even if the agents tree is missing.
  }
  return [...stores];
}

export async function retireRedundantGroupTranscriptMirrors(params: {
  groupId: string;
  storePath: string;
  sharedTranscriptPath: string;
}): Promise<{ retiredKeys: string[]; deletedFiles: string[] }> {
  const retiredKeys: string[] = [];
  const deletedFiles: string[] = [];
  const sharedResolved = path.resolve(params.sharedTranscriptPath);
  for (const storeFile of discoverAgentSessionStores(params.storePath)) {
    const retiredForStore = await updateSessionStore(storeFile, (store) => {
      const keys = listRedundantGroupMirrorKeys(store, params.groupId);
      const files = new Set<string>();
      for (const key of keys) {
        const leftoverRaw = store[key]?.sessionFile?.trim();
        const leftover = leftoverRaw ? rewriteOpenclawPathToOpenbotIfPresent(leftoverRaw) : "";
        if (leftover && path.resolve(leftover) !== sharedResolved) {
          files.add(path.resolve(leftover));
        }
        delete store[key];
      }
      return { keys, files: [...files] };
    });
    retiredKeys.push(...retiredForStore.keys);
    for (const leftoverFile of retiredForStore.files) {
      try {
        await fsp.unlink(leftoverFile);
        deletedFiles.push(leftoverFile);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }
    }
  }
  return { retiredKeys, deletedFiles };
}

function mergeTranscriptSources(params: {
  sessionId: string;
  sharedTranscriptPath: string;
  legacyPaths: string[];
}): { wrote: boolean; messageCount: number } {
  const sources = [
    params.sharedTranscriptPath,
    ...params.legacyPaths.filter(
      (candidate) => canonicalizePath(candidate) !== canonicalizePath(params.sharedTranscriptPath),
    ),
  ].filter((candidate) => {
    try {
      return fs.existsSync(candidate);
    } catch {
      return false;
    }
  });

  if (sources.length === 0) {
    return { wrote: false, messageCount: 0 };
  }

  let sessionHeader: string | null = null;
  const otherLines: string[] = [];
  const messages: TranscriptLine[] = [];
  const seen = new Set<string>();

  for (const source of sources) {
    for (const line of readTranscriptLines(source)) {
      if (line.kind === "session") {
        if (!sessionHeader) {
          sessionHeader = line.raw;
        }
        continue;
      }
      if (line.kind === "message" && line.dedupeKey) {
        if (seen.has(line.dedupeKey)) {
          continue;
        }
        seen.add(line.dedupeKey);
        messages.push(line);
        continue;
      }
      otherLines.push(line.raw);
    }
  }

  messages.sort((a, b) => (a.timestampMs ?? 0) - (b.timestampMs ?? 0));
  const body = [
    sessionHeader ?? buildSessionHeaderLine(params.sessionId),
    ...otherLines,
    ...messages.map((line) => line.raw),
  ]
    .filter(Boolean)
    .join("\n")
    .concat("\n");

  const existing = fs.existsSync(params.sharedTranscriptPath)
    ? fs.readFileSync(params.sharedTranscriptPath, "utf-8")
    : "";
  if (existing === body) {
    return { wrote: false, messageCount: messages.length };
  }
  writeTranscriptAtomically(params.sharedTranscriptPath, body);
  return { wrote: true, messageCount: messages.length };
}

/**
 * Delete per-agent transcript mirrors that are not the shared GROUP_PUBLIC file.
 * Checkpoint restore truncates the shared file; these mirrors still hold the
 * tail and would be merged back on the next unbound heal.
 */
export async function dropDivergentGroupTranscriptMirrors(params: {
  groupId: string;
  sessionId: string;
  storePath: string;
  sharedTranscriptPath: string;
  tenantId?: string | null;
  cfg?: OpenBotConfig;
}): Promise<void> {
  const legacyPaths = await collectLegacyTranscriptCandidates({
    groupId: params.groupId,
    sessionId: params.sessionId,
    storePath: params.storePath,
    tenantId: params.tenantId,
    sharedTranscriptPath: params.sharedTranscriptPath,
  });
  const shared = canonicalizePath(params.sharedTranscriptPath);
  for (const file of legacyPaths) {
    if (canonicalizePath(file) === shared) {
      continue;
    }
    try {
      await fsp.unlink(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }
}

/**
 * Bind `space:{groupId}` session metadata to the member-shared transcript file,
 * lazily merging any per-user legacy `space-*.jsonl` copies for the same group.
 *
 * Callers must still enforce membership ACL before reading or writing.
 */
/** Return the shared transcript when this entry is already bound and the file exists. */
export function resolveBoundGroupPublicTranscriptPath(params: {
  groupId: string;
  existingSessionFile?: string;
  cfg?: OpenBotConfig;
}): string | null {
  const groupId = params.groupId.trim();
  if (!groupId) {
    return null;
  }
  const rawSharedTranscriptPath = resolveGroupPublicTranscriptPath(groupId, params.cfg);
  const sharedTranscriptPath = rewriteOpenclawPathToOpenbotIfPresent(rawSharedTranscriptPath);
  const existingSessionFile = params.existingSessionFile?.trim() ?? "";
  if (!existingSessionFile) {
    return null;
  }
  // Require the stored path to already be the live shared file. Rewriting a
  // leftover .openclaw path can hide a workspace cutover that still needs a heal.
  if (path.resolve(existingSessionFile) !== path.resolve(sharedTranscriptPath)) {
    return null;
  }
  if (!fs.existsSync(sharedTranscriptPath)) {
    return null;
  }
  return sharedTranscriptPath;
}

export async function bindGroupPublicTranscript(params: {
  groupId: string;
  sessionId: string;
  storePath: string;
  existingSessionFile?: string;
  tenantId?: string | null;
  cfg?: OpenBotConfig;
}): Promise<string> {
  const groupId = params.groupId.trim();
  if (!groupId) {
    throw new Error("groupId is required");
  }
  const sessionId = params.sessionId.trim();
  if (!sessionId) {
    throw new Error("sessionId is required");
  }

  const alreadyBound = resolveBoundGroupPublicTranscriptPath({
    groupId,
    existingSessionFile: params.existingSessionFile,
    cfg: params.cfg,
  });

  const prior = healLocks.get(groupId);
  const run = (async () => {
    if (prior) {
      try {
        await prior;
      } catch {
        // previous heal failed — continue
      }
    }
    if (alreadyBound) {
      // Shared transcript is the room's source of truth once bound. A larger
      // per-agent mirror (`sessions/<sessionId>.jsonl`) is the file the model
      // used to open before GROUP_PUBLIC path resolution. Merging it back
      // resurrects turns that checkpoint restore just truncated.
      await retireRedundantGroupTranscriptMirrors({
        groupId,
        storePath: params.storePath,
        sharedTranscriptPath: alreadyBound,
      });
      return alreadyBound;
    }
    const rawSharedTranscriptPath = resolveGroupPublicTranscriptPath(groupId, params.cfg);
    const existingSessionFile = params.existingSessionFile
      ? rewriteOpenclawPathToOpenbotIfPresent(params.existingSessionFile)
      : params.existingSessionFile;
    let sharedTranscriptPath = rewriteOpenclawPathToOpenbotIfPresent(rawSharedTranscriptPath);
    if (
      existingSessionFile &&
      isGroupPublicTranscriptSessionFile(existingSessionFile) &&
      fs.existsSync(existingSessionFile) &&
      (!fs.existsSync(sharedTranscriptPath) ||
        leftoverTranscriptOutranksShared({
          leftoverFiles: [existingSessionFile],
          sharedTranscriptPath,
        }))
    ) {
      sharedTranscriptPath = path.resolve(existingSessionFile);
    }
    const legacyPaths = await collectLegacyTranscriptCandidates({
      groupId,
      sessionId,
      storePath: params.storePath,
      existingSessionFile,
      tenantId: params.tenantId,
      sharedTranscriptPath,
    });
    const leftoversOutrank = leftoverTranscriptOutranksShared({
      leftoverFiles: legacyPaths,
      sharedTranscriptPath,
    });
    // Prefer the live .openbot tree. Do not mkdir an empty .openclaw transcript as SoT.
    if (
      isGroupPublicTranscriptSessionFile(sharedTranscriptPath) &&
      fs.existsSync(sharedTranscriptPath)
    ) {
      // Keep the already-live public file; do not materialize a second root.
    } else if (path.resolve(sharedTranscriptPath) !== path.resolve(rawSharedTranscriptPath)) {
      await fsp.mkdir(path.dirname(sharedTranscriptPath), { recursive: true });
    } else {
      await materializeGroupCollaborationWorkspace(groupId, params.cfg);
    }

    const sharedExists = fs.existsSync(sharedTranscriptPath);
    const legacyHasMessages = legacyPaths.some((candidate) => fileHasMessageLines(candidate));

    if (!sharedExists || legacyHasMessages || leftoversOutrank) {
      mergeTranscriptSources({
        sessionId,
        sharedTranscriptPath,
        legacyPaths,
      });
    }

    if (!fs.existsSync(sharedTranscriptPath)) {
      writeTranscriptAtomically(sharedTranscriptPath, `${buildSessionHeaderLine(sessionId)}\n`);
    }

    await retireRedundantGroupTranscriptMirrors({
      groupId,
      storePath: params.storePath,
      sharedTranscriptPath,
    });
    return sharedTranscriptPath;
  })();

  healLocks.set(
    groupId,
    run.then(
      (value) => value,
      async () => resolveGroupPublicTranscriptPath(groupId, params.cfg),
    ),
  );
  return run;
}

/** Test helper: clear in-process heal locks. */
export function resetGroupPublicTranscriptHealLocksForTests(): void {
  healLocks.clear();
}

/** Ensure parent runtime dir exists (no-op if already materialized). */
export async function ensureGroupPublicTranscriptParent(
  groupId: string,
  cfg?: OpenBotConfig,
): Promise<string> {
  await materializeGroupCollaborationWorkspace(groupId, cfg);
  const transcriptPath = resolveGroupPublicTranscriptPath(groupId, cfg);
  await fsp.mkdir(path.dirname(transcriptPath), { recursive: true });
  return transcriptPath;
}
