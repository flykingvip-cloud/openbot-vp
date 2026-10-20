import type { OpenBotConfig } from "../config/config.js";
import type { CliBackendConfig } from "../config/types.js";
import {
  CLI_FRESH_WATCHDOG_DEFAULTS,
  CLI_RESUME_WATCHDOG_DEFAULTS,
} from "./cli-watchdog-defaults.js";
import { normalizeProviderId } from "./model-selection.js";

export type ResolvedCliBackend = {
  id: string;
  config: CliBackendConfig;
};

const CLAUDE_MODEL_ALIASES: Record<string, string> = {
  opus: "opus",
  "opus-4.6": "opus",
  "opus-4.5": "opus",
  "opus-4": "opus",
  "claude-opus-4-6": "opus",
  "claude-opus-4-5": "opus",
  "claude-opus-4": "opus",
  sonnet: "sonnet",
  "sonnet-4.6": "sonnet",
  "sonnet-4.5": "sonnet",
  "sonnet-4.1": "sonnet",
  "sonnet-4.0": "sonnet",
  "claude-sonnet-4-6": "sonnet",
  "claude-sonnet-4-5": "sonnet",
  "claude-sonnet-4-1": "sonnet",
  "claude-sonnet-4-0": "sonnet",
  haiku: "haiku",
  "haiku-3.5": "haiku",
  "claude-haiku-3-5": "haiku",
};

const CLAUDE_LEGACY_SKIP_PERMISSIONS_ARG = "--dangerously-skip-permissions";
const CLAUDE_PERMISSION_MODE_ARG = "--permission-mode";
const CLAUDE_BYPASS_PERMISSIONS_MODE = "bypassPermissions";

const DEFAULT_CLAUDE_BACKEND: CliBackendConfig = {
  command: "claude",
  args: ["-p", "--output-format", "json", "--permission-mode", "bypassPermissions"],
  resumeArgs: [
    "-p",
    "--output-format",
    "json",
    "--permission-mode",
    "bypassPermissions",
    "--resume",
    "{sessionId}",
  ],
  output: "json",
  input: "arg",
  modelArg: "--model",
  modelAliases: CLAUDE_MODEL_ALIASES,
  sessionArg: "--session-id",
  sessionMode: "always",
  sessionIdFields: ["session_id", "sessionId", "conversation_id", "conversationId"],
  systemPromptArg: "--append-system-prompt",
  systemPromptMode: "append",
  systemPromptWhen: "first",
  clearEnv: ["ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY_OLD"],
  reliability: {
    watchdog: {
      fresh: { ...CLI_FRESH_WATCHDOG_DEFAULTS },
      resume: { ...CLI_RESUME_WATCHDOG_DEFAULTS },
    },
  },
  serialize: true,
};

/** Development Supervisor worker surface (M0/M4): coding agents with CLI spawn. */
const SUPERVISOR_CODING_WORKER_BASE = {
  taskCapabilities: ["coding", "edit", "terminal", "git", "test"],
  timeoutMs: 3_600_000,
  retryableExitCodes: [1, 2],
} as const satisfies Pick<
  NonNullable<CliBackendConfig["worker"]>,
  "taskCapabilities" | "timeoutMs" | "retryableExitCodes"
>;

const CLI_RELIABILITY_DEFAULTS = {
  watchdog: {
    fresh: { ...CLI_FRESH_WATCHDOG_DEFAULTS },
    resume: { ...CLI_RESUME_WATCHDOG_DEFAULTS },
  },
} satisfies NonNullable<CliBackendConfig["reliability"]>;

export const DEFAULT_CODEX_CLI_BACKEND: CliBackendConfig = {
  command: "codex",
  args: [
    "exec",
    "--json",
    "--color",
    "never",
    "--sandbox",
    "workspace-write",
    "--skip-git-repo-check",
  ],
  resumeArgs: [
    "exec",
    "resume",
    "{sessionId}",
    "--color",
    "never",
    "--sandbox",
    "workspace-write",
    "--skip-git-repo-check",
  ],
  output: "jsonl",
  resumeOutput: "text",
  input: "arg",
  modelArg: "--model",
  sessionIdFields: ["thread_id"],
  sessionMode: "existing",
  imageArg: "--image",
  imageMode: "repeat",
  reliability: CLI_RELIABILITY_DEFAULTS,
  serialize: true,
  modelCatalog: [
    {
      id: "gpt-5.4",
      displayName: "GPT-5.4 (Codex CLI)",
      capabilities: { streaming: true, tools: true },
    },
    {
      id: "gpt-5.3-codex",
      displayName: "GPT-5.3 Codex (Codex CLI)",
      capabilities: { streaming: true, tools: true },
    },
  ],
  worker: {
    ...SUPERVISOR_CODING_WORKER_BASE,
    control: ["streaming", "cancellable"],
    statusParser: "jsonl",
  },
};

/**
 * TraeCode CLI 2.0 headless (`traecli exec --json`).
 * Distinct from Trae.app IDE launcher (`trae` → marscode).
 * @see https://docs.trae.cn/cli_about-trae-code-cli-2
 */
export const DEFAULT_TRAE_CLI_BACKEND: CliBackendConfig = {
  command: "traecli",
  args: [
    "exec",
    "--json",
    "--color",
    "never",
    "--sandbox",
    "workspace-write",
    "--skip-git-repo-check",
  ],
  resumeArgs: [
    "exec",
    "resume",
    "{sessionId}",
    "--color",
    "never",
    "--sandbox",
    "workspace-write",
    "--skip-git-repo-check",
  ],
  output: "jsonl",
  resumeOutput: "text",
  input: "arg",
  modelArg: "--model",
  sessionIdFields: ["thread_id", "session_id", "sessionId"],
  sessionMode: "existing",
  imageArg: "--image",
  imageMode: "repeat",
  reliability: CLI_RELIABILITY_DEFAULTS,
  serialize: true,
  modelCatalog: [
    {
      id: "trae-default",
      displayName: "TraeCode (default)",
      capabilities: { streaming: true, tools: true },
    },
  ],
  worker: {
    ...SUPERVISOR_CODING_WORKER_BASE,
    control: ["streaming", "cancellable"],
    statusParser: "jsonl",
  },
};

/** Kiro CLI headless chat (`kiro-cli chat --no-interactive`). */
export const DEFAULT_KIRO_CLI_BACKEND: CliBackendConfig = {
  command: "kiro-cli",
  args: ["chat", "--no-interactive", "--trust-all-tools"],
  resumeArgs: ["chat", "--no-interactive", "--trust-all-tools", "--resume-id", "{sessionId}"],
  output: "text",
  input: "arg",
  modelArg: "--model",
  sessionMode: "existing",
  sessionIdFields: ["session_id", "sessionId", "conversation_id", "thread_id"],
  reliability: CLI_RELIABILITY_DEFAULTS,
  serialize: true,
  modelCatalog: [
    {
      id: "kiro-default",
      displayName: "Kiro (default)",
      capabilities: { streaming: true, tools: true },
    },
  ],
  worker: {
    ...SUPERVISOR_CODING_WORKER_BASE,
    control: ["streaming"],
    statusParser: "text",
  },
};

/**
 * Grok Build CLI headless (`grok -p` + streaming-json).
 * @see https://docs.x.ai/build/cli/headless-scripting
 */
export const DEFAULT_GROK_CLI_BACKEND: CliBackendConfig = {
  command: "grok",
  args: ["--no-auto-update", "--always-approve", "--output-format", "streaming-json", "-p"],
  resumeArgs: [
    "--no-auto-update",
    "--always-approve",
    "--output-format",
    "streaming-json",
    "-r",
    "{sessionId}",
    "-p",
  ],
  output: "jsonl",
  resumeOutput: "jsonl",
  input: "arg",
  modelArg: "--model",
  sessionMode: "existing",
  sessionIdFields: ["session_id", "sessionId", "session-id"],
  clearEnv: ["XAI_API_KEY"],
  reliability: CLI_RELIABILITY_DEFAULTS,
  serialize: true,
  modelCatalog: [
    {
      id: "grok-4.5",
      displayName: "Grok 4.5 (Grok Build CLI)",
      capabilities: { streaming: true, tools: true },
    },
    {
      id: "grok-build-0.1",
      displayName: "Grok Build 0.1 (Grok CLI)",
      capabilities: { streaming: true, tools: true },
    },
  ],
  worker: {
    ...SUPERVISOR_CODING_WORKER_BASE,
    control: ["streaming", "cancellable"],
    statusParser: "jsonl",
  },
};

/** Cursor Agent headless (`cursor-agent --print --output-format stream-json`). */
export const DEFAULT_CURSOR_CLI_BACKEND: CliBackendConfig = {
  command: "cursor-agent",
  args: ["--print", "--output-format", "stream-json", "--force", "--approve-mcps"],
  resumeArgs: [
    "--print",
    "--output-format",
    "stream-json",
    "--force",
    "--approve-mcps",
    "--resume",
    "{sessionId}",
  ],
  output: "jsonl",
  input: "arg",
  modelArg: "--model",
  sessionMode: "existing",
  sessionIdFields: ["chat_id", "chatId", "session_id", "sessionId", "thread_id"],
  reliability: CLI_RELIABILITY_DEFAULTS,
  serialize: true,
  modelCatalog: [
    {
      id: "sonnet-4",
      displayName: "Claude Sonnet 4 (Cursor Agent)",
      capabilities: { streaming: true, tools: true },
    },
    {
      id: "gpt-5",
      displayName: "GPT-5 (Cursor Agent)",
      capabilities: { streaming: true, tools: true },
    },
  ],
  worker: {
    ...SUPERVISOR_CODING_WORKER_BASE,
    control: ["streaming", "cancellable"],
    statusParser: "jsonl",
  },
};

/**
 * Devin CLI headless (`devin -p` + sandbox + dangerous permission mode).
 * Bundled with Devin Desktop (formerly Windsurf); also installable standalone.
 * @see https://docs.devin.ai/cli
 */
export const DEFAULT_DEVIN_CLI_BACKEND: CliBackendConfig = {
  command: "devin",
  args: ["--sandbox", "--permission-mode", "dangerous", "-p"],
  resumeArgs: ["--sandbox", "--permission-mode", "dangerous", "-r", "{sessionId}", "-p"],
  output: "text",
  input: "arg",
  modelArg: "--model",
  sessionMode: "existing",
  sessionIdFields: ["session_id", "sessionId", "conversation_id", "thread_id"],
  reliability: CLI_RELIABILITY_DEFAULTS,
  serialize: true,
  modelCatalog: [
    {
      id: "swe-1.6",
      displayName: "SWE-1.6 (Devin CLI)",
      capabilities: { streaming: true, tools: true },
    },
    {
      id: "gpt-5.5",
      displayName: "GPT-5.5 (Devin CLI)",
      capabilities: { streaming: true, tools: true },
    },
    {
      id: "opus-4.7",
      displayName: "Opus 4.7 (Devin CLI)",
      capabilities: { streaming: true, tools: true },
    },
  ],
  worker: {
    ...SUPERVISOR_CODING_WORKER_BASE,
    control: ["streaming"],
    statusParser: "text",
  },
};

/** @deprecated Use `DEFAULT_DEVIN_CLI_BACKEND` (Windsurf → Devin Desktop rebrand). */
export const DEFAULT_WINDSURF_CLI_BACKEND = DEFAULT_DEVIN_CLI_BACKEND;

function isDevinCliBackendId(normalized: string): boolean {
  return normalized === "devin-cli" || normalized === "windsurf-cli";
}

function normalizeBackendKey(key: string): string {
  return normalizeProviderId(key);
}

function pickBackendConfig(
  config: Record<string, CliBackendConfig>,
  normalizedId: string,
): CliBackendConfig | undefined {
  for (const [key, entry] of Object.entries(config)) {
    if (normalizeBackendKey(key) === normalizedId) {
      return entry;
    }
  }
  return undefined;
}

function mergeBackendConfig(base: CliBackendConfig, override?: CliBackendConfig): CliBackendConfig {
  if (!override) {
    return { ...base };
  }
  const baseFresh = base.reliability?.watchdog?.fresh ?? {};
  const baseResume = base.reliability?.watchdog?.resume ?? {};
  const overrideFresh = override.reliability?.watchdog?.fresh ?? {};
  const overrideResume = override.reliability?.watchdog?.resume ?? {};
  return {
    ...base,
    ...override,
    args: override.args ?? base.args,
    env: { ...base.env, ...override.env },
    modelAliases: { ...base.modelAliases, ...override.modelAliases },
    clearEnv: Array.from(new Set([...(base.clearEnv ?? []), ...(override.clearEnv ?? [])])),
    sessionIdFields: override.sessionIdFields ?? base.sessionIdFields,
    sessionArgs: override.sessionArgs ?? base.sessionArgs,
    resumeArgs: override.resumeArgs ?? base.resumeArgs,
    reliability: {
      ...base.reliability,
      ...override.reliability,
      watchdog: {
        ...base.reliability?.watchdog,
        ...override.reliability?.watchdog,
        fresh: {
          ...baseFresh,
          ...overrideFresh,
        },
        resume: {
          ...baseResume,
          ...overrideResume,
        },
      },
    },
  };
}

function normalizeClaudePermissionArgs(args?: string[]): string[] | undefined {
  if (!args) {
    return args;
  }
  const normalized: string[] = [];
  let sawLegacySkip = false;
  let hasPermissionMode = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === CLAUDE_LEGACY_SKIP_PERMISSIONS_ARG) {
      sawLegacySkip = true;
      continue;
    }
    if (arg === CLAUDE_PERMISSION_MODE_ARG) {
      hasPermissionMode = true;
      normalized.push(arg);
      const maybeValue = args[i + 1];
      if (typeof maybeValue === "string") {
        normalized.push(maybeValue);
        i += 1;
      }
      continue;
    }
    if (arg.startsWith(`${CLAUDE_PERMISSION_MODE_ARG}=`)) {
      hasPermissionMode = true;
    }
    normalized.push(arg);
  }
  if (sawLegacySkip && !hasPermissionMode) {
    normalized.push(CLAUDE_PERMISSION_MODE_ARG, CLAUDE_BYPASS_PERMISSIONS_MODE);
  }
  return normalized;
}

function normalizeClaudeBackendConfig(config: CliBackendConfig): CliBackendConfig {
  return {
    ...config,
    args: normalizeClaudePermissionArgs(config.args),
    resumeArgs: normalizeClaudePermissionArgs(config.resumeArgs),
  };
}

export function resolveCliBackendIds(cfg?: OpenBotConfig): Set<string> {
  const ids = new Set<string>([
    normalizeBackendKey("claude-cli"),
    normalizeBackendKey("codex-cli"),
    normalizeBackendKey("trae-cli"),
    normalizeBackendKey("kiro-cli"),
    normalizeBackendKey("cursor-cli"),
    normalizeBackendKey("devin-cli"),
    normalizeBackendKey("grok-cli"),
  ]);
  const configured = cfg?.agents?.defaults?.cliBackends ?? {};
  for (const key of Object.keys(configured)) {
    ids.add(normalizeBackendKey(key));
  }
  return ids;
}

export function resolveCliBackendConfig(
  provider: string,
  cfg?: OpenBotConfig,
): ResolvedCliBackend | null {
  const normalized = normalizeBackendKey(provider);
  const configured = cfg?.agents?.defaults?.cliBackends ?? {};
  const override = pickBackendConfig(configured, normalized);

  if (normalized === "claude-cli") {
    const merged = mergeBackendConfig(DEFAULT_CLAUDE_BACKEND, override);
    const config = normalizeClaudeBackendConfig(merged);
    const command = config.command?.trim();
    if (!command) {
      return null;
    }
    return { id: normalized, config: { ...config, command } };
  }
  if (normalized === "codex-cli") {
    const merged = mergeBackendConfig(DEFAULT_CODEX_CLI_BACKEND, override);
    const command = merged.command?.trim();
    if (!command) {
      return null;
    }
    return { id: normalized, config: { ...merged, command } };
  }
  if (normalized === "trae-cli") {
    const merged = mergeBackendConfig(DEFAULT_TRAE_CLI_BACKEND, override);
    const command = merged.command?.trim();
    if (!command) {
      return null;
    }
    return { id: normalized, config: { ...merged, command } };
  }
  if (normalized === "kiro-cli") {
    const merged = mergeBackendConfig(DEFAULT_KIRO_CLI_BACKEND, override);
    const command = merged.command?.trim();
    if (!command) {
      return null;
    }
    return { id: normalized, config: { ...merged, command } };
  }
  if (normalized === "cursor-cli") {
    const merged = mergeBackendConfig(DEFAULT_CURSOR_CLI_BACKEND, override);
    const command = merged.command?.trim();
    if (!command) {
      return null;
    }
    return { id: normalized, config: { ...merged, command } };
  }
  if (isDevinCliBackendId(normalized)) {
    const merged = mergeBackendConfig(DEFAULT_DEVIN_CLI_BACKEND, override);
    const command = merged.command?.trim();
    if (!command) {
      return null;
    }
    return { id: normalized, config: { ...merged, command } };
  }
  if (normalized === "grok-cli") {
    const merged = mergeBackendConfig(DEFAULT_GROK_CLI_BACKEND, override);
    const command = merged.command?.trim();
    if (!command) {
      return null;
    }
    return { id: normalized, config: { ...merged, command } };
  }

  if (!override) {
    return null;
  }
  const command = override.command?.trim();
  if (!command) {
    return null;
  }
  return { id: normalized, config: { ...override, command } };
}
