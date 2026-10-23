/**
 * Batch 11 S0 — OGUI decision lifecycle gate and answer checks.
 *
 * Default OFF. Flag-off leaves legacy OGUI submit unchanged and adds no
 * issue, WAIT, or admission behavior. Session writes live in
 * `ogui-decision-engine.ts` and go through `updateSessionStore` inside its
 * lock (`src/config/sessions/store.ts`). S1 alone is not a gray open.
 * No PRODUCTION_GO and no LIVE.
 *
 * Protocol `decision_id` / `decision_version` are references. They are not
 * the authority; the session `OguiDecisionRecord` plus the authenticated
 * identity is (E4).
 */
import { isPositiveInt, type OguiDecisionRecord } from "./ogui-decision.js";

/**
 * Compile-time pin to the locked session writer.
 * The engine passes this function into the locked update.
 */
export type OguiDecisionSessionStoreMutator = typeof import("./store.js").updateSessionStore;

export const OGUI_DECISION_LIFECYCLE_ENV = "OPENBOT_OGUI_DECISION_LIFECYCLE";

export const OGUI_DECISION_MUTATOR_NAME = "updateSessionStore" as const;

/** Answer envelope keys that must never be treated as authenticated identity. */
export const OGUI_ANSWER_UNTRUSTED_IDENTITY_KEYS = [
  "user_id",
  "userId",
  "tenant_id",
  "tenantId",
  "session_key",
  "sessionKey",
  "origin_run_id",
  "originRunId",
] as const;

export type OguiDecisionLifecycleConfigSlice = {
  collaboration?: {
    task?: {
      /** Master switch. Unset / false = off. */
      oguiDecisionLifecycle?: boolean;
      /**
       * tenantId or agentId entries. Empty does not enable the feature.
       * Consulted only after the master switch is on.
       */
      oguiDecisionLifecycleAllowlist?: readonly string[];
    };
  };
};

export type OguiDecisionMutationKind = "issue" | "consume" | "supersede";

export type OguiDecisionMutationPlan =
  | {
      ok: false;
      writes: false;
      mutator: typeof OGUI_DECISION_MUTATOR_NAME;
      reason: "flag_off";
    }
  | {
      ok: true;
      writes: true;
      mutator: typeof OGUI_DECISION_MUTATOR_NAME;
      reason: "ready";
      kind: OguiDecisionMutationKind;
    };

export type OguiAnswerDecisionFields = {
  decision_id?: unknown;
  decision_version?: unknown;
};

export type OguiDecisionFieldClass =
  | { kind: "legacy" }
  | { kind: "lifecycle"; decisionId: string; version: number }
  | {
      kind: "reject";
      reason: "missing_decision_id" | "missing_decision_version" | "invalid_decision_version";
    };

export type OguiAnswerLifecycleEvaluation =
  | { path: "legacy"; ok: true }
  | { path: "lifecycle"; ok: true; decisionId: string; version: number }
  | {
      path: "lifecycle";
      ok: false;
      reason:
        | "missing_decision_id"
        | "missing_decision_version"
        | "invalid_decision_version"
        | "unknown_decision"
        | "version_mismatch"
        | "flag_off"
        | "untrusted_identity";
      /** PIN-3: a rejected lifecycle answer must not continue as plain chat. */
      fallbackToPlainChat: false;
    };

type EnvToken = "unset" | "on" | "off" | "invalid";

function readEnvToken(raw: string | undefined): EnvToken {
  if (raw === undefined || raw.trim() === "") {
    return "unset";
  }
  const value = raw.trim().toLowerCase();
  if (value === "1" || value === "true" || value === "yes" || value === "on") {
    return "on";
  }
  if (value === "0" || value === "false" || value === "no" || value === "off") {
    return "off";
  }
  return "invalid";
}

function masterEnabled(
  cfg: OguiDecisionLifecycleConfigSlice | undefined,
  env: Record<string, string | undefined>,
): boolean {
  const token = readEnvToken(env[OGUI_DECISION_LIFECYCLE_ENV]);
  if (token === "off" || token === "invalid") {
    return false;
  }
  if (token === "on") {
    return true;
  }
  return cfg?.collaboration?.task?.oguiDecisionLifecycle === true;
}

/**
 * Lifecycle master switch. Default off.
 *
 * Resolution, fail closed:
 *   - env `0|false|no|off` or any other explicit non-on token forces off
 *   - env `1|true|yes|on` opts in (tests / later canary; not PRODUCTION_GO)
 *   - otherwise `collaboration.task.oguiDecisionLifecycle === true`
 * A non-empty allowlist then requires an exact subject match (tenantId or
 * agentId). An empty allowlist does not turn the feature on by itself.
 * When the master switch is off, the allowlist is ignored.
 */
export function isOguiDecisionLifecycleEnabled(input?: {
  cfg?: OguiDecisionLifecycleConfigSlice;
  env?: Record<string, string | undefined>;
  subjectId?: string;
}): boolean {
  const env = input?.env ?? process.env;
  if (!masterEnabled(input?.cfg, env)) {
    return false;
  }
  const allowlist = input?.cfg?.collaboration?.task?.oguiDecisionLifecycleAllowlist;
  if (!allowlist || allowlist.length === 0) {
    return true;
  }
  const subject = input?.subjectId?.trim() ?? "";
  if (!subject) {
    return false;
  }
  return allowlist.some((entry) => entry.trim() === subject);
}

/**
 * Master switch for several authenticated subjects (tenantId or agentId).
 * An empty subject list uses the single-subject helper. A non-empty allowlist
 * still fails closed when none of the subjects match.
 */
export function isOguiDecisionLifecycleEnabledFor(input?: {
  cfg?: OguiDecisionLifecycleConfigSlice;
  env?: Record<string, string | undefined>;
  subjectIds?: readonly (string | undefined)[];
}): boolean {
  const ids = (input?.subjectIds ?? []).map((id) => id?.trim() ?? "").filter(Boolean);
  if (ids.length === 0) {
    return isOguiDecisionLifecycleEnabled({ cfg: input?.cfg, env: input?.env });
  }
  return ids.some((subjectId) =>
    isOguiDecisionLifecycleEnabled({ cfg: input?.cfg, env: input?.env, subjectId }),
  );
}

/**
 * Flag off → no issue / WAIT / admission write.
 * Flag on → the engine may call `updateSessionStore` for this kind.
 * The plan does not write by itself. S1 alone is not a gray open.
 */
export function planOguiDecisionMutation(input: {
  kind: OguiDecisionMutationKind;
  lifecycleEnabled: boolean;
}): OguiDecisionMutationPlan {
  if (!input.lifecycleEnabled) {
    return {
      ok: false,
      writes: false,
      mutator: OGUI_DECISION_MUTATOR_NAME,
      reason: "flag_off",
    };
  }
  return {
    ok: true,
    writes: true,
    mutator: OGUI_DECISION_MUTATOR_NAME,
    reason: "ready",
    kind: input.kind,
  };
}

export function oguiAnswerHasUntrustedIdentity(answer: object): boolean {
  const record = answer as Record<string, unknown>;
  return OGUI_ANSWER_UNTRUSTED_IDENTITY_KEYS.some((key) => record[key] !== undefined);
}

/**
 * Shape check for answer decision fields.
 * Both absent → legacy (Ev1). One side or a non-positive version → reject (Ev2).
 * A present `decision_version` that is not a positive integer is
 * `invalid_decision_version` even when `decision_id` is also missing.
 */
export function classifyOguiAnswerDecisionFields(
  answer: OguiAnswerDecisionFields,
): OguiDecisionFieldClass {
  const idPresent = answer.decision_id !== undefined;
  const versionPresent = answer.decision_version !== undefined;
  if (!idPresent && !versionPresent) {
    return { kind: "legacy" };
  }
  if (versionPresent && !isPositiveInt(answer.decision_version)) {
    return { kind: "reject", reason: "invalid_decision_version" };
  }
  const decisionId = typeof answer.decision_id === "string" ? answer.decision_id.trim() : "";
  if (!idPresent || !decisionId) {
    return { kind: "reject", reason: "missing_decision_id" };
  }
  if (!versionPresent) {
    return { kind: "reject", reason: "missing_decision_version" };
  }
  return {
    kind: "lifecycle",
    decisionId,
    version: answer.decision_version as number,
  };
}

/**
 * Consume-shape evaluation. Does not write the session and does not resume.
 * `lifecycleEnabled` defaults to false so a forgotten caller cannot consume.
 * Legacy answers (both decision fields omitted) stay ok while the flag is off.
 * A lifecycle-shaped answer while the flag is off is `flag_off`, not a
 * rewrite into the legacy path.
 * Pass `records` to reject unknown ids and version mismatches. Omit `records`
 * to stop after the field-shape check.
 */
export function evaluateOguiAnswerLifecycle(input: {
  answer: OguiAnswerDecisionFields & object;
  records?: Readonly<Record<string, OguiDecisionRecord>>;
  lifecycleEnabled?: boolean;
}): OguiAnswerLifecycleEvaluation {
  if (oguiAnswerHasUntrustedIdentity(input.answer)) {
    return {
      path: "lifecycle",
      ok: false,
      reason: "untrusted_identity",
      fallbackToPlainChat: false,
    };
  }
  const classified = classifyOguiAnswerDecisionFields(input.answer);
  if (classified.kind === "legacy") {
    return { path: "legacy", ok: true };
  }
  if (classified.kind === "reject") {
    return {
      path: "lifecycle",
      ok: false,
      reason: classified.reason,
      fallbackToPlainChat: false,
    };
  }
  if (input.lifecycleEnabled !== true) {
    return { path: "lifecycle", ok: false, reason: "flag_off", fallbackToPlainChat: false };
  }
  if (input.records) {
    const record = input.records[classified.decisionId];
    if (!record || record.decisionId !== classified.decisionId) {
      return {
        path: "lifecycle",
        ok: false,
        reason: "unknown_decision",
        fallbackToPlainChat: false,
      };
    }
    if (record.version !== classified.version) {
      return {
        path: "lifecycle",
        ok: false,
        reason: "version_mismatch",
        fallbackToPlainChat: false,
      };
    }
  }
  return {
    path: "lifecycle",
    ok: true,
    decisionId: classified.decisionId,
    version: classified.version,
  };
}
