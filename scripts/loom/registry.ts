/**
 * registry.ts — Loom single source of truth: schema, types, load/save.
 *
 * The Registry is the ONE authoritative source for task ownership and landing
 * rules (Requirement 1). Attribution, audit, derive, learn all read from here;
 * the legacy `## Agents` blocks and the hardcoded `worktree-audit.ts` rules are
 * demoted to derived views / one-time import sources.
 *
 * Design: `.kiro/specs/loom-workspace-orchestrator/design.md` (Data Models,
 * §3.1 Registry, Schema Evolution).
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";

export const REGISTRY_FILE = ".loom/registry.yaml";

/** Latest schema version this build understands. Bump + add an upgrader below. */
export const LATEST_VERSION = 1 as const;

// ─────────────────────────────────────────────────────────────────────────────
// Schema (see design Data Models)
// ─────────────────────────────────────────────────────────────────────────────

/** Generic, repo-agnostic landing strategy (replaces OpenBot MERGE/ISOLATE/CLEAN). */
export const LandingPolicy = z.enum(["parallel", "serial", "exclusive", "manual"]);
export type LandingPolicy = z.infer<typeof LandingPolicy>;

/** Task lifecycle state machine (R10). */
export const TaskState = z.enum([
  "claimed",
  "active",
  "paused",
  "blocked",
  "ready",
  "landed",
  "abandoned",
]);
export type TaskState = z.infer<typeof TaskState>;

/** Session liveness. `dead` = no signal (window gone); `error` = execution failed. */
export const SessionStatus = z.enum(["active", "idle", "done", "dead", "error"]);
export type SessionStatus = z.infer<typeof SessionStatus>;

/**
 * Reserved Fabric signal namespace. Fabric Stage-2 reads `metadata.fabric` only,
 * never arbitrary keys — so Fabric never has to parse free-form metadata.
 */
const FabricMetadata = z.object({ signalVersion: z.number() }).passthrough();

/**
 * Categorized metadata (review P0): each surface declares its known keys and
 * `.passthrough()` keeps forward-compat without letting `metadata` drift into a
 * "second database". New structured fields should be promoted to real columns,
 * not stuffed here ad hoc.
 */
const TaskMetadata = z
  .object({
    spec: z.string().optional(),
    role: z.string().optional(),
    fabric: FabricMetadata.optional(),
  })
  .passthrough();

const SessionMetadata = z
  .object({
    worktree: z.string().optional(),
    branch: z.string().optional(),
    provisionId: z.string().optional(),
    events: z.array(z.unknown()).optional(),
    fabric: FabricMetadata.optional(),
  })
  .passthrough();

const LandingMetadata = z
  .object({
    legacyRuleId: z.string().optional(),
    legacyTitle: z.string().optional(),
    fabric: FabricMetadata.optional(),
  })
  .passthrough();

export const SessionSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  ide: z.string().min(1), // cursor | kiro | codex | windsurf | claude-code | …
  agent: z.string().min(1),
  status: SessionStatus.default("active"),
  worktree: z.string().optional(), // empty allowed this phase (Provisioning is later)
  lastSignalAt: z.string().optional(), // ISO; refreshed by any successful Loom write
  metadata: SessionMetadata.default({}),
});
export type Session = z.infer<typeof SessionSchema>;

/**
 * Records a complete ownership transfer (takeover) for accountability (追责):
 * `fromOwner` → `toOwner`, when, and how it was authorized (verify-then-take,
 * system-prompted confirm, or the initial assignment). The full chain is
 * reconstructable from the ordered list plus the task's current `owner`.
 */
export const OwnerHistoryEntrySchema = z.object({
  fromOwner: z.string().min(1),
  toOwner: z.string().min(1),
  at: z.string(), // ISO timestamp of the transfer
  via: z.enum(["verified", "confirmed", "initial"]).default("confirmed"),
});
export type OwnerHistoryEntry = z.infer<typeof OwnerHistoryEntrySchema>;

export const TaskSchema = z.object({
  id: z.string().min(1),
  owner: z.string().min(1), // stable, human-distinguishable, e.g. kiro-loom
  /**
   * GitHub issue this task implements. The JOIN KEY for intent → code → release:
   * without it a landed commit cannot answer "why was this changed". A real column
   * on purpose — `TaskMetadata` is explicitly not a place for structured fields.
   * Optional for backward compatibility; `loom lint` reports active tasks that
   * lack it (`active-task-no-issue`), which is how coverage is driven to 100%.
   * See `.kiro/specs/engineering-governance/` R2.2.
   */
  issue: z.number().int().positive().optional(),
  intent: z.array(z.string()).default([]), // SOFT signal: display/search/stats only (R9)
  paths: z.array(z.string()).default([]), // HARD signal: attribution basis (exclusive ownership)
  state: TaskState.default("active"),
  sessions: z.array(SessionSchema).default([]),
  ownerHistory: z.array(OwnerHistoryEntrySchema).default([]), // full transfer trail (追责)
  since: z.string().optional(),
  metadata: TaskMetadata.default({}),
});
export type Task = z.infer<typeof TaskSchema>;

/**
 * A landing stream: the AUDIT partition (Option A). Streams may overlap on
 * shared files and are resolved by first-match (like the legacy audit groups),
 * which is why they are SEPARATE from ownership `tasks` (where >1 match = a real
 * CONFLICT). `paths` here is the HARD signal for landing classification.
 */
export const LandingStreamSchema = z.object({
  id: z.string().min(1),
  landingPolicy: LandingPolicy.default("serial"),
  paths: z.array(z.string()).default([]),
  canLandWith: z.array(z.string()).default([]), // other stream ids; bidirectional intersection
  metadata: LandingMetadata.default({}),
});
export type LandingStream = z.infer<typeof LandingStreamSchema>;

/**
 * A path deliberately shared by several ownership tasks, with ONE designated
 * lander (R11 / spec task P2.1).
 *
 * Why this exists: `tasks` is an exclusive partition, so >1 match is reported as
 * a CONFLICT — correct for accidental overlap, wrong for files that are shared by
 * design (`AGENTS.md`, `package.json`, i18n locales, registration hubs). Those
 * files produce permanent CONFLICT noise that never resolves, which trains
 * everyone to ignore the signal. Registering a path here says "several tasks
 * legitimately touch this; `landerTask` is who lands it", turning an unresolvable
 * CONFLICT into an actionable SHARED verdict.
 *
 * It does NOT grant permission to overwrite other agents' work: AGENTS.md rule 2
 * still applies, and the lander is exactly the agent that rule points to.
 *
 * Registration is a HUMAN decision (spec task P2.5) — never inferred from
 * observed edit frequency, because "many agents touched it" is precisely the
 * symptom that needs a judgement call, not evidence of one.
 */
export const SharedPathSchema = z.object({
  /** Path glob, same semantics as `task.paths` (see `glob.ts`). */
  glob: z.string().min(1),
  /**
   * The ownership task whose CURRENT owner lands this path.
   *
   * Deliberately a task reference rather than an agent id. Agent ids expire on
   * takeover — `loom-workspace-orchestrator:kiro-loom` changed hands the same day
   * it was first considered as a lander, so a registration naming `kiro-loom`
   * would have been stale within hours. Task ids are stable: the id keeps its
   * original agent segment while `owner` moves, so resolving through the task
   * always yields whoever is accountable now.
   */
  landerTask: z.string().min(1),
  /** Why the path is shared. Free text, for the report and for review. */
  reason: z.string().optional(),
  /**
   * ISO date after which the registration should be re-examined.
   *
   * A REMINDER, not an expiry. An auto-expiring registration would silently
   * revert the path to permanent CONFLICT with no one noticing, which is the
   * state this field exists to end.
   */
  reviewAfter: z.string().optional(),
});
export type SharedPath = z.infer<typeof SharedPathSchema>;

export const RegistrySchema = z.object({
  version: z.literal(LATEST_VERSION),
  /** Ownership partition (attribution + lifecycle). Exclusive: >1 match = CONFLICT. */
  tasks: z.array(TaskSchema),
  /** Audit partition (landing). Overlap-OK, first-match. */
  landingStreams: z.array(LandingStreamSchema).default([]),
  /**
   * Deliberately shared paths with a designated lander. First declared match
   * wins (same convention as `landingStreams`).
   *
   * Defaults to `[]`, which makes behavior byte-identical to a registry without
   * the field — that empty default is the parity baseline.
   */
  sharedPaths: z.array(SharedPathSchema).default([]),
});
export type Registry = z.infer<typeof RegistrySchema>;

/**
 * Resolve who lands a shared path right now, by reading the referenced task's
 * current owner. Returns `undefined` when the reference dangles, which
 * `loom lint` reports as an error rather than papering over.
 */
export function resolveLander(registry: Registry, shared: SharedPath): string | undefined {
  const task = registry.tasks.find((candidate) => candidate.id === shared.landerTask);
  return task?.owner;
}

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

export class RegistryNotFoundError extends Error {
  constructor(public readonly path: string) {
    super(`Loom registry not found at ${path}. Run \`loom import\` to generate it.`);
    this.name = "RegistryNotFoundError";
  }
}

export class RegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistryError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Schema Evolution (load → upgrade chain → validate latest)
// ─────────────────────────────────────────────────────────────────────────────

type AnyRegistry = { version: number; [key: string]: unknown };

/**
 * Pure, testable upgraders keyed by the version they upgrade FROM.
 * MVP ships only version 1, so this is empty; the loader path is in place so
 * `version: 2` will never be a "big bang".
 */
const UPGRADERS: Record<number, (old: AnyRegistry) => AnyRegistry> = {};

function isAnyRegistry(value: unknown): value is AnyRegistry {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { version?: unknown }).version === "number"
  );
}

/** Run the upgrade chain from the file's version up to LATEST_VERSION. */
export function upgradeRegistry(raw: AnyRegistry): AnyRegistry {
  if (raw.version > LATEST_VERSION) {
    throw new RegistryError(
      `Registry version ${raw.version} is newer than supported version ${LATEST_VERSION}. Upgrade Loom.`,
    );
  }
  let current = raw;
  while (current.version < LATEST_VERSION) {
    const upgrader = UPGRADERS[current.version];
    if (!upgrader) {
      throw new RegistryError(
        `No upgrader registered from registry version ${current.version} to ${current.version + 1}.`,
      );
    }
    current = upgrader(current);
  }
  return current;
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation with locatable errors (field + task id)
// ─────────────────────────────────────────────────────────────────────────────

/** Read a string field off an array element, for building locatable error refs. */
function refField(raw: AnyRegistry, collection: string, index: number, field: string): string {
  const list = (raw as Record<string, unknown>)[collection];
  const entry = Array.isArray(list) ? list[index] : undefined;
  const value =
    entry && typeof entry === "object" ? (entry as Record<string, unknown>)[field] : undefined;
  return typeof value === "string" ? value : "";
}

function describeIssue(raw: AnyRegistry, issue: z.core.$ZodIssue): string {
  const segments = issue.path;
  // Resolve a friendly reference when the issue is under a keyed collection, so
  // the error names the offending entry rather than only an array index.
  let ref = "";
  if (typeof segments[1] === "number") {
    const index = segments[1];
    if (segments[0] === "tasks") {
      const id = refField(raw, "tasks", index, "id");
      ref = id ? `task "${id}"` : `tasks[${index}]`;
    } else if (segments[0] === "sharedPaths") {
      const glob = refField(raw, "sharedPaths", index, "glob");
      ref = glob ? `sharedPath "${glob}"` : `sharedPaths[${index}]`;
    }
  }
  const fieldPath = segments.map((segment) => String(segment)).join(".");
  const where = ref ? `${ref} (${fieldPath})` : fieldPath || "<root>";
  return `${where}: ${issue.message}`;
}

/** Validate an already-upgraded object against the latest schema. */
export function validateRegistry(raw: AnyRegistry): Registry {
  const result = RegistrySchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues.map((issue) => describeIssue(raw, issue)).join("; ");
    throw new RegistryError(`Invalid Loom registry: ${details}`);
  }
  // Cross-field invariant (review P1): a session must belong to its task; an
  // embedded `session.taskId` that disagrees with `task.id` is corruption.
  for (const task of result.data.tasks) {
    for (const session of task.sessions) {
      if (session.taskId !== task.id) {
        throw new RegistryError(
          `Invalid Loom registry: task "${task.id}" has session "${session.id}" with mismatched taskId "${session.taskId}".`,
        );
      }
    }
  }
  return result.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// Load / Save
// ─────────────────────────────────────────────────────────────────────────────

export function registryPath(cwd: string = process.cwd()): string {
  return join(cwd, REGISTRY_FILE);
}

/** Read + upgrade + validate the registry from disk. */
export function loadRegistry(cwd: string = process.cwd()): Registry {
  const path = registryPath(cwd);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new RegistryNotFoundError(path);
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch (error) {
    throw new RegistryError(`Failed to parse ${REGISTRY_FILE}: ${(error as Error).message}`);
  }
  if (!isAnyRegistry(parsed)) {
    throw new RegistryError(
      `Invalid Loom registry: missing numeric "version" field at the top level.`,
    );
  }
  return validateRegistry(upgradeRegistry(parsed));
}

/** Atomically write the registry to disk (validates before writing). */
export function saveRegistry(registry: Registry, cwd: string = process.cwd()): void {
  const validated = validateRegistry(registry as unknown as AnyRegistry);
  const path = registryPath(cwd);
  const yaml = stringifyYaml(validated, { sortMapEntries: false });
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, yaml, "utf8");
  renameSync(tmp, path);
}

/** Convenience: an empty, valid registry. */
export function emptyRegistry(): Registry {
  return { version: LATEST_VERSION, tasks: [], landingStreams: [], sharedPaths: [] };
}
