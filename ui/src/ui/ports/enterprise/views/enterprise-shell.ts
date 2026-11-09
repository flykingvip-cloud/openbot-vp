import "../../../../styles/cost-budget.css";
import "../../../../styles/cost-budget-v2.css";
import "../../../../styles/pricing-v3.css";
import "../../../../styles/enterprise-identity.css";
// Live render path is enterprise-surfaces-core (static), not the lazy CSS loader.
// Without these imports, archive footer rules and the channel switcher never enter the UI bundle.
import "../../../../styles/enterprise-org-archive.css";
import "../../../../styles/enterprise-im-channels.css";
import { html, nothing } from "lit";
import { pathForTab } from "../../../navigation.ts";
import { platformCreateTenantHref } from "../../platform/system-settings/route.ts";
import type { EnterprisePortRenderModel } from "../view-types.ts";
import { isEnterpriseSurfaceTab, renderEnterpriseSurface } from "./enterprise-surfaces.ts";

function renderEnterpriseResolverPreview(
  tab: EnterprisePortRenderModel["state"]["tab"],
  resolverProps: EnterprisePortRenderModel["resolverProps"],
) {
  const sections = (() => {
    switch (tab) {
      case "enterpriseOrganization":
        return [
          { title: "用户", subtitle: "成员目录、身份与企业访问范围。" },
          { title: "团队与群组", subtitle: "团队归属、群组结构与协作上下文。" },
          { title: "角色与权限", subtitle: "企业管理员、角色边界与权限治理。" },
        ];
      case "enterpriseDataGovernanceCenter":
        return [
          { title: "数据源", subtitle: "查看企业接入的数据资产、连接状态与身份绑定。" },
          { title: "授权边界", subtitle: "梳理岗位、团队和运行时数据访问开放范围。" },
          { title: "知识供给", subtitle: "衔接数据能力、知识供给与审计血缘概览。" },
        ];
      case "enterpriseCapabilityCenter":
        return [
          { title: "资产工作台", subtitle: "承接员工贡献，统一查看审核、入库、安装和推广状态。" },
          { title: "审核与资产库", subtitle: "处理员工资产草稿贡献，形成企业正式可复用资产。" },
          {
            title: "机器人视图与效果",
            subtitle: "按机器人查看能力配置、运行表现、调用量与成功率。",
          },
          {
            title: "应用治理与孵化",
            subtitle: "识别低效/未使用/冲突能力，并推动高潜能力孵化上架。",
          },
        ];
      case "enterpriseMesh":
        return [
          { title: "员工创建对象", subtitle: "看清每个员工创建了多少机器人和协作小组。" },
          { title: "运行与异常", subtitle: "监测对象运行、成本、归因、负责人和异常队列。" },
          { title: "能力成长路径", subtitle: "从机器人明细跳转到能力配置，追踪能力安装与迭代。" },
        ];
      case "enterpriseUsage":
        return [
          { title: "成本总账", subtitle: "企业整体成本、预算压力和趋势锚点。" },
          { title: "对象成本", subtitle: "按成员、机器人、协作小组追踪成本归属。" },
          { title: "预算复核", subtitle: "识别缺失归因、异常消耗与预算治理事项。" },
        ];
      case "enterpriseChannels":
        return [
          { title: "企业微信", subtitle: "配置租户级企微凭证与回调 path（Channel）。" },
          { title: "飞书 / 钉钉", subtitle: "同类 IM 渠道凭证，隔离于其他租户。" },
          { title: "保存说明", subtitle: "仅保存凭证；运行时连接需网关加载 tenant accounts。" },
        ];
      case "enterpriseSettings":
        return [
          { title: "企业身份", subtitle: "运营账号与数字账户（非 IM 通道）。" },
          { title: "渠道凭证", subtitle: "企业微信 / 飞书 / 钉钉 IM 凭证，按租户隔离。" },
          { title: "集成与权限", subtitle: "通道接入、资产流转策略与权限矩阵。" },
        ];
      case "enterpriseOverview":
      default:
        return [
          { title: "活动", subtitle: "企业活动、活跃信号与租户摘要。" },
          { title: "代理使用", subtitle: "代理使用分布与默认代理入口。" },
          { title: "成本快照", subtitle: "当前成本、令牌与使用压力。" },
          { title: "告警", subtitle: "配置问题、治理提醒与告警入口。" },
        ];
    }
  })();

  return html`
    <section class="enterprise-resolver">
      <div class="callout info">
        ${
          resolverProps.options.length > 0
            ? "选择一个租户后即可进入真实管理页，当前先展示模块结构预览。"
            : "当前还没有可用租户。请先完成企业申请、接受邀请，或由平台创建租户。"
        }
      </div>
      ${
        resolverProps.options.length === 0
          ? html`
              <section class="enterprise-card enterprise-card--compact enterprise-gate-card">
                <div class="enterprise-section__title">进入企业控制台</div>
                <p class="enterprise-section__description">
                  你当前还没有可用企业会话。先登录企业管理员账户，或先申请企业试用。
                </p>
                <div class="enterprise-gate-card__actions">
                  <a class="btn btn--primary" href=${pathForTab("enterpriseLogin")}>企业登录</a>
                  <a class="btn" href=${pathForTab("trialApply")}>申请企业试用</a>
                  <a class="btn" href=${pathForTab("me")}>员工激活或登录</a>
                  <a class="btn" href=${platformCreateTenantHref("")}>平台创建租户</a>
                </div>
              </section>
            `
          : nothing
      }
      ${
        resolverProps.options.length > 0
          ? html`
              <div class="enterprise-resolver__grid">
                ${resolverProps.options.map(
                  (option) => html`
                    <button
                      type="button"
                      class="enterprise-card enterprise-card--interactive enterprise-card--compact"
                      @click=${() => resolverProps.onOpenTenant(option.tenantId)}
                    >
                      <div class="enterprise-section__title">${option.label}</div>
                      <p class="enterprise-section__description">
                        ${option.description ?? option.tenantId}
                      </p>
                    </button>
                  `,
                )}
              </div>
            `
          : nothing
      }
      <div class="enterprise-resolver__grid">
        ${sections.map(
          (section) => html`
            <section class="enterprise-card enterprise-card--compact">
              <div class="enterprise-section__title">${section.title}</div>
              <p class="enterprise-section__description">${section.subtitle}</p>
            </section>
          `,
        )}
      </div>
    </section>
  `;
}

export function renderEnterprisePortShell(model: EnterprisePortRenderModel) {
  return html`
    ${
      model.isResolverSurface && isEnterpriseSurfaceTab(model.state.tab)
        ? renderEnterpriseResolverPreview(model.state.tab, model.resolverProps)
        : nothing
    }
    ${
      !model.isResolverSurface && isEnterpriseSurfaceTab(model.state.tab)
        ? renderEnterpriseSurface({
            tab: model.state.tab,
            basePath: model.state.basePath,
            client: model.client,
            connected: model.state.connected,
            scopes: model.state.hello?.auth?.scopes ?? null,
            sessionKind: model.state.platformAuthState?.sessionKind ?? null,
            gatewayMethods: model.state.hello?.features?.methods ?? null,
            agentsList: model.state.agentsList,
            collaborationSpacesResult: model.state.collaborationSpacesResult,
            readModel: model.readModel,
            operationalIdentityGovernancePanel: model.operationalIdentityGovernancePanel,
            actions: model.surfaceActions,
            authPanelProps: model.authPanelProps,
            accessControlEditor: model.accessControlEditor,
            createPositionEditor: model.createPositionEditor,
            seatOfferEditor: model.seatOfferEditor,
            identityManagementEditor: model.identityManagementEditor,
            handoverEditor: model.handoverEditor,
            ownershipTransferEditor: model.ownershipTransferEditor,
            cronProps: model.cronProps,
            channelCredentialsEditor: model.channelCredentialsEditor,
            organizationMonthlyUsageLoading: model.state.enterpriseOrganizationMonthlyUsageLoading,
            organizationMonthlyUsageError: model.state.enterpriseOrganizationMonthlyUsageError,
            organizationMonthlyUsage: model.state.enterpriseOrganizationMonthlyUsage,
          })
        : nothing
    }
  `;
}
