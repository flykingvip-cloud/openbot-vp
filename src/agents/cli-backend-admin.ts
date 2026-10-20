/**
 * cli-backend-admin.ts — admin-facing helpers for managing CLI backends
 * (the third-party coding-agent CLIs that bots can use as a model backend).
 *
 * This is the read/validate/describe layer behind the platform "协作工具 / CLI
 * 后端" admin surface. It does NOT spawn anything — process probing lives in the
 * gateway handler. Pure functions here so they are trivially unit-testable.
 *
 * SECURITY: a CLI backend ultimately spawns `command` with `args` on the gateway
 * host (often with permission-bypass flags). Editing one is effectively
 * arbitrary local command execution, so the gateway handlers gate writes to the
 * platform-admin scope and audit every change. This module only validates shape.
 */

import { z } from "zod";
import type { OpenBotConfig } from "../config/config.js";
import type { CliBackendConfig, CliBackendModelCatalogEntry } from "../config/types.js";
import {
  DEFAULT_CODEX_CLI_BACKEND,
  DEFAULT_TRAE_CLI_BACKEND,
  DEFAULT_CURSOR_CLI_BACKEND,
  DEFAULT_DEVIN_CLI_BACKEND,
  DEFAULT_GROK_CLI_BACKEND,
  DEFAULT_KIRO_CLI_BACKEND,
  resolveCliBackendConfig,
  resolveCliBackendIds,
} from "./cli-backends.js";

/** Built-in backends that ship with sane defaults (cannot be deleted, only overridden). */
export const BUILTIN_CLI_BACKEND_IDS = [
  "claude-cli",
  "codex-cli",
  "trae-cli",
  "kiro-cli",
  "cursor-cli",
  "devin-cli",
  "grok-cli",
] as const;

const watchdogProfileSchema = z
  .object({
    noOutputTimeoutMs: z.number().int().positive().optional(),
    noOutputTimeoutRatio: z.number().positive().optional(),
    minMs: z.number().int().positive().optional(),
    maxMs: z.number().int().positive().optional(),
  })
  .strict();

/** Structured exposed-model catalog entry (cli-backend-onboarding P0-1/P1-1). */
export const CliBackendModelCatalogEntrySchema = z
  .object({
    id: z
      .string()
      .trim()
      .min(1, "model id is required")
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "model id must be alphanumeric (. _ - allowed)"),
    displayName: z.string().trim().max(200).optional(),
    visibility: z.enum(["enterprise", "platform"]).optional(),
    capabilities: z
      .object({
        streaming: z.boolean().optional(),
        tools: z.boolean().optional(),
        vision: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

/** Zod schema mirroring CliBackendConfig (validated before persisting). */
export const CliBackendConfigSchema = z
  .object({
    command: z.string().trim().min(1, "command is required"),
    args: z.array(z.string()).optional(),
    output: z.enum(["json", "text", "jsonl"]).optional(),
    resumeOutput: z.enum(["json", "text", "jsonl"]).optional(),
    input: z.enum(["arg", "stdin"]).optional(),
    maxPromptArgChars: z.number().int().positive().optional(),
    env: z.record(z.string(), z.string()).optional(),
    clearEnv: z.array(z.string()).optional(),
    modelArg: z.string().optional(),
    modelAliases: z.record(z.string(), z.string()).optional(),
    sessionArg: z.string().optional(),
    sessionArgs: z.array(z.string()).optional(),
    resumeArgs: z.array(z.string()).optional(),
    sessionMode: z.enum(["always", "existing", "none"]).optional(),
    sessionIdFields: z.array(z.string()).optional(),
    systemPromptArg: z.string().optional(),
    systemPromptMode: z.enum(["append", "replace"]).optional(),
    systemPromptWhen: z.enum(["first", "always", "never"]).optional(),
    imageArg: z.string().optional(),
    imageMode: z.enum(["repeat", "list"]).optional(),
    serialize: z.boolean().optional(),
    modelCatalog: z.array(CliBackendModelCatalogEntrySchema).optional(),
    worker: z
      .object({
        taskCapabilities: z.array(z.enum(["coding", "edit", "terminal", "git", "test"])).optional(),
        control: z
          .array(z.enum(["streaming", "checkpoint", "cancellable", "interactive"]))
          .optional(),
        statusParser: z.enum(["json", "jsonl", "text"]).optional(),
        timeoutMs: z.number().int().positive().optional(),
        retryableExitCodes: z.array(z.number().int()).optional(),
      })
      .strict()
      .optional(),
    reliability: z
      .object({
        watchdog: z
          .object({
            fresh: watchdogProfileSchema.optional(),
            resume: watchdogProfileSchema.optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

/** Backend id: lowercase slug, must not collide with the model-ref separator. */
export const CliBackendIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "id must be a lowercase slug (a-z, 0-9, -)");

/** Validate a raw CLI backend id (throws on invalid). */
export function validateCliBackendId(raw: unknown): string {
  return CliBackendIdSchema.parse(raw);
}

/** Validate a raw CLI backend config (throws ZodError on invalid). */
export function validateCliBackendConfig(raw: unknown): CliBackendConfig {
  return CliBackendConfigSchema.parse(raw) as CliBackendConfig;
}

/** A described backend for the admin list view. */
export interface CliBackendDescriptor {
  id: string;
  /** "builtin" (ships defaults), "config" (config-only), or "override" (builtin + config). */
  source: "builtin" | "config" | "override";
  /** Effective (merged) config used at runtime. */
  effective: CliBackendConfig | null;
  /** True if there is an explicit config entry for this id. */
  configured: boolean;
}

/** List all known backends (built-ins + configured), with effective config + source. */
export function describeCliBackends(cfg?: OpenBotConfig): CliBackendDescriptor[] {
  const configured = cfg?.agents?.defaults?.cliBackends ?? {};
  const configuredIds = new Set(Object.keys(configured).map((k) => k.trim().toLowerCase()));
  const ids = resolveCliBackendIds(cfg);
  const builtinSet = new Set<string>(BUILTIN_CLI_BACKEND_IDS);
  const out: CliBackendDescriptor[] = [];
  for (const id of [...ids].toSorted()) {
    const isBuiltin = builtinSet.has(id);
    const isConfigured = configuredIds.has(id);
    const resolved = resolveCliBackendConfig(id, cfg);
    out.push({
      id,
      source: isBuiltin ? (isConfigured ? "override" : "builtin") : "config",
      effective: resolved?.config ?? null,
      configured: isConfigured,
    });
  }
  return out;
}

/** Guided presets to seed the admin editor form. */
export interface CliBackendPreset {
  id: string;
  label: string;
  description: string;
  config: CliBackendConfig;
}

export const CLI_BACKEND_PRESETS: CliBackendPreset[] = [
  {
    id: "claude-cli",
    label: "Claude Code CLI",
    description: "Anthropic Claude Code，非交互 JSON 输出 + 会话续聊。",
    config: {
      command: "claude",
      args: ["-p", "--output-format", "json", "--permission-mode", "bypassPermissions"],
      output: "json",
      input: "arg",
      modelArg: "--model",
      sessionArg: "--session-id",
      sessionMode: "always",
      sessionIdFields: ["session_id", "conversation_id"],
      systemPromptArg: "--append-system-prompt",
      clearEnv: ["ANTHROPIC_API_KEY"],
      modelCatalog: [
        {
          id: "claude-sonnet",
          displayName: "Claude Sonnet (Claude Code)",
          capabilities: { streaming: true, tools: true },
        },
        {
          id: "claude-opus",
          displayName: "Claude Opus (Claude Code)",
          capabilities: { streaming: true, tools: true },
        },
      ],
    },
  },
  {
    id: "codex-cli",
    label: "OpenAI Codex CLI",
    description: "OpenAI Codex，exec --json (jsonl) + resume；支持 Development Supervisor Worker。",
    config: DEFAULT_CODEX_CLI_BACKEND,
  },
  {
    id: "trae-cli",
    label: "TraeCode CLI",
    description:
      "TraeCode CLI 2.0（traecli exec --json）；企业版旗舰套餐本机登录，默认 Node Agent 执行。支持 Development Supervisor Worker。",
    config: DEFAULT_TRAE_CLI_BACKEND,
  },
  {
    id: "kiro-cli",
    label: "Kiro CLI",
    description:
      "Kiro CLI 无头模式（chat --no-interactive）；默认经本机 kiro-cli login 在 Node Agent 执行。支持 Development Supervisor Worker。",
    config: DEFAULT_KIRO_CLI_BACKEND,
  },
  {
    id: "cursor-cli",
    label: "Cursor Agent CLI",
    description:
      "Cursor Agent 无头模式（--print + stream-json），支持 Development Supervisor Worker。",
    config: DEFAULT_CURSOR_CLI_BACKEND,
  },
  {
    id: "devin-cli",
    label: "Devin CLI (Devin Desktop)",
    description:
      "Devin CLI 无头模式（-p + sandbox dangerous）；可独立安装或由 Devin Desktop 捆绑。支持 Development Supervisor Worker。",
    config: DEFAULT_DEVIN_CLI_BACKEND,
  },
  {
    id: "grok-cli",
    label: "Grok Build CLI",
    description:
      "xAI Grok Build 无头模式（-p + streaming-json + always-approve）；默认经本机 grok login（SuperGrok 会员 OAuth）在 Node Agent 执行。支持 Development Supervisor Worker。",
    config: DEFAULT_GROK_CLI_BACKEND,
  },
];

/** Pure: return a new config with `id`'s CLI backend set to `config`. */
export function setCliBackendConfig(
  cfg: OpenBotConfig,
  id: string,
  config: CliBackendConfig,
): OpenBotConfig {
  return {
    ...cfg,
    agents: {
      ...cfg.agents,
      defaults: {
        ...cfg.agents?.defaults,
        cliBackends: { ...cfg.agents?.defaults?.cliBackends, [id]: config },
      },
    },
  };
}

/** Pure: return a new config with `id`'s CLI backend removed. */
export function removeCliBackendConfig(cfg: OpenBotConfig, id: string): OpenBotConfig {
  const current = { ...cfg.agents?.defaults?.cliBackends };
  delete current[id];
  return {
    ...cfg,
    agents: {
      ...cfg.agents,
      defaults: { ...cfg.agents?.defaults, cliBackends: current },
    },
  };
}

/** True when an explicit config entry exists for `id` (case-insensitive). */
export function hasConfiguredCliBackend(cfg: OpenBotConfig, id: string): boolean {
  const configured = cfg.agents?.defaults?.cliBackends ?? {};
  return Object.keys(configured).some((k) => k.trim().toLowerCase() === id);
}

/** A backend's exposed model catalog (empty when none declared). */
export function cliBackendModelCatalog(
  cfg: OpenBotConfig | undefined,
  id: string,
): CliBackendModelCatalogEntry[] {
  const resolved = resolveCliBackendConfig(id, cfg);
  return resolved?.config.modelCatalog ?? [];
}

/**
 * Enumerate `<backendId>/<modelId>` for every CLI backend's declared catalog.
 * This is the set the entitlement upper bound (`listConfiguredModelIds`) should
 * union in (Task 2, ME-stream); kept here as the single source of truth so the
 * upper-bound extension is a one-line reuse.
 */
export function listCliBackendCatalogModelRefs(cfg: OpenBotConfig | undefined): string[] {
  const configured = cfg?.agents?.defaults?.cliBackends ?? {};
  const refs: string[] = [];
  for (const [rawId, backend] of Object.entries(configured)) {
    const id = rawId.trim();
    for (const entry of backend?.modelCatalog ?? []) {
      const modelId = entry?.id?.trim();
      if (id && modelId) {
        refs.push(`${id}/${modelId}`);
      }
    }
  }
  return [...new Set(refs)];
}

/** Aggregated capability summary for a backend (union of its catalog entries). */
export interface CliBackendCapabilities {
  backendId: string;
  models: CliBackendModelCatalogEntry[];
  features: { streaming: boolean; tools: boolean; vision: boolean };
  /** Provenance: declared from config (probe-backed discovery lands in Task 11 runtime). */
  source: "declared" | "probe";
}

/**
 * Describe a backend's capabilities by aggregating its declared model catalog
 * (P0-2). A model feature is "supported" when ANY catalog entry declares it.
 * Runtime probing (source="probe") is layered on by the gateway handler.
 */
export function describeCliBackendCapabilities(
  cfg: OpenBotConfig | undefined,
  id: string,
): CliBackendCapabilities {
  const models = cliBackendModelCatalog(cfg, id);
  const features = { streaming: false, tools: false, vision: false };
  for (const m of models) {
    if (m.capabilities?.streaming) {
      features.streaming = true;
    }
    if (m.capabilities?.tools) {
      features.tools = true;
    }
    if (m.capabilities?.vision) {
      features.vision = true;
    }
  }
  return { backendId: id, models, features, source: "declared" };
}
