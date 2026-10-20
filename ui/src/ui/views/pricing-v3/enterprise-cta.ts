import { html, type TemplateResult } from "lit";
import { renderIcon } from "../../icons.ts";

const VALUE_PROPS = [
  {
    icon: "rocket" as const,
    title: "快速上线",
    body: "分钟级创建 AI 员工，快速部署企业 AI 团队",
  },
  {
    icon: "shield" as const,
    title: "安全可靠",
    body: "企业级安全与合规，保障数据安全与隐私",
  },
  {
    icon: "trendingUp" as const,
    title: "持续进化",
    body: "持续更新的 AI 能力与行业最佳实践",
  },
  {
    icon: "layers" as const,
    title: "灵活扩展",
    body: "随时升级或降级，按需扩展组织能力",
  },
  {
    icon: "barChart" as const,
    title: "成本可控",
    body: "清晰透明的计费，无隐藏成本",
  },
] as const;

export function renderEnterpriseValueStrip(): TemplateResult {
  return html`
    <section class="pricing-v3__value-strip" aria-label="平台价值">
      ${VALUE_PROPS.map(
        (item) => html`
          <div class="pricing-v3__value-item">
            <span class="pricing-v3__value-icon" aria-hidden="true">${renderIcon(item.icon)}</span>
            <div>
              <div class="pricing-v3__value-title">${item.title}</div>
              <div class="pricing-v3__value-body">${item.body}</div>
            </div>
          </div>
        `,
      )}
    </section>
  `;
}
