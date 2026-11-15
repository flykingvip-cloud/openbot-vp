import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { createReasoningGatewayAdapter } from "../../../../../src/observation/reasoning-gateway.js";
type ReasoningView = Extract<
  Awaited<ReturnType<ReturnType<typeof createReasoningGatewayAdapter>>>,
  { ok: true }
>["reasoningPass"];
import { createAuthorizationDecisionRefresh } from "../../../../../src/diagnosis/visualization.ts";
import type { GatewayBrowserClient } from "../../gateway.ts";
import {
  PRECISE_QUERY_MISS_COPY,
  hasObservationReadScope,
  preciseQueryMissCopy,
  resolveObservationAuthorized,
  type TenantGrant,
} from "../../observation/access-state.ts";
import { hasComparisonRefs } from "../../observation/comparison-capacity-panel.ts";
import type {
  CapacityView,
  ComparisonView,
  ComparisonRefs,
} from "../../observation/comparison-capacity-panel.ts";
import type { EvidenceProjection } from "../../observation/evidence-model.ts";
import { renderObservationEvidence } from "../../observation/evidence-panel.ts";
import { isCurrentObservationResponse } from "../../observation/request-isolation.ts";
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

export type HandlingState =
  | "pending_approval"
  | "pending_execution"
  | "executing"
  | "executed_pending_recheck"
  | "resolved"
  | "rejected"
  | "cancelled"
  | "execution_failed"
  | "result_unverified";

export type HandlingAdminView = {
  whatHappened: string;
  whoIsAffected: string;
  suggestedHandling: string;
  whoCanApprove: string;
  currentStep: string;
  howToConfirmRecovery: string;
};

export type HandlingRecord = {
  handlingId: string;
  status: HandlingState;
  issueId: string;
  tenantId: string;
  reportId: string | null;
  idempotencyKey: string;
  execution?: { taskId: string; receipt: Record<string, unknown>; applied: boolean };
  recheck?: { met: boolean; after?: { paused?: boolean } };
  failureReason?: string;
};

export type HandlingCommandResponse = {
  ok: boolean;
  reason?: string;
  record?: HandlingRecord;
  preview?: {
    actionable: boolean;
    reason?: string;
    issueId: string;
    suggestedIdempotencyKey: string;
    evidence: { paused: boolean; pausedAt: string | null; cadence: string };
  };
  admin?: HandlingAdminView;
  records?: HandlingRecord[];
  details?: Record<string, unknown>;
};

async function requestHandling(
  client: GatewayBrowserClient | null | undefined,
  method: string,
  params: Record<string, unknown>,
): Promise<HandlingCommandResponse | null> {
  if (!client?.connected) {
    return null;
  }
  try {
    return await client.request<HandlingCommandResponse>(method, params);
  } catch {
    return null;
  }
}

export async function previewDiagnosisHandling(
  client: GatewayBrowserClient | null | undefined,
  tenantId: string | null,
): Promise<HandlingCommandResponse | null> {
  return requestHandling(client, "diagnosis.handling.preview", tenantId ? { tenantId } : {});
}

export async function listDiagnosisHandling(
  client: GatewayBrowserClient | null | undefined,
  tenantId: string | null,
): Promise<HandlingCommandResponse | null> {
  return requestHandling(client, "diagnosis.handling.list", tenantId ? { tenantId } : {});
}

export async function submitDiagnosisHandling(
  client: GatewayBrowserClient | null | undefined,
  input: { tenantId: string | null; idempotencyKey?: string; reportId?: string | null },
): Promise<HandlingCommandResponse | null> {
  return requestHandling(client, "diagnosis.handling.submit", {
    ...(input.tenantId ? { tenantId: input.tenantId } : {}),
    ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    ...(input.reportId ? { reportId: input.reportId } : {}),
  });
}

export async function decideDiagnosisHandling(
  client: GatewayBrowserClient | null | undefined,
  input: {
    method:
      | "diagnosis.handling.approve"
      | "diagnosis.handling.reject"
      | "diagnosis.handling.cancel";
    tenantId: string | null;
    handlingId: string;
  },
): Promise<HandlingCommandResponse | null> {
  return requestHandling(client, input.method, {
    handlingId: input.handlingId,
    ...(input.tenantId ? { tenantId: input.tenantId } : {}),
  });
}

export async function executeDiagnosisHandling(
  client: GatewayBrowserClient | null | undefined,
  input: { tenantId: string | null; handlingId: string },
): Promise<HandlingCommandResponse | null> {
  return requestHandling(client, "diagnosis.handling.execute", {
    handlingId: input.handlingId,
    ...(input.tenantId ? { tenantId: input.tenantId } : {}),
  });
}

export async function recheckDiagnosisHandling(
  client: GatewayBrowserClient | null | undefined,
  input: { tenantId: string | null; handlingId: string },
): Promise<HandlingCommandResponse | null> {
  return requestHandling(client, "diagnosis.handling.recheck", {
    handlingId: input.handlingId,
    ...(input.tenantId ? { tenantId: input.tenantId } : {}),
  });
}

export function canApproveDiagnosisHandling(scopes: readonly string[] | null | undefined): boolean {
  return (
    scopes?.some((scope) => scope === "operator.approvals" || scope === "operator.admin") === true
  );
}

export function canWriteDiagnosisHandling(scopes: readonly string[] | null | undefined): boolean {
  return scopes?.some((scope) => scope === "operator.write" || scope === "operator.admin") === true;
}

@customElement("openbot-diagnosis-panel")
export class OpenBotDiagnosisPanel extends LitElement {
  @property({ attribute: false }) client: GatewayBrowserClient | null = null;
  @property() role: DiagnosisViewModel["role"] = "platform";
  @property({ attribute: "tenant-id" }) tenantId: string | null = null;
  @property({ attribute: false }) targets: DiagnosisTargetOption[] = [];
  @property({ attribute: false }) scopes: readonly string[] | null = null;
  /** Server-confirmed tenant grants; omitted or missing keys stay unconfirmed. */
  @property({ attribute: false }) tenantGrants: Readonly<Record<string, TenantGrant>> | null = null;
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
  @state() private hashOriginalDiagnosis = false;
  @state() private diagnoseReveal = false;
  private originalDiagnosisEntered = false;
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
  @state() private handlingPreview: HandlingCommandResponse["preview"] | null = null;
  @state() private handlingRecord: HandlingRecord | null = null;
  @state() private handlingAdmin: HandlingAdminView | null = null;
  @state() private handlingNotice: string | null = null;
  @state() private handlingBusy = false;
  private decidedGrants = new Map<string, "APPROVED" | "DENIED">();

  // Light DOM so enterprise-foundation.css can style the refined surface.
  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    void this.reload();
    this.requestUpdate("connected", !this.connected);
    this.syncHashOriginalDiagnosis({ scroll: this.hashTargetsOriginalDiagnosis() });
    window.addEventListener("hashchange", this.onHashChange);
  }

  updated(changed: Map<string | number | symbol, unknown>) {
    if (
      changed.has("client") ||
      changed.has("role") ||
      changed.has("tenantId") ||
      changed.has("scopes") ||
      changed.has("connected")
    ) {
      void this.reload();
    }
    if (this.hashOriginalDiagnosis || this.diagnoseReveal || this.hasNamedQuery()) {
      this.originalDiagnosisEntered = true;
    }
    if (this.pendingOriginalDiagnosisScroll && this.shouldShowOriginalDiagnosis()) {
      this.pendingOriginalDiagnosisScroll = false;
      this.querySelector("#original-diagnosis")?.scrollIntoView({ block: "nearest" });
    }
  }

  private pendingOriginalDiagnosisScroll = false;
  private hashTargetsOriginalDiagnosis() {
    return typeof window !== "undefined" && window.location.hash === "#original-diagnosis";
  }
  private onHashChange = () => {
    this.syncHashOriginalDiagnosis({ scroll: this.hashTargetsOriginalDiagnosis() });
  };
  private syncHashOriginalDiagnosis(options?: { scroll?: boolean }) {
    const next = this.hashTargetsOriginalDiagnosis();
    if (options?.scroll && next) {
      this.pendingOriginalDiagnosisScroll = true;
    }
    this.hashOriginalDiagnosis = next;
  }
  private hideOriginalDiagnosisFromWorkbench() {
    this.diagnoseReveal = false;
    this.originalDiagnosisEntered = false;
    if (this.hashTargetsOriginalDiagnosis()) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    }
    this.hashOriginalDiagnosis = false;
  }
  private hasNamedQuery() {
    return Boolean(this.resolveReasoningRef());
  }
  private shouldShowOriginalDiagnosis() {
    return (
      this.hashOriginalDiagnosis ||
      this.diagnoseReveal ||
      this.hasNamedQuery() ||
      this.originalDiagnosisEntered
    );
  }
  private shouldPaintEvidence() {
    return this.hasNamedQuery() || this.observationEvidence != null;
  }

  @state() private observationEvidence: EvidenceProjection | null = null;
  @state() private observationEvidenceNote = "业务结果未知 · 无可用证据";
  @state() private actionIntents: ObservationActionIntents | null = null;
  @state() private selectedIntent: { intentId: string; revision: number } | null = null;
  @state() private reasoningResult: ReasoningView | null = null;
  @state() private reasoningLoading = false;
  @state() private reasoningNotice = "未请求推理假设；普通查询仅使用原规则与证据。";
  private reasoningGeneration = 0;
  private resolveReasoningRef() {
    const ref = resolveDiagnoseTaskOutcome(
      {
        taskId: this.taskIdDraft,
        agentId: this.agentIdDraft,
        outcomeVersion: this.outcomeVersionDraft,
      },
      this.taskOutcomeRef,
    );
    return ref && Number.isSafeInteger(ref.outcomeVersion) ? ref : null;
  }
  private canReadReasoning() {
    return (
      this.connected &&
      this.client?.connected &&
      this.gatewayMethods?.includes("diagnosis.observation.query") &&
      this.scopes?.some((scope) => scope === "operator.read" || scope === "operator.admin") &&
      Boolean(this.resolveReasoningRef())
    );
  }
  private clearReasoning() {
    ++this.reasoningGeneration;
    this.reasoningResult = null;
    this.reasoningLoading = false;
    this.reasoningNotice = "未请求推理假设；普通查询仅使用原规则与证据。";
  }
  private async readReasoning() {
    const client = this.client;
    const ref = this.resolveReasoningRef();
    if (!client || !ref || !this.canReadReasoning()) {
      this.clearReasoning();
      return;
    }
    const generation = ++this.reasoningGeneration;
    const evidenceGeneration = this.evidenceGeneration;
    const fingerprint = this.evidenceFingerprint();
    this.reasoningResult = null;
    this.reasoningLoading = true;
    this.reasoningNotice = "正在读取推理假设；规则结果保持不变。";
    const current = () =>
      this.isConnected &&
      generation === this.reasoningGeneration &&
      evidenceGeneration === this.evidenceGeneration &&
      client === this.client &&
      fingerprint === this.evidenceFingerprint() &&
      this.canReadReasoning();
    const to = Date.now();
    try {
      const response = await client.request<{ reasoningPass?: ReasoningView }>(
        "diagnosis.observation.query",
        {
          ...ref,
          from: to - (this.observationWindow === "7d" ? 7 : 1) * 86400000,
          to,
          reasoning: { requested: true },
        },
      );
      if (!current()) {
        return;
      }
      this.reasoningResult = response.reasoningPass ?? null;
      this.reasoningNotice = response.reasoningPass
        ? "旁路结果不改写规则发现、业务裁决或配置。"
        : "推理旁路未供给；继续使用原 rule_v1 结果。";
    } catch {
      if (!current()) {
        return;
      }
      this.reasoningNotice = "推理旁路不可用或未授权；继续使用原 rule_v1 结果。";
    } finally {
      if (current()) {
        this.reasoningLoading = false;
      }
    }
  }
  private renderReasoning() {
    const result = this.reasoningResult;
    return html`<section aria-label="推理假设旁路"><h3>推理假设 · 只读旁路</h3><p>默认关闭，仅本次显式请求；可能产生模型用量，不代表确诊或改善验证。</p><button type="button" data-testid="observation-read-reasoning" ?disabled=${this.reasoningLoading || !this.canReadReasoning()} @click=${() => void this.readReasoning()}>读取推理假设</button><p>${this.reasoningNotice}</p>${
      result
        ? html`<p>来源：${result.scoringMethod} · ${result.reason}</p>${
            result.items.length
              ? result.items.map(
                  (item) =>
                    html`<article><strong>${item.kind === "hypothesis" ? "假设" : "候选建议"}</strong><p>${item.text}</p><p>来源：${item.source} · 模型：${item.modelRef} · 证据：${item.evidenceIds.join(", ")}</p></article>`,
                )
              : html`
                  <p>未生成推理假设，保留原 rule_v1 结果。</p>
                `
          }`
        : nothing
    }</section>`;
  }
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
  private isObservationQueryAuthorized() {
    return (
      this.connected &&
      Boolean(this.client?.connected) &&
      Boolean(this.gatewayMethods?.includes("diagnosis.observation.query")) &&
      hasObservationReadScope(this.scopes)
    );
  }
  private isCurrentEvidenceResponse(
    generation: number,
    fingerprint: string,
    client: GatewayBrowserClient | null,
  ) {
    return isCurrentObservationResponse(
      { generation, fingerprint },
      {
        generation: this.evidenceGeneration,
        fingerprint: this.evidenceFingerprint(),
        connected: this.isConnected && this.connected,
        authorized: this.isObservationQueryAuthorized(),
        sameClient: client === this.client,
      },
    );
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
      this.clearReasoning();
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
          if (!this.isCurrentEvidenceResponse(generation, fingerprint, client)) {
            return;
          }
          this.observationEvidence = result;
          this.actionIntents = result.actionIntents ?? null;
          this.capacity = result.capacity ?? null;
          this.comparison = result.comparison ?? null;
          this.observationEvidenceNote = result.samples?.length
            ? "只读结果证据；连接流仍为 execution_only"
            : PRECISE_QUERY_MISS_COPY;
        })
        .catch((err: unknown) => {
          if (!this.isCurrentEvidenceResponse(generation, fingerprint, client)) {
            return;
          }
          this.observationEvidence = null;
          this.actionIntents = null;
          this.capacity = null;
          this.comparison = null;
          this.observationEvidenceNote = preciseQueryMissCopy(err) ?? "业务结果未知 · 查询失败";
        });
    }
  }
  disconnectedCallback() {
    window.removeEventListener("hashchange", this.onHashChange);
    this.clearReasoning();
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

  private reportGeneration = 0;

  async reload() {
    const generation = ++this.reportGeneration;
    const client = this.client;
    const role = this.role;
    const tenantId = this.tenantId;
    const scopes = JSON.stringify(this.scopes);
    const current = () =>
      this.isConnected &&
      generation === this.reportGeneration &&
      client === this.client &&
      role === this.role &&
      tenantId === this.tenantId &&
      scopes === JSON.stringify(this.scopes);
    this.model = null;
    setDiagnosisApiClient(this.client);
    this.loading = true;
    const query = await queryDiagnosisReports({
      schemaVersion: 1,
      mode: "report",
      limit: 10,
      redactionProfile: this.redactionProfile(),
    });
    if (!current()) {
      return;
    }
    const first = query?.items[0];
    const getResponse = first?.reportId
      ? await getDiagnosisReport({
          schemaVersion: 1,
          reportId: first.reportId,
          redactionProfile: this.redactionProfile(),
        })
      : null;
    if (!current()) {
      return;
    }
    this.model = this.withGrantDecisions(
      diagnosisViewModelFromQuery(this.audience(), query, getResponse),
    );
    const preview = await previewDiagnosisHandling(client, tenantId);
    if (!current()) {
      return;
    }
    const listed = await listDiagnosisHandling(client, tenantId);
    if (!current()) {
      return;
    }
    this.handlingPreview = preview?.preview ?? null;
    this.handlingRecord = listed?.records?.[0] ?? preview?.record ?? null;
    this.handlingAdmin = listed?.admin ?? preview?.admin ?? null;
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

  private renderPlatformTaskInput() {
    return html`<fieldset aria-label="平台精确任务证据查询"><legend>精确任务结果引用</legend><p>请填写稳定 agentId、任务及结果版本；正式名称不用于查询关联。平台身份不代表跨租户读取授权。</p>${(
      [
        ["agent", "数字人", this.agentIdDraft],
        ["id", "任务", this.taskIdDraft],
        ["version", "结果版本", this.outcomeVersionDraft],
      ] as const
    ).map(
      ([key, label, value]) =>
        html`<label>${label}<input data-testid=${"diagnosis-task-" + key} .value=${value} @input=${(
          event: Event,
        ) => {
          const next = (event.target as HTMLInputElement).value;
          if (key === "agent") {
            this.agentIdDraft = next;
          } else if (key === "id") {
            this.taskIdDraft = next;
          } else {
            this.outcomeVersionDraft = next;
          }
        }}></label>`,
    )}</fieldset>`;
  }
  private async refreshHandling() {
    const preview = await previewDiagnosisHandling(this.client, this.tenantId);
    const listed = await listDiagnosisHandling(this.client, this.tenantId);
    this.handlingPreview = preview?.preview ?? null;
    this.handlingRecord = listed?.records?.[0] ?? preview?.record ?? null;
    this.handlingAdmin = listed?.admin ?? preview?.admin ?? null;
  }

  private async onHandlingSubmit() {
    if (this.handlingBusy || !canWriteDiagnosisHandling(this.scopes)) {
      return;
    }
    this.handlingBusy = true;
    try {
      const result = await submitDiagnosisHandling(this.client, {
        tenantId: this.tenantId,
        idempotencyKey: this.handlingPreview?.suggestedIdempotencyKey,
        reportId: this.model?.reportExport.reportId ?? null,
      });
      this.handlingNotice = result?.reason ?? null;
      await this.refreshHandling();
    } finally {
      this.handlingBusy = false;
    }
  }

  private async onHandlingDecide(
    method:
      | "diagnosis.handling.approve"
      | "diagnosis.handling.reject"
      | "diagnosis.handling.cancel",
  ) {
    const handlingId = this.handlingRecord?.handlingId;
    if (!handlingId || this.handlingBusy) {
      return;
    }
    this.handlingBusy = true;
    try {
      const result = await decideDiagnosisHandling(this.client, {
        method,
        tenantId: this.tenantId,
        handlingId,
      });
      this.handlingNotice = result?.ok ? null : (result?.reason ?? "未完成");
      await this.refreshHandling();
    } finally {
      this.handlingBusy = false;
    }
  }

  private async onHandlingExecute() {
    const handlingId = this.handlingRecord?.handlingId;
    if (!handlingId || this.handlingBusy || !canWriteDiagnosisHandling(this.scopes)) {
      return;
    }
    this.handlingBusy = true;
    try {
      const result = await executeDiagnosisHandling(this.client, {
        tenantId: this.tenantId,
        handlingId,
      });
      this.handlingNotice = result?.ok
        ? result.reason === "already_executed"
          ? "已受理过，不会重复执行"
          : result.reason === "production_repair_closed"
            ? "本阶段未开放生产修复；仅隔离环境可执行恢复"
            : null
        : result?.reason === "production_repair_closed"
          ? "本阶段未开放生产修复；仅隔离环境可执行恢复"
          : result?.reason === "approved_target_conflict"
            ? "审批对象或版本已变化，请重新预览并审批后再执行"
            : (result?.reason ?? "执行未完成");
      this.handlingRecord = result?.record ?? this.handlingRecord;
      this.handlingAdmin = result?.admin ?? this.handlingAdmin;
      await this.refreshHandling();
    } finally {
      this.handlingBusy = false;
    }
  }

  private async onHandlingRecheck() {
    const handlingId = this.handlingRecord?.handlingId;
    if (!handlingId || this.handlingBusy) {
      return;
    }
    this.handlingBusy = true;
    try {
      const result = await recheckDiagnosisHandling(this.client, {
        tenantId: this.tenantId,
        handlingId,
      });
      this.handlingNotice = result?.record?.recheck?.met
        ? "复核通过，已标记为已解决"
        : "尚未达到恢复标准，保持待复核或失败状态";
      this.handlingRecord = result?.record ?? this.handlingRecord;
      this.handlingAdmin = result?.admin ?? this.handlingAdmin;
    } finally {
      this.handlingBusy = false;
    }
  }

  private renderHandlingCard() {
    const preview = this.handlingPreview;
    const record = this.handlingRecord;
    const admin = this.handlingAdmin;
    if (!admin && !preview?.actionable && !record) {
      return nothing;
    }
    if (!preview?.actionable && !record) {
      return nothing;
    }
    const canWrite = canWriteDiagnosisHandling(this.scopes);
    const canApprove = canApproveDiagnosisHandling(this.scopes);
    const connected = Boolean(this.client?.connected && this.connected);
    const status = record?.status;
    return html`<section class="card" aria-label="诊断处理闭环" data-testid="diagnosis-handling-card">
      <h3>诊断处理</h3>
      <p data-testid="diagnosis-handling-what">${admin?.whatHappened ?? ""}</p>
      <p data-testid="diagnosis-handling-who">${admin?.whoIsAffected ?? ""}</p>
      <p data-testid="diagnosis-handling-suggestion">${admin?.suggestedHandling ?? ""}</p>
      <p data-testid="diagnosis-handling-approver">${admin?.whoCanApprove ?? ""}</p>
      <p data-testid="diagnosis-handling-step">当前步骤：${admin?.currentStep ?? "尚未立案"}</p>
      <p data-testid="diagnosis-handling-recheck-standard">${admin?.howToConfirmRecovery ?? ""}</p>
      ${
        record
          ? html`<details>
            <summary>技术细节</summary>
            <p>处理单 ${record.handlingId}</p>
            <p>问题 ${record.issueId}</p>
            <p>幂等键 ${record.idempotencyKey}</p>
            ${record.execution ? html`<p>任务 ${record.execution.taskId}</p>` : nothing}
            ${record.failureReason ? html`<p>原因码 ${record.failureReason}</p>` : nothing}
          </details>`
          : nothing
      }
      ${this.handlingNotice ? html`<p data-testid="diagnosis-handling-notice">${this.handlingNotice}</p>` : nothing}
      ${
        !record && preview?.actionable
          ? html`<button type="button" data-testid="diagnosis-handling-submit" ?disabled=${this.handlingBusy || !connected || !canWrite} @click=${() => void this.onHandlingSubmit()}>申请恢复任务</button>`
          : nothing
      }
      ${
        status === "pending_approval"
          ? html`
            <button type="button" data-testid="diagnosis-handling-approve" ?disabled=${this.handlingBusy || !connected || !canApprove} @click=${() => void this.onHandlingDecide("diagnosis.handling.approve")}>批准</button>
            <button type="button" data-testid="diagnosis-handling-reject" ?disabled=${this.handlingBusy || !connected || !canApprove} @click=${() => void this.onHandlingDecide("diagnosis.handling.reject")}>拒绝</button>
            <button type="button" ?disabled=${this.handlingBusy || !connected || !canWrite} @click=${() => void this.onHandlingDecide("diagnosis.handling.cancel")}>取消</button>
          `
          : nothing
      }
      ${
        status === "pending_execution"
          ? html`
            <button type="button" data-testid="diagnosis-handling-execute" ?disabled=${this.handlingBusy || !connected || !canWrite} @click=${() => void this.onHandlingExecute()}>执行恢复</button>
            <button type="button" ?disabled=${this.handlingBusy || !connected || !canWrite} @click=${() => void this.onHandlingDecide("diagnosis.handling.cancel")}>取消</button>
          `
          : nothing
      }
      ${
        status === "executed_pending_recheck" ||
        status === "result_unverified" ||
        status === "execution_failed"
          ? html`<button type="button" data-testid="diagnosis-handling-recheck" ?disabled=${this.handlingBusy || !connected} @click=${() => void this.onHandlingRecheck()}>复核是否已恢复</button>`
          : nothing
      }
    </section>`;
  }

  private renderResolutionActions(model: DiagnosisViewModel) {
    const reportId = model.reportExport.reportId;
    if (!reportId || model.loadError || !["allowed", "redacted"].includes(model.permissionState)) {
      return nothing;
    }
    const target = findDiagnosisTarget(this.targets, this.selectedTargetId);
    const canWrite =
      this.scopes?.some((scope) => scope === "operator.write" || scope === "operator.admin") ===
      true;
    return html`<section class="card" aria-label="诊断处理" data-testid="diagnosis-resolution-actions">
      <h3>发现问题后怎么处理</h3>
      <p>请先选择负责的数字人，再发起处理。处理请求发出后仍需查看执行记录，并重新检查结果；不会直接标记为已解决。</p>
      ${model.cases.map(
        (row) => html`<div class="card-sub">
        <span>问题记录：${row.caseId}</span>
        <button type="button" ?disabled=${!this.client?.connected || !this.connected || !canWrite || !target || isAllDiagnosisTarget(this.selectedTargetId)}
          @click=${() => {
            if (!target || !canWrite || !this.client?.connected) {
              return;
            }
            dispatchDiagnosisConversationAction(
              this,
              {
                title: "处理诊断问题",
                handoffChannel: "diagnosed_agent_session",
                targetSessionKey: target.sessionKey,
                targetAgentId: target.agentId,
                prompt: `请处理诊断报告 ${reportId} 中的问题 ${row.caseId}。先读取当前授权范围内的原始证据，确认影响和原因；给出具体修复步骤、风险和恢复方法。需要审批的操作先申请审批。执行后返回任务身份、执行回执和复核证据；证据不足时补采或明确转交负责人，不得把建议或请求发出当成修复成功。`,
              },
              "panel",
            );
          }}>交给所选数字人处理</button>
      </div>`,
      )}
      <button type="button" ?disabled=${this.loading || !this.client?.connected} @click=${() => void this.reload()}>刷新处理记录</button>
      <button type="button" ?disabled=${this.diagnosing || !target || !this.client?.connected} @click=${() => void this.onDiagnoseNow()}>重新检查所选对象</button>
    </section>`;
  }

  render() {
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
            this.diagnoseReveal = true;
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
          onSurfaceChange: () => {
            this.hideOriginalDiagnosisFromWorkbench();
          },
          connected: this.connected,
          scopes: this.scopes,
          authorized: resolveObservationAuthorized({ scopes: this.scopes }),
          tenantGrants: this.tenantGrants,
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
        ${
          this.shouldShowOriginalDiagnosis()
            ? html`<section id="original-diagnosis" data-testid="original-diagnosis">
        ${this.renderHandlingCard()}
        ${this.renderResolutionActions(model)}
        ${
          this.shouldPaintEvidence()
            ? html`<p data-testid="observation-evidence-status">${this.observationEvidenceNote}</p>
        <p data-testid="observation-query-scope">精确任务真实查询，不受连接工作台样例选择影响；仍按当前身份授权读取。</p>${renderObservationEvidence(this.observationEvidence)}${this.renderReasoning()}`
            : nothing
        }
        ${this.renderEvolutionProjection()}
        ${renderEnterpriseDiagnosisSurface(model, {
          embedded: true,
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
        </section>`
            : nothing
        }
      `;
    }
    return html`
      ${this.renderPlatformTaskInput()}
      <p data-testid="observation-evidence-status">${this.observationEvidenceNote}</p>
      <p data-testid="observation-query-scope">精确任务真实查询，不受连接工作台样例选择影响；仍按当前身份授权读取。</p>${renderObservationEvidence(this.observationEvidence)}${this.renderReasoning()}
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
      ${this.renderHandlingCard()}
        ${this.renderResolutionActions(model)}
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
