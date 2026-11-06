import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { createAuthorizationDecisionRefresh } from "../../../../../src/diagnosis/visualization.ts";
import type { GatewayBrowserClient } from "../../gateway.ts";
import { hasComparisonRefs } from "../../observation/comparison-capacity-panel.ts";
import type {
  CapacityView,
  ComparisonView,
  ComparisonRefs,
} from "../../observation/comparison-capacity-panel.ts";
import type { EvidenceProjection } from "../../observation/evidence-model.ts";
import { renderObservationEvidence } from "../../observation/evidence-panel.ts";
import {
  renderObservationWorkbench,
  type ObservationActionIntents,
} from "../../observation/workbench.ts";
import {
  diagnoseTaskOutcomeAttachNote,
  resolveDiagnoseTaskOutcome,
} from "../enterprise/diagnosis/diagnosis-task-outcome-rows.ts";
import { renderEnterpriseDiagnosisSurface } from "../enterprise/diagnosis/enterprise-diagnosis-surface.ts";
import type {
  DiagnosisRunNote,
  DiagnosisViewConversationEntry,
} from "../enterprise/diagnosis/enterprise-diagnosis-surface.ts";
import {
  renderPlatformDiagnosisSurface,
  type DiagnosisViewModel,
} from "../platform/diagnosis/platform-diagnosis-surface.ts";
import {
  decideEnterpriseDiagnosisApproval,
  getDiagnosisReport,
  isDiagnosisGatewayReady,
  queryDiagnosisReports,
  runDiagnosisDiagnose,
  setDiagnosisApiClient,
  type DiagnosisEvolutionProjection,
} from "./diagnosis-api.ts";
import {
  approvalFailureText,
  callPlatformDiagnosisApproval,
  canCallPlatformDiagnosisApproval,
  conversationEffectMatches,
  exportEffectMatches,
  grantEffectMatches,
} from "./diagnosis-approval-client.ts";
import { readDiagnosisApprovalOutcome } from "./diagnosis-approval-result.ts";
import { dispatchDiagnosisConversationAction } from "./diagnosis-conversation-action.ts";
import { dispatchDiagnosisOpenSession } from "./diagnosis-open-session.ts";
import {
  findDiagnosisTarget,
  isAllDiagnosisTarget,
  type DiagnosisTargetOption,
} from "./diagnosis-targets.ts";
import { diagnosisViewModelFromQuery } from "./diagnosis-view-model.ts";

@customElement("openbot-diagnosis-panel")
export class OpenBotDiagnosisPanel extends LitElement {
  @property({ attribute: false }) client: GatewayBrowserClient | null = null;
  @property() role: DiagnosisViewModel["role"] = "platform";
  @property({ attribute: "tenant-id" }) tenantId: string | null = null;
  @property({ attribute: false }) targets: DiagnosisTargetOption[] = [];
  @property({ attribute: false }) scopes: readonly string[] | null = null;
  @property({ attribute: false }) sessionKind: string | null = null;
  @property({ attribute: false }) gatewayMethods: readonly string[] | null = null;
  @property({ type: Boolean }) connected = false;
  @property({ attribute: false }) observationHost: object | null = null;
  /** Set only when the host already has taskId, agentId, and outcomeVersion. */
  @property({ attribute: false }) taskOutcomeRef: {
    taskId: string;
    agentId: string;
    outcomeVersion: number;
  } | null = null;

  @property({ attribute: false }) comparisonRefs: ComparisonRefs | null = null;
  @state() private capacity: CapacityView | null = null;
  @state() private comparison: ComparisonView | null = null;
  @state() private model: DiagnosisViewModel | null = null;
  @state() private loading = false;
  @state() private diagnosing = false;
  @state() private lastDiagnose: DiagnosisRunNote | null = null;
  @state() private focusedRunId: string | null = null;
  @state() private evolutionProjections: DiagnosisEvolutionProjection[] = [];
  @state() private selectedTargetId: string | null = null;
  @state() private observationSessionKey: string | null = null;
  @state() private observationWindow: "24h" | "7d" = "24h";
  @state() private diagnoseMode: "TARGETED" | "FULL" = "TARGETED";
  @state() private cadence: "off" | "daily" | "tick" = "off";
  @state() private deliverToAdmin = false;
  @state() private deliverToOwners = false;
  @state() private decisionNote: string | null = null;
  @state() private taskIdDraft = "";
  @state() private agentIdDraft = "";
  @state() private outcomeVersionDraft = "";
  @state() private taskOutcomeAttachNote: string | null = null;
  @state() private approvalNotice: { tone: "ok" | "err"; text: string } | null = null;
  private decidedGrants = new Map<string, "APPROVED" | "DENIED">();

  // Light DOM so enterprise-foundation.css can style the refined surface.
  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    void this.reload();
    this.requestUpdate("connected", !this.connected);
  }

  updated(changed: Map<string | number | symbol, unknown>) {
    if (changed.has("client") || changed.has("role") || changed.has("tenantId")) {
      void this.reload();
    }
  }

  @state() private observationEvidence: EvidenceProjection | null = null;
  @state() private observationEvidenceNote = "业务结果未知 · 无可用证据";
  @state() private actionIntents: ObservationActionIntents | null = null;
  @state() private selectedIntent: { intentId: string; revision: number } | null = null;
  private evidenceGeneration = 0;
  private evidenceFingerprint() {
    return JSON.stringify([
      this.role,
      this.tenantId,
      this.scopes,
      this.sessionKind,
      this.taskOutcomeRef,
      this.taskIdDraft,
      this.agentIdDraft,
      this.outcomeVersionDraft,
      this.connected,
      this.client?.connected,
      this.gatewayMethods,
      this.observationSessionKey,
      this.observationWindow,
      this.selectedIntent,
      this.comparisonRefs,
    ]);
  }
  willUpdate(changed: Map<string | number | symbol, unknown>) {
    if (
      [
        "client",
        "role",
        "tenantId",
        "scopes",
        "sessionKind",
        "taskOutcomeRef",
        "taskIdDraft",
        "agentIdDraft",
        "outcomeVersionDraft",
        "connected",
        "gatewayMethods",
        "observationSessionKey",
        "observationWindow",
        "selectedIntent",
        "comparisonRefs",
      ].some((key) => changed.has(key))
    ) {
      this.observationEvidence = null;
      this.actionIntents = null;
      this.capacity = null;
      this.comparison = null;
      if (!changed.has("selectedIntent")) {
        this.selectedIntent = null;
      }
      const generation = ++this.evidenceGeneration;
      this.observationEvidenceNote = "业务结果未知 · 缺少结果引用、读取权限或查询能力";
      const client = this.client;
      const resolved = resolveDiagnoseTaskOutcome(
        {
          taskId: this.taskIdDraft,
          agentId: this.agentIdDraft,
          outcomeVersion: this.outcomeVersionDraft,
        },
        this.taskOutcomeRef ??
          (!this.taskIdDraft.trim() &&
          !this.agentIdDraft.trim() &&
          !this.outcomeVersionDraft.trim() &&
          hasComparisonRefs(this.comparisonRefs)
            ? this.comparisonRefs.baseline.refs[0]
            : null),
      );
      const ref = resolved && Number.isSafeInteger(resolved.outcomeVersion) ? resolved : null;
      const fingerprint = this.evidenceFingerprint();
      if (
        !this.connected ||
        !client?.connected ||
        !ref ||
        !this.gatewayMethods?.includes("diagnosis.observation.query") ||
        !this.scopes?.some((scope) => scope === "operator.read" || scope === "operator.admin")
      ) {
        return;
      }
      const to = Date.now();
      const from = to - (this.observationWindow === "7d" ? 7 : 1) * 86400000;
      this.observationEvidenceNote = "证据查询中 · 业务结果未知";
      void client
        .request<
          EvidenceProjection & {
            actionIntents?: ObservationActionIntents;
            capacity?: CapacityView;
            comparison?: ComparisonView;
          }
        >("diagnosis.observation.query", {
          ...ref,
          from,
          to,
          actionIntents: this.selectedIntent ?? {},
          capacity: true,
          ...(hasComparisonRefs(this.comparisonRefs) ? { comparison: this.comparisonRefs } : {}),
        })
        .then((result) => {
          if (
            generation !== this.evidenceGeneration ||
            !this.isConnected ||
            client !== this.client ||
            fingerprint !== this.evidenceFingerprint()
          ) {
            return;
          }
          this.observationEvidence = result;
          this.actionIntents = result.actionIntents ?? null;
          this.capacity = result.capacity ?? null;
          this.comparison = result.comparison ?? null;
          this.observationEvidenceNote = "只读结果证据；连接流仍为 execution_only";
        })
        .catch(() => {
          if (
            generation !== this.evidenceGeneration ||
            client !== this.client ||
            fingerprint !== this.evidenceFingerprint()
          ) {
            return;
          }
          this.observationEvidence = null;
          this.actionIntents = null;
          this.capacity = null;
          this.comparison = null;
          this.observationEvidenceNote = "业务结果未知 · 查询失败或读取权限不可用";
        });
    }
  }
  disconnectedCallback() {
    ++this.evidenceGeneration;
    this.capacity = null;
    this.comparison = null;
    this.actionIntents = null;
    this.observationEvidence = null;
    super.disconnectedCallback();
  }
  private get selectedTarget() {
    return this.targets.find((row) => row.sessionKey === this.observationSessionKey) ?? null;
  }

  private redactionProfile() {
    return this.role === "platform" ? ("administrator" as const) : ("user" as const);
  }

  private audience() {
    return {
      role: this.role,
      trusted: { tenantId: this.tenantId },
      principal: {
        schemaVersion: 1 as const,
        principalId: this.role === "platform" ? "platform-admin" : "enterprise-admin",
        kind: "user" as const,
        tenantId: this.tenantId,
      },
      redactionProfile: this.redactionProfile(),
    };
  }

  private async onDiagnoseNow() {
    setDiagnosisApiClient(this.client);
    const isAll = this.role === "enterprise" && isAllDiagnosisTarget(this.selectedTargetId);
    const target =
      this.role === "enterprise" && !isAll
        ? findDiagnosisTarget(this.targets, this.selectedTargetId)
        : null;
    if (this.role === "enterprise" && !isAll && !target) {
      this.lastDiagnose = { kind: "need_target" };
      return;
    }
    this.diagnosing = true;
    const focusedRunId = this.focusedRunId;
    const draft = {
      taskId: this.taskIdDraft,
      agentId: this.agentIdDraft,
      outcomeVersion: this.outcomeVersionDraft,
    };
    const taskOutcome = resolveDiagnoseTaskOutcome(draft, this.taskOutcomeRef);
    this.taskOutcomeAttachNote = diagnoseTaskOutcomeAttachNote(draft);
    try {
      if (!isDiagnosisGatewayReady()) {
        this.lastDiagnose = { kind: "disconnected" };
        return;
      }
      const result = await runDiagnosisDiagnose({
        scope: isAll ? "all" : "target",
        window: this.observationWindow,
        mode: this.diagnoseMode,
        cadence: this.cadence,
        deliverTo: {
          enterpriseAdmin: this.deliverToAdmin,
          owners: this.deliverToOwners,
        },
        ...(target
          ? {
              sessionKey: target.sessionKey,
              agentId: target.agentId,
              runId: focusedRunId ?? undefined,
            }
          : {}),
        ...(isAll
          ? {
              targets: this.targets.map((row) => ({
                agentId: row.agentId,
                sessionKey: row.sessionKey,
              })),
            }
          : {}),
        ...(taskOutcome ? { taskOutcome } : {}),
      });
      if (!result) {
        this.lastDiagnose = { kind: "failed" };
        return;
      }
      if (result.reason === "forbidden") {
        this.lastDiagnose = { kind: "denied" };
        return;
      }
      if (result.reason === "failed" && !result.reportText) {
        this.lastDiagnose = { kind: "failed" };
        return;
      }
      if ((result.reason === "no_session" || !result.reportId) && !result.reportText) {
        this.lastDiagnose = { kind: "no_session" };
        return;
      }
      const deliveryReason = result.delivery?.reason;
      const deliveryClosed =
        (deliveryReason === "daibai_delivery_gate_closed" ||
          deliveryReason === "conversation_unavailable" ||
          deliveryReason === "tick_suppressed") &&
        (result.delivery?.routes?.length ?? 0) > 0;
      const skipped = result.skipped ?? 0;
      this.lastDiagnose = {
        kind: skipped > 0 ? "partial" : "done",
        findingCount: result.findingCount,
        scanned: result.scanned,
        requestedCount: result.requestedCount,
        skipped,
        deliveryClosed,
        deliveryReason,
        deliveryDelivered: result.delivery?.delivered === true,
        reportText: result.reportText,
        taskOutcomeEvidence: readTaskOutcomeEvidenceView(result.taskOutcomeEvidence),
      };
      this.evolutionProjections = result.evolutionProjections ?? [];
      if (focusedRunId) {
        this.focusedRunId = null;
      }
      await this.reload();
    } catch (err) {
      const code =
        err && typeof err === "object" && "gatewayCode" in err
          ? String((err as { gatewayCode?: string }).gatewayCode)
          : "";
      this.lastDiagnose =
        code === "401" || code === "403" || code === "forbidden"
          ? { kind: "denied" }
          : { kind: "failed" };
    } finally {
      this.diagnosing = false;
    }
  }

  private approvalKey(parts: string[]): string {
    return ["enterprise-diagnosis", this.tenantId ?? "tenant", ...parts].join(":");
  }

  private async onAuthorizationDecision(input: { grantId: string; decision: "approve" | "deny" }) {
    this.decisionNote = null;
    const response = await decideEnterpriseDiagnosisApproval({
      schemaVersion: 1,
      idempotencyKey: this.approvalKey(["authorization", input.grantId, input.decision]),
      subject: { kind: "authorization", grantId: input.grantId },
      decision: input.decision,
      reason: null,
    });
    if (response.transport === "disconnected") {
      this.decisionNote = "网关未连接，不能提交审批。";
      return;
    }
    if (response.transport === "error") {
      this.decisionNote = response.message || "审批请求失败。";
      return;
    }
    const outcome = readDiagnosisApprovalOutcome({
      purpose: "grant",
      decision: input.decision,
      grantId: input.grantId,
      body: response.body,
    });
    this.decisionNote = outcome.text;
    if (outcome.ok) {
      await this.reload();
    }
  }

  private async onOpenConversation(entry: DiagnosisViewConversationEntry) {
    if (!entry.signalId?.trim() && !entry.caseId?.trim()) {
      this.decisionNote = "只有目标引用，没有信号或案例编号，不能打开。";
      return;
    }
    this.decisionNote = null;
    const response = await decideEnterpriseDiagnosisApproval({
      schemaVersion: 1,
      idempotencyKey: this.approvalKey([
        "conversation",
        entry.signalId ?? "",
        entry.caseId ?? "",
        "approve",
      ]),
      subject: {
        kind: "conversation",
        ...(entry.signalId ? { signalId: entry.signalId } : {}),
        ...(entry.caseId ? { caseId: entry.caseId } : {}),
        ...(entry.tenantId !== undefined ? { tenantId: entry.tenantId } : {}),
        ...(entry.targetRef ? { targetRef: entry.targetRef } : {}),
      },
      decision: "approve",
      reason: null,
    });
    if (response.transport === "disconnected") {
      this.decisionNote = "网关未连接，不能打开大白会话。";
      return;
    }
    if (response.transport === "error") {
      this.decisionNote = response.message || "打开大白会话失败。";
      return;
    }
    const outcome = readDiagnosisApprovalOutcome({
      purpose: "conversation",
      decision: "approve",
      body: response.body,
    });
    this.decisionNote = outcome.text;
    if (!outcome.ok || !outcome.sessionKey) {
      return;
    }
    dispatchDiagnosisOpenSession(this, outcome.sessionKey);
  }

  async reload() {
    setDiagnosisApiClient(this.client);
    this.loading = true;
    const query = await queryDiagnosisReports({
      schemaVersion: 1,
      mode: "report",
      limit: 10,
      redactionProfile: this.redactionProfile(),
    });
    const first = query?.items[0];
    const getResponse = first?.reportId
      ? await getDiagnosisReport({
          schemaVersion: 1,
          reportId: first.reportId,
          redactionProfile: this.redactionProfile(),
        })
      : null;
    this.model = this.withGrantDecisions(
      diagnosisViewModelFromQuery(this.audience(), query, getResponse),
    );
    this.loading = false;
  }

  private approvalReady(): boolean {
    return canCallPlatformDiagnosisApproval({
      connected: this.connected || Boolean(this.client?.connected),
      scopes: this.scopes,
      sessionKind: this.sessionKind,
      methods: this.gatewayMethods,
    });
  }

  private withGrantDecisions(model: DiagnosisViewModel): DiagnosisViewModel {
    if (this.decidedGrants.size === 0) {
      return model;
    }
    const pendingApprovals = [];
    const rows = [...model.authorizations.rows];
    for (const row of model.authorizations.pendingApprovals) {
      const status = this.decidedGrants.get(row.grantId);
      if (!status) {
        pendingApprovals.push(row);
        continue;
      }
      rows.push({ ...row, status });
    }
    return {
      ...model,
      authorizations: { ...model.authorizations, rows, pendingApprovals },
    };
  }

  private confirmAction(message: string): boolean {
    if (typeof window === "undefined" || typeof window.confirm !== "function") {
      return true;
    }
    return window.confirm(message);
  }

  private async onGrantDecision(input: {
    grantId: string;
    decision: "approve" | "deny";
    refresh: "p6_p7";
  }) {
    if (!this.client || !this.approvalReady()) {
      return;
    }
    const confirmed = this.confirmAction(
      input.decision === "approve"
        ? "确认批准这条会诊授权？批准后按当前范围生效。"
        : "确认拒绝这条会诊授权？拒绝后该申请不会生效。",
    );
    if (!confirmed) {
      return;
    }
    try {
      const payload = await callPlatformDiagnosisApproval(this.client, {
        decision: input.decision,
        subject: { kind: "authorization", grantId: input.grantId },
      });
      if (!grantEffectMatches(payload, input.grantId, input.decision)) {
        this.approvalNotice = { tone: "err", text: approvalFailureText(payload) };
        return;
      }
      const refresh = createAuthorizationDecisionRefresh({
        grantId: input.grantId,
        decision: input.decision,
      });
      if (refresh.refresh !== "p6_p7" || refresh.grantId !== input.grantId) {
        this.approvalNotice = { tone: "err", text: "本地授权刷新没有完成，请重新加载。" };
        return;
      }
      const status = input.decision === "approve" ? "APPROVED" : "DENIED";
      this.decidedGrants.set(input.grantId, status);
      if (this.model) {
        this.model = this.withGrantDecisions(this.model);
      }
      this.approvalNotice = {
        tone: "ok",
        text: input.decision === "approve" ? "已批准该授权。" : "已拒绝该授权。",
      };
    } catch (err) {
      this.approvalNotice = { tone: "err", text: transportFailureText(err) };
    }
  }

  private async onOpenDaibai(entry: DiagnosisViewModel["conversationEntries"][number]) {
    if (!this.client || !this.approvalReady()) {
      return;
    }
    if (!this.confirmAction("确认打开大白诊断会话？")) {
      return;
    }
    try {
      const payload = await callPlatformDiagnosisApproval(this.client, {
        decision: "approve",
        subject: {
          kind: "conversation",
          ...(entry.signalId ? { signalId: entry.signalId } : {}),
          ...(entry.caseId ? { caseId: entry.caseId } : {}),
          ...(entry.targetRef ? { targetRef: entry.targetRef } : {}),
        },
      });
      if (!conversationEffectMatches(payload, "approve")) {
        this.approvalNotice = { tone: "err", text: approvalFailureText(payload) };
        return;
      }
      const sessionKey = payload.effect?.type === "conversation" ? payload.effect.sessionKey : "";
      this.approvalNotice = { tone: "ok", text: `已打开大白会话 ${sessionKey}` };
    } catch (err) {
      this.approvalNotice = { tone: "err", text: transportFailureText(err) };
    }
  }

  private async onExportReport(input: {
    reportId: string | null;
    redactionProfile: "administrator" | "user";
  }) {
    if (!this.client || !this.approvalReady()) {
      return;
    }
    if (!input.reportId) {
      this.approvalNotice = { tone: "err", text: "当前没有可导出的报告。" };
      return;
    }
    if (!this.confirmAction("确认导出当前诊断报告？")) {
      return;
    }
    try {
      const payload = await callPlatformDiagnosisApproval(this.client, {
        decision: "approve",
        subject: {
          kind: "report-export",
          reportId: input.reportId,
          redactionProfile: input.redactionProfile,
        },
      });
      if (!exportEffectMatches(payload, "approve") || payload.effect?.type !== "export") {
        this.approvalNotice = { tone: "err", text: approvalFailureText(payload) };
        return;
      }
      downloadDiagnosisExport(payload.effect.filename, payload.effect.body);
      this.approvalNotice = { tone: "ok", text: `已导出 ${payload.effect.filename}` };
    } catch (err) {
      this.approvalNotice = { tone: "err", text: transportFailureText(err) };
    }
  }

  private renderEvolutionProjection() {
    if (this.evolutionProjections.length === 0) {
      return null;
    }
    return html`
      <section class="enterprise-diagnosis__panel" data-testid="diagnosis-evolution-projection">
        ${this.evolutionProjections.map((row) => {
          const status = row.found && row.liveStatus ? row.liveStatus : "preview only · 未提交";
          const hint = row.canRequestExperiment ? ` · ${row.requestExperimentHint}` : "";
          return html`
            <p>
              控制面状态（当场读取）：${status}${hint}
            </p>
          `;
        })}
      </section>
    `;
  }

  render() {
    if (this.loading && !this.model) {
      return html`
        <p class="enterprise-diagnosis__empty">诊断数据加载中…</p>
      `;
    }
    const model = this.model ?? diagnosisViewModelFromQuery(this.audience(), null, null);
    if (this.role === "enterprise") {
      return html`
        ${renderObservationWorkbench({
          role: "enterprise",
          tenantId: this.tenantId,
          sessionKey: this.observationSessionKey,
          observationHost: this.observationHost,
          basePath: "",
          targets: this.targets,
          onSessionKey: (sessionKey) => {
            this.observationSessionKey = sessionKey || null;
            this.selectedTargetId =
              this.targets.find((row) => row.sessionKey === sessionKey)?.id ?? null;
            this.focusedRunId = null;
          },
          onDiagnoseRun: ({ runId, sessionKey }) => {
            this.focusedRunId = runId;
            this.observationSessionKey = sessionKey;
            this.selectedTargetId =
              this.targets.find((row) => row.sessionKey === sessionKey)?.id ?? null;
            void this.onDiagnoseNow().then(() => {
              this.querySelector('[data-testid="diagnosis-evolution-projection"]')?.scrollIntoView({
                block: "nearest",
              });
            });
          },
          connected: this.connected,
          actionIntents: this.actionIntents,
          capacity: this.capacity,
          comparison: this.comparison,
          onComparisonRefs: (refs) => {
            this.comparisonRefs = refs;
          },
          onSelectActionIntent: (intentId, revision) => {
            this.selectedIntent = { intentId, revision };
          },
        })}
        <p data-testid="observation-evidence-status">${this.observationEvidenceNote}</p>
        ${renderObservationEvidence(this.observationEvidence)}
        <section class="enterprise-diagnosis__panel">
          <h2>原诊断工作区</h2>
          <p class="enterprise-diagnosis__sub">下面的数据来自真实诊断接口，不受上方样例模式影响。</p>
        </section>
        ${this.renderEvolutionProjection()}
        ${renderEnterpriseDiagnosisSurface(model, {
          onDiagnoseNow: () => void this.onDiagnoseNow(),
          diagnosing: this.diagnosing,
          lastDiagnose: this.lastDiagnose,
          targets: this.targets,
          selectedTargetId: this.selectedTargetId,
          onSelectTarget: (id) => {
            this.selectedTargetId = id || null;
          },
          observationWindow: this.observationWindow,
          diagnoseMode: this.diagnoseMode,
          cadence: this.cadence,
          deliverToAdmin: this.deliverToAdmin,
          deliverToOwners: this.deliverToOwners,
          onObservationWindow: (value) => {
            this.observationWindow = value;
          },
          onDiagnoseMode: (value) => {
            this.diagnoseMode = value;
          },
          onCadence: (value) => {
            this.cadence = value;
          },
          onDeliverToAdmin: (value) => {
            this.deliverToAdmin = value;
          },
          onDeliverToOwners: (value) => {
            this.deliverToOwners = value;
          },
          taskOutcomeDraft: {
            taskId: this.taskIdDraft,
            agentId: this.agentIdDraft,
            outcomeVersion: this.outcomeVersionDraft,
          },
          onTaskOutcomeDraftChange: (draft) => {
            this.taskIdDraft = draft.taskId;
            this.agentIdDraft = draft.agentId;
            this.outcomeVersionDraft = draft.outcomeVersion;
            this.taskOutcomeAttachNote = null;
          },
          onUseSelectedAgentId: () => {
            const target = findDiagnosisTarget(this.targets, this.selectedTargetId);
            const agentId = target?.agentId.trim() ?? "";
            if (!agentId || isAllDiagnosisTarget(this.selectedTargetId)) {
              return;
            }
            this.agentIdDraft = agentId;
            this.taskOutcomeAttachNote = null;
          },
          taskOutcomeAttachNote: this.taskOutcomeAttachNote,
          onRunConversationAction: (action) => {
            dispatchDiagnosisConversationAction(this, action, "panel");
          },
          onRefresh: () => void this.reload(),
          refreshing: this.loading,
          daibaiDeliveryEnabled: true,
          decisionNote: this.decisionNote,
          ...(this.client?.connected
            ? {
                onAuthorizationDecision: (input: {
                  grantId: string;
                  decision: "approve" | "deny";
                }) => {
                  void this.onAuthorizationDecision(input);
                },
                onOpenConversation: (entry: DiagnosisViewConversationEntry) => {
                  void this.onOpenConversation(entry);
                },
              }
            : {}),
        })}
      `;
    }
    return html`
      <p data-testid="observation-evidence-status">${this.observationEvidenceNote}</p>
      ${renderObservationEvidence(this.observationEvidence)}
      <div class="toolbar">
        <button
          type="button"
          data-testid="diagnosis-run-now"
          ?disabled=${this.diagnosing || this.loading}
          @click=${() => void this.onDiagnoseNow()}
        >
          ${this.diagnosing ? "诊断中…" : "立即诊断"}
        </button>
      </div>
      ${this.renderEvolutionProjection()}
      ${
        this.approvalNotice
          ? html`<p
              class="card-sub"
              data-testid="platform-diagnosis-approval-notice"
              data-tone=${this.approvalNotice.tone}
            >
              ${this.approvalNotice.text}
            </p>`
          : nothing
      }
      ${renderPlatformDiagnosisSurface(
        model,
        this.approvalReady()
          ? {
              onAuthorizationDecision: (input) => void this.onGrantDecision(input),
              onOpenConversation: (entry) => void this.onOpenDaibai(entry),
              onExportReport: (input) => void this.onExportReport(input),
            }
          : {},
      )}
    `;
  }
}

function readTaskOutcomeEvidenceView(value: unknown): DiagnosisRunNote["taskOutcomeEvidence"] {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as {
    ok?: unknown;
    code?: unknown;
    taskId?: unknown;
    outcomeVersion?: unknown;
    judgement?: unknown;
    reasonCode?: unknown;
    revisionKind?: unknown;
    recheckStatus?: unknown;
  };
  if (record.ok === true) {
    return {
      ok: true,
      ...(typeof record.taskId === "string" ? { taskId: record.taskId } : {}),
      ...(typeof record.outcomeVersion === "number"
        ? { outcomeVersion: record.outcomeVersion }
        : {}),
      ...(typeof record.judgement === "string" ? { judgement: record.judgement } : {}),
      ...(typeof record.reasonCode === "string" ? { reasonCode: record.reasonCode } : {}),
      ...(typeof record.revisionKind === "string" ? { revisionKind: record.revisionKind } : {}),
      ...(record.recheckStatus === "incomplete" ||
      record.recheckStatus === "not_checked" ||
      record.recheckStatus === "completed"
        ? { recheckStatus: record.recheckStatus }
        : {}),
    };
  }
  if (record.ok === false) {
    return {
      ok: false,
      ...(typeof record.code === "string" ? { code: record.code } : {}),
      ...(typeof record.taskId === "string" ? { taskId: record.taskId } : {}),
    };
  }
  return null;
}

function transportFailureText(err: unknown): string {
  const message = err instanceof Error ? err.message.trim() : "";
  return message || "审批请求失败，没有生效。";
}

function downloadDiagnosisExport(filename: string, body: string) {
  if (typeof document === "undefined") {
    return;
  }
  const blob = new Blob([body], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

declare global {
  interface HTMLElementTagNameMap {
    "openbot-diagnosis-panel": OpenBotDiagnosisPanel;
  }
}
