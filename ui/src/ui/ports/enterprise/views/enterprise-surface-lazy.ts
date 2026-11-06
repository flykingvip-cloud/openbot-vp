import { html, type TemplateResult } from "lit";
import { diagnosisTargetsFromEnterpriseRoster } from "../../diagnosis/diagnosis-targets.ts";
import type { SurfaceBlock } from "./enterprise-surface-shared.ts";
import type { EnterpriseSurfaceProps, EnterpriseSurfaceTab } from "./enterprise-surface-types.ts";

type SurfaceBodyRenderer = (params: {
  props: EnterpriseSurfaceProps;
  basePath: string;
  notices: SurfaceBlock[];
}) => TemplateResult;

/** Tabs that own a heavy surface module (lazy-loaded). */
export type LazyEnterpriseSurfaceTab = Exclude<
  EnterpriseSurfaceTab,
  "enterpriseAgents" | "enterpriseUsageManagement"
>;

/**
 * Use async/await + local bindings (not `import().then(m => () => m.fn())`).
 * Vite's production rewrite of `import().then(m => m.export)` can otherwise
 * replace the module with the export function, so the outer closure's `m.fn`
 * becomes undefined and Lit render throws — freezing nav/tab clicks.
 */
async function loadEnterpriseSurfaceCss(tab: LazyEnterpriseSurfaceTab): Promise<void> {
  switch (tab) {
    case "enterpriseOrganization":
      await import("../../../../styles/enterprise-org-archive.css");
      return;
    case "enterpriseDataGovernanceCenter":
      await import("../../../../styles/enterprise-data-capability.css");
      return;
    case "enterpriseUsage":
      await Promise.all([
        import("../../../../styles/enterprise-usage-management.css"),
        import("../../../../styles/cost-budget.css"),
        import("../../../../styles/cost-budget-v2.css"),
        import("../../../../styles/pricing-v3.css"),
      ]);
      return;
    case "enterpriseCapabilityCenter":
      await import("../../../../styles/enterprise-usage-management.css");
      return;
    case "enterpriseSettings":
      await Promise.all([
        import("../../../../styles/config.css"),
        import("../../../../styles/enterprise-identity.css"),
        import("../../../../styles/enterprise-data-capability.css"),
      ]);
      return;
    case "enterpriseDiagnosis":
      return;
    default:
      return;
  }
}

const surfaceLoaders: Record<LazyEnterpriseSurfaceTab, () => Promise<SurfaceBodyRenderer>> = {
  enterpriseDiagnosis: async () => {
    await import("../../diagnosis/diagnosis-panel.ts");
    return ({ props }) => html`<openbot-diagnosis-panel
      .client=${props.client ?? null}
      .observationHost=${document.querySelector("openbot-app")}
      role="enterprise"
      .tenantId=${props.readModel.currentTenantId}
      .targets=${diagnosisTargetsFromEnterpriseRoster({
        agents: props.readModel.meshAgents,
        groups: props.readModel.meshGroups,
        spaces: props.collaborationSpacesResult?.spaces,
      })}
    ></openbot-diagnosis-panel>`;
  },
  enterpriseOverview: async () => {
    const { renderEnterpriseOverviewSurface } = await import("./enterprise-overview-surface.ts");
    return ({ props, basePath }) => renderEnterpriseOverviewSurface(props, basePath);
  },
  enterpriseOrganization: async () => {
    await loadEnterpriseSurfaceCss("enterpriseOrganization");
    const { renderOrganizationControl } = await import("./enterprise-organization-surface.ts");
    return ({ props }) => renderOrganizationControl(props);
  },
  enterpriseDataGovernanceCenter: async () => {
    await loadEnterpriseSurfaceCss("enterpriseDataGovernanceCenter");
    const { renderEnterpriseDataGovernanceCenterSurface } =
      await import("./enterprise-data-governance-center-surface.ts");
    return ({ props, basePath }) => renderEnterpriseDataGovernanceCenterSurface(props, basePath);
  },
  enterpriseCapabilityCenter: async () => {
    await loadEnterpriseSurfaceCss("enterpriseCapabilityCenter");
    const { renderEnterpriseCapabilityCenterSurface } =
      await import("./enterprise-capability-center-surface.ts");
    return ({ props, basePath }) => renderEnterpriseCapabilityCenterSurface(props, basePath);
  },
  enterpriseChannels: async () => {
    const { renderEnterpriseMessageChannelsSurface } =
      await import("./enterprise-message-channels-surface.ts");
    const { pathForTab } = await import("../../../navigation.ts");
    const { pushAppHistoryState } = await import("../../../request-app-rerender.ts");
    const { requestEnterpriseAppRerender } = await import("./enterprise-surface-shared.ts");
    return ({ props, basePath }) => {
      const editor = props.channelCredentialsEditor;
      const tenantId = props.readModel.currentTenantId ?? editor?.tenantId ?? null;
      return renderEnterpriseMessageChannelsSurface({
        host: props.client ?? props,
        props: {
          client: props.client ?? null,
          tenantId,
          syncBusy: editor?.syncBusy,
          identityLinkHint: editor?.identityLinkHint ?? null,
          onSyncOperationalIdentity: editor?.onSyncOperationalIdentity
            ? (channelId) => {
                editor.onSelectChannel(channelId);
                editor.onSyncOperationalIdentity?.();
              }
            : undefined,
          onNavigateToIdentities: () => {
            const settingsPath = pathForTab("enterpriseSettings", basePath, {
              tenantId: tenantId ?? undefined,
            });
            const href = settingsPath.endsWith("/settings")
              ? `${settingsPath}/identities`
              : `${settingsPath}/settings/identities`;
            pushAppHistoryState(href);
            requestEnterpriseAppRerender();
          },
        },
        requestUpdate: requestEnterpriseAppRerender,
      });
    };
  },
  enterpriseMesh: async () => {
    const { renderWorkforceGovernanceSurface } =
      await import("./enterprise-workforce-governance-surface.ts");
    // Phase 4: Legacy mesh Ops/Perf shell (alias → renderMeshGovernanceSurface).
    return ({ props, basePath }) => renderWorkforceGovernanceSurface(props, basePath);
  },
  enterpriseUsage: async () => {
    await loadEnterpriseSurfaceCss("enterpriseUsage");
    const { renderEnterpriseUsageSurface } = await import("./enterprise-usage-surface.ts");
    return ({ props, basePath }) => renderEnterpriseUsageSurface(props, basePath);
  },
  enterpriseSettings: async () => {
    await loadEnterpriseSurfaceCss("enterpriseSettings");
    const { renderAccessControlCenter } = await import("./enterprise-access-control-surface.ts");
    return ({ props, notices }) => renderAccessControlCenter(props, notices);
  },
};

const rendererCache = new Map<LazyEnterpriseSurfaceTab, SurfaceBodyRenderer>();
const inFlight = new Map<LazyEnterpriseSurfaceTab, Promise<SurfaceBodyRenderer>>();
const readyListeners = new Set<() => void>();

export function isLazyEnterpriseSurfaceTab(tab: string): tab is LazyEnterpriseSurfaceTab {
  return Object.prototype.hasOwnProperty.call(surfaceLoaders, tab);
}

export function subscribeEnterpriseSurfaceReady(listener: () => void): () => void {
  readyListeners.add(listener);
  return () => {
    readyListeners.delete(listener);
  };
}

function notifyEnterpriseSurfaceReady() {
  for (const listener of readyListeners) {
    try {
      listener();
    } catch {
      // Host re-render must not break chunk load completion.
    }
  }
}

export async function preloadEnterpriseSurface(
  tab: LazyEnterpriseSurfaceTab,
): Promise<SurfaceBodyRenderer> {
  const cached = rendererCache.get(tab);
  if (cached) {
    return cached;
  }
  const pending = inFlight.get(tab);
  if (pending) {
    return pending;
  }
  const load = surfaceLoaders[tab]()
    .then((renderer) => {
      rendererCache.set(tab, renderer);
      inFlight.delete(tab);
      notifyEnterpriseSurfaceReady();
      return renderer;
    })
    .catch((err) => {
      inFlight.delete(tab);
      throw err;
    });
  inFlight.set(tab, load);
  return load;
}

export async function preloadAllEnterpriseSurfaces(): Promise<void> {
  await Promise.all(
    (Object.keys(surfaceLoaders) as LazyEnterpriseSurfaceTab[]).map((tab) =>
      preloadEnterpriseSurface(tab),
    ),
  );
}

/**
 * Resolve a tab body renderer. When the chunk is not ready yet, kick off the
 * dynamic import and return null so the caller can show a lightweight placeholder.
 */
export function resolveEnterpriseSurfaceRenderer(
  tab: LazyEnterpriseSurfaceTab,
): SurfaceBodyRenderer | null {
  const cached = rendererCache.get(tab);
  if (cached) {
    return cached;
  }
  void preloadEnterpriseSurface(tab).catch((err) => {
    console.error(`[enterprise-surface] failed to load ${tab}`, err);
  });
  return null;
}

export function renderEnterpriseSurfaceLoadingPlaceholder(
  tab: LazyEnterpriseSurfaceTab,
): TemplateResult {
  return html`
    <section
      class="enterprise-org-ws enterprise-org-ws--flat"
      data-enterprise-surface-loading=${tab}
    >
      <p class="enterprise-org-ws__hint">正在加载企业模块…</p>
    </section>
  `;
}
