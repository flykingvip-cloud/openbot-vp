import { describe, expect, it } from "vitest";
import { BLIND_SAMPLES } from "./blind-dataset.js";
import type { SampleCategory } from "./dataset.js";
import { evaluateDataset } from "./metrics.js";
import { evaluateTurn } from "./replay.js";
import { QUALIFICATION_KINDS, SIDE_EFFECT_CLASSES } from "./types.js";

function countCategory(...categories: SampleCategory[]): number {
  return BLIND_SAMPLES.filter((s) => categories.includes(s.category)).length;
}

describe("blind dataset composition (independent, spec-labelled)", () => {
  it("has at least 150 samples", () => {
    expect(BLIND_SAMPLES.length).toBeGreaterThanOrEqual(150);
  });

  it("has at least 30 L2 positives", () => {
    expect(countCategory("long_running")).toBeGreaterThanOrEqual(30);
  });

  it("has at least 30 Reminder/Scheduled negatives", () => {
    expect(countCategory("reminder", "scheduled_action")).toBeGreaterThanOrEqual(30);
  });

  it("has at least 40 Wait/Revision/Side-effect fuzzy samples", () => {
    expect(
      countCategory("wait_no_escalation", "revision_intent", "side_effect_authorization"),
    ).toBeGreaterThanOrEqual(40);
  });

  it("includes context ellipsis / colloquial / cross-turn phrasing", () => {
    const crossTurn = BLIND_SAMPLES.filter((s) => (s.input.priorTurns?.length ?? 0) > 0);
    expect(crossTurn.length).toBeGreaterThanOrEqual(10);
    const colloquial = BLIND_SAMPLES.filter((s) =>
      /呗|啊|啦|瞅|盯盯|吱|上点心|风吹草动|刷刷/.test(s.input.text),
    );
    expect(colloquial.length).toBeGreaterThanOrEqual(8);
  });

  it("uses valid labels and marks true L2 as surviving", () => {
    const ids = BLIND_SAMPLES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of BLIND_SAMPLES) {
      expect(QUALIFICATION_KINDS).toContain(s.goldQualification);
      expect(SIDE_EFFECT_CLASSES).toContain(s.goldSideEffect);
      if (s.goldQualification === "long_running_candidate") {
        expect(s.goldSurvivesFirstRound).toBe(true);
      }
    }
  });
});

describe("blind evaluation — hard requirement is precision, recall is reported", () => {
  const report = evaluateDataset(BLIND_SAMPLES);

  it("keeps Upgrade Precision >= 95% on the blind set", () => {
    expect(report.upgradePrecision).toBeGreaterThanOrEqual(0.95);
  });

  it("never upgrades a non-L2 sample to long_running_candidate", () => {
    const falseUpgrades = BLIND_SAMPLES.filter(
      (s) =>
        evaluateTurn(s.input).qualification.kind === "long_running_candidate" &&
        s.goldQualification !== "long_running_candidate",
    );
    expect(falseUpgrades.map((s) => s.id)).toEqual([]);
  });

  it("keeps detection precision high (>= 0.95)", () => {
    expect(report.detection.precision).toBeGreaterThanOrEqual(0.95);
  });

  // Recall is intentionally allowed to be lower on the harder blind set; we only
  // assert it is reported, not that it clears a bar.
  it("reports recall and per-class metrics without asserting a recall floor", () => {
    expect(report.upgradeRecall).toBeGreaterThan(0);
    expect(report.perClass.long_running_candidate.support).toBeGreaterThanOrEqual(30);
  });
});
