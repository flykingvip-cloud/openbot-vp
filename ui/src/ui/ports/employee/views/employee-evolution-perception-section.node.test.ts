// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import "./employee-evolution-perception-section.ts";
import { EVOLUTION_PERCEPTION_COPY } from "../evolution-perception/copy.ts";

type Call = { method: string; params: Record<string, unknown> };

const humanItem = {
  schemaVersion: 1,
  proposalSchema: 2,
  legacy: false,
  factIds: {
    ledgerEventId: "evt-human",
    proposalId: "prop-human",
    applicationId: "app-human",
    verificationId: "ver-human",
  },
  audience: "digital_human",
  changeObject: {
    target: { domain: "agent", agentId: "a1" },
    surfaceId: "agent.working-dna",
    domain: "agent",
    domainDisplayName: "数字人",
  },
  beforeAfter: { versionBefore: "1", versionAfter: "2", summary: "1 → 2" },
  reason: {
    status: "specified",
    sourceEvidenceRefs: ["ev-1"],
    sourceMechanismRef: "mech-1",
    caseId: "case-1",
    findingIds: ["find-1"],
  },
  executionMode: "user_confirmed",
  evidence: { evidenceRefs: ["ev-1"], reportId: "rep-1", verificationId: "ver-human" },
  result: "verified_effective",
  bucket: "user_approved",
  impactScope: { label: "本人" },
  reversible: true,
  completeness: "complete",
};

function emptyProject(operation: unknown) {
  return {
    access: "read-only",
    operation,
    persisted: false,
    projection: {
      items: operation === "timeline" ? [humanItem] : [],
      learnedItems: operation === "timeline" ? [humanItem] : [],
      actions: [],
      digitalHumanItems: [],
      platformItems: [],
      completeness: operation === "timeline" ? "complete" : "empty",
    },
  };
}

function fullyEmptyProject(operation: unknown) {
  return {
    access: "read-only",
    operation,
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
}

function scriptedClient(query: unknown, project: (operation: unknown) => unknown = emptyProject) {
  const calls: Call[] = [];
  const client = {
    connected: true,
    async request(method: string, params: Record<string, unknown>) {
      calls.push({ method, params });
      if (method === "evolution.perception.query") {
        return query;
      }
      return project(params.operation);
    },
  };
  return { calls, client };
}

function mount(
  client: { request: (method: string, params: Record<string, unknown>) => Promise<unknown> } | null,
  connected: boolean,
) {
  const host = document.createElement("div");
  document.body.append(host);
  const el = document.createElement("employee-evolution-perception-section");
  el.client = client as never;
  el.connected = connected;
  host.append(el);
  return host;
}

function chipByTitle(host: HTMLElement, title: string) {
  return [...host.querySelectorAll("button")].find((button) =>
    button.getAttribute("aria-label")?.startsWith(`${title}，`),
  );
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("employee evolution perception section", () => {
  it("loads 本周变化 and keeps 更多投影 collapsed when there is data", async () => {
    const { calls, client } = scriptedClient({
      access: "read-only",
      persisted: false,
      intent: "learned_this_week",
      denial: null,
      result: {
        items: [humanItem],
        platformItems: [],
        unresolvedIntents: [],
        completeness: "complete",
      },
      narration: null,
      narrationGuard: null,
    });
    const host = mount(client, true);
    await vi.waitFor(() => {
      expect(host.textContent).toContain("数字人");
      expect(host.textContent).toContain("工作风格");
    });
    expect(host.textContent).toContain(EVOLUTION_PERCEPTION_COPY.weekChangeTitle);
    expect(host.textContent).toContain(EVOLUTION_PERCEPTION_COPY.readOnlyBadge);
    expect(host.textContent).not.toContain("进化记录由系统自动生成");
    expect(host.textContent).not.toContain("evt-human");
    expect(host.textContent).not.toContain("agent.working-dna");
    expect(host.textContent).toContain("已说明");
    expect(host.textContent).not.toContain("周报窗口");
    expect(host.textContent).not.toContain("还没学会");
    for (const note of [
      "数字人变化。平台变化不在这里。",
      "当前窗口。",
      "预算、TTL 和 kill switch 只展示投影里已有的字段。",
      "平台变化，单独列出。",
      "来自 rolled_back 桶。",
    ]) {
      expect(host.textContent).not.toContain(note);
    }
    expect(host.querySelectorAll(".employee-workbench__settings-section-title")).toHaveLength(1);
    expect(
      host.querySelector(
        ".employee-evolution-perception__hero .employee-workbench__settings-section-title",
      ),
    ).toBeNull();
    expect(
      host
        .querySelector(
          ".employee-evolution-perception__heading .employee-evolution-perception__badge",
        )
        ?.getAttribute("title"),
    ).toBe(EVOLUTION_PERCEPTION_COPY.readOnlyReminder);
    const windowLabel = host.querySelector("[data-evolution-window]");
    const visibleWindow = windowLabel?.querySelector("[aria-hidden]")?.textContent?.trim() ?? "";
    expect(visibleWindow).toMatch(/^\d{4}-\d{2}-\d{2} – \d{2}-\d{2}$/);
    expect(visibleWindow).not.toContain("T");
    const precision = windowLabel?.getAttribute("title") ?? "";
    expect(precision).toMatch(/^\d{4}-\d{2}-\d{2}T.+Z – \d{4}-\d{2}-\d{2}T.+Z$/);
    expect(windowLabel?.getAttribute("aria-label")).toBe(precision);
    const details = host.querySelector("details");
    expect(details?.open).toBe(false);
    expect(details?.querySelector("summary")?.textContent).toContain(
      EVOLUTION_PERCEPTION_COPY.moreProjections,
    );
    expect(calls.filter((call) => call.method === "evolution.perception.project")).toHaveLength(5);
    expect(calls.at(-1)).toMatchObject({
      method: "evolution.perception.query",
      params: { intent: "learned_this_week" },
    });
    expect(
      calls.every((call) => !("tenantScope" in call.params) && !("sightings" in call.params)),
    ).toBe(true);

    const weekChip = chipByTitle(host, "本周变化");
    expect(weekChip?.textContent).toContain("1");
    const chips = [
      ...host.querySelectorAll<HTMLButtonElement>(".employee-evolution-perception__chips button"),
    ];
    expect(chips.map((chip) => chip.textContent?.replace(/\s+/g, ""))).toEqual([
      "本周变化1",
      "相对上周1",
    ]);
    for (const title of ["哪些自动", "哪些批准", "哪些观察", "哪些回滚", "平台升级"]) {
      expect(
        host.querySelector(".employee-evolution-perception__chips")?.textContent,
      ).not.toContain(title);
    }
    expect(host.querySelector("[data-evolution-folded]")).toBeNull();

    host.querySelector<HTMLButtonElement>(".employee-evolution-perception__row")?.click();
    await vi.waitFor(() => {
      expect(host.textContent).toContain(EVOLUTION_PERCEPTION_COPY.provenanceTitle);
      expect(host.textContent).toContain(EVOLUTION_PERCEPTION_COPY.readOnlyReminder);
    });
    expect(host.textContent).toContain("evt-human");
    expect(host.textContent).toContain("prop-human");
    const buttonLabels = [...host.querySelectorAll("button")].map((button) =>
      button.textContent?.replace(/\s+/g, " ").trim(),
    );
    expect(buttonLabels).not.toContain("批准");
    expect(buttonLabels).not.toContain("应用");
    expect(buttonLabels).toContain(EVOLUTION_PERCEPTION_COPY.close);
  });

  it("renders a healthy zero-change week without auto-opening projections", async () => {
    const { calls, client } = scriptedClient(
      {
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
      },
      fullyEmptyProject,
    );
    const host = mount(client, true);
    await vi.waitFor(() => {
      expect(
        host.querySelector("[data-evolution-ui-status]")?.getAttribute("data-evolution-ui-status"),
      ).toBe("success_empty");
    });
    expect(host.textContent).toContain("没有新的数字人变化");
    expect(host.textContent).toContain("这是正常状态");
    expect(host.textContent).toContain("天的窗口内没有新的进化事件");
    expect(host.textContent).toContain(EVOLUTION_PERCEPTION_COPY.successEmptyLastChangeUnknown);
    expect(host.textContent).toContain(EVOLUTION_PERCEPTION_COPY.ctaViewDiff);
    expect(host.textContent).toContain("刷新是手动的");
    expect(host.querySelector("[data-evolution-freshness]")?.textContent).toContain("查询截至");
    expect(host.textContent).not.toContain("本窗口没有可追溯的数字人变化。");
    expect(host.textContent).not.toContain("还没学会");
    expect(host.textContent).not.toContain(EVOLUTION_PERCEPTION_COPY.errorLead);
    expect(host.textContent).not.toContain("建议先查看");
    const relativeCta = host.querySelector<HTMLButtonElement>(
      "[data-evolution-cta='diff_from_last_week']",
    );
    expect(relativeCta?.classList.contains("primary")).toBe(false);
    expect(chipByTitle(host, "相对上周")?.classList.contains("is-suggested")).toBe(false);
    const details = host.querySelector("details");
    expect(details?.open).toBe(false);
    expect(details?.querySelector("summary")?.textContent).toContain("（0）");
    expect(host.textContent).toContain(EVOLUTION_PERCEPTION_COPY.projectionsEmpty);
    expect(host.textContent?.match(/暂无可投影的记录/g) ?? []).toHaveLength(0);
    const chips = [
      ...host.querySelectorAll<HTMLButtonElement>(".employee-evolution-perception__chips button"),
    ];
    expect(chips).toHaveLength(2);
    expect(chipByTitle(host, "本周变化")?.textContent).toContain("0");
    expect(chipByTitle(host, "相对上周")?.textContent).toContain("0");
    for (const title of ["哪些自动", "哪些批准", "哪些观察", "哪些回滚", "平台升级"]) {
      expect(chipByTitle(host, title)).toBeUndefined();
    }
    expect(host.querySelector("[data-evolution-folded]")).toBeNull();
    const before = calls.length;
    chipByTitle(host, "相对上周")?.click();
    await vi.waitFor(() => {
      expect(calls.length).toBeGreaterThan(before);
      expect(calls.at(-1)).toMatchObject({
        method: "evolution.perception.query",
        params: { intent: "diff_from_last_week" },
      });
    });
  });

  it("points a zero week at 相对上周 and keeps sparse projections to one line", async () => {
    const sparseItem = {
      ...humanItem,
      factIds: {
        ledgerEventId: "evt-sparse",
        proposalId: "prop-sparse",
      },
      changeObject: {
        target: { domain: "capability", skillId: "skill-1" },
        surfaceId: "capability.skill-installation",
        domain: "capability",
        domainDisplayName: "能力",
      },
      beforeAfter: { summary: "unavailable" },
      reason: { status: "specified", sourceEvidenceRefs: [], findingIds: [] },
      executionMode: "unknown",
      evidence: { evidenceRefs: [] },
      result: "unspecified",
      bucket: undefined,
      impactScope: { label: "企业" },
      reversible: true,
      completeness: "partial",
    };
    const hollowItem = {
      ...sparseItem,
      factIds: { ledgerEventId: "evt-hollow" },
      changeObject: {
        ...sparseItem.changeObject,
        surfaceId: "",
        domainDisplayName: "能力",
      },
      reason: { status: "unspecified", sourceEvidenceRefs: [], findingIds: [] },
      impactScope: { label: "unspecified" },
    };
    const { client } = scriptedClient(
      {
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
        narration: null,
        narrationGuard: null,
      },
      (operation) => {
        if (operation !== "timeline") {
          return fullyEmptyProject(operation);
        }
        return {
          access: "read-only",
          operation,
          persisted: false,
          projection: {
            items: [sparseItem, hollowItem],
            learnedItems: [sparseItem, hollowItem],
            actions: [],
            digitalHumanItems: [],
            platformItems: [],
            completeness: "partial",
          },
        };
      },
    );
    const host = mount(client, true);
    await vi.waitFor(() => {
      expect(
        host.querySelector("[data-evolution-ui-status]")?.getAttribute("data-evolution-ui-status"),
      ).toBe("success_empty");
    });
    const details = host.querySelector("details");
    expect(details?.open).toBe(false);
    expect(details?.querySelector("summary")?.textContent).toContain("更多投影（1）");
    expect(host.textContent).toContain("没有新的数字人变化");
    expect(host.textContent).toContain("相对上周有 2 条，建议先查看");
    expect(
      host
        .querySelector("[data-evolution-cta='diff_from_last_week']")
        ?.classList.contains("primary"),
    ).toBe(true);
    expect(chipByTitle(host, "相对上周")?.classList.contains("is-suggested")).toBe(true);
    expect(chipByTitle(host, "相对上周")?.getAttribute("data-evolution-suggest")).toBe("relative");
    expect(host.textContent).toContain("技能安装 · 影响企业 · 已说明 · 可逆");
    expect(host.textContent).not.toContain("前后版本不可用");
    expect(host.textContent).not.toContain("未知");
    expect(host.textContent).not.toContain("未指定");
    expect(host.textContent).not.toContain("未提供");
    expect(host.textContent).not.toContain(EVOLUTION_PERCEPTION_COPY.projectionsEmpty);
    expect(host.querySelectorAll("[data-evolution-signal='sparse']")).toHaveLength(1);
    expect(host.querySelector("[data-evolution-signal='none']")).toBeNull();
    const hero = host.querySelector(".employee-evolution-perception__hero");
    expect(hero?.textContent).toContain("这是正常状态");
    expect(hero?.textContent).not.toContain("技能安装");
    host
      .querySelector<HTMLButtonElement>(
        ".employee-evolution-perception__empty-actions .btn:nth-child(2)",
      )
      ?.click();
    await vi.waitFor(() => {
      expect(details?.open).toBe(true);
    });
    expect(hero?.textContent).not.toContain("技能安装");
  });

  it("folds a meaningful automatic change into the empty week without a new chip", async () => {
    const automaticItem = {
      ...humanItem,
      factIds: { ledgerEventId: "evt-auto", proposalId: "prop-auto" },
      executionMode: "automatic",
      result: "observing",
      bucket: "automatic",
    };
    const hollowAutomatic = {
      ...automaticItem,
      factIds: { ledgerEventId: "evt-auto-hollow" },
      changeObject: { ...automaticItem.changeObject, surfaceId: "" },
      beforeAfter: { summary: "unavailable" },
      reason: { status: "unspecified", sourceEvidenceRefs: [], findingIds: [] },
      executionMode: "unknown",
      result: "unspecified",
      impactScope: { label: "unspecified" },
    };
    const { client } = scriptedClient(
      {
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
        narration: null,
        narrationGuard: null,
      },
      (operation) => {
        if (operation !== "automatic") {
          return fullyEmptyProject(operation);
        }
        return {
          access: "read-only",
          operation,
          persisted: false,
          projection: {
            items: [],
            learnedItems: [],
            actions: [
              { item: automaticItem, budget: { available: false, surfaceId: "agent.working-dna" } },
              {
                item: hollowAutomatic,
                budget: { available: false, surfaceId: "agent.working-dna" },
              },
            ],
            digitalHumanItems: [],
            platformItems: [],
            completeness: "partial",
          },
        };
      },
    );
    const host = mount(client, true);
    await vi.waitFor(() => {
      expect(host.querySelector("[data-evolution-folded]")?.textContent).toContain(
        "有自动执行的变化",
      );
    });
    const folded = [...host.querySelectorAll("[data-evolution-folded]")].map((node) =>
      node.textContent?.trim(),
    );
    expect(folded).toEqual([
      "有自动执行的变化：工作风格 · 1 → 2 · 自动 · 影响本人 · 已说明 · 观察中 · 可逆。",
    ]);
    expect(host.textContent).toContain("没有新的数字人变化");
    expect(host.querySelector(".employee-evolution-perception__chips")?.textContent).not.toContain(
      "哪些自动",
    );
    expect(host.querySelectorAll(".employee-evolution-perception__chips button")).toHaveLength(2);
    expect(host.textContent).not.toMatch(/有自动执行的变化：.*\d+ 条/);
  });

  it("renders error state with retry and never reuses success_empty copy", async () => {
    const { client } = scriptedClient({
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
      narration: null,
      narrationGuard: null,
    });
    const failing = {
      connected: true,
      async request(method: string, params: Record<string, unknown>) {
        if (method === "evolution.perception.project") {
          throw new Error("gateway timeout");
        }
        return client.request(method, params);
      },
    };
    const host = mount(failing, true);
    await vi.waitFor(() => {
      expect(
        host.querySelector("[data-evolution-ui-status]")?.getAttribute("data-evolution-ui-status"),
      ).toBe("error");
    });
    expect(host.textContent).toContain(EVOLUTION_PERCEPTION_COPY.errorLead);
    expect(host.textContent).toContain(EVOLUTION_PERCEPTION_COPY.retry);
    expect(host.textContent).toContain("gateway timeout");
    expect(host.textContent).not.toContain("没有新的数字人变化");
    expect(host.textContent).not.toContain("本窗口没有可追溯");
    expect(chipByTitle(host, "本周变化")?.textContent).toContain("—");
  });

  it("shows the denied copy and does not invent rows", async () => {
    const { client } = scriptedClient({
      access: "read-only",
      persisted: false,
      intent: "learned_this_week",
      denial: { denied: true, reason: "permission_denied" },
      result: {
        items: [humanItem],
        platformItems: [],
        unresolvedIntents: [],
        completeness: "complete",
      },
      narration: { learned: ["数字人学会了说话。"], platform: [], other: [] },
      narrationGuard: null,
    });
    const host = mount(client, true);
    await vi.waitFor(() => {
      expect(host.textContent).toContain(EVOLUTION_PERCEPTION_COPY.denied);
    });
    expect(host.textContent).not.toContain("evt-human");
    expect(host.textContent).not.toContain("学会了");
    expect(host.textContent).not.toContain("还没学会");
    expect(host.querySelector(".employee-evolution-perception__row")).toBeNull();
  });

  it("stays offline without calling the gateway", async () => {
    const request = vi.fn();
    const host = mount({ request }, false);
    await vi.waitFor(() => {
      expect(host.textContent).toContain(EVOLUTION_PERCEPTION_COPY.offline);
    });
    expect(request).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain("还没学会");
  });
});
