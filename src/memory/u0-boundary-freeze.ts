/**
 * U0 freeze scanners and read-only inventory.
 * Detects current debt and blocks new backends / identity sources.
 * Does not delete production call-sites, write Catalog, or change Resolver.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

export const U0_FROZEN_MEMORY_BACKENDS = ["builtin", "qmd", "cogniweave"] as const;

export const U0_MEMORY_BACKEND_TYPE_LITERAL =
  'export type MemoryBackend = "builtin" | "qmd" | "cogniweave"';

export type U0FrozenCallCount = {
  file: string;
  count: number;
};

export const U0_SELF_RESOLVE_CALLEES = [
  "resolveAgentWorkspaceDir",
  "resolveStateDir",
  "resolveDataRoot",
] as const;

export type U0SelfResolveCallee = (typeof U0_SELF_RESOLVE_CALLEES)[number];

/** Live-debt strings still present in cogniweave-manager.ts. Not used as the scanner. */
export const U0_P0_DEBT_MARKERS = [
  'stableId("ws", path.resolve(this.stateDir))',
  "resolveAgentWorkspaceDir(cfg, agentId)",
  "resolveStateDir(process.env)",
  "resolveDataRoot(cfg, process.env)",
] as const;

export const U0_STABLE_ID_WS_BASELINE: readonly U0FrozenCallCount[] = [
  { file: "src/memory/cogniweave-manager.ts", count: 1 },
];

export const U0_SELF_RESOLVE_BASELINE: Record<U0SelfResolveCallee, readonly U0FrozenCallCount[]> = {
  resolveAgentWorkspaceDir: [
    { file: "src/memory/backend-config.ts", count: 2 },
    { file: "src/memory/cogniweave-manager.ts", count: 1 },
    { file: "src/memory/manager.ts", count: 1 },
    { file: "src/memory/qmd-manager.ts", count: 1 },
  ],
  resolveStateDir: [
    { file: "src/memory/cogniweave-manager.ts", count: 1 },
    { file: "src/memory/qmd-manager.ts", count: 1 },
  ],
  resolveDataRoot: [
    { file: "src/memory/cogniweave-manager.ts", count: 1 },
    { file: "src/memory/search-manager.ts", count: 2 },
  ],
};

export const U0_AGENT_ID_LONG_TERM_SCOPE_BASELINE: readonly U0FrozenCallCount[] = [
  { file: "src/memory/backend-config.ts", count: 1 },
  { file: "src/memory/batch-gemini.ts", count: 1 },
  { file: "src/memory/batch-openai.ts", count: 1 },
  { file: "src/memory/batch-voyage.ts", count: 1 },
  { file: "src/memory/cogniweave-manager.ts", count: 16 },
  { file: "src/memory/doctor-status.ts", count: 4 },
  { file: "src/memory/embedding-manager.test-harness.ts", count: 2 },
  { file: "src/memory/health-probe.ts", count: 2 },
  { file: "src/memory/manager-embedding-ops.ts", count: 1 },
  { file: "src/memory/manager-sync-ops.ts", count: 1 },
  { file: "src/memory/manager.ts", count: 1 },
  { file: "src/memory/memory-center-atoms.ts", count: 7 },
  { file: "src/memory/qmd-manager.ts", count: 1 },
  { file: "src/memory/search-manager.ts", count: 2 },
  { file: "src/memory/test-manager-helpers.ts", count: 1 },
  { file: "src/memory/test-manager.ts", count: 1 },
];

export const U0_ALLOWED_STABLE_ID_FILES = U0_STABLE_ID_WS_BASELINE.map((row) => row.file);

export const U0_ALLOWED_SELF_RESOLVE_FILES = {
  resolveAgentWorkspaceDir: U0_SELF_RESOLVE_BASELINE.resolveAgentWorkspaceDir.map(
    (row) => row.file,
  ),
  resolveStateDir: U0_SELF_RESOLVE_BASELINE.resolveStateDir.map((row) => row.file),
  resolveDataRoot: U0_SELF_RESOLVE_BASELINE.resolveDataRoot.map((row) => row.file),
} as const;

export const U0_ALLOWED_AGENT_ID_LONG_TERM_SCOPE_FILES = U0_AGENT_ID_LONG_TERM_SCOPE_BASELINE.map(
  (row) => row.file,
);

/** @deprecated Use U0_SELF_RESOLVE_CALLEES; kept for existing test imports. */
export const U0_SELF_RESOLVE_MARKERS = U0_SELF_RESOLVE_CALLEES;

export const U0_ALLOWED_MANAGER_CLASSES = [
  "MemoryIndexManager",
  "QmdMemoryManager",
  "CogniWeaveMemoryManager",
  "FallbackMemoryManager",
  "RecallDenyMemorySearchManager",
] as const;

export const U0_CHECKED_INVENTORY_RELPATH =
  "docs/design/evidence/openbot-cogniweave-u0-readonly-inventory-2026-08-19.json";

export type U0InventoryOperation = "read" | "write" | "prune" | "reset" | "sync" | "distill";

export type U0InventoryRow = {
  backend: (typeof U0_FROZEN_MEMORY_BACKENDS)[number];
  file: string;
  symbol: string;
  operation: U0InventoryOperation;
  identitySource: string;
  scopeSource: string;
  pathResolution: string;
  fallback: string;
  owner: string;
  retirementPhase: "keep-U1" | "item7-after-U1-U2" | "wrapper-only";
};

export const U0_READ_ONLY_INVENTORY_SITES: readonly U0InventoryRow[] = [
  {
    backend: "builtin",
    file: "src/memory/manager.ts",
    symbol: "search",
    operation: "read",
    identitySource: "agentId + workspaceDir",
    scopeSource: "agentId / sessionKey",
    pathResolution: "MemoryIndexManager workspaceDir",
    fallback: "none",
    owner: "cursor-memory-wsc",
    retirementPhase: "item7-after-U1-U2",
  },
  {
    backend: "builtin",
    file: "src/memory/manager.ts",
    symbol: "sync",
    operation: "sync",
    identitySource: "agentId + workspaceDir",
    scopeSource: "agentId / sessionKey",
    pathResolution: "MemoryIndexManager workspaceDir",
    fallback: "none",
    owner: "cursor-memory-wsc",
    retirementPhase: "item7-after-U1-U2",
  },
  {
    backend: "builtin",
    file: "src/memory/manager-sync-ops.ts",
    symbol: "resetIndex",
    operation: "reset",
    identitySource: "v1 fingerprint + agent workspace",
    scopeSource: "configured memory/sessions sources",
    pathResolution: "sqlite under workspaceDir",
    fallback: "none",
    owner: "cursor-memory-wsc",
    retirementPhase: "item7-after-U1-U2",
  },
  {
    backend: "builtin",
    file: "src/memory/manager-sync-ops.ts",
    symbol: "runUnsafeReindexInternal",
    operation: "prune",
    identitySource: "v1 fingerprint + agent workspace",
    scopeSource: "configured memory/sessions sources",
    pathResolution: "sqlite under workspaceDir",
    fallback: "none",
    owner: "cursor-memory-wsc",
    retirementPhase: "item7-after-U1-U2",
  },
  {
    backend: "builtin",
    file: "src/memory/manager-embedding-ops.ts",
    symbol: "indexFile",
    operation: "write",
    identitySource: "agentId + workspaceDir sqlite",
    scopeSource: "path + source under MemoryIndexManager",
    pathResolution: "INSERT/DELETE chunks, files, vector, fts under workspaceDir",
    fallback: "none",
    owner: "cursor-memory-wsc",
    retirementPhase: "item7-after-U1-U2",
  },
  {
    backend: "builtin",
    file: "src/memory/manager-embedding-ops.ts",
    symbol: "upsertEmbeddingCache",
    operation: "write",
    identitySource: "provider + model + provider_key + hash",
    scopeSource: "embedding cache table in workspace sqlite",
    pathResolution: "INSERT embedding_cache under workspaceDir",
    fallback: "none",
    owner: "cursor-memory-wsc",
    retirementPhase: "item7-after-U1-U2",
  },
  {
    backend: "builtin",
    file: "src/memory/manager-embedding-ops.ts",
    symbol: "pruneEmbeddingCacheIfNeeded",
    operation: "prune",
    identitySource: "v1 prune authorization + cache maxEntries",
    scopeSource: "embedding cache table in workspace sqlite",
    pathResolution: "DELETE oldest embedding_cache rows",
    fallback: "none",
    owner: "cursor-memory-wsc",
    retirementPhase: "item7-after-U1-U2",
  },
  {
    backend: "qmd",
    file: "src/memory/qmd-manager.ts",
    symbol: "search",
    operation: "read",
    identitySource: "agentId collections",
    scopeSource: "qmd collection names scoped by agentId",
    pathResolution: "resolveAgentWorkspaceDir + qmd paths",
    fallback: "none-at-manager; search-manager may fall back",
    owner: "cursor-conversation-lifecycle",
    retirementPhase: "item7-after-U1-U2",
  },
  {
    backend: "qmd",
    file: "src/memory/qmd-manager.ts",
    symbol: "sync",
    operation: "sync",
    identitySource: "agentId collections",
    scopeSource: "qmd collection names scoped by agentId",
    pathResolution: "resolveAgentWorkspaceDir + qmd paths",
    fallback: "none-at-manager; search-manager may fall back",
    owner: "cursor-conversation-lifecycle",
    retirementPhase: "item7-after-U1-U2",
  },
  {
    backend: "qmd",
    file: "src/memory/qmd-manager.ts",
    symbol: "rebuildManagedCollectionsForRepair",
    operation: "reset",
    identitySource: "agentId collections",
    scopeSource: "qmd collection names scoped by agentId",
    pathResolution: "resolveAgentWorkspaceDir + qmd paths",
    fallback: "repair-only",
    owner: "cursor-conversation-lifecycle",
    retirementPhase: "item7-after-U1-U2",
  },
  {
    backend: "qmd",
    file: "src/memory/search-manager.ts",
    symbol: "FallbackMemoryManager",
    operation: "write",
    identitySource: "caller agentId",
    scopeSource: "same as builtin fallback manager",
    pathResolution: "MemoryIndexManager.get after QMD failure",
    fallback: "qmd -> builtin implicit write",
    owner: "cursor-conversation-lifecycle",
    retirementPhase: "wrapper-only",
  },
  {
    backend: "cogniweave",
    file: "src/memory/cogniweave-manager.ts",
    symbol: "search",
    operation: "read",
    identitySource: 'stableId("ws", stateDir)',
    scopeSource: "agentId + sessionKey-derived visibility",
    pathResolution: "resolveAgentWorkspaceDir / resolveStateDir / resolveDataRoot",
    fallback: "none",
    owner: "cursor-conversation-lifecycle",
    retirementPhase: "keep-U1",
  },
  {
    backend: "cogniweave",
    file: "src/memory/cogniweave-manager.ts",
    symbol: "sync",
    operation: "sync",
    identitySource: 'stableId("ws", stateDir)',
    scopeSource: "agentId + sessionKey-derived visibility",
    pathResolution: "resolveAgentWorkspaceDir / resolveStateDir / resolveDataRoot",
    fallback: "none",
    owner: "cursor-conversation-lifecycle",
    retirementPhase: "keep-U1",
  },
  {
    backend: "cogniweave",
    file: "src/memory/cogniweave-manager.ts",
    symbol: "syncScope",
    operation: "distill",
    identitySource: 'stableId("ws", stateDir)',
    scopeSource: "Scope.agentId + visibility",
    pathResolution: "portable canonical store from stateDir/dataRoot",
    fallback: "none",
    owner: "cursor-conversation-lifecycle",
    retirementPhase: "keep-U1",
  },
  {
    backend: "cogniweave",
    file: "src/memory/cogniweave-manager.ts",
    symbol: "applyTranscriptSourceLifecycle",
    operation: "write",
    identitySource: 'stableId("ws", stateDir)',
    scopeSource: "sourceIdentityId / sourceLocator",
    pathResolution: "canonical store + workspaceDir",
    fallback: "none",
    owner: "cursor-conversation-lifecycle",
    retirementPhase: "keep-U1",
  },
  {
    backend: "cogniweave",
    file: "src/memory/cogniweave-cloud-sync-drain.ts",
    symbol: "drainCogniWeaveCloudSync",
    operation: "sync",
    identitySource: "CloudAuthContext (must become Handle.tenantId in U1)",
    scopeSource: "configured cloud tenantId (consistency-check only after U1)",
    pathResolution: "stateDir outbox/mirror",
    fallback: "none",
    owner: "cursor-conversation-lifecycle",
    retirementPhase: "keep-U1",
  },
];

export const U0_INVENTORY_META = {
  schema: "openbot-cogniweave-u0-readonly-inventory/v1",
  kind: "u0-readonly-call-sites",
  productionSoT: false,
  unlock: "not-issued",
  phase1bExecutionBlocked: true,
  deployAuthorized: false,
  authorizes: "U0-only",
  siteCount: U0_READ_ONLY_INVENTORY_SITES.length,
} as const;

function isScannableMemoryTs(rel: string): boolean {
  return !rel.includes("u0-boundary-freeze") && !rel.endsWith(".test.ts");
}

export function walkTsFiles(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) {
    return acc;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkTsFiles(full, acc);
      continue;
    }
    if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      acc.push(full);
    }
  }
  return acc;
}

function parseMemorySource(fileName: string, text: string): ts.SourceFile {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function walkAst(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => walkAst(child, visit));
}

function calleeName(expr: ts.Expression): string | null {
  if (ts.isIdentifier(expr)) {
    return expr.text;
  }
  if (ts.isPropertyAccessExpression(expr)) {
    return expr.name.text;
  }
  return null;
}

function isStringLiteralValue(node: ts.Expression, value: string): boolean {
  return (
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && node.text === value
  );
}

function isScopeAgentIdAccess(node: ts.Node): boolean {
  if (!ts.isPropertyAccessExpression(node) || node.name.text !== "agentId") {
    return false;
  }
  if (ts.isIdentifier(node.expression) && node.expression.text === "scope") {
    return true;
  }
  return ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "scope";
}

function isObjectLiteralAgentIdAssignment(node: ts.Node): boolean {
  if (!node.parent || !ts.isObjectLiteralExpression(node.parent)) {
    return false;
  }
  if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === "agentId") {
    return true;
  }
  return ts.isShorthandPropertyAssignment(node) && node.name.text === "agentId";
}

export function summarizeCallCounts(files: readonly string[]): U0FrozenCallCount[] {
  const counts = new Map<string, number>();
  for (const file of files) {
    counts.set(file, (counts.get(file) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([file, count]) => ({ file, count }))
    .toSorted((left, right) => left.file.localeCompare(right.file));
}

function scanMemoryAst(
  repoRoot: string,
  visit: (node: ts.Node, rel: string) => boolean,
): U0FrozenCallCount[] {
  const hits: string[] = [];
  const memoryRoot = path.join(repoRoot, "src/memory");
  for (const file of walkTsFiles(memoryRoot)) {
    const rel = path.relative(repoRoot, file).split(path.sep).join("/");
    if (!isScannableMemoryTs(rel)) {
      continue;
    }
    const source = parseMemorySource(rel, fs.readFileSync(file, "utf8"));
    walkAst(source, (node) => {
      if (visit(node, rel)) {
        hits.push(rel);
      }
    });
  }
  return summarizeCallCounts(hits);
}

export function scanSelfResolveCalls(
  repoRoot: string,
  callee: U0SelfResolveCallee,
): U0FrozenCallCount[] {
  return scanMemoryAst(
    repoRoot,
    (node) => ts.isCallExpression(node) && calleeName(node.expression) === callee,
  );
}

export function scanStableIdWsCalls(repoRoot: string): U0FrozenCallCount[] {
  return scanMemoryAst(repoRoot, (node) => {
    if (!ts.isCallExpression(node) || calleeName(node.expression) !== "stableId") {
      return false;
    }
    const first = node.arguments[0];
    return Boolean(first && isStringLiteralValue(first, "ws"));
  });
}

export function scanAgentIdLongTermScope(repoRoot: string): U0FrozenCallCount[] {
  return scanMemoryAst(
    repoRoot,
    (node) => isScopeAgentIdAccess(node) || isObjectLiteralAgentIdAssignment(node),
  );
}

export function findStableIdWorkspaceIdentities(repoRoot: string): string[] {
  return scanStableIdWsCalls(repoRoot).map((row) => row.file);
}

export function findSelfResolvedCallSites(repoRoot: string, callee: U0SelfResolveCallee): string[] {
  return scanSelfResolveCalls(repoRoot, callee).map((row) => row.file);
}

export function findSelfResolvedManagerRoots(repoRoot: string): string[] {
  return [
    ...new Set(
      U0_SELF_RESOLVE_CALLEES.flatMap((callee) => findSelfResolvedCallSites(repoRoot, callee)),
    ),
  ].toSorted();
}

export function findAgentIdLongTermScopeSites(repoRoot: string): string[] {
  return scanAgentIdLongTermScope(repoRoot).map((row) => row.file);
}

export function findMemoryManagerClassNames(repoRoot: string): string[] {
  const memoryRoot = path.join(repoRoot, "src/memory");
  const names = new Set<string>();
  const classRe = /(?:export )?class (\w+) implements MemorySearchManager/g;
  for (const file of walkTsFiles(memoryRoot)) {
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(classRe)) {
      names.add(match[1]);
    }
  }
  return [...names].toSorted();
}

export function buildU0ReadonlyInventoryDocument() {
  return {
    ...U0_INVENTORY_META,
    note: "Read-only call-site inventory. Not Catalog SoT, not item 2/6/7 met, not unlock.",
    sites: U0_READ_ONLY_INVENTORY_SITES,
    explicitlyForbidden: [
      "treat this inventory as production SoT",
      "delete listed call-sites in U0",
      "write Catalog",
      "change production resolver",
      "U1+ / LIVE / schema-v2-write",
    ],
  };
}

export function readCheckedU0ReadonlyInventory(repoRoot: string) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, U0_CHECKED_INVENTORY_RELPATH), "utf8"));
}
