import { html, nothing, type TemplateResult } from "lit";
import {
  formatMoney,
  formatTokenTally,
  type UsageCostLayerView,
  type UsageCostSurface,
  type UsageCostTaskNode,
} from "../../../../../src/shared/usage-cost-layer.ts";
import {
  ensureUsageCostLayer,
  readUsageCostSlot,
  usageCostSlotKey,
  type UsageCostClient,
} from "./usage-cost-client.ts";

export function renderUsageCostDisclosure(input: {
  surface: UsageCostSurface;
  taskId?: string | null;
  tenantId?: string | null;
  enterpriseId?: string | null;
  client?: UsageCostClient | null;
  rerender?: (() => void) | null;
  budgetLevel?: "ok" | "alert" | "exceeded" | null;
}): TemplateResult | typeof nothing {
  const key = usageCostSlotKey(input);
  const canLoad = typeof input.client?.request === "function";
  const slot = readUsageCostSlot(key);
  if (canLoad && slot.status === "idle") {
    void ensureUsageCostLayer(input);
  }
  const current = readUsageCostSlot(key);
  if (!canLoad && current.status === "idle" && !current.view) {
    return nothing;
  }
  return renderUsageCostPanel(current.view, {
    surface: input.surface,
    status: current.status === "idle" && canLoad ? "loading" : current.status,
    error: current.error,
    budgetLevel: input.budgetLevel,
    onRetry: canLoad
      ? () => {
          void ensureUsageCostLayer({ ...input, force: true });
        }
      : null,
  });
}

export function renderUsageCostPanel(
  view: UsageCostLayerView | null,
  options: {
    surface: UsageCostSurface;
    status: "idle" | "loading" | "ready" | "error";
    error?: string | null;
    budgetLevel?: "ok" | "alert" | "exceeded" | null;
    onRetry?: (() => void) | null;
  },
): TemplateResult {
  const surface = view?.surface ?? options.surface;
  const summary =
    view?.headline ?? (options.status === "error" ? "用量暂时无法读取" : "用量与费用");
  const body = renderUsageCostBody(view, options);
  if (surface === "user") {
    return html`
      <details class="usage-cost" data-testid="usage-cost-panel" data-surface="user">
        <summary data-testid="usage-cost-summary">${summary}</summary>
        ${body}
      </details>
    `;
  }
  return html`
    <section class="enterprise-card usage-cost" data-testid="usage-cost-panel" data-surface=${surface}>
      <header class="usage-cost__head">
        <h3>${surface === "platform" ? "请求与成本" : "用量与费用"}</h3>
        <p class="muted" data-testid="usage-cost-summary">${summary}</p>
      </header>
      ${body}
    </section>
  `;
}

function renderUsageCostBody(
  view: UsageCostLayerView | null,
  options: {
    status: "idle" | "loading" | "ready" | "error";
    error?: string | null;
    budgetLevel?: "ok" | "alert" | "exceeded" | null;
    onRetry?: (() => void) | null;
  },
): TemplateResult {
  const attention =
    view?.attention.active && view.attention.message
      ? view.attention.message
      : options.budgetLevel === "exceeded"
        ? "已超出月度预算上限"
        : options.budgetLevel === "alert"
          ? "已达到预算提醒阈值"
          : null;
  return html`
    <div data-testid="usage-cost-detail">
      ${
        options.status === "loading"
          ? html`
              <p class="muted" data-testid="usage-cost-freshness">用量读取中，执行中的数字可能稍后更新</p>
            `
          : nothing
      }
      ${
        options.status === "error"
          ? html`
              <div class="callout warning" data-testid="usage-cost-error">
                <p>${options.error || "用量暂时无法读取，请稍后重试"}</p>
                ${
                  options.onRetry
                    ? html`<button type="button" class="btn btn--sm" @click=${options.onRetry}>重试</button>`
                    : nothing
                }
              </div>
            `
          : nothing
      }
      ${
        view?.freshness === "delayed"
          ? html`
              <p class="muted" data-testid="usage-cost-freshness">执行中，用量可能稍后更新</p>
            `
          : nothing
      }
      ${
        view?.coverage === "truncated"
          ? html`
              <p class="muted">只展示最近 200 条，合计不是全量</p>
            `
          : nothing
      }
      ${
        attention
          ? html`<div class="callout warning" data-testid="usage-cost-attention">${attention}</div>`
          : nothing
      }
      ${
        !view || view.empty
          ? options.status === "loading"
            ? nothing
            : html`
                <p data-testid="usage-cost-empty">这段时间没有可展示的用量，不会显示示例费用。</p>
              `
          : html`
              <p data-testid="usage-cost-calls">调用 ${view.callCount} 次</p>
              <p data-testid="usage-cost-tokens">
                输入 ${formatTokenTally(view.input)} · 输出 ${formatTokenTally(view.output)} · 缓存读
                ${formatTokenTally(view.cacheRead)} · 缓存写 ${formatTokenTally(view.cacheWrite)}
              </p>
              ${
                view.cacheNote
                  ? html`<p data-testid="usage-cost-cache-note">${view.cacheNote}</p>`
                  : nothing
              }
              <ul data-testid="usage-cost-charges">
                ${view.charges.map((line) => html`<li>${line.label}</li>`)}
              </ul>
              ${
                view.mixedCurrency
                  ? html`
                      <p>不同币种分开列出，没有合并成一个总数。</p>
                    `
                  : nothing
              }
              ${renderModelRows(view)}
              ${renderBuckets("成员", view.byMember)}
              ${renderBuckets("助手", view.byAssistant)}
              ${renderTasks(view.tasks)}
              <p data-testid="usage-cost-reconcile">
                明细 ${view.reconciliation.detailInputKnown} · 模型小计
                ${view.reconciliation.modelInputKnown} · 任务合计 ${view.reconciliation.taskInputKnown}
                ${view.reconciliation.aligned ? "已对齐" : "对账不一致"}
              </p>
              ${renderPlatformCost(view)}
            `
      }
    </div>
  `;
}

function renderModelRows(view: UsageCostLayerView): TemplateResult | typeof nothing {
  if (view.models.length === 0) {
    return nothing;
  }
  return html`
    <ul data-testid="usage-cost-models">
      ${view.models.map((row) => {
        const retry =
          row.retryCount > 0 || row.fallbackCount > 0
            ? `，重试 ${row.retryCount}，回退 ${row.fallbackCount}`
            : "";
        return html`
          <li>
            ${row.provider ?? "未知供应商"} / ${row.model ?? "未知模型"} · ${row.callCount} 次${retry}
            · 输入 ${formatTokenTally(row.input)} · 输出 ${formatTokenTally(row.output)}
            ${row.charges.map((line) => html` · ${line.label}`)}
          </li>
        `;
      })}
    </ul>
  `;
}

function renderBuckets(
  title: string,
  rows: UsageCostLayerView["byMember"],
): TemplateResult | typeof nothing {
  if (rows.length === 0) {
    return nothing;
  }
  return html`
    <section>
      <h4>${title}</h4>
      <ul>
        ${rows.map(
          (row) => html`
            <li>
              ${row.id} · ${row.callCount} 次 · 失败或取消 ${row.failedCount} · 重试 ${row.retryCount} ·
              回退 ${row.fallbackCount}
              ${row.charges.map((line) => html` · ${line.label}`)}
            </li>
          `,
        )}
      </ul>
    </section>
  `;
}

function renderTasks(tasks: UsageCostTaskNode[]): TemplateResult | typeof nothing {
  if (tasks.length === 0) {
    return nothing;
  }
  return html`<ul data-testid="usage-cost-tasks">${tasks.map((task) => renderTask(task))}</ul>`;
}

function renderTask(task: UsageCostTaskNode): TemplateResult {
  const note = task.rolledUpFromChildren ? "合计来自子任务，父级没有再加一次" : "";
  return html`
    <li>
      <details>
        <summary>${task.taskId} · ${task.callCount} 次 ${note}</summary>
        <p>输入 ${formatTokenTally(task.input)} · 输出 ${formatTokenTally(task.output)}</p>
        <ul>
          ${task.charges.map((line) => html`<li>${line.label}</li>`)}
        </ul>
        ${task.children.length > 0 ? renderTasks(task.children) : nothing}
      </details>
    </li>
  `;
}

function renderPlatformCost(view: UsageCostLayerView): TemplateResult | typeof nothing {
  if (view.surface !== "platform") {
    return nothing;
  }
  const procurement =
    view.procurementStatus === "free" &&
    view.procurementCents !== null &&
    view.procurementCents !== undefined
      ? `免费模型 ${formatMoney("CNY", view.procurementCents)}`
      : view.procurementStatus === "mixed" ||
          view.procurementCents === null ||
          view.procurementCents === undefined
        ? "采购成本待确认"
        : `采购成本 ${formatMoney("CNY", view.procurementCents)}`;
  const margin =
    view.commercialMarginCents === null || view.commercialMarginCents === undefined
      ? "商业差额待确认"
      : `商业差额 ${formatMoney("CNY", view.commercialMarginCents)}`;
  return html`
    <section data-testid="usage-cost-platform">
      <p>${procurement} · ${margin}</p>
      ${view.taskType ? html`<p>任务类型 ${view.taskType}</p>` : nothing}
      ${view.acceptance ? html`<p>验收 ${view.acceptance}</p>` : nothing}
      <ul data-testid="usage-cost-ranking">
        ${(view.ranking ?? []).map(
          (row) => html`
            <li>
              ${row.provider ?? "未知供应商"} / ${row.model ?? "未知模型"} ·
              ${row.priceKind === "free" ? "免费模型" : "采购"}
              ${formatMoney("CNY", row.procurementCents)} · 成功率
              ${row.successRate === null ? "未知" : `${Math.round(row.successRate * 100)}%`}
            </li>
          `,
        )}
      </ul>
      <ul data-testid="usage-cost-unranked">
        ${(view.excludedFromRanking ?? []).map(
          (row) => html`
            <li>
              ${row.model ?? "未知模型"} 未进入成本排名（${row.reason === "missing_price" ? "价格缺失" : "用量未知"}）
            </li>
          `,
        )}
      </ul>
    </section>
  `;
}
