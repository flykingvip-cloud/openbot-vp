/**
 * `openbot data forget` — unified local-deletion entry point
 * (security review 2026-08, suggestion 4 / F-3).
 *
 * Operator-initiated, non-transactional: enumerate targets, delete per store,
 * report success/skip/failure per path. Scope semantics:
 *
 * - `session`: remove matching entries from every agent's sessions.json and
 *   delete the session's transcript JSONL files (topics + reset archives).
 * - `agent`: delete the agent's runtime sessions dir (sessions.json + JSONL)
 *   and its Data Space dir (memory artifacts incl. CogniWeave sqlite files).
 *   Credentials / auth profiles under `agents/<id>/agent` are NOT touched.
 * - `tenant`: delete the tenant live root under the tenants store
 *   (control-plane stores + per-user data), guarded by assertSafeTenantId.
 *
 * Managed data mode (`data.mode=managed`) fails closed for session/agent
 * scopes: the SaaS L2 data plane cannot be cleared from this CLI and we do
 * not pretend local deletion clears it. Tenant scope stays available because
 * the tenants root IS the managed store on the gateway host.
 */

import fs from "node:fs";
import path from "node:path";
import { listAgentIds } from "../agents/agent-scope.js";
import type { OpenBotConfig } from "../config/config.js";
import { resolveDataMode, resolveDataRoot } from "../config/data-space.js";
import {
  resolveSessionTranscriptsDirForAgent,
  resolveStorePath,
  validateSessionId,
} from "../config/sessions/paths.js";
import { loadSessionStore, updateSessionStore } from "../config/sessions/store.js";
import { resolveAgentDataSpaceDir } from "../data/memory-lifecycle.js";
import {
  assertSafeTenantId,
  resolveTenantLiveRoot,
  resolveTenantsRoot,
} from "../gateway/tenant-store-paths.js";
import { resolvePreferredOpenBotTmpDir } from "../infra/tmp-openclaw-dir.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

export type ForgetScope = "session" | "agent" | "tenant";

export type ForgetTarget = {
  path: string;
  kind: "file" | "dir";
  exists: boolean;
  description: string;
};

export type ForgetStoreEdit = {
  storePath: string;
  keys: string[];
};

export type ForgetPlan = {
  scope: ForgetScope;
  id: string;
  targets: ForgetTarget[];
  storeEdits: ForgetStoreEdit[];
};

export type ForgetReport = {
  deleted: string[];
  skipped: string[];
  failed: Array<{ path: string; error: string }>;
  removedStoreKeys: Array<{ storePath: string; keys: string[] }>;
};

const FORGET_SCOPES: ReadonlySet<string> = new Set(["session", "agent", "tenant"]);

const logger = createSubsystemLogger("data-forget");

export function parseForgetScope(value: string): ForgetScope {
  const trimmed = value.trim().toLowerCase();
  if (!FORGET_SCOPES.has(trimmed)) {
    throw new Error(`invalid --scope "${value}" (expected session | agent | tenant)`);
  }
  return trimmed as ForgetScope;
}

/** Reject ids that could escape a directory when joined into a path. */
export function assertSafeForgetId(id: string): string {
  const trimmed = id.trim();
  if (
    !trimmed ||
    trimmed === "." ||
    trimmed === ".." ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed.includes("\u0000") ||
    trimmed.includes("..")
  ) {
    throw new Error(`invalid --id "${id}" (path separators and ".." are not allowed)`);
  }
  return trimmed;
}

function statTarget(targetPath: string): { kind: "file" | "dir"; exists: boolean } {
  try {
    const st = fs.lstatSync(targetPath);
    return { kind: st.isDirectory() ? "dir" : "file", exists: true };
  } catch {
    return { kind: "file", exists: false };
  }
}

function pushTarget(targets: ForgetTarget[], targetPath: string, description: string): void {
  if (targets.some((entry) => entry.path === targetPath)) {
    return;
  }
  const { kind, exists } = statTarget(targetPath);
  targets.push({ path: targetPath, kind, exists, description });
}

/** List transcript files (main, topics, reset archives) for a session id in a sessions dir. */
function listSessionTranscriptFiles(sessionsDir: string, sessionId: string): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(sessionsDir);
  } catch {
    return [];
  }
  const mainPrefix = `${sessionId}.jsonl`;
  const topicPrefix = `${sessionId}-topic-`;
  return names
    .filter(
      (name) =>
        name === mainPrefix || name.startsWith(`${mainPrefix}.`) || name.startsWith(topicPrefix),
    )
    .map((name) => path.join(sessionsDir, name));
}

function failManagedDataPlane(scope: ForgetScope): never {
  throw new Error(
    `data.mode=managed: the ${scope} data plane is managed by OpenBot cloud and cannot be forgotten from this CLI (fail-closed). No local files were touched.`,
  );
}

/** Enumerate everything `data forget` would delete for the given scope/id. */
export function resolveForgetPlan(params: {
  cfg: OpenBotConfig;
  scope: ForgetScope;
  id: string;
  purgeTemp?: boolean;
  env?: NodeJS.ProcessEnv;
}): ForgetPlan {
  const id = assertSafeForgetId(params.id);
  const targets: ForgetTarget[] = [];
  const storeEdits: ForgetStoreEdit[] = [];
  const managed = resolveDataMode(params.cfg, params.env ?? process.env) === "managed";

  if (params.scope === "session") {
    if (managed) {
      failManagedDataPlane("session");
    }
    for (const agentId of listAgentIds(params.cfg)) {
      const storePath = resolveStorePath(params.cfg.session?.store, { agentId });
      let store: Record<string, { sessionId?: string }>;
      try {
        store = loadSessionStore(storePath, { skipCache: true });
      } catch {
        continue;
      }
      const matchedKeys = Object.keys(store).filter(
        (key) => key === id || store[key]?.sessionId === id,
      );
      if (matchedKeys.length === 0) {
        continue;
      }
      storeEdits.push({ storePath, keys: matchedKeys });
      const sessionsDir = path.dirname(storePath);
      for (const key of matchedKeys) {
        const rawSessionId = store[key]?.sessionId;
        if (!rawSessionId) {
          continue;
        }
        let sessionId: string;
        try {
          sessionId = validateSessionId(rawSessionId);
        } catch {
          continue;
        }
        for (const file of listSessionTranscriptFiles(sessionsDir, sessionId)) {
          pushTarget(targets, file, `session transcript (agent ${agentId})`);
        }
      }
    }
  } else if (params.scope === "agent") {
    if (managed) {
      failManagedDataPlane("agent");
    }
    pushTarget(
      targets,
      resolveSessionTranscriptsDirForAgent(id),
      "agent runtime sessions dir (sessions.json + transcripts)",
    );
    pushTarget(
      targets,
      resolveAgentDataSpaceDir(resolveDataRoot(params.cfg), id),
      "agent Data Space dir (memory artifacts)",
    );
  } else {
    // Tenant scope: the tenants root IS the managed store; allow in both modes.
    assertSafeTenantId(id);
    const liveRoot = resolveTenantLiveRoot(id, params.env);
    const tenantsRoot = path.resolve(resolveTenantsRoot(params.env));
    const rel = path.relative(tenantsRoot, path.resolve(liveRoot));
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(`tenant root resolution escaped the tenants root: ${liveRoot}`);
    }
    pushTarget(targets, liveRoot, "tenant live root (control-plane stores + user data)");
  }

  if (params.purgeTemp) {
    // Transient media cannot be attributed to a single id; purge the whole
    // OpenBot-managed temp root contents (SECURITY.md Temp Folder Boundary).
    try {
      const tempRoot = resolvePreferredOpenBotTmpDir();
      for (const name of fs.readdirSync(tempRoot)) {
        pushTarget(targets, path.join(tempRoot, name), "OpenBot-managed temp root entry");
      }
    } catch {
      // temp root unavailable — nothing to purge
    }
  }

  return { scope: params.scope, id, targets, storeEdits };
}

/** Execute a forget plan: remove store entries, then delete files/dirs. Non-transactional. */
export async function executeForgetPlan(plan: ForgetPlan): Promise<ForgetReport> {
  const report: ForgetReport = { deleted: [], skipped: [], failed: [], removedStoreKeys: [] };

  for (const edit of plan.storeEdits) {
    try {
      const removed = await updateSessionStore(edit.storePath, (store) => {
        const actuallyRemoved: string[] = [];
        for (const key of edit.keys) {
          if (key in store) {
            delete store[key];
            actuallyRemoved.push(key);
          }
        }
        return actuallyRemoved;
      });
      report.removedStoreKeys.push({ storePath: edit.storePath, keys: removed });
      logger.info(
        `[data-forget] scope=${plan.scope} id=${plan.id} removed ${removed.length} entr${removed.length === 1 ? "y" : "ies"} from ${edit.storePath}`,
      );
    } catch (err) {
      report.failed.push({ path: edit.storePath, error: String(err) });
      logger.error(`[data-forget] failed to edit session store ${edit.storePath}: ${String(err)}`);
    }
  }

  for (const target of plan.targets) {
    if (!target.exists) {
      report.skipped.push(target.path);
      continue;
    }
    try {
      fs.rmSync(target.path, { recursive: true, force: true });
      report.deleted.push(target.path);
      logger.info(
        `[data-forget] scope=${plan.scope} id=${plan.id} deleted ${target.kind} ${target.path}`,
      );
    } catch (err) {
      report.failed.push({ path: target.path, error: String(err) });
      logger.error(`[data-forget] failed to delete ${target.path}: ${String(err)}`);
    }
  }

  return report;
}
