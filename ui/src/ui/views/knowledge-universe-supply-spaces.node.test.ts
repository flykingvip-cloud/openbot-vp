// @vitest-environment jsdom
import { render } from "lit";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/index.ts";
import { zh_CN } from "../../i18n/locales/zh-CN.ts";
import type { KnowledgeBaseSummary } from "../capability/knowledge-universe/workspace-endpoints.ts";
import type { WorkbenchKnowledgeSurface } from "../ports/employee/views/home-page-contracts.ts";
import {
  renderKnowledgeUniverseEnterpriseSupplySpaces,
  renderKnowledgeUniverseSupplySpaceSection,
} from "./knowledge-universe-supply-spaces.ts";

beforeAll(async () => {
  i18n.registerTranslation("zh-CN", zh_CN);
  await i18n.setLocale("zh-CN");
});

function kb(id: string, visibility: KnowledgeBaseSummary["visibility"]): KnowledgeBaseSummary {
  return {
    id,
    title: `${visibility} space`,
    description: "",
    documentCount: 1,
    visibility,
    updatedAtMs: Date.now(),
  };
}

function surface(
  knowledgeBases: KnowledgeBaseSummary[],
  handlers?: Partial<WorkbenchKnowledgeSurface>,
): WorkbenchKnowledgeSurface {
  return {
    knowledgeBases,
    selectedKnowledgeBaseId: null,
    onSelectKnowledgeBase: vi.fn(),
    onPageTabChange: vi.fn(),
    onNewKnowledgeBaseVisibilityChange: vi.fn(),
    ...handlers,
  } as unknown as WorkbenchKnowledgeSurface;
}

describe("knowledge-universe-supply-spaces", () => {
  it("renders personal supply spaces from knowledgeBases instead of a parallel pool", () => {
    const container = document.createElement("div");
    const mock = surface([kb("kb-private", "private"), kb("kb-team", "team")]);
    render(renderKnowledgeUniverseSupplySpaceSection(mock, "private"), container);
    expect(container.textContent).toContain("private space");
    expect(container.textContent).not.toContain("team space");
  });

  it("shows empty state with create action when no spaces exist for visibility", () => {
    const container = document.createElement("div");
    const onPageTabChange = vi.fn();
    const onNewKnowledgeBaseVisibilityChange = vi.fn();
    const mock = surface([], { onPageTabChange, onNewKnowledgeBaseVisibilityChange });
    render(renderKnowledgeUniverseSupplySpaceSection(mock, "enterprise"), container);
    expect(
      container.querySelector('[data-testid="ku-supply-spaces-empty-enterprise"]'),
    ).toBeTruthy();
    container.querySelector("button")?.click();
    expect(onNewKnowledgeBaseVisibilityChange).toHaveBeenCalledWith("enterprise");
    expect(onPageTabChange).toHaveBeenCalledWith("libraryCreate");
  });

  it("groups enterprise supply view into team and enterprise sections", () => {
    const container = document.createElement("div");
    const mock = surface([kb("kb-team", "team"), kb("kb-enterprise", "enterprise")]);
    render(renderKnowledgeUniverseEnterpriseSupplySpaces(mock), container);
    expect(container.textContent).toContain("team space");
    expect(container.textContent).toContain("enterprise space");
  });
});
