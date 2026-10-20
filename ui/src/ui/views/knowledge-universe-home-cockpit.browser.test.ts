// @vitest-environment jsdom
// Visual + structural coverage for the rebuilt knowledge home cockpit.
//
// Dual-mode by design (matches the repo convention for `*.browser.test.ts`):
//   - Root `pnpm test` collects this file under jsdom (this is what CI runs). The structural
//     describe runs there and guards the home grid + homeFocus linkage.
//   - `pnpm -C ui test` runs it in real chromium (Vitest browser mode). Only there does
//     `expect.element(...).toMatchScreenshot()` exist, so the pixel describe is gated behind a
//     browser-mode probe and skipped under jsdom (which has no pixel-screenshot infrastructure).
import { render } from "lit";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/index.ts";
import type { KnowledgeGovernanceTask } from "../capability/knowledge-universe/endpoints.ts";
import { buildHomeGraphViewModel } from "../capability/knowledge-universe/graph-layout.ts";
import type {
  KnowledgeActionSuggestion,
  RelationshipGraph,
} from "../capability/knowledge-universe/types.ts";
import type {
  KnowledgeBaseDocumentSummaryDto,
  KnowledgeBaseSummary,
  WorkspaceDeliverableDto,
} from "../capability/knowledge-universe/workspace-endpoints.ts";
import type {
  KnowledgeHomeFocus,
  WorkbenchKnowledgeSurface,
} from "../ports/employee/views/home-page-contracts.ts";
import { resetGraphAutoCenterStateForTests } from "./knowledge-universe-graph-canvas.ts";
import {
  renderKnowledgeUniverseHomeCockpit,
  type KnowledgeUniverseHomeCockpitOptions,
} from "./knowledge-universe-home-cockpit.ts";
import "../../styles.css";

/**
 * `expect.element` (and `toMatchScreenshot`) only exist in Vitest browser mode. Under the root
 * jsdom run this probe is false, so the pixel describe is skipped and CI stays green on structural
 * assertions alone.
 */
const canPixelScreenshot =
  typeof (expect as unknown as { element?: unknown }).element === "function";

const HOME_GRAPH: RelationshipGraph = {
  nodes: [
    { id: "node:me", kind: "owner", title: "我" },
    { id: "node:policy", kind: "knowledge-object", title: "考勤制度 v3", objectId: "doc-policy" },
    { id: "node:comp", kind: "knowledge-object", title: "薪酬结构说明", objectId: "doc-comp" },
    { id: "node:handbook", kind: "knowledge-object", title: "员工手册", objectId: "obj-handbook" },
  ],
  edges: [
    { sourceId: "node:me", targetId: "node:policy", relationType: "related", score: 92 },
    { sourceId: "node:policy", targetId: "node:comp", relationType: "conflicts", score: 41 },
    { sourceId: "node:policy", targetId: "node:handbook", relationType: "related", score: 83 },
    { sourceId: "node:me", targetId: "node:comp", relationType: "related", score: 70 },
  ],
};

const KNOWLEDGE_BASES: KnowledgeBaseSummary[] = [
  {
    id: "kb-hr",
    title: "人力资源管理",
    description: "考勤、薪酬、招聘",
    documentCount: 12,
    conflictCount: 2,
    governanceStatus: "conflict",
    visibility: "enterprise",
    updatedAtMs: 3,
  },
  {
    id: "kb-sales",
    title: "销售知识库",
    description: "话术与案例",
    documentCount: 8,
    governanceStatus: "attention",
    visibility: "team",
    updatedAtMs: 2,
  },
  {
    id: "kb-notes",
    title: "我的随笔",
    description: "个人草稿",
    documentCount: 5,
    governanceStatus: "healthy",
    visibility: "private",
    updatedAtMs: 1,
  },
];

const HR_DOCUMENTS: KnowledgeBaseDocumentSummaryDto[] = [
  { docId: "doc-policy", title: "考勤制度 v3" },
  { docId: "doc-comp", title: "薪酬结构说明" },
  { docId: "doc-onboard", title: "入职流程手册" },
] as unknown as KnowledgeBaseDocumentSummaryDto[];

const DELIVERABLES: WorkspaceDeliverableDto[] = [
  {
    deliverableId: "dlv-report",
    title: "Q2 人力分析报告",
    kind: "report",
    source: "agent",
    governanceStatus: "verified",
    relatedKnowledgeBaseId: "kb-hr",
    creators: [],
    status: "done",
    updatedAtMs: 3,
  },
  {
    deliverableId: "dlv-weekly",
    title: "招聘周报",
    kind: "note",
    source: "chat",
    governanceStatus: "pending",
    creators: [],
    status: "draft",
    updatedAtMs: 2,
  },
  {
    deliverableId: "dlv-flow",
    title: "入职流程编排",
    kind: "workflow",
    source: "task",
    governanceStatus: "conflict",
    creators: [],
    status: "in_progress",
    updatedAtMs: 1,
  },
] as unknown as WorkspaceDeliverableDto[];

const ACTION_SUGGESTIONS: KnowledgeActionSuggestion[] = [
  {
    actionId: "act-conflict",
    actionType: "review_conflict",
    title: "复核考勤制度与薪酬结构的冲突",
    reason: "两条政策对加班时长口径不一致",
    score: 92,
    context: {
      objectId: "doc-policy",
      targetObjectId: "doc-comp",
      governanceTaskId: "task-conflict",
      knowledgeBaseId: "kb-hr",
    },
    executable: true,
  },
  {
    actionId: "act-merge",
    actionType: "merge_duplicate",
    title: "合并重复的员工手册条目",
    reason: "两个版本内容高度相似",
    score: 78,
    context: { objectId: "obj-handbook", knowledgeBaseId: "kb-hr" },
    executable: true,
  },
];

const GOVERNANCE_TASKS: KnowledgeGovernanceTask[] = [
  {
    id: "task-conflict",
    kbId: "kb-hr",
    taskType: "conflict",
    status: "open",
    priority: 1,
    relatedChunkIds: ["chunk-policy", "chunk-comp"],
    proposedResolution: null,
    assignedTo: null,
    createdAt: 0,
    updatedAt: 0,
  },
];

function createHomeSurface(overrides: Partial<WorkbenchKnowledgeSurface> = {}) {
  const graph = overrides.graph ?? HOME_GRAPH;
  const base = {
    loading: false,
    error: null,
    query: "",
    searchScope: "workspace",
    searchPanelOpen: false,
    selectedNodeId: null,
    hoveredNodeId: null,
    homeFocus: null,
    graph,
    graphViewModel: buildHomeGraphViewModel(graph),
    graphZoom: 1,
    graphPanX: 0,
    graphPanY: 0,
    knowledgeBases: KNOWLEDGE_BASES,
    selectedKnowledgeBaseId: "kb-hr",
    kbSearchQuery: "",
    pinnedKnowledgeBaseIds: [],
    favoriteKnowledgeBaseIds: [],
    expandedKnowledgeBaseIds: ["kb-hr"],
    treeDocumentsByKbId: {},
    treeSourcesByKbId: {},
    treeDocumentsLoadingByKbId: {},
    onToggleKnowledgeBaseExpanded: vi.fn(),
    libraryWorkspaceDocuments: HR_DOCUMENTS,
    libraryWorkspaceDocumentsLoading: false,
    libraryWorkspaceSources: [],
    workspaceDeliverables: DELIVERABLES,
    workspaceDeliverablesUnavailable: false,
    workspaceBusy: false,
    governanceTasks: GOVERNANCE_TASKS,
    actionSuggestions: ACTION_SUGGESTIONS,
    onQueryChange: vi.fn(),
    onSearch: vi.fn(async () => undefined),
    onSearchPanelOpenChange: vi.fn(),
    onSelectKnowledgeBase: vi.fn(),
    onHomeFocusChange: vi.fn(),
    onSelectNode: vi.fn(async () => undefined),
    onHoverNode: vi.fn(),
    onZoom: vi.fn(),
    onPan: vi.fn(),
    onResetView: vi.fn(),
    onExecuteKnowledgeAction: vi.fn(async () => undefined),
    ...overrides,
  };
  return base as unknown as WorkbenchKnowledgeSurface;
}

function createOptions(): KnowledgeUniverseHomeCockpitOptions {
  return {
    onUploadKnowledge: vi.fn(),
    onOpenDataCapability: vi.fn(),
    onOpenMyAssets: vi.fn(),
    onOpenGovernance: vi.fn(),
    onOpenLibraryCreate: vi.fn(),
    onExpandRelations: vi.fn(),
  };
}

let host: HTMLDivElement | null = null;

function mountCockpit(surface: WorkbenchKnowledgeSurface): HTMLDivElement {
  const container = document.createElement("div");
  // Pin a 1440x900 desktop viewport so the screenshot captures the target grid + 6:4 split.
  container.style.width = "1440px";
  container.style.height = "900px";
  container.style.display = "flex";
  container.style.position = "fixed";
  container.style.inset = "0";
  container.style.background = "var(--bg, #0b0f19)";
  document.body.appendChild(container);
  render(renderKnowledgeUniverseHomeCockpit(surface, createOptions()), container);
  host = container;
  return container;
}

async function settle(): Promise<void> {
  if (typeof document.fonts?.ready === "object") {
    await document.fonts.ready;
  }
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

const SCREENSHOT_OPTIONS = {
  comparatorName: "pixelmatch" as const,
  comparatorOptions: { allowedMismatchedPixelRatio: 0.05 },
};

const FOCUS_DOCUMENT: KnowledgeHomeFocus = { kind: "document", id: "doc-policy", kbId: "kb-hr" };

beforeAll(async () => {
  await i18n.setLocale("zh-CN");
});

afterEach(() => {
  host?.remove();
  host = null;
});

describe("knowledge home cockpit — layout (structural)", () => {
  it("renders the default home grid: rail cabins + single relations cockpit", () => {
    const container = mountCockpit(createHomeSurface());
    expect(container.querySelector('[data-testid="ku-home-grid"]')).toBeTruthy();
    expect(container.querySelector(".ku-home__col--rail")).toBeTruthy();
    expect(container.querySelector(".ku-home__col--main")).toBeTruthy();
    expect(container.querySelector('[data-testid="ku-home-deliverables-rail"]')).toBeFalsy();
    // Right unified cockpit: topology + compact governance ticker.
    expect(container.querySelector('[data-testid="ku-home-relations-cockpit"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="ku-home-cockpit-topology"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="ku-home-governance-actions"]')).toBeTruthy();
    expect(container.querySelector(".ku-home-cockpit__governance--ticker")).toBeTruthy();
    // Health dots on the knowledge tree leaves (one per space, conflict tone present).
    expect(container.querySelectorAll('[data-testid="ku-cockpit-tree-health"]').length).toBe(3);
    expect(container.querySelector(".ku-cockpit__tree-health--conflict")).toBeTruthy();
    expect(container.querySelectorAll('[data-testid="ku-library-tree-menu"]').length).toBe(3);
  });

  it("keeps the relations graph on the default cockpit tab", () => {
    const container = mountCockpit(createHomeSurface());
    expect(
      container
        .querySelector('[data-testid="ku-home-cockpit-tab-relations"]')
        ?.getAttribute("aria-selected"),
    ).toBe("true");
    expect(container.querySelector('[data-testid="ku-home-cockpit-topology"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="ku-home-document-reader"]')).toBeFalsy();
  });

  it("opens the document preview when a deliverable is focused", () => {
    const container = mountCockpit(
      createHomeSurface({
        homeFocus: { kind: "deliverable", id: "dlv-report" },
        homeCockpitTab: "document",
        documentReader: {
          loading: false,
          saving: false,
          editing: false,
          dirty: false,
          error: null,
          docKey: "deliverable::dlv-report",
          preview: {
            filename: "Q2.md",
            mimeType: "text/markdown",
            byteLength: 8,
            textLike: true,
            base64: btoa("Q2 report"),
          },
          draftText: "Q2 report",
        },
      }),
    );
    expect(
      container.querySelector('[data-testid="ku-home-cockpit-tab-document"]')?.textContent,
    ).toContain("文档预览");
    expect(container.querySelector('[data-testid="ku-home-document-reader"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="ku-doc-reader-text"]')?.textContent).toContain(
      "Q2 report",
    );
    expect(container.querySelector('[data-testid="ku-doc-reader-delete"]')).toBeFalsy();
  });

  it("opens the document reader when a library file is focused", () => {
    const container = mountCockpit(
      createHomeSurface({
        homeFocus: FOCUS_DOCUMENT,
        homeCockpitTab: "document",
        selectedKnowledgeBaseCanWrite: true,
        documentReader: {
          loading: false,
          saving: false,
          editing: false,
          dirty: false,
          error: null,
          docKey: "kb-hr::doc-policy",
          preview: {
            filename: "policy.md",
            mimeType: "text/markdown",
            byteLength: 16,
            textLike: true,
            base64: btoa("Overtime policy"),
          },
          draftText: "Overtime policy",
        },
      }),
    );
    expect(container.querySelector('[data-testid="ku-home-cockpit-tabs"]')).toBeTruthy();
    expect(
      container
        .querySelector('[data-testid="ku-home-cockpit-tab-document"]')
        ?.getAttribute("aria-selected"),
    ).toBe("true");
    expect(container.querySelector('[data-testid="ku-home-document-reader"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="ku-doc-reader-text"]')?.textContent).toContain(
      "Overtime policy",
    );
    expect(container.querySelector('[data-testid="ku-doc-reader-edit"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="ku-doc-reader-delete"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="ku-home-cockpit-topology"]')).toBeFalsy();
  });

  it("reflects the homeFocus anchor + traceable governance signal when a document is focused", () => {
    const container = mountCockpit(
      createHomeSurface({ homeFocus: FOCUS_DOCUMENT, selectedNodeId: "node:policy" }),
    );
    const anchor = container.querySelector('[data-testid="ku-home-cockpit-anchor"]');
    expect(anchor?.textContent).toContain("考勤制度 v3");
    // Focused document feeds pending items into the bottom ticker (no tall insight cards).
    expect(
      container.querySelector(
        '[data-testid="ku-home-gov-ticker"], [data-testid="ku-home-gov-empty"]',
      ),
    ).toBeTruthy();
    expect(container.querySelector('[data-testid="ku-insight-card"]')).toBeFalsy();
    // Selected folder expands L3 document leaves under the folder.
    expect(container.querySelector('[data-testid="ku-cockpit-tree-doc"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="ku-cockpit-tree-folder"]')).toBeTruthy();
  });
});

// Real pixel snapshots only run in Vitest browser mode (pnpm -C ui test). Baselines are written
// per browser+platform (e.g. *-chromium-darwin.png) under __screenshots__/.
describe.skipIf(!canPixelScreenshot)("knowledge home cockpit — pixel screenshots", () => {
  beforeEach(() => {
    resetGraphAutoCenterStateForTests();
  });

  it("matches the default home grid screenshot", async () => {
    const container = mountCockpit(createHomeSurface());
    await settle();
    await expect
      .element(container)
      .toMatchScreenshot("knowledge-home-cockpit-default", SCREENSHOT_OPTIONS);
  });

  it("matches the focused-anchor (document) screenshot", async () => {
    const container = mountCockpit(
      createHomeSurface({ homeFocus: FOCUS_DOCUMENT, selectedNodeId: "node:policy" }),
    );
    await settle();
    await expect
      .element(container)
      .toMatchScreenshot("knowledge-home-cockpit-focused", SCREENSHOT_OPTIONS);
  });
});
