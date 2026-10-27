import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  createCogniWeaveRuntime,
  InMemoryCloudIntelligenceClient,
  resolveLocalMemorySubject,
  resolveSourceLifecycleSelector,
  type CognitivePackage,
  type CogniWeaveRuntime,
  type EngineConfig,
  type Scope,
  type TracePackageResult,
} from "../../packages/cogniweave-sdk/src/index.js";
import { resolveAgentWorkspaceDir } from "../agents/agent-scope.js";
import { assertCogniWeaveWritesAllowed } from "../config/cogniweave-migration.js";
import { ensurePortableCanonicalStore, resolveDataRoot } from "../config/data-space.js";
import { resolveStateDir } from "../config/paths.js";
import {
  resolveDefaultSessionStorePath,
  resolveSessionFilePath,
} from "../config/sessions/paths.js";
import { loadSessionStore } from "../config/sessions/store.js";
import type { OpenBotConfig } from "../config/types.js";
import { listAllCollaborationMemoryMarkdownDocs } from "../gateway/collaboration-learning/memory-index-paths.js";
import { compensateMemoryJournalWrite } from "../gateway/data-governance/logical-compensate.js";
import {
  buildCogniWeaveMemorySourceId,
  finalizeMemoryContentWriteSession,
  prepareMemoryContentWriteSession,
} from "../gateway/data-governance/memory-register.js";
import type { GovernanceOwnershipProof } from "../gateway/data-governance/write-gate.js";
import { readJsonFile, writeJsonAtomic } from "../infra/json-files.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import {
  deriveSessionChatType,
  parseAgentSessionKey,
  resolveThreadParentSessionKey,
} from "../sessions/session-key-utils.js";
import { onSessionTranscriptUpdate } from "../sessions/transcript-events.js";
import type { ResolvedCogniWeaveConfig } from "./backend-config.js";
import {
  readCogniWeaveCloudSyncStatus,
  startCogniWeaveCloudSyncLoop,
  type CogniWeaveCloudSyncLoopHandle,
} from "./cogniweave-cloud-sync-drain.js";
import { mapAtomToMemoryCenterRow, type MemoryCenterAtomRow } from "./memory-center-atoms.js";
import {
  listMemoryCenterAtomsReadonly as listMemoryCenterAtomsReadonlyFoundation,
  type MemoryCenterReadonlyListResult,
  type MemoryCenterStatusView,
} from "./memory-center-o4-readonly.js";
import {
  orchestrateFactSoftForget,
  type FactForgetResult,
} from "./memory-fact-forget.js";
import * as memoryWorkspaceHandle from "./memory-workspace-handle.js";
import { buildSessionEntry, listSessionFilesForAgent } from "./session-files.js";
import type {
  MemoryEmbeddingProbeResult,
  MemoryProviderStatus,
  MemorySearchManager,
  MemorySearchResult,
  MemorySource,
  MemorySyncProgressUpdate,
} from "./types.js";

const log = createSubsystemLogger("memory");
const SHARED_SCOPE_AGENT_ID = "shared";
const SESSION_SCOPE_SYNC_DEBOUNCE_MS = 10;

type CogniWeaveSourcePolicy = {
  enabled: boolean;
  allowsSharedScope: boolean;
  metadataSource: "workspace-memory" | "session-transcript";
};

type IndexedDocument = {
  absPath: string;
  relPath: string;
  text: string;
  checksum: string;
  evidenceIds?: string[];
  atomIds?: string[];
  source: MemorySource;
  sessionKey?: string;
};

type ScopeState = {
  scope: Scope;
  runtime: CogniWeaveRuntime;
  manifestHash: string;
  sourceManifestHash: string;
  docsByPath: Map<string, IndexedDocument>;
  pathByEvidenceId: Map<string, string>;
  snapshotLoaded: boolean;
  lastError?: string;
  indexStatus: "empty" | "ready" | "stale";
  lastSyncAt?: string;
  refCount: number;
};

const EMBEDDED_SCOPE_STATES = new Map<string, ScopeState>();

type PersistedScopeSnapshot = {
  version: 1;
  scope: Scope;
  docs: Array<{
    relPath: string;
    text: string;
    checksum: string;
    source: MemorySource;
    sessionKey?: string;
  }>;
  updatedAt: string;
};

type SearchExplainability = NonNullable<MemorySearchResult["explainability"]>;
type SearchEvidence = NonNullable<MemorySearchResult["evidence"]>[number];

function stableId(prefix: string, input: string): string {
  return `${prefix}_${createHash("sha256").update(input).digest("hex").slice(0, 16)}`;
}

function normalizeRelPath(workspaceDir: string, absPath: string): string {
  return path.relative(workspaceDir, absPath).split(path.sep).join("/");
}

function normalizeSessionScopeKey(sessionKey: string | undefined | null): string {
  const raw = (sessionKey ?? "").trim().toLowerCase();
  if (!raw) {
    return "";
  }
  const parent = resolveThreadParentSessionKey(raw) ?? raw;
  return parseAgentSessionKey(parent)?.rest ?? parent;
}

function extractSpaceIdentity(sessionKey: string | undefined | null): string | null {
  const normalized = normalizeSessionScopeKey(sessionKey);
  if (!normalized) {
    return null;
  }
  if (normalized.startsWith("space:")) {
    return normalized.slice("space:".length).trim() || null;
  }
  const match = normalized.match(/(?:^|:)space:([^:]+)$/);
  return match?.[1]?.trim() || null;
}

export function resolveCogniWeaveSearchScope(params: {
  agentId: string;
  sessionKey?: string | null;
  workspaceId: string;
}): Scope {
  const baseSessionKey = (params.sessionKey ?? "").trim().toLowerCase();
  const normalizedScopeKey = normalizeSessionScopeKey(baseSessionKey);
  const spaceIdentity = extractSpaceIdentity(baseSessionKey);
  if (spaceIdentity) {
    return {
      workspaceId: params.workspaceId,
      projectId: `space:${spaceIdentity}`,
      agentId: SHARED_SCOPE_AGENT_ID,
      visibility: "shared",
    };
  }

  const chatType = deriveSessionChatType(baseSessionKey);
  if (chatType === "group" || chatType === "channel") {
    return {
      workspaceId: params.workspaceId,
      projectId: `chat:${normalizedScopeKey}`,
      agentId: SHARED_SCOPE_AGENT_ID,
      visibility: "shared",
    };
  }

  return {
    workspaceId: params.workspaceId,
    projectId: `agent:${params.agentId}`,
    agentId: params.agentId,
    visibility: "private",
  };
}

export function resolveCogniWeaveSourcePolicy(
  source: MemorySource,
  resolved?: Pick<ResolvedCogniWeaveConfig, "sources" | "sharedSources">,
): CogniWeaveSourcePolicy {
  const enabledSources = new Set(resolved?.sources ?? ["memory", "sessions"]);
  const sharedSources = new Set(resolved?.sharedSources ?? ["sessions"]);
  switch (source) {
    case "sessions":
      return {
        enabled: enabledSources.has("sessions"),
        allowsSharedScope: enabledSources.has("sessions") && sharedSources.has("sessions"),
        metadataSource: "session-transcript",
      };
    case "memory":
    default:
      return {
        enabled: enabledSources.has("memory"),
        allowsSharedScope: enabledSources.has("memory") && sharedSources.has("memory"),
        metadataSource: "workspace-memory",
      };
  }
}

export function resolveCogniWeaveDocumentScope(params: {
  agentId: string;
  workspaceId: string;
  writeSync: ResolvedCogniWeaveConfig["writeSync"];
  sources: ResolvedCogniWeaveConfig["sources"];
  sharedSources: ResolvedCogniWeaveConfig["sharedSources"];
  doc: Pick<IndexedDocument, "source" | "sessionKey">;
}): Scope {
  const defaultScope = resolveCogniWeaveSearchScope({
    agentId: params.agentId,
    workspaceId: params.workspaceId,
  });
  if (params.writeSync === "disabled") {
    return defaultScope;
  }
  const candidateScope = resolveCogniWeaveSearchScope({
    agentId: params.agentId,
    sessionKey: params.doc.sessionKey,
    workspaceId: params.workspaceId,
  });
  const sourcePolicy = resolveCogniWeaveSourcePolicy(params.doc.source, params);
  if (!sourcePolicy.enabled) {
    return defaultScope;
  }
  if (candidateScope.visibility === "shared" && !sourcePolicy.allowsSharedScope) {
    return defaultScope;
  }
  return params.doc.source === "sessions" ? candidateScope : defaultScope;
}

function scopeStateKey(scope: Scope): string {
  return [scope.workspaceId, scope.projectId, scope.agentId, scope.visibility].join("::");
}

function scopeSnapshotPath(stateDir: string, scope: Scope): string {
  return path.join(
    stateDir,
    "cogniweave",
    "scopes",
    `${stableId("scope", scopeStateKey(scope))}.json`,
  );
}

function manifestHashForDocs(docs: IndexedDocument[]): string {
  return createHash("sha256")
    .update(
      JSON.stringify(
        docs
          .toSorted((left, right) =>
            `${left.source}:${left.relPath}`.localeCompare(`${right.source}:${right.relPath}`),
          )
          .map((doc) => ({
            source: doc.source,
            relPath: doc.relPath,
            checksum: doc.checksum,
          })),
      ),
    )
    .digest("hex");
}

function scopesEqual(left: Scope, right: Scope): boolean {
  return scopeStateKey(left) === scopeStateKey(right);
}

function buildRuntime(params: { scope: Scope; metadataStorePath: string }): CogniWeaveRuntime {
  const config: EngineConfig = {
    environment: "local",
    metadataBackend: "local",
    metadataStorePath: params.metadataStorePath,
    graphBackend: "memory",
    evidenceBackend: "memory",
    vectorBackend: "memory",
    enableLlmTaskFraming: false,
    enableLlmDistillation: false,
    enableVectorSeedRetrieval: true,
    defaultScope: params.scope,
  };
  return createCogniWeaveRuntime(config);
}

function computeChecksum(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/i)
    .map((token) => token.trim())
    .filter(Boolean);
}

function resultDedupeKey(result: MemorySearchResult): string {
  return `${result.source}:${result.path}:${result.startLine}:${result.endLine}`;
}

function sourceRank(source: MemorySource): number {
  return source === "memory" ? 1 : 0;
}

function mergeSearchResults(
  results: MemorySearchResult[],
  maxResults: number,
): MemorySearchResult[] {
  const deduped = new Map<string, MemorySearchResult>();
  for (const result of results.toSorted((left, right) => {
    const scoreDelta = right.score - left.score;
    if (scoreDelta !== 0) {
      return scoreDelta;
    }
    const sourceDelta = sourceRank(right.source) - sourceRank(left.source);
    if (sourceDelta !== 0) {
      return sourceDelta;
    }
    return left.path.localeCompare(right.path);
  })) {
    const key = resultDedupeKey(result);
    if (!deduped.has(key)) {
      deduped.set(key, result);
    }
  }
  return [...deduped.values()].slice(0, maxResults);
}

function extractSnippetWindow(
  text: string,
  query: string,
): {
  startLine: number;
  endLine: number;
  snippet: string;
} {
  const lines = text.split(/\r?\n/);
  const tokens = tokenizeQuery(query);
  let matchIndex = lines.findIndex((line) => {
    const normalized = line.toLowerCase();
    return tokens.some((token) => normalized.includes(token));
  });
  if (matchIndex < 0) {
    matchIndex = lines.findIndex((line) => line.trim().length > 0);
  }
  if (matchIndex < 0) {
    matchIndex = 0;
  }
  const startLine = Math.max(1, matchIndex + 1);
  const endLine = Math.min(lines.length, startLine + 3);
  const snippet = lines
    .slice(startLine - 1, endLine)
    .join("\n")
    .trim()
    .slice(0, 700);
  return {
    startLine,
    endLine: Math.max(startLine, endLine),
    snippet,
  };
}

/** Map a Data Space memoryKey onto already-indexed workspace-relative paths only. */
export function resolveIndexedMemoryLocators(
  memoryKey: string,
  indexedPaths: Iterable<string>,
): string[] {
  const key = memoryKey.trim().replace(/^\/+/, "").replace(/\\/g, "/");
  if (!key) {
    return [];
  }
  const basename = path.posix.basename(key);
  const candidates = new Set<string>([
    key,
    basename,
    key.startsWith("memory/") ? key : `memory/${key}`,
    key.toLowerCase() === "memory.md" ? "MEMORY.md" : key,
  ]);
  if (basename.toLowerCase() === "memory.md") {
    candidates.add("MEMORY.md");
    candidates.add("memory.md");
  }
  const matched = new Set<string>();
  for (const relPath of indexedPaths) {
    const normalized = relPath.replace(/\\/g, "/");
    if (
      candidates.has(normalized) ||
      candidates.has(path.posix.basename(normalized)) ||
      [...candidates].some((candidate) => normalized.endsWith(`/${candidate}`))
    ) {
      matched.add(normalized);
    }
  }
  return [...matched].toSorted((left, right) => left.localeCompare(right));
}

async function listWorkspaceMemoryDocs(workspaceDir: string): Promise<IndexedDocument[]> {
  const workspaceRoot = await fs.realpath(workspaceDir).catch(() => workspaceDir);
  const docs: IndexedDocument[] = [];
  const queue = [path.join(workspaceRoot, "MEMORY.md"), path.join(workspaceRoot, "memory.md")];

  async function addFile(absPath: string): Promise<void> {
    try {
      const stat = await fs.stat(absPath);
      if (!stat.isFile()) {
        return;
      }
      const resolvedPath = await fs.realpath(absPath).catch(() => absPath);
      const text = await fs.readFile(resolvedPath, "utf8");
      docs.push({
        absPath: resolvedPath,
        relPath: normalizeRelPath(workspaceRoot, resolvedPath),
        text,
        checksum: computeChecksum(text),
        source: "memory",
      });
    } catch {}
  }

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true, encoding: "utf8" });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(absPath);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        await addFile(absPath);
      }
    }
  }

  for (const candidate of queue) {
    await addFile(candidate);
  }
  await walk(path.join(workspaceRoot, "memory"));

  docs.sort((a, b) => a.relPath.localeCompare(b.relPath));
  const seen = new Set<string>();
  return docs.filter((doc) => {
    const dedupeKey = doc.relPath.toLowerCase();
    if (seen.has(dedupeKey)) {
      return false;
    }
    seen.add(dedupeKey);
    return true;
  });
}

async function resolveSessionKeyByFile(agentId: string): Promise<Map<string, string>> {
  const byPath = new Map<string, string>();
  const storePath = resolveDefaultSessionStorePath(agentId);
  const store = loadSessionStore(storePath);
  for (const [sessionKey, entry] of Object.entries(store)) {
    if (!entry?.sessionId) {
      continue;
    }
    try {
      const sessionFile = resolveSessionFilePath(entry.sessionId, entry, { agentId });
      const resolved = path.resolve(sessionFile);
      byPath.set(resolved, sessionKey);
      const real = await fs.realpath(resolved).catch(() => resolved);
      byPath.set(real, sessionKey);
    } catch {}
  }
  return byPath;
}

async function listSessionMemoryDocs(agentId: string): Promise<IndexedDocument[]> {
  const sessionKeyByFile = await resolveSessionKeyByFile(agentId);
  const files = await listSessionFilesForAgent(agentId);
  const docs: IndexedDocument[] = [];
  for (const file of files) {
    const entry = await buildSessionEntry(file);
    if (!entry?.content.trim()) {
      continue;
    }
    const resolved = path.resolve(file);
    const real = await fs.realpath(resolved).catch(() => resolved);
    const sessionKey = sessionKeyByFile.get(real) ?? sessionKeyByFile.get(resolved);
    docs.push({
      absPath: real,
      relPath: path.join("sessions", agentId, path.basename(entry.path)).replace(/\\/g, "/"),
      text: entry.content,
      checksum: entry.hash,
      source: "sessions",
      sessionKey,
    });
  }
  docs.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return docs;
}

function sliceTextByLines(text: string, from?: number, lines?: number): string {
  const allLines = text.split(/\r?\n/);
  const startIndex = Math.max(0, (from ?? 1) - 1);
  const endIndex =
    typeof lines === "number" && lines > 0
      ? Math.min(allLines.length, startIndex + lines)
      : undefined;
  return allLines.slice(startIndex, endIndex).join("\n");
}

function isScopeDocOwnedByAgent(params: {
  doc: IndexedDocument;
  scope: Scope;
  agentId: string;
}): boolean {
  if (params.scope.visibility === "shared") {
    return (
      params.doc.source === "sessions" &&
      params.doc.relPath.startsWith(`sessions/${params.agentId}/`)
    );
  }
  return params.scope.agentId === params.agentId;
}

export class CogniWeaveMemoryManager implements MemorySearchManager {
  private readonly workspaceDir: string;
  private readonly stateDir: string;
  private readonly dataRoot: string;
  private readonly metadataStorePath: string;
  private readonly workspaceId: string;
  private readonly defaultScope: Scope;
  private readonly docsByPath = new Map<string, IndexedDocument>();
  private readonly sessionPathByAbsPath = new Map<string, string>();
  private readonly scopeStateKeys = new Set<string>();
  private readonly sessionUnsubscribe?: () => void;
  private readonly pendingSessionFiles = new Set<string>();
  private sessionSyncTimer: ReturnType<typeof setTimeout> | null = null;
  private cloudSyncLoop: CogniWeaveCloudSyncLoopHandle | null = null;
  private cloudSyncLastError?: string;
  private cloudSyncStatusCache: Awaited<ReturnType<typeof readCogniWeaveCloudSyncStatus>> | null =
    null;
  private closed = false;
  private readonly governance?: {
    tenantId: string | null;
    ownershipProof: GovernanceOwnershipProof;
    stateDir?: string;
  };
  private constructor(
    private readonly cfg: OpenBotConfig,
    private readonly agentId: string,
    private readonly resolved: ResolvedCogniWeaveConfig,
    governance?: {
      tenantId: string | null;
      ownershipProof: GovernanceOwnershipProof;
      stateDir?: string;
    },
    workspaceIdentity: "legacy" | memoryWorkspaceHandle.MemoryWorkspaceHandle = "legacy",
  ) {
    this.governance = governance;
    this.workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
    void import("./item7-w5-index-shadow.js").then((m) =>
      m.scheduleItem7W5IndexShadow({ ledgerId: "S32", handleResourceId: null }),
    );
    this.stateDir = governance?.stateDir ?? resolveStateDir(process.env);
    this.dataRoot = resolveDataRoot(cfg, process.env);
    const portable = ensurePortableCanonicalStore({
      dataRoot: this.dataRoot,
      stateDir: this.stateDir,
      configuredStorePath: this.resolved.storePath,
    });
    this.metadataStorePath = portable.storePath;
    if (portable.cutoverFromLegacy) {
      log.info(
        `cogniweave canonical cutover: ${portable.migrationState?.fromPath} -> ${portable.storePath}`,
      );
    }
    if (workspaceIdentity !== "legacy") {
      this.memoryWorkspaceHandle = workspaceIdentity;
    }
    this.workspaceId =
      this.memoryWorkspaceHandle?.resourceId ?? stableId("ws", path.resolve(this.stateDir));
    this.defaultScope = resolveCogniWeaveSearchScope({
      agentId: this.agentId,
      workspaceId: this.workspaceId,
    });
    if (
      !this.memoryWorkspaceHandle &&
      this.resolved.writeSync !== "disabled" &&
      this.resolved.sources.includes("sessions")
    ) {
      this.sessionUnsubscribe = onSessionTranscriptUpdate((update) => {
        if (this.closed) {
          return;
        }
        if (!this.isSessionFileForAgent(update.sessionFile)) {
          return;
        }
        this.scheduleSessionScopeSync(update.sessionFile);
      });
    }
  }

  private memoryWorkspaceHandle?: memoryWorkspaceHandle.MemoryWorkspaceHandle;
  private writeBackCount = 0;

  static async create(params: {
    cfg: OpenBotConfig;
    agentId: string;
    resolved: ResolvedCogniWeaveConfig;
    /** Trusted proof from TenantContext / AgentAsset / seat — required for managed tenants. */
    governance?: {
      tenantId: string | null;
      ownershipProof: GovernanceOwnershipProof;
      stateDir?: string;
    };
  }): Promise<CogniWeaveMemoryManager> {
    if (params.resolved.mode !== "embedded") {
      throw new Error(
        `CogniWeave mode "${params.resolved.mode}" is not implemented in OpenBot yet`,
      );
    }
    const manager = new CogniWeaveMemoryManager(
      params.cfg,
      params.agentId,
      params.resolved,
      params.governance,
      "legacy",
    );
    await manager.syncAllScopes({ reason: "startup" });
    manager.startCloudSyncIfEnabled();
    return manager;
  }

  static async createFromHandle(params: {
    cfg: OpenBotConfig;
    agentId: string;
    resolved: ResolvedCogniWeaveConfig;
    handle: memoryWorkspaceHandle.MemoryWorkspaceHandle;
    governance?: {
      ownershipProof: GovernanceOwnershipProof;
      stateDir?: string;
    };
  }): Promise<
    | { ok: true; manager: CogniWeaveMemoryManager }
    | {
        ok: false;
        reasonCode: memoryWorkspaceHandle.MemoryWorkspaceDenial | "handle_not_branded";
        reason: string;
      }
  > {
    if (!memoryWorkspaceHandle.isMemoryWorkspaceHandle(params.handle)) {
      return {
        ok: false,
        reasonCode: "handle_not_branded",
        reason: "CogniWeave dark entry requires a branded MemoryWorkspaceHandle",
      };
    }
    const configuredTenantId = params.resolved.cloudSync?.tenantId;
    const tenantCheck = memoryWorkspaceHandle.checkConfiguredCloudTenant({
      handle: params.handle,
      configuredTenantId:
        !configuredTenantId || configuredTenantId === "__local__" ? null : configuredTenantId,
    });
    if (!tenantCheck.ok) {
      return tenantCheck;
    }
    if (params.resolved.mode !== "embedded") {
      throw new Error(
        `CogniWeave mode "${params.resolved.mode}" is not implemented in OpenBot yet`,
      );
    }
    const manager = new CogniWeaveMemoryManager(
      params.cfg,
      params.agentId,
      params.resolved,
      params.governance
        ? {
            tenantId: memoryWorkspaceHandle.deriveCloudTenantId(params.handle),
            ownershipProof: params.governance.ownershipProof,
            stateDir: params.governance.stateDir,
          }
        : undefined,
      params.handle,
    );
    return { ok: true, manager };
  }

  inspectDarkWorkspaceIdentity(): {
    workspaceId: string;
    fromHandle: boolean;
    resourceId: string | null;
    defaultScopeWorkspaceId: string;
    defaultScopeKey: string;
    cloudSyncStarted: boolean;
    sessionWatcherArmed: boolean;
    writeBackCount: number;
  } {
    return {
      workspaceId: this.workspaceId,
      fromHandle: Boolean(this.memoryWorkspaceHandle),
      resourceId: this.memoryWorkspaceHandle?.resourceId ?? null,
      defaultScopeWorkspaceId: this.defaultScope.workspaceId,
      defaultScopeKey: scopeStateKey(this.defaultScope),
      cloudSyncStarted: Boolean(this.cloudSyncLoop),
      sessionWatcherArmed: Boolean(this.sessionUnsubscribe),
      writeBackCount: this.writeBackCount,
    };
  }

  private assertHandleSearchAllowed(): void {
    if (this.memoryWorkspaceHandle && !this.memoryWorkspaceHandle.permissions.search) {
      throw new Error("memory_workspace_permission_denied:search");
    }
  }

  private handleWritesBlocked(): boolean {
    const handle = this.memoryWorkspaceHandle;
    if (!handle) {
      return false;
    }
    if (handle.lifecycle === "retired" || handle.lifecycle === "purged") {
      return true;
    }
    return (
      !handle.permissions.ingest &&
      !handle.permissions.distill &&
      !handle.permissions.prune &&
      !handle.permissions.reset
    );
  }

  private denyHandleWrite(operation: "ingest" | "distill" | "prune" | "reset" | "sync"): string {
    return `memory_workspace_permission_denied:${operation}`;
  }

  async search(
    query: string,
    opts?: { maxResults?: number; minScore?: number; sessionKey?: string },
  ): Promise<MemorySearchResult[]> {
    this.assertHandleSearchAllowed();
    const searchScope = resolveCogniWeaveSearchScope({
      agentId: this.agentId,
      sessionKey: opts?.sessionKey,
      workspaceId: this.workspaceId,
    });
    const scopeStates = [await this.syncScope(this.defaultScope, { reason: "search" })];
    if (!scopesEqual(searchScope, this.defaultScope)) {
      scopeStates.push(await this.syncScope(searchScope, { reason: "search" }));
    }
    if (scopeStates.every((scopeState) => scopeState.pathByEvidenceId.size === 0)) {
      return [];
    }

    const results = (
      await Promise.all(scopeStates.map((scopeState) => this.searchScope(query, scopeState, opts)))
    ).flat();
    const merged = mergeSearchResults(results, opts?.maxResults ?? 5);
    return merged.filter((hit) =>
      scopeStates.every((scopeState) =>
        scopeState.runtime.engine.isSourcePathRetrievable(hit.path),
      ),
    );
  }

  /**
   * Map OpenBot conversation lifecycle onto CogniWeave engine source APIs.
   */
  async applyTranscriptSourceLifecycle(input: {
    mode: "archive" | "restore" | "purge" | "forget";
    sourceIdentityId?: string;
    sourceLocator?: string;
    operationId: string;
    reasonCode?: string;
  }): Promise<{ ok: boolean; skipped?: boolean; error?: string; status?: string }> {
    if (this.handleWritesBlocked()) {
      const operation =
        input.mode === "archive" || input.mode === "restore"
          ? "ingest"
          : input.mode === "purge"
            ? "reset"
            : "prune";
      return { ok: false, error: this.denyHandleWrite(operation) };
    }
    try {
      if (!input.sourceIdentityId?.trim() && !input.sourceLocator?.trim()) {
        return { ok: true, skipped: true, status: "active" };
      }
      const scopeState = await this.syncScope(this.defaultScope, { reason: "lifecycle" });
      const engine = scopeState.runtime.engine;
      const selector = resolveSourceLifecycleSelector({
        sourceIdentityId: input.sourceIdentityId,
        sourceLocator: input.sourceLocator,
      });
      const lifecycleInput = {
        operationId: input.operationId,
        selector,
        subject: { scope: scopeState.scope },
        reasonCode: input.reasonCode ?? "TRANSCRIPT_LIFECYCLE",
      };
      const receipt =
        input.mode === "archive"
          ? await engine.archiveSource(lifecycleInput)
          : input.mode === "restore"
            ? await engine.restoreSource(lifecycleInput)
            : input.mode === "forget"
              ? await engine.forgetSource(lifecycleInput)
              : await engine.purgeSource(lifecycleInput);
      return { ok: true, status: receipt.currentStatus };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn(
        `cogniweave source lifecycle failed mode=${input.mode} op=${input.operationId}: ${message}`,
      );
      return { ok: false, error: message };
    }
  }

  /**
   * Forget (+ optional purge) only for already-indexed memory paths matching `memoryKey`.
   * Never invent locators — avoids polluting canonical with speculative SourceBindings.
   */
  async applyMemoryArtifactLifecycle(input: {
    memoryKey: string;
    operationId: string;
    reasonCode?: string;
    purgeAfterForget?: boolean;
  }): Promise<{
    ok: boolean;
    applied: string[];
    skipped: boolean;
    error?: string;
  }> {
    const memoryKey = input.memoryKey.trim().replace(/^\/+/, "").replace(/\\/g, "/");
    if (!memoryKey) {
      return { ok: true, applied: [], skipped: true };
    }
    if (this.handleWritesBlocked()) {
      return {
        ok: false,
        applied: [],
        skipped: false,
        error: this.denyHandleWrite("prune"),
      };
    }
    try {
      await this.syncAllScopes({ reason: "lifecycle" });
      const matched = resolveIndexedMemoryLocators(memoryKey, this.docsByPath.keys());
      if (matched.length === 0) {
        return { ok: true, applied: [], skipped: true };
      }
      const reasonCode = input.reasonCode ?? "MEMORY_ARTIFACT_LIFECYCLE";
      const purgeAfterForget = input.purgeAfterForget !== false;
      const applied: string[] = [];
      for (const locator of matched) {
        const forgotten = await this.applyTranscriptSourceLifecycle({
          mode: "forget",
          sourceLocator: locator,
          operationId: `${input.operationId}:forget:${locator}`,
          reasonCode,
        });
        if (!forgotten.ok) {
          return {
            ok: false,
            applied,
            skipped: false,
            error: forgotten.error ?? `forget failed for ${locator}`,
          };
        }
        applied.push(locator);
        if (purgeAfterForget) {
          const purged = await this.applyTranscriptSourceLifecycle({
            mode: "purge",
            sourceLocator: locator,
            operationId: `${input.operationId}:purge:${locator}`,
            reasonCode,
          });
          if (!purged.ok) {
            return {
              ok: false,
              applied,
              skipped: false,
              error: purged.error ?? `purge failed for ${locator}`,
            };
          }
        }
      }
      return { ok: true, applied, skipped: false };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn(`cogniweave memory artifact lifecycle failed op=${input.operationId}: ${message}`);
      return { ok: false, applied: [], skipped: false, error: message };
    }
  }


  /**
   * Fact-level soft forget (MVP). factRef = atomId within defaultScope.
   * Soft-forgets each live linked source; never purges; never text-scans corpus.
   */
  async forgetFact(input: {
    atomId: string;
    operationId: string;
    reasonCode?: string;
  }): Promise<FactForgetResult> {
    const atomId = input.atomId.trim();
    const operationId = input.operationId.trim();
    if (!atomId || !operationId) {
      return {
        ok: false,
        factRef: { atomId },
        sources: [],
        error: "atomId and operationId are required",
      };
    }
    if (this.handleWritesBlocked()) {
      return {
        ok: false,
        factRef: { atomId },
        sources: [],
        error: this.denyHandleWrite("prune"),
      };
    }
    const reasonCode = input.reasonCode ?? "FACT_LEVEL_FORGET";
    try {
      const scopeState = await this.syncScope(this.defaultScope, { reason: "lifecycle" });
      const engine = scopeState.runtime.engine;
      return await orchestrateFactSoftForget({
        atomId,
        operationId,
        atomExists: async () => {
          const history = await engine.getVersionHistory(atomId);
          return history.length > 0;
        },
        enumerate: async () => {
          if (typeof engine.listLiveSourcesForAtom !== "function") {
            return [];
          }
          return engine.listLiveSourcesForAtom(atomId);
        },
        softForgetSource: async (source, opId) => {
          return this.applyTranscriptSourceLifecycle({
            mode: "forget",
            sourceIdentityId: source.sourceIdentityId,
            operationId: opId,
            reasonCode,
          });
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn(`cogniweave forgetFact failed atom=${atomId} op=${operationId}: ${message}`);
      return {
        ok: false,
        factRef: { atomId },
        sources: [],
        error: message,
      };
    }
  }

  private async searchScope(
    query: string,
    scopeState: ScopeState,
    opts?: { maxResults?: number; minScore?: number; sessionKey?: string },
  ): Promise<MemorySearchResult[]> {
    if (scopeState.pathByEvidenceId.size === 0) {
      return [];
    }
    const taskFrame = await scopeState.runtime.engine.frameTask(query, { scope: scopeState.scope });
    const pkg = await scopeState.runtime.engine.reason(taskFrame, {
      maxPaths: Math.max(1, opts?.maxResults ?? 5),
      includeOptionalEvidenceRefs: true,
    });
    const trace = await scopeState.runtime.engine
      .tracePackage(pkg.packageId, {
        scope: scopeState.scope,
        includeOptionalEvidenceRefs: true,
      })
      .catch(() => null);
    const evidenceIds = new Set<string>(pkg.evidenceRefs);
    for (const atomId of pkg.supportingAtoms) {
      const refs = await scopeState.runtime.engine.getEvidenceRefs(atomId, scopeState.scope);
      for (const ref of refs) {
        evidenceIds.add(ref);
      }
    }
    const explainability = this.buildSearchExplainability(pkg, trace, [...evidenceIds]);

    const threshold = opts?.minScore ?? 0;
    const results: MemorySearchResult[] = [];
    let index = 0;
    for (const evidenceId of evidenceIds) {
      const relPath = scopeState.pathByEvidenceId.get(evidenceId);
      if (!relPath) {
        continue;
      }
      const doc = scopeState.docsByPath.get(relPath) ?? this.docsByPath.get(relPath);
      if (!doc) {
        continue;
      }
      const window = extractSnippetWindow(doc.text, query);
      const score = Math.max(0, pkg.confidence - index * 0.01);
      index += 1;
      if (score < threshold) {
        continue;
      }
      const evidence = await this.resolveSearchEvidence(scopeState, evidenceId);
      results.push({
        path: relPath,
        startLine: window.startLine,
        endLine: window.endLine,
        score,
        snippet: window.snippet,
        source: doc.source,
        explainability,
        evidence: evidence ? [evidence] : undefined,
      });
    }

    return mergeSearchResults(
      [...results, ...(await this.searchScopeEvidence(query, scopeState, opts))],
      opts?.maxResults ?? 5,
    );
  }

  private async searchScopeEvidence(
    query: string,
    scopeState: ScopeState,
    opts?: { maxResults?: number; minScore?: number; sessionKey?: string },
  ): Promise<MemorySearchResult[]> {
    const threshold = opts?.minScore ?? 0;
    const results = await scopeState.runtime.engine.searchEvidence(query, {
      scope: scopeState.scope,
      maxResults: opts?.maxResults ?? 5,
      minScore: threshold,
    });
    return results
      .flatMap((result): MemorySearchResult[] => {
        const relPath = scopeState.pathByEvidenceId.get(result.evidence.id);
        if (!relPath) {
          return [];
        }
        const doc = scopeState.docsByPath.get(relPath) ?? this.docsByPath.get(relPath);
        if (!doc) {
          return [];
        }
        const window = extractSnippetWindow(doc.text, query);
        return [
          {
            path: relPath,
            startLine: window.startLine,
            endLine: window.endLine,
            score: result.score + sourceRank(doc.source) * 0.08,
            snippet: window.snippet,
            source: doc.source,
            explainability: {
              whySummary: `Evidence search matched ${result.matchedTokens.length} query tokens in ${relPath}.`,
              matchedPatterns: ["evidence_search", doc.source],
              supportingAtoms: doc.atomIds ?? [],
              evidenceRefs: [result.evidence.id],
            },
            evidence: [
              {
                id: result.evidence.id,
                uri: relPath,
                snippet: result.evidence.snippet,
                trustScore: result.evidence.trustScore,
              },
            ],
          },
        ];
      })
      .toSorted((left, right) => {
        const scoreDelta = right.score - left.score;
        if (scoreDelta !== 0) {
          return scoreDelta;
        }
        const sourceDelta = sourceRank(right.source) - sourceRank(left.source);
        if (sourceDelta !== 0) {
          return sourceDelta;
        }
        return left.path.localeCompare(right.path);
      })
      .slice(0, opts?.maxResults ?? 5);
  }

  private buildSearchExplainability(
    pkg: CognitivePackage,
    trace: TracePackageResult | null,
    evidenceRefs: string[],
  ): SearchExplainability {
    const selectedPaths =
      trace?.candidatePaths.filter((path) => trace.selectedPathIds.includes(path.pathId)) ?? [];
    return {
      whySummary: trace?.package.why.summary ?? pkg.why.summary,
      matchedPatterns: trace?.package.why.matchedPatterns ?? pkg.why.matchedPatterns,
      supportingAtoms: trace?.supportingAtoms.map((atom) => atom.id) ?? pkg.supportingAtoms,
      selectedPathIds: trace?.selectedPathIds,
      pathSummaries: selectedPaths.map((path) => path.summary),
      evidenceRefs,
    };
  }

  private async resolveSearchEvidence(
    scopeState: ScopeState,
    evidenceId: string,
  ): Promise<SearchEvidence | null> {
    try {
      const record = await scopeState.runtime.engine.resolveEvidence({
        evidenceId,
        scope: scopeState.scope,
      });
      if (!record || Array.isArray(record)) {
        return null;
      }
      return {
        id: record.id,
        uri: scopeState.pathByEvidenceId.get(evidenceId) ?? record.uri,
        snippet: record.snippet,
        trustScore: record.trustScore,
      };
    } catch {
      return null;
    }
  }

  async readFile(params: { relPath: string; from?: number; lines?: number }) {
    this.assertHandleSearchAllowed();
    await this.syncScope(this.defaultScope, { reason: "read" });
    const doc =
      this.docsByPath.get(params.relPath) ??
      [...EMBEDDED_SCOPE_STATES.values()]
        .map((state) => state.docsByPath.get(params.relPath))
        .find((candidate): candidate is IndexedDocument => Boolean(candidate));
    if (!doc) {
      throw new Error(`CogniWeave memory file not found: ${params.relPath}`);
    }
    return {
      path: params.relPath,
      text: sliceTextByLines(doc.text, params.from, params.lines),
    };
  }

  private getActiveScopeStates(): ScopeState[] {
    return [...this.scopeStateKeys]
      .map((key) => EMBEDDED_SCOPE_STATES.get(key))
      .filter((state): state is ScopeState => Boolean(state));
  }

  private getOwnedIndexedDocs(scopeStates: ScopeState[]): IndexedDocument[] {
    const docs = new Map<string, IndexedDocument>();
    for (const state of scopeStates) {
      for (const doc of state.docsByPath.values()) {
        if (
          !isScopeDocOwnedByAgent({
            doc,
            scope: state.scope,
            agentId: this.agentId,
          })
        ) {
          continue;
        }
        docs.set(doc.relPath, doc);
      }
    }
    return [...docs.values()];
  }

  /**
   * Memory Center atom listing — queryAtoms (ACL + lifecycle), mapped to safe DTO.
   */
  async listMemoryCenterAtoms(opts?: { limit?: number }): Promise<MemoryCenterAtomRow[]> {
    const scopeState = await this.syncScope(this.defaultScope, { reason: "memory-center" });
    const caller = resolveLocalMemorySubject(this.agentId, "agent");
    const engine = scopeState.runtime.engine;
    await engine.ensureMemorySubjectBinding({
      scope: this.defaultScope,
      caller,
      scopeType: "agent",
    });
    const hits = await engine.queryAtoms({
      scope: this.defaultScope,
      caller,
      filter: {
        limit: opts?.limit ?? 200,
      },
    });
    return hits.map((hit) => mapAtomToMemoryCenterRow(hit.atom));
  }

  /**
   * O4 isolated readonly Memory Center list (active|tentative exact).
   * Does not syncScope, ensureMemorySubjectBinding, mkdir, or migrate.
   * Prefer this from data.memory.list when statusView is requested; legacy listMemoryCenterAtoms remains for sync-bound callers.
   */
  async listMemoryCenterAtomsReadonly(opts?: {
    statusView?: MemoryCenterStatusView;
    limit?: number;
  }): Promise<MemoryCenterReadonlyListResult> {
    return listMemoryCenterAtomsReadonlyFoundation({
      metadataStorePath: this.metadataStorePath,
      scope: this.defaultScope,
      agentId: this.agentId,
      statusView: opts?.statusView,
      limit: opts?.limit,
      backend: "cogniweave",
      cogniweaveMode: this.resolved.mode,
    });
  }

  status(): MemoryProviderStatus {
    const scopeStates = this.getActiveScopeStates();
    const indexedDocs = this.getOwnedIndexedDocs(scopeStates);
    const sourceCounts = [...this.docsByPath.values()].reduce((acc, doc) => {
      const current = acc.get(doc.source) ?? { source: doc.source, files: 0, chunks: 0 };
      current.files += 1;
      current.chunks += 1;
      acc.set(doc.source, current);
      return acc;
    }, new Map<MemorySource, { source: MemorySource; files: number; chunks: number }>());
    const distillation = indexedDocs.reduce(
      (acc, doc) => {
        acc.atoms += doc.atomIds?.length ?? 0;
        acc.evidence += doc.evidenceIds?.length ?? 0;
        return acc;
      },
      { atoms: 0, evidence: 0 },
    );
    const sources = [...sourceCounts.keys()];
    const indexStatus = scopeStates.some((state) => state.indexStatus === "stale")
      ? "stale"
      : scopeStates.some((state) => state.indexStatus === "ready")
        ? "ready"
        : "empty";
    const lastError = scopeStates.find((state) => state.lastError)?.lastError;
    const lastSyncAt = scopeStates
      .map((state) => state.lastSyncAt)
      .filter((value): value is string => Boolean(value))
      .toSorted()
      .at(-1);
    const cloudSync = this.cloudSyncStatusCache ?? {
      enabled: this.resolved.cloudSync.enabled,
      outboxPending: 0,
      outboxFailed: 0,
      mirrorFreshness: "never_synced" as const,
      ...(this.cloudSyncLastError ? { lastError: this.cloudSyncLastError } : {}),
    };
    return {
      backend: "cogniweave",
      provider: "cogniweave",
      model: this.resolved.mode,
      requestedProvider: "cogniweave",
      files: this.docsByPath.size,
      chunks: this.docsByPath.size,
      dirty: indexStatus === "stale",
      workspaceDir: this.workspaceDir,
      dbPath: this.metadataStorePath,
      sources,
      sourceCounts: [...sourceCounts.values()],
      custom: {
        queryStatus: lastError ? "degraded" : "ok",
        writeStatus: this.resolved.writeSync,
        indexStatus,
        mode: this.resolved.mode,
        persistence: {
          backend: "local",
          canonicalStorePath: this.metadataStorePath,
          restartSafe: true,
        },
        scopeStrategy: this.resolved.scopeStrategy,
        sourcePolicy: {
          memory: resolveCogniWeaveSourcePolicy("memory", this.resolved),
          sessions: resolveCogniWeaveSourcePolicy("sessions", this.resolved),
        },
        lastError,
        lastSyncAt,
        activeScopes: scopeStates.length,
        traceSupport: true,
        distillation,
        cloudSync: {
          enabled: cloudSync.enabled,
          outboxPending: cloudSync.outboxPending,
          outboxFailed: cloudSync.outboxFailed,
          mirrorFreshness: cloudSync.mirrorFreshness,
          ...(cloudSync.lastError ? { lastError: cloudSync.lastError } : {}),
        },
      },
    };
  }

  private startCloudSyncIfEnabled(): void {
    if (this.memoryWorkspaceHandle || !this.resolved.cloudSync.enabled || this.cloudSyncLoop) {
      return;
    }
    const { deviceId, credential, intervalMs } = this.resolved.cloudSync;
    const tenantId = this.memoryWorkspaceHandle
      ? memoryWorkspaceHandle.deriveCloudTenantId(this.memoryWorkspaceHandle)
      : this.resolved.cloudSync.tenantId;
    // Stub client until HTTP CloudIntelligenceClient lands — empty outbox/pull is still wired.
    const client = new InMemoryCloudIntelligenceClient({
      validCredentials: [credential],
    });
    this.cloudSyncLoop = startCogniWeaveCloudSyncLoop({
      stateDir: this.stateDir,
      client,
      auth: { tenantId, deviceId, credential },
      intervalMs,
      isClosed: () => this.closed,
      onError: (message) => {
        this.cloudSyncLastError = message.slice(0, 200);
      },
    });
    void readCogniWeaveCloudSyncStatus({
      stateDir: this.stateDir,
      enabled: true,
      lastError: this.cloudSyncLastError,
    })
      .then((snapshot) => {
        this.cloudSyncStatusCache = snapshot;
      })
      .catch(() => {
        // status is best-effort
      });
  }

  async sync(params?: {
    reason?: string;
    force?: boolean;
    progress?: (update: MemorySyncProgressUpdate) => void;
  }): Promise<void> {
    if (this.handleWritesBlocked()) {
      return;
    }
    await this.syncAllScopes(params);
  }

  private isSessionFileForAgent(sessionFile: string): boolean {
    const resolvedFile = path.resolve(sessionFile);
    const sessionsDir = path.dirname(resolveDefaultSessionStorePath(this.agentId));
    const resolvedDir = path.resolve(sessionsDir);
    return resolvedFile.startsWith(`${resolvedDir}${path.sep}`);
  }

  private scheduleSessionScopeSync(sessionFile: string): void {
    this.pendingSessionFiles.add(path.resolve(sessionFile));
    if (this.sessionSyncTimer) {
      return;
    }
    this.sessionSyncTimer = setTimeout(() => {
      this.sessionSyncTimer = null;
      const pending = [...this.pendingSessionFiles];
      this.pendingSessionFiles.clear();
      if (this.closed || pending.length === 0) {
        return;
      }
      void this.syncImpactedScopesForSessionFiles(pending).catch((err) => {
        log.warn(`CogniWeave session sync failed: ${String(err)}`);
      });
    }, SESSION_SCOPE_SYNC_DEBOUNCE_MS);
  }

  private getOrCreateScopeState(scope: Scope): ScopeState {
    const key = scopeStateKey(scope);
    let state = EMBEDDED_SCOPE_STATES.get(key);
    if (!state) {
      state = {
        scope,
        runtime: buildRuntime({ scope, metadataStorePath: this.metadataStorePath }),
        manifestHash: "",
        sourceManifestHash: "",
        docsByPath: new Map<string, IndexedDocument>(),
        pathByEvidenceId: new Map<string, string>(),
        snapshotLoaded: false,
        indexStatus: "empty",
        refCount: 0,
      };
      EMBEDDED_SCOPE_STATES.set(key, state);
    }
    if (!this.scopeStateKeys.has(key)) {
      state.refCount += 1;
      this.scopeStateKeys.add(key);
    }
    return state;
  }

  private async replayDocumentIntoScope(params: {
    state: ScopeState;
    doc: IndexedDocument;
    reason: string;
  }): Promise<void> {
    if (this.handleWritesBlocked()) {
      return;
    }
    assertCogniWeaveWritesAllowed(this.dataRoot);

    const rawTenant = this.memoryWorkspaceHandle
      ? memoryWorkspaceHandle.deriveCloudTenantId(this.memoryWorkspaceHandle)
      : this.governance?.tenantId?.trim() || this.resolved.cloudSync?.tenantId?.trim() || null;
    const managed = Boolean(rawTenant && rawTenant !== "__local__");
    const managedTenantId = managed ? rawTenant : null;
    const sourceId = buildCogniWeaveMemorySourceId({
      visibility: params.state.scope.visibility,
      workspaceId: params.state.scope.workspaceId,
      agentId: params.state.scope.agentId,
      projectId: params.state.scope.projectId,
    });
    const ownershipProof = this.governance?.ownershipProof;
    if (managed && !ownershipProof) {
      throw new Error("governance_write_denied:missing_ownership_proof");
    }
    const stateDir = this.governance?.stateDir ?? this.stateDir;
    const session = await prepareMemoryContentWriteSession({
      tenantId: managedTenantId,
      sourceId,
      canonicalLocator: this.metadataStorePath,
      canonicalKind: "cogniweave",
      ownershipProof,
      stateDir,
    });

    let writeCompleted = false;
    let writtenJournal:
      | {
          journalId: string;
          atomIds: string[];
          evidenceIds: string[];
        }
      | undefined;
    try {
      this.writeBackCount += 1;
      const result = await params.state.runtime.engine.writeBack({
        rawInput: params.doc.text,
        scope: params.state.scope,
        sourceType: "document",
        metadata: {
          openbotPath: params.doc.relPath,
          openbotSource: resolveCogniWeaveSourcePolicy(params.doc.source, this.resolved)
            .metadataSource,
          ...(params.doc.sessionKey ? { openbotSessionKey: params.doc.sessionKey } : {}),
          syncReason: params.reason,
        },
      });
      writeCompleted = true;
      // Capture journalId before getWriteJournal so activation failures still revoke.
      writtenJournal = {
        journalId: result.journalId,
        atomIds: [],
        evidenceIds: [],
      };
      const journal = await params.state.runtime.engine.getWriteJournal(
        result.journalId,
        params.state.scope,
      );
      writtenJournal = {
        journalId: result.journalId,
        atomIds: [...journal.objectIds.atomIds],
        evidenceIds: [...journal.objectIds.evidenceIds],
      };
      const indexedDoc: IndexedDocument = {
        ...params.doc,
        atomIds: writtenJournal.atomIds,
        evidenceIds: writtenJournal.evidenceIds,
      };
      params.state.docsByPath.set(params.doc.relPath, indexedDoc);
      for (const evidenceId of writtenJournal.evidenceIds) {
        params.state.pathByEvidenceId.set(evidenceId, params.doc.relPath);
      }
      await finalizeMemoryContentWriteSession({
        session,
        ok: true,
        stateDir,
        allowedRoots: [path.dirname(this.metadataStorePath), stateDir],
      });
    } catch (err) {
      const operationId =
        session.mode === "create_pending" ? session.operationId : `memory-abort-${sourceId}`;
      await finalizeMemoryContentWriteSession({
        session,
        ok: false,
        reason: String((err as Error)?.message ?? err),
        stateDir,
        allowedRoots: [path.dirname(this.metadataStorePath), stateDir],
        logicalCompensate: async () =>
          compensateMemoryJournalWrite({
            operationId,
            resourceId: session.resourceId,
            stateDir,
            atomIds: writtenJournal?.atomIds,
            evidenceIds: writtenJournal?.evidenceIds,
            // Any successful writeBack must revoke even when journal lookup failed.
            revoke: writeCompleted
              ? async () => {
                  await params.state.runtime.engine.forgetSource({
                    operationId,
                    selector: {
                      mode: "legacyLocator",
                      sourceLocator: params.doc.relPath,
                    },
                    subject: { scope: params.state.scope },
                    reasonCode: "GOVERNANCE_CREATE_ABORT",
                  });
                }
              : undefined,
          }),
      });
      throw err;
    }
  }

  private async loadScopeSnapshot(state: ScopeState): Promise<void> {
    if (state.snapshotLoaded) {
      return;
    }
    state.snapshotLoaded = true;
    const snapshot = await readJsonFile<PersistedScopeSnapshot>(
      scopeSnapshotPath(this.stateDir, state.scope),
    );
    if (
      !snapshot ||
      snapshot.version !== 1 ||
      scopeStateKey(snapshot.scope) !== scopeStateKey(state.scope)
    ) {
      return;
    }
    await this.rebuildScopeRuntime({
      state,
      docs: snapshot.docs.map((doc) => ({
        absPath: "",
        relPath: doc.relPath,
        text: doc.text,
        checksum: doc.checksum,
        source: doc.source,
        sessionKey: doc.sessionKey,
      })),
      reason: "snapshot-restore",
    });
    state.lastError = undefined;
    state.lastSyncAt = snapshot.updatedAt;
  }

  private async rebuildScopeRuntime(params: {
    state: ScopeState;
    docs: IndexedDocument[];
    reason: string;
    progress?: (update: MemorySyncProgressUpdate) => void;
  }): Promise<void> {
    params.state.runtime = buildRuntime({
      scope: params.state.scope,
      metadataStorePath: this.metadataStorePath,
    });
    params.state.docsByPath.clear();
    params.state.pathByEvidenceId.clear();
    const total = params.docs.length;
    for (const [index, doc] of params.docs.entries()) {
      params.progress?.({ completed: index, total, label: doc.relPath });
      await this.replayDocumentIntoScope({
        state: params.state,
        doc,
        reason: params.reason,
      });
    }
    params.progress?.({ completed: total, total });
    params.state.manifestHash = manifestHashForDocs([...params.state.docsByPath.values()]);
    params.state.indexStatus = params.state.docsByPath.size > 0 ? "ready" : "empty";
  }

  private async persistScopeSnapshot(state: ScopeState): Promise<void> {
    const docs = [...state.docsByPath.values()].toSorted((left, right) =>
      `${left.source}:${left.relPath}`.localeCompare(`${right.source}:${right.relPath}`),
    );
    await writeJsonAtomic(
      scopeSnapshotPath(this.stateDir, state.scope),
      {
        version: 1,
        scope: state.scope,
        docs: docs.map((doc) => ({
          relPath: doc.relPath,
          text: doc.text,
          checksum: doc.checksum,
          source: doc.source,
          ...(doc.sessionKey ? { sessionKey: doc.sessionKey } : {}),
        })),
        updatedAt: new Date().toISOString(),
      } satisfies PersistedScopeSnapshot,
      { mode: 0o600, trailingNewline: true, ensureDirMode: 0o700 },
    );
  }

  private mergeScopeDocsForCurrentAgent(state: ScopeState, docs: IndexedDocument[]) {
    const merged = new Map<string, IndexedDocument>();
    for (const doc of state.docsByPath.values()) {
      if (
        isScopeDocOwnedByAgent({
          doc,
          scope: state.scope,
          agentId: this.agentId,
        })
      ) {
        continue;
      }
      merged.set(doc.relPath, doc);
    }
    for (const doc of docs) {
      merged.set(doc.relPath, doc);
    }
    return [...merged.values()].toSorted((left, right) =>
      `${left.source}:${left.relPath}`.localeCompare(`${right.source}:${right.relPath}`),
    );
  }

  private replaceDocsCache(docs: IndexedDocument[]): void {
    this.docsByPath.clear();
    this.sessionPathByAbsPath.clear();
    for (const doc of docs) {
      this.docsByPath.set(doc.relPath, doc);
      if (doc.source !== "sessions") {
        continue;
      }
      const resolved = path.resolve(doc.absPath);
      this.sessionPathByAbsPath.set(resolved, doc.relPath);
    }
  }

  private resolveDocumentScope(doc: IndexedDocument): Scope {
    return resolveCogniWeaveDocumentScope({
      agentId: this.agentId,
      workspaceId: this.workspaceId,
      writeSync: this.resolved.writeSync,
      sources: this.resolved.sources,
      sharedSources: this.resolved.sharedSources,
      doc,
    });
  }

  private async listIndexedDocuments(): Promise<IndexedDocument[]> {
    const memoryDocs = await listWorkspaceMemoryDocs(this.workspaceDir);
    const docs: IndexedDocument[] = [];
    if (this.resolved.sources.includes("memory")) {
      docs.push(...memoryDocs);
      const collaborationDocs = await listAllCollaborationMemoryMarkdownDocs(this.cfg);
      for (const doc of collaborationDocs) {
        docs.push({
          absPath: doc.absPath,
          relPath: doc.relPath,
          text: doc.text,
          checksum: computeChecksum(doc.text),
          source: "memory",
          sessionKey: doc.sessionKey,
        });
      }
    }
    if (this.resolved.writeSync !== "disabled" && this.resolved.sources.includes("sessions")) {
      const sessionDocs = await listSessionMemoryDocs(this.agentId);
      docs.push(...sessionDocs);
    }
    return docs.toSorted((left, right) =>
      `${left.source}:${left.relPath}`.localeCompare(`${right.source}:${right.relPath}`),
    );
  }

  private async syncAllScopes(params?: {
    reason?: string;
    force?: boolean;
    progress?: (update: MemorySyncProgressUpdate) => void;
    docs?: IndexedDocument[];
  }): Promise<void> {
    if (this.handleWritesBlocked()) {
      return;
    }
    const docs = params?.docs ?? (await this.listIndexedDocuments());
    this.replaceDocsCache(docs);
    const scopes = new Map<string, Scope>();
    scopes.set(scopeStateKey(this.defaultScope), this.defaultScope);
    for (const doc of docs) {
      const scope = this.resolveDocumentScope(doc);
      scopes.set(scopeStateKey(scope), scope);
    }
    for (const scope of scopes.values()) {
      await this.syncScope(scope, { ...params, docs });
    }
  }

  private async syncImpactedScopesForSessionFile(sessionFile: string): Promise<void> {
    await this.syncImpactedScopesForSessionFiles([sessionFile]);
  }

  private async syncImpactedScopesForSessionFiles(sessionFiles: string[]): Promise<void> {
    const allDocs = await this.listIndexedDocuments();
    this.replaceDocsCache(allDocs);
    const scopes = new Map<string, Scope>();
    for (const sessionFile of new Set(sessionFiles.map((value) => path.resolve(value)))) {
      const targetScope = await this.resolveScopeForSessionFile(sessionFile, allDocs);
      if (!targetScope) {
        await this.syncAllScopes({ reason: "session-delta", force: true, docs: allDocs });
        return;
      }
      scopes.set(scopeStateKey(targetScope), targetScope);
    }
    if (scopes.size === 0) {
      await this.syncAllScopes({ reason: "session-delta", force: true, docs: allDocs });
      return;
    }
    for (const targetScope of scopes.values()) {
      await this.syncScope(targetScope, {
        reason: "session-delta",
        force: true,
        docs: allDocs,
      });
    }
  }

  private async resolveScopeForSessionFile(
    sessionFile: string,
    docs: IndexedDocument[],
  ): Promise<Scope | null> {
    const resolved = path.resolve(sessionFile);
    const real = await fs.realpath(resolved).catch(() => resolved);
    const matchingDoc =
      docs.find((doc) => doc.source === "sessions" && path.resolve(doc.absPath) === real) ??
      docs.find((doc) => doc.source === "sessions" && path.resolve(doc.absPath) === resolved);
    if (matchingDoc) {
      return this.resolveDocumentScope(matchingDoc);
    }

    const relPath =
      this.sessionPathByAbsPath.get(real) ??
      this.sessionPathByAbsPath.get(resolved) ??
      path.join("sessions", this.agentId, path.basename(sessionFile)).replace(/\\/g, "/");
    const cachedDoc =
      [...this.scopeStateKeys]
        .map((key) => EMBEDDED_SCOPE_STATES.get(key))
        .flatMap((state) => (state ? [...state.docsByPath.values()] : []))
        .find((doc) => doc.source === "sessions" && doc.relPath === relPath) ??
      this.docsByPath.get(relPath);
    if (cachedDoc) {
      return this.resolveDocumentScope(cachedDoc);
    }

    const sessionKeyByFile = await resolveSessionKeyByFile(this.agentId);
    const sessionKey = sessionKeyByFile.get(real) ?? sessionKeyByFile.get(resolved);
    if (!sessionKey) {
      return null;
    }
    return resolveCogniWeaveSearchScope({
      agentId: this.agentId,
      sessionKey,
      workspaceId: this.workspaceId,
    });
  }

  private async syncScope(
    scope: Scope,
    params?: {
      reason?: string;
      force?: boolean;
      progress?: (update: MemorySyncProgressUpdate) => void;
      docs?: IndexedDocument[];
    },
  ): Promise<ScopeState> {
    const state = this.getOrCreateScopeState(scope);
    await this.loadScopeSnapshot(state);
    if (this.handleWritesBlocked()) {
      return state;
    }
    const allDocs = params?.docs ?? (await this.listIndexedDocuments());
    this.replaceDocsCache(allDocs);
    const targetKey = scopeStateKey(scope);
    const docs = allDocs.filter(
      (doc) => scopeStateKey(this.resolveDocumentScope(doc)) === targetKey,
    );
    const sourceManifestHash = manifestHashForDocs(docs);
    const nextDocs = this.mergeScopeDocsForCurrentAgent(state, docs);
    const nextManifestHash = manifestHashForDocs(nextDocs);
    if (!params?.force && nextManifestHash === state.manifestHash) {
      return state;
    }

    try {
      await this.rebuildScopeRuntime({
        state,
        docs: nextDocs,
        reason: params?.reason ?? "manual",
        progress: params?.progress,
      });
      state.sourceManifestHash = sourceManifestHash;
      state.lastError = undefined;
      state.lastSyncAt = new Date().toISOString();
      await this.persistScopeSnapshot(state);
      return state;
    } catch (error) {
      state.indexStatus = "stale";
      state.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  async probeEmbeddingAvailability(): Promise<MemoryEmbeddingProbeResult> {
    return { ok: true };
  }

  async probeVectorAvailability(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.sessionUnsubscribe?.();
    if (this.sessionSyncTimer) {
      clearTimeout(this.sessionSyncTimer);
      this.sessionSyncTimer = null;
    }
    this.cloudSyncLoop?.stop();
    this.cloudSyncLoop = null;
    this.pendingSessionFiles.clear();
    for (const key of this.scopeStateKeys) {
      const state = EMBEDDED_SCOPE_STATES.get(key);
      if (!state) {
        continue;
      }
      state.refCount -= 1;
      if (state.refCount <= 0) {
        EMBEDDED_SCOPE_STATES.delete(key);
      }
    }
    this.scopeStateKeys.clear();
  }
}
