import { html, nothing, type TemplateResult } from "lit";
import type {
  PricingCompareRow,
  PricingPlanViewModel,
} from "../../capability/platform-pricing-catalog/index.ts";
import { renderIcon } from "../../icons.ts";

const DEFAULT_SLOT_ORDER = ["trial", "starter", "professional", "business", "enterprise"] as const;

/**
 * Compare groups — only runtime-enforced commercial capacity.
 * SLA/support/MFA/SSO/isolation/VPC/workflows/knowledge/audit stay out until gated.
 */
const COMPARE_GROUPS: ReadonlyArray<{
  id: string;
  label: string;
  rowIds: readonly string[];
}> = [
  {
    id: "capacity",
    label: "团队规模与 AI 能力",
    rowIds: [
      "teamSeats",
      "aiEmployees",
      "aiBasic",
      "aiPro",
      "aiElite",
      "creditsMonthly",
      "concurrentRuns",
      "overagePolicy",
    ],
  },
];

const AI_CAPABILITY_FOOTNOTE =
  "AI 能力等级决定成员可使用的模型与任务能力范围；企业管理权限由成员角色单独设置。";

function formatCell(
  value: string | boolean | undefined,
  /** 当前列套餐 slot：enterprise 的 custom = 定制；自助档 custom = 无限配额 */
  slot?: string,
): TemplateResult {
  if (value === "custom") {
    const isEnterprise = slot === "enterprise";
    const label = isEnterprise ? "定制" : "无限";
    return html`
      <span class="pricing-v3__compare-custom" aria-label=${label}>${label}</span>
    `;
  }
  if (value === true) {
    return html`<span class="pricing-v3__compare-yes" aria-label="支持"
      >${renderIcon("check")}<span class="pricing-v3__sr-only">支持</span></span
    >`;
  }
  if (value === false) {
    return html`
      <span class="pricing-v3__compare-no" aria-label="不支持"
        >—<span class="pricing-v3__sr-only">不支持</span></span
      >
    `;
  }
  if (value == null || value === "" || value === "—") {
    return html`
      <span class="pricing-v3__compare-empty" aria-label="不支持">—</span>
    `;
  }
  return html`<span>${value}</span>`;
}

function isEmptyCell(value: string | boolean | undefined): boolean {
  return value === false || value == null || value === "" || value === "—";
}

function filterVisibleRows(rows: readonly PricingCompareRow[]): PricingCompareRow[] {
  return rows.filter((row) => {
    const vals = Object.values(row.values);
    if (vals.length === 0) {
      return false;
    }
    if (vals.every((v) => v === false)) {
      return false;
    }
    if (vals.every((v) => isEmptyCell(v))) {
      return false;
    }
    return true;
  });
}

export type CapabilityCompareOptions = {
  /** When false (default), trial column is omitted and title says 付费套餐功能对比. */
  includeTrial?: boolean;
};

export function renderCapabilityCompareSection(
  rows: readonly PricingCompareRow[],
  plans: readonly PricingPlanViewModel[],
  options: CapabilityCompareOptions = {},
): TemplateResult {
  const includeTrial = options.includeTrial === true;
  const slotOrder = includeTrial
    ? DEFAULT_SLOT_ORDER
    : DEFAULT_SLOT_ORDER.filter((s) => s !== "trial");
  const columns = slotOrder
    .map((slot) => plans.find((p) => p.slot === slot))
    .filter((p): p is PricingPlanViewModel => Boolean(p));
  const visibleRows = filterVisibleRows(rows);
  if (columns.length === 0 || visibleRows.length === 0) {
    return html``;
  }

  const rowById = new Map(visibleRows.map((r) => [r.id, r]));
  const grouped: Array<{ groupLabel: string; groupRows: PricingCompareRow[] }> = [];
  const used = new Set<string>();

  for (const group of COMPARE_GROUPS) {
    const groupRows = group.rowIds
      .map((id) => rowById.get(id))
      .filter((r): r is PricingCompareRow => Boolean(r));
    if (groupRows.length === 0) {
      continue;
    }
    for (const r of groupRows) {
      used.add(r.id);
    }
    grouped.push({ groupLabel: group.label, groupRows });
  }
  const leftover = visibleRows.filter((r) => !used.has(r.id));
  if (leftover.length > 0) {
    grouped.push({ groupLabel: "其他", groupRows: [...leftover] });
  }

  const title = includeTrial ? "功能对比" : "付费套餐功能对比";
  const colCount = columns.length + 1;

  return html`
    <section class="pricing-v3__compare-section" data-testid="pricing-v3-compare">
      <h2 class="pricing-v3__section-title">${title}</h2>
      <p
        class="pricing-v3__compare-scroll-hint"
        data-testid="pricing-v3-compare-scroll-hint"
        hidden
      >
        可左右滑动查看完整对比
      </p>
      <div
        class="pricing-v3__compare-table-wrap"
        tabindex="0"
        role="region"
        aria-label=${title}
        data-testid="pricing-v3-compare-wrap"
      >
        <table class="pricing-v3__compare-table">
          <thead>
            <tr>
              <th scope="col" class="pricing-v3__compare-sticky">能力</th>
              ${columns.map(
                (plan) => html`
                  <th
                    scope="col"
                    class=${plan.recommended ? "pricing-v3__compare-col--recommended" : ""}
                  >
                    ${plan.displayName}
                    ${
                      plan.recommended
                        ? html`
                            <span class="pricing-v3__compare-rec-badge">推荐</span>
                          `
                        : nothing
                    }
                  </th>
                `,
              )}
            </tr>
          </thead>
          <tbody>
            ${grouped.map(
              (g) => html`
                <tr class="pricing-v3__compare-group-row" data-testid="pricing-v3-compare-group">
                  <th scope="colgroup" colspan=${colCount} class="pricing-v3__compare-group-label">
                    ${g.groupLabel}
                  </th>
                </tr>
                ${g.groupRows.map(
                  (row) => html`
                    <tr>
                      <th scope="row" class="pricing-v3__compare-sticky">
                        <span class="pricing-v3__compare-row-label">${row.label}</span>
                        ${
                          row.description
                            ? html`
                                <span class="pricing-v3__compare-row-desc">${row.description}</span>
                              `
                            : nothing
                        }
                      </th>
                      ${columns.map(
                        (plan) => html`
                          <td
                            class=${plan.recommended ? "pricing-v3__compare-col--recommended" : ""}
                          >
                            ${formatCell(row.values[plan.slot], plan.slot)}
                          </td>
                        `,
                      )}
                    </tr>
                  `,
                )}
              `,
            )}
          </tbody>
        </table>
      </div>
      <p class="pricing-v3__compare-footnote" data-testid="pricing-v3-ai-capability-footnote">
        ${AI_CAPABILITY_FOOTNOTE}
      </p>
    </section>
  `;
}

/**
 * Show scroll hint only when the compare table actually overflows horizontally
 * (or on coarse-pointer / narrow hosts). Call after render when possible.
 */
export function updateCompareScrollHint(root: ParentNode | null | undefined): void {
  if (!root) {
    return;
  }
  const wrap = root.querySelector('[data-testid="pricing-v3-compare-wrap"]');
  const hint = root.querySelector('[data-testid="pricing-v3-compare-scroll-hint"]');
  if (!(wrap instanceof HTMLElement) || !(hint instanceof HTMLElement)) {
    return;
  }
  const overflows = wrap.scrollWidth > wrap.clientWidth + 2;
  const narrow = typeof window !== "undefined" && window.matchMedia("(max-width: 900px)").matches;
  hint.toggleAttribute("hidden", !(overflows || narrow));
}
