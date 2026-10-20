// @vitest-environment jsdom
import { render } from "lit";
import { beforeAll, describe, expect, it } from "vitest";
import { i18n } from "../../i18n/index.ts";
import { zh_CN } from "../../i18n/locales/zh-CN.ts";
import type {
  DataCapabilityDescriptor,
  KnowledgeCapabilityInvocationState,
} from "../capability/knowledge-universe/types.ts";
import { renderKnowledgeUniverseDataCapabilitySpace } from "./knowledge-universe-data-capability-card.ts";

beforeAll(async () => {
  i18n.registerTranslation("zh-CN", zh_CN);
  await i18n.setLocale("zh-CN");
});

function capability(
  partial: Partial<DataCapabilityDescriptor> & Pick<DataCapabilityDescriptor, "id">,
): DataCapabilityDescriptor {
  return {
    id: partial.id,
    title: partial.title ?? "CRM 客户画像",
    summary: partial.summary ?? "客户主数据画像能力",
    sourceSystems: partial.sourceSystems ?? ["Salesforce"],
    scenarios: partial.scenarios ?? ["客户洞察"],
    visibleAgents: partial.visibleAgents ?? [],
    scopeLabel: partial.scopeLabel,
    accessState: partial.accessState ?? "granted",
    isSample: partial.isSample,
    freshness: partial.freshness,
  };
}

function renderSpace(
  capabilities: DataCapabilityDescriptor[],
  invocation?: KnowledgeCapabilityInvocationState | null,
): HTMLElement {
  const container = document.createElement("div");
  render(
    renderKnowledgeUniverseDataCapabilitySpace({
      capabilities,
      externalDataSources: [],
      requestingCapabilityId: null,
      accessRequestNotice: null,
      onRequestAccess: () => undefined,
      onInvokeCapability: () => undefined,
      capabilityInvocation: invocation ?? null,
    }),
    container,
  );
  return container;
}

describe("data capability card freshness badge", () => {
  it("renders a stale badge when supply freshness is stale", () => {
    const container = renderSpace([capability({ id: "cap-stale", freshness: "stale" })]);
    const badge = container.querySelector(".knowledge-universe__data-capability-card-badge--stale");
    expect(badge).toBeTruthy();
    expect(badge?.textContent?.trim()).toBe("陈旧");
    expect(badge?.getAttribute("title")).toBe(
      "已写入的供给记录已过期。打开本页不会重新查询连接器。",
    );
    expect(badge?.getAttribute("title")).not.toContain("已断开");
  });

  it("renders an unsupplied badge when freshness is unknown or missing", () => {
    const unknown = renderSpace([capability({ id: "cap-unknown", freshness: "unknown" })]);
    const unknownBadge = unknown.querySelector(
      ".knowledge-universe__data-capability-card-badge--unknown",
    );
    expect(unknownBadge?.textContent?.trim()).toBe("未供给");
    expect(unknownBadge?.getAttribute("title")).toBe(
      "还没有已写入的供给记录。连接器是否连通不代表这里有可消费内容。",
    );
    expect(
      unknown.querySelector(".knowledge-universe__data-capability-card-badge--stale"),
    ).toBeNull();

    const missing = renderSpace([capability({ id: "cap-missing" })]);
    expect(
      missing.querySelector(".knowledge-universe__data-capability-card-badge--unknown")
        ?.textContent,
    ).toContain("未供给");
  });

  it("omits the freshness badge when the capability is fresh", () => {
    const fresh = renderSpace([capability({ id: "cap-fresh", freshness: "fresh" })]);
    expect(
      fresh.querySelector(".knowledge-universe__data-capability-card-badge--stale"),
    ).toBeNull();
    expect(
      fresh.querySelector(".knowledge-universe__data-capability-card-badge--unknown"),
    ).toBeNull();
  });

  it("renders the sample and stale badges together", () => {
    const container = renderSpace([
      capability({ id: "cap-sample", isSample: true, freshness: "stale" }),
    ]);
    expect(
      container.querySelector(".knowledge-universe__data-capability-card-badge--sample"),
    ).toBeTruthy();
    expect(
      container.querySelector(".knowledge-universe__data-capability-card-badge--stale"),
    ).toBeTruthy();
  });
});

describe("data capability supply note action", () => {
  const granted = capability({ id: "cap-granted", accessState: "granted" });

  it("labels the idle action as a supply note", () => {
    const container = renderSpace([granted]);
    expect(
      container.querySelector("[data-testid='ku-capability-invoke-btn']")?.textContent,
    ).toContain("查看供给说明");
  });

  it("shows the reading label while the supply note is loading", () => {
    const container = renderSpace([granted], {
      capabilityId: "cap-granted",
      busy: true,
      ok: false,
      accessState: "granted",
      reason: null,
      data: null,
      auditId: null,
      error: null,
    });
    expect(
      container.querySelector("[data-testid='ku-capability-invoke-btn']")?.textContent,
    ).toContain("读取中…");
  });

  it("says the current seat is not authorized", () => {
    const container = renderSpace([granted], {
      capabilityId: "cap-granted",
      busy: false,
      ok: false,
      accessState: "requestable",
      reason: null,
      data: null,
      auditId: null,
      error: null,
    });
    expect(container.textContent).toContain("当前席位未获授权");
  });

  it("places the supply note under a successful summary", () => {
    const container = renderSpace([granted], {
      capabilityId: "cap-granted",
      busy: false,
      ok: true,
      accessState: "granted",
      reason: null,
      data: {
        title: "CRM",
        summary: "已写入的客户画像供给",
        sourceSystems: [],
        scenarios: [],
        freshness: "unknown",
      },
      auditId: null,
      error: null,
    });
    const result = container.querySelector(".knowledge-universe__data-capability-invoke-result");
    const summary = result?.querySelector(".knowledge-universe__data-capability-invoke-summary");
    const note = result?.querySelector(".knowledge-universe__data-capability-invoke-note");
    expect(summary?.textContent).toContain("已写入的客户画像供给");
    expect(note?.textContent).toContain("不是连接器实时查询结果");
    expect(summary?.nextElementSibling).toBe(note);
    expect(container.textContent).toContain("未知");
  });
});
