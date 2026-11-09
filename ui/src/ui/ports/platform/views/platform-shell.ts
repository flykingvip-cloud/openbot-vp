import { html, nothing } from "lit";
import { pathForTab } from "../../../navigation.ts";
import { shouldShowPlatformLoginEntry } from "../platform-auth-session.ts";
import { renderPlatformCreateTenantDrawer } from "../system-settings/create-tenant-drawer.ts";
import type { PlatformPortRenderModel } from "../view-types.ts";
import { renderPlatformSurface } from "./platform-surfaces.ts";

export function renderPlatformPortShell(model: PlatformPortRenderModel) {
  const isPlatformSurface =
    model.state.tab === "platformDashboard" ||
    model.state.tab === "platformTenants" ||
    model.state.tab === "platformPricing" ||
    model.state.tab === "platformCapabilities" ||
    model.state.tab === "platformModels" ||
    model.state.tab === "platformAgents" ||
    model.state.tab === "platformObservation" ||
    model.state.tab === "platformDiagnosis" ||
    model.state.tab === "platformAdvanced" ||
    model.state.tab === "platformSystemSettings" ||
    model.state.tab === "platformProductization" ||
    model.state.tab === "platformKeyAccounts";

  const surfaceProps = isPlatformSurface
    ? {
        tab: model.state.tab as Parameters<typeof renderPlatformSurface>[0]["tab"],
        basePath: model.state.basePath,
        client: model.state.client,
        readModel: model.readModel,
        observationHost: model.observationHost ?? null,
        channelsProps: model.channelsProps,
        skillsProps: model.skillsProps,
        instancesProps: model.instancesProps,
        nodesProps: model.nodesProps,
        sessionsProps: model.sessionsProps,
        logsProps: model.logsProps,
        authPanelProps: model.authPanelProps ?? null,
        operationalIdentityGovernancePanel: model.operationalIdentityGovernancePanel,
        pageViewModels: model.pageViewModels,
        actions: model.surfaceActions,
        scopes:
          model.state.platformAuthState?.session?.scopes ??
          model.state.bootstrapAuthSession?.scopes,
        sessionKind: model.state.platformAuthState?.sessionKind ?? null,
        gatewayMethods: model.state.hello?.features?.methods ?? null,
        connected: model.state.connected,
      }
    : null;

  const unauthenticatedPlatformEntry =
    surfaceProps && shouldShowPlatformLoginEntry(model.state)
      ? html`
          <section class="card card-follow">
            <div class="card-title">平台登录入口</div>
            <div class="card-sub">当前未检测到平台管理员会话。请先进入独立平台登录页。</div>
            <div class="row row--tight row--wrap card-follow">
              <a class="btn btn--primary" href=${pathForTab("platformLogin", model.state.basePath)}>
                平台登录
              </a>
              <a class="btn" href=${pathForTab("trialApply", model.state.basePath)}>
                申请企业试用
              </a>
            </div>
          </section>
        `
      : nothing;

  return html`
    ${unauthenticatedPlatformEntry} ${surfaceProps ? renderPlatformSurface(surfaceProps) : nothing}
    ${surfaceProps ? renderPlatformCreateTenantDrawer(surfaceProps) : nothing}
  `;
}
