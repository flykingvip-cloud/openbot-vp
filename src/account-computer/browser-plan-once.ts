/**
 * Browser plan-once action layer (BROWSER_PLAN_ONCE_LEGAL_DOM_IMPL + FOLLOWONS).
 * Contract: docs/design/account-computer-browser-plan-once-2026-10-08.md
 *
 * Pure grounding + settle defaults + Replan-vs-terminal table.
 * Execute/observe are injected so this plugs into existing CDP/browser tools
 * without a parallel stack. No location.reload recovery; no auto-pay.
 *
 * Follow-ons (M1+): allowed_risks gate, secret_inputs redact-at-observe /
 * type-at-execute, cheap non-frontier disambiguation, OCR enricher stub.
 */

export const BROWSER_PLAN_ONCE_LEGAL_DOM_IMPL = "BROWSER_PLAN_ONCE_LEGAL_DOM_IMPL" as const;
export const BROWSER_PLAN_ONCE_LEGAL_DOM_FOLLOWONS =
  "BROWSER_PLAN_ONCE_LEGAL_DOM_FOLLOWONS" as const;

export const DEFAULT_MAX_ACTIONS = 20;
export const DEFAULT_MAX_REPLANS = 2;
export const DEFAULT_QUIET_MS = 150;
export const DEFAULT_SETTLE_TIMEOUT_MS = 2000;

export type PlanOnceTerminal = "DONE" | "FAIL" | "NEEDS_INPUT" | "NEEDS_AGENT" | "BLOCKED";

/** Decision after a step / situation (normative table). */
export type PlanOnceDecision =
  | { kind: "DONE"; reason: string }
  | { kind: "FAIL"; reason: string }
  | { kind: "NEEDS_INPUT"; reason: string }
  | { kind: "NEEDS_AGENT"; reason: string }
  | { kind: "BLOCKED"; reason: string }
  | { kind: "CONTINUE"; reason: string }
  | { kind: "REPLAN"; reason: string };

export type PlanOnceAction = "click" | "type" | "press" | "scroll" | "wait";

export type PlanStep = {
  action: PlanOnceAction;
  /** Preferred: already-grounded snapshot id (re-ground still validates membership). */
  id?: string;
  target?: string;
  role?: string;
  near?: string;
  text?: string;
  key?: string;
  direction?: string;
  /** Denied in M1 — coordinate-only clicks. */
  x?: number;
  y?: number;
};

export type ShapeBPlan = {
  finishes_task?: boolean;
  summary?: string;
  max_actions?: number;
  max_replans?: number;
  steps: PlanStep[];
  inputs?: Record<string, string>;
  verification?: string[];
  constraints?: string[];
  secret_inputs?: string[];
  allowed_risks?: string[];
};

/** Internal runtime envelope (Shape A). Shape B compiles into this. */
export type ShapeASubtask = {
  goal: string;
  inputs?: Record<string, string>;
  verification?: string[];
  constraints?: string[];
  max_actions?: number;
  max_replans?: number;
  allowed_risks?: string[];
  secret_inputs?: string[];
  steps?: PlanStep[];
};

export type LegalDomElement = {
  id: string;
  role: string;
  name?: string;
  label?: string;
  value?: string;
  enabled?: boolean;
  visible?: boolean;
  /** Optional proximity hint for disambiguation. */
  near?: string;
  meta?: { options?: string[] };
};

export type LegalDomSnapshot = {
  elements: LegalDomElement[];
  /** Opaque page signature for settle/verify (not ambient-only). */
  signature?: string;
};

export type SettleConfig = {
  quiet_ms: number;
  settle_timeout_ms: number;
};

export type RunProgress = {
  actionsUsed: number;
  replansUsed: number;
  maxActions: number;
  maxReplans: number;
  /** Admitted (actionKey, controlState) pairs for anti-loop. */
  admitted: Array<{ actionKey: string; controlState: string }>;
  /** Same action identity counts (no goal progress). */
  actionIdentityCounts: Record<string, number>;
  consecutiveUnverified: number;
  /** Cheap non-frontier disambiguation calls used (does not burn max_replans). */
  cheapDisambiguationsUsed: number;
  cancelled?: boolean;
};

export type GroundingOk = { ok: true; id: string; element: LegalDomElement };
export type GroundingErr = {
  ok: false;
  reason: "miss" | "ambiguous" | "disabled" | "invisible" | "coordinate_denied" | "no_id_required";
  detail?: string;
  candidates?: LegalDomElement[];
};
export type GroundingResult = GroundingOk | GroundingErr;

export function normalizeBudgets(plan: { max_actions?: number; max_replans?: number }): {
  max_actions: number;
  max_replans: number;
} {
  const max_actions =
    typeof plan.max_actions === "number" &&
    Number.isFinite(plan.max_actions) &&
    plan.max_actions > 0
      ? Math.floor(plan.max_actions)
      : DEFAULT_MAX_ACTIONS;
  const max_replans =
    typeof plan.max_replans === "number" &&
    Number.isFinite(plan.max_replans) &&
    plan.max_replans >= 0
      ? Math.floor(plan.max_replans)
      : DEFAULT_MAX_REPLANS;
  return { max_actions, max_replans };
}

export function settleConfig(overrides?: Partial<SettleConfig>): SettleConfig {
  return {
    quiet_ms:
      typeof overrides?.quiet_ms === "number" && overrides.quiet_ms >= 0
        ? overrides.quiet_ms
        : DEFAULT_QUIET_MS,
    settle_timeout_ms:
      typeof overrides?.settle_timeout_ms === "number" && overrides.settle_timeout_ms > 0
        ? overrides.settle_timeout_ms
        : DEFAULT_SETTLE_TIMEOUT_MS,
  };
}

export function compileShapeBToA(plan: ShapeBPlan): ShapeASubtask {
  const budgets = normalizeBudgets(plan);
  return {
    goal: plan.summary?.trim() || "Execute browser step plan",
    inputs: plan.inputs,
    verification: plan.verification,
    constraints: plan.constraints,
    max_actions: budgets.max_actions,
    max_replans: budgets.max_replans,
    allowed_risks: plan.allowed_risks,
    secret_inputs: plan.secret_inputs,
    steps: plan.steps,
  };
}

export function createRunProgress(plan: {
  max_actions?: number;
  max_replans?: number;
}): RunProgress {
  const budgets = normalizeBudgets(plan);
  return {
    actionsUsed: 0,
    replansUsed: 0,
    maxActions: budgets.max_actions,
    maxReplans: budgets.max_replans,
    admitted: [],
    actionIdentityCounts: {},
    consecutiveUnverified: 0,
    cheapDisambiguationsUsed: 0,
  };
}

function elementLabel(el: LegalDomElement): string {
  return (el.label ?? el.name ?? "").trim();
}

function isChoosable(el: LegalDomElement): boolean {
  return el.enabled !== false && el.visible !== false;
}

/**
 * Ground click/type to an id in the **latest** snapshot.
 * press/scroll/wait do not require an id.
 */
export function groundStep(step: PlanStep, snapshot: LegalDomSnapshot): GroundingResult {
  if (step.action === "press" || step.action === "scroll" || step.action === "wait") {
    if (step.action === "scroll" && (step.target || step.id)) {
      // optional container grounding
    } else {
      return { ok: false, reason: "no_id_required" };
    }
  }

  if (
    step.action === "click" &&
    (typeof step.x === "number" || typeof step.y === "number") &&
    !step.id &&
    !step.target &&
    !step.role
  ) {
    return {
      ok: false,
      reason: "coordinate_denied",
      detail: "coordinate-only clicks denied in M1",
    };
  }

  const elements = snapshot.elements ?? [];

  if (step.id) {
    const hit = elements.find((e) => e.id === step.id);
    if (!hit) {
      return { ok: false, reason: "miss", detail: `id ${step.id} not in latest snapshot` };
    }
    if (!isChoosable(hit)) {
      return {
        ok: false,
        reason: hit.enabled === false ? "disabled" : "invisible",
        detail: step.id,
      };
    }
    return { ok: true, id: hit.id, element: hit };
  }

  const target = (step.target ?? "").trim();
  const role = (step.role ?? "").trim().toLowerCase();
  const near = (step.near ?? "").trim().toLowerCase();

  let candidates = elements.filter(isChoosable);

  if (target) {
    const exact = candidates.filter((e) => elementLabel(e) === target);
    candidates =
      exact.length > 0 ? exact : candidates.filter((e) => elementLabel(e).includes(target));
  }

  if (role) {
    candidates = candidates.filter((e) => e.role.toLowerCase() === role);
  }

  if (near) {
    const withNear = candidates.filter((e) => (e.near ?? "").toLowerCase().includes(near));
    if (withNear.length > 0) {
      candidates = withNear;
    }
  }

  if (candidates.length === 0) {
    return { ok: false, reason: "miss", detail: target || role || "no match" };
  }
  if (candidates.length > 1) {
    return {
      ok: false,
      reason: "ambiguous",
      detail: `matched ${candidates.length}`,
      candidates,
    };
  }
  return { ok: true, id: candidates[0].id, element: candidates[0] };
}

/** Follow-on risk categories (arc-cua pattern). Default empty = 不代付. */
export type AllowedRisk = "purchase" | "send" | "delete" | "close";

export const ALLOWED_RISK_VALUES: readonly AllowedRisk[] = [
  "purchase",
  "send",
  "delete",
  "close",
] as const;

const PURCHASE_RISK_LABELS = [
  /立即支付/,
  /确认付款/,
  /密码支付/,
  /去支付/,
  /提交订单/,
  /下单/,
  /结算并支付/,
  /place\s*order/i,
  /buy\s*now/i,
  /pay\s*now/i,
  /confirm\s*pay/i,
];

const SEND_RISK_LABELS = [/^(发送|send|post|submit)$/i, /发送消息/, /send\s*message/i, /发布/];

const DELETE_RISK_LABELS = [/删除/, /清空/, /\bdelete\b/i, /remove\s*permanently/i, /永久删除/];

const CLOSE_RISK_LABELS = [
  /关闭账户/,
  /注销/,
  /close\s*account/i,
  /cancel\s*subscription/i,
  /关闭会话/,
];

/** Classify a control label into a risk category, or null if not risky. */
export function classifyControlRisk(label: string): AllowedRisk | null {
  const t = label.trim();
  if (!t) {
    return null;
  }
  if (PURCHASE_RISK_LABELS.some((re) => re.test(t))) {
    return "purchase";
  }
  if (DELETE_RISK_LABELS.some((re) => re.test(t))) {
    return "delete";
  }
  if (CLOSE_RISK_LABELS.some((re) => re.test(t))) {
    return "close";
  }
  if (SEND_RISK_LABELS.some((re) => re.test(t))) {
    return "send";
  }
  return null;
}

export function normalizeAllowedRisks(raw?: string[] | null): Set<AllowedRisk> {
  const out = new Set<AllowedRisk>();
  if (!raw) {
    return out;
  }
  for (const item of raw) {
    const v = String(item ?? "")
      .trim()
      .toLowerCase();
    if ((ALLOWED_RISK_VALUES as readonly string[]).includes(v)) {
      out.add(v as AllowedRisk);
    }
  }
  return out;
}

/**
 * Refuse risky controls unless listed in allowed_risks.
 * Hard pay-submit (立即支付 / 确认付款 / …) is always refused (iron 不代付),
 * even if `purchase` is listed — consistent with wire / auto-pay ban.
 */
export function refuseRiskyControl(input: {
  label: string;
  allowed_risks?: string[] | null;
}): { refuse: true; reason: string; risk: AllowedRisk | "iron_pay" } | { refuse: false } {
  const label = input.label.trim();
  if (isForbiddenPaymentControl(label)) {
    return {
      refuse: true,
      reason: "iron 不代付: payment submit control refused",
      risk: "iron_pay",
    };
  }
  const risk = classifyControlRisk(label);
  if (!risk) {
    return { refuse: false };
  }
  const allowed = normalizeAllowedRisks(input.allowed_risks);
  if (!allowed.has(risk)) {
    return {
      refuse: true,
      reason: `risk "${risk}" not in allowed_risks (default empty = 不代付)`,
      risk,
    };
  }
  return { refuse: false };
}

/** Hide risky controls from a legal snapshot unless allowed (observe / model context). */
export function filterLegalSnapshotForRisks(
  snapshot: LegalDomSnapshot,
  allowed_risks?: string[] | null,
): LegalDomSnapshot {
  const allowed = normalizeAllowedRisks(allowed_risks);
  return {
    ...snapshot,
    elements: (snapshot.elements ?? []).filter((el) => {
      const label = elementLabel(el);
      if (isForbiddenPaymentControl(label)) {
        return false;
      }
      const risk = classifyControlRisk(label);
      if (!risk) {
        return true;
      }
      return allowed.has(risk);
    }),
  };
}

const SECRET_REDACT_SENTINEL = "[redacted]";

function secretKeySet(secret_inputs?: string[] | null): Set<string> {
  return new Set(
    (secret_inputs ?? []).map((s) => String(s ?? "").trim()).filter((s) => s.length > 0),
  );
}

function elementMatchesSecretKey(el: LegalDomElement, keys: Set<string>): boolean {
  if (keys.size === 0) {
    return false;
  }
  const label = elementLabel(el);
  const role = (el.role ?? "").trim();
  for (const key of keys) {
    if (label === key || label.includes(key) || (key.includes(label) && label.length > 0)) {
      return true;
    }
    if (role && key.toLowerCase() === role.toLowerCase()) {
      return true;
    }
  }
  // Also treat password-like fields as secret when any secret_inputs listed
  // and the field looks like a secret (OTP / 密码).
  if (looksLikeSecretField(label) || looksLikeSecretField(role)) {
    return true;
  }
  return false;
}

/**
 * Redact secret field values from observe / model context.
 * Real values are typed only at execute time via inputs / step resolution.
 */
export function redactSnapshotSecrets(
  snapshot: LegalDomSnapshot,
  secret_inputs?: string[] | null,
): LegalDomSnapshot {
  const keys = secretKeySet(secret_inputs);
  if (keys.size === 0) {
    // Still redact password-like values when secret_inputs is empty? Design:
    // "redact from model context" for secret_inputs keys. Without keys, leave
    // values; callers may still pass password-like fields via looksLikeSecretField
    // at resolve time. Keep observe as-is when no secret_inputs declared.
    return snapshot;
  }
  return {
    ...snapshot,
    elements: (snapshot.elements ?? []).map((el) => {
      if (!elementMatchesSecretKey(el, keys)) {
        return el;
      }
      if (el.value === undefined || el.value === "") {
        return el;
      }
      return { ...el, value: SECRET_REDACT_SENTINEL };
    }),
  };
}

/** Prepare snapshot for model/planner context: risk-hide + secret redact. */
export function prepareObserveForModel(
  snapshot: LegalDomSnapshot,
  plan: { allowed_risks?: string[] | null; secret_inputs?: string[] | null },
): LegalDomSnapshot {
  return redactSnapshotSecrets(
    filterLegalSnapshotForRisks(snapshot, plan.allowed_risks),
    plan.secret_inputs,
  );
}

export type OcrEnricher = (input: {
  reason: "empty_a11y_dom";
  screenshot?: Uint8Array | string;
}) => Promise<LegalDomElement[] | null> | LegalDomElement[] | null;

export type OcrFallbackStatus = "not_needed" | "applied" | "unavailable" | "skipped_empty";

/**
 * OCR fallback only when a11y/DOM is empty (canvas). No in-repo OCR stack —
 * hosts inject `ocr`; otherwise status is `unavailable` (stub path).
 */
export async function enrichSnapshotWithOcrFallback(
  snapshot: LegalDomSnapshot,
  ocr?: OcrEnricher | null,
  opts?: { screenshot?: Uint8Array | string },
): Promise<{ snapshot: LegalDomSnapshot; status: OcrFallbackStatus }> {
  const elements = snapshot.elements ?? [];
  if (elements.length > 0) {
    return { snapshot, status: "not_needed" };
  }
  if (!ocr) {
    return { snapshot, status: "unavailable" };
  }
  const enriched = await ocr({ reason: "empty_a11y_dom", screenshot: opts?.screenshot });
  if (!enriched || enriched.length === 0) {
    return { snapshot, status: "skipped_empty" };
  }
  return {
    snapshot: { ...snapshot, elements: enriched },
    status: "applied",
  };
}

/** Cap cheap disambiguation calls per run (does not burn max_replans). */
export const MAX_CHEAP_DISAMBIGUATIONS_PER_RUN = 1;

/**
 * Attempt one cheap non-frontier disambiguation among legal candidates.
 * Returns grounded ok, or null when still ambiguous / budget exhausted.
 */
export async function tryCheapDisambiguation(input: {
  candidates: LegalDomElement[];
  step: PlanStep;
  snapshot: LegalDomSnapshot;
  progress: RunProgress;
  disambiguate?: (
    candidates: LegalDomElement[],
    step: PlanStep,
    snapshot: LegalDomSnapshot,
  ) => Promise<LegalDomElement | null> | LegalDomElement | null;
}): Promise<GroundingOk | null> {
  const { candidates, step, snapshot, progress, disambiguate } = input;
  if (!disambiguate || candidates.length < 2) {
    return null;
  }
  if (progress.cheapDisambiguationsUsed >= MAX_CHEAP_DISAMBIGUATIONS_PER_RUN) {
    return null;
  }
  progress.cheapDisambiguationsUsed += 1;
  const picked = await disambiguate(candidates, step, snapshot);
  if (!picked) {
    return null;
  }
  const match = candidates.find((c) => c.id === picked.id);
  if (!match || !isChoosable(match)) {
    return null;
  }
  return { ok: true, id: match.id, element: match };
}

const PAY_SUBMIT_LABELS = [/立即支付/, /确认付款/, /密码支付/, /confirm\s*pay/i, /pay\s*now/i];

/** Forbidden payment submit controls (绝不代付). */
export function isForbiddenPaymentControl(label: string): boolean {
  const t = label.trim();
  if (!t) {
    return false;
  }
  return PAY_SUBMIT_LABELS.some((re) => re.test(t));
}

export function looksLikeSecretField(labelOrRole: string): boolean {
  const t = labelOrRole.toLowerCase();
  return (
    t.includes("password") ||
    t.includes("密码") ||
    t.includes("otp") ||
    t.includes("验证码") ||
    t.includes("payment") ||
    t.includes("支付密码")
  );
}

/**
 * Ambient-only signature churn (clock / percent progress) must not count as
 * “page reacted” for settle/verify.
 */
export function isAmbientOnlySignatureChange(before: string, after: string): boolean {
  if (before === after) {
    return false;
  }
  const stripAmbient = (s: string) =>
    s
      .replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, "#TIME#")
      .replace(/\b\d{1,3}%/g, "#PCT#")
      .replace(/\b\d+ms\b/gi, "#MS#");
  return stripAmbient(before) === stripAmbient(after);
}

export function verifyTypeValue(expected: string, actual: string | undefined): boolean {
  return (actual ?? "") === expected;
}

export function actionIdentity(step: PlanStep, groundedId?: string): string {
  const parts = [
    step.action,
    groundedId ?? step.id ?? step.target ?? "",
    step.key ?? "",
    step.text ?? "",
  ];
  return parts.join("|");
}

export function controlStateFromSnapshot(snapshot: LegalDomSnapshot, id?: string): string {
  const sig = snapshot.signature ?? "";
  if (!id) {
    return sig;
  }
  const el = snapshot.elements.find((e) => e.id === id);
  if (!el) {
    return `${sig}|missing:${id}`;
  }
  return `${sig}|${el.id}|${el.role}|${elementLabel(el)}|v=${el.value ?? ""}|en=${el.enabled !== false}|vis=${el.visible !== false}`;
}

/**
 * Normative Replan vs terminal table.
 * Callers must not invent a discretionary “BLOCKED or replan”.
 */
export function decideReplanOrTerminal(input: {
  situation:
    | "missing_literal"
    | "grounding_miss"
    | "grounding_ambiguous"
    | "verify_fail"
    | "anti_loop_same_action_state"
    | "anti_loop_same_action_thrice"
    | "two_unverified"
    | "no_legal_actions"
    | "max_actions_exhausted"
    | "verification_hold"
    | "policy_violation"
    | "policy_scan_pay"
    | "user_cancel";
  progress: RunProgress;
  remainingPlannedSteps?: number;
  plannerSaidImpossible?: boolean;
}): PlanOnceDecision {
  const { situation, progress } = input;
  const replanBudgetLeft = progress.replansUsed < progress.maxReplans;

  switch (situation) {
    case "missing_literal":
      return { kind: "NEEDS_INPUT", reason: "missing literal / secret; never invent" };
    case "grounding_miss":
    case "grounding_ambiguous":
      return { kind: "NEEDS_AGENT", reason: situation };
    case "anti_loop_same_action_state":
      return { kind: "BLOCKED", reason: "anti-loop: identical action + control-state" };
    case "anti_loop_same_action_thrice":
      return { kind: "BLOCKED", reason: "anti-loop: same action identity ≥ 3 without progress" };
    case "no_legal_actions":
      return { kind: "BLOCKED", reason: "no legal actions in snapshot for required click/type" };
    case "max_actions_exhausted":
      return { kind: "BLOCKED", reason: "max_actions exhausted before verification" };
    case "verification_hold":
      return { kind: "DONE", reason: "verification criteria hold" };
    case "policy_violation":
      return { kind: "FAIL", reason: "constraint / policy violation (e.g. 立即支付)" };
    case "policy_scan_pay":
      return { kind: "NEEDS_INPUT", reason: "扫码支付 — hand 电脑; never auto-pay" };
    case "user_cancel":
      return { kind: "BLOCKED", reason: "user 接管 / cancel; Ownership wins" };
    case "two_unverified":
      if (replanBudgetLeft) {
        return { kind: "REPLAN", reason: "two consecutive unverified effects" };
      }
      return { kind: "BLOCKED", reason: "two unverified; replan budget exhausted" };
    case "verify_fail": {
      const hasSteps = (input.remainingPlannedSteps ?? 0) > 0;
      if (hasSteps || replanBudgetLeft) {
        if (replanBudgetLeft) {
          return { kind: "REPLAN", reason: "step verify fail; replan budget remains" };
        }
        // remaining steps but no replan budget: continue remaining only if caller wants;
        // contract: verify fail + budget exhausted → BLOCKED
        return {
          kind: input.plannerSaidImpossible ? "FAIL" : "BLOCKED",
          reason: "step verify fail; replan budget exhausted",
        };
      }
      return {
        kind: input.plannerSaidImpossible ? "FAIL" : "BLOCKED",
        reason: "step verify fail; no steps and no replan budget",
      };
    }
    default:
      return { kind: "BLOCKED", reason: "unknown situation" };
  }
}

/** M2 hard mapping: only DONE may emit chat.final. NEEDS_*, BLOCKED, FAIL, and REPLAN forbid it. */
export function allowsChatFinal(status: PlanOnceTerminal | "REPLAN"): boolean {
  return status === "DONE";
}

export function isPauseTerminal(status: PlanOnceTerminal): boolean {
  return status === "NEEDS_INPUT" || status === "NEEDS_AGENT" || status === "BLOCKED";
}

export function decisionToTerminal(d: PlanOnceDecision): PlanOnceTerminal | null {
  if (d.kind === "CONTINUE" || d.kind === "REPLAN") {
    return null;
  }
  return d.kind;
}

export type PlanOnceExecuteRequest =
  | { action: "click"; id: string }
  | { action: "type"; id: string; text: string }
  | { action: "press"; key: string }
  | { action: "scroll"; id?: string; direction?: string }
  | { action: "wait" };

export type PlanOnceDeps = {
  observe: () => Promise<LegalDomSnapshot> | LegalDomSnapshot;
  execute: (req: PlanOnceExecuteRequest) => Promise<void> | void;
  /** Optional settle hook; defaults to no-op (unit tests inject timing). */
  settle?: (cfg: SettleConfig) => Promise<void> | void;
  settleOverrides?: Partial<SettleConfig>;
  /** When true, verification criteria are treated as already satisfied (tests / host). */
  checkVerification?: (snapshot: LegalDomSnapshot) => boolean;
  /** Cancel / 接管 */
  isCancelled?: () => boolean;
  /**
   * Optional cheap (non-frontier) disambiguation among legal candidates.
   * At most one call per run; does **not** consume max_replans.
   * Return a candidate from the list, or null → NEEDS_AGENT.
   */
  disambiguate?: (
    candidates: LegalDomElement[],
    step: PlanStep,
    snapshot: LegalDomSnapshot,
  ) => Promise<LegalDomElement | null> | LegalDomElement | null;
  /**
   * Optional OCR enricher when a11y/DOM is empty (canvas). Hosts without OCR
   * omit this; library stubs as unavailable / skipped.
   */
  ocrFallback?: OcrEnricher;
};

export type PlanOnceResult = {
  /** Terminal or REPLAN (non-terminal; caller must frontier-replan). */
  status: PlanOnceTerminal | "REPLAN";
  reason: string;
  progress: RunProgress;
  /** True when caller must start a frontier replan (already counted in replansUsed). */
  needsFrontierReplan: boolean;
  allowsChatFinal: boolean;
  stepsCompleted: number;
};

function resolveTypeText(
  step: PlanStep,
  plan: ShapeBPlan | ShapeASubtask,
): { text: string } | { missing: true; reason: string } {
  const inputs = plan.inputs ?? {};
  const target = (step.target ?? "").trim();
  const secrets = secretKeySet(plan.secret_inputs);
  const isSecretTarget =
    (target && secrets.has(target)) ||
    looksLikeSecretField(target) ||
    looksLikeSecretField(step.role ?? "") ||
    [...secrets].some((k) => target.includes(k) || k.includes(target));

  // secret_inputs: prefer real values from inputs at execute time; never invent.
  if (isSecretTarget) {
    if (target && typeof inputs[target] === "string" && inputs[target].length > 0) {
      return { text: inputs[target] };
    }
    for (const key of secrets) {
      if (typeof inputs[key] === "string" && inputs[key].length > 0) {
        if (
          !target ||
          target.includes(key) ||
          key.includes(target) ||
          looksLikeSecretField(target)
        ) {
          return { text: inputs[key] };
        }
      }
    }
    // Do not fall back to step.text for declared secrets when inputs missing —
    // planner must supply via inputs; empty → NEEDS_INPUT (no invention).
    const rawSecret = typeof step.text === "string" ? step.text : "";
    if (rawSecret.length > 0 && secrets.size === 0) {
      // looksLikeSecretField but no secret_inputs list: allow explicit step.text
      return { text: rawSecret };
    }
    if (rawSecret.length > 0 && secrets.size > 0) {
      // Explicit execute-time literal on the step is allowed (host filled it);
      // model-facing observe already redacted values.
      return { text: rawSecret };
    }
    return { missing: true, reason: "secret/OTP/password literal missing" };
  }

  const raw = typeof step.text === "string" ? step.text : "";
  if (raw.length > 0) {
    return { text: raw };
  }
  if (target && typeof inputs[target] === "string" && inputs[target].length > 0) {
    return { text: inputs[target] };
  }
  return { missing: true, reason: "type text empty; refuse invented secrets" };
}

/**
 * Run Shape B (or A-with-steps) once through the action layer.
 * Wait counts toward max_actions (design recommendation).
 */
export async function runPlanOnce(
  plan: ShapeBPlan | ShapeASubtask,
  deps: PlanOnceDeps,
): Promise<PlanOnceResult> {
  const shapeB: ShapeBPlan = Array.isArray((plan as ShapeBPlan).steps)
    ? (plan as ShapeBPlan)
    : {
        summary: (plan as ShapeASubtask).goal,
        steps: (plan as ShapeASubtask).steps ?? [],
        max_actions: plan.max_actions,
        max_replans: plan.max_replans,
        inputs: plan.inputs,
        verification: plan.verification,
        constraints: plan.constraints,
        secret_inputs: plan.secret_inputs,
        allowed_risks: plan.allowed_risks,
      };

  const progress = createRunProgress(shapeB);
  const settleCfg = settleConfig(deps.settleOverrides);
  const steps = shapeB.steps ?? [];
  let stepsCompleted = 0;

  const finish = (
    status: PlanOnceTerminal | "REPLAN",
    reason: string,
    needsFrontierReplan = false,
  ): PlanOnceResult => ({
    status,
    reason,
    progress,
    needsFrontierReplan,
    allowsChatFinal: status === "DONE",
    stepsCompleted,
  });

  if (deps.isCancelled?.()) {
    return finish("BLOCKED", "user 接管 / cancel");
  }

  for (let i = 0; i < steps.length; i++) {
    if (deps.isCancelled?.()) {
      return finish("BLOCKED", "user 接管 / cancel");
    }
    if (progress.actionsUsed >= progress.maxActions) {
      return finish("BLOCKED", "max_actions exhausted before verification");
    }

    const step = steps[i];
    const snapshot = await deps.observe();

    if (deps.checkVerification?.(snapshot)) {
      return finish("DONE", "verification criteria hold");
    }

    // press / wait: no id required
    if (step.action === "press") {
      if (!step.key) {
        return finish("FAIL", "press requires key");
      }
      const identity = actionIdentity(step);
      const state = controlStateFromSnapshot(snapshot);
      const loop = checkAntiLoop(progress, identity, state);
      if (loop) {
        return finish(loop.kind as PlanOnceTerminal, loop.reason);
      }
      await deps.execute({ action: "press", key: step.key });
      progress.actionsUsed += 1;
      admit(progress, identity, state);
      await deps.settle?.(settleCfg);
      stepsCompleted += 1;
      continue;
    }

    if (step.action === "wait") {
      const identity = actionIdentity(step);
      const state = controlStateFromSnapshot(snapshot);
      const loop = checkAntiLoop(progress, identity, state);
      if (loop) {
        return finish(loop.kind as PlanOnceTerminal, loop.reason);
      }
      await deps.execute({ action: "wait" });
      progress.actionsUsed += 1;
      admit(progress, identity, state);
      await deps.settle?.(settleCfg);
      stepsCompleted += 1;
      continue;
    }

    if (step.action === "scroll") {
      const grounded =
        step.target || step.id
          ? groundStep(step, snapshot)
          : ({ ok: false, reason: "no_id_required" } as const);
      if (!grounded.ok && grounded.reason !== "no_id_required") {
        if (grounded.reason === "miss" || grounded.reason === "ambiguous") {
          const d = decideReplanOrTerminal({
            situation: grounded.reason === "miss" ? "grounding_miss" : "grounding_ambiguous",
            progress,
          });
          return finish(d.kind as PlanOnceTerminal, d.reason);
        }
      }
      const id = grounded.ok ? grounded.id : undefined;
      const identity = actionIdentity(step, id);
      const state = controlStateFromSnapshot(snapshot, id);
      const loop = checkAntiLoop(progress, identity, state);
      if (loop) {
        return finish(loop.kind as PlanOnceTerminal, loop.reason);
      }
      await deps.execute({ action: "scroll", id, direction: step.direction });
      progress.actionsUsed += 1;
      admit(progress, identity, state);
      await deps.settle?.(settleCfg);
      stepsCompleted += 1;
      continue;
    }

    // click / type require legal id — OCR enrich when a11y/DOM empty (canvas)
    let workSnapshot = snapshot;
    if (
      workSnapshot.elements.filter(isChoosable).length === 0 &&
      (step.action === "click" || step.action === "type")
    ) {
      const ocrResult = await enrichSnapshotWithOcrFallback(workSnapshot, deps.ocrFallback);
      workSnapshot = ocrResult.snapshot;
      if (workSnapshot.elements.filter(isChoosable).length === 0) {
        const d = decideReplanOrTerminal({ situation: "no_legal_actions", progress });
        return finish(d.kind as PlanOnceTerminal, d.reason);
      }
    }

    // Ground against full snapshot; risk hide is for model observe (prepareObserveForModel).
    // Execute path refuses risky controls after ground (FAIL), including iron 不代付.
    let grounded: GroundingResult = groundStep(step, workSnapshot);
    if (!grounded.ok) {
      if (grounded.reason === "coordinate_denied") {
        return finish("FAIL", grounded.detail ?? "coordinate denied");
      }
      if (
        grounded.reason === "ambiguous" &&
        grounded.candidates &&
        grounded.candidates.length > 1
      ) {
        const cheap = await tryCheapDisambiguation({
          candidates: grounded.candidates,
          step,
          snapshot: workSnapshot,
          progress,
          disambiguate: deps.disambiguate,
        });
        if (cheap) {
          grounded = cheap;
        } else {
          const d = decideReplanOrTerminal({
            situation: "grounding_ambiguous",
            progress,
          });
          return finish(d.kind as PlanOnceTerminal, d.reason);
        }
      } else if (grounded.reason === "miss" || grounded.reason === "ambiguous") {
        const d = decideReplanOrTerminal({
          situation: grounded.reason === "miss" ? "grounding_miss" : "grounding_ambiguous",
          progress,
        });
        return finish(d.kind as PlanOnceTerminal, d.reason);
      } else {
        return finish("BLOCKED", grounded.detail ?? grounded.reason);
      }
    }

    if (!grounded.ok) {
      return finish("NEEDS_AGENT", "grounding unresolved");
    }

    const label = elementLabel(grounded.element);
    if (step.action === "click") {
      const riskGate = refuseRiskyControl({
        label,
        allowed_risks: shapeB.allowed_risks,
      });
      if (riskGate.refuse) {
        const d = decideReplanOrTerminal({ situation: "policy_violation", progress });
        return finish(d.kind as PlanOnceTerminal, `${d.reason}: ${label} (${riskGate.reason})`);
      }
    }

    let typeText: string | undefined;
    if (step.action === "type") {
      const resolved = resolveTypeText(step, shapeB);
      if ("missing" in resolved) {
        // Never replan to invent secrets — NEEDS_INPUT, zero replan consume
        const d = decideReplanOrTerminal({ situation: "missing_literal", progress });
        return finish(d.kind as PlanOnceTerminal, resolved.reason);
      }
      typeText = resolved.text;
      // Payment-password submit is blocked via click policy; typing supplied literals is OK.
      // Missing secrets already returned NEEDS_INPUT above (zero replans consumed).
    }

    const identity = actionIdentity(step, grounded.id);
    const state = controlStateFromSnapshot(snapshot, grounded.id);
    const loop = checkAntiLoop(progress, identity, state);
    if (loop) {
      return finish(loop.kind as PlanOnceTerminal, loop.reason);
    }

    const beforeSig = snapshot.signature ?? "";
    if (step.action === "click") {
      await deps.execute({ action: "click", id: grounded.id });
    } else {
      await deps.execute({ action: "type", id: grounded.id, text: typeText! });
    }
    progress.actionsUsed += 1;
    admit(progress, identity, state);
    await deps.settle?.(settleCfg);

    const after = await deps.observe();
    let verified = false;
    if (step.action === "type") {
      const el = after.elements.find((e) => e.id === grounded.id);
      verified = verifyTypeValue(typeText!, el?.value);
    } else {
      const afterSig = after.signature ?? "";
      if (afterSig && beforeSig && isAmbientOnlySignatureChange(beforeSig, afterSig)) {
        verified = false;
      } else if (afterSig !== beforeSig) {
        verified = true;
      } else {
        verified = false;
      }
    }

    if (!verified) {
      progress.consecutiveUnverified += 1;
      if (progress.consecutiveUnverified >= 2) {
        const d = decideReplanOrTerminal({ situation: "two_unverified", progress });
        if (d.kind === "REPLAN") {
          progress.replansUsed += 1;
          return finish("REPLAN", d.reason, true);
        }
        return finish(d.kind as PlanOnceTerminal, d.reason);
      }
      const remaining = steps.length - i - 1;
      const d = decideReplanOrTerminal({
        situation: "verify_fail",
        progress,
        remainingPlannedSteps: remaining,
      });
      if (d.kind === "REPLAN") {
        progress.replansUsed += 1;
        return finish("REPLAN", d.reason, true);
      }
      if (d.kind === "CONTINUE") {
        stepsCompleted += 1;
        continue;
      }
      return finish(d.kind as PlanOnceTerminal, d.reason);
    }

    progress.consecutiveUnverified = 0;
    // Goal progress resets identity thrash counter for this action
    progress.actionIdentityCounts[identity] = 0;
    stepsCompleted += 1;
  }

  const finalSnap = await deps.observe();
  if (deps.checkVerification?.(finalSnap)) {
    return finish("DONE", "verification criteria hold");
  }
  if (shapeB.finishes_task && stepsCompleted === steps.length && steps.length > 0) {
    // Flag alone is not authoritative if verification provided and failed —
    // without checkVerification, treat successful step run as DONE.
    return finish("DONE", "plan steps completed (finishes_task)");
  }
  if (steps.length === 0) {
    return finish("BLOCKED", "empty step plan");
  }
  return finish("DONE", "plan steps completed");
}

function checkAntiLoop(
  progress: RunProgress,
  identity: string,
  state: string,
): PlanOnceDecision | null {
  if (progress.admitted.some((a) => a.actionKey === identity && a.controlState === state)) {
    return decideReplanOrTerminal({ situation: "anti_loop_same_action_state", progress });
  }
  const count = progress.actionIdentityCounts[identity] ?? 0;
  if (count >= 3) {
    return decideReplanOrTerminal({ situation: "anti_loop_same_action_thrice", progress });
  }
  return null;
}

function admit(progress: RunProgress, identity: string, state: string): void {
  progress.admitted.push({ actionKey: identity, controlState: state });
  progress.actionIdentityCounts[identity] = (progress.actionIdentityCounts[identity] ?? 0) + 1;
}

/**
 * Record that a frontier replan was requested. Third attempt when max_replans=2 → BLOCKED.
 */
export function noteFrontierReplan(progress: RunProgress): PlanOnceDecision {
  if (progress.replansUsed >= progress.maxReplans) {
    return decideReplanOrTerminal({
      situation: "verify_fail",
      progress,
      remainingPlannedSteps: 0,
    });
  }
  progress.replansUsed += 1;
  return { kind: "REPLAN", reason: "frontier replan admitted" };
}

/** Map a grounded execute request to the existing /act body shape (ref = snapshot id). */
export function toBrowserActBody(req: PlanOnceExecuteRequest): Record<string, unknown> {
  switch (req.action) {
    case "click":
      return { kind: "click", ref: req.id };
    case "type":
      return { kind: "type", ref: req.id, text: req.text };
    case "press":
      return { kind: "press", key: req.key };
    case "scroll":
      return req.id
        ? { kind: "scrollIntoView", ref: req.id }
        : { kind: "wait", timeMs: DEFAULT_QUIET_MS };
    case "wait":
      return { kind: "wait", timeMs: DEFAULT_QUIET_MS };
    default: {
      const _exhaustive: never = req;
      return _exhaustive;
    }
  }
}
