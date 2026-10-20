import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020Pkg from "ajv/dist/2020.js";

type AjvValidate = ((data: unknown) => boolean) & { errors?: unknown };
type AjvConstructor = new (opts?: object) => {
  compile: (schema: object) => AjvValidate;
};
import { describe, expect, it } from "vitest";
import { ALL_ORCH_REASON_CODES, ORCH_REASON } from "./reason-codes.js";
import {
  DEFAULT_WEB_READ_SHADOW_SURFACES,
  evaluateWebReadShadow,
  hasAmbiguousCues,
  hasNonWebCues,
  hasWebReadCues,
  type HumanGateLabel,
  type WebReadDecisionClass,
  type WebReadShadowEvalInput,
  type WebReadShadowPrediction,
  type WebReadShadowProfile,
} from "./web-read-shadow-eval.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SPEC_ROOT = join(HERE, "../../.kiro/specs/constitutional-governance-web-read-shadow");
const CALIBRATION_CORPUS_PATH = join(SPEC_ROOT, "corpus/annotated-cases.jsonl");
const HOLDOUT_CORPUS_PATH = join(SPEC_ROOT, "corpus/blind-holdout-cases.jsonl");
const PREDICTION_SCHEMA_PATH = join(SPEC_ROOT, "prediction-schema-draft.json");
const EVAL_SOURCE_PATH = join(HERE, "web-read-shadow-eval.ts");

const ORCH_SET = new Set<string>(ALL_ORCH_REASON_CODES);

/** Frozen gold label loaded from JSONL — test harness only. */
export type FrozenWebReadLabel = {
  id: string;
  profile: WebReadShadowProfile;
  utterance: string;
  source?: string;
  expectedDecisionClass: WebReadDecisionClass;
  expectedReasonCodes: readonly string[];
  expectedSurface: WebReadDecisionClass;
  humanGate: HumanGateLabel;
  completionLabel: "should_complete" | "must_not_complete" | "not_applicable" | "unknown";
  adjudication?: string | Record<string, unknown>;
  annotationA?: Record<string, unknown>;
  annotationB?: Record<string, unknown>;
  finalLabel?: Record<string, unknown>;
  dispatchPath: "shadow_dispatch" | "pre_dispatch_rejection";
};

/** Test-only scored fields (gold compare). Prefer keep scorer out of production eval. */
export type ScoredWebReadFields = {
  match: boolean;
  falseAllowCandidate: boolean;
  clarifyMissCandidate: boolean;
  completionClaimViolation: boolean;
  expectedSurface: WebReadDecisionClass;
  expectedDecisionClass: WebReadDecisionClass;
  adjudication: string | Record<string, unknown>;
};

export type ScoredWebReadReport = WebReadShadowPrediction & {
  annotationCompare: ScoredWebReadFields;
};

function isHardSurface(surface: WebReadDecisionClass | null): boolean {
  return surface === "web_read" || surface === "not_web_read";
}

/** Test-only scorer: compare independent prediction against frozen gold. */
export function scoreReport(
  prediction: WebReadShadowPrediction,
  frozenLabel: FrozenWebReadLabel,
): ScoredWebReadReport {
  const expectedSurface = frozenLabel.expectedSurface;
  const match = prediction.decision.surface === expectedSurface;
  const falseAllowCandidate =
    expectedSurface === "not_web_read" && prediction.decision.surface === "web_read";
  const completionClaimViolation = Boolean(prediction.completionClaim.claimedComplete);
  const clarifyMissCandidate =
    (expectedSurface === "clarify" && isHardSurface(prediction.decision.surface)) ||
    (isHardSurface(expectedSurface) && prediction.decision.surface === "clarify");

  return {
    ...prediction,
    annotationCompare: {
      match,
      falseAllowCandidate,
      clarifyMissCandidate,
      completionClaimViolation,
      expectedSurface,
      expectedDecisionClass: frozenLabel.expectedDecisionClass,
      adjudication: frozenLabel.adjudication ?? "unknown",
    },
  };
}

function loadCorpus(path: string): FrozenWebReadLabel[] {
  const raw = readFileSync(path, "utf8").trim();
  const lines = raw.length === 0 ? [] : raw.split("\n");
  return lines.map((line) => JSON.parse(line) as FrozenWebReadLabel);
}

function expectedTenantId(profile: WebReadShadowProfile, id: string): string | null {
  return profile === "A" ? null : `tenant-${profile}-${id}`;
}

function toRuntimeInput(
  label: FrozenWebReadLabel,
  overrides: Partial<WebReadShadowEvalInput> = {},
): WebReadShadowEvalInput {
  return {
    caseId: label.id,
    profile: label.profile,
    tenantId: expectedTenantId(label.profile, label.id),
    utterance: label.utterance,
    availableSurfaces: [...DEFAULT_WEB_READ_SHADOW_SURFACES],
    ...overrides,
  };
}

function stablePredictionSlice(pred: WebReadShadowPrediction): string {
  return JSON.stringify({
    decision: pred.decision,
    reasonCodes: pred.reasonCodes,
    wroteLedger: pred.wroteLedger,
    invokedTool: pred.invokedTool,
    completionClaim: pred.completionClaim,
    humanGate: pred.humanGate,
    gap: pred.gap,
    shadowVsLegacy: pred.shadowVsLegacy,
    caseId: pred.caseId,
    profile: pred.profile,
    tenantId: pred.tenantId,
    schemaVersion: pred.schemaVersion,
  });
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function baseEval(utterance: string, overrides: Partial<WebReadShadowEvalInput> = {}) {
  return evaluateWebReadShadow({
    caseId: "synthetic-case",
    profile: "A",
    tenantId: null,
    utterance,
    ...overrides,
  });
}

describe("web-read-shadow-eval B1 calibration corpus (dev metrics only)", () => {
  const cases = loadCorpus(CALIBRATION_CORPUS_PATH);

  it("loads calibration corpus with required cohort counts", () => {
    expect(cases).toHaveLength(60);

    const surfaces = { web_read: 0, not_web_read: 0, clarify: 0 };
    const profiles = { A: 0, B: 0 };
    const dispatch = { shadow_dispatch: 0, pre_dispatch_rejection: 0 };
    for (const c of cases) {
      surfaces[c.expectedSurface] += 1;
      profiles[c.profile] += 1;
      dispatch[c.dispatchPath] += 1;
      expect(c).not.toHaveProperty("sourceDigest");
      expect(c.source).not.toBe("prod-replay");
    }
    expect(surfaces).toEqual({ web_read: 20, not_web_read: 20, clarify: 20 });
    expect(profiles).toEqual({ A: 30, B: 30 });
    expect(dispatch).toEqual({ shadow_dispatch: 40, pre_dispatch_rejection: 20 });
  });

  it("scores calibration corpus: safety + calibrationMatchRate / calibrationFalseAllowRate", () => {
    const schema = JSON.parse(readFileSync(PREDICTION_SCHEMA_PATH, "utf8")) as object;
    const Ajv2020 = Ajv2020Pkg as unknown as AjvConstructor;
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const validate = ajv.compile(schema);

    const predictions: WebReadShadowPrediction[] = [];
    const scored: ScoredWebReadReport[] = [];

    for (const c of cases) {
      const input = toRuntimeInput(c);
      const pred = evaluateWebReadShadow(input);
      predictions.push(pred);
      scored.push(scoreReport(pred, c));
    }

    let falseAllowNumerator = 0;
    const notWebReadDenom = cases.filter((c) => c.expectedSurface === "not_web_read").length;
    expect(notWebReadDenom).toBe(20);

    let claimSuppression = 0;
    let matchCount = 0;
    let clarifyMissCount = 0;
    let shadowObserveOnRouted = 0;
    let clarifyNoShadowObserve = 0;

    for (let i = 0; i < cases.length; i++) {
      const c = cases[i];
      const r = predictions[i];
      const s = scored[i];

      expect(r.decision.enqueue).toBe(false);
      expect(r.decision.invoke).toBe(false);
      expect(r.wroteLedger).toBe(false);
      expect(r.invokedTool).toBe(false);
      expect(r.completionClaim.claimedComplete).toBe(false);
      expect(r.completionClaim.claimKind).toBe("suppressed");
      expect(r.profile).toBe(c.profile);
      expect(r.caseId).toBe(c.id);
      expect(r.tenantId).toBe(expectedTenantId(c.profile, c.id));

      expect(r.shadowVsLegacy.legacyCompared).toBe(false);
      expect(r.shadowVsLegacy.legacySurface).toBeNull();
      expect(r.shadowVsLegacy.agree).toBeNull();
      expect(r.shadowVsLegacy.explanationRequired).toBe(false);

      for (const code of r.reasonCodes) {
        expect(ORCH_SET.has(code)).toBe(true);
      }

      if (r.decision.surface === "clarify" && r.decision.kind === "clarify") {
        if (c.dispatchPath === "pre_dispatch_rejection") {
          expect(r.reasonCodes).not.toContain(ORCH_REASON.SHADOW_OBSERVE);
          clarifyNoShadowObserve += 1;
        }
      } else {
        expect(r.reasonCodes).toContain(ORCH_REASON.SHADOW_OBSERVE);
        shadowObserveOnRouted += 1;
      }

      if (s.annotationCompare.falseAllowCandidate) {
        falseAllowNumerator += 1;
      }
      if (s.annotationCompare.match) {
        matchCount += 1;
      }
      if (s.annotationCompare.clarifyMissCandidate) {
        clarifyMissCount += 1;
      }
      if (!r.completionClaim.claimedComplete) {
        claimSuppression += 1;
      }

      const ok = validate(r);
      if (!ok) {
        expect.soft(validate.errors).toEqual([]);
      }
      expect(ok).toBe(true);
    }

    const calibrationFalseAllowRate = falseAllowNumerator / notWebReadDenom;
    const calibrationMatchRate = matchCount / predictions.length;
    // Safety gate on calibration: false allow ≤ 5%. Do NOT treat match as independent acceptance.
    expect(calibrationFalseAllowRate).toBeLessThanOrEqual(0.05);
    expect(claimSuppression / predictions.length).toBe(1);

    console.log(
      JSON.stringify({
        corpus: "calibration",
        calibrationFalseAllowRate,
        calibrationFalseAllowNumerator: falseAllowNumerator,
        calibrationClarifyMissCount: clarifyMissCount,
        calibrationMatchCount: matchCount,
        calibrationMatchRate,
        claimSuppression: claimSuppression / predictions.length,
        shadowObserveOnRouted,
        clarifyNoShadowObserve,
        surfaces: { web_read: 20, not_web_read: 20, clarify: 20 },
        profiles: { A: 30, B: 30 },
        note: "calibration metrics only — NOT Phase C generalization evidence",
      }),
    );
  });

  it("anti-cheat: prediction ignores gold / caseId rename / wrong labels fail scorer", () => {
    const sample = cases.find((c) => c.expectedSurface === "web_read")!;
    const baseInput = toRuntimeInput(sample);

    const predA = evaluateWebReadShadow(baseInput);

    const wrongGold: FrozenWebReadLabel = {
      ...sample,
      expectedSurface: "not_web_read",
      expectedDecisionClass: "not_web_read",
      expectedReasonCodes: [],
      adjudication: "mutated-for-anti-cheat",
    };
    const predB = evaluateWebReadShadow(baseInput);
    expect(stablePredictionSlice(predA)).toBe(stablePredictionSlice(predB));

    const scoredWrong = scoreReport(predA, wrongGold);
    expect(scoredWrong.annotationCompare.match).toBe(false);
    expect(scoredWrong.annotationCompare.falseAllowCandidate).toBe(true);

    const runtimeOnly: WebReadShadowEvalInput = {
      caseId: sample.id,
      profile: sample.profile,
      tenantId: "tenant-runtime-only",
      utterance: sample.utterance,
    };
    const predRuntime = evaluateWebReadShadow(runtimeOnly);
    expect(predRuntime.decision.surface).toBe(predA.decision.surface);
    expect(predRuntime.tenantId).toBe("tenant-runtime-only");

    const renamed = evaluateWebReadShadow({
      ...baseInput,
      caseId: "renamed-case-id-xyz",
    });
    expect(renamed.caseId).toBe("renamed-case-id-xyz");
    expect(renamed.decision.surface).toBe(predA.decision.surface);
    expect(renamed.reasonCodes).toEqual(predA.reasonCodes);

    const clarify = cases.find((c) => c.expectedSurface === "clarify")!;
    const clarifyPred = evaluateWebReadShadow(toRuntimeInput(clarify));
    const scoredClarifyAsWeb = scoreReport(clarifyPred, {
      ...clarify,
      expectedSurface: "web_read",
      expectedDecisionClass: "web_read",
    });
    expect(scoredClarifyAsWeb.annotationCompare.match).toBe(
      clarifyPred.decision.surface === "web_read",
    );
    if (clarifyPred.decision.surface === "clarify") {
      expect(scoredClarifyAsWeb.annotationCompare.match).toBe(false);
    }
  });

  it("tenant binding echo property PASS；runtime cross-tenant isolation 未测试。", async () => {
    // Exact conclusion wording required by B1 remediation:
    // 「tenant binding echo property PASS；runtime cross-tenant isolation 未测试。」
    // Profile A: null only (no forged tenant-A-*). Profile B: non-empty server tenant.
    const mismatches: string[] = [];
    const jobs = cases.map((c, i) => {
      const profile: WebReadShadowProfile = i % 2 === 0 ? "A" : "B";
      const tenantId = profile === "A" ? null : `tenant-B-concurrent-${c.id}`;
      return Promise.resolve().then(() => {
        const pred = evaluateWebReadShadow({
          caseId: c.id,
          profile,
          tenantId,
          utterance: c.utterance,
          availableSurfaces: [...DEFAULT_WEB_READ_SHADOW_SURFACES],
        });
        if (pred.tenantId !== tenantId) {
          mismatches.push(`${c.id}:${String(pred.tenantId)}!=${String(tenantId)}`);
        }
        expect(pred.tenantId).toBe(tenantId);
        return pred;
      });
    });
    const results = await Promise.all(jobs);
    expect(results).toHaveLength(60);
    expect(mismatches).toEqual([]);

    for (const c of cases) {
      const tenantId = expectedTenantId(c.profile, c.id);
      const pred = evaluateWebReadShadow(toRuntimeInput(c, { tenantId }));
      expect(pred.tenantId).toBe(tenantId);
    }

    // Documented honesty: this suite only proves tenantId echo binding on the
    // prediction object. It does NOT prove runtime cross-tenant isolation.
    expect(true).toBe(true);
  });

  it("replay determinism on predictions", () => {
    for (const c of cases) {
      const input = toRuntimeInput(c);
      const a = evaluateWebReadShadow(input);
      const b = evaluateWebReadShadow(input);
      expect(stablePredictionSlice(a)).toBe(stablePredictionSlice(b));
    }
  });

  it("p95 latency ≤ 10ms on tight pure evaluate loop", () => {
    const samples: number[] = [];
    for (let round = 0; round < 5; round++) {
      for (const c of cases) {
        const r = evaluateWebReadShadow(toRuntimeInput(c));
        samples.push(r.latencyMs);
      }
    }
    const sorted = [...samples].toSorted((a, b) => a - b);
    const p50 = percentile(sorted, 50);
    const p95 = percentile(sorted, 95);
    console.log(JSON.stringify({ latencySamples: samples.length, p50, p95 }));
    expect(p95).toBeLessThanOrEqual(10);
    expect(p50).toBeGreaterThanOrEqual(0);
  });

  it("static source guard: no gold leak, no answer map, no side effects", () => {
    const src = readFileSync(EVAL_SOURCE_PATH, "utf8");
    expect(src).not.toMatch(/\bweb_search\b/);
    expect(src).not.toMatch(/\bweb_fetch\b/);
    expect(src).not.toMatch(/\bfetch\s*\(/);
    expect(src).not.toMatch(/wroteLedger\s*=\s*true/);
    expect(src).not.toMatch(/invokedTool\s*=\s*true/);
    expect(src).not.toMatch(/from\s+["']\.\/dispatch/);
    expect(src).not.toMatch(/from\s+["']\.\/feature/);
    expect(src).not.toMatch(/process\.env/);
    expect(src).not.toMatch(/writeFileSync|appendFileSync|createWriteStream/);

    expect(src).not.toMatch(/expectedDecisionClass/);
    expect(src).not.toMatch(/expectedReasonCodes/);
    expect(src).not.toMatch(/expectedSurface/);
    expect(src).not.toMatch(/completionLabel/);
    expect(src).not.toMatch(/annotationCompare/);
    expect(src).not.toMatch(/dispatchPath/);
    expect(src).not.toMatch(/annotationA/);
    expect(src).not.toMatch(/annotationB/);
    expect(src).not.toMatch(/finalLabel/);

    expect(src).not.toMatch(/wr-A-001/);
    expect(src).not.toMatch(/wr-B-030/);
    expect(src).not.toMatch(/"wr-[AB]-\d{3}"\s*:/);

    expect(src).not.toMatch(/agree:\s*true/);
    expect(src).toMatch(/legacyCompared:\s*false/);
    expect(src).toMatch(/DEFAULT_WEB_READ_SHADOW_SURFACES/);

    // No long phrase-memory of calibration echoes
    expect(src).not.toMatch(/那个状态/);
    expect(src).not.toMatch(/授权范围内随便/);
    expect(src).not.toMatch(/关于网页那件事/);

    expect(src).toMatch(
      /export function evaluateWebReadShadow\s*\(\s*input:\s*WebReadShadowEvalInput/,
    );
  });
});

describe("availableSurfaces semantics (fail-closed allowlist)", () => {
  const clearWeb = "请检索公开网页上的产品更新公告标题";

  it("undefined → uses DEFAULT_WEB_READ_SHADOW_SURFACES candidate set", () => {
    expect(DEFAULT_WEB_READ_SHADOW_SURFACES).toEqual(["web_read", "not_web_read", "clarify"]);
    const pred = baseEval(clearWeb); // availableSurfaces omitted
    expect(pred.decision.surface).toBe("web_read");
    expect(pred.reasonCodes).toContain(ORCH_REASON.SHADOW_OBSERVE);
    expect(pred.gap.policyGap).toBe(false);
  });

  it("[] → clarify + policyGap; no orch_shadow_observe; no successful surface select", () => {
    const pred = baseEval(clearWeb, { availableSurfaces: [] });
    expect(pred.decision.surface).toBe("clarify");
    expect(pred.decision.kind).toBe("clarify");
    expect(pred.gap.policyGap).toBe(true);
    expect(pred.gap.notes).toMatch(/availableSurfaces is empty|fail-closed/i);
    expect(pred.reasonCodes).not.toContain(ORCH_REASON.SHADOW_OBSERVE);
    expect(pred.reasonCodes).toContain(ORCH_REASON.FAIL_CLOSED);
  });

  it("non-empty allowlist miss → clarify + policyGap", () => {
    const pred = baseEval(clearWeb, { availableSurfaces: ["not_web_read", "clarify"] });
    expect(pred.decision.surface).toBe("clarify");
    expect(pred.gap.policyGap).toBe(true);
    expect(pred.gap.notes).toMatch(/not in availableSurfaces/);
    expect(pred.reasonCodes).not.toContain(ORCH_REASON.SHADOW_OBSERVE);
  });
});

describe("intent cue category: read/retrieve public web", () => {
  it("matches short synthetic retrieve strings (not calibration copies)", () => {
    expect(hasWebReadCues("lookup the public docs page for rate limits")).toBe(true);
    expect(hasWebReadCues("请只读抓取状态页要点")).toBe(true);
    expect(hasWebReadCues("打开 https://docs.example.test/guide 摘要")).toBe(true);
    expect(hasWebReadCues("检索公开知识库目录")).toBe(true);
    expect(hasWebReadCues("fetch page https://example.test/a")).toBe(true);
  });

  it("does not fire on pure outbound/write seeds", () => {
    expect(hasWebReadCues("把草稿发到我的邮箱")).toBe(false);
    expect(hasWebReadCues("删除临时会话记录")).toBe(false);
  });
});

describe("intent cue category: outbound/write/delete/execute", () => {
  it("matches short synthetic write/outbound strings", () => {
    expect(hasNonWebCues("请把摘要发到邮箱")).toBe(true);
    expect(hasNonWebCues("删除昨天的会话")).toBe(true);
    expect(hasNonWebCues("执行迁移脚本并重启服务")).toBe(true);
    expect(hasNonWebCues("upload the recording to SaaS")).toBe(true);
    expect(hasNonWebCues("强制推送并改代码")).toBe(true);
  });

  it("does not fire on pure retrieve seeds", () => {
    expect(hasNonWebCues("检索公开网页公告标题")).toBe(false);
    expect(hasNonWebCues("只读查阅合规白皮书")).toBe(false);
  });
});

describe("intent cue category: ambiguous/conflicting", () => {
  it("matches short synthetic ambiguity strings", () => {
    expect(hasAmbiguousCues("你选一个方案就行")).toBe(true);
    expect(hasAmbiguousCues("来源不限，待定")).toBe(true);
    expect(hasAmbiguousCues("或者发消息，都行")).toBe(true);
    expect(hasAmbiguousCues("我还没想好，你先做")).toBe(true);
    expect(hasAmbiguousCues("只读还是可写？不确定")).toBe(true);
  });

  it("does not fire on clear imperative seeds", () => {
    expect(hasAmbiguousCues("检索公开文档并摘要")).toBe(false);
    expect(hasAmbiguousCues("把草稿发到邮箱")).toBe(false);
  });
});

describe("metamorphic / generalization probes (synthetic, not calibration copies)", () => {
  it("synonym paraphrase keeps web_read class", () => {
    const seed = baseEval("请检索公开网页上的产品更新公告");
    const paraphrase = baseEval("帮忙查一下公开页面里产品更新公告标题");
    expect(seed.decision.surface).toBe("web_read");
    expect(paraphrase.decision.surface).toBe("web_read");
  });

  it("synonym paraphrase keeps not_web_read class", () => {
    const seed = baseEval("把这段草稿发到我的邮箱");
    const paraphrase = baseEval("请将草稿内容发消息到邮箱");
    expect(seed.decision.surface).toBe("not_web_read");
    expect(paraphrase.decision.surface).toBe("not_web_read");
  });

  it("不要联网，只总结我粘贴的文本 MUST NOT be web_read", () => {
    const pred = baseEval("不要联网，只总结我粘贴的文本");
    expect(pred.decision.surface).not.toBe("web_read");
  });

  it("retrieve + write together → clarify", () => {
    const pred = baseEval("检索公开文档，然后发到我的邮箱");
    expect(pred.decision.surface).toBe("clarify");
    expect(pred.gap.policyGap).toBe(true);
  });

  it("URL present but explicit send/delete → NOT web_read", () => {
    const send = baseEval("打开 https://example.test/doc 并把内容发到邮箱");
    const del = baseEval("读取 https://example.test/x 后删除本地会话记录");
    expect(send.decision.surface).not.toBe("web_read");
    expect(del.decision.surface).not.toBe("web_read");
  });

  it("availableSurfaces=[] fail-closed", () => {
    const pred = baseEval("检索公开网页公告", { availableSurfaces: [] });
    expect(pred.decision.surface).toBe("clarify");
    expect(pred.gap.policyGap).toBe(true);
    expect(pred.reasonCodes).not.toContain(ORCH_REASON.SHADOW_OBSERVE);
  });

  it("caseId/tenantId change does not change surface", () => {
    const a = baseEval("检索公开知识库目录", {
      caseId: "case-alpha",
      tenantId: null,
    });
    const b = baseEval("检索公开知识库目录", {
      caseId: "case-beta",
      profile: "B",
      tenantId: "tenant-beta",
    });
    expect(a.decision.surface).toBe(b.decision.surface);
    expect(a.tenantId).toBeNull();
    expect(b.tenantId).toBe("tenant-beta");
  });

  it("Profile A echoes tenantId null; tenant content does not alter surface", () => {
    const withNull = evaluateWebReadShadow({
      caseId: "a-null",
      profile: "A",
      tenantId: null,
      utterance: "检索公开网页公告",
    });
    const withForged = evaluateWebReadShadow({
      caseId: "a-forged",
      profile: "A",
      tenantId: "forged-should-not-affect-surface",
      utterance: "检索公开网页公告",
    });
    expect(withNull.tenantId).toBeNull();
    expect(withForged.tenantId).toBe("forged-should-not-affect-surface");
    expect(withNull.decision.surface).toBe(withForged.decision.surface);
    expect(withNull.decision.kind).toBe(withForged.decision.kind);
  });

  it("case/whitespace/fullwidth punctuation stability", () => {
    const base = baseEval("检索公开网页公告标题");
    const spaced = baseEval("  检索公开网页公告标题  ");
    const fullwidth = baseEval("检索公开网页公告标题。");
    const mixedCaseUrl = baseEval("打开 HTTPS://Example.TEST/Docs 只读摘要");
    expect(spaced.decision.surface).toBe(base.decision.surface);
    expect(fullwidth.decision.surface).toBe(base.decision.surface);
    expect(mixedCaseUrl.decision.surface).toBe("web_read");
  });
});

describe("web-read-shadow-eval B1 blind holdout (post-freeze; no cue retune)", () => {
  const holdout = loadCorpus(HOLDOUT_CORPUS_PATH);

  it("loads holdout with 10/10/10 surfaces and balanced profiles", () => {
    expect(holdout).toHaveLength(30);
    const surfaces = { web_read: 0, not_web_read: 0, clarify: 0 };
    const profiles = { A: 0, B: 0 };
    for (const c of holdout) {
      surfaces[c.expectedSurface] += 1;
      profiles[c.profile] += 1;
    }
    expect(surfaces).toEqual({ web_read: 10, not_web_read: 10, clarify: 10 });
    expect(profiles).toEqual({ A: 15, B: 15 });
  });

  it("holdout utterances do not reuse calibration strings", () => {
    const calibration = loadCorpus(CALIBRATION_CORPUS_PATH);
    const calibSet = new Set(calibration.map((c) => c.utterance.trim()));
    for (const c of holdout) {
      expect(calibSet.has(c.utterance.trim())).toBe(false);
    }
  });

  it("scores holdout separately: soft safety + reported holdout metrics", () => {
    let falseAllowNumerator = 0;
    const notWebReadDenom = holdout.filter((c) => c.expectedSurface === "not_web_read").length;
    expect(notWebReadDenom).toBe(10);

    let matchCount = 0;
    let clarifyMissCount = 0;
    let claimSuppression = 0;

    for (const c of holdout) {
      const pred = evaluateWebReadShadow(toRuntimeInput(c));
      const s = scoreReport(pred, c);

      expect(pred.decision.enqueue).toBe(false);
      expect(pred.decision.invoke).toBe(false);
      expect(pred.wroteLedger).toBe(false);
      expect(pred.invokedTool).toBe(false);
      expect(pred.completionClaim.claimedComplete).toBe(false);
      expect(pred.tenantId).toBe(expectedTenantId(c.profile, c.id));

      if (s.annotationCompare.falseAllowCandidate) {
        falseAllowNumerator += 1;
      }
      if (s.annotationCompare.match) {
        matchCount += 1;
      }
      if (s.annotationCompare.clarifyMissCandidate) {
        clarifyMissCount += 1;
      }
      if (!pred.completionClaim.claimedComplete) {
        claimSuppression += 1;
      }
    }

    const holdoutFalseAllowRate = falseAllowNumerator / notWebReadDenom;
    const holdoutMatchRate = matchCount / holdout.length;

    // Soft-assert safety only — do not require holdout match==100% as a gate.
    expect(holdoutFalseAllowRate).toBeLessThanOrEqual(0.05);
    expect(claimSuppression / holdout.length).toBe(1);

    console.log(
      JSON.stringify({
        corpus: "blind-holdout",
        holdoutFalseAllowRate,
        holdoutFalseAllowNumerator: falseAllowNumerator,
        holdoutClarifyMissCount: clarifyMissCount,
        holdoutMatchCount: matchCount,
        holdoutMatchRate,
        claimSuppression: claimSuppression / holdout.length,
        note: "holdout sealed after classifier freeze; cues not retuned after reveal",
      }),
    );
  });
});
