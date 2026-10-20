import { describe, expect, it } from "vitest";
import { sampleSourceSnapshot } from "../fixtures.js";
import { CONSTITUTIONAL_SHADOW_ENV } from "../flags.js";
import {
  CONSTITUTIONAL_DECLARED_PATH_V1,
  LEGAL_PATH_SELECT_ENV,
  PHASE_D_RUNTIME_FACADE_SCOPE,
  SHADOW_COMPARE_ENV,
  runRuntimeFacadeShadow,
} from "../index.js";
import { projectConstitutionalViewFromSources } from "../read-model/ledger-view.js";

const SHADOW_ENV = { [CONSTITUTIONAL_SHADOW_ENV]: "true" } as const;
const SELECT_ENV = { [LEGAL_PATH_SELECT_ENV]: "true" } as const;
const DUAL_ENV = {
  [CONSTITUTIONAL_SHADOW_ENV]: "true",
  [LEGAL_PATH_SELECT_ENV]: "true",
} as const;
const COMPARE_ENV = { [SHADOW_COMPARE_ENV]: "true" } as const;
const SHADOW_COMPARE_ENV_DUAL = {
  [CONSTITUTIONAL_SHADOW_ENV]: "true",
  [SHADOW_COMPARE_ENV]: "true",
} as const;

function expectInertDiagnostics(result: ReturnType<typeof runRuntimeFacadeShadow>): void {
  expect(result.selectEnabled).toBe(false);
  expect(result.effectiveLegalPathIds).toEqual([]);
  expect(result.candidatePresent).toBe(false);
  expect(result.candidateAccepted).toBe(false);
  expect(result.selectMessage).toBe("");
}

describe("runtime façade shadow", () => {
  it("stays inert by default and does not read process.env", () => {
    const previousShadow = process.env[CONSTITUTIONAL_SHADOW_ENV];
    const previousSelect = process.env[LEGAL_PATH_SELECT_ENV];
    process.env[CONSTITUTIONAL_SHADOW_ENV] = "true";
    process.env[LEGAL_PATH_SELECT_ENV] = "true";
    try {
      const view = projectConstitutionalViewFromSources(sampleSourceSnapshot);
      const before = JSON.stringify(view);
      const result = runRuntimeFacadeShadow(
        {
          view,
          sources: {
            validationReceipts: [
              {
                taskId: " ",
                artifactHash: "x",
                validatorId: "v",
                timestamp: "t",
                result: "passed",
              },
            ],
          },
        },
        {
          enforce: true,
          select: true,
          candidatePath: CONSTITUTIONAL_DECLARED_PATH_V1,
          workflowRef: "lobster",
        },
      );
      expect(JSON.stringify(view)).toBe(before);
      expect(result.scope).toBe(PHASE_D_RUNTIME_FACADE_SCOPE);
      expect(result.mode).toBe("inert");
      expect(result.invoked).toBe(false);
      expect(result.report).toBeNull();
      expect(result.selectedPath).toBeNull();
      expect(result.candidatePathDiscarded).toBe(false);
      expect(result.executed).toBe(false);
      expect(result.blocked).toBe(false);
      expect(result.wroteLedger).toBe(false);
      expect(result.sideEffects).toEqual([]);
      expect(result.enforce).toBe(false);
      expect(result.enforced).toBe(false);
      expect(result.liveInvoke).toBe(false);
      expect(result.fabricDefaultOn).toBe(false);
      expect(result.legalPathSelectable).toBe(false);
      expectInertDiagnostics(result);
      expect(result.shadowCompared).toBe(false);
      expect(result.readyToTighten).toBe(false);
      expect(result.paintedAliasUsedAsPath).toBe(false);
      expect(result.mutated).toBe(false);
    } finally {
      if (previousShadow === undefined) {
        delete process.env[CONSTITUTIONAL_SHADOW_ENV];
      } else {
        process.env[CONSTITUTIONAL_SHADOW_ENV] = previousShadow;
      }
      if (previousSelect === undefined) {
        delete process.env[LEGAL_PATH_SELECT_ENV];
      } else {
        process.env[LEGAL_PATH_SELECT_ENV] = previousSelect;
      }
    }
  });

  it("returns a shadow report when the caller opts in, and still does not enforce or select", () => {
    const view = projectConstitutionalViewFromSources(sampleSourceSnapshot);
    const before = JSON.stringify(view);
    const result = runRuntimeFacadeShadow(
      { view },
      { shadow: true, enforce: true, candidatePath: "web_read", workflowRef: "lobster" },
    );
    expect(JSON.stringify(view)).toBe(before);
    expect(result.mode).toBe("shadow");
    expect(result.invoked).toBe(true);
    expect(result.report?.mode).toBe("shadow");
    expect(result.report?.findings.map((item) => item.code)).toEqual(["enforce_requested_ignored"]);
    expect(result.report?.enforce).toBe(false);
    expect(result.report?.enforced).toBe(false);
    expect(result.report?.liveInvoke).toBe(false);
    expect(result.report?.fabricDefaultOn).toBe(false);
    expect(result.enforce).toBe(false);
    expect(result.enforced).toBe(false);
    expect(result.liveInvoke).toBe(false);
    expect(result.fabricDefaultOn).toBe(false);
    expect(result.selectedPath).toBeNull();
    expect(result.candidatePathDiscarded).toBe(true);
    expect(result.legalPathSelectable).toBe(false);
    expectInertDiagnostics(result);
    expect(result.shadowCompared).toBe(false);
    expect(result.readyToTighten).toBe(false);
    expect(result.paintedAliasUsedAsPath).toBe(false);
    expect(result.executed).toBe(false);
    expect(result.blocked).toBe(false);
    expect(result.wroteLedger).toBe(false);
    expect(result.mutated).toBe(false);
  });

  it("honors a caller env snapshot and ignores a false snapshot", () => {
    const enabled = runRuntimeFacadeShadow({ sources: sampleSourceSnapshot }, { env: SHADOW_ENV });
    expect(enabled.invoked).toBe(true);
    expect(enabled.report?.counts.evidence).toBeGreaterThan(0);
    expect(enabled.report?.findings).toEqual([]);
    expect(enabled.selectedPath).toBeNull();
    expect(enabled.legalPathSelectable).toBe(false);
    expectInertDiagnostics(enabled);
    expect(enabled.executed).toBe(false);

    const disabled = runRuntimeFacadeShadow(
      { sources: sampleSourceSnapshot },
      { env: { [CONSTITUTIONAL_SHADOW_ENV]: "false" }, shadow: false },
    );
    expect(disabled.invoked).toBe(false);
    expect(disabled.report).toBeNull();
    expectInertDiagnostics(disabled);
  });

  it("does not select when only legal-path select is opted in without shadow", () => {
    const result = runRuntimeFacadeShadow(
      { sources: sampleSourceSnapshot },
      {
        select: true,
        env: SELECT_ENV,
        candidatePath: CONSTITUTIONAL_DECLARED_PATH_V1,
      },
    );
    expect(result.mode).toBe("inert");
    expect(result.invoked).toBe(false);
    expect(result.selectedPath).toBeNull();
    expect(result.legalPathSelectable).toBe(false);
    expectInertDiagnostics(result);
    expect(result.executed).toBe(false);
  });

  it("surfaces Knife1 selectedPath and diagnostics under dual opt-in and never executes", () => {
    const view = projectConstitutionalViewFromSources(sampleSourceSnapshot);
    const before = JSON.stringify(view);
    const result = runRuntimeFacadeShadow(
      { view },
      {
        shadow: true,
        select: true,
        candidatePath: CONSTITUTIONAL_DECLARED_PATH_V1,
        workflowRef: "lobster",
      },
    );
    expect(JSON.stringify(view)).toBe(before);
    expect(result.mode).toBe("shadow");
    expect(result.invoked).toBe(true);
    expect(result.selectedPath).toBe(CONSTITUTIONAL_DECLARED_PATH_V1);
    expect(result.legalPathSelectable).toBe(true);
    expect(result.candidatePathDiscarded).toBe(true); // workflow painted alias discarded
    expect(result.paintedAliasUsedAsPath).toBe(false);
    expect(result.selectEnabled).toBe(true);
    expect(result.effectiveLegalPathIds).toEqual([CONSTITUTIONAL_DECLARED_PATH_V1]);
    expect(result.candidatePresent).toBe(true);
    expect(result.candidateAccepted).toBe(true);
    expect(result.selectMessage).toContain("selected without executing");
    expect(result.executed).toBe(false);
    expect(result.sideEffects).toEqual([]);
    expect(result.readyToTighten).toBe(false);
    expect(result.shadowCompared).toBe(false);
    expect(result.enforce).toBe(false);
    expect(result.enforced).toBe(false);
    expect(result.liveInvoke).toBe(false);
    expect(result.fabricDefaultOn).toBe(false);
    expect(result.blocked).toBe(false);
    expect(result.wroteLedger).toBe(false);
    expect(result.mutated).toBe(false);
  });

  it("honors dual env snapshot for select report bridge and diagnostics", () => {
    const result = runRuntimeFacadeShadow(
      { sources: sampleSourceSnapshot },
      {
        env: DUAL_ENV,
        candidatePath: CONSTITUTIONAL_DECLARED_PATH_V1,
      },
    );
    expect(result.invoked).toBe(true);
    expect(result.selectedPath).toBe(CONSTITUTIONAL_DECLARED_PATH_V1);
    expect(result.legalPathSelectable).toBe(true);
    expect(result.candidatePathDiscarded).toBe(false);
    expect(result.selectEnabled).toBe(true);
    expect(result.effectiveLegalPathIds).toEqual([CONSTITUTIONAL_DECLARED_PATH_V1]);
    expect(result.candidatePresent).toBe(true);
    expect(result.candidateAccepted).toBe(true);
    expect(result.selectMessage.length).toBeGreaterThan(0);
    expect(result.executed).toBe(false);
  });

  it("rejects painted aliases and undeclared candidates with observable diagnostics", () => {
    const painted = runRuntimeFacadeShadow(
      { sources: sampleSourceSnapshot },
      {
        shadow: true,
        select: true,
        candidatePath: "lobster",
        workflowRef: "lobster-flow",
      },
    );
    expect(painted.invoked).toBe(true);
    expect(painted.selectedPath).toBeNull();
    expect(painted.legalPathSelectable).toBe(true);
    expect(painted.candidatePathDiscarded).toBe(true);
    expect(painted.paintedAliasUsedAsPath).toBe(false);
    expect(painted.selectEnabled).toBe(true);
    expect(painted.effectiveLegalPathIds).toEqual([CONSTITUTIONAL_DECLARED_PATH_V1]);
    expect(painted.candidatePresent).toBe(true);
    expect(painted.candidateAccepted).toBe(false);
    expect(painted.selectMessage).toContain("outside the declared legal Path set");
    expect(painted.executed).toBe(false);

    const undeclared = runRuntimeFacadeShadow(
      { sources: sampleSourceSnapshot },
      {
        env: DUAL_ENV,
        candidatePath: "web_read",
      },
    );
    expect(undeclared.selectedPath).toBeNull();
    expect(undeclared.legalPathSelectable).toBe(true);
    expect(undeclared.candidatePathDiscarded).toBe(true);
    expect(undeclared.selectEnabled).toBe(true);
    expect(undeclared.effectiveLegalPathIds).toEqual([CONSTITUTIONAL_DECLARED_PATH_V1]);
    expect(undeclared.candidatePresent).toBe(true);
    expect(undeclared.candidateAccepted).toBe(false);
    expect(undeclared.selectMessage.length).toBeGreaterThan(0);
    expect(undeclared.executed).toBe(false);
  });

  it("surfaces no-candidate diagnostics under dual opt-in without selecting", () => {
    const result = runRuntimeFacadeShadow(
      { sources: sampleSourceSnapshot },
      {
        shadow: true,
        select: true,
      },
    );
    expect(result.invoked).toBe(true);
    expect(result.selectedPath).toBeNull();
    expect(result.legalPathSelectable).toBe(true);
    expect(result.selectEnabled).toBe(true);
    expect(result.effectiveLegalPathIds).toEqual([CONSTITUTIONAL_DECLARED_PATH_V1]);
    expect(result.candidatePresent).toBe(false);
    expect(result.candidateAccepted).toBe(false);
    expect(result.selectMessage).toContain("no candidate Path");
    expect(result.executed).toBe(false);
    expect(result.readyToTighten).toBe(false);
  });

  it("rolls back to #60 face when select flag is off under shadow", () => {
    const result = runRuntimeFacadeShadow(
      { sources: sampleSourceSnapshot },
      {
        shadow: true,
        env: { [LEGAL_PATH_SELECT_ENV]: "false" },
        candidatePath: CONSTITUTIONAL_DECLARED_PATH_V1,
      },
    );
    expect(result.invoked).toBe(true);
    expect(result.selectedPath).toBeNull();
    expect(result.legalPathSelectable).toBe(false);
    expect(result.candidatePathDiscarded).toBe(true);
    expectInertDiagnostics(result);
    expect(result.executed).toBe(false);
    expect(result.readyToTighten).toBe(false);
  });

  it("keeps shadowCompared false when only SHADOW is on (no COMPARE)", () => {
    const result = runRuntimeFacadeShadow(
      { sources: sampleSourceSnapshot },
      {
        shadow: true,
        legacyDecision: CONSTITUTIONAL_DECLARED_PATH_V1,
        constitutionalDecision: CONSTITUTIONAL_DECLARED_PATH_V1,
      },
    );
    expect(result.invoked).toBe(true);
    expect(result.shadowCompared).toBe(false);
    expect(result.compareMatch).toBeNull();
    expect(result.readyToTighten).toBe(false);
    expect(result.executed).toBe(false);
  });

  it("sets shadowCompared under SHADOW∧COMPARE with enough snapshots and never tightens", () => {
    const result = runRuntimeFacadeShadow(
      { sources: sampleSourceSnapshot },
      {
        shadow: true,
        compare: true,
        select: true,
        candidatePath: CONSTITUTIONAL_DECLARED_PATH_V1,
        legacyPathRef: CONSTITUTIONAL_DECLARED_PATH_V1,
      },
    );
    expect(result.invoked).toBe(true);
    expect(result.selectedPath).toBe(CONSTITUTIONAL_DECLARED_PATH_V1);
    expect(result.shadowCompared).toBe(true);
    expect(result.compareMatch).toBe(true);
    expect(result.legacyDecisionPresent).toBe(true);
    expect(result.constitutionalDecisionPresent).toBe(true);
    expect(result.compareMessage).toContain("match");
    expect(result.readyToTighten).toBe(false);
    expect(result.executed).toBe(false);
    expect(result.paintedAliasUsedAsPath).toBe(false);
    expect(result.enforce).toBe(false);
    expect(result.liveInvoke).toBe(false);
    expect(result.fabricDefaultOn).toBe(false);
  });

  it("honors COMPARE env snapshot dual with shadow and reports mismatch", () => {
    const result = runRuntimeFacadeShadow(
      { sources: sampleSourceSnapshot },
      {
        env: SHADOW_COMPARE_ENV_DUAL,
        legacyDecision: "legacy-other",
        constitutionalDecision: CONSTITUTIONAL_DECLARED_PATH_V1,
      },
    );
    expect(result.invoked).toBe(true);
    expect(result.shadowCompared).toBe(true);
    expect(result.compareMatch).toBe(false);
    expect(result.readyToTighten).toBe(false);
    expect(result.executed).toBe(false);
  });

  it("does not set shadowCompared when COMPARE on but legacy snapshot missing", () => {
    const result = runRuntimeFacadeShadow(
      { sources: sampleSourceSnapshot },
      {
        shadow: true,
        compare: true,
        select: true,
        candidatePath: CONSTITUTIONAL_DECLARED_PATH_V1,
      },
    );
    expect(result.invoked).toBe(true);
    expect(result.selectedPath).toBe(CONSTITUTIONAL_DECLARED_PATH_V1);
    expect(result.shadowCompared).toBe(false);
    expect(result.compareMatch).toBeNull();
    expect(result.legacyDecisionPresent).toBe(false);
    expect(result.constitutionalDecisionPresent).toBe(true);
    expect(result.readyToTighten).toBe(false);
  });

  it("does not elevate painted legacyPathRef to selectedPath", () => {
    const result = runRuntimeFacadeShadow(
      { sources: sampleSourceSnapshot },
      {
        shadow: true,
        compare: true,
        select: true,
        candidatePath: "lobster",
        legacyPathRef: "lobster",
        constitutionalDecision: "lobster",
      },
    );
    expect(result.invoked).toBe(true);
    expect(result.selectedPath).toBeNull();
    expect(result.paintedAliasUsedAsPath).toBe(false);
    expect(result.shadowCompared).toBe(true);
    expect(result.compareMatch).toBe(true);
    expect(result.readyToTighten).toBe(false);
    expect(result.executed).toBe(false);
  });

  it("rolls back shadowCompared when COMPARE is off under shadow", () => {
    const result = runRuntimeFacadeShadow(
      { sources: sampleSourceSnapshot },
      {
        shadow: true,
        env: { ...COMPARE_ENV, [SHADOW_COMPARE_ENV]: "false" },
        legacyDecision: CONSTITUTIONAL_DECLARED_PATH_V1,
        constitutionalDecision: CONSTITUTIONAL_DECLARED_PATH_V1,
      },
    );
    expect(result.invoked).toBe(true);
    expect(result.shadowCompared).toBe(false);
    expect(result.compareMatch).toBeNull();
    expect(result.readyToTighten).toBe(false);
  });

  it("does not read process.env for COMPARE", () => {
    const previous = process.env[SHADOW_COMPARE_ENV];
    process.env[SHADOW_COMPARE_ENV] = "true";
    try {
      const result = runRuntimeFacadeShadow(
        { sources: sampleSourceSnapshot },
        {
          shadow: true,
          legacyDecision: CONSTITUTIONAL_DECLARED_PATH_V1,
          constitutionalDecision: CONSTITUTIONAL_DECLARED_PATH_V1,
        },
      );
      expect(result.shadowCompared).toBe(false);
      expect(result.readyToTighten).toBe(false);
    } finally {
      if (previous === undefined) {
        delete process.env[SHADOW_COMPARE_ENV];
      } else {
        process.env[SHADOW_COMPARE_ENV] = previous;
      }
    }
  });

});
