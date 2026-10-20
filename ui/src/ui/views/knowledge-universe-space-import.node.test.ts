// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { WorkbenchKnowledgeSurface } from "../ports/employee/views/home-page-contracts.ts";
import { createEmptySpaceConnectorBindDraft } from "./knowledge-universe-space-connector-bind.ts";
import {
  buildActiveSourceBindRequest,
  openPersonalSpaceImportEntry,
  openSpaceImportEntry,
  renderKnowledgeUniverseSpaceImportPage,
  resolveSelectedKnowledgeSpaceCanWrite,
} from "./knowledge-universe-space-import.ts";

function surface(overrides: Partial<WorkbenchKnowledgeSurface> = {}): WorkbenchKnowledgeSurface {
  return {
    selectedKnowledgeBaseId: "kb-team",
    knowledgeBases: [
      {
        id: "kb-team",
        title: "人力资源",
        description: "",
        documentCount: 0,
        visibility: "team",
        updatedAtMs: Date.now(),
      },
    ],
    libraryWorkspaceMembers: [],
    libraryWorkspaceMembersLoading: false,
    libraryWorkspaceImportOpen: false,
    libraryWorkspaceImportLockSpace: true,
    libraryWorkspaceImportKind: null,
    libraryWorkspaceBindSourceKind: "api",
    libraryWorkspaceBindSourceTitle: "",
    libraryWorkspaceBindSourceEndpoint: "",
    libraryWorkspaceLocalFolderPath: "",
    libraryWorkspaceLocalFolderLabel: "",
    libraryWorkspaceLocalFolderDeletePolicy: "snapshot",
    libraryWorkspaceLocalFolderWatcherEnabled: true,
    libraryWorkspaceLocalFolderMode: "managed_push",
    libraryWorkspaceLocalFolderStatusItems: [],
    personalActionBusy: false,
    personalActionNotice: null,
    personalActionError: null,
    personalCollectTitle: "",
    personalCollectSummary: "",
    personalCollectTags: "",
    personalCollectUrl: "",
    personalDatasetText: "",
    personalUploadAttachment: null,
    selectedKnowledgeBaseCanWrite: true,
    actorEmail: "editor@example.com",
    onPageTabChange: vi.fn(),
    onLibraryWorkspaceImportOpenChange: vi.fn(),
    onSelectKnowledgeBase: vi.fn(),
    onLibraryWorkspaceImportKindChange: vi.fn(),
    onLibraryWorkspaceBindSourceDraftChange: vi.fn(),
    onBindKnowledgeSource: vi.fn(async () => undefined),
    onLibraryWorkspaceLocalFolderPathChange: vi.fn(),
    onLibraryWorkspaceLocalFolderLabelChange: vi.fn(),
    onLibraryWorkspaceLocalFolderDeletePolicyChange: vi.fn(),
    onLibraryWorkspaceLocalFolderWatcherEnabledChange: vi.fn(),
    onLibraryWorkspaceLocalFolderModeChange: vi.fn(),
    onPickLocalFolderPath: vi.fn(async () => undefined),
    onBindLocalFolder: vi.fn(async () => undefined),
    onLoadLocalFolderStatus: vi.fn(async () => undefined),
    onScanLocalFolderNow: vi.fn(async () => undefined),
    onPickPersonalUploadFile: vi.fn(async () => undefined),
    onPersonalUpload: vi.fn(async () => undefined),
    onPersonalCollectDraftChange: vi.fn(),
    onPersonalCollect: vi.fn(async () => undefined),
    onCollectWebPersonal: vi.fn(async () => undefined),
    onImportDatasetPersonal: vi.fn(async () => undefined),
    onLibraryWorkspaceImportReadOnly: vi.fn(),
    enterpriseTenantId: null,
    libraryWorkspaceConnectorBindDraft: createEmptySpaceConnectorBindDraft(),
    libraryWorkspaceConnectorCatalog: [],
    libraryWorkspaceConnectorCatalogLoading: false,
    libraryWorkspaceConnectorCatalogError: null,
    libraryWorkspaceConnectorCredentials: [],
    libraryWorkspaceConnectorCredentialsLoading: false,
    libraryWorkspaceConnectorProbeOk: null,
    libraryWorkspaceConnectorProbeMessage: null,
    libraryWorkspaceConnectorProbeBusy: false,
    libraryWorkspaceConnectorOAuthBusy: false,
    libraryWorkspaceConnectorOAuthNotice: null,
    libraryWorkspaceConnectorOAuthError: null,
    libraryWorkspaceConnectorOAuthSessionId: null,
    libraryWorkspaceConnectorOAuthSimulateAllowed: false,
    libraryWorkspaceHttpRestExpanded: false,
    libraryWorkspaceDatasetImportTab: "file",
    libraryWorkspaceDatasetFileAttachment: null,
    libraryWorkspaceDatasetPreview: null,
    libraryWorkspaceDatasetPreviewError: null,
    libraryWorkspaceUrlImportMode: "batch",
    libraryWorkspaceUrlImportText: "",
    libraryWorkspaceUrlImportAdvancedOpen: false,
    libraryWorkspaceUrlSyncSchedule: "once",
    libraryWorkspaceUrlStripNavAds: true,
    libraryWorkspaceUrlMainContentOnly: false,
    onLibraryWorkspaceDatasetImportTabChange: vi.fn(),
    onDatasetImportManualTextChange: vi.fn(),
    onPickDatasetImportFile: vi.fn(async () => undefined),
    onDownloadDatasetImportTemplate: vi.fn(),
    onImportDatasetToSpace: vi.fn(async () => undefined),
    onLibraryWorkspaceUrlImportModeChange: vi.fn(),
    onLibraryWorkspaceUrlImportTextChange: vi.fn(),
    onLibraryWorkspaceUrlImportAdvancedOpenChange: vi.fn(),
    onLibraryWorkspaceUrlSyncScheduleChange: vi.fn(),
    onLibraryWorkspaceUrlStripNavAdsChange: vi.fn(),
    onLibraryWorkspaceUrlMainContentOnlyChange: vi.fn(),
    onImportWebUrlsToSpace: vi.fn(async () => undefined),
    libraryWorkspaceNoteTags: [],
    libraryWorkspaceNoteTagDraft: "",
    libraryWorkspaceNoteTagSuggestionsOpen: false,
    libraryWorkspaceNoteTagHistory: ["效率提升", "知识管理"],
    libraryWorkspaceNoteAiBusy: false,
    onGenerateNoteMetadataFromContent: vi.fn(async () => undefined),
    onLibraryWorkspaceNoteTagDraftChange: vi.fn(),
    onLibraryWorkspaceNoteTagSuggestionsOpenChange: vi.fn(),
    onAddLibraryWorkspaceNoteTag: vi.fn(),
    onRemoveLibraryWorkspaceNoteTag: vi.fn(),
    onCommitLibraryWorkspaceNoteTagDraft: vi.fn(),
    onImportNoteToSpace: vi.fn(async () => undefined),
    libraryWorkspaceFileImportItems: [],
    libraryWorkspaceFileImportAdvancedOpen: false,
    libraryWorkspaceFileChunkingStrategy: "auto",
    libraryWorkspaceFileOcrEnabled: true,
    onPickFileImportFiles: vi.fn(async () => undefined),
    onRemoveFileImportFile: vi.fn(),
    onLibraryWorkspaceFileImportAdvancedOpenChange: vi.fn(),
    onLibraryWorkspaceFileChunkingStrategyChange: vi.fn(),
    onLibraryWorkspaceFileOcrEnabledChange: vi.fn(),
    onImportFilesToSpace: vi.fn(async () => undefined),
    onLibraryWorkspaceConnectorBindDraftChange: vi.fn(),
    onLibraryWorkspaceConnectorCredentialSelect: vi.fn(),
    onLibraryWorkspaceHttpRestExpandedChange: vi.fn(),
    ...overrides,
  } as unknown as WorkbenchKnowledgeSurface;
}

describe("knowledge-universe-space-import", () => {
  it("opens the unified import drawer instead of the legacy upload form", () => {
    const mock = surface();
    openSpaceImportEntry(mock);
    expect(mock.onLibraryWorkspaceImportOpenChange).toHaveBeenCalledWith(true, { lockSpace: true });
  });

  it("opens home import with unlocked target space selector context", () => {
    const mock = surface();
    openSpaceImportEntry(mock, { lockSpace: false });
    expect(mock.onLibraryWorkspaceImportOpenChange).toHaveBeenCalledWith(true, {
      lockSpace: false,
    });
  });

  it("renders target selector for home import context", () => {
    const mock = surface({
      libraryWorkspaceImportOpen: true,
      libraryWorkspaceImportLockSpace: false,
      libraryWorkspaceImportKind: null,
      knowledgeBases: [
        {
          id: "kb-private",
          title: "我的收录",
          description: "",
          documentCount: 0,
          visibility: "private",
          updatedAtMs: Date.now(),
        },
        {
          id: "kb-team",
          title: "人力资源",
          description: "",
          documentCount: 0,
          visibility: "team",
          updatedAtMs: Date.now(),
        },
      ],
      selectedKnowledgeBaseId: "kb-private",
    });
    const container = document.createElement("div");
    render(renderKnowledgeUniverseSpaceImportPage(mock), container);
    expect(container.querySelector('[data-testid="ku-space-import-target-selector"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="ku-space-import-target-locked"]')).toBeFalsy();
    expect(container.querySelector('[data-testid="ku-space-import-create-space"]')).toBeTruthy();
    expect(container.querySelector(".ku-space-import__target-control")).toBeTruthy();
    expect(container.querySelector(".ku-space-import__tabs--seg")).toBeTruthy();
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(4);
  });

  it("renders locked target label for space-detail import context", () => {
    const mock = surface({
      libraryWorkspaceImportOpen: true,
      libraryWorkspaceImportLockSpace: true,
      libraryWorkspaceImportKind: null,
    });
    const container = document.createElement("div");
    render(renderKnowledgeUniverseSpaceImportPage(mock), container);
    expect(container.querySelector('[data-testid="ku-space-import-target-locked"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="ku-space-import-target-selector"]')).toBeFalsy();
  });

  it("changes import target space via selector", () => {
    const mock = surface({
      libraryWorkspaceImportOpen: true,
      libraryWorkspaceImportLockSpace: false,
      libraryWorkspaceImportKind: null,
      knowledgeBases: [
        {
          id: "kb-private",
          title: "我的收录",
          description: "",
          documentCount: 0,
          visibility: "private",
          updatedAtMs: Date.now(),
        },
        {
          id: "kb-team",
          title: "人力资源",
          description: "",
          documentCount: 0,
          visibility: "team",
          updatedAtMs: Date.now(),
        },
      ],
      selectedKnowledgeBaseId: "kb-private",
    });
    const container = document.createElement("div");
    render(renderKnowledgeUniverseSpaceImportPage(mock), container);
    const select = container.querySelector<HTMLSelectElement>(
      '[data-testid="ku-space-import-target-select"]',
    );
    expect(select).toBeTruthy();
    select!.value = "kb-team";
    select!.dispatchEvent(new Event("change", { bubbles: true }));
    expect(mock.onSelectKnowledgeBase).toHaveBeenCalledWith("kb-team");
  });

  it("录入知识: locks straight into the selected personal space (no category selection)", () => {
    const mock = surface({
      knowledgeBases: [
        {
          id: "kb-private",
          title: "我的收录",
          description: "",
          documentCount: 0,
          visibility: "private",
          updatedAtMs: Date.now(),
        },
      ],
      selectedKnowledgeBaseId: "kb-private",
    });
    openPersonalSpaceImportEntry(mock);
    // Locked target → no selector; lands directly on the 5-channel picker.
    expect(mock.onLibraryWorkspaceImportOpenChange).toHaveBeenCalledWith(true, { lockSpace: true });
    // Already the personal space → no re-selection needed, no create-space routing.
    expect(mock.onSelectKnowledgeBase).not.toHaveBeenCalled();
    expect(mock.onPageTabChange).not.toHaveBeenCalledWith("libraryCreate");
  });

  it("录入知识: defaults to the first personal space when a non-personal space is selected", () => {
    const mock = surface({
      knowledgeBases: [
        {
          id: "kb-team",
          title: "人力资源",
          description: "",
          documentCount: 0,
          visibility: "team",
          updatedAtMs: Date.now(),
        },
        {
          id: "kb-private",
          title: "我的收录",
          description: "",
          documentCount: 0,
          visibility: "private",
          updatedAtMs: Date.now(),
        },
      ],
      selectedKnowledgeBaseId: "kb-team",
    });
    openPersonalSpaceImportEntry(mock);
    expect(mock.onSelectKnowledgeBase).toHaveBeenCalledWith("kb-private");
    expect(mock.onLibraryWorkspaceImportOpenChange).toHaveBeenCalledWith(true, { lockSpace: true });
  });

  it("录入知识: still opens create space when no personal space exists yet", () => {
    const onPageTabChange = vi.fn();
    const mock = surface({
      knowledgeBases: [
        {
          id: "kb-team",
          title: "人力资源",
          description: "",
          documentCount: 0,
          visibility: "team",
          updatedAtMs: Date.now(),
        },
      ],
      selectedKnowledgeBaseId: "kb-team",
    });
    mock.onPageTabChange = onPageTabChange;
    openPersonalSpaceImportEntry(mock);
    expect(onPageTabChange).toHaveBeenCalledWith("libraryCreate");
    expect(mock.onLibraryWorkspaceImportOpenChange).not.toHaveBeenCalled();
    expect(mock.onSelectKnowledgeBase).not.toHaveBeenCalled();
  });

  it("录入知识: routes to create space with zero knowledge bases (no silent inbox)", () => {
    const onPageTabChange = vi.fn();
    const mock = surface({ knowledgeBases: [], selectedKnowledgeBaseId: null });
    mock.onPageTabChange = onPageTabChange;
    openPersonalSpaceImportEntry(mock);
    expect(onPageTabChange).toHaveBeenCalledWith("libraryCreate");
    expect(mock.onLibraryWorkspaceImportOpenChange).not.toHaveBeenCalled();
  });

  it("routes to create space when user has no knowledge bases", () => {
    const mock = surface({
      knowledgeBases: [],
      selectedKnowledgeBaseId: null,
    });
    const onPageTabChange = vi.fn();
    mock.onPageTabChange = onPageTabChange;
    openSpaceImportEntry(mock, { lockSpace: false });
    expect(onPageTabChange).toHaveBeenCalledWith("libraryCreate");
    expect(mock.onLibraryWorkspaceImportOpenChange).not.toHaveBeenCalled();
  });

  it("renders only the four supported content-entry tabs", () => {
    const mock = surface({ libraryWorkspaceImportOpen: true, libraryWorkspaceImportKind: null });
    const container = document.createElement("div");
    render(renderKnowledgeUniverseSpaceImportPage(mock), container);
    for (const kind of ["localFolder", "url", "note", "active"] as const) {
      expect(container.querySelector(`[data-testid="ku-space-import-tab-${kind}"]`)).toBeTruthy();
    }
    expect(container.querySelectorAll('[data-testid^="ku-space-import-tab-"]')).toHaveLength(4);
    expect(
      container
        .querySelector('[data-testid="ku-space-import-tab-localFolder"]')
        ?.getAttribute("aria-selected"),
    ).toBe("true");
    expect(container.querySelector('[data-testid="ku-space-import-sync-method"]')).toBeFalsy();
    expect(
      container.querySelector('[data-testid="ku-space-import-form-localFolder"]'),
    ).toBeTruthy();
    expect(container.querySelector('[data-testid="ku-space-import-picker"]')).toBeFalsy();
  });

  it("switches the active channel tab via onLibraryWorkspaceImportKindChange", () => {
    const mock = surface({ libraryWorkspaceImportOpen: true, libraryWorkspaceImportKind: null });
    const container = document.createElement("div");
    render(renderKnowledgeUniverseSpaceImportPage(mock), container);
    container.querySelector<HTMLButtonElement>('[data-testid="ku-space-import-tab-note"]')?.click();
    expect(mock.onLibraryWorkspaceImportKindChange).toHaveBeenCalledWith("note");
  });

  it("openPersonalSpaceImportEntry never auto-materializes when no private space", () => {
    const onEnsurePersonalSpaceForImport = vi.fn(async () => undefined);
    const onPageTabChange = vi.fn();
    const mock = surface({
      knowledgeBases: [],
      selectedKnowledgeBaseId: null,
      onEnsurePersonalSpaceForImport,
    });
    mock.onPageTabChange = onPageTabChange;
    openPersonalSpaceImportEntry(mock);
    expect(onEnsurePersonalSpaceForImport).not.toHaveBeenCalled();
    expect(onPageTabChange).toHaveBeenCalledWith("libraryCreate");
    expect(mock.onLibraryWorkspaceImportOpenChange).not.toHaveBeenCalled();
  });

  it("renders localFolder form without active-source bind controls", () => {
    const mock = surface({
      libraryWorkspaceImportOpen: true,
      libraryWorkspaceImportKind: "localFolder",
      libraryWorkspaceLocalFolderPath: "",
    });
    const container = document.createElement("div");
    render(renderKnowledgeUniverseSpaceImportPage(mock), container);
    expect(
      container.querySelector('[data-testid="ku-space-import-form-localFolder"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="ku-space-import-local-folder-path"]'),
    ).toBeTruthy();
    expect(
      (
        container.querySelector(
          '[data-testid="ku-space-import-local-folder-connect"]',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(container.querySelector('[data-testid="ku-space-import-form-active"]')).toBeFalsy();
    const hint = container.querySelector('[data-testid="ku-space-import-local-folder-path-hint"]');
    expect(hint?.textContent).toContain("folder name only");
    const pathInput = container.querySelector(
      '[data-testid="ku-space-import-local-folder-path"]',
    ) as HTMLInputElement;
    expect(pathInput.placeholder).toBe("Choose a local folder");
    expect(pathInput.placeholder).not.toContain("/Users/you");
  });

  it("enables localFolder connect when path is set and invokes bind handler", () => {
    const mock = surface({
      libraryWorkspaceImportOpen: true,
      libraryWorkspaceImportKind: "localFolder",
      libraryWorkspaceLocalFolderPath: "/tmp/notes",
      libraryWorkspaceLocalFolderLabel: "Notes",
    });
    const container = document.createElement("div");
    render(renderKnowledgeUniverseSpaceImportPage(mock), container);
    const connect = container.querySelector(
      '[data-testid="ku-space-import-local-folder-connect"]',
    ) as HTMLButtonElement;
    expect(connect.disabled).toBe(false);
    connect.click();
    expect(mock.onBindLocalFolder).toHaveBeenCalled();
  });

  it("renders connected local folder status without local_index scan-now control", () => {
    const mock = surface({
      libraryWorkspaceImportOpen: true,
      libraryWorkspaceImportKind: "localFolder",
      libraryWorkspaceLocalFolderStatusItems: [
        {
          bindingId: "lfb-1",
          sourceDescriptorId: "src-1",
          knowledgeBaseId: "kb-team",
          rootLabel: "Notes",
          status: "idle",
          watcherEnabled: false,
          watcherRunning: false,
          deletePolicy: "snapshot",
          mode: "managed_push",
          activeDocumentCount: 3,
          lastScanAt: Date.now(),
        },
      ],
    });
    const container = document.createElement("div");
    render(renderKnowledgeUniverseSpaceImportPage(mock), container);
    expect(
      container.querySelector('[data-testid="ku-space-import-local-folder-status-list"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="ku-space-import-local-folder-status-item"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="ku-space-import-local-folder-scan"]'),
    ).toBeFalsy();
  });

  it("builds bindSource requests with knowledgeBaseId and without visibility", () => {
    const req = buildActiveSourceBindRequest({
      knowledgeBaseId: "kb-team",
      kind: "api",
      title: "HR API",
      endpoint: "https://api.example.com/hr",
    });
    expect(req).toEqual({
      kind: "api",
      title: "HR API",
      endpoint: "https://api.example.com/hr",
      knowledgeBaseId: "kb-team",
    });
    expect("visibility" in req).toBe(false);
  });

  it("keeps enterprise spaces read-only unless gateway granted write", () => {
    const enterprise = surface({
      selectedKnowledgeBaseId: "kb-ent",
      knowledgeBases: [
        {
          id: "kb-ent",
          title: "制度",
          description: "",
          documentCount: 0,
          visibility: "enterprise",
          updatedAtMs: Date.now(),
        },
      ],
    });
    expect(resolveSelectedKnowledgeSpaceCanWrite(enterprise, "viewer@example.com")).toBe(false);
    expect(
      resolveSelectedKnowledgeSpaceCanWrite(
        {
          ...enterprise,
          knowledgeBases: [{ ...enterprise.knowledgeBases[0], canWrite: true }],
        },
        "editor@example.com",
      ),
    ).toBe(true);
  });

  it("disables write access for viewer members in shared spaces", () => {
    const mock = surface({
      libraryWorkspaceMembers: [
        {
          memberId: "m1",
          knowledgeBaseId: "kb-team",
          email: "viewer@example.com",
          role: "viewer",
          status: "active",
          invitedByUserId: "owner",
          createdAtMs: Date.now(),
        },
      ],
      actorEmail: "viewer@example.com",
    });
    expect(resolveSelectedKnowledgeSpaceCanWrite(mock, "viewer@example.com")).toBe(false);
  });

  it("routes read-only actors to the read-only notice handler", () => {
    const mock = surface({
      selectedKnowledgeBaseCanWrite: false,
      libraryWorkspaceMembers: [
        {
          memberId: "m1",
          knowledgeBaseId: "kb-team",
          email: "viewer@example.com",
          role: "viewer",
          status: "active",
          invitedByUserId: "owner",
          createdAtMs: Date.now(),
        },
      ],
      actorEmail: "viewer@example.com",
    });
    openSpaceImportEntry(mock);
    expect(mock.onLibraryWorkspaceImportReadOnly).toHaveBeenCalled();
    expect(mock.onLibraryWorkspaceImportOpenChange).not.toHaveBeenCalled();
  });

  it("renders HTTP REST path for private space without tenant", () => {
    const mock = surface({
      libraryWorkspaceImportOpen: true,
      libraryWorkspaceImportKind: "active",
      enterpriseTenantId: null,
      knowledgeBases: [
        {
          id: "kb-private",
          title: "我的收录",
          description: "",
          documentCount: 0,
          visibility: "private",
          updatedAtMs: Date.now(),
        },
      ],
      selectedKnowledgeBaseId: "kb-private",
    });
    const container = document.createElement("div");
    render(renderKnowledgeUniverseSpaceImportPage(mock), container);
    expect(container.querySelector('[data-testid="ku-space-import-http-rest"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="ku-space-import-connector-wizard"]')).toBeFalsy();
    expect(container.querySelector('[data-testid="ku-space-import-target-select"]')).toBeFalsy();
  });

  it("renders connector wizard for team space with tenant", () => {
    const mock = surface({
      libraryWorkspaceImportOpen: true,
      libraryWorkspaceImportKind: "active",
      enterpriseTenantId: "tenant-1",
      knowledgeBases: [
        {
          id: "kb-team",
          title: "人力资源",
          description: "",
          documentCount: 0,
          visibility: "team",
          updatedAtMs: Date.now(),
        },
      ],
      selectedKnowledgeBaseId: "kb-team",
    });
    const container = document.createElement("div");
    render(renderKnowledgeUniverseSpaceImportPage(mock), container);
    expect(
      container.querySelector('[data-testid="ku-space-import-connector-wizard"]'),
    ).toBeTruthy();
    expect(container.querySelector('[data-testid="ku-space-import-http-rest-fold"]')).toBeTruthy();
    expect(
      container.querySelector('[data-testid="ku-space-import-connector-select"]'),
    ).toBeTruthy();
  });

  it("shows OAuth authorize for oauth2 connectors but not for api_key connectors", () => {
    const oauth2Catalog = [
      {
        connectorId: "crm-salesforce",
        label: "Salesforce",
        category: "crm" as const,
        credentialKind: "oauth2" as const,
        description: "Salesforce CRM",
        ready: true,
        defaultSourceKey: "salesforce",
        integrationTier: "demo" as const,
        registeredActionCount: 1,
        runtimeHandlerCount: 1,
      },
    ];
    const apiKeyCatalog = [
      {
        connectorId: "sap",
        label: "SAP",
        category: "erp" as const,
        credentialKind: "api_key" as const,
        description: "SAP ERP",
        ready: true,
        defaultSourceKey: "sap",
        integrationTier: "production" as const,
        registeredActionCount: 1,
        runtimeHandlerCount: 1,
      },
    ];
    const base = {
      libraryWorkspaceImportOpen: true,
      libraryWorkspaceImportKind: "active" as const,
      enterpriseTenantId: "tenant-1",
      knowledgeBases: [
        {
          id: "kb-team",
          title: "人力资源",
          description: "",
          documentCount: 0,
          visibility: "team" as const,
          updatedAtMs: Date.now(),
        },
      ],
      selectedKnowledgeBaseId: "kb-team",
      libraryWorkspaceConnectorBindDraft: {
        ...createEmptySpaceConnectorBindDraft(),
        connectorId: "crm-salesforce",
        credentialLabel: "Salesforce OAuth",
      },
    };
    const oauthContainer = document.createElement("div");
    render(
      renderKnowledgeUniverseSpaceImportPage(
        surface({ ...base, libraryWorkspaceConnectorCatalog: oauth2Catalog }),
      ),
      oauthContainer,
    );
    expect(
      oauthContainer.querySelector('[data-testid="ku-space-import-oauth-authorize"]'),
    ).toBeTruthy();
    expect(
      oauthContainer.querySelector('[data-testid="ku-space-import-oauth-simulate"]'),
    ).toBeFalsy();

    const apiContainer = document.createElement("div");
    render(
      renderKnowledgeUniverseSpaceImportPage(
        surface({
          ...base,
          libraryWorkspaceConnectorCatalog: apiKeyCatalog,
          libraryWorkspaceConnectorBindDraft: {
            ...createEmptySpaceConnectorBindDraft(),
            connectorId: "sap",
          },
        }),
      ),
      apiContainer,
    );
    expect(
      apiContainer.querySelector('[data-testid="ku-space-import-oauth-authorize"]'),
    ).toBeFalsy();
    const credentialSelect = apiContainer.querySelector<HTMLSelectElement>(
      '[data-testid="ku-space-import-credential-select"]',
    );
    expect(credentialSelect).toBeTruthy();
    expect(credentialSelect?.querySelector('option[value="__new__"]')).toBeTruthy();
  });

  it("shows simulate OAuth button when demo session is active", () => {
    const mock = surface({
      libraryWorkspaceImportOpen: true,
      libraryWorkspaceImportKind: "active",
      enterpriseTenantId: "tenant-1",
      libraryWorkspaceConnectorOAuthSimulateAllowed: true,
      libraryWorkspaceConnectorOAuthSessionId: "oauth-session-1",
      libraryWorkspaceConnectorCatalog: [
        {
          connectorId: "crm-salesforce",
          label: "Salesforce",
          category: "crm",
          credentialKind: "oauth2",
          description: "Salesforce CRM",
          ready: true,
          defaultSourceKey: "salesforce",
          integrationTier: "demo",
          registeredActionCount: 1,
          runtimeHandlerCount: 1,
        },
      ],
      libraryWorkspaceConnectorBindDraft: {
        ...createEmptySpaceConnectorBindDraft(),
        connectorId: "crm-salesforce",
        credentialLabel: "Demo OAuth",
      },
      knowledgeBases: [
        {
          id: "kb-team",
          title: "人力资源",
          description: "",
          documentCount: 0,
          visibility: "team",
          updatedAtMs: Date.now(),
        },
      ],
      selectedKnowledgeBaseId: "kb-team",
    });
    const container = document.createElement("div");
    render(renderKnowledgeUniverseSpaceImportPage(mock), container);
    expect(container.querySelector('[data-testid="ku-space-import-oauth-simulate"]')).toBeTruthy();
  });

  it("renders AI-enhanced note import with content-first layout", () => {
    const mock = surface({
      libraryWorkspaceImportOpen: true,
      libraryWorkspaceImportKind: "note",
      personalCollectSummary: "会议纪要：讨论知识库导入体验优化。",
      libraryWorkspaceNoteTags: ["效率提升"],
    });
    const container = document.createElement("div");
    render(renderKnowledgeUniverseSpaceImportPage(mock), container);
    expect(container.querySelector('[data-testid="ku-space-import-note-content"]')).toBeTruthy();
    expect(
      container.querySelector('[data-testid="ku-space-import-note-ai-generate"]'),
    ).toBeTruthy();
    expect(container.querySelector('[data-testid="ku-space-import-note-title"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="ku-space-import-note-tags"]')).toBeTruthy();
    const submit = container.querySelector<HTMLButtonElement>(
      '[data-testid="ku-space-import-note-submit"]',
    );
    expect(submit).toBeTruthy();
    expect(submit?.disabled).toBe(false);
  });

  it("renders multimodal web url import with batch textarea and advanced settings", () => {
    const mock = surface({
      libraryWorkspaceImportOpen: true,
      libraryWorkspaceImportKind: "url",
      libraryWorkspaceUrlImportText: "https://example.com/a\nhttps://example.com/b",
      libraryWorkspaceUrlImportAdvancedOpen: true,
    });
    const container = document.createElement("div");
    render(renderKnowledgeUniverseSpaceImportPage(mock), container);
    expect(container.querySelector('[data-testid="ku-space-import-url-mode"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="ku-space-import-url-textarea"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="ku-space-import-url-counter"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="ku-space-import-url-advanced"]')).toBeTruthy();
    const submit = container.querySelector<HTMLButtonElement>(
      '[data-testid="ku-space-import-url-submit"]',
    );
    expect(submit).toBeTruthy();
    expect(submit?.disabled).toBe(false);
  });

  it("renders live import progress instead of a silent busy state", () => {
    const mock = surface({
      libraryWorkspaceImportOpen: true,
      libraryWorkspaceImportKind: "localFolder",
      personalActionBusy: true,
      importProgress: {
        current: 2,
        total: 5,
        label: "正在上传并索引 2/5：notes.md",
      },
    });
    const container = document.createElement("div");
    render(renderKnowledgeUniverseSpaceImportPage(mock), container);
    const progress = container.querySelector('[data-testid="ku-space-import-progress"]');
    expect(progress).toBeTruthy();
    expect(progress?.getAttribute("aria-valuenow")).toBe("40");
    expect(progress?.textContent).toContain("正在上传并索引 2/5：notes.md");
    expect(progress?.textContent).toContain(
      "Large files are split into embedding batches; robots can read the full text only after this finishes",
    );
    const connect = container.querySelector('[data-testid="ku-space-import-local-folder-connect"]');
    expect(connect?.textContent).toContain("正在上传并索引 2/5：notes.md");
  });

  it("renders listing scan progress before a file total is known", () => {
    const mock = surface({
      libraryWorkspaceImportOpen: true,
      libraryWorkspaceImportKind: "localFolder",
      personalActionBusy: true,
      importProgress: {
        current: 12,
        total: 0,
        label: "正在查找文件… 已发现 12 个",
      },
    });
    const container = document.createElement("div");
    render(renderKnowledgeUniverseSpaceImportPage(mock), container);
    const progress = container.querySelector('[data-testid="ku-space-import-progress"]');
    expect(progress).toBeTruthy();
    expect(progress?.getAttribute("aria-valuenow")).toBeNull();
    expect(progress?.textContent).toContain("正在查找文件… 已发现 12 个");
    const fill = container.querySelector(".ku-space-import__progress-fill");
    expect(fill?.classList.contains("is-indeterminate")).toBe(true);
    const connect = container.querySelector('[data-testid="ku-space-import-local-folder-connect"]');
    expect(connect?.textContent).toContain("正在查找文件… 已发现 12 个");
  });
});
