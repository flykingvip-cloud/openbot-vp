/**
 * Constitutional runtime shadow gate (Checkpoint C first slice).
 * Frozen test plan cases: B-01, B-02, B-03, B-12, B-13, B-14.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONSTITUTIONAL_SHADOW_ENV,
  LEGAL_PATH_EXECUTE_ENV,
  LEGAL_PATH_SELECT_ENV,
  PATH_GAP_REPORT_ENV,
  isConstitutionalShadowEnabled,
  isLegalPathExecuteEnabled,
  isLegalPathSelectEnabled,
  isPathGapReportEnabled,
} from "../../../packages/constitutional-contracts/src/index.js";
import {
  CONVERSATION_TASK_ENV,
  type ConversationTaskFlag,
  isConversationTaskFlagEnabled,
} from "../../conversation-task/feature.js";
import {
  ORCHESTRATION_ENV,
  type OrchestrationFlag,
  isOrchestrationFlagEnabled,
} from "../../task-orchestration/feature.js";
import { observePreflightRuntimeFacade } from "./constitutional-runtime-facade.js";
import type { ConstitutionalRuntimeShadowDeps } from "./constitutional-runtime-shadow-deps.js";
import {
  isConstitutionalRuntimeShadowEnabled,
  parseConstitutionalRuntimeShadowFlag,
} from "./constitutional-runtime-shadow-gate.js";
import { observeConstitutionalRuntimeShadow } from "./constitutional-runtime-shadow-observe.js";
import type {
  ConstitutionalRuntimeShadowErrorCode,
  ConstitutionalRuntimeShadowRecord,
  ConstitutionalRuntimeShadowSink,
} from "./constitutional-runtime-shadow-sink.js";
import type { ExecutionPreflight } from "./types.js";

// Pass-through spy: B-12 and B-13 read the façade's own result.
vi.mock("./constitutional-runtime-facade.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./constitutional-runtime-facade.js")>();
  return {
    ...actual,
    observePreflightRuntimeFacade: vi.fn(actual.observePreflightRuntimeFacade),
  };
});

const RUNTIME_SHADOW_KEY = "OPENBOT_CONSTITUTIONAL_RUNTIME_SHADOW";

function preflightFixture(): ExecutionPreflight {
  return {
    taskId: "task-fixture",
    sessionId: "session-fixture",
    intentClass: "chat",
    qualificationKind: "none",
    skillAliases: [],
    candidateSkills: [],
    allowedTools: ["read"],
    blockedTools: [],
    toolVisibility: { read: "visible" },
    resourceScope: [],
    deliveryRequirements: [],
    decisionCode: "skill_alias_resolved",
    forbiddenFinalEngines: [],
    requiredValidators: [],
    requiredArtifacts: [],
    requiredConfirmations: [],
    generationStageTools: [],
    deliveryStageTools: [],
    attemptNumber: 1,
  };
}

function collectorSink() {
  const record = vi.fn<(value: ConstitutionalRuntimeShadowRecord) => void>();
  const recordError = vi.fn<(code: ConstitutionalRuntimeShadowErrorCode) => void>();
  const sink: ConstitutionalRuntimeShadowSink = Object.freeze({ record, recordError });
  return { sink, record, recordError };
}

function frozenDeps(
  runtimeShadowEnabled: boolean,
  sink: ConstitutionalRuntimeShadowSink,
): ConstitutionalRuntimeShadowDeps {
  return Object.freeze({ runtimeShadowEnabled, sink, now: () => 0 });
}

/** Mirrors the designed attempt.ts call site (design §2.1): one boolean check, then observe. */
function runCallSite(
  deps: ConstitutionalRuntimeShadowDeps,
  preflight: ExecutionPreflight,
  observe: typeof observeConstitutionalRuntimeShadow,
): void {
  if (isConstitutionalRuntimeShadowEnabled(deps.runtimeShadowEnabled)) {
    try {
      observe(deps, preflight);
    } catch {
      // Last-resort defense, as at the real call site: no sink call, no rethrow.
    }
  }
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

describe("Constitutional runtime shadow gate", () => {
  beforeEach(() => {
    vi.mocked(observePreflightRuntimeFacade).mockReset();
  });

  it("B-01: an unset flag parses to false and the observation is never entered", () => {
    const runtimeShadowEnabled = parseConstitutionalRuntimeShadowFlag(undefined);
    expect(runtimeShadowEnabled).toBe(false);

    const { sink, record, recordError } = collectorSink();
    const deps = frozenDeps(runtimeShadowEnabled, sink);
    expect(isConstitutionalRuntimeShadowEnabled(deps.runtimeShadowEnabled)).toBe(false);

    const observe = vi.fn(observeConstitutionalRuntimeShadow);
    runCallSite(deps, preflightFixture(), observe);
    expect(observe).not.toHaveBeenCalled();
    expect(observePreflightRuntimeFacade).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
    expect(recordError).not.toHaveBeenCalled();
  });

  it("B-02: falsy tokens, empty or whitespace strings and arbitrary strings parse to false", () => {
    const values = [
      "0",
      "false",
      "off",
      "no",
      "FALSE",
      "Off",
      " no ",
      "\tOFF\n",
      "",
      " ",
      "\t\n",
      "enabled",
      "2",
      "y",
      "t",
      "truthy",
      "yes please",
      "1 1",
      "on!",
      "true?",
      "null",
      "undefined",
    ];
    const { sink, record, recordError } = collectorSink();
    const observe = vi.fn(observeConstitutionalRuntimeShadow);
    for (const value of values) {
      const runtimeShadowEnabled = parseConstitutionalRuntimeShadowFlag(value);
      expect(runtimeShadowEnabled, JSON.stringify(value)).toBe(false);
      runCallSite(frozenDeps(runtimeShadowEnabled, sink), preflightFixture(), observe);
    }
    expect(observe).not.toHaveBeenCalled();
    expect(observePreflightRuntimeFacade).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
    expect(recordError).not.toHaveBeenCalled();
  });

  it("B-03: 1 / true / yes / on parse to true in any case and with surrounding whitespace", () => {
    const values = [
      "1",
      "true",
      "yes",
      "on",
      "TRUE",
      "True",
      "YES",
      "Yes",
      "ON",
      "On",
      " 1 ",
      "\ttrue\n",
      "  yes",
      "on  ",
      " TrUe ",
    ];
    for (const value of values) {
      expect(parseConstitutionalRuntimeShadowFlag(value), JSON.stringify(value)).toBe(true);
    }
    expect(isConstitutionalRuntimeShadowEnabled(true)).toBe(true);
    expect(isConstitutionalRuntimeShadowEnabled(false)).toBe(false);

    // Gate on: the observation is entered exactly once and records once.
    const { sink, record, recordError } = collectorSink();
    const observe = vi.fn(observeConstitutionalRuntimeShadow);
    const deps = frozenDeps(parseConstitutionalRuntimeShadowFlag(" On "), sink);
    runCallSite(deps, preflightFixture(), observe);
    expect(observe).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledTimes(1);
    expect(recordError).not.toHaveBeenCalled();
  });

  it("B-12: runtime shadow on does not open the legal-path select bridge", () => {
    const { sink, record } = collectorSink();
    runCallSite(frozenDeps(true, sink), preflightFixture(), observeConstitutionalRuntimeShadow);

    const facade = vi.mocked(observePreflightRuntimeFacade);
    expect(facade).toHaveBeenCalledTimes(1);
    const input = facade.mock.calls[0]?.[0];
    expect(input).toEqual({
      decisionStage: "preflight",
      capabilityCategory: "unspecified",
      profileCategory: "unspecified",
      shadow: true,
    });
    for (const key of ["select", "env", "candidatePath", "workflowRef", "enforce"]) {
      expect(input, key).not.toHaveProperty(key);
    }
    expect(facade.mock.results[0]).toMatchObject({
      type: "return",
      value: {
        selectedPath: null,
        selectEnabled: false,
        legalPathSelectable: false,
        candidateAccepted: false,
      },
    });
    expect(record.mock.calls[0]?.[0]).toMatchObject({ pathExists: false });
  });

  it("B-13: runtime shadow on never executes", () => {
    const { sink, record } = collectorSink();
    runCallSite(frozenDeps(true, sink), preflightFixture(), observeConstitutionalRuntimeShadow);

    expect(vi.mocked(observePreflightRuntimeFacade).mock.results[0]).toMatchObject({
      type: "return",
      value: {
        executed: false,
        blocked: false,
        enforce: false,
        enforced: false,
        liveInvoke: false,
        wroteLedger: false,
      },
    });
    expect(record.mock.calls[0]?.[0]).toMatchObject({ executed: false, blocked: false });
  });

  it("B-14: runtime shadow is not the ORCH, CTR, PATH_GAP, SELECT, EXECUTE or contracts shadow flag", () => {
    const { sink, record } = collectorSink();
    const deps = frozenDeps(true, sink);
    expect(isConstitutionalRuntimeShadowEnabled(deps.runtimeShadowEnabled)).toBe(true);
    runCallSite(deps, preflightFixture(), observeConstitutionalRuntimeShadow);
    expect(record).toHaveBeenCalledTimes(1);

    // Only the runtime shadow key is on; every other flag is unset.
    const snapshot: Readonly<Record<string, string | undefined>> = Object.freeze({
      [RUNTIME_SHADOW_KEY]: "1",
    });
    expect(isPathGapReportEnabled(snapshot)).toBe(false);
    expect(isLegalPathSelectEnabled(snapshot)).toBe(false);
    expect(isLegalPathExecuteEnabled(snapshot)).toBe(false);
    expect(isConstitutionalShadowEnabled(snapshot)).toBe(false);
    for (const flag of Object.keys(ORCHESTRATION_ENV) as OrchestrationFlag[]) {
      expect(isOrchestrationFlagEnabled(flag, snapshot), flag).toBe(false);
    }
    for (const flag of Object.keys(CONVERSATION_TASK_ENV) as ConversationTaskFlag[]) {
      expect(isConversationTaskFlagEnabled(flag, snapshot), flag).toBe(false);
    }

    const otherFlagNames = [
      PATH_GAP_REPORT_ENV,
      LEGAL_PATH_SELECT_ENV,
      LEGAL_PATH_EXECUTE_ENV,
      CONSTITUTIONAL_SHADOW_ENV,
      ...Object.values(ORCHESTRATION_ENV),
      ...Object.values(CONVERSATION_TASK_ENV),
    ];
    expect(otherFlagNames).not.toContain(RUNTIME_SHADOW_KEY);

    // The gate module references no flag name and no environment at all.
    const gateCode = stripComments(
      readFileSync(new URL("./constitutional-runtime-shadow-gate.ts", import.meta.url), "utf8"),
    );
    expect(gateCode).not.toMatch(/OPENBOT_|process|\benv\b|\bimport\b|\brequire\b|globalThis/);
    for (const name of otherFlagNames) {
      expect(gateCode).not.toContain(name);
    }
  });
});
