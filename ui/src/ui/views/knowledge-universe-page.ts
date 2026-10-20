import { html } from "lit";
import { t } from "../../i18n/index.ts";
import type {
  KnowledgeUniverseBrowseSubTab,
  KnowledgeUniversePersonalDrawerMode,
  WorkbenchKnowledgeSurface,
} from "../ports/employee/views/home-page-contracts.ts";
import { KNOWLEDGE_UNIVERSE_ANCHORS } from "./knowledge-universe-anchors.ts";
import { openKnowledgeSpaceCreatePage } from "./knowledge-universe-create-entry.ts";
import { renderKnowledgeUniverseDataCapabilitySpace } from "./knowledge-universe-data-capability-card.ts";
import {
  renderKnowledgeUniverseDeliverableDetailPage,
  resolveSelectedDeliverable,
} from "./knowledge-universe-deliverable-detail-page.ts";
import { renderKnowledgeUniverseGovernancePage } from "./knowledge-universe-governance-page.ts";
import { renderKnowledgeUniverseHomeCockpit } from "./knowledge-universe-home-cockpit.ts";
import { renderKnowledgeUniverseLibraryCreatePage } from "./knowledge-universe-library-create-page.ts";
import {
  renderKnowledgeUniversePersonalDrawer,
  type PersonalKnowledgePanelProps,
} from "./knowledge-universe-personal-panel.ts";
import { renderKnowledgeUniverseRelationsDiscovery } from "./knowledge-universe-relations-discovery.ts";
import { renderKnowledgeUniverseRelationsSection } from "./knowledge-universe-relations-section.ts";
import { ensureKnowledgeUniverseSearchShortcut } from "./knowledge-universe-search-focus.ts";
import { renderKnowledgeUniverseSecondaryShell } from "./knowledge-universe-secondary-shell.ts";
import {
  openSpaceImportEntry,
  renderKnowledgeUniverseSpaceImportPage,
  resolveSpaceImportPageTitle,
} from "./knowledge-universe-space-import.ts";
import {
  renderKnowledgeUniverseEnterpriseSupplySpaces,
  renderKnowledgeUniverseSupplySpaceSection,
} from "./knowledge-universe-supply-spaces.ts";
import { normalizeKnowledgeUniverseBrowseSubTab } from "./knowledge-universe-ui-prefs.ts";
import { enterKnowledgeUniverseGovernance } from "./knowledge-universe-workspace-nav.ts";
import { renderMyAccumulation, type MyAccumulationProps } from "./my-accumulation.ts";

export { KNOWLEDGE_UNIVERSE_ANCHORS } from "./knowledge-universe-anchors.ts";

function buildPersonalPanelProps(surface: WorkbenchKnowledgeSurface): PersonalKnowledgePanelProps {
  return {
    objects: surface.sourceBrowse.personal,
    collectTitle: surface.personalCollectTitle,
    collectSummary: surface.personalCollectSummary,
    collectTags: surface.personalCollectTags,
    collectUrl: surface.personalCollectUrl ?? "",
    datasetText: surface.personalDatasetText ?? "",
    uploadFileName: surface.personalUploadAttachment?.fileName ?? null,
    busy: surface.personalActionBusy,
    notice: surface.personalActionNotice,
    error: surface.personalActionError,
    manageObjectId: surface.personalManageObjectId,
    manageObjectTitle: surface.personalManageObjectTitle,
    manageTags: surface.personalManageTags,
    manageBusy: surface.personalManageBusy,
    manageNotice: surface.personalManageNotice,
    versions: surface.personalVersions,
    versionCompareFrom: surface.personalVersionCompareFrom,
    versionCompareTo: surface.personalVersionCompareTo,
    versionDiff: surface.personalVersionDiff,
    onCollectDraftChange: surface.onPersonalCollectDraftChange,
    onCollect: surface.onPersonalCollect,
    onPickUploadFile: surface.onPickPersonalUploadFile,
    onUpload: surface.onPersonalUpload,
    onCollectWeb: surface.onCollectWebPersonal,
    onImportDataset: surface.onImportDatasetPersonal,
    onOpenMyAccumulation: surface.onOpenMyAccumulation,
    onSelectObject: surface.onSelectKnowledgeObject,
    onManageObject: surface.onManagePersonalObject,
    onManageTagsChange: surface.onPersonalManageTagsChange,
    onSaveTags: surface.onSavePersonalTags,
    onVersionCompareFromChange: surface.onPersonalVersionCompareFromChange,
    onVersionCompareToChange: surface.onPersonalVersionCompareToChange,
    onCompareVersions: surface.onComparePersonalVersions,
    libraryWorkspaceNoteTags: surface.libraryWorkspaceNoteTags,
    libraryWorkspaceNoteTagDraft: surface.libraryWorkspaceNoteTagDraft,
    libraryWorkspaceNoteTagSuggestionsOpen: surface.libraryWorkspaceNoteTagSuggestionsOpen,
    libraryWorkspaceNoteTagHistory: surface.libraryWorkspaceNoteTagHistory,
    libraryWorkspaceNoteAiBusy: surface.libraryWorkspaceNoteAiBusy,
    onGenerateNoteMetadataFromContent: surface.onGenerateNoteMetadataFromContent,
    onLibraryWorkspaceNoteTagDraftChange: surface.onLibraryWorkspaceNoteTagDraftChange,
    onLibraryWorkspaceNoteTagSuggestionsOpenChange:
      surface.onLibraryWorkspaceNoteTagSuggestionsOpenChange,
    onAddLibraryWorkspaceNoteTag: surface.onAddLibraryWorkspaceNoteTag,
    onRemoveLibraryWorkspaceNoteTag: surface.onRemoveLibraryWorkspaceNoteTag,
    onCommitLibraryWorkspaceNoteTagDraft: surface.onCommitLibraryWorkspaceNoteTagDraft,
    onImportNoteToSpace: surface.onImportNoteToSpace,
  };
}

function goToWorkbench(surface: WorkbenchKnowledgeSurface) {
  surface.onPageTabChange("workbench");
}

function openLibraryCreatePage(surface: WorkbenchKnowledgeSurface) {
  openKnowledgeSpaceCreatePage(surface);
}

function openMyAssetsPage(surface: WorkbenchKnowledgeSurface) {
  surface.onOpenMyAccumulation();
}

function openDataCapabilityPage(surface: WorkbenchKnowledgeSurface) {
  // 数字能力 entry → supply page focused on the active capabilities plane.
  surface.onBrowseSubTabChange("capabilities");
  surface.onPageTabChange("supply");
}

function resolveSupplyBrowseSubTab(
  surface: WorkbenchKnowledgeSurface,
): Exclude<KnowledgeUniverseBrowseSubTab, "personal"> {
  const normalized = normalizeKnowledgeUniverseBrowseSubTab(surface.browseSubTab) ?? "private";
  return normalized === "personal" ? "private" : normalized;
}

function renderSupplySegmentNav(surface: WorkbenchKnowledgeSurface) {
  const active = resolveSupplyBrowseSubTab(surface);
  const segments: Array<{ id: Exclude<KnowledgeUniverseBrowseSubTab, "personal">; label: string }> =
    [
      {
        id: "private",
        label: t("frontstage.workbench.knowledgeUniverse.libraryWorkspace.treeSectionPersonal"),
      },
      {
        id: "team",
        label: t("frontstage.workbench.knowledgeUniverse.libraryWorkspace.treeSectionTeam"),
      },
      {
        id: "enterprise",
        label: t("frontstage.workbench.knowledgeUniverse.libraryWorkspace.treeSectionEnterprise"),
      },
      {
        id: "capabilities",
        label: t("frontstage.workbench.knowledgeUniverse.home.commandBar.dataCapability"),
      },
    ];
  return html`
    <div
      class="knowledge-universe__supply-segment"
      role="tablist"
      aria-label=${t("frontstage.workbench.knowledgeUniverse.layout.supplySegmentLabel")}
      data-testid="ku-supply-segment"
    >
      ${segments.map(
        (segment) => html`
          <button
            type="button"
            role="tab"
            class="knowledge-universe__supply-segment-btn ${active === segment.id ? "is-active" : ""}"
            data-testid="ku-supply-segment-${segment.id}"
            aria-selected=${active === segment.id ? "true" : "false"}
            @click=${() => surface.onBrowseSubTabChange(segment.id)}
          >
            ${segment.label}
          </button>
        `,
      )}
    </div>
  `;
}

function renderKnowledgeUniverseHomePage(surface: WorkbenchKnowledgeSurface) {
  return html`
    <section class="employee-workbench__module-page employee-workbench__module-page--knowledge">
      ${renderKnowledgeUniverseHomeCockpit(surface, {
        onUploadKnowledge: () => openSpaceImportEntry(surface, { lockSpace: false }),
        onOpenDataCapability: () => openDataCapabilityPage(surface),
        onOpenMyAssets: () => openMyAssetsPage(surface),
        onOpenGovernance: () => openGovernanceFromWorkspace(surface),
        onOpenLibraryCreate: () => openLibraryCreatePage(surface),
        onCreateFolderInSection: (visibility) => surface.onCreateFolderInSection(visibility),
        onExpandRelations: () => openRelationsPanorama(surface),
      })}
    </section>
  `;
}

function expandGovernanceInsight(surface: WorkbenchKnowledgeSurface) {
  surface.onPageTabChange("governance");
}

function openGovernanceFromWorkspace(surface: WorkbenchKnowledgeSurface) {
  enterKnowledgeUniverseGovernance(surface, () => expandGovernanceInsight(surface));
}

function openRelationsPanorama(surface: WorkbenchKnowledgeSurface) {
  // Open the standalone relations panorama page (no longer aliased to the governance page).
  surface.onPageTabChange("relations");
}

function renderRelationsSecondaryPage(surface: WorkbenchKnowledgeSurface, onBack: () => void) {
  return renderKnowledgeUniverseSecondaryShell({
    title: t("frontstage.workbench.knowledgeUniverse.relations.heading"),
    onBack,
    body: html`
      <div class="knowledge-universe__relations-page" data-testid="ku-relations-page">
        ${renderKnowledgeUniverseRelationsDiscovery(surface)}
        ${renderKnowledgeUniverseRelationsSection(surface, {
          variant: "expanded",
          open: true,
          hideHeading: true,
        })}
      </div>
    `,
  });
}

function renderGovernanceSecondaryPage(surface: WorkbenchKnowledgeSurface, onBack: () => void) {
  return renderKnowledgeUniverseSecondaryShell({
    title: t("frontstage.workbench.knowledgeUniverse.governance.heading"),
    subtitle: t("frontstage.workbench.knowledgeUniverse.governance.subtitle"),
    onBack,
    body: renderKnowledgeUniverseGovernancePage(surface),
  });
}

function renderDataCapabilityPageBody(surface: WorkbenchKnowledgeSurface) {
  return html`
    <div
      id=${KNOWLEDGE_UNIVERSE_ANCHORS.capabilityCenter}
      class="knowledge-universe__capability-center knowledge-universe__data-capability-page"
      data-testid="ku-supply-capabilities"
    >
      ${renderKnowledgeUniverseDataCapabilitySpace({
        capabilities: surface.dataCapabilities,
        externalDataSources: surface.externalDataSources,
        requestingCapabilityId: surface.accessRequestBusyCapabilityId,
        accessRequestNotice: surface.accessRequestNotice,
        onRequestAccess: surface.onRequestDataCapabilityAccess,
        capabilityPreview: surface.capabilityPreview ?? null,
        onPreviewCapability: surface.onPreviewCapability,
        capabilityInvocation: surface.capabilityInvocation ?? null,
        onInvokeCapability: surface.onInvokeCapability,
      })}
    </div>
  `;
}

function renderSupplySpacesBody(surface: WorkbenchKnowledgeSurface) {
  const facet = resolveSupplyBrowseSubTab(surface);
  if (facet === "capabilities") {
    return renderDataCapabilityPageBody(surface);
  }
  if (facet === "team") {
    return html`
      <div id=${KNOWLEDGE_UNIVERSE_ANCHORS.team} data-testid="ku-supply-team">
        <p class="knowledge-universe__empty-copy">
          ${t("frontstage.workbench.knowledgeUniverse.supplySpaces.empty.team")}
        </p>
        ${renderKnowledgeUniverseSupplySpaceSection(surface, "team")}
      </div>
    `;
  }
  if (facet === "enterprise") {
    return html`
      <div id=${KNOWLEDGE_UNIVERSE_ANCHORS.enterprise} data-testid="ku-supply-enterprise">
        <p class="knowledge-universe__empty-copy">
          ${t("frontstage.workbench.knowledgeUniverse.supplySpaces.enterpriseCopy")}
        </p>
        ${renderKnowledgeUniverseEnterpriseSupplySpaces(surface)}
      </div>
    `;
  }
  return html`
    <div id=${KNOWLEDGE_UNIVERSE_ANCHORS.private} data-testid="ku-supply-private">
      <p class="knowledge-universe__empty-copy">
        ${t("frontstage.workbench.knowledgeUniverse.supplySpaces.privateCopy")}
      </p>
      ${renderKnowledgeUniverseSupplySpaceSection(surface, "private")}
    </div>
  `;
}

function renderSupplyPageBody(surface: WorkbenchKnowledgeSurface) {
  // Digital-capability plane is a dedicated page — no supply chrome / space tabs.
  if (resolveSupplyBrowseSubTab(surface) === "capabilities") {
    return html`
      <div class="knowledge-universe__supply-page" data-testid="ku-supply-page">
        ${renderDataCapabilityPageBody(surface)}
      </div>
    `;
  }
  return html`
    <div class="knowledge-universe__supply-page" data-testid="ku-supply-page">
      <p class="knowledge-universe__empty-copy">
        ${t("frontstage.workbench.knowledgeUniverse.layout.supplyCopy")}
      </p>
      ${renderSupplySegmentNav(surface)} ${renderSupplySpacesBody(surface)}
    </div>
  `;
}

function resolvePersonalPageTitle(
  surface: WorkbenchKnowledgeSurface,
  mode: KnowledgeUniversePersonalDrawerMode,
): string {
  switch (mode) {
    case "upload":
      return t("frontstage.workbench.knowledgeUniverse.quickActions.upload");
    case "manage":
      return surface.personalManageObjectTitle
        ? t("frontstage.workbench.knowledgeUniverse.personal.manageDrawerTitle", {
            title: surface.personalManageObjectTitle,
          })
        : t("frontstage.workbench.knowledgeUniverse.personal.heading");
    default:
      return t("frontstage.workbench.knowledgeUniverse.quickActions.collect");
  }
}

function renderPersonalPageBody(surface: WorkbenchKnowledgeSurface) {
  const personalProps = buildPersonalPanelProps(surface);
  return renderKnowledgeUniversePersonalDrawer({
    ...personalProps,
    open: true,
    mode: surface.personalDrawerMode,
    onClose: () => goToWorkbench(surface),
  });
}

export function renderKnowledgeUniversePage(
  surface: WorkbenchKnowledgeSurface,
  options?: { myAccumulationProps?: MyAccumulationProps | null },
) {
  ensureKnowledgeUniverseSearchShortcut();
  const back = () => goToWorkbench(surface);

  switch (surface.pageTab) {
    case "relations":
      return renderRelationsSecondaryPage(surface, back);
    case "governance":
      return renderGovernanceSecondaryPage(surface, back);
    case "supply": {
      const supplyFacet = resolveSupplyBrowseSubTab(surface);
      return renderKnowledgeUniverseSecondaryShell({
        title:
          supplyFacet === "capabilities"
            ? t("frontstage.workbench.knowledgeUniverse.home.commandBar.dataCapability")
            : t("frontstage.workbench.knowledgeUniverse.layout.supplyHeading"),
        onBack: back,
        body: renderSupplyPageBody(surface),
      });
    }
    case "personal":
      return renderKnowledgeUniverseSecondaryShell({
        title: resolvePersonalPageTitle(surface, surface.personalDrawerMode),
        onBack: back,
        body: renderPersonalPageBody(surface),
      });
    case "deliverableDetail": {
      const selected = resolveSelectedDeliverable(surface);
      return renderKnowledgeUniverseSecondaryShell({
        title:
          selected?.title ??
          t("frontstage.workbench.knowledgeUniverse.deliverableDetail.pageTitle"),
        subtitle: t("frontstage.workbench.knowledgeUniverse.deliverableDetail.pageDescription"),
        onBack: back,
        body: renderKnowledgeUniverseDeliverableDetailPage(surface),
      });
    }
    case "deliverables":
      return renderKnowledgeUniverseHomePage(surface);
    case "libraryCreate":
      return renderKnowledgeUniverseSecondaryShell({
        title: t("frontstage.workbench.knowledgeUniverse.libraryCreate.pageTitle"),
        subtitle: t("frontstage.workbench.knowledgeUniverse.libraryCreate.pageDescription"),
        onBack: back,
        body: renderKnowledgeUniverseLibraryCreatePage(surface),
      });
    case "spaceImport":
      return renderKnowledgeUniverseSecondaryShell({
        title: resolveSpaceImportPageTitle(),
        subtitle: t("frontstage.workbench.knowledgeUniverse.importToSpace.pageSubtitle"),
        onBack: () => {
          surface.onLibraryWorkspaceImportOpenChange(false);
          goToWorkbench(surface);
        },
        body: renderKnowledgeUniverseSpaceImportPage(surface),
      });
    case "assets":
      return renderKnowledgeUniverseSecondaryShell({
        title: t("frontstage.workbench.knowledgeUniverse.quickActions.myAssets"),
        onBack: back,
        body: options?.myAccumulationProps
          ? html`
              <div class="knowledge-universe__assets-page">
                ${renderMyAccumulation(options.myAccumulationProps)}
              </div>
            `
          : html`
              <div class="knowledge-universe__inline-notice knowledge-universe__inline-notice--muted">
                <p>${t("frontstage.workbench.knowledgeUniverse.layout.loadingAssets")}</p>
              </div>
            `,
      });
    default:
      return renderKnowledgeUniverseHomePage(surface);
  }
}
