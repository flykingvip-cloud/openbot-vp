import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORKBENCH_SYSTEM_SETTINGS_TAB,
  WORKBENCH_SYSTEM_SETTINGS_TAB_ORDER,
} from "../views/workbench-types.ts";
import {
  EVOLUTION_PERCEPTION_METHODS,
  EVOLUTION_PERCEPTION_PROJECT_METHOD,
  EVOLUTION_PERCEPTION_QUERY_METHOD,
  evolutionPerceptionRefreshPlan,
  isEvolutionPerceptionMethodAllowed,
  refreshEvolutionPerception,
  type EvolutionPerceptionTransport,
} from "./client.ts";
import { EVOLUTION_PERCEPTION_COPY } from "./copy.ts";
import {
  evolutionFactRowLines,
  evolutionItemTitle,
  evolutionPerceptionWindowPrecision,
  evolutionReasonStatusLabel,
  evolutionResultLabel,
  evolutionSurfaceLabel,
  formatEvolutionEmptyLastChangeCopy,
  formatEvolutionFreshnessCopy,
  formatEvolutionPerceptionWindowLabel,
  formatEvolutionQueryAsOf,
  formatEvolutionSuccessEmptyCopy,
  formatEvolutionSuccessEmptyHint,
  humanizeEvolutionNarrationLine,
  evolutionFoldedNotes,
  presentEvolutionFact,
  resolveEvolutionPerceptionUiStatus,
  stripEvolutionEmptyNarration,
  visibleEvolutionProjectionGroups,
  visibleProjectionPanelCount,
} from "./display.ts";
import {
  acceptEvolutionProject,
  acceptEvolutionQuery,
  evolutionFactDetailValue,
  evolutionPanelsFromSlices,
  guardEvolutionNarration,
  learnedEvolutionItems,
  makeEvolutionFactDetail,
} from "./mapping.ts";
import { isSystemEvolutionDomain, type EvolutionTimelineItem } from "./types.ts";

const WINDOW = { from: "2026-09-18T00:00:00.000Z", to: "2026-09-25T00:00:00.000Z" };

function itemJSON(input: {
  ledger: string;
  proposal?: string | null;
  application?: string | null;
  verification?: string | null;
  domain?: string;
  target?: string;
  bucket?: string | null;
  execution?: string;
  result?: string;
  audience?: string;
  displayName?: string;
}): string {
  const domain = input.domain ?? "agent";
  const target = input.target ?? `{"domain":"agent","agentId":"a1"}`;
  const audience = input.audience ?? (domain === "system" ? "platform" : "digital_human");
  const displayName = input.displayName ?? (domain === "system" ? "平台" : "数字人");
  return JSON.stringify({
    schemaVersion: 1,
    proposalSchema: 2,
    legacy: false,
    factIds: {
      ledgerEventId: input.ledger,
      proposalId: input.proposal === undefined ? "prop-1" : input.proposal,
      applicationId: input.application === undefined ? "app-1" : input.application,
      verificationId: input.verification === undefined ? null : input.verification,
    },
    audience,
    changeObject: {
      target: JSON.parse(target) as unknown,
      surfaceId: "agent.working-dna",
      domain,
      domainDisplayName: displayName,
    },
    beforeAfter: { versionBefore: "1", versionAfter: "2", summary: "1 → 2" },
    reason: {
      status: "specified",
      sourceEvidenceRefs: ["ev-1"],
      sourceMechanismRef: "mech-1",
      caseId: "case-1",
      findingIds: ["find-1"],
    },
    executionMode: input.execution ?? "user_confirmed",
    evidence: {
      evidenceRefs: ["ev-1"],
      reportId: "rep-1",
      verificationId: input.verification === undefined ? null : input.verification,
    },
    result: input.result ?? "verified_effective",
    bucket: input.bucket === undefined ? "user_approved" : input.bucket,
    impactScope: { confidentialityScope: "personal", tenantScope: "tenant-a", label: "本人" },
    reversible: true,
    completeness: "complete",
  });
}

function parseItem(raw: string): unknown {
  return JSON.parse(raw) as unknown;
}

function projectPayload(operation: string, items: unknown[], learned?: unknown[]): unknown {
  return {
    access: "read-only",
    operation,
    persisted: false,
    projection: {
      access: "read-only",
      items,
      learnedItems: learned ?? items,
      exclusions: [],
    },
  };
}

function decodeOne(raw: string): EvolutionTimelineItem | undefined {
  return acceptEvolutionProject(projectPayload("timeline", [parseItem(raw)])).items[0];
}

describe("evolution perception mapping guards", () => {
  it("drops rows without a fact id", () => {
    const blank = parseItem(
      itemJSON({
        ledger: "   ",
        proposal: null,
        application: null,
        verification: null,
        bucket: "pending",
        execution: "unknown",
        result: "pending",
      }),
    );
    const kept = parseItem(
      itemJSON({
        ledger: "",
        proposal: "prop-only",
        application: null,
        verification: null,
        domain: "knowledge",
        target: '{"domain":"knowledge","assetId":"asset-1"}',
        bucket: "pending",
        execution: "unknown",
        result: "pending",
      }),
    );
    const slice = acceptEvolutionProject(projectPayload("timeline", [blank, kept]));
    expect(slice.items).toHaveLength(1);
    expect(slice.items[0]?.factIds.proposalId).toBe("prop-only");
    expect(
      slice.items.every((item) => item.factIds.ledgerEventId.trim() || item.factIds.proposalId),
    ).toBe(true);
  });

  it("does not invent rows for empty or denied payloads", () => {
    const empty = acceptEvolutionQuery({
      access: "read-only",
      operation: "query",
      persisted: false,
      tenantScope: "t",
      intent: "learned_this_week",
      denial: null,
      result: {
        items: [],
        bucketCounts: {},
        platformItems: [],
        unresolvedIntents: [],
        completeness: "empty",
      },
      narration: null,
      narrationGuard: null,
    });
    expect(empty.state).toBe("empty");
    expect(empty.items).toEqual([]);
    expect(empty.platformItems).toEqual([]);
    expect(empty.narration).toEqual({ learned: [], platform: [], other: [] });
    expect(empty.narration.learned.join("")).not.toContain("学会了");

    const denied = acceptEvolutionQuery({
      access: "read-only",
      operation: "query",
      persisted: false,
      tenantScope: null,
      intent: "automatic",
      denial: { denied: true, reason: "permission_denied" },
      result: null,
      narration: null,
      narrationGuard: null,
    });
    expect(denied.state).toBe("denied");
    expect(denied.items).toEqual([]);
    expect(denied.narration).toEqual({ learned: [], platform: [], other: [] });
  });

  it("refuses payloads that are not read-only and unpersisted", () => {
    const persisted = acceptEvolutionProject({
      access: "read-only",
      operation: "timeline",
      persisted: true,
      projection: { items: [] },
    });
    expect(persisted.state).toBe("untrusted");
    const writable = acceptEvolutionProject({
      access: "read-write",
      operation: "timeline",
      persisted: false,
      projection: { items: [] },
    });
    expect(writable.state).toBe("untrusted");
    expect(evolutionPanelsFromSlices([persisted])).toEqual({ status: "untrusted" });
  });

  it("keeps system domain out of the learned set", () => {
    const human = parseItem(itemJSON({ ledger: "evt-human" }));
    const system = parseItem(
      itemJSON({
        ledger: "evt-sys",
        domain: "system",
        target: '{"domain":"system","componentId":"gateway"}',
        execution: "platform_release",
        audience: "platform",
        displayName: "平台",
      }),
    );
    const slice = acceptEvolutionProject(
      projectPayload("timeline", [human, system], [human, system]),
    );
    expect(slice.items).toHaveLength(2);
    expect(slice.learnedItems.map((item) => item.factIds.ledgerEventId)).toEqual(["evt-human"]);
    expect(slice.learnedItems.every((item) => !isSystemEvolutionDomain(item))).toBe(true);
    const panels = evolutionPanelsFromSlices([slice]);
    expect(panels.status).toBe("loaded");
    if (panels.status !== "loaded") {
      return;
    }
    expect(panels.panels.learned.map((item) => item.factIds.ledgerEventId)).toEqual(["evt-human"]);
    expect(
      panels.panels.timeline.some(
        (item) => item.factIds.ledgerEventId === "evt-sys" && isSystemEvolutionDomain(item),
      ),
    ).toBe(true);

    const query = acceptEvolutionQuery({
      access: "read-only",
      operation: "query",
      persisted: false,
      intent: "learned_this_week",
      denial: null,
      result: {
        items: [human, system],
        platformItems: [system],
        unresolvedIntents: [],
        completeness: "complete",
      },
      narration: {
        learned: ["数字人学会了可追溯变化 evt-sys。", "数字人学会了可追溯变化 evt-human。"],
        platform: ["平台学会了 evt-sys。"],
        other: [],
      },
      narrationGuard: null,
    });
    expect(query.items.map((item) => item.factIds.ledgerEventId)).toEqual(["evt-human"]);
    expect(query.platformItems.every((item) => isSystemEvolutionDomain(item))).toBe(true);
    expect(query.narration.learned).toEqual(["数字人学会了可追溯变化 evt-human。"]);
    expect(query.narration.platform).toEqual([]);
  });

  it("drops learned narration that lacks an allowed fact id", () => {
    const human = decodeOne(itemJSON({ ledger: "evt-human" }));
    const system = decodeOne(
      itemJSON({
        ledger: "evt-sys",
        domain: "system",
        target: '{"domain":"system","componentId":"gateway"}',
        audience: "platform",
        displayName: "平台",
      }),
    );
    expect(human && system).toBeTruthy();
    if (!human || !system) {
      return;
    }
    const guarded = guardEvolutionNarration({
      learned: [
        "数字人学会了可追溯变化 evt-human（数字人，已验证有效）。",
        "数字人学会了说话。",
        "数字人学会了可追溯变化 evt-sys。",
      ],
      platform: ["平台可追溯变化 evt-sys。", "平台学会了 evt-sys。"],
      other: ["本窗口没有可追溯的数字人变化。"],
      items: [human, system],
      narrationGuard: null,
    });
    expect(guarded.learned).toEqual(["数字人学会了可追溯变化 evt-human（数字人，已验证有效）。"]);
    expect(guarded.platform).toEqual(["平台可追溯变化 evt-sys。"]);
    expect(guarded.other).toEqual(["本窗口没有可追溯的数字人变化。"]);

    const blocked = guardEvolutionNarration({
      learned: ["数字人学会了可追溯变化 evt-human。"],
      platform: [],
      other: [],
      items: [human],
      narrationGuard: "missing_fact_id",
    });
    expect(blocked).toEqual({ learned: [], platform: [], other: [] });
  });

  it("copies an automatic budget only when the projection provides one", () => {
    const item = parseItem(
      itemJSON({
        ledger: "evt-auto",
        domain: "capability",
        target: '{"domain":"capability","skillId":"skill-1"}',
        bucket: "automatic",
        execution: "automatic",
        result: "observing",
      }),
    );
    const withBudget = acceptEvolutionProject({
      access: "read-only",
      operation: "automatic",
      persisted: false,
      projection: {
        access: "read-only",
        actions: [
          {
            item,
            budget: {
              available: true,
              surfaceId: "agent.working-dna",
              mode: "auto",
              maxApplications: 2,
              usedApplications: 1,
              remainingApplications: 1,
              expiresAt: "2026-10-01T00:00:00Z",
              killSwitch: false,
            },
          },
        ],
      },
    });
    expect(withBudget.actions[0]?.budget).toEqual({
      kind: "provided",
      surfaceId: "agent.working-dna",
      mode: "auto",
      maxApplications: 2,
      usedApplications: 1,
      remainingApplications: 1,
      expiresAt: "2026-10-01T00:00:00Z",
      killSwitch: false,
    });

    const missing = acceptEvolutionProject({
      access: "read-only",
      operation: "automatic",
      persisted: false,
      projection: {
        actions: [{ item, budget: { available: false, surfaceId: "agent.working-dna" } }],
      },
    });
    expect(missing.actions[0]?.budget).toEqual({
      kind: "unavailable",
      surfaceId: "agent.working-dna",
    });
    expect(learnedEvolutionItems([])).toEqual([]);
  });

  it("denies the whole page when any slice is denied", () => {
    const denied = acceptEvolutionProject({
      access: "read-only",
      operation: "timeline",
      persisted: false,
      denial: { denied: true, reason: "permission_denied" },
      projection: null,
    });
    const ready = acceptEvolutionProject(
      projectPayload("digest", [parseItem(itemJSON({ ledger: "evt-human" }))]),
    );
    expect(evolutionPanelsFromSlices([ready, denied])).toEqual({ status: "denied" });
  });

  it("builds a read-only provenance sheet from the item", () => {
    const item = decodeOne(
      itemJSON({
        ledger: "evt-auto",
        proposal: "prop-auto",
        application: "app-auto",
        verification: "ver-auto",
        bucket: "automatic",
        execution: "automatic",
        result: "observing",
      }),
    );
    expect(item).toBeTruthy();
    if (!item) {
      return;
    }
    const detail = makeEvolutionFactDetail(item, WINDOW);
    expect(detail.isPlatform).toBe(false);
    expect(detail.audienceLabel).toBe("数字人");
    expect(evolutionFactDetailValue(detail, "账本事件")).toBe("evt-auto");
    expect(evolutionFactDetailValue(detail, "提案")).toBe("prop-auto");
    expect(evolutionFactDetailValue(detail, "应用")).toBe("app-auto");
    expect(evolutionFactDetailValue(detail, "验证")).toBe("ver-auto");
    expect(evolutionFactDetailValue(detail, "窗口")).toBe(
      "2026-09-18T00:00:00.000Z – 2026-09-25T00:00:00.000Z",
    );
    expect(detail.fields.some((field) => field.value.includes("还没学会"))).toBe(false);
  });
});

describe("evolution perception client", () => {
  it("uses the weekly-change refresh plan and stays on the method whitelist", () => {
    const plan = evolutionPerceptionRefreshPlan({ window: WINDOW, agentId: null });
    expect(plan).toHaveLength(6);
    expect(
      plan.slice(0, 5).every((call) => call.method === EVOLUTION_PERCEPTION_PROJECT_METHOD),
    ).toBe(true);
    expect(plan.map((call) => call.params.operation).slice(0, 5)).toEqual([
      "timeline",
      "digest",
      "pending",
      "automatic",
      "observation",
    ]);
    expect(plan[0]?.params.window).toBeUndefined();
    expect(plan[1]?.params.window).toEqual(WINDOW);
    expect(plan[2]?.params.window).toBeUndefined();
    expect(plan[3]?.params.window).toEqual(WINDOW);
    expect(plan[4]?.params.window).toBeUndefined();
    expect(plan[5]?.method).toBe(EVOLUTION_PERCEPTION_QUERY_METHOD);
    expect(plan[5]?.params.intent).toBe("learned_this_week");
    expect(plan[5]?.params.window).toEqual(WINDOW);
    expect(plan.every((call) => isEvolutionPerceptionMethodAllowed(call.method))).toBe(true);
    for (const call of plan) {
      expect(call.params).not.toHaveProperty("tenantScope");
      expect(call.params).not.toHaveProperty("sightings");
      expect(JSON.stringify(call.params)).not.toContain("tenantScope");
      expect(JSON.stringify(call.params)).not.toContain("sightings");
    }
    expect(EVOLUTION_PERCEPTION_METHODS).toEqual([
      "evolution.perception.query",
      "evolution.perception.project",
    ]);
    expect(isEvolutionPerceptionMethodAllowed("evolution.ledger.append")).toBe(false);
    expect(isEvolutionPerceptionMethodAllowed("evolution.apply")).toBe(false);
    expect(isEvolutionPerceptionMethodAllowed("ORCHESTRATION_LIVE_INVOKE")).toBe(false);
  });

  it("keeps empty copy from claiming that nothing was learned", () => {
    const copies = [
      EVOLUTION_PERCEPTION_COPY.empty,
      EVOLUTION_PERCEPTION_COPY.denied,
      EVOLUTION_PERCEPTION_COPY.untrusted,
      EVOLUTION_PERCEPTION_COPY.readOnlyReminder,
      EVOLUTION_PERCEPTION_COPY.successEmptyLead,
      EVOLUTION_PERCEPTION_COPY.errorLead,
    ];
    for (const copy of copies) {
      expect(copy).not.toContain("还没学会");
      expect(copy).not.toContain("学会了");
    }
    expect(EVOLUTION_PERCEPTION_COPY.empty).toBe("暂无可投影的记录");
    expect(EVOLUTION_PERCEPTION_COPY.weekChangeTitle).toBe("本周变化");
    expect(EVOLUTION_PERCEPTION_COPY.readOnlyBadge).toBe("只读");
    expect(Object.keys(EVOLUTION_PERCEPTION_COPY)).not.toContain("readOnlyHelper");
    const published = Object.values(EVOLUTION_PERCEPTION_COPY).join("\n");
    expect(published).not.toContain("数字人变化。平台变化不在这里。");
    expect(published).not.toContain("当前窗口。");
    expect(published).not.toContain("预算、TTL 和 kill switch");
    expect(published).not.toContain("平台变化，单独列出。");
    expect(published).not.toContain("rolled_back 桶");
  });

  it("strips legacy empty narration templates and formats dated success_empty copy", () => {
    const stripped = stripEvolutionEmptyNarration({
      learned: ["本窗口没有可追溯的数字人变化。", "数字人学会了可追溯变化 evt-1。"],
      platform: [],
      other: ["相对上一窗口，没有新的可追溯变化。"],
    });
    expect(stripped).toEqual({
      learned: ["数字人学会了可追溯变化 evt-1。"],
      platform: [],
      other: [],
    });
    expect(formatEvolutionSuccessEmptyCopy(WINDOW)).toBe(
      "这一周（2026-09-18 — 09-25）没有新的数字人变化。",
    );
    expect(formatEvolutionSuccessEmptyHint(WINDOW)).toBe(
      "这是正常状态。这 7 天的窗口内没有新的进化事件。",
    );
    expect(formatEvolutionSuccessEmptyHint({ from: "yesterday", to: "today" })).toBe(
      EVOLUTION_PERCEPTION_COPY.successEmptyHint,
    );
    expect(formatEvolutionEmptyLastChangeCopy(0)).toBe(
      EVOLUTION_PERCEPTION_COPY.successEmptyLastChangeUnknown,
    );
    expect(formatEvolutionEmptyLastChangeCopy(1)).toBe(
      "本窗口里查不到上次变化的时间。相对上周有 1 条，建议先查看。",
    );
    expect(formatEvolutionQueryAsOf(WINDOW.to)).toBe("2026-09-25 00:00 UTC");
    expect(formatEvolutionFreshnessCopy(WINDOW)).toContain("查询截至 2026-09-25 00:00 UTC");
    expect(formatEvolutionFreshnessCopy(WINDOW)).toContain("刷新是手动的");
    expect(formatEvolutionQueryAsOf("not-a-date")).toBeNull();
    expect(
      resolveEvolutionPerceptionUiStatus({
        loading: false,
        connected: true,
        phaseStatus: "failed",
        answer: null,
        answerError: null,
      }),
    ).toBe("error");
    expect(
      resolveEvolutionPerceptionUiStatus({
        loading: false,
        connected: true,
        phaseStatus: "loaded",
        answer: {
          state: "empty",
          intent: "learned_this_week",
          items: [],
          platformItems: [],
          narration: { learned: [], platform: [], other: [] },
          completeness: "empty",
          unresolvedIntents: [],
        },
        answerError: null,
      }),
    ).toBe("success_empty");
  });

  it("maps empty-template-only query payloads to empty state", () => {
    const query = acceptEvolutionQuery({
      access: "read-only",
      persisted: false,
      intent: "learned_this_week",
      denial: null,
      result: {
        items: [],
        platformItems: [],
        unresolvedIntents: [],
        completeness: "empty",
      },
      narration: {
        learned: ["本窗口没有可追溯的数字人变化。"],
        platform: [],
        other: [],
      },
      narrationGuard: null,
    });
    expect(query.state).toBe("empty");
    expect(query.narration).toEqual({ learned: [], platform: [], other: [] });
  });

  it("formats the weekly window as a short calendar range", () => {
    const sameYear = {
      from: "2026-09-18T14:05:29.784Z",
      to: "2026-09-25T14:05:29.784Z",
    };
    expect(formatEvolutionPerceptionWindowLabel(sameYear)).toBe("2026-09-18 – 09-25");
    expect(evolutionPerceptionWindowPrecision(sameYear)).toBe(
      "2026-09-18T14:05:29.784Z – 2026-09-25T14:05:29.784Z",
    );
    expect(
      formatEvolutionPerceptionWindowLabel({
        from: "2025-12-28T00:00:00.000Z",
        to: "2026-01-04T00:00:00.000Z",
      }),
    ).toBe("2025-12-28 – 2026-01-04");
    expect(formatEvolutionPerceptionWindowLabel({ from: "yesterday", to: "today" })).toBe(
      "yesterday – today",
    );
  });

  it("runs five projects then one learned_this_week query", async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const transport: EvolutionPerceptionTransport = {
      async request(method, params) {
        calls.push({ method, params });
        if (method === EVOLUTION_PERCEPTION_QUERY_METHOD) {
          return {
            access: "read-only",
            operation: "query",
            persisted: false,
            intent: "learned_this_week",
            denial: null,
            result: {
              items: [],
              platformItems: [],
              unresolvedIntents: [],
              completeness: "empty",
            },
            narration: null,
            narrationGuard: null,
          };
        }
        return {
          access: "read-only",
          operation: params.operation,
          persisted: false,
          projection: {
            items: [],
            learnedItems: [],
            actions: [],
            digitalHumanItems: [],
            platformItems: [],
            completeness: "empty",
          },
        };
      },
    };
    const snapshot = await refreshEvolutionPerception({
      transport,
      window: WINDOW,
      agentId: "  ",
    });
    expect(
      calls.filter((call) => call.method === EVOLUTION_PERCEPTION_PROJECT_METHOD),
    ).toHaveLength(5);
    expect(calls.at(-1)?.method).toBe(EVOLUTION_PERCEPTION_QUERY_METHOD);
    expect(calls.at(-1)?.params.intent).toBe("learned_this_week");
    expect(calls.every((call) => isEvolutionPerceptionMethodAllowed(call.method))).toBe(true);
    expect(calls.every((call) => !("agentId" in call.params))).toBe(true);
    expect(snapshot.phase.status).toBe("loaded");
    expect(snapshot.answer?.state).toBe("empty");
    expect(snapshot.answer?.intent).toBe("learned_this_week");
    expect(snapshot.selectedIntent).toBe("learned_this_week");
    expect(snapshot.answer?.narration.learned.join("") ?? "").not.toContain("学会了");
    expect(snapshot.answer?.narration.learned.join("") ?? "").not.toContain("还没学会");
  });

  it("skips the query and clears rows when a projection is denied", async () => {
    const calls: string[] = [];
    const transport: EvolutionPerceptionTransport = {
      async request(method, params) {
        calls.push(method);
        return {
          access: "read-only",
          operation: params.operation,
          persisted: false,
          denial: { denied: true, reason: "permission_denied" },
          projection: null,
        };
      },
    };
    const snapshot = await refreshEvolutionPerception({ transport, window: WINDOW });
    expect(calls).toEqual([
      EVOLUTION_PERCEPTION_PROJECT_METHOD,
      EVOLUTION_PERCEPTION_PROJECT_METHOD,
      EVOLUTION_PERCEPTION_PROJECT_METHOD,
      EVOLUTION_PERCEPTION_PROJECT_METHOD,
      EVOLUTION_PERCEPTION_PROJECT_METHOD,
    ]);
    expect(snapshot.phase).toEqual({ status: "denied" });
    expect(snapshot.answer).toBeNull();
  });
});

describe("employee system settings evolution tab", () => {
  it("places 进化 last and still opens on 安全与隐私", () => {
    expect(DEFAULT_WORKBENCH_SYSTEM_SETTINGS_TAB).toBe("security");
    expect(WORKBENCH_SYSTEM_SETTINGS_TAB_ORDER).toEqual([
      "security",
      "devices",
      "robots",
      "groups",
      "models",
      "evolution",
    ]);
  });

  it("does not send forbidden methods from the web perception modules", () => {
    const files = [
      new URL("./client.ts", import.meta.url),
      new URL("./mapping.ts", import.meta.url),
      new URL("./copy.ts", import.meta.url),
      new URL("../views/employee-evolution-perception-section.ts", import.meta.url),
    ];
    const source = files.map((file) => readFileSync(file, "utf8")).join("\n");
    expect(source).not.toContain("evolution.ledger");
    expect(source).not.toContain("ORCHESTRATION_LIVE_INVOKE");
    expect(source).not.toContain("evaluateSurfaceAutonomy");
    expect(source).not.toContain("还没学会");
    expect(source).toContain("evolution.perception.query");
    expect(source).toContain("evolution.perception.project");
  });

  it("humanizes employee-facing labels and strips ledger ids from narration", () => {
    expect(evolutionResultLabel("unspecified")).toBe("未指定");
    expect(evolutionReasonStatusLabel("specified")).toBe("已说明");
    expect(evolutionReasonStatusLabel("unspecified")).toBe("未说明");
    expect(evolutionSurfaceLabel("capability.skill-installation")).toBe("技能安装");
    expect(evolutionSurfaceLabel("agent.working-dna")).toBe("工作风格");
    const technical = JSON.parse(
      itemJSON({
        ledger:
          "led:gap-consumer-suggest:evo:capability-gap:5805152a4e64c445d3675700:cfff0af6-4fc9-4797-ae03-e51b09193817:suggested",
        domain: "capability",
        target: '{"domain":"capability","skillId":"skill-1"}',
        displayName: "能力",
        result: "unspecified",
        bucket: null,
      }),
    ) as EvolutionTimelineItem;
    // acceptTimelineItem path uses mapping; build a minimal item-shaped object for display helpers
    const item = {
      ...technical,
      changeObject: {
        target: { domain: "capability", skillId: "skill-1" },
        surfaceId: "capability.skill-installation",
        domain: "capability",
        domainDisplayName: "能力",
      },
      reason: { status: "specified", sourceEvidenceRefs: [], findingIds: [] },
      beforeAfter: { summary: "unavailable" },
      executionMode: "unknown",
      impactScope: { label: "企业" },
      reversible: true,
      result: "unspecified",
    } as EvolutionTimelineItem;
    expect(evolutionItemTitle(item)).toBe("能力");
    expect(evolutionFactRowLines(item)).toEqual([
      { label: "对象", value: "技能安装" },
      { label: "原因", value: "已说明" },
      { label: "影响", value: "企业" },
      { label: "可逆", value: "是" },
    ]);
    expect(presentEvolutionFact(item)).toEqual({
      signal: "sparse",
      title: "能力",
      story: "技能安装 · 影响企业 · 已说明 · 可逆",
    });
    const storyItem = {
      ...item,
      beforeAfter: { versionBefore: "1", versionAfter: "2", summary: "1 → 2" },
      executionMode: "user_confirmed",
      result: "verified_effective",
    } as EvolutionTimelineItem;
    const story = presentEvolutionFact(storyItem);
    expect(story.signal).toBe("story");
    expect(story.story).toContain("1 → 2");
    expect(story.story).toContain("用户确认");
    expect(story.story).not.toContain("未指定");
    const hollow = {
      ...item,
      changeObject: { ...item.changeObject, surfaceId: "" },
      reason: { status: "unspecified", sourceEvidenceRefs: [], findingIds: [] },
      impactScope: { label: "unspecified" },
      executionMode: "unknown",
      result: "unspecified",
      beforeAfter: { summary: "unavailable" },
    } as EvolutionTimelineItem;
    expect(presentEvolutionFact(hollow).signal).toBe("none");
    expect(presentEvolutionFact(hollow).story).toBe("");
    const panels = {
      timeline: [item, hollow],
      learned: [item],
      digest: [],
      pending: [],
      automatic: [],
      observation: [hollow],
      rollback: [],
    };
    expect(visibleEvolutionProjectionGroups(panels).map((group) => group.id)).toEqual(["learned"]);
    expect(visibleProjectionPanelCount(panels)).toBe(1);
    const auto = {
      ...storyItem,
      factIds: { ledgerEventId: "evt-auto" },
      executionMode: "automatic",
      bucket: "automatic",
    } as EvolutionTimelineItem;
    const autoAgain = {
      ...auto,
      factIds: { ledgerEventId: "evt-auto-2" },
    } as EvolutionTimelineItem;
    const shownApproved = {
      ...storyItem,
      bucket: "user_approved",
    } as EvolutionTimelineItem;
    const foldedPanels = {
      ...panels,
      timeline: [shownApproved],
      automatic: [
        { item: auto, budget: { kind: "unavailable" as const, surfaceId: "agent.working-dna" } },
        { item: hollow, budget: { kind: "unavailable" as const, surfaceId: "agent.working-dna" } },
      ],
    };
    expect(evolutionFoldedNotes(foldedPanels, [shownApproved])).toEqual([
      `有自动执行的变化：${presentEvolutionFact(auto).story}。`,
    ]);
    expect(evolutionFoldedNotes(foldedPanels, [shownApproved, auto])).toEqual([]);
    expect(
      evolutionFoldedNotes(
        {
          ...foldedPanels,
          timeline: [],
          automatic: [
            { item: auto, budget: { kind: "unavailable" as const, surfaceId: "a" } },
            { item: autoAgain, budget: { kind: "unavailable" as const, surfaceId: "b" } },
          ],
        },
        [],
      ),
    ).toEqual(["有自动执行的变化。"]);
    const raw =
      "相对上一窗口，可追溯变化 led:gap-consumer-suggest:evo:capability-gap:5805152a4e64c445d3675700:cfff0af6-4fc9-4797-ae03-e51b09193817:suggested（能力，unspecified）。";
    const humanized = humanizeEvolutionNarrationLine(raw);
    expect(humanized).not.toContain("led:");
    expect(humanized).not.toContain("unspecified");
    expect(humanized).toContain("能力");
    expect(humanized).toContain("未指定");
    expect(humanized).toContain("变化");
  });
});
