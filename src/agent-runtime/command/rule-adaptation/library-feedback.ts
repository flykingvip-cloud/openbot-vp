/**
 * Session-scoped rule-library overlay for the platform rule agent.
 *
 * The static catalog stays read-only. Production activation
 * (`PRODUCTION_RUNTIME_RULE_WHITELIST`) stays empty. The P2 shadow candidate
 * tool still refuses to persist. This writer is a different, narrower grant:
 * only the admitted-turn rule agent, and only while
 * `agents.defaults.contextWindowRuleDecision.mode` is `dynamic`, may record a
 * scene adjustment for `model.context_window.guard`.
 *
 * The adjustment is shrink-only and cannot go below the context-window hard
 * minimum. Employee advice and collaboration do not receive this grant.
 * A later dynamic decision in the same session reads the file and uses it.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { SESSION_TASK_BOARD_LOCK_OPTIONS, withFileLockSync } from "../../../infra/file-lock.js";
import { CONTEXT_WINDOW_HARD_MIN_TOKENS } from "../../policy/context-window.js";

export const RULE_LIBRARY_SCHEMA = "rule-library/v1" as const;
export const RULE_LIBRARY_RULE_ID = "model.context_window.guard" as const;
export const RULE_LIBRARY_FIELD = "agents.defaults.contextTokens" as const;
export const RULE_LIBRARY_CALLER = "rule-agent" as const;

/** Three quarters of the current window, then clamped. Not a catalog edit. */
const GAP_FILL_NUMERATOR = 3;
const GAP_FILL_DENOMINATOR = 4;
const CONTEXT_PRESSURE_CHARS = 8_000;

export const RULE_LIBRARY_PROBLEMS = ["gap", "conflict", "hole", "inapplicable"] as const;
export type RuleLibraryProblem = (typeof RULE_LIBRARY_PROBLEMS)[number];

export const RULE_SCENE_CLASSES = ["context_pressure", "ordinary_task"] as const;
export type RuleSceneClass = (typeof RULE_SCENE_CLASSES)[number];

export type RuleLibraryDisposition = "use_parameter" | "keep_resolved";

export type RuleLibraryEntry = {
  ruleId: typeof RULE_LIBRARY_RULE_ID;
  field: typeof RULE_LIBRARY_FIELD;
  sceneClass: RuleSceneClass;
  problem: RuleLibraryProblem;
  disposition: RuleLibraryDisposition;
  parameter?: number;
  sourceVersion: string;
  revision: number;
};

export type RuleLibraryDocument = {
  schema: typeof RULE_LIBRARY_SCHEMA;
  scope: { type: "personal"; sessionFile: string };
  revision: number;
  entries: RuleLibraryEntry[];
};

export type RuleLibraryWritePermission = {
  /** Only the admitted-turn rule agent may write. Employee advice cannot. */
  caller: string;
  mode: "legacy" | "dynamic";
  authorized: boolean;
  bindingCurrent: boolean;
  cancelled: boolean;
  /** Collaboration consumers are not wired; this grant does not open them. */
  collaboration: boolean;
};

export type RuleLibraryCycleInput = {
  permission: RuleLibraryWritePermission;
  sessionFile: string;
  message: string;
  currentTokens: number;
  ruleVersion: string;
  /**
   * In-bounds tune from the same turn's shadow proposal.
   * Used only to fill a gap. Ignored when the library already covers the scene.
   */
  shadowProposedTokens?: number;
};

export type RuleLibraryCycleResult =
  | {
      applied: true;
      wrote: boolean;
      reason: "library_decision";
      problem: RuleLibraryProblem | null;
      sceneClass: RuleSceneClass;
      disposition: RuleLibraryDisposition;
      effectiveTokens: number;
      revision: number;
      ruleId: typeof RULE_LIBRARY_RULE_ID;
    }
  | { applied: false; wrote: false; reason: string };

const PRESSURE_PATTERN =
  /上下文太大|上下文过长|上下文太长|上下文窗口不够|context window|context too (?:large|long|big)|token limit/i;

export function ruleLibraryPath(sessionFile: string): string {
  return `${sessionFile}.rule-library.json`;
}

export function classifyRuleScene(message: string): RuleSceneClass {
  const text = message.trim();
  if (text.length >= CONTEXT_PRESSURE_CHARS || PRESSURE_PATTERN.test(text)) {
    return "context_pressure";
  }
  return "ordinary_task";
}

export function loadRuleLibrary(sessionFile: string): RuleLibraryDocument {
  return readLibrary(sessionFile);
}

function emptyLibrary(sessionFile: string): RuleLibraryDocument {
  return {
    schema: RULE_LIBRARY_SCHEMA,
    scope: { type: "personal", sessionFile },
    revision: 0,
    entries: [],
  };
}

function isScene(value: unknown): value is RuleSceneClass {
  return value === "context_pressure" || value === "ordinary_task";
}

function isProblem(value: unknown): value is RuleLibraryProblem {
  return value === "gap" || value === "conflict" || value === "hole" || value === "inapplicable";
}

function parseEntry(value: unknown): RuleLibraryEntry | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const item = value as Record<string, unknown>;
  if (item.ruleId !== RULE_LIBRARY_RULE_ID || item.field !== RULE_LIBRARY_FIELD) {
    return undefined;
  }
  if (!isScene(item.sceneClass) || !isProblem(item.problem)) {
    return undefined;
  }
  if (item.disposition !== "use_parameter" && item.disposition !== "keep_resolved") {
    return undefined;
  }
  if (typeof item.sourceVersion !== "string" || item.sourceVersion.length === 0) {
    return undefined;
  }
  if (!Number.isSafeInteger(item.revision) || item.revision < 1) {
    return undefined;
  }
  if (item.disposition === "use_parameter") {
    if (!Number.isSafeInteger(item.parameter)) {
      return undefined;
    }
    return {
      ruleId: RULE_LIBRARY_RULE_ID,
      field: RULE_LIBRARY_FIELD,
      sceneClass: item.sceneClass,
      problem: item.problem,
      disposition: "use_parameter",
      parameter: item.parameter,
      sourceVersion: item.sourceVersion,
      revision: item.revision,
    };
  }
  return {
    ruleId: RULE_LIBRARY_RULE_ID,
    field: RULE_LIBRARY_FIELD,
    sceneClass: item.sceneClass,
    problem: item.problem,
    disposition: "keep_resolved",
    sourceVersion: item.sourceVersion,
    revision: item.revision,
  };
}

function readLibrary(sessionFile: string): RuleLibraryDocument {
  const file = sessionFile.trim();
  if (!file) {
    return emptyLibrary(sessionFile);
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(ruleLibraryPath(file), "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return emptyLibrary(file);
    }
    const record = parsed as Record<string, unknown>;
    const scope = record.scope;
    if (
      record.schema !== RULE_LIBRARY_SCHEMA ||
      !scope ||
      typeof scope !== "object" ||
      Array.isArray(scope) ||
      (scope as { type?: unknown }).type !== "personal" ||
      (scope as { sessionFile?: unknown }).sessionFile !== file
    ) {
      return emptyLibrary(file);
    }
    const entries = Array.isArray(record.entries)
      ? record.entries.flatMap((entry) => {
          const parsedEntry = parseEntry(entry);
          return parsedEntry ? [parsedEntry] : [];
        })
      : [];
    const revision =
      Number.isSafeInteger(record.revision) && (record.revision as number) >= 0
        ? (record.revision as number)
        : 0;
    return {
      schema: RULE_LIBRARY_SCHEMA,
      scope: { type: "personal", sessionFile: file },
      revision,
      entries,
    };
  } catch {
    return emptyLibrary(file);
  }
}

function writeLibrary(sessionFile: string, document: RuleLibraryDocument): void {
  const target = ruleLibraryPath(sessionFile);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(document)}\n`, "utf8");
  fs.renameSync(tmp, target);
}

function denyReason(
  permission: RuleLibraryWritePermission,
  sessionFile: string,
): string | undefined {
  if (permission.caller !== RULE_LIBRARY_CALLER) {
    return "caller_not_rule_agent";
  }
  if (permission.mode !== "dynamic") {
    return "legacy_mode";
  }
  if (!permission.authorized) {
    return "host_unauthorized";
  }
  if (permission.cancelled || !permission.bindingCurrent) {
    return "stale_or_cancelled";
  }
  if (permission.collaboration) {
    return "collaboration_unwired";
  }
  if (!sessionFile.trim()) {
    return "missing_session";
  }
  return undefined;
}

export function gapFillParameter(current: number, shadow?: number): number {
  if (
    typeof shadow === "number" &&
    Number.isSafeInteger(shadow) &&
    shadow >= CONTEXT_WINDOW_HARD_MIN_TOKENS &&
    shadow <= current
  ) {
    return shadow;
  }
  if (current <= CONTEXT_WINDOW_HARD_MIN_TOKENS) {
    return current;
  }
  const stepped = Math.floor((current * GAP_FILL_NUMERATOR) / GAP_FILL_DENOMINATOR);
  return Math.min(current, Math.max(CONTEXT_WINDOW_HARD_MIN_TOKENS, stepped));
}

function parameterInBounds(parameter: number | undefined, current: number): parameter is number {
  return (
    typeof parameter === "number" &&
    Number.isSafeInteger(parameter) &&
    parameter >= CONTEXT_WINDOW_HARD_MIN_TOKENS &&
    parameter <= current
  );
}

function clampParameter(parameter: number, current: number): number {
  if (current < CONTEXT_WINDOW_HARD_MIN_TOKENS) {
    return current;
  }
  if (!Number.isSafeInteger(parameter)) {
    return gapFillParameter(current);
  }
  return Math.min(current, Math.max(CONTEXT_WINDOW_HARD_MIN_TOKENS, parameter));
}

type SceneJudgment = {
  write: boolean;
  problem: RuleLibraryProblem | null;
  disposition: RuleLibraryDisposition;
  effectiveTokens: number;
  parameter?: number;
};

function judgeScene(
  entries: readonly RuleLibraryEntry[],
  scene: RuleSceneClass,
  current: number,
  shadow: number | undefined,
): SceneJudgment {
  const mine = entries.filter((entry) => entry.sceneClass === scene);
  const parameters = mine.filter((entry) => entry.disposition === "use_parameter");
  const skips = mine.filter((entry) => entry.disposition === "keep_resolved");
  if (parameters.length > 1 || (parameters.length === 1 && skips.length > 0)) {
    const legal = parameters
      .map((entry) => entry.parameter)
      .filter((parameter): parameter is number => parameterInBounds(parameter, current));
    const chosen = legal.length > 0 ? Math.min(...legal) : gapFillParameter(current, shadow);
    return {
      write: true,
      problem: "conflict",
      disposition: "use_parameter",
      effectiveTokens: chosen,
      parameter: chosen,
    };
  }
  if (parameters.length === 1) {
    const parameter = parameters[0]?.parameter;
    if (!parameterInBounds(parameter, current)) {
      const chosen = clampParameter(parameter ?? Number.NaN, current);
      if (chosen < CONTEXT_WINDOW_HARD_MIN_TOKENS || chosen > current) {
        return {
          write: true,
          problem: "hole",
          disposition: "keep_resolved",
          effectiveTokens: current,
        };
      }
      return {
        write: true,
        problem: "hole",
        disposition: "use_parameter",
        effectiveTokens: chosen,
        parameter: chosen,
      };
    }
    return {
      write: false,
      problem: null,
      disposition: "use_parameter",
      effectiveTokens: parameter,
      parameter,
    };
  }
  if (skips.length > 0) {
    return {
      write: false,
      problem: null,
      disposition: "keep_resolved",
      effectiveTokens: current,
    };
  }
  if (scene === "context_pressure") {
    const chosen = gapFillParameter(current, shadow);
    if (!parameterInBounds(chosen, current)) {
      return {
        write: true,
        problem: "gap",
        disposition: "keep_resolved",
        effectiveTokens: current,
      };
    }
    return {
      write: true,
      problem: "gap",
      disposition: "use_parameter",
      effectiveTokens: chosen,
      parameter: chosen,
    };
  }
  return {
    write: true,
    problem: "inapplicable",
    disposition: "keep_resolved",
    effectiveTokens: current,
  };
}

function withEntry(
  document: RuleLibraryDocument,
  scene: RuleSceneClass,
  judgment: SceneJudgment,
  ruleVersion: string,
): RuleLibraryDocument {
  const revision = document.revision + 1;
  const kept = document.entries.filter((entry) => entry.sceneClass !== scene);
  const entry: RuleLibraryEntry = {
    ruleId: RULE_LIBRARY_RULE_ID,
    field: RULE_LIBRARY_FIELD,
    sceneClass: scene,
    problem: judgment.problem ?? "gap",
    disposition: judgment.disposition,
    ...(judgment.parameter !== undefined ? { parameter: judgment.parameter } : {}),
    sourceVersion: ruleVersion || "inventory:unknown",
    revision,
  };
  return { ...document, revision, entries: [...kept, entry] };
}

function appliedResult(
  judgment: SceneJudgment,
  wrote: boolean,
  scene: RuleSceneClass,
  revision: number,
): RuleLibraryCycleResult {
  return {
    applied: true,
    wrote,
    reason: "library_decision",
    problem: wrote ? judgment.problem : null,
    sceneClass: scene,
    disposition: judgment.disposition,
    effectiveTokens: judgment.effectiveTokens,
    revision,
    ruleId: RULE_LIBRARY_RULE_ID,
  };
}

export function runRuleAgentLibraryCycle(input: RuleLibraryCycleInput): RuleLibraryCycleResult {
  const denied = denyReason(input.permission, input.sessionFile);
  if (denied) {
    return { applied: false, wrote: false, reason: denied };
  }
  if (!Number.isSafeInteger(input.currentTokens) || input.currentTokens <= 0) {
    return { applied: false, wrote: false, reason: "invalid_current_tokens" };
  }
  const sessionFile = input.sessionFile.trim();
  try {
    return withFileLockSync(ruleLibraryPath(sessionFile), SESSION_TASK_BOARD_LOCK_OPTIONS, () => {
      const library = readLibrary(sessionFile);
      const scene = classifyRuleScene(input.message);
      const judgment = judgeScene(
        library.entries,
        scene,
        input.currentTokens,
        input.shadowProposedTokens,
      );
      if (!judgment.write) {
        return appliedResult(judgment, false, scene, library.revision);
      }
      const sourceVersion = input.ruleVersion.trim() || "inventory:unknown";
      const next = withEntry(library, scene, judgment, sourceVersion);
      writeLibrary(sessionFile, next);
      return appliedResult(judgment, true, scene, next.revision);
    });
  } catch {
    return { applied: false, wrote: false, reason: "library_unavailable" };
  }
}
