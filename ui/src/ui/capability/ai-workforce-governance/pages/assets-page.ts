import { LitElement, html, css, nothing } from "lit";
import { customElement, state, property } from "lit/decorators.js";
import type { EnterprisePortReadModel } from "../../../ports/enterprise/semantic/enterprise-read-model.ts";
import type { AgentsListResult, CollaborationSpacesListResult } from "../../../types.ts";
import {
  adaptCreatorAssets,
  adaptMeshAssets,
  buildCreatorGovernanceActions,
} from "../runtime-adapter.ts";
import {
  fetchAssets,
  fetchGovernanceActions,
  executePendingAction,
} from "../services/governanceApi.ts";
import type {
  AssetListItem,
  AssetFilters,
  AssetSortConfig,
  PaginationState,
  GovernanceActionRecord,
} from "../types/index.ts";
import type { GovernanceUIState } from "../types/index.ts";

@customElement("governance-assets-page")
export class GovernanceAssetsPage extends LitElement {
  static styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
      font-family: var(--font-body);
    }

    /* ===== Layout ===== */
    .layout {
      width: 100%;
    }

    /* ===== TopNav ===== */
    .topnav {
      display: flex;
      align-items: center;
      padding: 4px 0 12px;
    }
    :host([embedmode]) .topnav {
      padding: 0 0 8px;
    }
    :host([embedmode]) .topnav-search {
      width: 100%;
      max-width: none;
      height: 32px;
    }
    .topnav-left {
      display: flex;
      align-items: center;
      gap: 24px;
    }
    .topnav-module {
      font-size: 16px;
      font-weight: 600;
      color: var(--text-strong);
    }
    .topnav-search {
      width: 320px;
      height: 36px;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: 0 12px;
      font-size: 14px;
      background: var(--card);
      color: var(--text);
      outline: none;
    }
    .topnav-search:focus {
      border-color: var(--accent);
    }

    /* ===== MainContainer ===== */
    .main {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .content {
      display: flex;
      gap: 24px;
    }
    .content-left {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    :host([embedmode]) .content-left {
      gap: 0;
    }
    /* ===== Card Base ===== */
    .card {
      background: var(--card);
      border: 1px solid color-mix(in srgb, var(--border) 55%, transparent);
      border-radius: var(--radius-md);
      padding: 16px;
      box-shadow: none;
    }
    :host([embedmode]) .card {
      background: transparent;
      border: 0;
      border-radius: 0;
      padding: 0;
    }
    :host([embedmode]) .card + .card {
      padding-top: 16px;
      border-top: 1px solid color-mix(in srgb, var(--border) 55%, transparent);
    }
    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }
    .card-title {
      font-size: 15px;
      font-weight: 600;
      color: var(--text-strong);
    }
    .queue-empty {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 0;
      padding: 8px 0;
      font-size: 13px;
      color: var(--muted);
    }
    .queue-empty__dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: color-mix(in srgb, var(--ok) 70%, var(--muted));
      flex-shrink: 0;
    }
    .card-link {
      font-size: 14px;
      color: var(--accent);
      cursor: pointer;
      background: none;
      border: none;
      padding: 0;
    }
    .card-link:hover {
      text-decoration: underline;
    }

    /* ===== GovernanceQueue ===== */
    .queue-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      border-radius: var(--radius-lg);
      margin-bottom: 12px;
      transition: background var(--duration-normal) var(--ease-out);
      cursor: pointer;
    }
    .queue-item:hover {
      background: var(--bg-hover);
    }
    .queue-item:last-child {
      margin-bottom: 0;
    }
    .queue-item-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .queue-icon {
      width: 40px;
      height: 40px;
      border-radius: var(--radius-md);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      flex-shrink: 0;
    }
    .queue-icon.high-risk {
      background: color-mix(in srgb, var(--danger) 15%, transparent);
      color: var(--danger);
    }
    .queue-icon.medium-risk {
      background: color-mix(in srgb, var(--warn) 15%, transparent);
      color: var(--warn);
    }
    .queue-icon.alert {
      background: color-mix(in srgb, var(--accent) 15%, transparent);
      color: var(--accent);
    }
    .queue-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .queue-name {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-strong);
    }
    .queue-desc {
      font-size: 12px;
      color: var(--muted);
    }
    .queue-action {
      padding: 6px 16px;
      border-radius: var(--radius-md);
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      border: none;
      transition: opacity var(--duration-normal) var(--ease-out);
    }
    .queue-action:hover {
      opacity: 0.8;
    }
    .queue-action.high-risk {
      background: var(--danger);
      color: var(--accent-foreground);
    }
    .queue-action.medium-risk {
      background: var(--warn);
      color: var(--accent-foreground);
    }
    .queue-action.alert {
      background: var(--accent);
      color: var(--accent-foreground);
    }

    /* ===== AssetTable ===== */
    .table-controls {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
      flex-wrap: wrap;
      gap: 12px;
    }
    .table-tabs {
      display: flex;
      gap: 4px;
    }
    .table-tab {
      padding: 6px 16px;
      border-radius: var(--radius-md);
      font-size: 14px;
      cursor: pointer;
      border: none;
      background: transparent;
      color: var(--muted);
      transition: all var(--duration-normal) var(--ease-out);
    }
    .table-tab:hover {
      background: var(--bg-hover);
    }
    .table-tab.active {
      background: var(--accent-subtle);
      color: var(--accent);
      font-weight: 600;
    }
    .table-search {
      width: 240px;
      height: 36px;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: 0 12px;
      font-size: 14px;
      background: var(--card);
      color: var(--text);
      outline: none;
    }
    .table-filters {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .filter-select {
      height: 36px;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: 0 12px;
      font-size: 14px;
      background: var(--card);
      color: var(--text);
      outline: none;
      cursor: pointer;
    }
    .table-wrapper {
      overflow-x: auto;
    }
    .data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
    }
    .data-table thead {
      background: var(--bg-muted);
    }
    .data-table th {
      padding: 12px 16px;
      text-align: left;
      font-weight: 600;
      color: var(--text);
      border-bottom: 1px solid var(--border);
      white-space: nowrap;
    }
    .data-table th.sortable {
      cursor: pointer;
      user-select: none;
    }
    .data-table th.sortable:hover {
      color: var(--accent, #c45c26);
    }
    .data-table th.sortable[aria-sort="ascending"]::after,
    .data-table th.sortable[aria-sort="descending"]::after {
      margin-left: 4px;
      font-size: 11px;
      color: var(--text-muted, #888);
    }
    .data-table th.sortable[aria-sort="ascending"]::after {
      content: "↑";
    }
    .data-table th.sortable[aria-sort="descending"]::after {
      content: "↓";
    }
    .data-table td {
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
      vertical-align: middle;
      white-space: nowrap;
    }
    .data-table tbody tr {
      transition: background var(--duration-normal) var(--ease-out);
    }
    .data-table tbody tr:hover {
      background: var(--bg-hover);
    }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: var(--radius-full);
      font-size: 12px;
      font-weight: 600;
    }
    .status-badge::before {
      content: "";
      width: 8px;
      height: 8px;
      border-radius: 50%;
      display: inline-block;
    }
    .status-normal {
      background: color-mix(in srgb, var(--ok) 15%, transparent);
      color: var(--ok);
    }
    .status-normal::before {
      background: var(--ok);
    }
    .status-risk {
      background: color-mix(in srgb, var(--warn) 15%, transparent);
      color: var(--warn);
    }
    .status-risk::before {
      background: var(--warn);
    }
    .status-paused {
      background: color-mix(in srgb, var(--warn) 15%, transparent);
      color: var(--warn);
    }
    .status-paused::before {
      content: "‖";
      width: auto;
      height: auto;
      border-radius: 0;
      background: transparent;
      font-size: 10px;
      font-weight: 700;
    }
    .status-error {
      background: color-mix(in srgb, var(--danger) 15%, transparent);
      color: var(--danger);
    }
    .status-error::before {
      background: var(--danger);
    }
    .asset-name {
      font-weight: 600;
      color: var(--text-strong);
    }
    .asset-meta {
      font-size: 12px;
      color: var(--muted);
    }
    /* owner cell rendered as an accent link (replaces a former inline color style) */
    .asset-owner-link {
      cursor: pointer;
      color: var(--accent);
    }
    .metrics-cell {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .metrics-item {
      font-size: 12px;
      color: var(--muted);
    }
    .score-star {
      color: var(--text-strong);
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .risk-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      display: inline-block;
      flex-shrink: 0;
    }
    .risk-dot.high-risk {
      background: var(--danger);
    }
    .risk-dot.medium-risk {
      background: var(--warn);
    }
    .risk-dot.alert {
      background: var(--accent);
    }
    .action-btn {
      padding: 4px 12px;
      border-radius: var(--radius-sm);
      font-size: 13px;
      cursor: pointer;
      border: 1px solid var(--border);
      background: var(--card);
      color: var(--text);
      transition: all var(--duration-normal) var(--ease-out);
    }
    .action-btn:hover {
      background: var(--bg-hover);
    }
    .pagination {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 8px;
      margin-top: 16px;
      padding-top: 16px;
      border-top: 1px solid var(--border);
    }
    .pagination-btn {
      padding: 6px 12px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border);
      background: var(--card);
      color: var(--text);
      cursor: pointer;
      font-size: 13px;
    }
    .pagination-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .pagination-btn:hover:not(:disabled) {
      background: var(--bg-hover);
    }
    .pagination-info {
      font-size: 13px;
      color: var(--muted);
    }

    .ranking-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 0;
      border-bottom: 1px solid var(--border);
    }
    .ranking-item:last-child {
      border-bottom: none;
    }
    .ranking-left {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .ranking-num {
      width: 24px;
      text-align: center;
      font-size: 13px;
      font-weight: 600;
      color: var(--muted);
    }
    .ranking-name {
      font-size: 14px;
      color: var(--text);
    }
    .ranking-score {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 14px;
      font-weight: 600;
      color: var(--warn);
    }
    .score-rank {
      display: inline-flex;
      align-items: center;
      margin-left: 8px;
      font-size: 12px;
      color: var(--muted);
    }

    /* ===== Drawer ===== */
    .drawer-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.3);
      z-index: 100;
      opacity: 0;
      visibility: hidden;
      transition: all var(--duration-slow) var(--ease-out);
    }
    .drawer-overlay.open {
      opacity: 1;
      visibility: visible;
    }
    .drawer {
      position: fixed;
      top: 0;
      right: 0;
      bottom: 0;
      width: 400px;
      background: var(--card);
      box-shadow: var(--shadow-lg);
      z-index: 101;
      transform: translateX(100%);
      transition: transform var(--duration-slow) var(--ease-out);
      display: flex;
      flex-direction: column;
    }
    .drawer.open {
      transform: translateX(0);
    }
    .drawer-header {
      padding: 20px 24px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .drawer-title {
      font-size: 16px;
      font-weight: 600;
      color: var(--text-strong);
    }
    .drawer-close {
      width: 32px;
      height: 32px;
      border-radius: var(--radius-md);
      border: none;
      background: var(--secondary);
      color: var(--text);
      cursor: pointer;
      font-size: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .drawer-close:hover {
      background: var(--bg-hover);
    }
    .drawer-body {
      flex: 1;
      padding: 24px;
      overflow-y: auto;
    }
    .drawer-section {
      margin-bottom: 24px;
    }
    .drawer-section-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--text);
      margin-bottom: 8px;
    }
    .drawer-section-content {
      font-size: 14px;
      color: var(--muted);
      line-height: 1.6;
    }
    .drawer-section-content ul {
      margin: 0;
      padding-left: 20px;
    }
    .drawer-section-content li {
      margin-bottom: 4px;
    }
    .drawer-actions {
      padding: 20px 24px;
      border-top: 1px solid var(--border);
      display: flex;
      gap: 12px;
    }
    .btn {
      flex: 1;
      padding: 10px 16px;
      border-radius: var(--radius-md);
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      border: none;
      transition: opacity var(--duration-normal) var(--ease-out);
      text-align: center;
    }
    .btn:hover {
      opacity: 0.9;
    }
    .btn-danger {
      background: var(--danger);
      color: var(--accent-foreground);
    }
    .btn-primary {
      background: var(--accent);
      color: var(--accent-foreground);
    }
    .btn-secondary {
      background: var(--secondary);
      color: var(--text);
      border: 1px solid var(--border);
    }

    /* ===== OwnerSidebar ===== */
    .sidebar-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.3);
      z-index: 100;
      opacity: 0;
      visibility: hidden;
      transition: all var(--duration-slow) var(--ease-out);
    }
    .sidebar-overlay.open {
      opacity: 1;
      visibility: visible;
    }
    .sidebar {
      position: fixed;
      top: 0;
      right: 0;
      bottom: 0;
      width: 320px;
      background: var(--card);
      box-shadow: var(--shadow-lg);
      z-index: 101;
      transform: translateX(100%);
      transition: transform var(--duration-slow) var(--ease-out);
      display: flex;
      flex-direction: column;
    }
    .sidebar.open {
      transform: translateX(0);
    }
    .sidebar-header {
      padding: 20px 24px;
      border-bottom: 1px solid var(--border);
    }
    .sidebar-name {
      font-size: 18px;
      font-weight: 600;
      color: var(--text-strong);
    }
    .sidebar-role {
      font-size: 14px;
      color: var(--muted);
      margin-top: 4px;
    }
    .sidebar-stats {
      padding: 20px 24px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      border-bottom: 1px solid var(--border);
    }
    .stat-item {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .stat-label {
      font-size: 12px;
      color: var(--muted);
    }
    .stat-value {
      font-size: 20px;
      font-weight: 700;
      color: var(--text-strong);
    }
    .sidebar-body {
      flex: 1;
      padding: 20px 24px;
      overflow-y: auto;
    }
    .sidebar-footer {
      padding: 20px 24px;
      border-top: 1px solid var(--border);
    }
    .sidebar-btn {
      width: 100%;
      padding: 10px 16px;
      border-radius: var(--radius-md);
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      border: 1px solid var(--border);
      background: var(--card);
      color: var(--text);
      text-align: center;
    }
    .sidebar-btn:hover {
      background: var(--bg-hover);
    }

    /* ===== Loading ===== */
    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 40px;
      color: var(--muted);
    }
    .empty {
      text-align: center;
      padding: 16px 12px;
      color: var(--muted);
      font-size: 13px;
    }
    .empty-error {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 16px 12px;
      color: var(--danger, #b42318);
      font-size: 13px;
    }
    .empty-error button {
      border: 1px solid var(--border);
      background: var(--card);
      color: var(--text);
      border-radius: var(--radius-md);
      padding: 4px 12px;
      font-size: 12px;
      cursor: pointer;
    }
    :host([embedmode]) .empty {
      padding: 8px 12px;
    }
    :host([embedmode]) .card {
      margin-bottom: 10px;
    }
    :host([embedmode]) .card-header {
      padding: 8px 12px;
    }

    .detail-kv {
      display: grid;
      gap: 0;
    }
    .detail-kv__row {
      display: grid;
      grid-template-columns: 96px 1fr;
      gap: 12px;
      padding: 8px 0;
      border-bottom: 1px solid var(--border);
      font-size: 13px;
    }
    .detail-kv__row:last-child {
      border-bottom: 0;
    }
    .detail-kv__label {
      color: var(--muted);
    }
    .detail-kv__value {
      color: var(--text-strong);
      font-weight: 500;
      word-break: break-word;
    }
    .detail-metrics {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      margin-top: 4px;
    }
    .detail-metrics__item {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 8px 10px;
      border-radius: var(--radius);
      background: var(--bg-hover, color-mix(in srgb, var(--border) 35%, transparent));
    }
    .detail-metrics__item span {
      font-size: 11px;
      color: var(--muted);
    }
    .detail-metrics__item strong {
      font-size: 14px;
      color: var(--text-strong);
    }
    .detail-hint {
      margin: 0;
      font-size: 12px;
      color: var(--muted);
      line-height: 1.45;
    }
  `;

  @property({ type: Object })
  state!: GovernanceUIState;

  @property({ attribute: false })
  readModel?: EnterprisePortReadModel;

  @property({ attribute: false })
  agentsList?: AgentsListResult | null;

  @property({ attribute: false })
  collaborationSpacesResult?: CollaborationSpacesListResult | null;

  /** When true, shell (Legacy mesh surface) owns Ops/Perf tabs — hide local tabs. */
  @property({ type: Boolean, reflect: true })
  embedMode = false;

  @state()
  private assets: AssetListItem[] = [];

  @state()
  private pagination: PaginationState = {
    page: 1,
    pageSize: 10,
    total: 0,
    totalPages: 1,
  };

  @state()
  private filters: AssetFilters = { type: "bot" };

  @state()
  private sort: AssetSortConfig = { field: "score", direction: "desc" };

  @state()
  private isLoading = true;

  @state()
  private loadError: string | null = null;

  @state()
  private actions: GovernanceActionRecord[] = [];

  @state()
  private drawerOpen = false;

  @state()
  private selectedAction: GovernanceActionRecord | null = null;

  @state()
  private sidebarOpen = false;

  @state()
  private selectedOwner: { name: string; position: string | null } | null = null;

  @state()
  private selectedAsset: AssetListItem | null = null;

  @state()
  private assetDetailOpen = false;

  @state()
  private searchQuery = "";

  @state()
  private actionError: string | null = null;

  /** Phase 1：机巢双 Tab — 运营 | 绩效 */
  @state()
  private meshWorkbenchTab: "operations" | "performance" = "operations";

  /** Deep-link 只读对象详情（/mesh/agents/:id 等） */
  @state()
  private readonlyDetail: {
    kind: "agent" | "group" | "person";
    id: string;
    label: string;
  } | null = null;

  connectedCallback() {
    super.connectedCallback();
    this.syncMeshDeepLinkFromLocation();
  }

  protected updated(changed: Map<string, unknown>) {
    if (
      changed.has("readModel") ||
      changed.has("agentsList") ||
      changed.has("collaborationSpacesResult")
    ) {
      void this.loadAssets();
      void this.loadActions();
      this.syncMeshDeepLinkFromLocation();
    }
  }

  /** Parse /mesh/agents|:groups|:people/:id — open read-only detail (no Prompt edit). */
  private syncMeshDeepLinkFromLocation() {
    if (typeof window === "undefined") {
      return;
    }
    const match = window.location.pathname.match(
      /\/mesh\/(?:overview\/)?(agents|groups|people)\/([^/]+)/i,
    );
    if (!match) {
      return;
    }
    const kindRaw = match[1]?.toLowerCase();
    const id = decodeURIComponent(match[2] ?? "").trim();
    if (!id || !kindRaw) {
      return;
    }
    const kind = kindRaw === "groups" ? "group" : kindRaw === "people" ? "person" : "agent";
    const fromAssets = this.assets.find((entry) => entry.id === id);
    const fromMesh =
      kind === "agent"
        ? this.readModel?.meshAgents.find((entry) => entry.agentId === id)
        : kind === "group"
          ? this.readModel?.meshGroups.find((entry) => entry.groupId === id)
          : this.readModel?.meshUsers.find((entry) => entry.user === id);
    const label =
      fromAssets?.name ||
      (fromMesh && "name" in fromMesh ? fromMesh.name : null) ||
      (fromMesh && "user" in fromMesh ? fromMesh.user : null) ||
      id;
    this.meshWorkbenchTab = "operations";
    this.readonlyDetail = { kind, id, label: String(label) };
  }

  private async loadAssets() {
    this.isLoading = true;
    this.loadError = null;
    try {
      if (this.embedMode) {
        if (!this.readModel) {
          this.assets = [];
          return;
        }
        const filtered = this.applyAssetFilters(adaptMeshAssets(this.readModel));
        const sorted = this.applyAssetSort(filtered);
        const paginated = this.paginateAssets(sorted);
        this.assets = paginated.items;
        this.pagination = paginated.pagination;
        return;
      }
      if (this.isRosterPending()) {
        this.assets = [];
        return;
      }
      const localAssets = this.resolveLocalAssets();
      if (localAssets != null && localAssets.length > 0) {
        const filtered = this.applyAssetFilters(localAssets);
        const sorted = this.applyAssetSort(filtered);
        const paginated = this.paginateAssets(sorted);
        this.assets = paginated.items;
        this.pagination = paginated.pagination;
        return;
      }
      const result = await fetchAssets(this.filters, this.pagination, this.sort);
      this.assets = result.items;
      this.pagination = result.pagination;
    } catch (e) {
      console.error("Failed to load assets:", e);
      this.loadError = e instanceof Error ? e.message : "资产同步失败";
      this.assets = [];
    } finally {
      this.isLoading = this.isRosterPending();
    }
  }

  private async loadActions() {
    try {
      if (this.embedMode) {
        const localAssets = this.readModel ? adaptMeshAssets(this.readModel) : [];
        this.actions = localAssets.length > 0 ? buildCreatorGovernanceActions(localAssets) : [];
        return;
      }
      const localAssets = this.resolveLocalAssets();
      if (localAssets != null && localAssets.length > 0) {
        this.actions = buildCreatorGovernanceActions(localAssets);
        return;
      }
      if (this.readModel) {
        this.actions = [];
        return;
      }
      this.actions = await fetchGovernanceActions({ status: "pending" });
    } catch (e) {
      console.error("Failed to load actions:", e);
    }
  }

  private handlePageChange(page: number) {
    this.pagination = { ...this.pagination, page };
    void this.loadAssets();
  }

  private handleSearch = (e: Event) => {
    const target = e.target as HTMLInputElement;
    this.searchQuery = target.value;
    this.filters = { ...this.filters, search: target.value };
    this.pagination = { ...this.pagination, page: 1 };
    void this.loadAssets();
  };

  private handleSort(field: AssetSortConfig["field"]) {
    const direction = this.sort.field === field && this.sort.direction === "desc" ? "asc" : "desc";
    this.sort = { field, direction };
    void this.loadAssets();
  }

  private handleFilterType(type: AssetFilters["type"]) {
    this.filters = { ...this.filters, type };
    this.pagination = { ...this.pagination, page: 1 };
    void this.loadAssets();
  }

  private handleFilterStatus(status: AssetFilters["status"]) {
    this.filters = { ...this.filters, status };
    this.pagination = { ...this.pagination, page: 1 };
    void this.loadAssets();
  }

  private handleFilterRisk(riskLevel: AssetFilters["riskLevel"]) {
    this.filters = { ...this.filters, riskLevel };
    this.pagination = { ...this.pagination, page: 1 };
    void this.loadAssets();
  }

  private openDrawer(action: GovernanceActionRecord) {
    this.selectedAction = action;
    this.actionError = null;
    this.drawerOpen = true;
  }

  private closeDrawer = () => {
    this.drawerOpen = false;
    this.selectedAction = null;
  };

  private confirmGovernanceAction(action: GovernanceActionRecord["action"]): boolean {
    const label =
      action === "pause" ? "暂停该 Bot" : action === "limit" ? "限制该 Bot 运行" : "标记为已处理";
    if (typeof window === "undefined" || typeof window.confirm !== "function") {
      return true;
    }
    return window.confirm(`确认${label}？这会立即改变该对象的运行或处置状态。`);
  }

  private async executeAction(actionId: string) {
    const action = this.selectedAction;
    if (action && !this.confirmGovernanceAction(action.action)) {
      return;
    }
    this.actionError = null;
    try {
      const ok = await executePendingAction(actionId);
      if (!ok) {
        this.actionError = "处理没有生效。请确认网关已连接后再试。";
        return;
      }
      await this.loadActions();
      this.closeDrawer();
    } catch (e) {
      console.error("Failed to execute action:", e);
      this.actionError = "处理没有生效。请确认网关已连接后再试。";
    }
  }

  private openSidebar(owner: string, position: string | null) {
    this.selectedOwner = { name: owner, position };
    this.sidebarOpen = true;
    this.assetDetailOpen = false;
    this.selectedAsset = null;
  }

  private closeSidebar = () => {
    this.sidebarOpen = false;
    this.selectedOwner = null;
  };

  private openAssetDetail(asset: AssetListItem) {
    this.selectedAsset = asset;
    this.assetDetailOpen = true;
    this.sidebarOpen = false;
    this.selectedOwner = null;
    this.readonlyDetail = null;
  }

  private closeAssetDetail = () => {
    this.assetDetailOpen = false;
    this.selectedAsset = null;
  };

  private statusLabel(status: AssetListItem["status"]): string {
    switch (status) {
      case "active":
        return "正常";
      case "paused":
        return "已暂停";
      case "error":
        return "异常";
      default:
        return status;
    }
  }

  private riskLabelText(risk: AssetListItem["riskLevel"]): string {
    switch (risk) {
      case "high":
        return "高";
      case "medium":
        return "中";
      default:
        return "低";
    }
  }

  private getRiskIconClass(action: GovernanceActionRecord): string {
    if (action.action === "pause" || action.action === "limit") {
      return "high-risk";
    }
    if (action.action === "notify_admin" || action.action === "recommend_optimization") {
      return "medium-risk";
    }
    return "alert";
  }

  private getRiskLabel(action: GovernanceActionRecord): string {
    switch (action.action) {
      case "pause":
        return "高风险";
      case "limit":
        return "高风险";
      case "notify_admin":
        return "中风险";
      case "recommend_optimization":
        return "中风险";
      default:
        return "提醒";
    }
  }

  private renderStatusBadge(status: AssetListItem["status"]) {
    const statusMap: Record<AssetListItem["status"], { class: string; text: string }> = {
      active: { class: "status-normal", text: "正常" },
      paused: { class: "status-paused", text: "已暂停" },
      error: { class: "status-error", text: "异常" },
    };
    const s = statusMap[status] ?? { class: "status-normal", text: status };
    return html`<span class="status-badge ${s.class}">${s.text}</span>`;
  }

  private isGroupView() {
    return this.filters.type === "group";
  }

  /** Embed mode waits only for the tenant read model, never for agents.list. */
  private isRosterPending(): boolean {
    if (!this.embedMode) {
      return false;
    }
    return !this.readModel;
  }

  private resolveCreatorAssets() {
    if (!this.readModel) {
      return null;
    }
    if (this.filters.type === "group") {
      if (!this.collaborationSpacesResult) {
        return null;
      }
    } else if (!this.agentsList) {
      return null;
    }
    return adaptCreatorAssets({
      readModel: this.readModel,
      agentsList: this.agentsList,
      collaborationSpacesResult: this.collaborationSpacesResult,
      includeSharedTeamScopes: this.embedMode,
    });
  }

  /**
   * Prefer creator-scoped gateway lists when present; otherwise project from
   * enterprise mesh readModel so the Ops table stays populated when agentsList
   * / collaborationSpacesResult are still loading or filtered empty.
   * Returns null when no local source is ready (caller may hit gateway).
   */
  private resolveLocalAssets(): AssetListItem[] | null {
    if (!this.readModel) {
      return null;
    }
    const creatorAssets = this.resolveCreatorAssets();
    const meshAssets = adaptMeshAssets(this.readModel);
    // Prefer the fuller mesh tenant roster when personal agents.list is a subset
    // (enterprise-admin personal seat must not gate Ops / mesh tables).
    if (
      meshAssets.length > 0 &&
      (creatorAssets == null || meshAssets.length > creatorAssets.length)
    ) {
      return meshAssets;
    }
    if (creatorAssets && creatorAssets.length > 0) {
      return creatorAssets;
    }
    if (meshAssets.length > 0) {
      return meshAssets;
    }
    // Creator still pending → null so loadAssets can wait or fetch gateway.
    if (creatorAssets === null) {
      return null;
    }
    return [];
  }

  private applyAssetFilters(items: AssetListItem[]) {
    return items.filter((asset) => {
      if (this.filters.type && asset.type !== this.filters.type) {
        return false;
      }
      if (this.filters.status && asset.status !== this.filters.status) {
        return false;
      }
      if (this.filters.riskLevel && asset.riskLevel !== this.filters.riskLevel) {
        return false;
      }
      if (this.filters.search) {
        const query = this.filters.search.toLowerCase();
        if (
          !asset.name.toLowerCase().includes(query) &&
          !(asset.position?.toLowerCase().includes(query) ?? false) &&
          !(asset.owner?.toLowerCase().includes(query) ?? false)
        ) {
          return false;
        }
      }
      return true;
    });
  }

  private applyAssetSort(items: AssetListItem[]) {
    return [...items].toSorted((left, right) => {
      let comparison = 0;
      switch (this.sort.field) {
        case "cost":
          comparison = left.metrics.totalCost - right.metrics.totalCost;
          break;
        case "task":
          comparison = left.metrics.taskCount - right.metrics.taskCount;
          break;
        case "success_rate":
        case "score":
          comparison =
            (left.score ?? left.metrics.successRate * 100) -
            (right.score ?? right.metrics.successRate * 100);
          if (comparison === 0) {
            comparison = left.metrics.successRate - right.metrics.successRate;
          }
          break;
        case "position":
          comparison = (left.position ?? "").localeCompare(right.position ?? "", "zh-CN");
          break;
        case "owner":
          comparison = (left.owner ?? "").localeCompare(right.owner ?? "", "zh-CN");
          break;
        case "name":
          comparison = left.name.localeCompare(right.name, "zh-CN");
          break;
        default:
          comparison = left.name.localeCompare(right.name, "zh-CN");
      }
      return this.sort.direction === "desc" ? -comparison : comparison;
    });
  }

  private sortAria(field: AssetSortConfig["field"]): "none" | "ascending" | "descending" {
    if (this.sort.field !== field) {
      return "none";
    }
    return this.sort.direction === "asc" ? "ascending" : "descending";
  }

  private renderSortableHeader(params: { field: AssetSortConfig["field"]; label: string }) {
    return html`
      <th
        class="sortable"
        aria-sort=${this.sortAria(params.field)}
        @click=${() => this.handleSort(params.field)}
      >
        ${params.label}
      </th>
    `;
  }

  private formatMeshCost(totalCost: number, taskCount: number): { total: string; perTask: string } {
    if (!(totalCost > 0)) {
      return { total: "$0", perTask: taskCount > 0 ? "$0.00" : "-" };
    }
    // Avoid toFixed(0) hiding sub-dollar totals as "$0".
    const total =
      totalCost >= 1
        ? `$${totalCost.toFixed(2)}`
        : `$${totalCost.toFixed(totalCost >= 0.01 ? 2 : 4)}`;
    const perTask = taskCount > 0 ? totalCost / taskCount : 0;
    const perTaskLabel =
      perTask >= 0.01 ? `$${perTask.toFixed(2)}` : perTask > 0 ? `$${perTask.toFixed(4)}` : "$0.00";
    return { total, perTask: perTaskLabel };
  }

  private paginateAssets(items: AssetListItem[]) {
    const total = items.length;
    const totalPages = Math.max(1, Math.ceil(total / this.pagination.pageSize));
    const page = Math.min(this.pagination.page, totalPages);
    const offset = (page - 1) * this.pagination.pageSize;
    return {
      items: items.slice(offset, offset + this.pagination.pageSize),
      pagination: {
        page,
        pageSize: this.pagination.pageSize,
        total,
        totalPages,
      },
    };
  }

  private renderTopNav() {
    return html`
      <div class="topnav">
        <div class="topnav-left">
          ${
            this.embedMode
              ? nothing
              : html`
                  <span class="topnav-module">机巢</span>
                  <div class="enterprise-rank-tabs" role="tablist" aria-label="机巢工作台">
                    <button
                      type="button"
                      role="tab"
                      class="table-tab ${this.meshWorkbenchTab === "operations" ? "active" : ""}"
                      aria-selected=${String(this.meshWorkbenchTab === "operations")}
                      @click=${() => {
                        this.meshWorkbenchTab = "operations";
                      }}
                    >
                      运营
                    </button>
                    <button
                      type="button"
                      role="tab"
                      class="table-tab ${this.meshWorkbenchTab === "performance" ? "active" : ""}"
                      aria-selected=${String(this.meshWorkbenchTab === "performance")}
                      @click=${() => {
                        this.meshWorkbenchTab = "performance";
                      }}
                    >
                      绩效
                    </button>
                  </div>
                `
          }
          <input
            class="topnav-search"
            type="text"
            placeholder="全局搜索..."
            .value=${this.searchQuery}
            @input=${this.handleSearch}
          />
        </div>
      </div>
    `;
  }

  private renderGovernanceQueue() {
    const pendingActions = this.actions.filter((a) => a.status === "pending");
    return html`
      <div class="card" data-mesh-panel="ops-anomaly-queue">
        <div class="card-header">
          <span class="card-title">运营异常</span>
          ${
            pendingActions.length > 0
              ? html`
                  <button class="card-link" @click=${() => this.handleFilterRisk("high")}>
                    查看全部
                  </button>
                `
              : html`<span class="asset-meta">${pendingActions.length} 项</span>`
          }
        </div>
        ${
          pendingActions.length === 0
            ? html`
                <div class="queue-empty">
                  <span class="queue-empty__dot" aria-hidden="true"></span>
                  <span>暂无待处理项</span>
                </div>
              `
            : pendingActions.map(
                (action) => html`
                <div class="queue-item" @click=${() => this.openDrawer(action)}>
                  <div class="queue-item-left">
                    <span
                      class="risk-dot ${this.getRiskIconClass(action)}"
                      aria-label=${this.getRiskLabel(action)}
                    ></span>
                    <div class="queue-info">
                      <span class="queue-name">${action.assetName}</span>
                      <span class="queue-desc">${action.reason}</span>
                    </div>
                  </div>
                  <button
                    class="queue-action ${this.getRiskIconClass(action)}"
                    @click=${(e: Event) => {
                      e.stopPropagation();
                      this.openDrawer(action);
                    }}
                  >
                    立即处理
                  </button>
                </div>
              `,
              )
        }
      </div>
    `;
  }

  private renderAssetTable() {
    return html`
      <div class="card">
        <div class="table-controls">
          <div class="table-tabs">
            <button
              class="table-tab ${this.filters.type === "bot" ? "active" : ""}"
              @click=${() => this.handleFilterType("bot")}
            >
              机器人
            </button>
            <button
              class="table-tab ${this.filters.type === "group" ? "active" : ""}"
              @click=${() => this.handleFilterType("group")}
            >
              协作小组
            </button>
          </div>
          <input
            class="table-search"
            type="text"
            placeholder="搜索机器人或协作小组…"
            .value=${this.searchQuery}
            @input=${this.handleSearch}
          />
          <div class="table-filters">
            <select
              class="filter-select"
              @change=${(e: Event) =>
                this.handleFilterStatus(
                  ((e.target as HTMLSelectElement).value || undefined) as
                    | AssetListItem["status"]
                    | undefined,
                )}
            >
              <option value="">所有状态</option>
              <option value="active">正常</option>
              <option value="paused">已暂停</option>
              <option value="error">异常</option>
            </select>
            <select
              class="filter-select"
              @change=${(e: Event) =>
                this.handleFilterRisk(
                  ((e.target as HTMLSelectElement).value || undefined) as
                    | AssetListItem["riskLevel"]
                    | undefined,
                )}
            >
              <option value="">所有风险</option>
              <option value="high">高风险</option>
              <option value="medium">中风险</option>
              <option value="low">低风险</option>
            </select>
            <button class="action-btn" @click=${() => this.handleSort("success_rate")}>
              评分 ${this.sort.field === "success_rate" ? (this.sort.direction === "desc" ? "↓" : "↑") : ""}
            </button>
          </div>
        </div>
        <div class="table-wrapper">
          <table class="data-table">
            <thead>
              <tr>
                <th>状态</th>
                ${this.renderSortableHeader({
                  field: "name",
                  label: this.isGroupView() ? "协作小组" : "机器人名称",
                })}
                ${
                  this.isGroupView()
                    ? html`
                        <th>成员数</th>
                      `
                    : this.renderSortableHeader({ field: "position", label: "岗位" })
                }
                ${this.renderSortableHeader({
                  field: "owner",
                  label: this.isGroupView() ? "创建人" : "负责人",
                })}
                ${this.renderSortableHeader({ field: "task", label: "运行指标" })}
                ${this.renderSortableHeader({ field: "cost", label: "月成本" })}
                ${this.renderSortableHeader({ field: "score", label: "排名 / 评分" })}
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              ${
                this.isLoading || this.isRosterPending()
                  ? html`
                      <tr>
                        <td colspan="8"><div class="loading">同步机器人与协作组…</div></td>
                      </tr>
                    `
                  : this.loadError
                    ? html`
                        <tr>
                          <td colspan="8">
                            <div class="empty-error">
                              <span>${this.loadError}</span>
                              <button type="button" @click=${() => void this.loadAssets()}>重试</button>
                            </div>
                          </td>
                        </tr>
                      `
                    : this.assets.length === 0
                      ? html`
                        <tr>
                          <td colspan="8">
                            <div class="empty">
                              ${
                                this.isGroupView()
                                  ? "暂无协作小组，可先在组织侧创建协作空间。"
                                  : "暂无机器人，确认企业已创建并同步机器人资产。"
                              }
                            </div>
                          </td>
                        </tr>
                      `
                      : this.assets.map(
                          (asset, index) => html`
                        <tr>
                          <td>${this.renderStatusBadge(asset.status)}</td>
                          <td>
                            <div class="asset-name">${asset.name}</div>
                          </td>
                          <td>
                            <span class="asset-meta">
                              ${this.isGroupView() ? `${asset.memberCount ?? 0} 人` : (asset.position ?? "-")}
                            </span>
                          </td>
                          <td>
                            <span
                              class="asset-meta asset-owner-link"
                              @click=${() => this.openSidebar(asset.owner ?? "未知", asset.position)}
                            >
                              ${asset.owner ?? "-"}
                            </span>
                          </td>
                          <td>
                            <div class="metrics-cell">
                              <span class="metrics-item">任务: ${asset.metrics.taskCount}</span>
                              <span class="metrics-item"
                                >成功率: ${
                                  asset.metrics.taskCount > 0
                                    ? `${(asset.metrics.successRate * 100).toFixed(0)}%`
                                    : "—"
                                }</span
                              >
                            </div>
                          </td>
                          <td>
                            ${(() => {
                              const cost = this.formatMeshCost(
                                asset.metrics.totalCost,
                                asset.metrics.taskCount,
                              );
                              return html`
                                <div class="metrics-cell">
                                  <span>${cost.total}</span>
                                  <span class="metrics-item">单任务 ${cost.perTask}</span>
                                </div>
                              `;
                            })()}
                          </td>
                          <td>
                            <span class="score-star">${asset.score ?? "-"}</span>
                            <span class="score-rank">#${index + 1}</span>
                          </td>
                          <td>
                            <button class="action-btn" @click=${() => this.openAssetDetail(asset)}>
                              查看
                            </button>
                          </td>
                        </tr>
                      `,
                        )
              }
            </tbody>
          </table>
        </div>
        ${
          this.pagination.totalPages > 1
            ? html`
              <div class="pagination">
                <button
                  class="pagination-btn"
                  ?disabled=${this.pagination.page <= 1}
                  @click=${() => this.handlePageChange(this.pagination.page - 1)}
                >
                  上一页
                </button>
                <span class="pagination-info">${this.pagination.page} / ${this.pagination.totalPages}</span>
                <button
                  class="pagination-btn"
                  ?disabled=${this.pagination.page >= this.pagination.totalPages}
                  @click=${() => this.handlePageChange(this.pagination.page + 1)}
                >
                  下一页
                </button>
              </div>
            `
            : ""
        }
      </div>
    `;
  }

  private renderDrawer() {
    if (!this.selectedAction) {
      return "";
    }

    const suggestions: Record<string, string[]> = {
      pause: ["检查任务模板配置", "确认Runtime连接状态", "查看运行日志排查错误"],
      limit: ["检查成本消耗明细", "优化任务执行频率", "审查模型调用配置"],
      notify_admin: ["关注成本变化趋势", "与负责人确认业务需求", "评估是否需要扩容"],
      recommend_optimization: ["查看性能分析报告", "优化提示词模板", "调整并发任务数"],
    };

    return html`
      <div class="drawer-overlay ${this.drawerOpen ? "open" : ""}" @click=${this.closeDrawer}></div>
      <div class="drawer ${this.drawerOpen ? "open" : ""}">
        <div class="drawer-header">
          <span class="drawer-title">${this.selectedAction.assetName}</span>
          <button class="drawer-close" @click=${this.closeDrawer}>×</button>
        </div>
        <div class="drawer-body">
          <div class="drawer-section">
            <div class="drawer-section-title">问题</div>
            <div class="drawer-section-content">${this.selectedAction.reason}</div>
          </div>
          <div class="drawer-section">
            <div class="drawer-section-title">建议</div>
            <div class="drawer-section-content">
              <ul>
                ${(suggestions[this.selectedAction.action] ?? ["请查看详情了解处理方案"]).map(
                  (s) => html`<li>${s}</li>`,
                )}
              </ul>
            </div>
          </div>
          <div class="drawer-section">
            <div class="drawer-section-title">触发方式</div>
            <div class="drawer-section-content">
              ${this.selectedAction.trigger === "auto_governance" ? "自动治理" : "手动标记"}
            </div>
          </div>
          ${
            this.actionError
              ? html`<p class="detail-hint" role="alert">${this.actionError}</p>`
              : nothing
          }
        </div>
        <div class="drawer-actions">
          <button
            class="btn btn-danger"
            @click=${() => this.executeAction(this.selectedAction!.id)}
          >
            ${
              this.selectedAction.action === "pause"
                ? "暂停Bot"
                : this.selectedAction.action === "limit"
                  ? "限制运行"
                  : "标记已处理"
            }
          </button>
          <button class="btn btn-secondary" @click=${this.closeDrawer}>取消</button>
        </div>
      </div>
    `;
  }

  private renderOwnerSidebar() {
    if (!this.selectedOwner) {
      return "";
    }

    const ownerAssets = this.assets.filter((a) => a.owner === this.selectedOwner!.name);

    return html`
      <div class="sidebar-overlay ${this.sidebarOpen ? "open" : ""}" @click=${this.closeSidebar}></div>
      <div class="sidebar ${this.sidebarOpen ? "open" : ""}">
        <div class="sidebar-header">
          <div class="sidebar-name">${this.selectedOwner.name}</div>
          <div class="sidebar-role">${this.selectedOwner.position ?? "未知岗位"}</div>
        </div>
        <div class="sidebar-stats">
          <div class="stat-item">
            <span class="stat-label">机器人</span>
            <span class="stat-value">${ownerAssets.filter((a) => a.type === "bot").length}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">协作组</span>
            <span class="stat-value">${ownerAssets.filter((a) => a.type === "group").length}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">总任务</span>
            <span class="stat-value">${ownerAssets.reduce((sum, a) => sum + a.metrics.taskCount, 0)}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">月成本</span>
            <span class="stat-value">$${ownerAssets.reduce((sum, a) => sum + a.metrics.totalCost, 0).toFixed(0)}</span>
          </div>
        </div>
        <div class="sidebar-body">
          <div class="drawer-section-title">资产列表</div>
          ${ownerAssets.map(
            (asset) => html`
              <div class="ranking-item">
                <span class="ranking-name">${asset.name}</span>
                <span class="asset-meta"
                  >${
                    asset.status === "active" ? (asset.riskLevel === "high" ? "🟡" : "🟢") : "🔴"
                  }</span
                >
              </div>
            `,
          )}
        </div>
        <div class="sidebar-footer">
          <button class="sidebar-btn" @click=${this.closeSidebar}>关闭</button>
        </div>
      </div>
    `;
  }

  private renderPerformanceTab() {
    const summary = this.readModel?.meshSummary;
    return html`
      <div class="card">
        <div class="card-header">
          <span class="card-title">绩效概览</span>
        </div>
        <div class="sidebar-stats">
          <div class="stat-item">
            <span class="stat-label">机器人</span>
            <span class="stat-value">${summary?.agentCount ?? this.assets.filter((a) => a.type === "bot").length}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">协作组</span>
            <span class="stat-value">${summary?.groupCount ?? this.assets.filter((a) => a.type === "group").length}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">会话</span>
            <span class="stat-value">${summary?.sessionCount ?? "-"}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">成本（企业）</span>
            <span class="stat-value">$${(summary?.totalCost ?? 0).toFixed(0)}</span>
          </div>
        </div>
        <div class="drawer-section-content" style="padding: 12px 0 0">
          成长速度（企业）与排行榜将在 Phase 4 挂载；此处仅提供绩效 Tab 骨架。能力统计为只读企业视角，不含员工端安装/启停。
        </div>
      </div>
      ${this.renderAssetTable()}
    `;
  }

  private renderAssetDetailBody(asset: AssetListItem) {
    const kindLabel = asset.type === "group" ? "协作小组" : "机器人";
    return html`
      <div class="drawer-section">
        <div class="drawer-section-title">基本信息</div>
        <div class="detail-kv">
          <div class="detail-kv__row">
            <span class="detail-kv__label">类型</span>
            <span class="detail-kv__value">${kindLabel}</span>
          </div>
          <div class="detail-kv__row">
            <span class="detail-kv__label">名称</span>
            <span class="detail-kv__value">${asset.name}</span>
          </div>
          <div class="detail-kv__row">
            <span class="detail-kv__label">状态</span>
            <span class="detail-kv__value">${this.statusLabel(asset.status)}</span>
          </div>
          <div class="detail-kv__row">
            <span class="detail-kv__label">${asset.type === "group" ? "成员数" : "岗位"}</span>
            <span class="detail-kv__value">
              ${
                asset.type === "group"
                  ? `${asset.memberCount ?? 0} 人`
                  : (asset.position ?? "未分配岗位")
              }
            </span>
          </div>
          <div class="detail-kv__row">
            <span class="detail-kv__label">${asset.type === "group" ? "创建人" : "负责人"}</span>
            <span class="detail-kv__value">${asset.owner ?? "未知"}</span>
          </div>
          <div class="detail-kv__row">
            <span class="detail-kv__label">风险</span>
            <span class="detail-kv__value">${this.riskLabelText(asset.riskLevel)}</span>
          </div>
          <div class="detail-kv__row">
            <span class="detail-kv__label">评分</span>
            <span class="detail-kv__value">${asset.score ?? "-"}</span>
          </div>
          <div class="detail-kv__row">
            <span class="detail-kv__label">资产 ID</span>
            <span class="detail-kv__value">${asset.id}</span>
          </div>
        </div>
      </div>
      <div class="drawer-section">
        <div class="drawer-section-title">运行指标（只读）</div>
        <div class="detail-metrics">
          <div class="detail-metrics__item">
            <span>任务数</span>
            <strong>${asset.metrics.taskCount}</strong>
          </div>
          <div class="detail-metrics__item">
            <span>成功率</span>
            <strong>${(asset.metrics.successRate * 100).toFixed(0)}%</strong>
          </div>
          <div class="detail-metrics__item">
            <span>月成本</span>
            <strong>$${asset.metrics.totalCost.toFixed(2)}</strong>
          </div>
          <div class="detail-metrics__item">
            <span>总成本（累积）</span>
            <strong>$${(asset.metrics.lifetimeCost ?? asset.metrics.totalCost).toFixed(2)}</strong>
          </div>
          <div class="detail-metrics__item">
            <span>单任务成本（月）</span>
            <strong>$${(asset.metrics.avgCostPerTask ?? 0).toFixed(3)}</strong>
          </div>
        </div>
      </div>
      <div class="drawer-section">
        <p class="detail-hint">
          机巢仅提供运营/绩效只读视图，不支持编辑 Identity / Prompt，也不提供 Skill 安装或启停。
        </p>
      </div>
    `;
  }

  private renderAssetDetailDrawer() {
    if (!this.selectedAsset || !this.assetDetailOpen) {
      return nothing;
    }
    const asset = this.selectedAsset;
    const kindLabel = asset.type === "group" ? "协作小组" : "机器人";
    return html`
      <div class="drawer-overlay open" @click=${this.closeAssetDetail}></div>
      <div class="drawer open" role="dialog" aria-label="资产运营详情">
        <div class="drawer-header">
          <span class="drawer-title">${kindLabel} · ${asset.name}</span>
          <button class="drawer-close" @click=${this.closeAssetDetail}>×</button>
        </div>
        <div class="drawer-body">${this.renderAssetDetailBody(asset)}</div>
        <div class="drawer-actions">
          <button class="btn btn-secondary" @click=${this.closeAssetDetail}>关闭</button>
        </div>
      </div>
    `;
  }

  private renderReadonlyDetailDrawer() {
    if (!this.readonlyDetail || this.assetDetailOpen) {
      return nothing;
    }
    const detail = this.readonlyDetail;
    const fromAssets = this.assets.find((entry) => entry.id === detail.id);
    if (fromAssets) {
      return html`
        <div
          class="drawer-overlay open"
          @click=${() => {
            this.readonlyDetail = null;
          }}
        ></div>
        <div class="drawer open" role="dialog" aria-label="机巢只读详情">
          <div class="drawer-header">
            <span class="drawer-title"
              >${detail.kind === "group" ? "协作小组" : "机器人"} · ${fromAssets.name}</span
            >
            <button
              class="drawer-close"
              @click=${() => {
                this.readonlyDetail = null;
              }}
            >
              ×
            </button>
          </div>
          <div class="drawer-body">${this.renderAssetDetailBody(fromAssets)}</div>
          <div class="drawer-actions">
            <button
              class="btn btn-secondary"
              @click=${() => {
                this.readonlyDetail = null;
              }}
            >
              关闭
            </button>
          </div>
        </div>
      `;
    }
    const kindLabel =
      detail.kind === "agent" ? "机器人" : detail.kind === "group" ? "协作组" : "员工";
    const meshAgent =
      detail.kind === "agent"
        ? this.readModel?.meshAgents.find((entry) => entry.agentId === detail.id)
        : null;
    const meshGroup =
      detail.kind === "group"
        ? this.readModel?.meshGroups.find((entry) => entry.groupId === detail.id)
        : null;
    return html`
      <div
        class="drawer-overlay open"
        @click=${() => {
          this.readonlyDetail = null;
        }}
      ></div>
      <div class="drawer open" role="dialog" aria-label="机巢只读详情">
        <div class="drawer-header">
          <span class="drawer-title">${kindLabel} · ${detail.label}</span>
          <button
            class="drawer-close"
            @click=${() => {
              this.readonlyDetail = null;
            }}
          >
            ×
          </button>
        </div>
        <div class="drawer-body">
          <div class="drawer-section">
            <div class="drawer-section-title">基本信息</div>
            <div class="detail-kv">
              <div class="detail-kv__row">
                <span class="detail-kv__label">名称</span>
                <span class="detail-kv__value">${detail.label}</span>
              </div>
              <div class="detail-kv__row">
                <span class="detail-kv__label">ID</span>
                <span class="detail-kv__value">${detail.id}</span>
              </div>
              ${
                meshAgent
                  ? html`
                      <div class="detail-kv__row">
                        <span class="detail-kv__label">岗位</span>
                        <span class="detail-kv__value"
                          >${meshAgent.ownership.positionLabel || "未分配岗位"}</span
                        >
                      </div>
                      <div class="detail-kv__row">
                        <span class="detail-kv__label">负责人</span>
                        <span class="detail-kv__value"
                          >${
                            meshAgent.ownership.currentManagerLabel ||
                            meshAgent.creatorLabel ||
                            "未知"
                          }</span
                        >
                      </div>
                    `
                  : nothing
              }
              ${
                meshGroup
                  ? html`
                      <div class="detail-kv__row">
                        <span class="detail-kv__label">创建人</span>
                        <span class="detail-kv__value"
                          >${
                            meshGroup.ownership.createdByUserLabel ||
                            meshGroup.creatorLabel ||
                            "未知"
                          }</span
                        >
                      </div>
                    `
                  : nothing
              }
            </div>
          </div>
          <div class="drawer-section">
            <p class="detail-hint">
              机巢仅提供运营/绩效只读视图，不支持编辑 Identity / Prompt，也不提供 Skill 安装或启停。
            </p>
          </div>
        </div>
        <div class="drawer-actions">
          <button
            class="btn btn-secondary"
            @click=${() => {
              this.readonlyDetail = null;
            }}
          >
            关闭
          </button>
        </div>
      </div>
    `;
  }

  render() {
    return html`
      <div class="layout">
        <div class="main">
          <div class="content">
            <div class="content-left">
              ${
                this.embedMode || this.meshWorkbenchTab === "operations"
                  ? html`
                      ${this.renderGovernanceQueue()}
                      ${this.renderAssetTable()}
                    `
                  : this.renderPerformanceTab()
              }
            </div>
          </div>
        </div>
      </div>
      ${this.renderDrawer()}
      ${this.renderOwnerSidebar()}
      ${this.renderAssetDetailDrawer()}
      ${this.renderReadonlyDetailDrawer()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "governance-assets-page": GovernanceAssetsPage;
  }
}
