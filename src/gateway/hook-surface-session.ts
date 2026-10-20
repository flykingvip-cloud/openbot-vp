import { randomUUID } from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
  resolveAgentMainSessionKey,
  resolveSessionFilePath,
  resolveSessionTranscriptPathInDir,
  resolveStorePath,
  updateSessionStore,
} from "../config/sessions.js";
import type { SessionEntry } from "../config/sessions/types.js";
import type { OpenBotConfig } from "../config/types.js";
import { normalizeAgentId, parseAgentSessionKey } from "../routing/session-key.js";

export type HookSurfaceTranscriptResult =
  | { ok: true; sessionKey: string; sessionId: string; sessionFile: string }
  | { ok: false; reason: HookSurfaceRejectReason };

export type HookSurfaceRejectReason =
  | "session_key_rejected"
  | "tenant_mismatch"
  | "path_rejected"
  | "workspace_unresolved";

/** Hook dispatch keys are minted by the gateway, never by model text. */
export function isHookDispatchSessionKey(sessionKey: string | undefined): boolean {
  return (sessionKey ?? "").trim().toLowerCase().startsWith("hook:");
}

function pathStaysInside(root: string, target: string): boolean {
  const resolvedRoot = path.resolve(root);
  let canonicalRoot = resolvedRoot;
  try {
    canonicalRoot = fsSync.realpathSync(resolvedRoot);
  } catch {
    // The sessions directory is created before the first transcript.
  }
  const relative = path.relative(canonicalRoot, path.resolve(target));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/**
 * Register the agent main workbench session and create its transcript header.
 * Only the exact main key for this agent is accepted. An escaping sessionFile
 * is rejected instead of rewritten onto another directory.
 */
export async function ensureHookSurfaceTranscript(params: {
  cfg: OpenBotConfig;
  agentId: string;
  sessionKey: string;
  workspaceDir: string;
  tenantId?: string;
}): Promise<HookSurfaceTranscriptResult> {
  const agentId = normalizeAgentId(params.agentId);
  const sessionKey = params.sessionKey.trim();
  const workspaceDir = params.workspaceDir.trim();
  if (!agentId || !sessionKey || !workspaceDir) {
    return { ok: false, reason: workspaceDir ? "session_key_rejected" : "workspace_unresolved" };
  }
  const expectedKey = resolveAgentMainSessionKey({ cfg: params.cfg, agentId });
  const parsed = parseAgentSessionKey(sessionKey);
  if (sessionKey !== expectedKey || !parsed || parsed.agentId !== agentId) {
    return { ok: false, reason: "session_key_rejected" };
  }

  const storePath = resolveStorePath(params.cfg.session?.store, { agentId });
  const sessionsDir = path.dirname(storePath);
  const tenantId = params.tenantId?.trim();
  const locked = await updateSessionStore(storePath, (store) =>
    assignHookSurfaceEntry({
      store,
      sessionKey: expectedKey,
      sessionsDir,
      tenantId,
    }),
  );
  if (!locked.ok) {
    return locked;
  }
  await createTranscriptHeaderExclusive({
    sessionFile: locked.sessionFile,
    sessionId: locked.sessionId,
    cwd: workspaceDir,
  });
  return locked;
}

function assignHookSurfaceEntry(params: {
  store: Record<string, SessionEntry>;
  sessionKey: string;
  sessionsDir: string;
  tenantId?: string;
}): HookSurfaceTranscriptResult {
  const existing = params.store[params.sessionKey];
  const existingTenant = existing?.origin?.accountId?.trim();
  if (params.tenantId && existingTenant && existingTenant !== params.tenantId) {
    return { ok: false, reason: "tenant_mismatch" };
  }
  const sessionId = existing?.sessionId?.trim() || randomUUID();
  const containedFile = resolveSessionTranscriptPathInDir(sessionId, params.sessionsDir);
  let sessionFile = containedFile;
  if (existing?.sessionFile?.trim()) {
    const rawFile = existing.sessionFile.trim();
    const alreadyInside = path.isAbsolute(rawFile) && pathStaysInside(params.sessionsDir, rawFile);
    if (
      !alreadyInside &&
      (path.isAbsolute(rawFile) || rawFile.includes("..") || rawFile.includes("\0"))
    ) {
      return { ok: false, reason: "path_rejected" };
    }
    try {
      sessionFile = resolveSessionFilePath(
        sessionId,
        { sessionFile: existing.sessionFile },
        { sessionsDir: params.sessionsDir },
      );
    } catch {
      return { ok: false, reason: "path_rejected" };
    }
  }
  if (!pathStaysInside(params.sessionsDir, sessionFile)) {
    return { ok: false, reason: "path_rejected" };
  }
  params.store[params.sessionKey] = {
    ...existing,
    sessionId,
    updatedAt: Date.now(),
    sessionFile,
    ...(params.tenantId ? { origin: { ...existing?.origin, accountId: params.tenantId } } : {}),
  };
  return {
    ok: true,
    sessionKey: params.sessionKey,
    sessionId,
    sessionFile,
  };
}

/** Exclusive create. A racing writer leaves the first header intact. */
async function createTranscriptHeaderExclusive(params: {
  sessionFile: string;
  sessionId: string;
  cwd: string;
}): Promise<void> {
  await fs.mkdir(path.dirname(params.sessionFile), { recursive: true });
  const header = `${JSON.stringify({
    type: "session",
    version: 2,
    id: params.sessionId,
    timestamp: new Date().toISOString(),
    cwd: params.cwd,
  })}\n`;
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(params.sessionFile, "wx", 0o600);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EEXIST") {
      return;
    }
    throw err;
  }
  try {
    await handle.writeFile(header, "utf8");
  } finally {
    await handle.close();
  }
}
