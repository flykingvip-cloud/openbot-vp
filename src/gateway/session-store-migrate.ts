import fs from "node:fs/promises";
import path from "node:path";
import { loadSessionStore, updateSessionStore, type SessionEntry } from "../config/sessions.js";
import { normalizeAgentId } from "../routing/session-key.js";
import type { SessionStoreOwnership } from "./tenant-context.js";

/**
 * One-time merge of legacy per-tenant session stores into the bot store.
 *
 * Layout read (never written by this migration):
 *   <tenantsRoot>/<tenantId>/users/<userId>/state/agents/<botId>/sessions/sessions.json
 * Destination (only write target):
 *   <stateDir>/agents/<botId>/sessions/sessions.json
 *
 * The same conversation keeps the newer non-empty transcript. Ownership is
 * metadata from the tenant path. Legacy files stay readable; this command
 * does not delete them and does not move files on a later handover.
 */

const GROUP_PUBLIC_PREFIX = "space:";

export type LegacyTenantSessionStore = {
  tenantId: string;
  userId: string;
  botId: string;
  storePath: string;
};

export type SessionStoreMigrationReport = {
  stateDir: string;
  tenantsRoot: string;
  dryRun: boolean;
  legacyStoreCount: number;
  sessionCount: number;
  mergedFromLegacy: number;
  ownershipStamped: number;
  unchanged: number;
  skippedGroupPublic: number;
  legacyStoresRetained: number;
  legacyTranscriptsRetained: number;
  /** Legacy files are never deleted; deletion is unsafe until readers are proven off the old path. */
  legacyFilesDeleted: false;
  /** This migration never writes tenants/.../sessions. Runtime writes already use the bot path. */
  legacyWritesStopped: true;
  errors: string[];
};

type Candidate = {
  entry: SessionEntry;
  fromLegacy: boolean;
  ownership: SessionStoreOwnership;
  transcriptPath?: string;
  transcriptNonEmpty: boolean;
};

function isSafeSegment(value: string): boolean {
  return (
    Boolean(value) &&
    value !== "." &&
    value !== ".." &&
    !value.includes("/") &&
    !value.includes("\\") &&
    !value.includes("\u0000")
  );
}

function isGroupPublicKey(sessionKey: string): boolean {
  return sessionKey.trim().toLowerCase().startsWith(GROUP_PUBLIC_PREFIX);
}

function readOwnership(entry: SessionEntry | undefined): SessionStoreOwnership {
  const record = entry as (SessionEntry & SessionStoreOwnership) | undefined;
  return {
    ...(record?.ownerTenantId ? { ownerTenantId: record.ownerTenantId } : {}),
    ...(record?.ownerUserId ? { ownerUserId: record.ownerUserId } : {}),
    ...(record?.ownerBotId ? { ownerBotId: record.ownerBotId } : {}),
  };
}

function withOwnership(entry: SessionEntry, ownership: SessionStoreOwnership): SessionEntry {
  return {
    ...entry,
    ...(ownership.ownerTenantId ? { ownerTenantId: ownership.ownerTenantId } : {}),
    ...(ownership.ownerUserId ? { ownerUserId: ownership.ownerUserId } : {}),
    ...(ownership.ownerBotId ? { ownerBotId: ownership.ownerBotId } : {}),
  } as SessionEntry;
}

function ownershipEqual(a: SessionStoreOwnership, b: SessionStoreOwnership): boolean {
  return (
    (a.ownerTenantId ?? "") === (b.ownerTenantId ?? "") &&
    (a.ownerUserId ?? "") === (b.ownerUserId ?? "") &&
    (a.ownerBotId ?? "") === (b.ownerBotId ?? "")
  );
}

async function fileNonEmpty(filePath: string | undefined): Promise<boolean> {
  const trimmed = filePath?.trim();
  if (!trimmed) {
    return false;
  }
  try {
    const st = await fs.stat(trimmed);
    return st.isFile() && st.size > 0;
  } catch {
    return false;
  }
}

async function resolveTranscript(params: {
  entry: SessionEntry;
  storePath: string;
}): Promise<{ transcriptPath?: string; transcriptNonEmpty: boolean }> {
  const sessionsDir = path.dirname(params.storePath);
  const explicit = params.entry.sessionFile?.trim();
  const candidates: string[] = [];
  if (explicit) {
    candidates.push(path.isAbsolute(explicit) ? explicit : path.join(sessionsDir, explicit));
  }
  if (params.entry.sessionId && isSafeSegment(params.entry.sessionId)) {
    candidates.push(path.join(sessionsDir, `${params.entry.sessionId}.jsonl`));
  }
  for (const candidate of candidates) {
    if (await fileNonEmpty(candidate)) {
      return { transcriptPath: candidate, transcriptNonEmpty: true };
    }
    try {
      const st = await fs.stat(candidate);
      if (st.isFile()) {
        return { transcriptPath: candidate, transcriptNonEmpty: false };
      }
    } catch {
      // try next
    }
  }
  return { transcriptNonEmpty: false };
}

/** Newer non-empty transcript wins. Ties keep the canonical entry. */
export function preferSessionCandidate(current: Candidate | undefined, next: Candidate): Candidate {
  if (!current) {
    return next;
  }
  if (current.transcriptNonEmpty !== next.transcriptNonEmpty) {
    return current.transcriptNonEmpty ? current : next;
  }
  const currentUpdated = current.entry.updatedAt ?? 0;
  const nextUpdated = next.entry.updatedAt ?? 0;
  if (currentUpdated !== nextUpdated) {
    return currentUpdated > nextUpdated ? current : next;
  }
  if (current.fromLegacy !== next.fromLegacy) {
    return current.fromLegacy ? next : current;
  }
  return current;
}

export async function discoverLegacyTenantSessionStores(
  tenantsRoot: string,
): Promise<LegacyTenantSessionStore[]> {
  const found: LegacyTenantSessionStore[] = [];
  const tenants = await fs.readdir(tenantsRoot, { withFileTypes: true }).catch(() => []);
  for (const tenant of tenants) {
    if (!tenant.isDirectory() || !isSafeSegment(tenant.name)) {
      continue;
    }
    const usersRoot = path.join(tenantsRoot, tenant.name, "users");
    const users = await fs.readdir(usersRoot, { withFileTypes: true }).catch(() => []);
    for (const user of users) {
      if (!user.isDirectory() || !isSafeSegment(user.name)) {
        continue;
      }
      const agentsRoot = path.join(usersRoot, user.name, "state", "agents");
      const agents = await fs.readdir(agentsRoot, { withFileTypes: true }).catch(() => []);
      for (const agent of agents) {
        if (!agent.isDirectory() || !isSafeSegment(agent.name)) {
          continue;
        }
        const storePath = path.join(agentsRoot, agent.name, "sessions", "sessions.json");
        try {
          const st = await fs.stat(storePath);
          if (!st.isFile()) {
            continue;
          }
        } catch {
          continue;
        }
        found.push({
          tenantId: tenant.name,
          userId: user.name,
          botId: normalizeAgentId(agent.name),
          storePath,
        });
      }
    }
  }
  return found.toSorted((a, b) => a.storePath.localeCompare(b.storePath));
}

function canonicalStorePath(stateDir: string, botId: string): string {
  return path.join(stateDir, "agents", normalizeAgentId(botId), "sessions", "sessions.json");
}

async function copyTranscriptIntoBotDir(params: {
  sourceFile: string;
  sessionsDir: string;
  sessionId: string;
}): Promise<string> {
  const dest = path.join(params.sessionsDir, `${params.sessionId}.jsonl`);
  const sourceReal = path.resolve(params.sourceFile);
  const destReal = path.resolve(dest);
  const dirReal = path.resolve(params.sessionsDir);
  if (sourceReal === destReal || sourceReal.startsWith(`${dirReal}${path.sep}`)) {
    return sourceReal;
  }
  await fs.mkdir(params.sessionsDir, { recursive: true });
  await fs.copyFile(sourceReal, destReal);
  return destReal;
}

function preserveCanonicalModel(
  canonical: SessionEntry | undefined,
  winner: SessionEntry,
): Pick<SessionEntry, "modelProvider" | "model"> | undefined {
  const canonicalModelProvider = canonical?.modelProvider?.trim();
  const canonicalModel = canonical?.model?.trim();
  const legacyModelProvider = winner.modelProvider?.trim();
  if (
    canonicalModelProvider &&
    canonicalModel &&
    (canonicalModelProvider.startsWith("ent") ||
      (legacyModelProvider && canonicalModelProvider !== legacyModelProvider))
  ) {
    return { modelProvider: canonicalModelProvider, model: canonicalModel };
  }
  return undefined;
}

async function loadLegacyCandidates(
  legacy: LegacyTenantSessionStore,
): Promise<Map<string, Candidate>> {
  const store = loadSessionStore(legacy.storePath, { skipCache: true });
  const out = new Map<string, Candidate>();
  for (const [sessionKey, entry] of Object.entries(store)) {
    if (!entry?.sessionId) {
      continue;
    }
    const transcript = await resolveTranscript({ entry, storePath: legacy.storePath });
    out.set(sessionKey, {
      entry,
      fromLegacy: true,
      ownership: {
        ownerTenantId: legacy.tenantId,
        ownerUserId: legacy.userId,
        ownerBotId: legacy.botId,
      },
      ...transcript,
    });
  }
  return out;
}

export async function migrateLegacyTenantSessionStores(params: {
  stateDir: string;
  tenantsRoot: string;
  dryRun?: boolean;
}): Promise<SessionStoreMigrationReport> {
  const dryRun = params.dryRun === true;
  const legacyStores = await discoverLegacyTenantSessionStores(params.tenantsRoot);
  const report: SessionStoreMigrationReport = {
    stateDir: params.stateDir,
    tenantsRoot: params.tenantsRoot,
    dryRun,
    legacyStoreCount: legacyStores.length,
    sessionCount: 0,
    mergedFromLegacy: 0,
    ownershipStamped: 0,
    unchanged: 0,
    skippedGroupPublic: 0,
    legacyStoresRetained: 0,
    legacyTranscriptsRetained: 0,
    legacyFilesDeleted: false,
    legacyWritesStopped: true,
    errors: [],
  };

  const byBot = new Map<string, LegacyTenantSessionStore[]>();
  for (const store of legacyStores) {
    const list = byBot.get(store.botId) ?? [];
    list.push(store);
    byBot.set(store.botId, list);
  }

  for (const [botId, stores] of byBot) {
    const targetPath = canonicalStorePath(params.stateDir, botId);
    const sessionsDir = path.dirname(targetPath);
    let legacyByKey: Array<Map<string, Candidate>> = [];
    try {
      legacyByKey = await Promise.all(stores.map((store) => loadLegacyCandidates(store)));
    } catch (err) {
      report.errors.push(
        `failed to read legacy stores for ${botId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }

    const keys = new Set<string>();
    for (const map of legacyByKey) {
      for (const key of map.keys()) {
        keys.add(key);
      }
    }

    const apply = async (
      canonical: Record<string, SessionEntry>,
      write: boolean,
    ): Promise<boolean> => {
      let dirty = false;
      for (const sessionKey of [...keys].toSorted()) {
        report.sessionCount += 1;
        if (isGroupPublicKey(sessionKey)) {
          report.skippedGroupPublic += 1;
          continue;
        }
        const canonicalEntry = canonical[sessionKey];
        let winner: Candidate | undefined;
        if (canonicalEntry?.sessionId) {
          const transcript = await resolveTranscript({
            entry: canonicalEntry,
            storePath: targetPath,
          });
          winner = {
            entry: canonicalEntry,
            fromLegacy: false,
            ownership: readOwnership(canonicalEntry),
            ...transcript,
          };
        }
        const legacyCandidates: Candidate[] = [];
        for (const map of legacyByKey) {
          const candidate = map.get(sessionKey);
          if (!candidate) {
            continue;
          }
          legacyCandidates.push(candidate);
          winner = preferSessionCandidate(winner, candidate);
        }
        if (!winner) {
          report.unchanged += 1;
          continue;
        }

        if (winner.fromLegacy) {
          let sessionFile = winner.transcriptPath ?? winner.entry.sessionFile;
          if (
            write &&
            winner.transcriptNonEmpty &&
            winner.transcriptPath &&
            isSafeSegment(winner.entry.sessionId)
          ) {
            try {
              sessionFile = await copyTranscriptIntoBotDir({
                sourceFile: winner.transcriptPath,
                sessionsDir,
                sessionId: winner.entry.sessionId,
              });
            } catch (err) {
              report.errors.push(
                `copy failed for ${sessionKey}: ${err instanceof Error ? err.message : String(err)}`,
              );
              continue;
            }
          } else if (
            winner.transcriptNonEmpty &&
            winner.transcriptPath &&
            isSafeSegment(winner.entry.sessionId)
          ) {
            const dest = path.join(sessionsDir, `${winner.entry.sessionId}.jsonl`);
            sessionFile = path
              .resolve(winner.transcriptPath)
              .startsWith(`${path.resolve(sessionsDir)}${path.sep}`)
              ? path.resolve(winner.transcriptPath)
              : path.resolve(dest);
          }
          const pinned = preserveCanonicalModel(canonicalEntry, winner.entry);
          const next = withOwnership(
            {
              ...winner.entry,
              ...pinned,
              ...(sessionFile ? { sessionFile } : {}),
              updatedAt: winner.entry.updatedAt ?? 0,
            },
            {
              ...readOwnership(winner.entry),
              ...winner.ownership,
              ownerBotId: winner.ownership.ownerBotId ?? botId,
            },
          );
          canonical[sessionKey] = next;
          report.mergedFromLegacy += 1;
          dirty = true;
          continue;
        }

        const ownershipSource = legacyCandidates.reduce<Candidate | undefined>(
          (best, candidate) => preferSessionCandidate(best, candidate),
          undefined,
        );
        const existingOwnership = readOwnership(canonicalEntry);
        if (
          ownershipSource &&
          !existingOwnership.ownerTenantId &&
          !ownershipEqual(existingOwnership, ownershipSource.ownership)
        ) {
          if (canonicalEntry) {
            canonical[sessionKey] = withOwnership(canonicalEntry, {
              ...ownershipSource.ownership,
              ownerBotId: ownershipSource.ownership.ownerBotId ?? botId,
            });
          }
          report.ownershipStamped += 1;
          dirty = true;
          continue;
        }
        report.unchanged += 1;
      }
      return dirty;
    };

    // Preview against a copy so a no-op merge does not rewrite the bot store.
    const preview = loadSessionStore(targetPath, { skipCache: true });
    const sessionCountBefore = report.sessionCount;
    const mergedBefore = report.mergedFromLegacy;
    const stampedBefore = report.ownershipStamped;
    const unchangedBefore = report.unchanged;
    const skippedBefore = report.skippedGroupPublic;
    const wouldChange = await apply(preview, false);
    if (!wouldChange || dryRun) {
      continue;
    }
    // Recompute counts while applying under the store lock.
    report.sessionCount = sessionCountBefore;
    report.mergedFromLegacy = mergedBefore;
    report.ownershipStamped = stampedBefore;
    report.unchanged = unchangedBefore;
    report.skippedGroupPublic = skippedBefore;
    try {
      await fs.mkdir(sessionsDir, { recursive: true });
      await updateSessionStore(
        targetPath,
        async (store) => {
          await apply(store, true);
        },
        { skipMaintenance: true },
      );
    } catch (err) {
      report.errors.push(
        `failed to write ${targetPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  for (const store of legacyStores) {
    try {
      await fs.access(store.storePath);
      report.legacyStoresRetained += 1;
    } catch {
      report.errors.push(`legacy store missing after merge: ${store.storePath}`);
    }
    const sessionsDir = path.dirname(store.storePath);
    const names = await fs.readdir(sessionsDir).catch(() => []);
    for (const name of names) {
      if (!name.endsWith(".jsonl")) {
        continue;
      }
      try {
        await fs.access(path.join(sessionsDir, name));
        report.legacyTranscriptsRetained += 1;
      } catch {
        report.errors.push(
          `legacy transcript missing after merge: ${path.join(sessionsDir, name)}`,
        );
      }
    }
  }

  return report;
}
