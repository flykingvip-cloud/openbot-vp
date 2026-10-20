import type { SessionSendPolicyConfig } from "./types.base.js";

export type MemoryBackend = "builtin" | "qmd" | "cogniweave";
export type MemoryCitationsMode = "auto" | "on" | "off";
export type MemoryQmdSearchMode = "query" | "search" | "vsearch";
export type MemoryCogniWeaveMode = "embedded" | "rest";
export type MemoryCogniWeaveScopeStrategy = "default";
export type MemoryCogniWeaveWriteSyncMode = "disabled" | "async" | "sync";
export type MemoryCogniWeaveSource = "memory" | "sessions";

export type MemoryConfig = {
  backend?: MemoryBackend;
  citations?: MemoryCitationsMode;
  qmd?: MemoryQmdConfig;
  cogniweave?: MemoryCogniWeaveConfig;
};

export type MemoryCogniWeaveConfig = {
  mode?: MemoryCogniWeaveMode;
  endpoint?: string;
  storePath?: string;
  scopeStrategy?: MemoryCogniWeaveScopeStrategy;
  writeSync?: MemoryCogniWeaveWriteSyncMode;
  sources?: MemoryCogniWeaveSource[];
  sharedSources?: MemoryCogniWeaveSource[];
  /**
   * Optional cloud intelligence sync (CW2-P5). Default disabled — local memory
   * must not depend on cloud. When enabled, manager runs async outbox drain +
   * mirror pull (never on writeBack hot path).
   */
  cloudSync?: MemoryCogniWeaveCloudSyncConfig;
};

export type MemoryCogniWeaveCloudSyncConfig = {
  enabled?: boolean;
  /** Background tick interval (ms). Default 60_000. */
  intervalMs?: number;
  tenantId?: string;
  deviceId?: string;
  /** Service credential for CloudIntelligenceClient (stub/InMemory until HTTP). */
  credential?: string;
};

export type MemoryQmdConfig = {
  command?: string;
  mcporter?: MemoryQmdMcporterConfig;
  searchMode?: MemoryQmdSearchMode;
  includeDefaultMemory?: boolean;
  paths?: MemoryQmdIndexPath[];
  sessions?: MemoryQmdSessionConfig;
  update?: MemoryQmdUpdateConfig;
  limits?: MemoryQmdLimitsConfig;
  scope?: SessionSendPolicyConfig;
};

export type MemoryQmdMcporterConfig = {
  /**
   * Route QMD searches through mcporter (MCP runtime) instead of spawning `qmd` per query.
   * Requires:
   * - `mcporter` installed and on PATH
   * - A configured mcporter server that runs `qmd mcp` with `lifecycle: keep-alive`
   */
  enabled?: boolean;
  /** mcporter server name (defaults to "qmd") */
  serverName?: string;
  /** Start the mcporter daemon automatically (defaults to true when enabled). */
  startDaemon?: boolean;
};

export type MemoryQmdIndexPath = {
  path: string;
  name?: string;
  pattern?: string;
};

export type MemoryQmdSessionConfig = {
  enabled?: boolean;
  exportDir?: string;
  retentionDays?: number;
};

export type MemoryQmdUpdateConfig = {
  interval?: string;
  debounceMs?: number;
  onBoot?: boolean;
  waitForBootSync?: boolean;
  embedInterval?: string;
  commandTimeoutMs?: number;
  updateTimeoutMs?: number;
  embedTimeoutMs?: number;
};

export type MemoryQmdLimitsConfig = {
  maxResults?: number;
  maxSnippetChars?: number;
  maxInjectedChars?: number;
  timeoutMs?: number;
};
