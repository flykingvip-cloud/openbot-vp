/**
 * mode-policy.ts — Tip B LaneMode capability mutex.
 *
 * Written table: MODE_POLICY.md (committed before this enforcement).
 * When mode is accept|review, hard-deny the Deny column; Allow column stays open.
 * implement = no new denies.
 * merge (Tip C) = deny raw gh/git merge argv & merge tools; allow only lane.requestMerge
 *   and channel "merge-port" (MergePort after dual-seal). Tip B left merge tools closed.
 * Feature off / no mode → zero behavior change.
 */

import { resolveCoreToolCapability, resolveCoreToolCatalogId } from "../../agents/tool-catalog.js";
import { normalizeToolName } from "../../agents/tool-policy-shared.js";
import { ToolAuthorizationError, type AnyAgentTool } from "../../agents/tools/common.js";
import type { LaneMode } from "./types.js";

/** Channels that may bypass agent-tool denies when explicitly allowlisted. */
export type LaneModeToolChannel =
  | "agent-tool"
  | "validator-port"
  | "lane-api"
  | "supervisor-read"
  | "merge-port";

export type LaneModeToolDecision =
  | { allowed: true; reason?: string }
  | { allowed: false; reason: string };

/** Deny-column agent tools (business file writes). Aliases normalized via tool-policy-shared. */
export const LANE_MODE_DENIED_WRITE_TOOLS: readonly string[] = [
  "write",
  "edit",
  "apply_patch",
] as const;

/**
 * Gateway / lane API names still allowed under accept|review.
 * Matches MODE_POLICY.md Allow column.
 */
export const LANE_MODE_ALLOWED_LANE_APIS: readonly string[] = [
  "lane.seal",
  "lane.focus",
  "lane.requestMerge",
] as const;

/**
 * supervisor.* get/list read surfaces allowed under accept|review.
 * Prefix match on method / tool name after lowercasing.
 */
export const LANE_MODE_ALLOWED_SUPERVISOR_READ_PREFIXES: readonly string[] = [
  "supervisor.task.get",
  "supervisor.task.list",
  "supervisor.get",
  "supervisor.list",
] as const;

/** Merge / push argv fingerprints (Deny column). Tip C: also denied in merge mode unless channel=merge-port. */
export const LANE_MODE_DENIED_MERGE_ARGV_PATTERNS: ReadonlyArray<ReadonlyArray<string>> = [
  ["git", "push"],
  ["git", "merge"],
  ["gh", "pr", "merge"],
] as const;

const MUTEX_MODES: ReadonlySet<LaneMode> = new Set(["accept", "review"]);

function normalizeArgvToken(token: string): string {
  return token.trim().toLowerCase();
}

/**
 * True when argv matches a denied merge/push fingerprint
 * (leading path components ignored for the binary name).
 */
export function argvMatchesDeniedMerge(argv: readonly string[] | undefined): boolean {
  if (!argv || argv.length === 0) {
    return false;
  }
  const tokens = argv.map(normalizeArgvToken).filter(Boolean);
  if (tokens.length === 0) {
    return false;
  }
  // Strip path from argv[0] so "/usr/bin/git" → "git"
  const firstBase = tokens[0].split(/[/\\]/).pop() ?? tokens[0];
  const normalized = [firstBase, ...tokens.slice(1)];
  for (const pattern of LANE_MODE_DENIED_MERGE_ARGV_PATTERNS) {
    if (normalized.length < pattern.length) {
      continue;
    }
    let match = true;
    for (let i = 0; i < pattern.length; i++) {
      if (normalized[i] !== pattern[i]) {
        match = false;
        break;
      }
    }
    if (match) {
      return true;
    }
  }
  return false;
}

function isDeniedWriteTool(toolName: string): boolean {
  const catalogId = resolveCoreToolCatalogId(normalizeToolName(toolName));
  return LANE_MODE_DENIED_WRITE_TOOLS.includes(catalogId);
}

function isExecLikeTool(toolName: string): boolean {
  const catalogId = resolveCoreToolCatalogId(normalizeToolName(toolName));
  return (
    catalogId === "exec" || catalogId === "bash" || catalogId === "shell" || catalogId === "process"
  );
}

function isSupervisorReadName(name: string): boolean {
  const n = name.trim().toLowerCase();
  return LANE_MODE_ALLOWED_SUPERVISOR_READ_PREFIXES.some(
    (prefix) => n === prefix || n.startsWith(`${prefix}.`) || n.startsWith(`${prefix}/`),
  );
}

function isLaneApiAllowed(name: string): boolean {
  const n = name.trim().toLowerCase();
  return LANE_MODE_ALLOWED_LANE_APIS.includes(n);
}

function isReadOnlyTool(toolName: string): boolean {
  const catalogId = resolveCoreToolCatalogId(normalizeToolName(toolName));
  const capability = resolveCoreToolCapability(catalogId);
  return capability?.toolMode === "read" && capability.sideEffectLevel === "none";
}

/**
 * Tip C merge-mode policy: close the Tip B loophole where mode=merge had no denies.
 * Raw git/gh merge via exec stays denied; lane.requestMerge + merge-port channel allowed.
 */
function evaluateMergeModeToolPolicy(input: {
  toolName: string;
  argv?: readonly string[];
  channel?: LaneModeToolChannel;
}): LaneModeToolDecision {
  const channel: LaneModeToolChannel = input.channel ?? "agent-tool";
  if (channel === "merge-port") {
    return { allowed: true, reason: "merge_port_channel" };
  }
  const toolName = input.toolName.trim();
  if (channel === "lane-api" || isLaneApiAllowed(toolName)) {
    if (isLaneApiAllowed(toolName)) {
      return { allowed: true, reason: "lane_api_allow" };
    }
  }
  if (isExecLikeTool(toolName) && argvMatchesDeniedMerge(input.argv)) {
    return {
      allowed: false,
      reason: "lane_mode_merge_denies_raw_merge_argv_use_lane_requestMerge",
    };
  }
  const normalized = normalizeToolName(toolName);
  if (
    normalized === "git_push" ||
    normalized === "git_merge" ||
    normalized === "gh_pr_merge" ||
    normalized === "pr_merge"
  ) {
    return {
      allowed: false,
      reason: `lane_mode_merge_denies_merge_tool:${normalized}`,
    };
  }
  return { allowed: true, reason: "mode_merge_non_merge_tool" };
}

/**
 * Evaluate a tool / API / exec invocation against Tip B LaneMode mutex.
 *
 * Callers that do not pass `deliveryLaneEnabled` are treated as "enabled context"
 * only when a mutex mode is supplied — feature-off paths should pass `false`.
 */
export function evaluateLaneModeToolPolicy(input: {
  mode: LaneMode | null | undefined;
  toolName: string;
  argv?: readonly string[];
  channel?: LaneModeToolChannel;
  /** When false → always allow (flag/lane disabled). Default true for unit tests of the mutex. */
  deliveryLaneEnabled?: boolean;
}): LaneModeToolDecision {
  if (input.deliveryLaneEnabled === false) {
    return { allowed: true, reason: "delivery_lane_disabled" };
  }
  const mode = input.mode;
  if (!mode) {
    return { allowed: true, reason: "no_lane_mode" };
  }
  // Tip C: merge mode — raw merge tools denied; only MergePort / lane.requestMerge.
  if (mode === "merge") {
    return evaluateMergeModeToolPolicy(input);
  }
  // implement: no new denies from Tip B.
  if (!MUTEX_MODES.has(mode)) {
    return { allowed: true, reason: `mode_${mode}_no_tip_b_denies` };
  }

  const channel: LaneModeToolChannel = input.channel ?? "agent-tool";
  const toolName = input.toolName.trim();

  // Allow column — validator AcceptanceStep via ValidatorPort / Fabric whitelist.
  if (channel === "validator-port") {
    return { allowed: true, reason: "validator_port_acceptance_step" };
  }

  if (channel === "lane-api" || isLaneApiAllowed(toolName)) {
    if (isLaneApiAllowed(toolName)) {
      return { allowed: true, reason: "lane_api_allow" };
    }
  }

  if (channel === "supervisor-read" || isSupervisorReadName(toolName)) {
    if (isSupervisorReadName(toolName) || channel === "supervisor-read") {
      // Channel supervisor-read alone is only for get/list style; still require name match when toolName set.
      if (channel === "supervisor-read" && !toolName) {
        return { allowed: true, reason: "supervisor_read_channel" };
      }
      if (isSupervisorReadName(toolName)) {
        return { allowed: true, reason: "supervisor_read_allow" };
      }
    }
  }

  if (isReadOnlyTool(toolName)) {
    return { allowed: true, reason: "readonly_tool" };
  }

  // Deny column — business file write tools.
  if (isDeniedWriteTool(toolName)) {
    return {
      allowed: false,
      reason: `lane_mode_${mode}_denies_write_tool:${normalizeToolName(toolName)}`,
    };
  }

  // Deny column — merge / push via exec-like tools.
  if (isExecLikeTool(toolName) && argvMatchesDeniedMerge(input.argv)) {
    return {
      allowed: false,
      reason: `lane_mode_${mode}_denies_merge_argv`,
    };
  }

  // Direct merge tool names (if ever registered as tools).
  const normalized = normalizeToolName(toolName);
  if (
    normalized === "git_push" ||
    normalized === "git_merge" ||
    normalized === "gh_pr_merge" ||
    normalized === "pr_merge"
  ) {
    return {
      allowed: false,
      reason: `lane_mode_${mode}_denies_merge_tool:${normalized}`,
    };
  }

  // Outside Deny column → not newly denied by Tip B.
  return { allowed: true, reason: "not_in_deny_column" };
}

/**
 * Build a deny-list ToolPolicyLike fragment for accept|review (pipeline hook).
 * Empty when mode is not a mutex mode.
 */
export function laneModeDenyToolPolicy(mode: LaneMode | null | undefined): {
  deny: string[];
} {
  if (!mode || !MUTEX_MODES.has(mode)) {
    return { deny: [] };
  }
  return { deny: [...LANE_MODE_DENIED_WRITE_TOOLS] };
}

export function isLaneModeMutexActive(mode: LaneMode | null | undefined): boolean {
  return Boolean(mode && MUTEX_MODES.has(mode));
}

/** Tip C: mode=merge applies raw-merge deny + MergePort allow. */
export function isLaneModeMergeGuardActive(mode: LaneMode | null | undefined): boolean {
  return mode === "merge";
}

function extractArgvFromToolParams(toolParams: unknown): string[] | undefined {
  if (!toolParams || typeof toolParams !== "object") {
    return undefined;
  }
  const p = toolParams as Record<string, unknown>;
  if (Array.isArray(p.argv)) {
    return p.argv.map((v) => String(v));
  }
  if (Array.isArray(p.args)) {
    return p.args.map((v) => String(v));
  }
  if (typeof p.command === "string") {
    return p.command.trim().split(/\s+/).filter(Boolean);
  }
  return undefined;
}

function wrapLaneModeToolExecution(
  tool: AnyAgentTool,
  params: {
    mode: LaneMode;
    deliveryLaneEnabled: boolean;
    channel: LaneModeToolChannel;
  },
): AnyAgentTool {
  if (!tool.execute) {
    return tool;
  }
  const execute = tool.execute.bind(tool);
  return {
    ...tool,
    execute: async (toolCallId, toolParams, signal, onUpdate) => {
      const decision = evaluateLaneModeToolPolicy({
        mode: params.mode,
        toolName: tool.name,
        argv: extractArgvFromToolParams(toolParams),
        channel: params.channel,
        deliveryLaneEnabled: params.deliveryLaneEnabled,
      });
      if (!decision.allowed) {
        throw new ToolAuthorizationError(`Tool execution denied (${decision.reason}).`);
      }
      return execute(toolCallId, toolParams, signal, onUpdate);
    },
  };
}

/**
 * Live tool-policy hook (Tip B): mirror inbound ceiling — wrap execute + drop
 * Deny-column write tools from the model-visible set when accept|review.
 * Flag off / non-mutex mode → identity (zero behavior change).
 */
export function applyLaneModeToolPolicy(params: {
  tools: AnyAgentTool[];
  mode?: LaneMode | null;
  deliveryLaneEnabled?: boolean;
  channel?: LaneModeToolChannel;
}): AnyAgentTool[] {
  const deliveryLaneEnabled = params.deliveryLaneEnabled !== false;
  if (!deliveryLaneEnabled || !params.mode) {
    return params.tools;
  }
  const mode = params.mode;
  const channel: LaneModeToolChannel = params.channel ?? "agent-tool";

  // Tip C: merge mode — wrap execute so raw merge argv is denied; do not drop write tools.
  if (mode === "merge") {
    return params.tools.map((tool) =>
      wrapLaneModeToolExecution(tool, { mode, deliveryLaneEnabled, channel }),
    );
  }

  if (!isLaneModeMutexActive(mode)) {
    return params.tools;
  }
  const wrapped = params.tools.map((tool) =>
    wrapLaneModeToolExecution(tool, { mode, deliveryLaneEnabled, channel }),
  );
  // Hide hard-denied write tools from the catalog (exec stays visible; argv checked at execute).
  return wrapped.filter((tool) => {
    const decision = evaluateLaneModeToolPolicy({
      mode,
      toolName: tool.name,
      deliveryLaneEnabled,
      channel,
    });
    if (decision.allowed) {
      return true;
    }
    // Keep exec-like tools so merge argv can still be checked at execute time.
    const catalogId = resolveCoreToolCatalogId(normalizeToolName(tool.name));
    return (
      catalogId === "exec" ||
      catalogId === "bash" ||
      catalogId === "shell" ||
      catalogId === "process"
    );
  });
}
