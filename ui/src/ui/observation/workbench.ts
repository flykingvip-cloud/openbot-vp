import type { queryActionIntents } from "../../../../src/observation/action-intent-query.js";
import { renderActionIntent } from "./action-intent-panel.ts";
import {
  renderComparisonCapacity,
  type CapacityView,
  type ComparisonView,
  type ComparisonRefs,
} from "./comparison-capacity-panel.ts";
export type ObservationActionIntents = Extract<
  Awaited<ReturnType<typeof queryActionIntents>>,
  { ok: true }
>;
import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import "../../styles/observation-workbench.css";
import { pathForTab } from "../navigation.ts";
import type { DiagnosisTargetOption } from "../ports/diagnosis/diagnosis-targets.ts";
import { readRuntimeObservations } from "../runtime-observation.ts";
import {
  AUTH_INVALID_COPY,
  AUTH_UNCONFIRMED_COPY,
  PRECISE_QUERY_MISS_COPY,
  accessibleRuns,
  applyDrawerParams,
  canAccessRun,
  currentAuthorization,
  metricScopeHint,
  readDrawerRequest,
  resolveDrawerSelection,
  resolveObservationAuthorized,
  resolveTenantGrant,
  type ObservationAccessInput,
  type TenantGrant,
} from "./access-state.ts";
import {
  LINK_BREAK_REASONS,
  attentionCounts,
  classifyAttention,
  computeOverviewMetrics,
  filterAttention,
  groupTargetsByAgent,
  type AttentionKind,
} from "./enterprise-overview.ts";
import {
  emptyObservation,
  OBSERVATION_TYPES,
  reasonLabel,
  type ObservationEnterpriseEntry,
  type ObservationRun,
  type ObservationView,
} from "./model.ts";
import {
  censusTenantGrants,
  exactRunMatches,
  formatConcurrency,
  formatGrantCensus,
  formatHeartbeat,
  formatHeartbeatFreshness,
  formatLinkCoverage,
  formatQuota,
  formatUnmappedEvents,
  grantFraction,
  heartbeatActivityMarks,
  heartbeatFraction,
  linkCoverageFraction,
  formatTenantCoverage,
  formatTenantHeartbeat,
  tenantDisplayName,
  tenantGrantNote,
  visibleTenantCode,
  type HeartbeatInput,
  type LinkCoverageInput,
  type PlatformFirstScreenSnapshot,
  type PlatformTaskIndexItem,
  type PlatformTaskIndexSnapshot,
} from "./platform-overview.ts";
import { observationSamples, SAMPLE_ENTERPRISE_DIRECTORY } from "./samples.ts";
import {
  buildObservationStream,
  type ObservationStreamMetricKey,
  type ObservationStreamView,
} from "./stream.ts";

export type ObservationQueryClient = {
  connected?: boolean;
  request: (method: string, params?: unknown) => Promise<unknown>;
};

export type ObservationProps = {
  role: "platform" | "enterprise";
  tenantId: string | null;
  sessionKey: string | null;
  connected: boolean;
  basePath?: string;
  observationHost: object | null;
  client?: ObservationQueryClient | null;
  gatewayMethods?: readonly string[] | null;
  targets?: readonly DiagnosisTargetOption[];
  onDiagnoseRun?: (input: { runId: string; sessionKey: string; agentId: string }) => void;
  onSurfaceChange?: (surface: "overview" | "analysis" | "governance") => void;
  onSessionKey?: (sessionKey: string) => void;
  enterpriseDirectory?: readonly ObservationEnterpriseEntry[];
  actionIntents?: ObservationActionIntents | null;
  capacity?: CapacityView | null;
  comparison?: ComparisonView | null;
  onComparisonRefs?: (refs: ComparisonRefs | null) => void;
  onSelectActionIntent?: (intentId: string, revision: number) => void;
  /** Server-confirmed scopes; URL or client role never grant access. */
  scopes?: readonly string[] | null;
  authorized?: boolean | null;
  /** Server-confirmed grants keyed by tenantId. Missing keys stay unknown. */
  tenantGrants?: Readonly<Record<string, TenantGrant>> | null;
  initialRunId?: string | null;
  initialDrawer?: boolean;
};
export function renderObservationWorkbench(props: ObservationProps) {
  return html`<openbot-observation-workbench
    .role=${props.role} .tenantId=${props.tenantId} .sessionKey=${props.sessionKey}
    .observationHost=${props.observationHost ?? null}
    .client=${props.client ?? null} .gatewayMethods=${props.gatewayMethods ?? null}
    .connected=${props.connected} .onSessionKey=${props.onSessionKey ?? null} .basePath=${props.basePath ?? ""} .targets=${props.targets ?? []}
    .enterpriseDirectory=${props.enterpriseDirectory ?? []}
    .onComparisonRefs=${props.onComparisonRefs ?? null}
    .capacity=${props.capacity ?? null} .comparison=${props.comparison ?? null}
    .actionIntents=${props.actionIntents ?? null} .onSelectActionIntent=${props.onSelectActionIntent ?? null}
    .onDiagnoseRun=${props.onDiagnoseRun ?? null}
    .onSurfaceChange=${props.onSurfaceChange ?? null}
    .scopes=${props.scopes ?? null} .authorized=${props.authorized ?? null}
    .tenantGrants=${props.tenantGrants ?? null}
    .initialRunId=${props.initialRunId ?? null} .initialDrawer=${props.initialDrawer ?? false}
  ></openbot-observation-workbench>`;
}

@customElement("openbot-observation-workbench")
export class OpenBotObservationWorkbench extends LitElement {
  @property() role: "platform" | "enterprise" = "platform";
  @property({ attribute: false }) tenantId: string | null = null;
  @property({ attribute: false }) sessionKey: string | null = null;
  @property({ type: Boolean }) connected = false;
  @property() basePath = "";
  @property({ attribute: false }) onSessionKey: ((sessionKey: string) => void) | null = null;
  @property({ attribute: false }) targets: readonly DiagnosisTargetOption[] = [];
  @property({ attribute: false }) onDiagnoseRun:
    | ((input: { runId: string; sessionKey: string; agentId: string }) => void)
    | null = null;
  @property({ attribute: false }) onSurfaceChange:
    | ((surface: "overview" | "analysis" | "governance") => void)
    | null = null;
  @property({ attribute: false }) enterpriseDirectory: readonly ObservationEnterpriseEntry[] = [];
  @property({ attribute: false }) actionIntents: ObservationActionIntents | null = null;
  @property({ attribute: false }) onSelectActionIntent:
    | ((intentId: string, revision: number) => void)
    | null = null;
  @property({ attribute: false }) capacity: CapacityView | null = null;
  @property({ attribute: false }) comparison: ComparisonView | null = null;
  @property({ attribute: false }) onComparisonRefs: ((refs: ComparisonRefs | null) => void) | null =
    null;
  @state() private comparisonDraft = {
    baseline: { agentId: "", taskId: "", version: "", from: "", to: "" },
    candidate: { agentId: "", taskId: "", version: "", from: "", to: "" },
  };
  @state() private comparisonInputNote = "";
  @state() private surface: "overview" | "analysis" | "governance" = "overview";
  @state() private analysis: "tasks" | "models" | "executors" | "capacity" = "tasks";
  @property({ type: String }) source: "live" | "sample" = "live";
  @property({ attribute: false }) observationHost: object | null = null;
  @property({ attribute: false }) client: ObservationQueryClient | null = null;
  @property({ attribute: false }) gatewayMethods: readonly string[] | null = null;
  @state() private filter: (typeof OBSERVATION_TYPES)[number] = "全部";
  @state() private timeWindow: "7d" | "current" = "7d";
  @state() private tenantFilter: string = "all";
  @state() private selected: ObservationRun | null = null;
  @state() private tick = 0;
  @state() private paused = false;
  @state() private changeCount = 0;
  @state() private metricFilter = "all";
  @state() private expanded = false;
  @state() private accessNotice: string | null = null;
  @state() private queryInput = "";
  @state() private queryResult: {
    status: "hit" | "miss" | "denied";
    message?: string;
    run?: ObservationRun;
  } | null = null;
  @state() private platformPage: "overview" | "query" | "tenants" | "capacity" = "overview";
  @state() private agentFilter: string = "all";
  @state() private sessionFilter: string = "current";
  @state() private issueFilter: AttentionKind = "all";
  @state() private guideUserOpen: boolean | null = null;
  @property({ attribute: false }) scopes: readonly string[] | null = null;
  @property({ attribute: false }) authorized: boolean | null = null;
  @property({ attribute: false }) tenantGrants: Readonly<Record<string, TenantGrant>> | null = null;
  @property({ attribute: false }) initialRunId: string | null = null;
  @property({ type: Boolean }) initialDrawer = false;
  private frozenView: ObservationView | null = null;
  private frozenStream: ObservationStreamView | null = null;
  private frozenSnapshot: PlatformFirstScreenSnapshot | null = null;
  @state() private windowSnapshot: PlatformFirstScreenSnapshot | null = null;
  @state() private taskIndex: PlatformTaskIndexSnapshot | null = null;
  @state() private taskFrom: number | null = null;
  @state() private taskTo: number | null = null;
  @state() private taskAgentFilter = "all";
  private frozenTaskIndex: PlatformTaskIndexSnapshot | null = null;
  private snapshotGeneration = 0;
  private taskIndexGeneration = 0;
  private lastFingerprint = "";
  private pendingStreamUpdate = false;
  private requestedRunId: string | null = null;
  private requestedDrawer = false;
  private drawerRequestInitialized = false;

  createRenderRoot() {
    return this;
  }
  connectedCallback() {
    super.connectedCallback();
    this.tick = 0;
    this.captureDrawerRequest();
    this.poll = window.setInterval(() => {
      this.tick++;
      if (this.paused) {
        return;
      }
      if (this.tick % 10 === 0 || (this.tick % 2 === 0 && this.windowSnapshot === null)) {
        void this.pullPlatformSnapshot();
      }
      if (this.tick % 10 === 0 || (this.tick % 2 === 0 && this.taskIndex === null)) {
        void this.pullTaskIndex();
      }
    }, 1000);
    queueMicrotask(() => {
      void this.pullPlatformSnapshot();
      void this.pullTaskIndex();
    });
  }
  willUpdate(changed: Map<string | number | symbol, unknown>) {
    // Skip the first update: every property is "changed" on connect, including
    // a directly supplied run/drawer request that must still be access-checked.
    if (!this.hasUpdated) {
      return;
    }
    if (
      ["role", "tenantId", "sessionKey", "scopes", "authorized", "tenantGrants", "client", "gatewayMethods"].some((key) =>
        changed.has(key),
      )
    ) {
      this.clearSensitiveObservation();
    }
  }
  disconnectedCallback() {
    if (this.poll !== undefined) {
      window.clearInterval(this.poll);
    }
    this.poll = undefined;
    this.snapshotGeneration += 1;
    this.windowSnapshot = null;
    this.frozenSnapshot = null;
    super.disconnectedCallback();
  }
  private poll: number | undefined;
  private captureDrawerRequest() {
    if (this.drawerRequestInitialized) {
      return;
    }
    const fromUrl =
      typeof window === "undefined"
        ? { runId: null, drawer: false }
        : readDrawerRequest(window.location.search);
    this.requestedRunId = this.initialRunId ?? fromUrl.runId;
    this.requestedDrawer = this.initialDrawer || fromUrl.drawer;
    this.drawerRequestInitialized = true;
  }
  private isAuthorized() {
    return resolveObservationAuthorized({ authorized: this.authorized, scopes: this.scopes });
  }
  private canReadPlatformSnapshot() {
    return (
      this.role === "platform" &&
      this.source === "live" &&
      this.connected &&
      this.isAuthorized() === true &&
      Boolean(this.client) &&
      this.client?.connected !== false &&
      Boolean(this.gatewayMethods?.includes("diagnosis.observation.query"))
    );
  }
  private firstScreenSnapshot(): PlatformFirstScreenSnapshot | null {
    if (this.paused && this.frozenSnapshot) {
      return this.frozenSnapshot;
    }
    return this.windowSnapshot;
  }
  private parsePlatformSnapshot(value: unknown): PlatformFirstScreenSnapshot | null {
    if (!value || typeof value !== "object" || (value as { ok?: unknown }).ok !== true) {
      return null;
    }
    const row = value as {
      coverage?: { fullyLinkedCount?: unknown; attemptedCount?: unknown; link?: unknown };
      heartbeat?: {
        expectedSamples?: unknown;
        observedSamples?: unknown;
        scheduledRobotCount?: unknown;
        confirmedRobotCount?: unknown;
        onCadenceRobotCount?: unknown;
        observedEventCount?: unknown;
        lastEventAt?: unknown;
        events?: unknown;
        tenants?: unknown;
      };
      unmappedEvents?: { count?: unknown };
      capacity?: {
        concurrency?: { activeRuns?: unknown; limit?: unknown };
        quota?: { remaining?: unknown; allowance?: unknown };
      };
    };
    const count = (input: unknown): number | null =>
      typeof input === "number" && Number.isFinite(input) ? input : null;
    const events = Array.isArray(row.heartbeat?.events)
      ? row.heartbeat.events.flatMap((event) => {
          if (!event || typeof event !== "object") {
            return [];
          }
          const ts = (event as { ts?: unknown }).ts;
          const status = (event as { status?: unknown }).status;
          return typeof ts === "number" && Number.isFinite(ts)
            ? [{ ts, status: typeof status === "string" ? status : undefined }]
            : [];
        })
      : [];
    return {
      coverage: row.coverage
        ? {
            fullyLinkedCount: count(row.coverage.fullyLinkedCount),
            attemptedCount: count(row.coverage.attemptedCount),
            link: count(row.coverage.link),
          }
        : null,
      heartbeat: row.heartbeat
        ? {
            expectedSamples: count(row.heartbeat.expectedSamples),
            observedSamples: count(row.heartbeat.observedSamples),
            scheduledRobotCount: count(row.heartbeat.scheduledRobotCount),
            confirmedRobotCount: count(row.heartbeat.confirmedRobotCount),
            onCadenceRobotCount: count(row.heartbeat.onCadenceRobotCount),
            observedEventCount: count(row.heartbeat.observedEventCount) ?? (events.length ? events.length : null),
            lastEventAt: count(row.heartbeat.lastEventAt),
            events,
            tenants: Array.isArray(row.heartbeat.tenants)
              ? row.heartbeat.tenants.flatMap((entry) => {
                  if (!entry || typeof entry !== "object") {
                    return [];
                  }
                  const tenant = entry as {
                    tenantId?: unknown;
                    scheduledRobotCount?: unknown;
                    confirmedRobotCount?: unknown;
                    onCadenceRobotCount?: unknown;
                    expectedSamples?: unknown;
                    observedSamples?: unknown;
                  };
                  const tenantId = typeof tenant.tenantId === "string" ? tenant.tenantId.trim() : "";
                  if (!tenantId) {
                    return [];
                  }
                  return [
                    {
                      tenantId,
                      scheduledRobotCount: count(tenant.scheduledRobotCount),
                      confirmedRobotCount: count(tenant.confirmedRobotCount),
                      onCadenceRobotCount: count(tenant.onCadenceRobotCount),
                      expectedSamples: count(tenant.expectedSamples),
                      observedSamples: count(tenant.observedSamples),
                    },
                  ];
                })
              : [],
          }
        : null,
      unmappedEvents: row.unmappedEvents ? { count: count(row.unmappedEvents.count) } : null,
      capacity: {
        concurrency: row.capacity?.concurrency
          ? {
              activeRuns: count(row.capacity.concurrency.activeRuns),
              limit: count(row.capacity.concurrency.limit),
            }
          : null,
        quota: row.capacity?.quota
          ? {
              remaining: count(row.capacity.quota.remaining),
              allowance: count(row.capacity.quota.allowance),
            }
          : null,
      },
    };
  }
  private async pullPlatformSnapshot() {
    if (this.paused) {
      return;
    }
    if (!this.canReadPlatformSnapshot() || !this.client) {
      if (this.windowSnapshot !== null) {
        this.windowSnapshot = null;
      }
      return;
    }
    const client = this.client;
    const generation = ++this.snapshotGeneration;
    const to = Date.now();
    const from = to - 7 * 86_400_000;
    try {
      const result = await client.request("diagnosis.observation.query", {
        platformWindow: true,
        from,
        to,
      });
      if (
        generation !== this.snapshotGeneration ||
        this.paused ||
        client !== this.client ||
        !this.canReadPlatformSnapshot()
      ) {
        return;
      }
      this.windowSnapshot = this.parsePlatformSnapshot(result);
    } catch {
      if (generation !== this.snapshotGeneration || this.paused) {
        return;
      }
      this.windowSnapshot = null;
    }
  }
  private currentTaskWindow(now = Date.now()): { from: number; to: number } {
    const to = this.taskTo != null && Number.isFinite(this.taskTo) ? this.taskTo : now;
    const from =
      this.taskFrom != null && Number.isFinite(this.taskFrom) ? this.taskFrom : to - 7 * 86_400_000;
    return { from, to };
  }
  private firstScreenTaskIndex(): PlatformTaskIndexSnapshot | null {
    if (this.paused && this.frozenTaskIndex) {
      return this.frozenTaskIndex;
    }
    return this.taskIndex;
  }
  private parseTaskIndex(value: unknown): PlatformTaskIndexSnapshot | null {
    if (!value || typeof value !== "object" || (value as { ok?: unknown }).ok !== true) {
      return null;
    }
    const row = value as {
      authorization?: unknown;
      window?: { from?: unknown; to?: unknown };
      tasks?: unknown;
      agents?: unknown;
      truncated?: unknown;
    };
    const authorization = row.authorization === "unknown" ? "unknown" : row.authorization === "granted" ? "granted" : null;
    if (!authorization || !row.window || typeof row.window.from !== "number" || typeof row.window.to !== "number") {
      return null;
    }
    const tasks = Array.isArray(row.tasks)
      ? row.tasks.flatMap((item) => {
          if (!item || typeof item !== "object") {
            return [];
          }
          const task = item as {
            taskId?: unknown;
            outcomeVersion?: unknown;
            agentId?: unknown;
            decidedAt?: unknown;
            tenantId?: unknown;
            coverage?: { fullyLinkedCount?: unknown; attemptedCount?: unknown; link?: unknown };
          };
          if (
            typeof task.taskId !== "string" ||
            !task.taskId.trim() ||
            typeof task.agentId !== "string" ||
            !task.agentId.trim() ||
            typeof task.outcomeVersion !== "number" ||
            !Number.isSafeInteger(task.outcomeVersion) ||
            typeof task.decidedAt !== "string"
          ) {
            return [];
          }
          const count = (input: unknown): number | null =>
            typeof input === "number" && Number.isFinite(input) ? input : null;
          return [
            {
              taskId: task.taskId,
              outcomeVersion: task.outcomeVersion,
              agentId: task.agentId,
              decidedAt: task.decidedAt,
              tenantId: typeof task.tenantId === "string" && task.tenantId.trim() ? task.tenantId : null,
              coverage: task.coverage
                ? {
                    fullyLinkedCount: count(task.coverage.fullyLinkedCount),
                    attemptedCount: count(task.coverage.attemptedCount),
                    link: count(task.coverage.link),
                  }
                : null,
            },
          ];
        })
      : [];
    const agents = Array.isArray(row.agents)
      ? row.agents.flatMap((entry) => {
          const id = entry && typeof entry === "object" ? (entry as { id?: unknown }).id : undefined;
          return typeof id === "string" && id.trim() ? [{ id }] : [];
        })
      : [];
    return {
      authorization,
      window: { from: row.window.from, to: row.window.to },
      tasks,
      agents,
      truncated: row.truncated === true,
    };
  }
  private sampleTaskIndex(view: ObservationView): PlatformTaskIndexSnapshot {
    const { from, to } = this.currentTaskWindow();
    const tenant = this.tenantFilter !== "all" ? this.tenantFilter : "";
    const agent = this.taskAgentFilter !== "all" ? this.taskAgentFilter : "";
    const tasks: PlatformTaskIndexItem[] = view.runs.flatMap((run) => {
      if (tenant && run.tenantId !== tenant) {
        return [];
      }
      const agentId = "sample";
      if (agent && agentId !== agent) {
        return [];
      }
      return [
        {
          taskId: run.scenarioTaskRef ?? run.id,
          outcomeVersion: Number(run.outcomeRevision) || 1,
          agentId,
          decidedAt: "2026-11-01T08:00:00.000Z",
          tenantId: run.tenantId,
          coverage: null,
        },
      ];
    });
    return {
      authorization: "granted",
      window: { from, to },
      tasks,
      agents: [{ id: "sample" }],
      truncated: false,
    };
  }
  private async pullTaskIndex() {
    if (this.paused) {
      return;
    }
    if (this.source === "sample") {
      this.taskIndex = this.sampleTaskIndex(this.view());
      return;
    }
    if (!this.canReadPlatformSnapshot() || !this.client) {
      if (this.taskIndex !== null) {
        this.taskIndex = null;
      }
      return;
    }
    const client = this.client;
    const generation = ++this.taskIndexGeneration;
    const { from, to } = this.currentTaskWindow();
    const params: Record<string, unknown> = { taskIndex: true, from, to };
    if (this.tenantFilter !== "all") {
      params.tenantId = this.tenantFilter;
    }
    if (this.taskAgentFilter !== "all") {
      params.agentId = this.taskAgentFilter;
    }
    try {
      const result = await client.request("diagnosis.observation.query", params);
      if (
        generation !== this.taskIndexGeneration ||
        this.paused ||
        client !== this.client ||
        !this.canReadPlatformSnapshot()
      ) {
        return;
      }
      this.taskIndex = this.parseTaskIndex(result);
    } catch {
      if (generation !== this.taskIndexGeneration || this.paused) {
        return;
      }
      this.taskIndex = null;
    }
  }
  private currentTenantGrant(): TenantGrant {
    if (this.role !== "platform" || this.tenantFilter === "all") {
      return "granted";
    }
    const mapped = this.tenantGrants?.[this.tenantFilter];
    if (mapped === "granted" || mapped === "none") {
      return mapped;
    }
    const directory =
      this.source === "sample" ? SAMPLE_ENTERPRISE_DIRECTORY : this.enterpriseDirectory;
    const entry = directory.find((row) => row.tenantId === this.tenantFilter);
    return resolveTenantGrant(entry?.tenantGrant ?? mapped);
  }
  private accessInput(): ObservationAccessInput {
    return {
      authorized: this.isAuthorized(),
      role: this.role,
      actorTenantId: this.tenantId,
      tenantFilter: this.tenantFilter,
      tenantGrant: this.currentTenantGrant(),
    };
  }
  private clearSensitiveObservation() {
    this.selected = null;
    this.expanded = false;
    this.frozenView = null;
    this.frozenStream = null;
    this.paused = false;
    this.pendingStreamUpdate = false;
    this.requestedRunId = null;
    this.requestedDrawer = false;
    this.queryInput = "";
    this.queryResult = null;
    this.windowSnapshot = null;
    this.frozenSnapshot = null;
    this.taskIndex = null;
    this.frozenTaskIndex = null;
    this.snapshotGeneration += 1;
    this.taskIndexGeneration += 1;
    const authorized = this.isAuthorized();
    this.accessNotice =
      authorized === true ? null : authorized === false ? AUTH_INVALID_COPY : AUTH_UNCONFIRMED_COPY;
    this.syncDrawerUrl({ runId: null, drawer: false });
  }
  private syncDrawerUrl(request: { runId: string | null; drawer: boolean }) {
    if (typeof window === "undefined" || typeof window.history?.replaceState !== "function") {
      return;
    }
    const next = applyDrawerParams(window.location.search, request);
    const current = window.location.search || "";
    if (next === current) {
      return;
    }
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}${next}${window.location.hash}`,
    );
  }
  private buildLiveStream(view: ObservationView): ObservationStreamView {
    const unmapped = this.role === "platform" && this.tenantFilter !== "all";
    return buildObservationStream({
      connected: view.connected,
      snapshot:
        this.source === "live" && !unmapped
          ? readRuntimeObservations(this.observationHost ?? {}, this.sessionKey ?? "")
          : null,
      sessionKey: view.sessionKey,
    });
  }
  private streamFor(view: ObservationView): ObservationStreamView {
    if (this.paused && this.frozenStream) {
      return this.frozenStream;
    }
    return this.buildLiveStream(view);
  }
  private applyMetricFilter(runs: readonly ObservationRun[]): ObservationRun[] {
    if (this.metricFilter === "sequence_or_link_gaps") {
      return runs.filter((row) => row.reasons.length);
    }
    if (this.metricFilter === "active_runs") {
      return runs.filter((row) => row.toolState === "running" || row.toolState === "waiting");
    }
    if (this.metricFilter === "business_acceptance") {
      return runs.filter((row) => row.outcomeState === "accepted");
    }
    if (this.metricFilter === "run_completion_rate") {
      return runs.filter((row) => row.latencyMs !== null);
    }
    if (this.metricFilter === "attributed_cost") {
      return [];
    }
    if (this.metricFilter === "event_receive_rate") {
      return runs.filter((row) => row.eventCount > 0);
    }
    if (this.metricFilter === "latency_p50" || this.metricFilter === "latency_p95") {
      return runs.filter((row) => row.latencyMs !== null);
    }
    if (this.metricFilter === "tool_calls") {
      return runs.filter((row) =>
        row.stages.some((stage) => stage.key === "tool" && stage.state === "observed"),
      );
    }
    return [...runs];
  }
  private sessionKeysForView(): string[] {
    if (this.role !== "enterprise") {
      return this.sessionKey ? [this.sessionKey] : [];
    }
    if (this.sessionFilter === "all") {
      const groups = groupTargetsByAgent(this.targets);
      const scoped =
        this.agentFilter === "all"
          ? groups
          : groups.filter((row) => row.agentId === this.agentFilter);
      const keys = scoped.flatMap((row) => row.sessions.map((session) => session.sessionKey));
      return keys.length ? [...new Set(keys)] : this.sessionKey ? [this.sessionKey] : [];
    }
    if (this.sessionFilter !== "current" && this.sessionFilter) {
      return [this.sessionFilter];
    }
    return this.sessionKey ? [this.sessionKey] : [];
  }
  private view(): ObservationView {
    void this.tick;
    if (this.source === "sample") {
      return observationSamples(this.role);
    }
    const keys = this.sessionKeysForView();
    if (this.role === "enterprise" && keys.length > 1) {
      const views = keys.map((key) =>
        emptyObservation(
          this.connected,
          readRuntimeObservations(this.observationHost ?? {}, key),
          key,
        ),
      );
      return {
        source: "live",
        connected: this.connected,
        partial: views.some((row) => row.partial),
        sessionKey: null,
        reasons: [...new Set(views.flatMap((row) => row.reasons))],
        runs: views.flatMap((row) => row.runs),
        receivedAt: views.reduce<number | null>((latest, row) => {
          if (row.receivedAt == null) {
            return latest;
          }
          return latest == null || row.receivedAt > latest ? row.receivedAt : latest;
        }, null),
      };
    }
    const key = keys[0] ?? this.sessionKey;
    return emptyObservation(
      this.connected,
      readRuntimeObservations(this.observationHost ?? {}, key ?? ""),
      key ?? null,
    );
  }
  private liveRuns(view: ObservationView) {
    if (this.role === "platform" && this.tenantFilter !== "all" && view.source === "live") {
      return [];
    }
    return view.runs;
  }
  private updateStream(view: ObservationView) {
    const fingerprint = JSON.stringify([
      this.source,
      this.sessionKey,
      this.tenantFilter,
      this.liveRuns(view).map((r) => [r.id, r.eventCount, r.latencyMs, r.reasons]),
    ]);
    if (fingerprint !== this.lastFingerprint) {
      this.lastFingerprint = fingerprint;
      this.changeCount += 1;
      if (this.paused && this.frozenView) {
        this.pendingStreamUpdate = true;
      }
      if (!this.paused) {
        this.frozenView = null;
      }
    }
    return this.paused && this.frozenView ? this.frozenView : view;
  }

  setSource(value: string) {
    if (value === "sample" || value === "live") {
      this.source = value;
      this.selected = null;
      this.expanded = false;
      this.tenantFilter = "all";
      this.paused = false;
      this.frozenView = null;
      this.frozenStream = null;
      this.pendingStreamUpdate = false;
      this.metricFilter = "all";
      this.requestedRunId = null;
      this.requestedDrawer = false;
      this.queryInput = "";
      this.queryResult = null;
      this.windowSnapshot = null;
      this.frozenSnapshot = null;
      this.taskIndex = null;
      this.frozenTaskIndex = null;
      this.taskAgentFilter = "all";
      this.snapshotGeneration += 1;
      this.taskIndexGeneration += 1;
      this.issueFilter = "all";
      this.sessionFilter = "current";
      this.agentFilter = "all";
      this.syncDrawerUrl({ runId: null, drawer: false });
      void this.pullPlatformSnapshot();
      void this.pullTaskIndex();
    }
  }
  private directoryEntries(view: ObservationView): readonly ObservationEnterpriseEntry[] {
    if (this.role !== "platform") {
      return [];
    }
    if (view.source === "sample") {
      return SAMPLE_ENTERPRISE_DIRECTORY;
    }
    return this.enterpriseDirectory;
  }
  private filteredDirectory(view: ObservationView): readonly ObservationEnterpriseEntry[] {
    const rows = this.directoryEntries(view);
    if (this.tenantFilter === "all") {
      return rows;
    }
    return rows.filter((row) => row.tenantId === this.tenantFilter);
  }
  private filteredRuns(view: ObservationView): ObservationRun[] {
    const scope =
      this.filter === "个人" ? "personal" : this.filter === "协作" ? "collaboration" : null;
    const rows = view.runs.filter((row) => {
      if (scope && row.scope !== scope) {
        return false;
      }
      if (this.role !== "platform" || this.tenantFilter === "all") {
        return true;
      }
      // Live execution_only events have no tenant mapping on this host.
      if (view.source === "live") {
        return false;
      }
      return row.tenantId === this.tenantFilter;
    });
    return accessibleRuns(rows, this.accessInput());
  }
  private formatUnknown(value: number | undefined, format: (n: number) => string) {
    return value === undefined ? "未知" : format(value);
  }
  private formatSnapshotAt(updatedAt: number | undefined) {
    if (updatedAt === undefined) {
      return "摘要时间未知";
    }
    return new Date(updatedAt).toLocaleString("zh-CN", { hour12: false });
  }
  private selectTenant(tenantId: string) {
    this.setTenantFilter(tenantId);
    this.surface = "overview";
  }
  private setTenantFilter(tenantId: string) {
    this.tenantFilter = tenantId || "all";
    this.selected = null;
    this.expanded = false;
    this.frozenView = null;
    this.frozenStream = null;
    this.paused = false;
    this.queryResult = null;
    this.frozenTaskIndex = null;
    if (this.source !== "sample") {
      this.taskIndex = null;
    }
    this.taskIndexGeneration += 1;
    void this.pullTaskIndex();
  }
  private submitPreciseQuery(view: ObservationView) {
    const identifier = this.queryInput.trim();
    const authorization = currentAuthorization(this.accessInput());
    if (!authorization.ok) {
      this.queryResult = { status: "denied", message: authorization.message };
      this.selected = null;
      this.expanded = false;
      this.requestedRunId = null;
      this.requestedDrawer = false;
      this.syncDrawerUrl({ runId: null, drawer: false });
      return;
    }
    if (!identifier) {
      this.queryResult = null;
      return;
    }
    const matches = exactRunMatches(
      [...this.filteredRuns(view), ...this.indexRunsForDrawer()],
      identifier,
    );
    if (matches.length !== 1) {
      this.queryResult = { status: "miss", message: PRECISE_QUERY_MISS_COPY };
      this.selected = null;
      this.expanded = false;
      this.requestedRunId = null;
      this.requestedDrawer = false;
      this.syncDrawerUrl({ runId: null, drawer: false });
      return;
    }
    const run = matches[0];
    const access = canAccessRun({ ...this.accessInput(), run });
    if (!access.ok) {
      this.queryResult = {
        status: access.code === "run_out_of_scope" ? "miss" : "denied",
        message: access.code === "run_out_of_scope" ? PRECISE_QUERY_MISS_COPY : access.message,
      };
      this.selected = null;
      this.expanded = false;
      this.requestedRunId = null;
      this.requestedDrawer = false;
      this.syncDrawerUrl({ runId: null, drawer: false });
      return;
    }
    this.queryResult = { status: "hit", run };
  }
  private entryGrant(entry: ObservationEnterpriseEntry): TenantGrant {
    const mapped = this.tenantGrants?.[entry.tenantId];
    if (mapped === "granted" || mapped === "none") {
      return mapped;
    }
    return resolveTenantGrant(entry.tenantGrant ?? mapped);
  }
  private resetTransientView() {
    this.selected = null;
    this.expanded = false;
    this.frozenView = null;
    this.frozenStream = null;
    this.paused = false;
    this.requestedRunId = null;
    this.requestedDrawer = false;
    this.syncDrawerUrl({ runId: null, drawer: false });
  }
  private setAgentFilter(agentId: string) {
    this.agentFilter = agentId || "all";
    if (agentId !== "all") {
      const group = groupTargetsByAgent(this.targets).find((row) => row.agentId === agentId);
      const keys = new Set((group?.sessions ?? []).map((row) => row.sessionKey));
      const current = this.sessionFilter === "current" ? this.sessionKey : this.sessionFilter;
      if (current && current !== "all" && !keys.has(current)) {
        this.sessionFilter = "all";
      }
    }
    this.resetTransientView();
  }
  private setSessionFilter(value: string) {
    this.sessionFilter = value || "current";
    if (value !== "all" && value !== "current" && value) {
      this.sessionKey = value;
      this.onSessionKey?.(value);
    }
    this.resetTransientView();
  }
  private togglePause(view: ObservationView) {
    if (!this.paused) {
      this.frozenView = view;
      this.frozenStream = this.buildLiveStream(view);
      this.frozenSnapshot = this.windowSnapshot;
      this.frozenTaskIndex = this.taskIndex;
      this.paused = true;
      this.pendingStreamUpdate = false;
      this.snapshotGeneration += 1;
      this.taskIndexGeneration += 1;
    } else {
      this.paused = false;
      this.frozenView = null;
      this.frozenStream = null;
      this.frozenSnapshot = null;
      this.frozenTaskIndex = null;
      this.pendingStreamUpdate = false;
      this.snapshotGeneration += 1;
      this.taskIndexGeneration += 1;
      void this.pullPlatformSnapshot();
      void this.pullTaskIndex();
    }
  }
  private openRun(row: ObservationRun, drawer: boolean) {
    this.selected = row;
    this.expanded = drawer;
    this.requestedRunId = row.id;
    this.requestedDrawer = drawer;
  }
  private renderPauseControl(view: ObservationView) {
    const frozenNote = this.paused
      ? this.pendingStreamUpdate
        ? "已冻结展示 · 后台已收到更新；继续后显示；任务仍在运行"
        : "已冻结展示 · 任务仍在运行"
      : null;
    return html`<div class="obs-wb-filters__pause">
      <button type="button" data-action="pause" class="obs-pause ${this.paused ? "is-paused" : ""}" @click=${() => this.togglePause(view)}>${this.paused ? "继续刷新" : "暂停刷新"}</button>
      ${frozenNote ? html`<span class="obs-stream-foot">${frozenNote}</span>` : nothing}
    </div>`;
  }
  private evidenceLayers(run: ObservationRun): readonly (readonly [string, string])[] {
    return [
      [
        "执行",
        run.eventCount > 0 || run.stages.some((stage) => stage.state === "observed")
          ? "已观察"
          : "未供给",
      ],
      [
        "关联",
        run.scenarioTaskRef || run.admittedWorkId || run.sourceRunId
          ? run.reasons.some((reason) => LINK_BREAK_REASONS.has(reason))
            ? "不完整"
            : "已观察"
          : "未供给",
      ],
      [
        "结果",
        run.outcomeRevision
          ? run.outcomeState === "accepted"
            ? "已记录 accepted"
            : run.outcomeState === "pending"
              ? "待证据"
              : "已记录 · 未验收"
          : "未供给",
      ],
      ["治理", "未供给"],
    ];
  }
  private technicalEndLabel(run: ObservationRun): string {
    if (run.toolState === "completed") {
      return "工具调用已完成（≠ 任务成功）";
    }
    if (run.toolState === "running") {
      return "工具调用进行中";
    }
    if (run.toolState === "waiting") {
      return "等待工具调用";
    }
    return "技术终态未知 · 不推断";
  }
  private businessResultLabel(run: ObservationRun): string {
    if (run.outcomeState === "accepted") {
      return "已记录 accepted";
    }
    if (run.outcomeState === "rejected") {
      return "已记录 · 未验收";
    }
    if (run.outcomeState === "pending") {
      return "待证据 / 待验收";
    }
    return "未知 · 缺少结果版本";
  }
  private selectAnalysisRun(row: ObservationRun) {
    this.selected = row;
    this.expanded = false;
    this.requestedRunId = row.id;
    this.requestedDrawer = false;
  }
  private renderEnterpriseFilters(view: ObservationView) {
    const groups = groupTargetsByAgent(this.targets);
    const sessions =
      this.agentFilter === "all"
        ? this.targets
        : (groups.find((row) => row.agentId === this.agentFilter)?.sessions ?? []);
    return html`<section class="obs-wb-filters" aria-label="连接工作台筛选">
      <div class="obs-wb-filters__grid">
        <label><span>观测对象</span><select aria-label="观测对象筛选" @change=${(event: Event) => {
          this.setAgentFilter((event.target as HTMLSelectElement).value || "all");
        }}><option value="all" ?selected=${this.agentFilter === "all"}>全部授权对象</option>${groups.map((row) => html`<option value=${row.agentId} ?selected=${this.agentFilter === row.agentId}>${row.label}</option>`)}</select></label>
        <label><span>会话</span><select aria-label="会话筛选" @change=${(event: Event) => {
          this.setSessionFilter((event.target as HTMLSelectElement).value || "current");
        }}><option value="current" ?selected=${this.sessionFilter === "current"}>当前会话</option><option value="all" ?selected=${this.sessionFilter === "all"}>全部授权会话</option>${sessions.map((row) => html`<option value=${row.sessionKey} ?selected=${this.sessionFilter === row.sessionKey}>${row.label} · ${row.kind === "group" ? "协作" : "个人"}</option>`)}</select></label>
        <label><span>运行类型</span><select aria-label="运行类型筛选" @change=${(event: Event) => {
          this.filter = (event.target as HTMLSelectElement).value as typeof this.filter;
          this.resetTransientView();
        }}>${OBSERVATION_TYPES.map((row) => html`<option value=${row} ?selected=${this.filter === row}>${row === "全部" ? "全部类型" : row}</option>`)}</select></label>
        <label class="obs-source"><span>数据源</span><select aria-label="观测数据源" @change=${(event: Event) => this.setSource((event.target as HTMLSelectElement).value)}><option value="live" ?selected=${this.source === "live"}>真实连接</option><option value="sample" ?selected=${this.source === "sample"}>样例验收</option></select></label>
      </div>
      ${this.renderPauseControl(view)}
    </section>`;
  }
  private renderAttentionBoard(
    runs: readonly ObservationRun[],
    selected: ObservationRun | undefined,
  ) {
    const shownRuns = this.applyMetricFilter(runs);
    const rows = filterAttention(shownRuns.map(classifyAttention), this.issueFilter);
    const counts = attentionCounts(runs.map(classifyAttention));
    const scopeHint = metricScopeHint(this.metricFilter, shownRuns.length);
    const chips: { id: AttentionKind; label: string; count: number }[] = [
      { id: "all", label: "全部关注", count: counts.all },
      { id: "link", label: "关联断链", count: counts.link },
      { id: "review", label: "待核实", count: counts.review },
      { id: "rule", label: "规则发现", count: counts.rule },
    ];
    return html`<section class="obs-issue-board" aria-label="需要关注的运行">
      <div class="obs-issue-board__head"><h3>需要关注的运行</h3></div>
      ${
        scopeHint
          ? html`<div class="obs-list-scope-bar" role="status">
              <p data-testid="obs-metric-scope-hint">${scopeHint}</p>
              <button type="button" data-action="clear-metric-filter" @click=${() => {
                this.metricFilter = "all";
              }}>清除列表筛选</button>
            </div>`
          : nothing
      }
      <div class="obs-issue-chips">${chips.map(
        (chip) =>
          html`<button type="button" class=${this.issueFilter === chip.id ? "is-on" : ""} data-issue-filter=${chip.id} @click=${() => {
            this.issueFilter = chip.id;
          }}>${chip.label} ${chip.count}</button>`,
      )}</div>
      ${
        rows.length
          ? html`<table class="obs-issue-table"><thead><tr><th>主状态</th><th>影响</th><th>资格</th><th>下一步</th></tr></thead><tbody>${rows.map(
              (row) => html`<tr class=${selected?.id === row.run.id ? "is-selected" : ""}>
            <td class="obs-issue-type">${row.status}</td>
            <td><button type="button" class="obs-run ${selected?.id === row.run.id ? "is-selected" : ""}" data-run-id=${row.run.id} @click=${() => this.openRun(row.run, true)}><strong>${row.run.label}</strong><code>${row.run.clientRunId ?? "clientRunId 未知"}${row.run.sourceRunId ? ` → ${row.run.sourceRunId}` : ""}</code></button><p class="obs-issue-impact">${row.impact}</p></td>
            <td>${row.qualification}</td>
            <td>${row.next}</td>
          </tr>`,
            )}</tbody></table>`
          : html`
              <div class="obs-empty">
                <strong>当前筛选下没有可观测事件</strong>
                <p>没有严格匹配的事件时，不借用其他会话数据，也不把空结果写成 0% 或已验证。</p>
              </div>
            `
      }
    </section>`;
  }
  private renderOverviewMetrics(runs: readonly ObservationRun[]) {
    const metrics = computeOverviewMetrics(runs);
    return html`<section class="obs-metrics-block" aria-label="态势指标">
      <div class="obs-metrics-compact">${metrics.map((row) =>
        this.renderMetric({
          key: row.key,
          label: row.label,
          value: row.value === "未知" ? null : Number.NaN,
          display: row.value,
          unit: row.unit,
          note: row.note,
          series: [],
        }),
      )}</div>
    </section>`;
  }
  private renderLoopGuide() {
    const open = this.guideUserOpen === true;
    return html`
      <section class="obs-guide" aria-label="观测闭环说明">
        <button type="button" class="obs-guide__toggle" aria-expanded=${open} data-action="toggle-guide" @click=${() => {
          this.guideUserOpen = !open;
        }}>
          <strong>观测闭环说明</strong>
          <span>${open ? "收起" : "展开（日常可收起）"} · 从一次运行的证据开始，而不是从一张报表结束</span>
        </button>
        ${
          open
            ? html`
                <div class="obs-guide__body">
                  <ol>
                    <li>
                      <span class="n">01</span>
                      <div>
                        <strong>已观察</strong><small>记录到达的事件与资格。有事件不等于异常或偏离。</small>
                      </div>
                    </li>
                    <li>
                      <span class="n">02</span>
                      <div>
                        <strong>规则发现 / 证据核实</strong
                        ><small>仅在存在阈值或对照时标记规则发现；否则只陈述缺失，不声明偏离。</small>
                      </div>
                    </li>
                    <li>
                      <span class="n">03</span>
                      <div><strong>改善实验</strong><small>候选、授权、控制面回执与生效版本分开记录。</small></div>
                    </li>
                    <li>
                      <span class="n">04</span>
                      <div>
                        <strong>业务回验</strong><small>同任务口径重新接入结果证据。推理假设不作事实。</small>
                      </div>
                    </li>
                  </ol>
                </div>
              `
            : nothing
        }
      </section>
    `;
  }
  private renderEnterpriseOverview(
    view: ObservationView,
    runs: readonly ObservationRun[],
    selected: ObservationRun | undefined,
  ) {
    return html`
      ${this.renderAttentionBoard(runs, selected)}
      ${selected ? this.renderImprovement(view, selected) : nothing}
      ${this.renderOverviewMetrics(runs)}
      ${this.renderLoopGuide()}
    `;
  }
  private renderPlatformSubnav() {
    const items = [
      ["overview", "平台总览"],
      ["query", "精确任务查询"],
      ["tenants", "租户与授权"],
      ["capacity", "覆盖与容量"],
    ] as const;
    return html`<nav class="obs-plat-subnav" role="tablist" aria-label="平台观测视图">${items.map(
      ([id, label]) =>
        html`<button type="button" role="tab" class=${this.platformPage === id ? "is-active" : ""} aria-selected=${this.platformPage === id} aria-current=${this.platformPage === id ? "page" : nothing} data-platform-page=${id} @click=${() => {
          this.platformPage = id;
        }}>${label}</button>`,
    )}</nav>`;
  }
  private renderPlatformCapacity() {
    const snapshot = this.firstScreenSnapshot();
    const coverageInput = snapshot?.coverage ?? null;
    const heartbeatInput = snapshot?.heartbeat ?? null;
    const coverage = formatLinkCoverage(coverageInput);
    const heartbeat = formatHeartbeat(heartbeatInput);
    const concurrency = formatConcurrency(snapshot?.capacity?.concurrency ?? null);
    const quota = formatQuota(snapshot?.capacity?.quota ?? null);
    const cards = [
      {
        title: "采样覆盖",
        value: coverage.value,
        chart: true,
        fraction: linkCoverageFraction(coverageInput),
      },
      {
        title: "心跳时效",
        value: heartbeat.value,
        chart: true,
        fraction: heartbeatFraction(heartbeatInput),
      },
      { title: "登记并发", value: concurrency.value, chart: false, fraction: null },
      { title: "额度", value: quota.value, chart: false, fraction: null },
    ];
    return html`<section class="obs-plat-card" data-testid="obs-platform-capacity" aria-label="覆盖与容量">
      <div class="obs-plat-card__head"><div><h3>覆盖与容量</h3></div></div>
      <div class="obs-cap-grid">${cards.map(
        (card) => html`<div class="obs-cap-item ${card.chart ? "obs-cap-item--chart" : ""}" data-testid=${`obs-capacity-${card.title}`}>
          <h4>${card.title}</h4>
          ${
            card.title === "心跳时效" && card.fraction == null
              ? this.renderHeartbeatActivity(heartbeatInput)
              : card.chart
                ? this.renderRatioMeter({ label: card.title, value: card.value, fraction: card.fraction })
                : html`<div class="obs-cap-val">${card.value}</div>`
          }
        </div>`,
      )}</div>
    </section>`;
  }
  private renderTabs() {
    return html`<nav class="obs-tabs" aria-label="观测视图" role="tablist">
      ${(
        [
          ["overview", "态势总览"],
          ["analysis", "运行分析"],
          ["governance", "治理与验证"],
        ] as const
      ).map(
        ([id, label]) =>
          html`<button type="button" role="tab" aria-selected=${this.surface === id} class=${this.surface === id ? "is-active" : ""} @click=${() => {
            this.surface = id;
            this.onSurfaceChange?.(id);
          }}>${label}</button>`,
      )}
    </nav>`;
  }
  private renderFilters(view: ObservationView) {
    const directory = this.directoryEntries(view);
    if (this.role === "enterprise") {
      return this.renderEnterpriseFilters(view);
    }
    return html`<section class="obs-filters" aria-label="观测筛选">
      <label><span>时间窗</span><select aria-label="时间窗筛选" @change=${(event: Event) => {
        const value = (event.target as HTMLSelectElement).value;
        this.timeWindow = value === "current" ? "current" : "7d";
        this.selected = null;
        this.expanded = false;
      }}><option value="7d" ?selected=${this.timeWindow === "7d"}>近 7 天</option><option value="current" ?selected=${this.timeWindow === "current"}>当前连接窗口</option></select></label>
      <label><span>租户</span><select aria-label="租户筛选" @change=${(event: Event) => {
        this.setTenantFilter((event.target as HTMLSelectElement).value || "all");
      }}><option value="all" ?selected=${this.tenantFilter === "all"}>${view.source === "sample" ? "全部企业（样例）" : "全部企业"}</option>${directory.map((row) => html`<option value=${row.tenantId} ?selected=${this.tenantFilter === row.tenantId}>${row.label}</option>`)}</select></label>
      <label><span>任务类型</span><select aria-label="任务类型筛选" @change=${(event: Event) => {
        this.filter = (event.target as HTMLSelectElement).value as typeof this.filter;
        this.selected = null;
        this.expanded = false;
        this.frozenView = null;
        this.frozenStream = null;
        this.paused = false;
      }}>${OBSERVATION_TYPES.map((row) => html`<option value=${row} ?selected=${this.filter === row}>${row === "全部" ? "全部任务类型" : row}</option>`)}</select></label>
      ${this.renderPauseControl(view)}
    </section>`;
  }
  private renderTenantCompare(view: ObservationView) {
    if (this.role !== "platform") {
      return nothing;
    }
    const rows = this.filteredDirectory(view);
    const isSample = view.source === "sample";
    const isCurrent = this.timeWindow === "current";
    if (!rows.length) {
      return html`<section class="obs-tenant-compare" data-testid="obs-tenant-compare">
        <div class="obs-tenant-compare__head"><h3>企业状态比较</h3><p>${isSample ? "目录摘要未供给 · 事件样例仅供验收" : "授权企业目录为空 · 不抽样假状态"}</p></div>
        <div class="obs-empty obs-tenant-empty"><strong>${isSample ? "样例企业未启用" : "暂无企业目录摘要"}</strong><p>${isSample ? "切换到样例验收后应出现明确标注的样例企业。" : "近 7 天跨租户视图依赖目录摘要，不是事件回放。"}</p></div>
      </section>`;
    }
    return html`<section class="obs-tenant-compare" data-testid="obs-tenant-compare">
      <div class="obs-tenant-compare__head">
        <h3>企业状态比较</h3>
        <p>${isSample ? "样例目录 · 仅供交互验收，非生产健康" : isCurrent ? "目录健康参考 · 非本次运行事件；当前连接事件未映射租户" : "目录摘要 · 近 7 天聚合快照，非事件回放"}</p>
      </div>
      <div class="obs-tenant-grid">${rows.map((entry) => this.renderTenantCard(entry, view))}</div>
    </section>`;
  }
  private renderTenantCard(entry: ObservationEnterpriseEntry, view: ObservationView) {
    const tone = entry.healthSummary?.tone ?? "neutral";
    const healthLabel = entry.healthSummary?.label ?? "未发现实体健康标签";
    const isCurrent = this.timeWindow === "current";
    const calls = this.formatUnknown(entry.usageSummary?.calls7d, (n) => String(n));
    const cost = this.formatUnknown(entry.usageSummary?.cost7d, (n) => n.toFixed(2));
    const success = this.formatUnknown(
      entry.healthSummary?.successRate,
      (n) => `${Math.round(n * 1000) / 10}%`,
    );
    const successDisplay = isCurrent ? "—" : success;
    const stamp = this.formatSnapshotAt(
      entry.usageSummary?.updatedAt ?? entry.healthSummary?.updatedAt,
    );
    return html`<button type="button" class="obs-tenant-card" data-tenant-id=${entry.tenantId} @click=${() => this.selectTenant(entry.tenantId)}>
      <div class="obs-tenant-card__top">
        <div><strong>${entry.label}</strong><code>${entry.tenantId}</code></div>
        <span class="obs-status is-${tone === "ok" ? "ok" : tone === "warn" || tone === "danger" ? "partial" : "neutral"}">${healthLabel}</span>
      </div>
      <div class="obs-tenant-card__meta">
        <span>状态 ${entry.status}</span>
        ${entry.plan ? html`<span>${entry.plan}</span>` : nothing}
        ${
          view.source === "sample"
            ? html`
                <span class="obs-status is-partial">样例</span>
              `
            : nothing
        }
      </div>
      <div class="obs-tenant-card__stats">
        <div><span>${isCurrent ? "目录调用参考" : "近 7 天调用"}</span><strong>${isCurrent ? "—" : calls}</strong></div>
        <div><span>${isCurrent ? "目录成本参考" : "近 7 天成本"}</span><strong>${isCurrent ? "—" : cost}</strong></div>
        <div><span>目录成功率参考（口径/分母未供给）</span><strong>${successDisplay}</strong></div>
      </div>
      <small>${isCurrent ? "目录健康参考 · 非本次运行事件" : `摘要时间 ${stamp}`} · 点击仅筛选已映射数据，不代表业务闭环关联</small>
    </button>`;
  }
  private renderPulse(view: ObservationView, runs: readonly ObservationRun[]) {
    const stream = this.streamFor(view);
    const samples = [
      {
        key: "active_runs",
        label: "活跃运行",
        value: runs.filter((row) => row.toolState === "running" || row.toolState === "waiting")
          .length,
        unit: "项",
        series: [1, 2, 1],
        note: "样例运行状态",
      },
      {
        key: "event_receive_rate",
        label: "元数据事件",
        value: runs.reduce((n, row) => n + row.eventCount, 0),
        unit: "条",
        series: [17, 22, 39],
        note: "样例窗口 · 非生产实时",
      },
      {
        key: "latency_p95",
        label: "已关联时延 P95",
        value: Math.max(0, ...runs.map((row) => row.latencyMs ?? 0)) / 1000,
        unit: "秒",
        series: [1.6, 4.2, 3.1],
        note: "样例生命周期",
      },
      {
        key: "sequence_or_link_gaps",
        label: "证据缺口",
        value: runs.filter((row) => row.reasons.length).length,
        unit: "项",
        series: [1, 2, 3],
        note: "点击查看对应运行",
      },
      {
        key: "business_acceptance",
        label: "业务验收",
        value:
          this.role === "enterprise"
            ? runs.filter((row) => row.outcomeState === "accepted").length
            : null,
        unit: "项",
        series: [0, 0, 1],
        note: this.role === "enterprise" ? "样例回验关联" : "平台样例未授权业务终态",
      },
      {
        key: "attributed_cost",
        label: "可归属成本",
        value: null,
        unit: "",
        series: [],
        note: "没有真实 request usage，不填零",
      },
    ];
    const rows =
      this.source === "sample"
        ? samples
        : stream.metrics.map((row) => ({
            ...row,
            unit: row.unit === "ms" ? "ms" : (row.unit ?? ""),
          }));
    return html`<section class="obs-realtime" aria-label="实时观测脉冲">
      <header class="obs-realtime-head"><div><span class="obs-live-dot"></span><h3>动态观测</h3><span>${this.source === "sample" ? "明确标注的静态验收样例" : stream.scope}</span></div>
        <div><span class="obs-update">${view.receivedAt ? `最后事件 ${new Date(view.receivedAt).toLocaleTimeString("zh-CN", { hour12: false })}` : "尚无真实事件"}</span><button type="button" data-action="pause" class="obs-pause" @click=${() => {
          if (!this.paused) {
            this.frozenView = view;
            this.frozenStream = this.buildLiveStream(view);
            this.paused = true;
            this.pendingStreamUpdate = false;
          } else {
            this.paused = false;
            this.frozenView = null;
            this.frozenStream = null;
            this.pendingStreamUpdate = false;
          }
        }}>${this.paused ? "继续观测" : "暂停观测"}</button></div></header>
      <div class="obs-pulse-grid">${rows.map((row) => this.renderMetric(row))}</div>
      <footer class="obs-stream-foot"><span>${this.source === "live" ? "新到达元数据驱动更新；不读取消息或工具载荷。等待真实事件后建立本次连接窗口" : "样例仅串联交互，不代表真实指标或生产改善"}</span><span>${this.paused ? (this.pendingStreamUpdate ? "已冻结展示 · 后台已收到更新；继续后显示；任务仍在运行" : "已冻结展示 · 任务仍在运行") : this.changeCount > 1 ? `本页观察到 ${this.changeCount - 1} 次数据变化` : "等待第一次事件"}</span></footer>
    </section>`;
  }

  private renderMetric(row: {
    key: string;
    label: string;
    value: number | null;
    note: string;
    display?: string;
    unit?: string | null;
    series?: readonly { at: number; value: number | null }[] | readonly number[];
  }) {
    const raw = row.series ?? [];
    const numbers = raw
      .map((point) => (typeof point === "number" ? point : point.value))
      .filter((v): v is number => typeof v === "number");
    const max = Math.max(...numbers, 1);
    const points = numbers
      .map((v, i) => `${(i / Math.max(numbers.length - 1, 1)) * 148 + 4},${36 - (v / max) * 28}`)
      .join(" ");
    const display =
      row.display ?? (row.value === null ? "未知" : `${Math.round(row.value * 10) / 10}`);
    return html`<button type="button" class="obs-pulse-card ${this.metricFilter === row.key ? "is-selected" : ""}" data-metric=${row.key} @click=${() => this.drillMetric(row.key as ObservationStreamMetricKey)}>
      <span>${row.label}</span><strong>${display}<small>${row.unit ?? ""}</small></strong>
      ${
        points
          ? html`<svg class="obs-sparkline" viewBox="0 0 156 44" role="img" aria-label=${`${row.label}的实际接收窗口趋势`}> <polyline points=${points}></polyline></svg>`
          : html`
              <div class="obs-no-trend">无真实关联时序 · —</div>
            `
      }
      <small>${row.note}</small></button>`;
  }

  private drillMetric(key: ObservationStreamMetricKey) {
    this.metricFilter = key;
    this.expanded = false;
    if (key === "sequence_or_link_gaps") {
      this.selected =
        this.filteredRuns(this.updateStream(this.view())).find((row) => row.reasons.length) ?? null;
    } else if (key === "active_runs") {
      this.selected =
        this.filteredRuns(this.updateStream(this.view())).find(
          (row) => row.toolState === "running" || row.toolState === "waiting",
        ) ?? null;
    } else if (key === "business_acceptance" && this.role === "enterprise") {
      this.selected =
        this.filteredRuns(this.updateStream(this.view())).find(
          (row) => row.outcomeState === "accepted",
        ) ?? null;
    }
  }

  private renderLoop(
    view: ObservationView,
    runs: readonly ObservationRun[],
    selected: ObservationRun | undefined,
  ) {
    const shownRuns = this.applyMetricFilter(runs);
    const scopeHint = metricScopeHint(this.metricFilter, shownRuns.length);
    return html`<section class="obs-loop">
      <div class="obs-loop-runs"><header class="obs-section-head"><div><h3>${this.metricFilter === "sequence_or_link_gaps" ? "需要核实的事件" : "运行与改善对象"}</h3><p>点击一项，沿同一身份核实、诊断与回验。</p></div>${
        this.metricFilter !== "all"
          ? html`<button type="button" data-action="clear-metric-filter" @click=${() => {
              this.metricFilter = "all";
            }}>清除列表筛选</button>`
          : nothing
      }</header>
      ${scopeHint ? html`<p class="obs-metric-scope-hint" data-testid="obs-metric-scope-hint">${scopeHint}</p>` : nothing}
        ${
          shownRuns.length
            ? shownRuns.map(
                (row) =>
                  html`<button type="button" class="obs-run ${selected?.id === row.id ? "is-selected" : ""}" data-run-id=${row.id} @click=${() => {
                    this.selected = row;
                    this.expanded = true;
                    this.requestedRunId = row.id;
                    this.requestedDrawer = true;
                  }}><span><strong>${row.label}</strong><code>${row.clientRunId ?? "clientRunId 未知"}${row.sourceRunId ? ` → ${row.sourceRunId}` : ""}</code><small>${row.latencyMs === null ? "时延未知" : `${(row.latencyMs / 1000).toFixed(1)} 秒`} · ${row.eventCount} 条元数据</small></span><span class="obs-status ${row.reasons.length ? "is-partial" : "is-ok"}">${row.reasons.length ? "待核实" : "已观测"}</span></button>`,
              )
            : html`<div class="obs-empty"><strong>${this.metricFilter === "attributed_cost" ? "当前没有可归属成本" : this.role === "platform" && this.tenantFilter !== "all" && view.source === "live" ? "所选企业暂无已映射运行事件" : runs.length === 0 && this.metricFilter === "all" ? "当前会话还没有观测事件" : "当前筛选没有运行"}</strong><p>${this.metricFilter === "attributed_cost" ? "周期账单不能摊到未关联的运行。" : "没有严格匹配的事件时，不借用其他会话数据。"}</p></div>`
        }
      </div>
      <div class="obs-loop-detail">${selected ? this.renderImprovement(view, selected) : this.renderLoopIntro(view)}</div>
    </section>`;
  }

  private renderLoopIntro(view: ObservationView) {
    return html`<div class="obs-loop-intro"><span class="obs-eyebrow">IMPROVEMENT CONTEXT</span><h3>从一条偏离开始，而不是从一张报表结束</h3><p>${view.source === "sample" ? "选择一个样例运行，查看同一证据如何串起诊断、实验和回验。" : "选择一次运行；在新事件到达时，指标与运行证据一起更新，已选身份不被其他会话替换。"}</p>
      <ol><li class="active"><span>01</span><div><strong>观测异常</strong><small>当前值、实际趋势、关联运行</small></div></li><li><span>02</span><div><strong>证据诊断</strong><small>确认事实与缺失，不猜根因</small></div></li><li><span>03</span><div><strong>改善实验</strong><small>候选、授权与配置分开回执</small></div></li><li><span>04</span><div><strong>业务回验</strong><small>同任务口径重新接入结果证据</small></div></li></ol></div>`;
  }

  private renderImprovement(view: ObservationView, run: ObservationRun) {
    const target = this.targets.find((row) => row.sessionKey === this.sessionKey);
    return html`<article class="obs-improvement" data-testid="obs-improvement">
      <header><div><span class="obs-eyebrow">同一改善对象 · ${run.tenantLabel ?? "当前会话"}</span><h3>${run.label}</h3><code>${run.clientRunId}${run.sourceRunId ? ` → ${run.sourceRunId}` : ""}</code></div><button type="button" class="obs-link" @click=${() => {
        this.expanded = true;
        this.requestedRunId = run.id;
        this.requestedDrawer = true;
      }}>完整运行证据</button></header>
      <ol class="obs-loop-steps"><li class="is-done"><span>01</span><strong>偏离已发现</strong><small>${run.reasons.length ? `${run.reasons.length} 类证据需核实` : "收到执行元数据"}</small></li><li><span>02</span><strong>诊断与根因</strong><small>${target ? "可携带本次 runId 做针对性诊断" : "平台当前未映射租户；请从原诊断页核验企业目标"}</small></li><li><span>03</span><strong>实验与授权</strong><small>候选来自诊断；不默认创建或下发</small></li><li><span>04</span><strong>同口径回验</strong><small>${run.outcomeState === "accepted" ? "有业务验收关联；仍可对比改善前后" : "尚缺业务验收，工具完成不算改善有效"}</small></li></ol>
      ${run.reasons.length ? html`<div class="obs-deviation"><strong>本次先核实</strong><p>${[...new Set(run.reasons)].slice(0, 3).map(reasonLabel).join("；")}</p></div>` : nothing}
      <div class="obs-loop-actions">${target && view.source === "live" && run.clientRunId && this.onDiagnoseRun ? html`<button type="button" class="obs-primary" @click=${() => this.onDiagnoseRun?.({ runId: run.clientRunId!, sessionKey: target.sessionKey, agentId: target.agentId })}>诊断这次运行</button>` : html`<a class="obs-primary" href=${this.role === "platform" ? pathForTab("platformDiagnosis", this.basePath) : "#original-diagnosis"}>${target ? "进入针对性诊断" : "进入原诊断并选择目标"}</a>`}<a href=${this.role === "platform" ? pathForTab("platformAdvanced", this.basePath) : pathForTab("enterpriseCapabilityCenter", this.basePath, { tenantId: this.tenantId })}>进入实验与治理</a></div>
      <p class="obs-loop-boundary">诊断产生候选后才进入实验；批准、实际配置与效果验证分别记录，当前面板不自动执行改善。</p>
    </article>`;
  }

  private renderAnalysis(
    view: ObservationView,
    runs: readonly ObservationRun[],
    selected: ObservationRun | undefined,
  ) {
    const unmappedLive =
      this.role === "platform" && view.source === "live" && this.tenantFilter !== "all";
    const scopeHint = metricScopeHint(this.metricFilter, runs.length);
    const nav = html`<div class="obs-analysis-nav" role="tablist" aria-label="分析维度">
      ${(
        [
          ["tasks", "任务与执行"],
          ["models", "模型与路由"],
          ["executors", "执行器与能力"],
          ["capacity", "容量与风险"],
        ] as const
      ).map(
        ([id, label]) =>
          html`<button type="button" role="tab" aria-selected=${this.analysis === id} class=${this.analysis === id ? "is-active" : ""} @click=${() => {
            this.analysis = id;
          }}>${label}</button>`,
      )}
    </div>`;
    if (this.analysis !== "tasks") {
      return html`${nav}${
        this.analysis === "capacity"
          ? view.source === "sample"
            ? html`
                <p>样例模式 · 非生产验证；不混入真实容量或对照记录。</p>
              `
            : html`${this.renderComparisonInput()}${renderComparisonCapacity(this.capacity, this.comparison)}`
          : this.renderUnavailableAnalysis()
      }`;
    }
    if (!runs.length) {
      return html`${nav}
        <div class="obs-empty">
          <strong>${unmappedLive ? "所选企业暂无已映射运行事件" : "当前筛选下没有可观测事件"}</strong>
          <p>${unmappedLive ? "execution_only 投影不含租户标签，不能把本机事件算到某个企业。" : "没有严格匹配的事件时不借用其他会话数据。请发起一个对话，或切换到明确标注的验收样例。"}</p>
        </div>`;
    }
    return html`${nav}
    ${
      scopeHint
        ? html`<div class="obs-list-scope-bar" role="status">
            <p data-testid="obs-metric-scope-hint">${scopeHint}</p>
            <button type="button" data-action="clear-metric-filter" @click=${() => {
              this.metricFilter = "all";
            }}>清除列表筛选</button>
          </div>`
        : nothing
    }
    <div class="obs-md" data-testid="obs-analysis-split">
      <div class="obs-md-list">
        <div class="obs-list-head"><strong>运行列表</strong><p>${runs.length} 条可见运行 · ${this.metricFilter === "all" ? "当前筛选集合" : "列表筛选"}</p></div>
        ${runs.map(
          (
            row,
          ) => html`<button class="obs-run ${selected?.id === row.id ? "is-selected" : ""}" type="button" data-run-id=${row.id} @click=${() => this.selectAnalysisRun(row)}>
        <span><strong>${row.label}</strong><code>${row.clientRunId ?? "clientRunId 未知"}${row.sourceRunId ? ` → ${row.sourceRunId}` : ""}${row.tenantLabel ? ` · ${row.tenantLabel}` : view.source === "live" && this.role === "platform" ? " · 未映射" : ""}</code></span>
        <span class="obs-run__state"><span>${row.scope === "personal" ? "个人" : row.scope === "collaboration" ? "协作" : "场景未知"}</span><span class="obs-status ${row.reasons.length ? "is-partial" : "is-ok"}">${row.reasons.length ? "部分证据" : "已观察"}</span></span>
      </button>`,
        )}
      </div>
      <div class="obs-md-detail">${
        selected
          ? this.renderAnalysisDetail(view, selected)
          : html`
              <p class="obs-footnote">选择左侧一次运行查看证据详情。</p>
            `
      }</div>
    </div>`;
  }
  private renderAnalysisDetail(view: ObservationView, run: ObservationRun) {
    const target = this.targets.find((row) => row.sessionKey === view.sessionKey);
    return html`<article class="obs-analysis-detail" data-testid="obs-analysis-detail">
      <div class="obs-detail-chips">
        <span class="obs-status ${run.reasons.length ? "is-partial" : "is-ok"}">${run.reasons.length ? "部分证据" : "已观察"}</span>
        <span class="obs-status ${run.sample ? "is-partial" : "is-ok"}">${run.sample ? "样例证据" : "实时元数据"}</span>
      </div>
      <h3>${run.label}</h3>
      <code>${run.clientRunId ?? "clientRunId 未知"}${run.sourceRunId ? ` → ${run.sourceRunId}` : ""}</code>
      <p class="obs-footnote">${run.scope === "personal" ? "个人运行" : run.scope === "collaboration" ? "协作运行" : "运行类型未知"}</p>
      <div class="obs-layer-grid" aria-label="四层证据">${this.evidenceLayers(run).map(
        ([label, value]) =>
          html`<div class="obs-layer"><div class="k">${label}</div><div class="v">${value}</div></div>`,
      )}</div>
      <div class="obs-detail-split">
        <div class="obs-detail-card"><h4>技术终态</h4><p class="obs-footnote">${this.technicalEndLabel(run)}</p></div>
        <div class="obs-detail-card"><h4>业务结果</h4><p class="obs-footnote">${this.businessResultLabel(run)}</p></div>
      </div>
      <p class="obs-footnote"><strong>候选重试：</strong>没有候选重试记录。未知不补装饰性数字。</p>
      <h4>时间线</h4>
      <ol class="obs-timeline">${run.stages.map((row) => html`<li><span class="obs-dot is-${row.state}"></span><div><strong>${row.label}</strong><p>${row.detail}</p></div></li>`)}</ol>
      <div class="obs-loop-actions">
        <button type="button" class="obs-primary" data-action="open-evidence" data-testid="obs-open-evidence" @click=${() => this.openRun(run, true)}>完整运行证据</button>
        ${
          target && view.source === "live" && run.clientRunId && this.onDiagnoseRun
            ? html`<button type="button" class="obs-secondary" @click=${() => this.onDiagnoseRun?.({ runId: run.clientRunId!, sessionKey: target.sessionKey, agentId: target.agentId })}>诊断这次运行</button>`
            : html`<a class="obs-secondary" href=${this.role === "platform" ? pathForTab("platformDiagnosis", this.basePath) : "#original-diagnosis"}>${target ? "进入针对性诊断" : "进入原诊断并选择目标"}</a>`
        }
        <a class="obs-secondary" href=${this.role === "platform" ? pathForTab("platformAdvanced", this.basePath) : pathForTab("enterpriseCapabilityCenter", this.basePath, { tenantId: this.tenantId })}>进入实验与治理</a>
      </div>
    </article>`;
  }
  private renderComparisonInput() {
    return html`<section aria-label="显式对照查询"><p>只读查询：请显式填写两个任务版本和 UTC 窗口，不自动选择任务。</p>
    ${(["baseline", "candidate"] as const).map(
      (side) =>
        html`<fieldset><legend>${side}</legend>${(
          [
            ["agentId", "数字人"],
            ["taskId", "任务"],
            ["version", "结果版本"],
            ["from", "开始UTC"],
            ["to", "结束UTC"],
          ] as const
        ).map(
          ([key, label]) =>
            html`<label>${label}<input aria-label=${side + " " + label} .value=${this.comparisonDraft[side][key]} placeholder=${key === "from" || key === "to" ? "2026-11-01T00:00:00Z" : ""} @input=${(
              event: Event,
            ) => {
              this.comparisonDraft = {
                ...this.comparisonDraft,
                [side]: {
                  ...this.comparisonDraft[side],
                  [key]: (event.target as HTMLInputElement).value,
                },
              };
              this.comparisonInputNote = "输入已变更，需重新读取";
              this.onComparisonRefs?.(null);
            }}></label>`,
        )}</fieldset>`,
    )}
    <button type="button" @click=${() => {
      const parse = (side: "baseline" | "candidate") => {
        const d = this.comparisonDraft[side];
        const version = Number(d.version);
        const from = Date.parse(d.from),
          to = Date.parse(d.to);
        if (
          !d.agentId.trim() ||
          !d.taskId.trim() ||
          !/^[1-9]\d*$/.test(d.version) ||
          !Number.isSafeInteger(version) ||
          !d.from.endsWith("Z") ||
          !d.to.endsWith("Z") ||
          !Number.isFinite(from) ||
          !Number.isFinite(to) ||
          from >= to ||
          to > Date.now() ||
          to - from > 30 * 86400000
        ) {
          return null;
        }
        return {
          refs: [{ agentId: d.agentId.trim(), taskId: d.taskId.trim(), outcomeVersion: version }],
          window: { from, to },
        };
      };
      const baseline = parse("baseline"),
        candidate = parse("candidate");
      if (!baseline || !candidate || baseline.refs[0].agentId !== candidate.refs[0].agentId) {
        this.comparisonInputNote = "需要完整合法的同一数字人任务版本与UTC窗口";
        this.onComparisonRefs?.(null);
        return;
      }
      this.comparisonInputNote = "已提交只读对照查询";
      this.onComparisonRefs?.({ baseline, candidate });
    }}>读取对照</button><p>${this.comparisonInputNote}</p></section>`;
  }
  private renderUnavailableAnalysis() {
    const labels = {
      models: [
        "模型与路由",
        "没有从运行 eventStream 猜模型或任务类型的统计。",
        "进入模型管理",
        "platformModels",
      ],
      executors: [
        "执行器与能力",
        "缺少有统一 attempt / capabilityCall 关联的执行器指标。",
        "进入 Agent Runtime",
        "platformAgents",
      ],
      capacity: [
        "容量与风险",
        "当前只读事件不构造跨租户容量、成本和风险聚合。",
        "进入高级治理",
        "platformAdvanced",
      ],
    } as const;
    const [title, detail, link, tab] =
      labels[this.analysis as keyof typeof labels] ?? labels.capacity;
    return html`<section class="obs-panel obs-empty"><h3>${title}</h3><p>${detail}</p><span class="obs-status is-partial">待数据支撑</span><p>${this.role === "platform" ? html`<a href=${pathForTab(tab, this.basePath)}>${link} →</a>` : "企业自有效果可回到诊断与进化控制面继续分析。"}</p></section>`;
  }
  private renderGovernance(view: ObservationView) {
    const intents =
      view.source === "sample"
        ? html`
            <p>样例模式不展示真实改善记录。</p>
          `
        : html`<section aria-label="改善记录列表">${
            this.actionIntents
              ? this.actionIntents.items.map(
                  (row) =>
                    html`<button type="button" data-intent-id=${row.actionIntentId} @click=${() => this.onSelectActionIntent?.(row.actionIntentId, row.revision)}>${row.actionIntentId} · 记录状态：${row.state}</button>`,
                )
              : html`
                  <p>改善关联记录未供给</p>
                `
          }${this.actionIntents?.reasons.join(", ")}${this.actionIntents?.mode === "detail" ? renderActionIntent(this.actionIntents.detail, Date.now()) : nothing}</section>`;
    return html`<section class="obs-panel obs-process">
      <p class="obs-gov-banner">改善记录与显式任务版本对照独立于连接工作台筛选，不随观测对象、会话、运行类型或数据源切换。improvementEligible 保持为 false；不合格回执不会投影为已验证。</p>
      <div class="obs-gov">
        <div class="obs-gov-col">
          <div class="obs-gov-head"><h3>改善记录（ActionIntent）</h3><p>每条记录分开呈现受理、执行、生效与验证；不用 executed 替代执行中或已生效。</p></div>
          ${intents}
          <h3>从发现到验证，每一步都有回执</h3><p>这里是建议，不是已执行或已生效的配置。</p>
          <ol>${[
            "任务证据",
            "诊断发现",
            "候选与实验",
            "授权与配置回读",
            "同口径验证",
            "晋升 / 回滚",
          ].map(
            (row, index) =>
              html`<li><span>${index + 1}</span><strong>${row}</strong>${
                index === 0
                  ? html`<small>${view.source === "sample" ? "样例证据" : "仅元数据"}</small>`
                  : html`
                      <small>原控制面</small>
                    `
              }</li>`,
          )}</ol>
          <div class="obs-actions"><a href=${pathForTab(this.role === "platform" ? "platformModels" : "enterpriseCapabilityCenter", this.basePath, { tenantId: this.tenantId })}>${this.role === "platform" ? "配置模型" : "进入能力中心"} →</a><a href=${pathForTab(this.role === "platform" ? "platformAdvanced" : "enterpriseMesh", this.basePath, { tenantId: this.tenantId })}>进入治理控制面 →</a></div>
          <p class="obs-note">观测不会创建建议、授权请求或新任务；accepted、executed、effective、verified 不混称。</p>
        </div>
        <div class="obs-gov-col">
          <div class="obs-gov-head"><h3>显式任务版本对照（独立查询）</h3><p>只读查询，不随连接工作台筛选切换。请显式填写两个任务版本和时间窗口。</p></div>
          ${
            view.source === "sample"
              ? html`
                  <p>样例模式不读取真实对照。</p>
                `
              : this.renderComparisonInput()
          }
        </div>
      </div>
    </section>`;
  }
  private renderEvidence(run: ObservationRun) {
    return html`<div class="obs-backdrop" @click=${() => {
      this.expanded = false;
    }}><aside class="obs-drawer" role="dialog" aria-modal="true" aria-label="运行证据" @click=${(event: Event) => event.stopPropagation()}>
      <header><div><span class="obs-status ${run.sample ? "is-partial" : "is-ok"}">${run.sample ? "样例证据" : "实时元数据"}</span><h2>${run.label}</h2></div><button type="button" aria-label="关闭证据" @click=${() => {
        this.expanded = false;
        this.requestedDrawer = false;
        this.syncDrawerUrl({ runId: null, drawer: false });
      }}>×</button></header>
      <section class="obs-evidence"><h3>资格</h3><p>资格未供给 · improvementEligible：false。当前表面不得把运行标成可改善，也不把不合格回执写成已验证。</p>
      <div class="obs-layer-grid" aria-label="四层证据">${this.evidenceLayers(run).map(
        ([label, value]) =>
          html`<div class="obs-layer"><div class="k">${label}</div><div class="v">${value}</div></div>`,
      )}</div>
      <h3>运行标识与状态</h3><dl>${[
        ["clientRunId", run.clientRunId],
        ["sourceRunId（引擎运行）", run.sourceRunId],
        ["租户", run.tenantLabel ?? (run.sample ? null : "未映射")],
        ["admitted_work_id", run.admittedWorkId],
        ["场景工作项", run.scenarioTaskRef],
        ["结果版本", run.outcomeRevision],
        [
          "业务终态",
          run.outcomeState === "accepted"
            ? "accepted"
            : run.outcomeState === "pending"
              ? "待证据 / 待验收"
              : "不可用 / 未授权",
        ],
        ["耗时", run.latencyMs === null ? null : `${run.latencyMs.toLocaleString()} ms`],
        [
          "成本",
          run.attributedCost
            ? `${run.attributedCost.amount.toFixed(3)} ${run.attributedCost.currency} · ${run.attributedCost.coverage}`
            : "未知 · 未伪造为零或把周期账单摊到单任务",
        ],
      ].map(
        ([label, value]) =>
          html`<div><dt>${label}</dt><dd>${
            value ??
            html`
              <span class="obs-missing">未供给 / 不推断</span>
            `
          }</dd></div>`,
      )}</dl></section>
      <ol class="obs-timeline">${run.stages.map((row) => html`<li><span class="obs-dot is-${row.state}"></span><div><strong>${row.label}</strong><p>${row.detail}</p></div></li>`)}</ol>
      ${run.reasons.length ? html`<section class="obs-drawer-reasons"><h3>证据缺口</h3>${[...new Set(run.reasons)].map((reason) => html`<p>${reasonLabel(reason)}</p>`)}</section>` : nothing}
      <footer>此面板不改写任务板或业务状态。工具结束 ≠ 任务成功，投递 ≠ 场景验收。</footer>
    </aside></div>`;
  }
  private liveNote(view: ObservationView) {
    if (this.role !== "platform" || view.source !== "live") {
      return "";
    }
    if (this.timeWindow === "7d") {
      return this.enterpriseDirectory.length
        ? "近 7 天跨租户视图来自企业目录摘要，不是事件回放；本机 execution_only 事件未映射租户。"
        : "暂无跨租户历史聚合查询能力；本平台不构造跨租户 session 事件。企业工作台按 sessionKey 读取原事件投影。";
    }
    return "当前连接窗口只读本机事件投影，不能标成 24 小时或近 7 天；目录健康仅作参考。";
  }
  updated(changed: Map<string | number | symbol, unknown>) {
    if (
      this.role === "platform" &&
      ["client", "connected", "scopes", "authorized", "gatewayMethods", "source"].some((key) =>
        changed.has(key),
      )
    ) {
      queueMicrotask(() => {
        void this.pullPlatformSnapshot();
        void this.pullTaskIndex();
      });
    }
    const view = this.updateStream(this.view());
    const runs = this.filteredRuns(view);
    const indexRuns = this.role === "platform" ? this.indexRunsForDrawer() : [];
    const drawerRuns = [...runs];
    const drawerAll = [...view.runs];
    for (const run of indexRuns) {
      if (!drawerRuns.some((row) => row.id === run.id)) {
        drawerRuns.push(run);
      }
      if (!drawerAll.some((row) => row.id === run.id)) {
        drawerAll.push(run);
      }
    }
    const resolved = resolveDrawerSelection({
      access: this.accessInput(),
      runs: drawerRuns,
      allRuns: drawerAll,
      selectedId: this.selected?.id ?? null,
      requestedRunId: this.requestedRunId,
      expanded: this.expanded,
      requestedDrawer: this.requestedDrawer,
    });
    if (resolved.deny) {
      if (this.selected || this.expanded || this.requestedRunId || this.requestedDrawer) {
        this.selected = null;
        this.expanded = false;
        this.requestedRunId = null;
        this.requestedDrawer = false;
      }
      if (this.accessNotice !== resolved.notice) {
        this.accessNotice = resolved.notice;
      }
      this.syncDrawerUrl({ runId: null, drawer: false });
      return;
    }
    const authorization = currentAuthorization(this.accessInput());
    const nextNotice = authorization.ok ? null : authorization.message;
    if (this.accessNotice !== nextNotice) {
      this.accessNotice = nextNotice;
    }
    if (resolved.run && this.selected?.id !== resolved.run.id) {
      this.selected = resolved.run;
    }
    if (resolved.expanded && !this.expanded) {
      this.expanded = true;
    }
    this.syncDrawerUrl(resolved.url);
  }

  private dateInputValue(ms: number): string {
    const date = new Date(ms);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  private setTaskDateRange(fromValue: string, toValue: string) {
    const fromParts = fromValue.split("-").map(Number);
    const toParts = toValue.split("-").map(Number);
    if (fromParts.length !== 3 || toParts.length !== 3 || fromParts.some((n) => !Number.isFinite(n)) || toParts.some((n) => !Number.isFinite(n))) {
      return;
    }
    const from = new Date(fromParts[0], fromParts[1] - 1, fromParts[2]).getTime();
    const to = new Date(toParts[0], toParts[1] - 1, toParts[2] + 1).getTime();
    if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to || to - from > 30 * 86_400_000) {
      return;
    }
    this.taskFrom = from;
    this.taskTo = to;
    this.frozenTaskIndex = null;
    this.paused = false;
    this.taskIndexGeneration += 1;
    void this.pullTaskIndex();
  }
  private setTaskAgentFilter(agentId: string) {
    this.taskAgentFilter = agentId || "all";
    this.frozenTaskIndex = null;
    this.paused = false;
    this.taskIndexGeneration += 1;
    void this.pullTaskIndex();
  }
  private indexItemId(item: PlatformTaskIndexItem): string {
    return `${item.agentId}:${item.taskId}@${item.outcomeVersion}`;
  }
  private indexItemToRun(item: PlatformTaskIndexItem, view: ObservationView): ObservationRun {
    const directory = this.directoryEntries(view);
    const entry = item.tenantId ? directory.find((row) => row.tenantId === item.tenantId) : undefined;
    return {
      id: this.indexItemId(item),
      label: item.taskId,
      scope: "unknown",
      tenantId: item.tenantId ?? null,
      tenantLabel: entry ? tenantDisplayName(entry.label, entry.tenantId) : null,
      clientRunId: item.taskId,
      sourceRunId: null,
      admittedWorkId: null,
      scenarioTaskRef: item.taskId,
      outcomeRevision: String(item.outcomeVersion),
      toolState: "unknown",
      outcomeState: "unavailable",
      latencyMs: null,
      attributedCost: null,
      stages: [],
      reasons: [],
      eventCount: 0,
      sample: view.source === "sample",
    };
  }
  private indexRunsForDrawer(): ObservationRun[] {
    const index = this.firstScreenTaskIndex();
    if (!index || index.authorization !== "granted") {
      return [];
    }
    const view = this.view();
    return accessibleRuns(
      index.tasks.map((item) => this.indexItemToRun(item, view)),
      this.accessInput(),
    );
  }
  private openIndexedTask(item: PlatformTaskIndexItem, view: ObservationView) {
    const run = this.indexItemToRun(item, view);
    const access = canAccessRun({ ...this.accessInput(), run });
    if (!access.ok) {
      return;
    }
    this.selected = run;
    this.expanded = true;
    this.requestedRunId = run.id;
    this.requestedDrawer = true;
  }
  private renderHeartbeatActivity(activity: HeartbeatInput | null) {
    const marks = heartbeatActivityMarks(activity);
    const first = marks[0]?.ts;
    const last = marks[marks.length - 1]?.ts;
    const start = first != null && last != null && last > first ? first : (last != null ? last - 1 : 0);
    const end = last != null && last > start ? last : start + 1;
    const span = Math.max(1, end - start);
    const value = formatHeartbeatFreshness(activity);
    return html`<div class="obs-heartbeat-activity" data-testid="obs-heartbeat-activity">
      <svg class="obs-heartbeat-spark" viewBox="0 0 120 36" role="img" aria-label=${value || "心跳活动"}>
        <line class="obs-heartbeat-spark__axis" x1="4" y1="18" x2="116" y2="18"></line>
        ${
          marks.length
            ? marks.map((mark) => {
                const x = 4 + (112 * (mark.ts - start)) / span;
                return html`<circle class="obs-heartbeat-spark__mark" cx=${x} cy="18" r="3"></circle>`;
              })
            : nothing
        }
      </svg>
      <div class="obs-cap-val">${value || "暂无心跳记录"}</div>
    </div>`;
  }

  private renderRatioMeter(options: { label: string; value: string; fraction: number | null }) {
    const radius = 28;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference * (1 - (options.fraction ?? 0));
    const label = options.fraction == null ? `${options.label}未知` : `${options.label} ${options.value}`;
    return html`<div class="obs-coverage-chart">
      <svg class="obs-coverage-meter ${options.fraction == null ? "is-unknown" : ""}" viewBox="0 0 72 72" role="img" aria-label=${label}>
        <circle class="obs-coverage-meter__track" cx="36" cy="36" r="28" fill="none" stroke-width="8"></circle>
        ${
          options.fraction == null
            ? nothing
            : html`<circle class="obs-coverage-meter__fill" cx="36" cy="36" r="28" fill="none" stroke-width="8" stroke-dasharray=${circumference} stroke-dashoffset=${offset} transform="rotate(-90 36 36)"></circle>`
        }
      </svg>
      <div class="obs-cap-val">${options.value}</div>
    </div>`;
  }

  private renderPlatformHealth(view: ObservationView) {
    // Bind the platform window snapshot only; never a single precise-query result.
    const snapshot = this.firstScreenSnapshot();
    const coverageInput: LinkCoverageInput | null = snapshot?.coverage ?? null;
    const heartbeatInput: HeartbeatInput | null = snapshot?.heartbeat ?? null;
    const coverage = formatLinkCoverage(coverageInput);
    const heartbeat = formatHeartbeat(heartbeatInput);
    const heartbeatRatio = heartbeatFraction(heartbeatInput);
    const grantCensus = censusTenantGrants(this.directoryEntries(view), this.tenantGrants);
    const census = formatGrantCensus(grantCensus);
    const unmapped = formatUnmappedEvents(snapshot?.unmappedEvents ?? null);
    return html`<section class="obs-plat-card" data-testid="obs-platform-health" aria-label="平台健康与覆盖">
      <div class="obs-plat-card__head"><div><h3>平台健康与覆盖</h3></div></div>
      <div class="obs-cap-grid">
        <div class="obs-cap-item obs-cap-item--chart" data-testid="obs-health-关联覆盖率">
          <h4>关联覆盖率</h4>
          ${this.renderRatioMeter({
            label: "关联覆盖率",
            value: coverage.value,
            fraction: linkCoverageFraction(coverageInput),
          })}
        </div>
        <div class="obs-cap-item obs-cap-item--chart" data-testid="obs-health-心跳时效">
          <h4>心跳时效</h4>
          ${
            heartbeatRatio == null
              ? this.renderHeartbeatActivity(heartbeatInput)
              : this.renderRatioMeter({
                  label: "心跳时效",
                  value: heartbeat.value,
                  fraction: heartbeatRatio,
                })
          }
        </div>
        <div class="obs-cap-item obs-cap-item--chart" data-testid="obs-health-租户授权">
          <h4>租户授权</h4>
          ${this.renderRatioMeter({
            label: "租户授权",
            value: census.value,
            fraction: grantFraction(grantCensus),
          })}
        </div>
        <div class="obs-cap-item" data-testid="obs-health-未映射事件">
          <h4>未映射事件</h4>
          <div class="obs-cap-val">${unmapped.value}</div>
          ${unmapped.detail ? html`<div class="obs-cap-den">${unmapped.detail}</div>` : nothing}
        </div>
      </div>
    </section>`;
  }
  private renderPreciseQuery(view: ObservationView) {
    const directory = this.directoryEntries(view);
    const authorization = currentAuthorization(this.accessInput());
    const disabled = !authorization.ok;
    const result = this.queryResult;
    const index = this.firstScreenTaskIndex();
    const window = index?.window ?? this.currentTaskWindow();
    const agents = [
      ...new Map(
        [...(index?.agents ?? []), ...this.targets.map((target) => ({ id: target.agentId }))]
          .filter((row) => row.id)
          .map((row) => [row.id, row]),
      ).values(),
    ];
    return html`<section class="obs-plat-card" data-testid="obs-precise-query" aria-label="精确任务查询">
      <div class="obs-plat-card__head"><div><h3>精确任务查询</h3></div></div>
      <div class="obs-query-filters">
      <label class="field obs-query-scope"><span>租户筛选</span>
        <select aria-label="租户筛选" ?disabled=${this.isAuthorized() === false} @change=${(
          event: Event,
        ) => {
          this.setTenantFilter((event.target as HTMLSelectElement).value || "all");
        }}>
          <option value="all" ?selected=${this.tenantFilter === "all"}>${view.source === "sample" ? "全部企业（样例）" : "全部企业"}</option>
          ${directory.map((row) => {
            const grant = this.entryGrant(row);
            const suffix =
              grant === "none" ? " · 无授权" : grant === "unknown" ? " · 尚未确认" : "";
            const code = visibleTenantCode(row.label, row.tenantId);
            return html`<option value=${row.tenantId} ?selected=${this.tenantFilter === row.tenantId}>${tenantDisplayName(row.label, row.tenantId)}${code ? `（${code}）` : ""}${suffix}</option>`;
          })}
        </select>
      </label>
      <label class="field obs-query-scope obs-query-dates-field"><span>日期</span>
        <div class="obs-query-dates">
          <input type="date" aria-label="起始日期" ?disabled=${disabled} .value=${this.dateInputValue(window.from)} @change=${(event: Event) => {
            const fromValue = (event.target as HTMLInputElement).value;
            this.setTaskDateRange(fromValue, this.dateInputValue(window.to - 1));
          }} />
          <input type="date" aria-label="结束日期" ?disabled=${disabled} .value=${this.dateInputValue(window.to - 1)} @change=${(event: Event) => {
            const toValue = (event.target as HTMLInputElement).value;
            this.setTaskDateRange(this.dateInputValue(window.from), toValue);
          }} />
        </div>
      </label>
      <label class="field obs-query-scope"><span>机器人</span>
        <select aria-label="机器人筛选" ?disabled=${disabled} @change=${(event: Event) => {
          this.setTaskAgentFilter((event.target as HTMLSelectElement).value || "all");
        }}>
          <option value="all" ?selected=${this.taskAgentFilter === "all"}>全部机器人</option>
          ${agents.map((row) => html`<option value=${row.id} ?selected=${this.taskAgentFilter === row.id}>${row.id}</option>`)}
        </select>
      </label>
      </div>
      <form class="obs-query-box" @submit=${(event: Event) => {
        event.preventDefault();
        this.submitPreciseQuery(view);
      }}>
        <label class="field"><span>精确任务 / 运行标识</span>
          <input aria-label="精确任务或运行标识" placeholder="例如 run-id、clientRunId 或 taskId@版本" .value=${this.queryInput} ?disabled=${disabled} @input=${(
            event: Event,
          ) => {
            this.queryInput = (event.target as HTMLInputElement).value;
          }} />
        </label>
        <button class="obs-query-submit" type="button" ?disabled=${disabled} @click=${() => this.submitPreciseQuery(view)}>精确查询</button>
      </form>
      ${
        !result
          ? nothing
          : result.status === "denied"
            ? html`<div class="obs-query-result" data-testid="obs-query-result"><strong>无授权</strong><p>${result.message}</p></div>`
            : result.status === "miss"
              ? html`<div class="obs-query-result" data-testid="obs-query-result"><strong>未找到匹配记录</strong><p>${result.message}</p></div>`
              : result.run
                ? html`<div class="obs-query-result" data-testid="obs-query-result">
                    <h4>${result.run.label}</h4>
                    <code>${result.run.clientRunId ?? result.run.id}</code>
                    <p class="obs-plat-footnote">租户：${result.run.tenantLabel ?? (result.run.tenantId ? result.run.tenantId : "未映射（不计入企业）")} · 不随连接工作台筛选切换</p>
                    <div class="obs-loop-actions"><button type="button" class="obs-primary" data-testid="obs-query-open" @click=${() => {
                      const run = result.run;
                      if (!run) {
                        return;
                      }
                      this.selected = run;
                      this.expanded = true;
                      this.requestedRunId = run.id;
                      this.requestedDrawer = true;
                    }}>打开完整证据</button></div>
                  </div>`
                : nothing
      }
      ${this.renderTaskIndexList(view, index, disabled)}
    </section>`;
  }
  private renderTaskIndexList(
    view: ObservationView,
    index: PlatformTaskIndexSnapshot | null,
    disabled: boolean,
  ) {
    if (disabled) {
      return nothing;
    }
    if (!index) {
      return nothing;
    }
    if (index.authorization === "unknown") {
      return html`<div class="obs-task-index" data-testid="obs-task-index"><p class="obs-plat-footnote">授权尚未确认，不返回该租户任务。</p></div>`;
    }
    if (!index.tasks.length) {
      return html`<div class="obs-task-index" data-testid="obs-task-index"><p class="obs-plat-footnote">当前筛选下没有可列出的任务。</p></div>`;
    }
    return html`<div class="obs-task-index" data-testid="obs-task-index">
      <ul class="obs-task-index__list">
        ${index.tasks.map((item) => {
          const run = this.indexItemToRun(item, view);
          const coverage = item.coverage ? formatLinkCoverage(item.coverage).value : "";
          const decided = Number.isFinite(Date.parse(item.decidedAt))
            ? new Date(item.decidedAt).toLocaleString("zh-CN", { hour12: false })
            : "";
          return html`<li>
            <button type="button" class="obs-task-index__item" data-task-id=${item.taskId} @click=${() => this.openIndexedTask(item, view)}>
              <strong>${item.taskId}</strong>
              <span>${item.agentId}${run.tenantLabel ? ` · ${run.tenantLabel}` : ""}${decided ? ` · ${decided}` : ""}${coverage && coverage !== "未知" ? ` · ${coverage}` : ""}</span>
            </button>
          </li>`;
        })}
      </ul>
      ${index.truncated ? html`<p class="obs-plat-footnote">仅显示最近一部分匹配任务。</p>` : nothing}
    </div>`;
  }
  private renderTenantGrantTable(view: ObservationView) {
    const rows = this.directoryEntries(view);
    const isSample = view.source === "sample";
    if (!rows.length) {
      return html`<section class="obs-plat-card obs-tenant-compare" data-testid="obs-tenant-compare" aria-label="租户隔离与授权">
        <div class="obs-plat-card__head"><div><h3>租户隔离与授权</h3></div></div>
        <div class="obs-empty obs-tenant-empty"><strong>${isSample ? "样例企业未启用" : "暂无企业目录摘要"}</strong><p>${isSample ? "切换到样例验收后应出现明确标注的样例企业。" : "近 7 天跨租户视图依赖目录摘要，不是事件回放。"}</p></div>
        <p class="obs-plat-footnote">${this.liveNote(view)}</p>
      </section>`;
    }
    return html`<section class="obs-plat-card obs-tenant-compare" data-testid="obs-tenant-compare" aria-label="租户隔离与授权">
      <div class="obs-plat-card__head"><div><h3>租户隔离与授权</h3></div></div>
      <div class="obs-tenant-table-wrap">
        <table class="obs-tenant-table">
          <thead><tr><th>租户</th><th>授权</th><th>覆盖</th><th>心跳</th><th>说明</th></tr></thead>
          <tbody>
            ${rows.map((entry) => {
              const grant = this.entryGrant(entry);
              const grantLabel =
                grant === "granted" ? "已授权" : grant === "none" ? "无授权" : "尚未确认";
              const tenantCode = visibleTenantCode(entry.label, entry.tenantId);
              const note = grant === "granted" ? "" : tenantGrantNote(grant, isSample);
              const tenantHeartbeat = this.firstScreenSnapshot()?.heartbeat?.tenants?.find(
                (row) => row.tenantId === entry.tenantId,
              ) ?? null;
              return html`<tr data-tenant-id=${entry.tenantId}>
                <td>${tenantDisplayName(entry.label, entry.tenantId)}${tenantCode ? html`<code>${tenantCode}</code>` : nothing}</td>
                <td><span class="obs-grant-chip is-${grant}">${grantLabel}</span></td>
                <td>${formatTenantCoverage(grant)}</td>
                <td>${formatTenantHeartbeat(grant, tenantHeartbeat)}</td>
                <td class="obs-plat-footnote">${note}</td>
              </tr>`;
            })}
          </tbody>
        </table>
      </div>
    </section>`;
  }
  private renderPlatformOverview(view: ObservationView, notice: string | null) {
    const page = this.platformPage;
    return html`
      <div class="obs-plat-toolbar">
        ${this.renderPlatformSubnav()}
      </div>
      ${notice ? html`<p class="obs-access-notice" data-testid="obs-access-notice">${notice}</p>` : nothing}
      ${
        view.source === "sample"
          ? html`
              <p class="obs-plat-footnote" data-testid="obs-sample-note">
                交互验收样例 · 样例验收已启用，不代表生产健康或改善结果。
              </p>
            `
          : nothing
      }
      ${
        page === "query"
          ? this.renderPreciseQuery(view)
          : page === "tenants"
            ? this.renderTenantGrantTable(view)
            : page === "capacity"
              ? this.renderPlatformCapacity()
              : html`
                  <div class="obs-plat-grid">
                    ${this.renderPlatformHealth(view)}
                    ${this.renderPreciseQuery(view)}
                  </div>
                  ${this.renderTenantGrantTable(view)}
                `
      }
    `;
  }
  render() {
    this.captureDrawerRequest();
    const view = this.updateStream(this.view());
    const runs = this.filteredRuns(view);
    const listRuns = this.applyMetricFilter(runs);
    const indexRuns = this.role === "platform" ? this.indexRunsForDrawer() : [];
    const drawerRuns = [...runs];
    for (const run of indexRuns) {
      if (!drawerRuns.some((row) => row.id === run.id)) {
        drawerRuns.push(run);
      }
    }
    const drawerAll = [...view.runs];
    for (const run of indexRuns) {
      if (!drawerAll.some((row) => row.id === run.id)) {
        drawerAll.push(run);
      }
    }
    // Re-resolve from the current authorized projection, never a stale drawer snapshot.
    const resolved = resolveDrawerSelection({
      access: this.accessInput(),
      runs: drawerRuns,
      allRuns: drawerAll,
      selectedId: this.selected?.id ?? null,
      requestedRunId: this.requestedRunId,
      expanded: this.expanded,
      requestedDrawer: this.requestedDrawer,
    });
    const selected = resolved.run;
    const showDrawer = Boolean(selected && resolved.expanded);
    const authorization = currentAuthorization(this.accessInput());
    // Current server-confirmed state wins; a previous unconfirmed/denied notice
    // must not linger after the tenant filter or grant result changes.
    const notice = authorization.ok ? resolved.notice : authorization.message;
    if (this.role === "platform") {
      return html`<div class="obs-workbench" id="observation-workbench" data-observation-source=${view.source} data-time-window=${this.timeWindow} data-tenant-filter=${this.tenantFilter}>
        ${this.renderPlatformOverview(view, notice)}
        ${showDrawer && selected ? this.renderEvidence(selected) : nothing}
      </div>`;
    }
    return html`<div class="obs-workbench" id="observation-workbench" data-observation-source=${view.source} data-time-window=${this.role === "platform" ? this.timeWindow : "enterprise"} data-tenant-filter=${this.tenantFilter}>
      <div class="obs-header"><div><h2>智能诊断</h2></div></div>
      ${this.renderTabs()}
      ${this.renderFilters(view)}
      ${notice ? html`<p class="obs-access-notice" data-testid="obs-access-notice">${notice}</p>` : nothing}
      ${this.surface === "overview" ? this.renderEnterpriseOverview(view, runs, selected) : this.surface === "analysis" ? this.renderAnalysis(view, listRuns, selected) : this.renderGovernance(view)}
      ${showDrawer && selected ? this.renderEvidence(selected) : nothing}
    </div>`;
  }
}
