import { digestName } from "./shadow/digest.js";
import { parseShadowTaskEnvelope } from "./shadow/envelope.js";
import { decideShadowRoute } from "./shadow/evaluate.js";
import { projectShadowEvent } from "./shadow/event.js";
import {
  PHASE1_FLAGS,
  TASK_ENVELOPE_SCHEMA,
  type CatalogEntry,
  type ShadowRouteEvent,
} from "./shadow/types.js";

export type ShadowRecordSkipReason = "flag_off" | "swallowed";

export type ShadowRecordResult =
  | { recorded: false; reason: ShadowRecordSkipReason }
  | { recorded: true; event: ShadowRouteEvent };

export type ShadowRecordSink = (event: ShadowRouteEvent) => void;

/**
 * Default-off, best-effort shadow-record. Production keeps
 * `SHADOW_ROUTER_RECORD` compile-time false, so this is a no-op unless a
 * test override passes `recordEnabled: true`. Failures never throw.
 * `apply` stays false.
 */
export function recordShadowRouteBestEffort(params: {
  envelope: unknown;
  eligibleSkills: readonly CatalogEntry[];
  constructedTools: readonly CatalogEntry[];
  runIdDigest: string;
  sessionKeyHash?: string;
  sink?: ShadowRecordSink;
  recordEnabled?: boolean;
}): ShadowRecordResult {
  try {
    const enabled = params.recordEnabled ?? PHASE1_FLAGS.SHADOW_ROUTER_RECORD;
    if (!enabled || PHASE1_FLAGS.SHADOW_ROUTER_APPLY) {
      return { recorded: false, reason: "flag_off" };
    }
    const envelope = parseShadowTaskEnvelope(params.envelope);
    const decision = decideShadowRoute({
      envelope,
      eligibleSkills: params.eligibleSkills,
      constructedTools: params.constructedTools,
    });
    if (decision.apply !== false) {
      return { recorded: false, reason: "swallowed" };
    }
    const event = projectShadowEvent({
      decision,
      runIdDigest: params.runIdDigest,
      sessionKeyHash: params.sessionKeyHash,
    });
    params.sink?.(event);
    return { recorded: true, event };
  } catch {
    return { recorded: false, reason: "swallowed" };
  }
}

type PendingSkills = {
  skillNames: readonly string[];
  sessionKey?: string;
};

const pendingSkills = new Map<string, PendingSkills>();

type ShadowRecordClock = {
  recordEnabled?: boolean;
  sink?: ShadowRecordSink;
};

let clock: ShadowRecordClock = {};

function isShadowRecordEnabled(): boolean {
  return clock.recordEnabled ?? PHASE1_FLAGS.SHADOW_ROUTER_RECORD;
}

function toCatalog(kind: "skill" | "tool", names: readonly string[]): CatalogEntry[] {
  const seen = new Set<string>();
  const catalog: CatalogEntry[] = [];
  for (const name of names) {
    const trimmed = name.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    catalog.push({
      nameDigest: digestName(kind, trimmed),
      tagDigests: [],
      sideEffect: false,
    });
  }
  return catalog;
}

function closedEnvelope(runIdDigest: string) {
  return {
    schema: TASK_ENVELOPE_SCHEMA,
    taskClass: "unknown" as const,
    riskClass: "unknown" as const,
    channelKind: "unknown" as const,
    textDigest: runIdDigest,
  };
}

/** Live helper: remember digested Skill names only if record is enabled. */
export function observeShadowSkillCatalogBestEffort(params: {
  runId: string;
  sessionKey?: string;
  readSkillNames: () => readonly string[];
}): void {
  try {
    if (!isShadowRecordEnabled()) {
      return;
    }
    pendingSkills.set(params.runId, {
      skillNames: params.readSkillNames(),
      sessionKey: params.sessionKey,
    });
  } catch {
    // Shadow-record must never enter the attempt path.
  }
}

/** Live helper: flush a digest-only shadow event after Tool names are known. */
export function observeShadowToolCatalogBestEffort(params: {
  runId: string;
  sessionKey?: string;
  readToolNames: () => readonly string[];
}): ShadowRecordResult {
  try {
    if (!isShadowRecordEnabled()) {
      pendingSkills.delete(params.runId);
      return { recorded: false, reason: "flag_off" };
    }
    const pending = pendingSkills.get(params.runId);
    pendingSkills.delete(params.runId);
    const runIdDigest = digestName("run", params.runId);
    const sessionKey = params.sessionKey ?? pending?.sessionKey;
    return recordShadowRouteBestEffort({
      envelope: closedEnvelope(runIdDigest),
      eligibleSkills: toCatalog("skill", pending?.skillNames ?? []),
      constructedTools: toCatalog("tool", params.readToolNames()),
      runIdDigest,
      sessionKeyHash: sessionKey ? digestName("session", sessionKey) : undefined,
      sink: clock.sink,
      recordEnabled: true,
    });
  } catch {
    pendingSkills.delete(params.runId);
    return { recorded: false, reason: "swallowed" };
  }
}

export function pendingShadowSkillCatalogSize(): number {
  return pendingSkills.size;
}

export function configureShadowRecordForTest(next?: {
  recordEnabled?: boolean;
  sink?: ShadowRecordSink;
}): void {
  clock = {
    recordEnabled: next?.recordEnabled,
    sink: next?.sink,
  };
}

export function resetShadowRecordForTest(): void {
  pendingSkills.clear();
  clock = {};
}
