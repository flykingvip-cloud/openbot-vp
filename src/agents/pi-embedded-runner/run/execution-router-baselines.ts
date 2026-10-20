/**
 * Phase 0 Skill/Tool baseline measures for the embedded attempt.
 *
 * Counts only. Never stores Skill bodies, Tool parameters, user text, tokens,
 * or credentials. Callers must gate on OPENBOT_EXECUTION_ROUTER_OBSERVATION
 * so disabled runs do not build extra schema or observer state.
 */
import {
  observeShadowSkillCatalogBestEffort,
  observeShadowToolCatalogBestEffort,
  type SkillBaseline,
  type ToolBaseline,
} from "../../../../packages/toolkit/src/execution-router/index.js";
import type { OpenBotConfig } from "../../../config/config.js";
import {
  isExecutionRouterObservationEnabled,
  observeExecutionStage,
  observeSkillBaseline,
  observeToolBaseline,
} from "../../../gateway/execution-router-observation.js";
import {
  countAlwaysSkillsInPrompt,
  emitExecutionDisciplineObservation,
  isExecutionDisciplineObservationEnabled,
} from "../../execution-preflight/observability.js";
import { filterWorkspaceSkillEntries, type SkillEntry, type SkillSnapshot } from "../../skills.js";

/**
 * Official product Skill-block parser (same algorithm as
 * `parseSkillBlocks` in `src/agents/system-prompt-report.ts`).
 *
 * injectedCount is the number of complete `<skill>` blocks that actually
 * entered the already-built `skillsPrompt`. Char truncation drops whole
 * skills before formatting, so the remaining block count is the injected
 * set — not eligibleCount and not a char/avg guess.
 */
export function countInjectedSkillsFromPrompt(skillsPrompt: string): number {
  const prompt = skillsPrompt.trim();
  if (!prompt) {
    return 0;
  }
  const blocks = Array.from(prompt.matchAll(/<skill>[\s\S]*?<\/skill>/gi));
  return blocks.filter((match) => (match[0] ?? "").length > 0).length;
}

/**
 * eligibleCount after eligibility / agent filter / blocklist / lifecycle.
 *
 * Snapshot-prompt path: use the snapshot's already-filtered `skills`.
 * Live-entry path: reuse `filterWorkspaceSkillEntries` on the already-loaded
 * policy+lifecycle entries. Does not rescan Skill directories or rebuild
 * `skillsPrompt`.
 */
export function resolveEligibleSkillCount(params: {
  usedSnapshotPrompt: boolean;
  snapshot?: SkillSnapshot;
  liveEntries: SkillEntry[];
  config?: OpenBotConfig;
}): number {
  if (params.usedSnapshotPrompt) {
    return Math.max(0, params.snapshot?.skills.length ?? 0);
  }
  return filterWorkspaceSkillEntries(params.liveEntries, params.config).length;
}

export function usedSkillsSnapshotPrompt(params: {
  preferLiveEntries?: boolean;
  snapshot?: SkillSnapshot;
}): boolean {
  return !params.preferLiveEntries && Boolean(params.snapshot?.prompt?.trim());
}

export function measureSkillBaseline(params: {
  skillsPrompt: string;
  eligibleCount: number;
}): SkillBaseline {
  const promptChars = params.skillsPrompt.length;
  const injectedCount = countInjectedSkillsFromPrompt(params.skillsPrompt);
  const eligibleCount = Math.max(0, params.eligibleCount);
  return {
    eligibleCount,
    injectedCount: Math.max(0, injectedCount),
    promptChars: Math.max(0, promptChars),
  };
}

/**
 * Client tools are a separate statistical domain from `constructedCount`.
 * `createOpenClawCodingTools` builds server tools only. Client/hosted tools
 * enter exposedCount/schemaChars only after `applyEmbeddedCustomToolPolicy`.
 *
 * afterPolicyCount is `toolsRaw.length`: server tools after inbound ceiling
 * and the embedded skill-policy pass inside `resolveEmbeddedAttemptToolsRaw`.
 * That count is taken before provider sanitize (`sanitizeToolsForGoogle`) and
 * before client tools join the final custom-tool allowlist.
 */
export type ToolBaselineInput = {
  constructedCount: number;
  afterPolicyCount: number;
  /** Final `tools` allowlist passed to `createAgentSession`. */
  exposedAllowlist: readonly string[];
  /** Final `customTools` after `applyEmbeddedCustomToolPolicy`. */
  filteredCustomTools: ReadonlyArray<{ name?: string; parameters?: unknown }>;
};

export type NamedToolSchema = {
  name?: string;
  parameters?: unknown;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Deterministic JSON: sorted keys, no functions, no call args / credentials. */
export function stableSchemaStringify(value: unknown, seen = new WeakSet<object>()): string {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "function" || typeof value === "undefined") {
    return "null";
  }
  if (typeof value === "object") {
    if (seen.has(value)) {
      return "null";
    }
    seen.add(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSchemaStringify(item, seen)).join(",")}]`;
  }
  if (!isPlainObject(value)) {
    return "null";
  }
  const keys = Object.keys(value)
    .filter((key) => typeof value[key] !== "function" && value[key] !== undefined)
    .toSorted();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableSchemaStringify(value[key], seen)}`)
    .join(",")}}`;
}

type NamedSchema = {
  name: string;
  parameters: unknown;
};

function collectFilteredToolSchemas(params: {
  exposedAllowlist: readonly string[];
  filteredCustomTools: ReadonlyArray<NamedToolSchema>;
}): NamedSchema[] {
  const allowed = new Set(
    params.exposedAllowlist.map((name) => name.trim()).filter((name) => name.length > 0),
  );
  const byName = new Map<string, NamedSchema>();
  for (const tool of params.filteredCustomTools) {
    const name = tool.name?.trim();
    if (!name || !allowed.has(name) || byName.has(name)) {
      continue;
    }
    byName.set(name, { name, parameters: tool.parameters ?? null });
  }
  return params.exposedAllowlist
    .map((name) => byName.get(name.trim()))
    .filter((schema): schema is NamedSchema => Boolean(schema));
}

export function measureExposedToolSchemaChars(params: {
  exposedAllowlist: readonly string[];
  filteredCustomTools: ReadonlyArray<NamedToolSchema>;
}): number {
  try {
    return stableSchemaStringify(collectFilteredToolSchemas(params)).length;
  } catch {
    return 0;
  }
}

export function measureToolBaseline(params: ToolBaselineInput): ToolBaseline {
  const constructedCount = Math.max(0, params.constructedCount);
  const afterPolicyCount = Math.max(0, params.afterPolicyCount);
  const exposedCount = params.exposedAllowlist.length;
  return {
    constructedCount,
    afterPolicyCount,
    exposedCount: Math.max(0, exposedCount),
    schemaChars: measureExposedToolSchemaChars({
      exposedAllowlist: params.exposedAllowlist,
      filteredCustomTools: params.filteredCustomTools,
    }),
  };
}

/** Disabled runs keep the original createTools reference and array identity. */
export function wrapCreateToolsForObservation<T>(createTools: () => T[]): {
  createTools: () => T[];
  readConstructedCount: () => number;
} {
  if (!isExecutionRouterObservationEnabled()) {
    return { createTools, readConstructedCount: () => 0 };
  }
  let constructedCount = 0;
  return {
    createTools: () => {
      const constructed = createTools();
      constructedCount = constructed.length;
      return constructed;
    },
    readConstructedCount: () => constructedCount,
  };
}

export function observeAttemptSkillPreparation(params: {
  runId: string;
  sessionKey?: string;
  skillsPrompt: string;
  preferLiveEntries?: boolean;
  snapshot?: SkillSnapshot;
  liveEntries: SkillEntry[];
  config?: OpenBotConfig;
}): void {
  observeShadowSkillCatalogBestEffort({
    runId: params.runId,
    sessionKey: params.sessionKey,
    readSkillNames: () =>
      usedSkillsSnapshotPrompt(params)
        ? (params.snapshot?.skills.map((row) => row.name) ?? [])
        : params.liveEntries.map((entry) => entry.skill.name),
  });
  if (!isExecutionRouterObservationEnabled()) {
    return;
  }
  try {
    const eligibleCount = resolveEligibleSkillCount({
      usedSnapshotPrompt: usedSkillsSnapshotPrompt(params),
      snapshot: params.snapshot,
      liveEntries: params.liveEntries,
      config: params.config,
    });
    observeSkillBaseline({
      runId: params.runId,
      sessionKey: params.sessionKey,
      baseline: measureSkillBaseline({
        skillsPrompt: params.skillsPrompt,
        eligibleCount,
      }),
    });
    observeExecutionStage({
      runId: params.runId,
      sessionKey: params.sessionKey,
      stage: "skill_snapshot_ready",
    });
  } catch {
    // Observation must never enter the attempt path.
  }
  if (!isExecutionDisciplineObservationEnabled()) {
    return;
  }
  try {
    // Snapshot rows omit `always`; live entries carry it on metadata.
    const alwaysNames = (
      usedSkillsSnapshotPrompt(params)
        ? []
        : params.liveEntries
            .filter((entry) => Boolean(entry.metadata?.always))
            .map((entry) => entry.skill.name)
    ).filter((name): name is string => Boolean(name?.trim()));
    emitExecutionDisciplineObservation({
      runId: params.runId,
      sessionKey: params.sessionKey,
      metrics: {
        skillsPromptChars: params.skillsPrompt.length,
        alwaysSkillReadCount: countAlwaysSkillsInPrompt(params.skillsPrompt, alwaysNames),
      },
    });
  } catch {
    // Discipline observation must never enter the attempt path.
  }
}

export function observeAttemptToolPreparation(params: {
  runId: string;
  sessionKey?: string;
  constructedCount: number;
  afterPolicyCount: number;
  exposedAllowlist: readonly string[];
  filteredCustomTools: ReadonlyArray<NamedToolSchema>;
}): void {
  observeShadowToolCatalogBestEffort({
    runId: params.runId,
    sessionKey: params.sessionKey,
    readToolNames: () => params.exposedAllowlist,
  });
  if (!isExecutionRouterObservationEnabled()) {
    return;
  }
  try {
    observeToolBaseline({
      runId: params.runId,
      sessionKey: params.sessionKey,
      baseline: measureToolBaseline({
        constructedCount: params.constructedCount,
        afterPolicyCount: params.afterPolicyCount,
        exposedAllowlist: params.exposedAllowlist,
        filteredCustomTools: params.filteredCustomTools,
      }),
    });
    observeExecutionStage({
      runId: params.runId,
      sessionKey: params.sessionKey,
      stage: "tool_set_ready",
    });
  } catch {
    // Observation must never enter createAgentSession or the prompt path.
  }
}

export function observeAttemptSystemPromptReady(params: {
  runId: string;
  sessionKey?: string;
}): void {
  if (!isExecutionRouterObservationEnabled()) {
    return;
  }
  try {
    observeExecutionStage({
      runId: params.runId,
      sessionKey: params.sessionKey,
      stage: "system_prompt_ready",
    });
  } catch {
    // Observation must never enter createAgentSession or the prompt path.
  }
}
