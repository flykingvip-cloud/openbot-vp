import { html, nothing, type TemplateResult } from "lit";

export type DiagnosisViewHealthTone =
  | "ok"
  | "watch"
  | "degraded"
  | "inconclusive"
  | "empty"
  | "error"
  | "expired";

export type DiagnosisViewPermissionState =
  | "allowed"
  | "redacted"
  | "hidden"
  | "forbidden"
  | "expired"
  | "unavailable"
  | "empty";

export type DiagnosisViewConversationEntry = {
  signalId?: string;
  caseId?: string;
  targetRef?: { targetType: string; targetId: string; tenantId: string | null };
  tenantId: string | null;
};

export type DiagnosisViewModel = {
  role: "platform" | "enterprise" | "employee";
  tenantScope: string | null;
  redactionProfile: string;
  permissionState: DiagnosisViewPermissionState;
  health: {
    tone: DiagnosisViewHealthTone;
    label: string;
    openP0: number;
    openP1: number;
    inconclusive: number;
    expired: number;
  };
  cases: Array<{
    caseId: string;
    severity: "P0" | "P1" | "P2" | "P3" | "P4" | null;
    status: string;
    tenantId: string | null;
  }>;
  drilldown: Array<{
    layer: "enterprise" | "agent" | "skill" | "tool";
    id: string;
    status: string;
    tenantId: string | null;
  }>;
  timeline: {
    events: Array<{ kind: string; timestamp: string; ref: { id: string; type: string } }>;
  };
  trend: {
    window: { from: string; to: string };
    completeness: "complete" | "partial" | "empty" | "unavailable";
    buckets: Array<{ at: string; sampleCount: number; present: boolean }>;
    missingBuckets: string[];
  };
  graph: {
    nodes: Array<{ id: string; kind: string; label: string }>;
    edges: Array<{ fromId: string; toId: string; relation: string }>;
  };
  authorizations: {
    rows: Array<{
      grantId: string;
      status: string;
      targetTenant: string | null;
      dataScope: string[];
      actions: string[];
      expiresAt: string;
      risk?: string;
    }>;
    pendingApprovals: Array<{
      grantId: string;
      targetTenant: string | null;
      targetPrincipal?: string;
      dataScope: string[];
      actions: string[];
      expiresAt: string;
      risk?: string;
    }>;
  };
  remediations: Array<{
    remediationId: string;
    status: string;
    verdict?: string;
  }>;
  conversationEntries: DiagnosisViewConversationEntry[];
  reportExport: { action: "export_existing_report"; exporter: string; reportId?: string | null };
  loadError?: string;
  production?: {
    apiLoadState: "idle" | "loading" | "ready" | "unavailable" | "forbidden" | "stale";
    permissionState: DiagnosisViewPermissionState;
    auditState: "recorded" | "missing" | "unavailable";
    freshness: {
      observedAt: string | null;
      maxAgeMs: number;
      stale: boolean;
      completeness: "complete" | "partial" | "empty" | "unavailable";
    };
  };
};

export type PlatformDiagnosisHandlers = {
  onOpenConversation?: (entry: DiagnosisViewConversationEntry) => void;
  onAuthorizationDecision?: (input: {
    grantId: string;
    decision: "approve" | "deny";
    refresh: "p6_p7";
  }) => void;
  onExportReport?: (input: {
    reportId: string | null;
    redactionProfile: "administrator" | "user";
  }) => void;
};

function unavailableTitle(handler: unknown, ready: string, missing: string): string {
  return handler ? ready : missing;
}

function healthCopy(model: DiagnosisViewModel): string {
  if (model.loadError) {
    return "加载失败";
  }
  if (model.permissionState === "forbidden") {
    return "权限不足";
  }
  return model.health.label;
}

export function renderPlatformDiagnosisSurface(
  model: DiagnosisViewModel,
  handlers: PlatformDiagnosisHandlers = {},
): TemplateResult {
  const priorityCases = model.cases.filter((row) => row.severity === "P0" || row.severity === "P1");
  const actionsUnwired =
    !handlers.onAuthorizationDecision && !handlers.onExportReport && !handlers.onOpenConversation;
  return html`
    <section
      class="card"
      data-testid="platform-diagnosis"
      data-role="platform"
      data-health-tone=${model.health.tone}
      data-permission-state=${model.permissionState}
      data-redaction-profile=${model.redactionProfile}
    >
      <div class="card-title">平台诊断总览</div>
      <div class="card-sub" data-testid="platform-health">${healthCopy(model)}</div>
      ${
        actionsUnwired
          ? html`
              <p class="card-sub" data-testid="platform-diagnosis-contract-gap">
                批准、拒绝、导出报告和打开大白没有对应网关方法，按钮保持禁用。
              </p>
            `
          : nothing
      }
      ${
        model.loadError
          ? html`<p data-testid="diagnosis-load-error">加载失败：${model.loadError}</p>`
          : nothing
      }
      ${
        model.health.tone === "empty"
          ? html`
              <p data-testid="diagnosis-empty">暂无数据，不能当作正常或已恢复。</p>
            `
          : nothing
      }
      ${
        model.health.tone === "inconclusive"
          ? html`
              <p data-testid="diagnosis-inconclusive">INCONCLUSIVE：证据不足，不能标为已恢复。</p>
            `
          : nothing
      }
      ${
        model.health.tone === "expired"
          ? html`
              <p data-testid="diagnosis-expired">数据已过期，不能标为正常。</p>
            `
          : nothing
      }

      <section data-testid="platform-signal-trend">
        <h3>跨企业 Signal 趋势</h3>
        <p data-testid="trend-window">${model.trend.window.from} → ${model.trend.window.to}</p>
        <p data-testid="trend-completeness">${model.trend.completeness}</p>
        ${
          model.trend.completeness === "partial" || model.trend.completeness === "empty"
            ? html`<p data-testid="trend-missing">缺失 ${model.trend.missingBuckets.length} 个采样桶</p>`
            : nothing
        }
      </section>

      <section data-testid="platform-p0-p1-cases">
        <h3>P0 / P1 Case</h3>
        ${
          priorityCases.length === 0
            ? html`
                <p data-testid="priority-cases-empty">当前窗口没有 P0/P1 Case。</p>
              `
            : priorityCases.map(
                (row) => html`
                  <article data-testid="priority-case" data-case-id=${row.caseId}>
                    <span>${row.severity}</span>
                    <span>${row.caseId}</span>
                    <span>${row.tenantId ?? "local"}</span>
                  </article>
                `,
              )
        }
      </section>

      <section data-testid="platform-drilldown">
        <h3>企业 / Agent / Skill / Tool</h3>
        ${model.drilldown.map(
          (row) => html`
            <div data-layer=${row.layer} data-id=${row.id}>${row.layer} · ${row.id}</div>
          `,
        )}
      </section>

      <section data-testid="platform-consult">
        <h3>远程会诊与授权</h3>
        ${model.authorizations.rows.map(
          (row) => html`
            <article data-testid="grant-row" data-grant-id=${row.grantId}>
              <span>${row.status}</span>
              <span>${row.targetTenant ?? "platform"}</span>
              <span>${row.dataScope.join(",")}</span>
              <span>${row.actions.join(",")}</span>
              <span>${row.expiresAt}</span>
              <span>${row.risk ?? ""}</span>
            </article>
          `,
        )}
      </section>

      <section data-testid="platform-graph">
        <h3>根因关系与影响范围</h3>
        ${model.graph.nodes.map((node) => html`<div data-node-id=${node.id}>${node.kind}</div>`)}
        ${model.graph.edges.map(
          (edge) => html`<div data-edge=${`${edge.fromId}->${edge.toId}`}>${edge.relation}</div>`,
        )}
      </section>

      <section data-testid="platform-remediation">
        <h3>Remediation / Verification</h3>
        ${model.remediations.map(
          (row) => html`
            <article data-remediation-id=${row.remediationId}>
              <span>${row.status}</span>
              <span>${row.verdict ?? "pending"}</span>
            </article>
          `,
        )}
      </section>

      <section data-testid="platform-approvals">
        <h3>待平台管理员审批</h3>
        ${model.authorizations.pendingApprovals.map(
          (row) => html`
            <article data-testid="pending-approval" data-grant-id=${row.grantId}>
              <p>目标 ${row.targetTenant ?? "platform"} / ${row.targetPrincipal ?? "n/a"}</p>
              <p>范围 ${row.dataScope.join(",")}</p>
              <p>动作 ${row.actions.join(",")}</p>
              <p>有效期 ${row.expiresAt}</p>
              <p>风险 ${row.risk ?? "unknown"}</p>
              <button
                type="button"
                class="btn btn--sm"
                data-testid="approve-grant"
                ?disabled=${!handlers.onAuthorizationDecision}
                title=${unavailableTitle(
                  handlers.onAuthorizationDecision,
                  "批准该远程会诊授权",
                  "审批接口尚未接入，当前不可执行",
                )}
                @click=${() =>
                  handlers.onAuthorizationDecision?.({
                    grantId: row.grantId,
                    decision: "approve",
                    refresh: "p6_p7",
                  })}
              >
                批准
              </button>
              <button
                type="button"
                class="btn btn--sm"
                data-testid="deny-grant"
                ?disabled=${!handlers.onAuthorizationDecision}
                title=${unavailableTitle(
                  handlers.onAuthorizationDecision,
                  "拒绝该远程会诊授权",
                  "审批接口尚未接入，当前不可执行",
                )}
                @click=${() =>
                  handlers.onAuthorizationDecision?.({
                    grantId: row.grantId,
                    decision: "deny",
                    refresh: "p6_p7",
                  })}
              >
                拒绝
              </button>
            </article>
          `,
        )}
      </section>

      <section data-testid="platform-conversations">
        <h3 class="card-title" data-testid="open-daibai-heading" style="cursor: default">
          打开大白诊断
        </h3>
        <p class="card-sub">说明标题，不是跳转入口。会话跳转尚未接入时，下面的按钮保持禁用。</p>
        ${model.conversationEntries.map(
          (entry) => html`
            <button
              type="button"
              class="btn btn--sm"
              data-testid="open-daibai"
              data-signal-id=${entry.signalId ?? ""}
              data-case-id=${entry.caseId ?? ""}
              ?disabled=${!handlers.onOpenConversation}
              title=${unavailableTitle(
                handlers.onOpenConversation,
                "打开大白诊断会话",
                "会话跳转尚未接入，当前不可执行",
              )}
              @click=${() => handlers.onOpenConversation?.(entry)}
            >
              从 ${entry.signalId ?? entry.caseId ?? "target"} 打开
            </button>
          `,
        )}
      </section>

      ${
        model.production
          ? html`
              <section data-testid="platform-production-status">
                <h3>生产加载 / 权限 / 审计 / 新鲜度</h3>
                <p data-api-load=${model.production.apiLoadState}>${model.production.apiLoadState}</p>
                <p data-audit-state=${model.production.auditState}>${model.production.auditState}</p>
                <p data-freshness=${model.production.freshness.stale ? "stale" : "fresh"}>
                  ${model.production.freshness.completeness}
                </p>
                ${
                  model.production.freshness.stale ||
                  model.production.auditState !== "recorded" ||
                  model.production.apiLoadState !== "ready"
                    ? html`
                        <p data-testid="production-unhealthy">生产数据不完整，不能当作正常。</p>
                      `
                    : nothing
                }
              </section>
            `
          : nothing
      }

      <button
        type="button"
        class="btn btn--sm"
        data-testid="export-report"
        ?disabled=${!handlers.onExportReport}
        title=${unavailableTitle(
          handlers.onExportReport,
          "导出当前诊断报告",
          "报告导出尚未接入，当前不可执行",
        )}
        @click=${() =>
          handlers.onExportReport?.({
            reportId: model.reportExport.reportId ?? null,
            redactionProfile: model.redactionProfile === "user" ? "user" : "administrator",
          })}
      >
        导出报告
      </button>
    </section>
  `;
}
