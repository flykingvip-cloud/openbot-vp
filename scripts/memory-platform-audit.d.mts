/** Type boundary for scripts/memory-platform-audit.mjs (NodeNext + sibling .d.mts). */

export type EmptyMarkdownClass =
  | "diagnostic-insufficient"
  | "source-missing"
  | "new-empty-agent"
  | "confirmed-anomaly";

export type AuditPriority = "P0" | "P1" | "P2" | "info";

export type EmptyMarkdownClassification = {
  emptyMarkdownClass: EmptyMarkdownClass;
  action: string;
  priority: AuditPriority;
  detail: string;
};

export type AgentRecoveryResult = {
  action: string;
  priority: AuditPriority;
  detail: string;
  emptyMarkdownClass?: EmptyMarkdownClass;
};

export type FormalScopeHint = {
  workspaceId: string;
  projectId: string;
  visibility: string;
};

export type FormalDefaultScopeResult = {
  scopeHint: FormalScopeHint | null;
  scopeSource: string;
  scopeSourceDetail: string;
};

export type CogniWeaveScopeCounts = {
  readable: boolean;
  totalAtoms: number | null;
  byAgentId: Record<string, number>;
  byCompleteScope: Record<string, number>;
  scopeTrusted: boolean;
  error: string | null;
};

export type TrustedScopeAtomCountResult = {
  scopeAtomCount: number | null;
  scopeReadable: boolean;
  scopeTrusted: boolean;
};

export type AlternateRootRow = {
  path: string;
  memoryMd: number;
  kind?: string;
};

export type ClassifyEmptyMarkdownParams = {
  backend: string;
  memoryMdAtResolved: number;
  scopeAtomCount: number | null;
  scopeReadable: boolean;
  scopeTrusted: boolean;
  configuredWorkspace: string | null | undefined;
  cogniweaveMode?: string | null;
  agentCreatedAt?: string | null;
  expectedEmptyEvidence?: boolean;
};

export type ClassifyAgentRecoveryParams = {
  memoryMdAtResolved: number;
  alternateRoots: AlternateRootRow[];
  conflictByRule: boolean;
  secretConfigured: boolean;
  resolvedWorkspace: string;
  backend: string;
  scopeAtomCount: number | null;
  scopeReadable: boolean;
  scopeTrusted: boolean;
  configuredWorkspace: string | null | undefined;
  cogniweaveMode?: string | null;
  agentCreatedAt?: string | null;
  expectedEmptyEvidence?: boolean;
};

export type AuditConfigLike = {
  data?: { root?: string | null };
  memory?: {
    backend?: string;
    cogniweave?: { mode?: string; storePath?: string | null };
  };
  agents?: unknown;
};

export function resolveAuditDataRoot(cfg: AuditConfigLike | null | undefined): string;

export function resolveCogniWeaveStorePath(
  stateDir: string,
  cfg: AuditConfigLike | null | undefined,
): string;

export function stableId(prefix: string, input: string): string;

export function resolveFormalDefaultScopeHint(params: {
  agentId?: string;
  stateDir?: string;
}): FormalDefaultScopeResult;

export function readCogniWeaveScopeCounts(storePath: string): CogniWeaveScopeCounts;

export function resolveTrustedScopeAtomCount(params: {
  counts: {
    readable?: boolean;
    scopeTrusted?: boolean;
    byCompleteScope?: Record<string, number>;
  };
  agentId: string;
  scopeHint?: {
    workspaceId?: string;
    projectId?: string;
    visibility?: string;
  } | null;
}): TrustedScopeAtomCountResult;

export function classifyEmptyMarkdown(
  params: ClassifyEmptyMarkdownParams,
): EmptyMarkdownClassification | null;

export function classifyAgentRecovery(params: ClassifyAgentRecoveryParams): AgentRecoveryResult;

export function listConflictAgentIds(stateDir: string, tenantsRoot?: string): string[];
