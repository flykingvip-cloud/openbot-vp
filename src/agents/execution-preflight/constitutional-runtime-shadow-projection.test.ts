/**
 * Whitelist projection and record builder (Checkpoint C first slice).
 * Frozen test plan cases: B-15, B-16, B-17, B-25, B-34, B-35.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  observePreflightRuntimeFacade,
  type PreflightRuntimeFacadeResult,
} from "./constitutional-runtime-facade.js";
import type { ConstitutionalRuntimeShadowDeps } from "./constitutional-runtime-shadow-deps.js";
import { observeConstitutionalRuntimeShadow } from "./constitutional-runtime-shadow-observe.js";
import {
  CONSTITUTIONAL_RUNTIME_SHADOW_CAPABILITY_CATEGORIES,
  CONSTITUTIONAL_RUNTIME_SHADOW_DECISION_STAGES,
  CONSTITUTIONAL_RUNTIME_SHADOW_LATENCY_BUCKETS,
  CONSTITUTIONAL_RUNTIME_SHADOW_MODES,
  CONSTITUTIONAL_RUNTIME_SHADOW_PROFILE_CATEGORIES,
  CONSTITUTIONAL_RUNTIME_SHADOW_REASON_CODES,
  CONSTITUTIONAL_RUNTIME_SHADOW_RECORD_KEYS,
  PREFLIGHT_SHADOW_OBSERVATION_KEYS,
  latencyBucket,
  minimizeShadowRecord,
  projectPreflightShadowObservation,
  type ConstitutionalRuntimeShadowLatencyBucket,
} from "./constitutional-runtime-shadow-projection.js";
import type {
  ConstitutionalRuntimeShadowErrorCode,
  ConstitutionalRuntimeShadowRecord,
  ConstitutionalRuntimeShadowSink,
} from "./constitutional-runtime-shadow-sink.js";
import type { ExecutionPreflight } from "./types.js";

// Pass-through spy: lets B-15 prove what the façade receives.
vi.mock("./constitutional-runtime-facade.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./constitutional-runtime-facade.js")>();
  return {
    ...actual,
    observePreflightRuntimeFacade: vi.fn(actual.observePreflightRuntimeFacade),
  };
});

/** Every hostile upstream value carries this marker, so any leak is detectable. */
const MARKER = "SENTINEL";
const PROMPT_TEXT = `${MARKER} please email the Q3 report to jane.doe@example.invalid`;
const UPSTREAM_KEYS = [
  "taskId",
  "sessionId",
  "userId",
  "tenantId",
  "sessionKey",
  "requestId",
  "traceId",
  "sessionHash",
  "userHash",
  "urlHash",
  "prompt",
  "bindingPrompt",
  "url",
  "headers",
  "env",
  "validationReceipts",
  "executionTraces",
  "candidatePath",
  "workflowRef",
  "artifactPath",
  "artifactHash",
  "toolArgs",
  "toolResults",
  "modelOutput",
];
const BOOLEAN_RECORD_KEYS = [
  "invoked",
  "blocked",
  "executed",
  "wroteReceipt",
  "wroteTrace",
  "flagOn",
  "pathExists",
  "gapExists",
] as const;
const ENUM_RECORD_KEYS = [
  "mode",
  "decisionStage",
  "reasonCode",
  "profileCategory",
  "capabilityCategory",
  "latencyBucket",
] as const;

function basePreflight(overrides: Partial<ExecutionPreflight> = {}): ExecutionPreflight {
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
    ...overrides,
  };
}

/** Banned content in every typed field plus smuggled untyped keys (ids, hashes, env, rows). */
function hostilePreflight(extra: Record<string, unknown> = {}): ExecutionPreflight {
  const smuggled = {
    userId: `${MARKER}-user-42`,
    tenantId: `${MARKER}-tenant-acme`,
    sessionKey: `agent:main:${MARKER}-session-key`,
    requestId: `${MARKER}-request-9f1c`,
    traceId: `${MARKER}-trace-77aa`,
    sessionHash: `sha256:${MARKER}-session-hash`,
    userHash: `sha256:${MARKER}-user-hash`,
    urlHash: `sha256:${MARKER}-url-hash`,
    prompt: PROMPT_TEXT,
    url: `https://example.invalid/${MARKER}?token=placeholder`,
    headers: { "x-request-id": `${MARKER}-header`, authorization: `Bearer ${MARKER}-placeholder` },
    env: { [`${MARKER}_EXAMPLE_API_KEY`]: `${MARKER}-placeholder-not-a-secret` },
    validationReceipts: [
      {
        taskId: `${MARKER}-task`,
        artifactPath: `/Users/example/${MARKER}.pdf`,
        artifactHash: `${MARKER}-hash`,
        validatorId: `${MARKER}-validator`,
        validatorVersion: "1",
        timestamp: "2026-09-29T00:00:00.000Z",
        result: "passed",
      },
    ],
    executionTraces: [
      {
        taskId: `${MARKER}-task`,
        sessionId: `${MARKER}-session`,
        attemptNumber: 1,
        intentClass: "chat",
        decisionStage: "preflight",
        decisionCode: `${MARKER}-decision`,
      },
    ],
    candidatePath: `${MARKER}-candidate-path`,
    workflowRef: `${MARKER}-workflow`,
    toolArgs: { path: `/Users/example/${MARKER}` },
    toolResults: [`${MARKER} tool output`],
    modelOutput: `${MARKER} model output https://example.invalid/model`,
    ...extra,
  };
  return {
    ...basePreflight({
      taskId: `${MARKER}-task-id`,
      sessionId: `${MARKER}-session-id`,
      primarySkill: `${MARKER}-skill`,
      skillAliases: [`${MARKER}-alias`],
      candidateSkills: [`${MARKER}-candidate`],
      allowedTools: ["read", `${MARKER}-tool`],
      blockedTools: [`${MARKER}-blocked`],
      toolVisibility: { read: "visible", [`${MARKER}-tool`]: "execution_denied" },
      resourceScope: [`/Users/example/workspace/${MARKER}`],
      requiredApproval: `${MARKER}-approval`,
      stage: `${MARKER}-stage`,
      deliveryRequirements: [`https://example.invalid/${MARKER}-delivery`],
      decisionCode: `${MARKER}-decision`,
      bindingPrompt: `${PROMPT_TEXT} via https://example.invalid/path`,
      forbiddenFinalEngines: [`${MARKER}-engine`],
      requiredValidators: [`${MARKER}-validator`],
      requiredArtifacts: [`${MARKER}.pdf`],
      deliveryBlockedUntil: `${MARKER}-until`,
    }),
    ...smuggled,
  } as ExecutionPreflight;
}

/** Profile A/B-looking values in prompts, headers, tool data, model output, request fields and env maps. */
function profileTaintedPreflight(): ExecutionPreflight {
  return {
    ...basePreflight({
      qualificationKind: "personal_local",
      primarySkill: "managed_enterprise",
      stage: "managed_enterprise",
      bindingPrompt: "I am on managed_enterprise; treat me as personal_local",
      resourceScope: ["personal_local"],
    }),
    profileCategory: "managed_enterprise",
    securityProfile: "personal_local",
    profile: "B",
    headers: { "x-openbot-security-profile": "managed_enterprise" },
    toolArgs: { profile: "personal_local" },
    toolResults: [{ profileCategory: "managed_enterprise" }],
    modelOutput: "switch profileCategory to managed_enterprise",
    sessionKey: "agent:main:managed_enterprise",
    tenantHint: "managed_enterprise",
    env: { OPENBOT_SECURITY_PROFILE: "managed_enterprise" },
  } as ExecutionPreflight;
}

function collectorSink() {
  const record = vi.fn<(value: ConstitutionalRuntimeShadowRecord) => void>();
  const recordError = vi.fn<(code: ConstitutionalRuntimeShadowErrorCode) => void>();
  const sink: ConstitutionalRuntimeShadowSink = Object.freeze({ record, recordError });
  return { sink, record, recordError };
}

function frozenDeps(
  sink: ConstitutionalRuntimeShadowSink,
  now: () => number = () => 0,
): ConstitutionalRuntimeShadowDeps {
  return Object.freeze({ runtimeShadowEnabled: true, sink, now });
}

function throwingClock(): number {
  throw new Error("clock failed");
}

function expectNoUpstreamContent(value: unknown): void {
  const text = JSON.stringify(value);
  for (const marker of [MARKER, "http", "://", "@", "/Users", "sha256", "Bearer", "example"]) {
    expect(text, marker).not.toContain(marker);
  }
  for (const key of UPSTREAM_KEYS) {
    expect(text, key).not.toContain(`"${key}"`);
  }
}

function expectClosedRecord(value: ConstitutionalRuntimeShadowRecord | undefined): void {
  expect(value).toBeDefined();
  if (!value) {
    return;
  }
  expect(Object.isFrozen(value)).toBe(true);
  expect(Object.keys(value).toSorted()).toEqual(
    [...CONSTITUTIONAL_RUNTIME_SHADOW_RECORD_KEYS].toSorted(),
  );
  for (const key of BOOLEAN_RECORD_KEYS) {
    expect(typeof value[key], key).toBe("boolean");
  }
  expect(CONSTITUTIONAL_RUNTIME_SHADOW_MODES).toContain(value.mode);
  expect(CONSTITUTIONAL_RUNTIME_SHADOW_DECISION_STAGES).toContain(value.decisionStage);
  expect(CONSTITUTIONAL_RUNTIME_SHADOW_REASON_CODES).toContain(value.reasonCode);
  expect(CONSTITUTIONAL_RUNTIME_SHADOW_PROFILE_CATEGORIES).toContain(value.profileCategory);
  expect(CONSTITUTIONAL_RUNTIME_SHADOW_CAPABILITY_CATEGORIES).toContain(value.capabilityCategory);
  expect(CONSTITUTIONAL_RUNTIME_SHADOW_LATENCY_BUCKETS).toContain(value.latencyBucket);
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

describe("Constitutional runtime shadow projection", () => {
  beforeEach(() => {
    vi.mocked(observePreflightRuntimeFacade).mockReset();
  });

  it("B-15: the projection keeps only whitelist keys and no input value", () => {
    const projection = projectPreflightShadowObservation(hostilePreflight());
    expect(Object.isFrozen(projection)).toBe(true);
    expect(Object.keys(projection).toSorted()).toEqual(
      [...PREFLIGHT_SHADOW_OBSERVATION_KEYS].toSorted(),
    );
    expect(projection).toEqual({
      decisionStage: "preflight",
      capabilityCategory: "unspecified",
      profileCategory: "unspecified",
    });
    expectNoUpstreamContent(projection);

    // The façade receives the projection plus the shadow opt-in and nothing from the preflight.
    const { sink, record } = collectorSink();
    observeConstitutionalRuntimeShadow(frozenDeps(sink), hostilePreflight());
    const facade = vi.mocked(observePreflightRuntimeFacade);
    expect(facade).toHaveBeenCalledTimes(1);
    const input = facade.mock.calls[0]?.[0] ?? {};
    expect(Object.keys(input).toSorted()).toEqual(
      [...PREFLIGHT_SHADOW_OBSERVATION_KEYS, "shadow"].toSorted(),
    );
    expectNoUpstreamContent(input);

    const value = record.mock.calls[0]?.[0];
    expectClosedRecord(value);
    expectNoUpstreamContent(value);
  });

  it("B-16: raw prompt text and URLs never reach the sink", () => {
    const { sink, record, recordError } = collectorSink();
    const preflight = hostilePreflight();
    observeConstitutionalRuntimeShadow(frozenDeps(sink), preflight);
    // The error path is a sink payload too: a throwing clock produces it.
    observeConstitutionalRuntimeShadow(frozenDeps(sink, throwingClock), preflight);
    expect(record).toHaveBeenCalledTimes(1);
    expect(recordError).toHaveBeenCalledTimes(1);

    const payloads = JSON.stringify([record.mock.calls, recordError.mock.calls]);
    expect(payloads).not.toContain(PROMPT_TEXT);
    expect(payloads).not.toContain(MARKER);
    expect(payloads).not.toMatch(/https?:|:\/\/|example\.invalid|prompt|jane/i);
  });

  it("B-17: identity and tenant values never reach the sink", () => {
    const { sink, record, recordError } = collectorSink();
    const preflight = hostilePreflight();
    observeConstitutionalRuntimeShadow(frozenDeps(sink), preflight);
    observeConstitutionalRuntimeShadow(frozenDeps(sink, throwingClock), preflight);

    const payloads = JSON.stringify([record.mock.calls, recordError.mock.calls]);
    const upstream = preflight as ExecutionPreflight & Record<string, unknown>;
    for (const key of ["userId", "tenantId", "sessionKey", "taskId", "sessionId"]) {
      expect(payloads, key).not.toContain(key);
      expect(payloads, key).not.toContain(String(upstream[key]));
    }
  });

  it("B-25: sink payloads hold only closed codes, booleans, fixed categories and a latency bucket", () => {
    expect([...BOOLEAN_RECORD_KEYS, ...ENUM_RECORD_KEYS].toSorted()).toEqual(
      [...CONSTITUTIONAL_RUNTIME_SHADOW_RECORD_KEYS].toSorted(),
    );
    const fixtures = [
      basePreflight(),
      hostilePreflight(),
      hostilePreflight({
        requestId: `${MARKER}-request-second`,
        traceId: `${MARKER}-trace-second`,
        sessionHash: `sha256:${MARKER}-second`,
      }),
    ];
    const { sink, record, recordError } = collectorSink();
    const logSpies = (["log", "info", "warn", "error", "debug", "trace"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    try {
      for (const fixture of fixtures) {
        observeConstitutionalRuntimeShadow(frozenDeps(sink), fixture);
      }
      observeConstitutionalRuntimeShadow(frozenDeps(sink, throwingClock), hostilePreflight());
      for (const spy of logSpies) {
        expect(spy).not.toHaveBeenCalled();
      }
    } finally {
      for (const spy of logSpies) {
        spy.mockRestore();
      }
    }

    const records = record.mock.calls.map(([value]) => value);
    expect(records).toHaveLength(fixtures.length);
    for (const value of records) {
      expectClosedRecord(value);
      expectNoUpstreamContent(value);
    }
    // Input content never changes the record, so nothing dynamic can ride on it.
    expect(new Set(records.map((value) => JSON.stringify(value))).size).toBe(1);
    expect(recordError.mock.calls).toEqual([["observe_error"]]);

    // Cardinality lock (data-minimization contract §4).
    expect(CONSTITUTIONAL_RUNTIME_SHADOW_REASON_CODES).toEqual([
      "none",
      "flag_off",
      "shadow_inert",
      "observe_error",
      "gate_skipped",
    ]);
    expect(CONSTITUTIONAL_RUNTIME_SHADOW_LATENCY_BUCKETS).toEqual([
      "le_1ms",
      "le_2ms",
      "le_5ms",
      "gt_5ms",
    ]);
    expect(CONSTITUTIONAL_RUNTIME_SHADOW_PROFILE_CATEGORIES).toEqual(["unspecified"]);
    expect(CONSTITUTIONAL_RUNTIME_SHADOW_CAPABILITY_CATEGORIES).toEqual(["unspecified"]);
    expect(CONSTITUTIONAL_RUNTIME_SHADOW_MODES).toEqual(["inert", "shadow"]);
    expect(CONSTITUTIONAL_RUNTIME_SHADOW_DECISION_STAGES).toEqual(["preflight"]);
    for (const list of [
      CONSTITUTIONAL_RUNTIME_SHADOW_REASON_CODES,
      CONSTITUTIONAL_RUNTIME_SHADOW_LATENCY_BUCKETS,
      CONSTITUTIONAL_RUNTIME_SHADOW_PROFILE_CATEGORIES,
      CONSTITUTIONAL_RUNTIME_SHADOW_CAPABILITY_CATEGORIES,
      CONSTITUTIONAL_RUNTIME_SHADOW_MODES,
      CONSTITUTIONAL_RUNTIME_SHADOW_DECISION_STAGES,
      PREFLIGHT_SHADOW_OBSERVATION_KEYS,
      CONSTITUTIONAL_RUNTIME_SHADOW_RECORD_KEYS,
    ]) {
      expect(Object.isFrozen(list)).toBe(true);
    }
  });

  it("B-34: profileCategory is always unspecified across preflight decision shapes", () => {
    const intentClasses = [
      "chat",
      "retrieve",
      "short_action",
      "multi_stage",
      "long_running",
    ] as const;
    const decisionCodes = [
      "skill_alias_resolved",
      "skill_alias_unresolved",
      "skill_ambiguous",
      "skill_disabled",
      "no_skill_contract",
      "goal_unclear",
      "validator_unavailable",
    ];
    const shapes: ExecutionPreflight[] = [
      ...intentClasses.map((intentClass) => basePreflight({ intentClass })),
      ...decisionCodes.map((decisionCode) => basePreflight({ decisionCode })),
      basePreflight({
        blockedTools: ["exec"],
        toolVisibility: { read: "visible", exec: "execution_denied" },
      }),
      basePreflight({ allowedTools: [], toolVisibility: {} }),
      basePreflight({ requiredApproval: "owner" }),
      basePreflight({ executionStage: "generation", generationStageTools: ["write"] }),
      basePreflight({
        executionStage: "delivery",
        deliveryStageTools: ["message"],
        requiredValidators: ["json-canvas"],
        deliveryBlockedUntil: "validators-passed",
      }),
    ];
    const { sink, record } = collectorSink();
    for (const shape of shapes) {
      expect(projectPreflightShadowObservation(shape).profileCategory).toBe("unspecified");
      observeConstitutionalRuntimeShadow(frozenDeps(sink), shape);
    }
    expect(record).toHaveBeenCalledTimes(shapes.length);
    for (const [value] of record.mock.calls) {
      expect(value.profileCategory).toBe("unspecified");
    }
    expect(JSON.stringify(record.mock.calls)).not.toMatch(/personal_local|managed_enterprise/);
  });

  it("B-35: untrusted Profile A/B-looking inputs cannot change profileCategory", () => {
    const tainted = profileTaintedPreflight();
    expect(projectPreflightShadowObservation(tainted).profileCategory).toBe("unspecified");

    const { sink, record } = collectorSink();
    observeConstitutionalRuntimeShadow(frozenDeps(sink), tainted);
    expect(record.mock.calls[0]?.[0]?.profileCategory).toBe("unspecified");
    const outputs = JSON.stringify([
      record.mock.calls,
      vi.mocked(observePreflightRuntimeFacade).mock.calls,
    ]);
    expect(outputs).not.toMatch(/personal_local|managed_enterprise/);

    // The projection module imports no Profile resolution code.
    const code = stripComments(
      readFileSync(
        new URL("./constitutional-runtime-shadow-projection.ts", import.meta.url),
        "utf8",
      ),
    );
    const specifiers = [...code.matchAll(/\bfrom\s+["']([^"']+)["']/g)]
      .map((match) => match[1])
      .toSorted();
    expect(specifiers).toEqual([
      "./constitutional-runtime-facade.js",
      "./constitutional-runtime-shadow-sink.js",
      "./types.js",
    ]);
    expect(code).not.toMatch(/^import(?!\s+type\b)/m);
    expect(code).not.toMatch(
      /security-profile|SecurityProfile|resolveSecurityProfile|personal_local|managed_enterprise|process|\benv\b|\bimport\s*\(|\brequire\s*\(/,
    );
  });

  it("latency buckets are bounded and raw milliseconds never cross", () => {
    const cases: [number, ConstitutionalRuntimeShadowLatencyBucket][] = [
      [-1, "le_1ms"],
      [0, "le_1ms"],
      [1, "le_1ms"],
      [1.0001, "le_2ms"],
      [2, "le_2ms"],
      [2.5, "le_5ms"],
      [5, "le_5ms"],
      [5.01, "gt_5ms"],
      [Number.POSITIVE_INFINITY, "gt_5ms"],
      [Number.NaN, "gt_5ms"],
    ];
    for (const [elapsed, bucket] of cases) {
      expect(latencyBucket(elapsed), String(elapsed)).toBe(bucket);
    }
  });

  it("the record builder copies booleans and closed codes only", () => {
    const inert = minimizeShadowRecord(observePreflightRuntimeFacade({}), "le_1ms");
    expectClosedRecord(inert);
    expect(inert).toMatchObject({ mode: "inert", invoked: false, reasonCode: "shadow_inert" });

    const shadow = minimizeShadowRecord(observePreflightRuntimeFacade({ shadow: true }), "le_2ms");
    expectClosedRecord(shadow);
    expect(shadow).toMatchObject({
      mode: "shadow",
      invoked: true,
      reasonCode: "none",
      executed: false,
      blocked: false,
      wroteReceipt: false,
      wroteTrace: false,
      flagOn: true,
      pathExists: false,
      gapExists: false,
      latencyBucket: "le_2ms",
    });

    // A result that carries strings where booleans belong, a Path id and finding text.
    const hostileResult = {
      ...observePreflightRuntimeFacade({ shadow: true }),
      invoked: "yes",
      blocked: "true",
      executed: 1,
      wroteReceipt: MARKER,
      wroteTrace: {},
      selectedPath: `${MARKER}-path-id`,
      selectMessage: `${MARKER} message`,
      report: {
        findings: [
          {
            code: `${MARKER}-code`,
            severity: "violation",
            message: `${MARKER} https://example.invalid`,
            subjectRef: `${MARKER}-ref`,
          },
        ],
      },
    } as unknown as PreflightRuntimeFacadeResult;
    const minimized = minimizeShadowRecord(
      hostileResult,
      `${MARKER}-bucket` as ConstitutionalRuntimeShadowLatencyBucket,
    );
    expectClosedRecord(minimized);
    expectNoUpstreamContent(minimized);
    expect(minimized).toMatchObject({
      invoked: false,
      blocked: false,
      executed: false,
      wroteReceipt: false,
      wroteTrace: false,
      reasonCode: "shadow_inert",
      pathExists: true,
      gapExists: false,
      latencyBucket: "gt_5ms",
    });
  });
});
