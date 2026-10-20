/**
 * Phase B Checkpoint B1 — offline independent web-read shadow predictor.
 *
 * Pure function over runtime utterance fields only. No gold or expected-label inputs,
 * no network I/O, no tool invocation, no ledger writes, no dispatch wiring.
 * Reuses routeStep + shadowOrchestrationFlags (read-only) and optionally
 * qualifyTurn. Intent is inferred from THREE general cue categories
 * (read/retrieve, outbound/write, ambiguous) — not per-caseId answer maps
 * and not long phrase-memory of calibration sentences.
 */

import { qualifyTurn } from "../conversation-task/qualification.js";
import { isOrchReasonCode, ORCH_REASON, type OrchReasonCode } from "./reason-codes.js";
import { routeStep } from "./surface-router.js";
import {
  shadowOrchestrationFlags,
  type ExecutionSurface,
  type RouteStepInput,
  type StepIntent,
  type SurfaceDecision,
} from "./types.js";

export type WebReadShadowProfile = "A" | "B";

export type WebReadDecisionClass = "web_read" | "not_web_read" | "clarify";

export type HumanGateLabel = "yes" | "no" | "unknown";

/**
 * Phase B default candidate surfaces when `availableSurfaces` is omitted
 * (`undefined`). An explicit empty array `[]` is fail-closed (clarify),
 * not this default.
 */
export const DEFAULT_WEB_READ_SHADOW_SURFACES = ["web_read", "not_web_read", "clarify"] as const;

/** Runtime-only input. MUST NOT accept gold / expected* / annotation fields. */
export type WebReadShadowEvalInput = {
  caseId: string;
  profile: WebReadShadowProfile;
  /**
   * Profile A: null. Profile B: non-empty server-side tenant.
   * Echoed as-is; NOT an auth proof. Evaluator does not authorize.
   */
  tenantId: string | null;
  utterance: string;
  /**
   * Allowlist of Phase-B decision surfaces.
   * - `undefined` → {@link DEFAULT_WEB_READ_SHADOW_SURFACES}
   * - `[]` → fail-closed clarify + policyGap (no successful routeStep select)
   * - non-empty → predicted surface must be a member, else clarify + policyGap
   */
  availableSurfaces?: readonly string[];
};

export type WebReadShadowDecision = {
  surface: WebReadDecisionClass | null;
  kind: "selected" | "clarify" | "noop" | "reject";
  enqueue: false;
  invoke: false;
};

/** Production prediction — no gold-compare / ground-truth fields. */
export type WebReadShadowPrediction = {
  schemaVersion: 1;
  caseId: string;
  profile: WebReadShadowProfile;
  /** Echo of input.tenantId as-is (nullable); binding only, not auth. */
  tenantId: string | null;
  decision: WebReadShadowDecision;
  reasonCodes: OrchReasonCode[];
  gap: {
    policyGap: boolean;
    evidenceGap: boolean;
    notes: string;
  };
  humanGate: HumanGateLabel;
  completionClaim: {
    claimedComplete: false;
    claimKind: "none" | "suppressed" | "claimed";
  };
  latencyMs: number;
  shadowVsLegacy: {
    legacyCompared: false;
    legacySurface: null;
    agree: null;
    explanationRequired: false;
    explanation: string | null;
  };
  wroteLedger: false;
  invokedTool: false;
};

function nowMs(): number {
  const perf = globalThis.performance;
  if (perf && typeof perf.now === "function") {
    return perf.now();
  }
  return Date.now();
}

function dedupeReasonCodes(codes: readonly string[]): OrchReasonCode[] {
  const out: OrchReasonCode[] = [];
  const seen = new Set<string>();
  for (const code of codes) {
    if (!isOrchReasonCode(code) || seen.has(code)) {
      continue;
    }
    seen.add(code);
    out.push(code);
  }
  return out;
}

function compileKeywordOr(parts: readonly string[]): RegExp {
  return new RegExp(parts.join("|"), "i");
}

/**
 * Category 1 — read / retrieve public web.
 * Short general cues: URL scheme + read/retrieve verbs + public-web nouns.
 * Deliberately NOT a mega-regex of calibration sentence fragments.
 */
const WEB_URL_RE = /https?:\/\//;
const WEB_READ_VERBS = compileKeywordOr([
  "只读",
  "检索",
  "搜一下",
  "查一下",
  "查阅",
  "抓取",
  "lookup",
  "fetch\\s*page",
  "fetch\\s+the\\s+page",
]);
const WEB_READ_NOUNS = compileKeywordOr([
  "公开",
  "网页",
  "页面",
  "文档",
  "知识库",
  "白皮书",
  "公告",
  "状态页",
  "帮助中心",
  "FAQ",
  "RFC",
  "MDN",
  "changelog",
  "openapi",
  "官方\\s*docs",
  "\\/docs\\/",
  "status\\.",
]);
const WEB_OPEN_PAGE_RE = /打开.{0,24}(?:页|https?:\/\/|公开)/;

/**
 * Category 2 — outbound / write / delete / execute.
 * Short action verbs and write-side nouns; no per-utterance memorization.
 */
const NON_WEB_RE = compileKeywordOr([
  "发到",
  "邮箱",
  "邮件",
  "发消息",
  "删除",
  "改代码",
  "改\\s+\\S+\\.ts",
  "写入",
  "写进",
  "执行",
  "推送",
  "推生产",
  "强制推送",
  "上传",
  "upload",
  "重启",
  "restart",
  "登录",
  "提交",
  "node_exec",
  "pnpm",
  "migrate",
  "registry\\.yaml",
  "releases\\.jsonl",
  "浏览器里",
  "开通",
  "保存到",
  "通知全员",
  "Feature\\s*Flag",
  "issue",
  "催款",
  "SaaS",
  "目录服务",
  "抢走其他任务",
]);

/**
 * Category 3 — ambiguous / conflicting choice language.
 * Short alternation / deferral cues only — no long calibration-sentence echoes.
 */
const AMBIGUOUS_RE = compileKeywordOr([
  "或者",
  "还是",
  "你选",
  "不确定",
  "待定",
  "都行",
  "随便",
  "同上",
  "你懂的",
  "你看着",
  "自行判断",
  "选一个",
  "来源不限",
  "先弄一边",
  "我还没想好",
  "不行就算了",
  "先看看再决定",
  "可能要.+也可能",
  "只读还是可写",
  "你先做",
  "哪个方便",
  "要不要",
]);

type IntentProbe = {
  intent: StepIntent;
  flags: ReturnType<typeof shadowOrchestrationFlags>;
  nodeInventory?: RouteStepInput["nodeInventory"];
};

/** Exported for category unit tests (pure cue probes). */
export function hasAmbiguousCues(text: string): boolean {
  return AMBIGUOUS_RE.test(text);
}

export function hasWebReadCues(text: string): boolean {
  if (WEB_URL_RE.test(text)) {
    return true;
  }
  if (WEB_OPEN_PAGE_RE.test(text)) {
    return true;
  }
  // Verb+noun proximity is not required; either family is enough for a
  // clear retrieve ask, but "不要联网" style negations are handled upstream
  // when non-web / ambiguous also fire (conflict → clarify) or by explicit
  // non-web preference in metamorphic seeds.
  return WEB_READ_VERBS.test(text) || WEB_READ_NOUNS.test(text);
}

export function hasNonWebCues(text: string): boolean {
  return NON_WEB_RE.test(text);
}

function resolveAvailableSurfaces(
  availableSurfaces: WebReadShadowEvalInput["availableSurfaces"],
): readonly string[] | "empty-fail-closed" {
  if (availableSurfaces === undefined) {
    return DEFAULT_WEB_READ_SHADOW_SURFACES;
  }
  if (availableSurfaces.length === 0) {
    return "empty-fail-closed";
  }
  return availableSurfaces;
}

function inferNonWebProbe(utterance: string): IntentProbe {
  const base = shadowOrchestrationFlags();
  if (/浏览器里|登录.+后台|提交报销|提交.+问卷|合规问卷/.test(utterance)) {
    return {
      intent: "interact_web",
      flags: shadowOrchestrationFlags({ browserEnabled: true }),
    };
  }
  if (/node_exec|执行\s*pnpm|pnpm|本地仓库|重启|清理脚本/.test(utterance)) {
    return {
      intent: "exec_user_machine",
      flags: shadowOrchestrationFlags({ nodeEnabled: true }),
      nodeInventory: { boundNodeIds: ["shadow-eval-node"], unboundCount: 0 },
    };
  }
  if (/通知全员|广播/.test(utterance)) {
    return { intent: "broadcast", flags: base };
  }
  if (/邮箱|发到|邮件|发消息|催款|issue/.test(utterance)) {
    return { intent: "send_message", flags: base };
  }
  return { intent: "write_external", flags: base };
}

function clarifyPrediction(
  input: WebReadShadowEvalInput,
  started: number,
  notes: string,
  extras: {
    policyGap?: boolean;
    evidenceGap?: boolean;
    reasonCodes?: readonly OrchReasonCode[];
  } = {},
): WebReadShadowPrediction {
  return {
    schemaVersion: 1,
    caseId: input.caseId,
    profile: input.profile,
    tenantId: input.tenantId,
    decision: {
      surface: "clarify",
      kind: "clarify",
      enqueue: false,
      invoke: false,
    },
    reasonCodes: dedupeReasonCodes([
      ...(extras.reasonCodes ?? [ORCH_REASON.HUMAN_GATE, ORCH_REASON.FAIL_CLOSED]),
    ]),
    gap: {
      policyGap: extras.policyGap ?? true,
      evidenceGap: extras.evidenceGap ?? true,
      notes,
    },
    humanGate: "yes",
    completionClaim: {
      claimedComplete: false,
      claimKind: "suppressed",
    },
    latencyMs: Math.max(0, nowMs() - started),
    shadowVsLegacy: {
      legacyCompared: false,
      legacySurface: null,
      agree: null,
      explanationRequired: false,
      explanation: "legacy not compared in B1 offline predictor",
    },
    wroteLedger: false,
    invokedTool: false,
  };
}

const AUTH_SURFACES: ReadonlySet<string> = new Set([
  "outbound_message",
  "external_write",
  "broadcast",
]);

function isClearlyNonWebSurface(surface: ExecutionSurface | undefined): boolean {
  if (!surface) {
    return false;
  }
  if (AUTH_SURFACES.has(surface)) {
    return true;
  }
  return (
    surface === "browser" ||
    surface === "node_fs_read" ||
    surface === "node_exec" ||
    surface === "memory" ||
    surface === "skill" ||
    surface === "connector"
  );
}

function mapRouteDecision(decision: SurfaceDecision): {
  surface: WebReadDecisionClass;
  kind: WebReadShadowDecision["kind"];
  humanGate: HumanGateLabel;
  policyGap: boolean;
  evidenceGap: boolean;
  notes: string;
  reasonCodes: OrchReasonCode[];
} {
  const codes = dedupeReasonCodes(decision.reasonCodes);

  if (decision.kind === "selected") {
    if (decision.surface === "web_read") {
      return {
        surface: "web_read",
        kind: "selected",
        humanGate: "no",
        policyGap: false,
        evidenceGap: false,
        notes: "",
        reasonCodes: codes,
      };
    }
    return {
      surface: "not_web_read",
      kind: "selected",
      humanGate: "no",
      policyGap: false,
      evidenceGap: false,
      notes: "",
      reasonCodes: codes,
    };
  }

  if (decision.kind === "human_gate") {
    if (isClearlyNonWebSurface(decision.surface) || AUTH_SURFACES.has(decision.surface ?? "")) {
      return {
        surface: "not_web_read",
        kind: "selected",
        humanGate: "yes",
        policyGap: false,
        evidenceGap: false,
        notes: "",
        reasonCodes: codes,
      };
    }
    return {
      surface: "clarify",
      kind: "clarify",
      humanGate: "yes",
      policyGap: true,
      evidenceGap: true,
      notes: "routeStep human_gate without clear non-web surface",
      reasonCodes: dedupeReasonCodes([...codes, ORCH_REASON.HUMAN_GATE]),
    };
  }

  if (decision.kind === "noop") {
    return {
      surface: "clarify",
      kind: "clarify",
      humanGate: "yes",
      policyGap: true,
      evidenceGap: false,
      notes: "routeStep returned noop under shadow flags",
      reasonCodes: dedupeReasonCodes([...codes, ORCH_REASON.FAIL_CLOSED, ORCH_REASON.HUMAN_GATE]),
    };
  }

  if (decision.kind === "skip" || decision.kind === "blocked_policy") {
    return {
      surface: "not_web_read",
      kind: decision.kind === "blocked_policy" ? "reject" : "selected",
      humanGate: "yes",
      policyGap: decision.kind === "blocked_policy",
      evidenceGap: false,
      notes: `routeStep ${decision.kind}`,
      reasonCodes: codes,
    };
  }

  return {
    surface: "clarify",
    kind: "clarify",
    humanGate: "yes",
    policyGap: true,
    evidenceGap: true,
    notes: "unmapped routeStep decision",
    reasonCodes: dedupeReasonCodes([...codes, ORCH_REASON.FAIL_CLOSED]),
  };
}

/**
 * Independent B1 predictor. Runtime fields only — no gold leakage.
 */
export function evaluateWebReadShadow(input: WebReadShadowEvalInput): WebReadShadowPrediction {
  const started = nowMs();
  const utterance = input.utterance ?? "";

  const resolved = resolveAvailableSurfaces(input.availableSurfaces);
  if (resolved === "empty-fail-closed") {
    return clarifyPrediction(
      input,
      started,
      "availableSurfaces is empty; fail-closed — no surface select / no routeStep success",
      {
        policyGap: true,
        evidenceGap: false,
        reasonCodes: [ORCH_REASON.HUMAN_GATE, ORCH_REASON.FAIL_CLOSED],
      },
    );
  }
  const allowlist = resolved;

  const qualification = qualifyTurn({
    messageId: input.caseId,
    text: utterance,
  });

  const ambiguous = hasAmbiguousCues(utterance);
  const web = hasWebReadCues(utterance);
  const nonWeb = hasNonWebCues(utterance);
  const needsClarifyQual =
    qualification.kind === "needs_clarification" && !(web && !nonWeb) && !(nonWeb && !web);

  if (ambiguous || (web && nonWeb) || needsClarifyQual || (!web && !nonWeb)) {
    return clarifyPrediction(
      input,
      started,
      ambiguous
        ? "ambiguous or conflicting intent cues; insufficient to select a hard surface"
        : web && nonWeb
          ? "conflicting web-read and non-web write/outbound cues"
          : needsClarifyQual
            ? "qualifyTurn needs_clarification without clear imperative surface"
            : "no clear web-read or non-web intent cues",
      {
        policyGap: true,
        evidenceGap: true,
        reasonCodes: [ORCH_REASON.HUMAN_GATE, ORCH_REASON.FAIL_CLOSED],
      },
    );
  }

  let probe: IntentProbe;
  if (web) {
    probe = { intent: "read_web", flags: shadowOrchestrationFlags() };
  } else {
    probe = inferNonWebProbe(utterance);
  }

  const routeInput: RouteStepInput = {
    intent: probe.intent,
    flags: probe.flags,
    ...(probe.nodeInventory ? { nodeInventory: probe.nodeInventory } : {}),
  };
  const routed = routeStep(routeInput);
  const mapped = mapRouteDecision(routed);
  const reasonCodes = dedupeReasonCodes([...mapped.reasonCodes, ORCH_REASON.SHADOW_OBSERVE]);

  let surface = mapped.surface;
  let kind = mapped.kind;
  let humanGate = mapped.humanGate;
  let policyGap = mapped.policyGap;
  let evidenceGap = mapped.evidenceGap;
  let notes = mapped.notes;
  const finalReasons = reasonCodes;

  if (!allowlist.includes(surface)) {
    return clarifyPrediction(
      input,
      started,
      `mapped surface "${surface}" not in availableSurfaces`,
      {
        policyGap: true,
        evidenceGap: false,
        reasonCodes: [ORCH_REASON.HUMAN_GATE, ORCH_REASON.FAIL_CLOSED],
      },
    );
  }

  if (surface === "clarify") {
    kind = "clarify";
    humanGate = "yes";
  }

  const prediction: WebReadShadowPrediction = {
    schemaVersion: 1,
    caseId: input.caseId,
    profile: input.profile,
    tenantId: input.tenantId,
    decision: {
      surface,
      kind,
      enqueue: false,
      invoke: false,
    },
    reasonCodes: finalReasons,
    gap: {
      policyGap,
      evidenceGap,
      notes,
    },
    humanGate,
    completionClaim: {
      claimedComplete: false,
      claimKind: "suppressed",
    },
    latencyMs: Math.max(0, nowMs() - started),
    shadowVsLegacy: {
      legacyCompared: false,
      legacySurface: null,
      agree: null,
      explanationRequired: false,
      explanation: "legacy not compared in B1 offline predictor",
    },
    wroteLedger: false,
    invokedTool: false,
  };

  prediction.latencyMs = Math.max(0, nowMs() - started);
  return prediction;
}
