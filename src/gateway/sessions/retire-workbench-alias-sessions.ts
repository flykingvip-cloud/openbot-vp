import fsp from "node:fs/promises";
import path from "node:path";
import { loadSessionStore, updateSessionStore, type SessionEntry } from "../../config/sessions.js";
import {
  isLeftoverBotSpaceSessionKey,
  isRedundantRobotAliasSessionKey,
} from "../../sessions/session-key-utils.js";
import { rewriteOpenclawPathToOpenbotIfPresent } from "../collaboration-learning/openbot-path-rewrite.js";

function isRetirableLeftoverSessionKey(sessionKey: string): boolean {
  return isRedundantRobotAliasSessionKey(sessionKey) || isLeftoverBotSpaceSessionKey(sessionKey);
}

export function listRedundantRobotAliasKeys(
  store: Record<string, SessionEntry | undefined>,
): string[] {
  return Object.keys(store).filter((key) => isRedundantRobotAliasSessionKey(key));
}

export function listLeftoverBotSpaceKeys(
  store: Record<string, SessionEntry | undefined>,
): string[] {
  return Object.keys(store).filter((key) => isLeftoverBotSpaceSessionKey(key));
}

function collectAliasFiles(params: {
  store: Record<string, SessionEntry | undefined>;
  keys: string[];
  storePath: string;
}): string[] {
  const protectedFiles = new Set<string>();
  for (const [key, entry] of Object.entries(params.store)) {
    if (isRetirableLeftoverSessionKey(key)) {
      continue;
    }
    const sessionFile = entry?.sessionFile?.trim();
    if (sessionFile) {
      protectedFiles.add(path.resolve(rewriteOpenclawPathToOpenbotIfPresent(sessionFile)));
    }
    const sessionId = entry?.sessionId?.trim();
    if (sessionId) {
      protectedFiles.add(path.resolve(path.dirname(params.storePath), `${sessionId}.jsonl`));
    }
  }

  const files = new Set<string>();
  for (const key of params.keys) {
    const entry = params.store[key];
    const leftoverRaw = entry?.sessionFile?.trim();
    if (leftoverRaw) {
      files.add(path.resolve(rewriteOpenclawPathToOpenbotIfPresent(leftoverRaw)));
    }
    const sessionId = entry?.sessionId?.trim();
    if (sessionId) {
      files.add(path.resolve(path.dirname(params.storePath), `${sessionId}.jsonl`));
    }
  }
  return [...files].filter((file) => !protectedFiles.has(file));
}

async function retireStoreKeys(params: {
  storePath: string;
  listKeys: (store: Record<string, SessionEntry | undefined>) => string[];
}): Promise<{ retiredKeys: string[]; deletedFiles: string[] }> {
  const existing = loadSessionStore(params.storePath);
  const pendingKeys = params.listKeys(existing);
  if (pendingKeys.length === 0) {
    return { retiredKeys: [], deletedFiles: [] };
  }

  const retired = await updateSessionStore(params.storePath, (store) => {
    const keys = params.listKeys(store);
    const files = collectAliasFiles({ store, keys, storePath: params.storePath });
    for (const key of keys) {
      delete store[key];
    }
    return { keys, files };
  });

  const deletedFiles: string[] = [];
  for (const leftoverFile of retired.files) {
    try {
      await fsp.unlink(leftoverFile);
      deletedFiles.push(leftoverFile);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }
  return { retiredKeys: retired.keys, deletedFiles };
}

export async function retireRedundantRobotAliasSessions(params: {
  storePath: string;
}): Promise<{ retiredKeys: string[]; deletedFiles: string[] }> {
  return retireStoreKeys({ storePath: params.storePath, listKeys: listRedundantRobotAliasKeys });
}

/** Delete leftover `agent:…:space:` org-bus / group-mirror rows. Do not merge them. */
export async function retireLeftoverBotSpaceSessions(params: {
  storePath: string;
}): Promise<{ retiredKeys: string[]; deletedFiles: string[] }> {
  return retireStoreKeys({ storePath: params.storePath, listKeys: listLeftoverBotSpaceKeys });
}

export async function retireRedundantRobotAliasSessionsInAgentsDir(params: {
  agentsDir: string;
}): Promise<{ retiredKeys: string[]; deletedFiles: string[] }> {
  const retiredKeys: string[] = [];
  const deletedFiles: string[] = [];
  let names: string[] = [];
  try {
    names = (await fsp.readdir(params.agentsDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { retiredKeys, deletedFiles };
    }
    throw error;
  }
  for (const name of names) {
    const storePath = path.join(params.agentsDir, name, "sessions", "sessions.json");
    try {
      await fsp.access(storePath);
    } catch {
      continue;
    }
    const retired = await retireRedundantRobotAliasSessions({ storePath });
    retiredKeys.push(...retired.retiredKeys);
    deletedFiles.push(...retired.deletedFiles);
  }
  return { retiredKeys, deletedFiles };
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
  return null;
}

export async function retireLeftoverBotSpaceSessionsInAgentsDir(params: {
  agentsDir: string;
}): Promise<{ retiredKeys: string[]; deletedFiles: string[] }> {
  const retiredKeys: string[] = [];
  const deletedFiles: string[] = [];
  let names: string[] = [];
  try {
    names = (await fsp.readdir(params.agentsDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { retiredKeys, deletedFiles };
    }
    throw error;
  }
  for (const name of names) {
    const storePath = path.join(params.agentsDir, name, "sessions", "sessions.json");
    try {
      await fsp.access(storePath);
    } catch {
      continue;
    }
    const retired = await retireLeftoverBotSpaceSessions({ storePath });
    retiredKeys.push(...retired.retiredKeys);
    deletedFiles.push(...retired.deletedFiles);
  }
  return { retiredKeys, deletedFiles };
}

function mergeRetireResults(
  left: { retiredKeys: string[]; deletedFiles: string[] },
  right: { retiredKeys: string[]; deletedFiles: string[] },
): { retiredKeys: string[]; deletedFiles: string[] } {
  return {
    retiredKeys: [...left.retiredKeys, ...right.retiredKeys],
    deletedFiles: [...left.deletedFiles, ...right.deletedFiles],
  };
}

/** Sweep imported/wecom leftovers and old `agent:…:space:` inboxes around a store. */
export async function retireLeftoverWorkbenchAliasesAroundStore(
  storePath: string,
): Promise<{ retiredKeys: string[]; deletedFiles: string[] }> {
  const agentsDir = resolveAgentsDirFromStorePath(storePath);
  if (agentsDir) {
    return mergeRetireResults(
      await retireRedundantRobotAliasSessionsInAgentsDir({ agentsDir }),
      await retireLeftoverBotSpaceSessionsInAgentsDir({ agentsDir }),
    );
  }
  return mergeRetireResults(
    await retireRedundantRobotAliasSessions({ storePath }),
    await retireLeftoverBotSpaceSessions({ storePath }),
  );
}
