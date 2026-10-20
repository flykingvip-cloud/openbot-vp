// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it, beforeAll } from "vitest";
import { i18n } from "../../i18n/index.ts";
import type {
  KnowledgeBaseDocumentSummaryDto,
  KnowledgeBaseSourceListItemDto,
  KnowledgeBaseSummary,
} from "../capability/knowledge-universe/workspace-endpoints.ts";
import type { WorkbenchKnowledgeSurface } from "../ports/employee/views/home-page-contracts.ts";
import { renderKnowledgeUniverseCockpitTree } from "./knowledge-universe-cockpit-tree.ts";
import "../../styles.css";

const KB: KnowledgeBaseSummary = {
  id: "kb-hr",
  title: "人力资源管理",
  description: "",
  visibility: "private",
  documentCount: 1,
  conflictCount: 0,
  governanceStatus: "healthy",
  updatedAtMs: 0,
} as KnowledgeBaseSummary;

const DOCS: KnowledgeBaseDocumentSummaryDto[] = [
  {
    docId: "doc-policy",
    title: "考勤制度 v3",
    updatedAtMs: 1,
    contentType: null,
    indexed: true,
  } as unknown as KnowledgeBaseDocumentSummaryDto,
];

const SOURCES: KnowledgeBaseSourceListItemDto[] = [
  {
    id: "binding:external-1",
    knowledgeBaseId: "kb-hr",
    plane: "passive",
    kind: "external",
    title: "外部知识源 A",
    status: "published",
    updatedAtMs: 1,
    visibility: "private",
    // no `documentId` on purpose
  } as KnowledgeBaseSourceListItemDto,
];

function createSurface(): WorkbenchKnowledgeSurface {
  const surface = {
    knowledgeBases: [KB],
    kbSearchQuery: "",
    pinnedKnowledgeBaseIds: [],
    favoriteKnowledgeBaseIds: [],

    selectedKnowledgeBaseId: KB.id,
    expandedKnowledgeBaseIds: [KB.id],
    treeDocumentsByKbId: {},
    treeSourcesByKbId: {},
    treeDocumentsLoadingByKbId: {},
    onToggleKnowledgeBaseExpanded: () => {},
    homeFocus: null,

    libraryWorkspaceDocuments: DOCS,
    libraryWorkspaceDocumentsLoading: false,
    libraryWorkspaceSources: SOURCES,
    libraryWorkspaceSourcesLoading: false,
    libraryWorkspaceSourcesPlaneFilter: "all",
    libraryWorkspaceSelectedDocumentIds: [],

    onSelectKnowledgeBase: () => {},
    onHomeFocusChange: () => {},
  } as unknown as WorkbenchKnowledgeSurface;

  return surface;
}

describe("knowledge cabin cockpit tree — external source leaves", () => {
  beforeAll(async () => {
    await i18n.setLocale("zh-CN");
  });

  it("renders external sources without documentId under the active knowledge base", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    render(renderKnowledgeUniverseCockpitTree(createSurface()), host);

    expect(host.querySelector('[data-testid="ku-cockpit-tree-doc"]')).toBeTruthy();
    const src = host.querySelector('[data-testid="ku-cockpit-tree-source"]');
    expect(src).toBeTruthy();
    expect(src?.textContent).toContain("外部知识源 A");
    expect(host.querySelector('[data-testid="ku-library-tree-menu"]')).toBeTruthy();
  });

  it("keeps pin/favorite/rename/delete on each knowledge-space folder", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const onPin = () => {};
    const surface = {
      ...createSurface(),
      onToggleKnowledgeBasePin: onPin,
      onToggleKnowledgeBaseFavorite: () => {},
      onStartLibraryWorkspaceInlineRename: () => {},
      onDeleteLibraryWorkspace: () => {},
    } as unknown as WorkbenchKnowledgeSurface;
    render(renderKnowledgeUniverseCockpitTree(surface), host);
    const menu = host.querySelector<HTMLDetailsElement>('[data-testid="ku-library-tree-menu"]');
    expect(menu).toBeTruthy();
    menu!.open = true;
    expect(host.querySelector('[data-testid="ku-library-menu-pin"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="ku-library-menu-favorite"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="ku-library-menu-rename"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="ku-library-menu-delete"]')).toBeTruthy();
  });

  it("switches the selected folder into inline rename", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    render(
      renderKnowledgeUniverseCockpitTree({
        ...createSurface(),
        libraryWorkspaceInlineRenameKbId: KB.id,
        libraryWorkspaceSettingsTitle: KB.title,
        onLibraryWorkspaceSettingsTitleChange: () => {},
        onSubmitLibraryWorkspaceRename: async () => undefined,
        onCancelLibraryWorkspaceInlineRename: () => {},
      } as unknown as WorkbenchKnowledgeSurface),
      host,
    );
    expect(host.querySelector('[data-testid="ku-cockpit-tree-folder-rename"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="ku-library-inline-rename"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="ku-library-tree-menu"]')).toBeFalsy();
  });

  it("collapses an expanded folder when the caret is clicked", () => {
    const expandedHost = document.createElement("div");
    const collapsedHost = document.createElement("div");
    document.body.appendChild(expandedHost);
    document.body.appendChild(collapsedHost);
    const expanded = createSurface();
    render(renderKnowledgeUniverseCockpitTree(expanded), expandedHost);
    expect(expandedHost.querySelector('[data-testid="ku-cockpit-tree-docs"]')).toBeTruthy();
    render(
      renderKnowledgeUniverseCockpitTree({
        ...expanded,
        expandedKnowledgeBaseIds: [],
      }),
      collapsedHost,
    );
    expect(collapsedHost.querySelector('[data-testid="ku-cockpit-tree-docs"]')).toBeFalsy();
    expect(
      collapsedHost.querySelector('[data-testid="ku-cockpit-tree-folder-caret"]'),
    ).toBeTruthy();
  });

  it("lists favorited files in the favorites funnel without removing the space", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    render(
      renderKnowledgeUniverseCockpitTree({
        ...createSurface(),
        favoriteKnowledgeBaseIds: [KB.id],
        treeDocumentsByKbId: {
          [KB.id]: [
            {
              docId: "doc-star",
              title: "收藏简历",
              updatedAtMs: 1,
              contentType: null,
              indexed: true,
            },
          ],
        },
      }),
      host,
    );
    const funnelDocs = host.querySelectorAll('[data-testid="ku-cockpit-tree-doc"]');
    expect([...funnelDocs].some((node) => node.textContent?.includes("收藏简历"))).toBe(true);
    expect(host.querySelector('[data-testid="ku-cockpit-tree-favorites-empty"]')).toBeFalsy();
    expect(
      [...host.querySelectorAll('[data-testid="ku-cockpit-tree-folder"]')].some((node) =>
        node.textContent?.includes("人力资源管理"),
      ),
    ).toBe(true);
  });

  it("always shows personal / team / enterprise sections even with no libraries", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const onCreate = () => undefined;
    render(
      renderKnowledgeUniverseCockpitTree(
        {
          ...createSurface(),
          knowledgeBases: [],
          selectedKnowledgeBaseId: null,
          expandedKnowledgeBaseIds: [],
        } as unknown as WorkbenchKnowledgeSurface,
        { onCreateFolderInSection: onCreate },
      ),
      host,
    );
    expect(host.textContent).toContain("个人空间");
    expect(host.textContent).toContain("团队空间");
    expect(host.textContent).toContain("企业空间");
    expect(host.querySelector('[data-testid="ku-cockpit-tree-add-private"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="ku-cockpit-tree-add-team"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="ku-cockpit-tree-add-enterprise"]')).toBeFalsy();
  });

  it("hides rename/delete on read-only enterprise folders", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const enterprise = {
      ...KB,
      id: "kb-ent",
      title: "制度库",
      visibility: "enterprise" as const,
      canWrite: false,
      canAdmin: false,
    };
    render(
      renderKnowledgeUniverseCockpitTree({
        ...createSurface(),
        knowledgeBases: [enterprise],
        selectedKnowledgeBaseId: enterprise.id,
        expandedKnowledgeBaseIds: [enterprise.id],
        onToggleKnowledgeBasePin: () => {},
        onToggleKnowledgeBaseFavorite: () => {},
        onStartLibraryWorkspaceInlineRename: () => {},
        onDeleteLibraryWorkspace: () => {},
      } as unknown as WorkbenchKnowledgeSurface),
      host,
    );
    const menu = host.querySelector<HTMLDetailsElement>('[data-testid="ku-library-tree-menu"]');
    menu!.open = true;
    expect(host.querySelector('[data-testid="ku-library-menu-pin"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="ku-library-menu-rename"]')).toBeFalsy();
    expect(host.querySelector('[data-testid="ku-library-menu-delete"]')).toBeFalsy();
  });
});
