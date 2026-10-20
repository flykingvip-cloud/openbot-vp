import { html, nothing } from "lit";
import { formatCost } from "../../../../views/usage-metrics.ts";
import type { PlatformPortReadModel } from "../../semantic/platform-read-model.ts";

export type ModelsAorIntegrationProps = {
  readModel: PlatformPortReadModel;
};

function syncStatusLabel(status: string | undefined) {
  switch (status) {
    case "ok":
      return "正常";
    case "degraded":
      return "降级";
    case "unavailable":
      return "不可用";
    default:
      return status ?? "未知";
  }
}

function modeLabel(mode: string | undefined) {
  return mode === "aor_enhanced" ? "AOR 增强" : "原生";
}

export function renderModelsAorStatusCard(props: ModelsAorIntegrationProps) {
  const mode = props.readModel.platformModelsMode ?? "native";
  if (mode !== "aor_enhanced") {
    return nothing;
  }
  const aor = props.readModel.aor;
  const loading = props.readModel.modelsManagementLoading === true;
  const error = props.readModel.modelsManagementError;
  const snapshotAt = props.readModel.modelsManagementSnapshotAt;

  return html`
    <section class="card card-lead--lg">
      <div class="card-title">AOR 集成状态</div>
      <div class="card-sub">
        平台模型管理运行在 ${modeLabel(mode)} 模式；AOR
        作为执行与反馈增强层，平台配置仍为控制面真源。
      </div>
      ${
        loading
          ? html`
              <div class="muted card-follow--sm">正在加载 AOR snapshot…</div>
            `
          : nothing
      }
      ${error ? html`<div class="callout danger card-follow--sm">${error}</div>` : nothing}
      ${
        !loading && !error
          ? html`
              <div class="stat-grid stat-grid--compact card-follow">
                <div class="stat stat--compact">
                  <div class="stat-label">AOR 启用</div>
                  <div class="stat-value">${aor?.enabled ? "是" : "否"}</div>
                </div>
                <div class="stat stat--compact">
                  <div class="stat-label">同步状态</div>
                  <div
                    class="stat-value ${aor?.syncStatus === "ok" ? "ok" : aor?.syncStatus ? "warn" : ""}"
                  >
                    ${syncStatusLabel(aor?.syncStatus)}
                  </div>
                </div>
                <div class="stat stat--compact">
                  <div class="stat-label">策略绑定</div>
                  <div class="stat-value">${aor?.policyBindings?.length ?? 0}</div>
                </div>
                <div class="stat stat--compact">
                  <div class="stat-label">路由解释</div>
                  <div class="stat-value">${aor?.routingExplanations?.length ?? 0}</div>
                </div>
              </div>
              ${
                snapshotAt
                  ? html`<div class="muted card-follow--xs">Snapshot：${snapshotAt}</div>`
                  : nothing
              }
            `
          : nothing
      }
    </section>
  `;
}

export function renderModelsAorBanditPanel(props: ModelsAorIntegrationProps) {
  const mode = props.readModel.platformModelsMode ?? "native";
  const aor = props.readModel.aor;
  if (mode !== "aor_enhanced" || !aor?.enabled) {
    return nothing;
  }
  const arms = aor.learning?.arms ?? [];
  const optimization = aor.optimization;
  if (arms.length === 0 && !optimization) {
    return nothing;
  }

  return html`
    <section class="card card-lead--lg">
      <div class="card-title">AOR 学习与优化</div>
      ${
        optimization
          ? html`
              <div class="stat-grid stat-grid--compact card-follow">
                <div class="stat stat--compact">
                  <div class="stat-label">节省代理量</div>
                  <div class="stat-value">${optimization.savingsProxyQty}</div>
                </div>
                <div class="stat stat--compact">
                  <div class="stat-label">分成代理量</div>
                  <div class="stat-value">${optimization.revenueShareProxyQty}</div>
                </div>
                ${
                  optimization.savingsUsd != null
                    ? html`
                        <div class="stat stat--compact">
                          <div class="stat-label">节省估算</div>
                          <div class="stat-value">${formatCost(optimization.savingsUsd)}</div>
                        </div>
                      `
                    : nothing
                }
              </div>
            `
          : nothing
      }
      ${
        arms.length > 0
          ? html`
              <div class="list card-follow">
                ${arms.map(
                  (arm) => html`
                    <div class="list-item">
                      <div class="list-main">
                        <div class="list-title mono">${arm.arm}</div>
                        <div class="list-sub">
                          mean ${arm.mean.toFixed(3)} · trials ${arm.trials}
                        </div>
                      </div>
                    </div>
                  `,
                )}
              </div>
            `
          : html`
              <div class="muted card-follow--sm">暂无 bandit 臂数据</div>
            `
      }
    </section>
  `;
}

export function renderModelsAorLiveCodingEvidence(props: ModelsAorIntegrationProps) {
  const mode = props.readModel.platformModelsMode ?? "native";
  const evidence = props.readModel.aor?.liveCodingEvidence ?? [];
  if (mode !== "aor_enhanced" || evidence.length === 0) {
    return nothing;
  }

  return html`
    <section class="card card-lead--lg">
      <div class="card-title">AOR Live Coding 证据</div>
      <div class="list card-follow">
        ${evidence.slice(0, 8).map(
          (entry) => html`
            <div class="list-item">
              <div class="list-main">
                <div class="list-title">${entry.goal}</div>
                <div class="list-sub mono">${entry.workspace} · ${entry.model}</div>
                <div class="list-sub">
                  run ${entry.runId}
                  ${
                    entry.evaluationScore != null
                      ? html` · score ${entry.evaluationScore.toFixed(2)}`
                      : nothing
                  }
                </div>
              </div>
              <div class="list-meta">${entry.archivedAt}</div>
            </div>
          `,
        )}
      </div>
    </section>
  `;
}

export function renderPlanAorExecutionChip(
  aorExecution:
    | {
        taskTypeId: string;
        selectorStrategy: string;
        evaluatorMode: string;
        skillId?: string;
      }
    | undefined,
) {
  if (!aorExecution) {
    return nothing;
  }
  return html`
    <span class="chip mono" title="AOR 执行映射">
      ${aorExecution.taskTypeId} · ${aorExecution.selectorStrategy} · ${aorExecution.evaluatorMode}
    </span>
  `;
}
