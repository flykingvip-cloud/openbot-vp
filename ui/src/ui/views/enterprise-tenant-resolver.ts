import { html } from "lit";
import { t } from "../../i18n/index.ts";

export type EnterpriseTenantResolverOption = {
  tenantId: string;
  label: string;
  description?: string;
  kind: "current" | "recent" | "invite";
};

export type EnterpriseTenantResolverProps = {
  options: EnterpriseTenantResolverOption[];
  currentTenantId?: string | null;
  authenticatedUser?: string | null;
  onOpenTenant: (tenantId: string) => void;
};

function renderKindLabel(kind: EnterpriseTenantResolverOption["kind"]) {
  switch (kind) {
    case "current":
      return "当前访问";
    case "invite":
      return "邀请上下文";
    case "recent":
    default:
      return "最近使用";
  }
}

export function renderEnterpriseTenantResolver(props: EnterpriseTenantResolverProps) {
  const options = props.options;
  return html`
    <section class="stack frontstage-stack">
      <div class="card">
        <div class="card-title">选择企业租户</div>
        <div class="card-sub">
          企业工作台与租户强绑定。进入治理、组织与协作视图前，请先选择要操作的企业上下文。
        </div>
        ${
          props.authenticatedUser
            ? html`<div class="pill" style="margin-top: 12px;">
                ${t("common.connect")} <span class="mono">${props.authenticatedUser}</span>
              </div>`
            : ""
        }
      </div>

      ${
        options.length > 0
          ? html`
              <div class="grid grid-cols-2">
                ${options.map((option) => {
                  const active = option.tenantId === props.currentTenantId;
                  return html`
                    <button
                      class="card"
                      @click=${() => props.onOpenTenant(option.tenantId)}
                      style=${active ? "border-color: var(--color-accent);" : ""}
                    >
                      <div class="card-title">${option.label}</div>
                      <div class="card-sub">${option.description ?? option.tenantId}</div>
                      <div class="pill" style="margin-top: 12px; width: fit-content;">
                        ${renderKindLabel(option.kind)}
                      </div>
                    </button>
                  `;
                })}
              </div>
            `
          : html`
              <div class="callout info">
                当前还没有可用的企业上下文。请先完成企业登录，或先打开一条企业邀请链接。
              </div>
            `
      }
    </section>
  `;
}
