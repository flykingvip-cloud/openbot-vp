/**
 * Incremental read for `erp-yonyou-tplus`.
 *
 * Pages the registered QueryPage / FindVoucherList handlers and stores a
 * per-source watermark plus sync-log rows on the tenant enterprise-data store.
 * A finished window advances the watermark. A failed or truncated window does not.
 *
 * Inventory / partner (master QueryPage): the first sync with no watermark omits
 * `UpdateDateBegin`/`UpdateDateEnd` so the full archive pages in (same idea as
 * warehouse catalog semantics). Later runs keep the UpdateDate incremental
 * window from the watermark. A bare LOOKBACK on first sync would return empty
 * Data[] for archives that have not changed recently, then advance the
 * watermark and permanently skip them.
 *
 * Projection materialization calls `applyYonyouTplusSyncCursorToInput` so a
 * governed read of inventory, partner, sale delivery, or sale order uses the
 * same cursor window. Warehouse Query has no documented date filter
 * (https://open.chanjet.com/docs/file/apiFile/tcloud/t+jcda/t+ck): the body is
 * `{param:{}}` or `SelectFields`, so that stream is one bounded catalog read
 * fingerprinted by Code/Name/Ts. QueryPage and FindVoucherList do not document
 * `?idMarketingOrgan=`.
 *
 * Pagination: QueryPage uses PAGE_SIZE=100. Incremental UpdateDate / voucher
 * windows keep a tight MAX_PAGES_RANGE (default 5). First/full master pulls
 * (no watermark) use MAX_PAGES_FULL (default 500) so archives larger than 100
 * rows can finish and advance the watermark. Override with
 * OPENBOT_ENTERPRISE_DATA_YONYOU_TPLUS_MAX_PAGES or
 * OPENBOT_ENTERPRISE_DATA_YONYOU_TPLUS_MAX_PAGES_FULL.
 */

import { createHash, randomUUID } from "node:crypto";
import { YONYOU_TPLUS_CONNECTOR_ID } from "./adapters/yonyou-tplus-oauth.js";
import {
  executeYonyouTplusHandler,
  probeYonyouTplusConnection,
  YONYOU_TPLUS_DEFAULT_PAGE_SIZE,
  YONYOU_TPLUS_HANDLERS,
  YONYOU_TPLUS_INVENTORY_SELECT_FIELDS,
  YONYOU_TPLUS_PARTNER_SELECT_FIELDS,
  type YonyouTplusProbeContext,
} from "./adapters/yonyou-tplus.js";
import { loadCredentialSecret } from "./connector-credential-vault.js";
import type {
  ConnectorSyncCursor,
  ConnectorSyncLogEntry,
  ConnectorSyncLogStatus,
  DataConnectorCredentialSecret,
  DataSource,
  EnterpriseDataStore,
  ScopeEvaluationResult,
} from "./types.js";
import { extractYonyouTplusRows, yonyouTplusPayloadBody } from "./yonyou-tplus-rows.js";

const LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const PAGE_SIZE = YONYOU_TPLUS_DEFAULT_PAGE_SIZE;
/** Incremental UpdateDate / voucher windows: keep a tight page budget. */
const MAX_PAGES_RANGE_DEFAULT = 5;
/**
 * First/full master QueryPage (no UpdateDate window). 500×100 ≈ 50k rows —
 * enough for typical inventory/partner archives without unbounded loops.
 */
const MAX_PAGES_FULL_DEFAULT = 500;
const LOG_KEEP = 40;
/** Warehouse Query returns the whole catalog in one response. Above this, refuse to store a fingerprint. */
const WAREHOUSE_ROW_CAP = 500;
const WAREHOUSE_SELECT_FIELDS = "ID,Code,Name,Ts";

const READ_SCOPE: ScopeEvaluationResult = {
  scopeType: "ALL",
  resolvedValues: {},
  appliedFilters: [],
  scopeAppliedLabel: "ALL",
};

type StreamKind = "master" | "voucher" | "catalog";

type SyncStream = {
  streamKey: string;
  title: string;
  handlerRef: string;
  kind: StreamKind;
  voucherPrefix?: "SaleOrder" | "SaleDelivery";
  actionKey?: string;
};

const SYNC_STREAMS: SyncStream[] = [
  {
    streamKey: "inventory",
    title: "存货",
    handlerRef: YONYOU_TPLUS_HANDLERS.inventory,
    kind: "master",
    actionKey: "erp.inventory.query_page",
  },
  {
    streamKey: "partner",
    title: "往来单位",
    handlerRef: YONYOU_TPLUS_HANDLERS.partner,
    kind: "master",
    actionKey: "erp.partner.query_page",
  },
  {
    streamKey: "warehouse",
    title: "仓库",
    handlerRef: YONYOU_TPLUS_HANDLERS.warehouse,
    kind: "catalog",
    actionKey: "erp.warehouse.query",
  },
  {
    streamKey: "sale_delivery",
    title: "销货单",
    handlerRef: YONYOU_TPLUS_HANDLERS.saleDelivery,
    kind: "voucher",
    voucherPrefix: "SaleDelivery",
    actionKey: "erp.sale_delivery.query_list",
  },
  {
    streamKey: "sale_order",
    title: "销售订单",
    handlerRef: YONYOU_TPLUS_HANDLERS.saleOrder,
    kind: "voucher",
    voucherPrefix: "SaleOrder",
    actionKey: "erp.sale_order.query_list",
  },
];

export type YonyouTplusSyncStreamResult = {
  streamKey: string;
  title: string;
  status: ConnectorSyncLogStatus;
  recordCount: number;
  /** True when this run called Chanjet for the stream, including a truncated window. */
  pulled: boolean;
  watermark?: string;
  advanced: boolean;
  detail: string;
};

export type YonyouTplusSyncResult = {
  status: ConnectorSyncLogStatus;
  summary: string;
  streams: YonyouTplusSyncStreamResult[];
};

export type YonyouTplusSyncParams = {
  store: EnterpriseDataStore;
  tenantId: string;
  sourceId: string;
  now?: Date;
  vaultPath?: string;
  messageStorePath?: string;
  loadSecret?: (credentialId: string) => Promise<DataConnectorCredentialSecret | null>;
};

const syncLocks = new Map<string, Promise<YonyouTplusSyncResult>>();

function pad(value: number): string {
  return value < 10 ? `0${value}` : `${value}`;
}

export function formatYonyouTplusDateTime(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

export function formatYonyouTplusDate(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function cursorId(sourceId: string, streamKey: string): string {
  return `${sourceId}::${streamKey}`;
}

function cursors(store: EnterpriseDataStore): Record<string, ConnectorSyncCursor> {
  store.connectorSyncCursors ??= {};
  return store.connectorSyncCursors;
}

function logs(store: EnterpriseDataStore): Record<string, ConnectorSyncLogEntry> {
  store.connectorSyncLogEntries ??= {};
  return store.connectorSyncLogEntries;
}

export function listConnectorSyncLogEntries(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  sourceId: string;
  limit?: number;
}): ConnectorSyncLogEntry[] {
  return Object.values(params.store.connectorSyncLogEntries ?? {})
    .filter((entry) => entry.tenantId === params.tenantId && entry.sourceId === params.sourceId)
    .toSorted((left, right) => right.recordedAt.localeCompare(left.recordedAt))
    .slice(0, params.limit ?? 50);
}

function readWatermark(
  store: EnterpriseDataStore,
  tenantId: string,
  sourceId: string,
  streamKey: string,
): string | undefined {
  const cursor = cursors(store)[cursorId(sourceId, streamKey)];
  if (!cursor || cursor.tenantId !== tenantId || cursor.sourceId !== sourceId) {
    return undefined;
  }
  return cursor.watermark;
}

function writeWatermark(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  sourceId: string;
  streamKey: string;
  watermark: string;
  nowIso: string;
}): void {
  const id = cursorId(params.sourceId, params.streamKey);
  cursors(params.store)[id] = {
    cursorId: id,
    tenantId: params.tenantId,
    sourceId: params.sourceId,
    streamKey: params.streamKey,
    watermark: params.watermark,
    updatedAt: params.nowIso,
  };
}

function trimLogs(store: EnterpriseDataStore, tenantId: string, sourceId: string): void {
  const bucket = logs(store);
  const extras = Object.values(bucket)
    .filter((entry) => entry.tenantId === tenantId && entry.sourceId === sourceId)
    .toSorted((left, right) => right.recordedAt.localeCompare(left.recordedAt))
    .slice(LOG_KEEP);
  for (const extra of extras) {
    delete bucket[extra.entryId];
  }
}

function appendLog(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  source: DataSource;
  streamKey: string;
  title: string;
  status: ConnectorSyncLogStatus;
  detail: string;
  recordCount: number;
  watermark?: string;
  nowIso: string;
}): ConnectorSyncLogEntry {
  const entry: ConnectorSyncLogEntry = {
    entryId: randomUUID(),
    tenantId: params.tenantId,
    sourceId: params.source.sourceId,
    connectorId: params.source.connectorId,
    streamKey: params.streamKey,
    status: params.status,
    title: params.title,
    detail: params.detail,
    recordCount: params.recordCount,
    watermark: params.watermark,
    recordedAt: params.nowIso,
  };
  logs(params.store)[entry.entryId] = entry;
  trimLogs(params.store, params.tenantId, params.source.sourceId);
  return entry;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function arrayLength(value: unknown): number | null {
  return Array.isArray(value) ? value.length : null;
}

function rowCountFromBody(body: unknown): number {
  const direct = arrayLength(body);
  if (direct != null) {
    return direct;
  }
  const record = objectRecord(body);
  if (!record) {
    return 0;
  }
  const nested = [record, objectRecord(record.data), objectRecord(record.result)];
  for (const candidate of nested) {
    if (!candidate) {
      continue;
    }
    const rows =
      arrayLength(candidate.Data) ?? arrayLength(candidate.Rows) ?? arrayLength(candidate.rows);
    if (rows != null) {
      return rows;
    }
  }
  return 0;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function pageIsComplete(body: unknown, rows: number): boolean {
  if (rows < PAGE_SIZE) {
    return true;
  }
  const record = objectRecord(body);
  const nested = record ? [record, objectRecord(record.data), objectRecord(record.result)] : [];
  for (const candidate of nested) {
    if (!candidate) {
      continue;
    }
    const totalPage = finiteNumber(candidate.TotalPage) ?? finiteNumber(candidate.TotalPageNum);
    const current = finiteNumber(candidate.CurrentPage);
    if (totalPage != null && current != null) {
      return current >= totalPage;
    }
    if (totalPage != null) {
      return totalPage <= 1;
    }
  }
  return false;
}

type DateWindow = { mode: "range"; begin: string; end: string } | { mode: "full"; end: string };

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) {
    return fallback;
  }
  const value = Number(raw.trim());
  if (!Number.isFinite(value) || value < 1) {
    return fallback;
  }
  return Math.floor(value);
}

function maxPagesForWindow(window: DateWindow): number {
  if (window.mode === "full") {
    return parsePositiveInt(
      process.env.OPENBOT_ENTERPRISE_DATA_YONYOU_TPLUS_MAX_PAGES_FULL,
      MAX_PAGES_FULL_DEFAULT,
    );
  }
  return parsePositiveInt(
    process.env.OPENBOT_ENTERPRISE_DATA_YONYOU_TPLUS_MAX_PAGES,
    MAX_PAGES_RANGE_DEFAULT,
  );
}

function windowFor(
  kind: "master" | "voucher",
  now: Date,
  watermark: string | undefined,
): DateWindow {
  const end = kind === "master" ? formatYonyouTplusDateTime(now) : formatYonyouTplusDate(now);
  if (watermark && watermark <= end) {
    const begin = kind === "voucher" ? watermark.slice(0, 10) : watermark;
    if (begin <= end) {
      return { mode: "range", begin, end };
    }
  }
  if (watermark && watermark > end) {
    return { mode: "range", begin: end, end };
  }
  // No watermark: master archives page without UpdateDate (full QueryPage).
  // Voucher lists still need a bounded VoucherDate lookback.
  if (kind === "master") {
    return { mode: "full", end };
  }
  const start = new Date(now.getTime() - LOOKBACK_MS);
  return { mode: "range", begin: formatYonyouTplusDate(start), end };
}

function windowLabel(window: DateWindow): string {
  if (window.mode === "full") {
    return "全量（无 UpdateDate 窗）";
  }
  return `${window.begin} 至 ${window.end}`;
}

function masterSelectFields(stream: SyncStream): string | undefined {
  if (stream.streamKey === "inventory") {
    return YONYOU_TPLUS_INVENTORY_SELECT_FIELDS;
  }
  if (stream.streamKey === "partner") {
    return YONYOU_TPLUS_PARTNER_SELECT_FIELDS;
  }
  return undefined;
}

function streamInput(
  stream: SyncStream,
  window: DateWindow,
  pageIndex: number,
): Record<string, unknown> {
  if (stream.kind === "master") {
    const param: Record<string, unknown> = {
      PageSize: `${PAGE_SIZE}`,
      PageIndex: `${pageIndex}`,
    };
    const selectFields = masterSelectFields(stream);
    if (selectFields) {
      param.SelectFields = selectFields;
    }
    if (window.mode === "range") {
      param.UpdateDateBegin = window.begin;
      param.UpdateDateEnd = window.end;
    }
    return { param };
  }
  if (window.mode !== "range") {
    throw new Error("用友 T+ 单据同步需要日期窗口");
  }
  const prefix = stream.voucherPrefix ?? "SaleOrder";
  return {
    pageSize: PAGE_SIZE,
    pageIndex,
    paramDic: {
      [`${prefix}.VoucherDate`]: [
        { text: window.begin, value: window.begin },
        { text: window.end, value: window.end },
      ],
    },
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "用友 T+ 同步失败";
}

function textField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

/** Stable catalog fingerprint. Ts is a documented return field, not a request filter. */
export function yonyouTplusCatalogWatermark(rows: unknown[]): string {
  const parts = rows
    .map((row) => {
      const record = objectRecord(row);
      if (!record) {
        return "";
      }
      const code = textField(record, "Code") || textField(record, "code");
      const name = textField(record, "Name") || textField(record, "name");
      const ts = textField(record, "Ts") || textField(record, "ts");
      if (!code && !name && !ts) {
        return "";
      }
      return `${code}|${name}|${ts}`;
    })
    .filter((part) => part.length > 0)
    .toSorted();
  const digest = createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 16);
  return `catalog:${digest}`;
}

function inputRecord(
  input: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | null {
  const value = input?.[key];
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function overlayMissing(
  base: Record<string, unknown> | undefined,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const current = next[key];
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      current &&
      typeof current === "object" &&
      !Array.isArray(current)
    ) {
      next[key] = overlayMissing(
        current as Record<string, unknown>,
        value as Record<string, unknown>,
      );
      continue;
    }
    if (current === undefined) {
      next[key] = value;
    }
  }
  return next;
}

function projectionStream(actionKey: string): SyncStream | undefined {
  return SYNC_STREAMS.find((stream) => stream.actionKey === actionKey && stream.kind !== "catalog");
}

function inputHasWindow(input: Record<string, unknown> | undefined, stream: SyncStream): boolean {
  if (stream.kind === "master") {
    const param = inputRecord(input, "param");
    return Boolean(param && ("UpdateDateBegin" in param || "UpdateDateEnd" in param));
  }
  if (stream.kind === "voucher") {
    const paramDic = inputRecord(input, "paramDic");
    const key = `${stream.voucherPrefix ?? "SaleOrder"}.VoucherDate`;
    return Boolean(paramDic && key in paramDic);
  }
  return false;
}

/**
 * Fill a projection read with the sync cursor window for inventory, partner,
 * sale delivery, or sale order. An explicit date window on the input is kept.
 * Warehouse stays a catalog read and is not rewritten here.
 */
export function applyYonyouTplusSyncCursorToInput(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  sourceId?: string;
  connectorId: string;
  actionKey: string;
  input?: Record<string, unknown>;
  now?: Date;
}): Record<string, unknown> | undefined {
  if (params.connectorId !== YONYOU_TPLUS_CONNECTOR_ID) {
    return params.input;
  }
  const stream = projectionStream(params.actionKey);
  if (!stream || stream.kind === "catalog") {
    return params.input;
  }
  if (inputHasWindow(params.input, stream)) {
    return params.input;
  }
  const sourceId = params.sourceId?.trim();
  const stored = sourceId
    ? readWatermark(params.store, params.tenantId, sourceId, stream.streamKey)
    : undefined;
  const watermark = stored && !stored.startsWith("catalog:") ? stored : undefined;
  const now = params.now ?? new Date();
  const range = windowFor(stream.kind, now, watermark);
  const pageIndex = stream.kind === "master" ? 1 : 0;
  return overlayMissing(params.input, streamInput(stream, range, pageIndex));
}

async function pullStream(params: {
  stream: SyncStream;
  secret: DataConnectorCredentialSecret;
  context: YonyouTplusProbeContext;
  window: DateWindow;
}): Promise<{ recordCount: number; truncated: boolean }> {
  let recordCount = 0;
  const maxPages = maxPagesForWindow(params.window);
  for (let page = 0; page < maxPages; page += 1) {
    const pageIndex = params.stream.kind === "master" ? page + 1 : page;
    const result = await executeYonyouTplusHandler(
      params.stream.handlerRef,
      {
        input: streamInput(params.stream, params.window, pageIndex),
        scope: READ_SCOPE,
        employeeId: "enterprise-data-sync",
      },
      params.secret,
      params.context,
    );
    const body = yonyouTplusPayloadBody(result.payload);
    const rows = rowCountFromBody(body);
    recordCount += rows;
    if (pageIsComplete(body, rows)) {
      return { recordCount, truncated: false };
    }
  }
  return { recordCount, truncated: true };
}

async function pullCatalog(params: {
  stream: SyncStream;
  secret: DataConnectorCredentialSecret;
  context: YonyouTplusProbeContext;
}): Promise<{ recordCount: number; truncated: boolean; watermark?: string }> {
  const result = await executeYonyouTplusHandler(
    params.stream.handlerRef,
    {
      input: { param: { SelectFields: WAREHOUSE_SELECT_FIELDS } },
      scope: READ_SCOPE,
      employeeId: "enterprise-data-sync",
    },
    params.secret,
    params.context,
  );
  const rows = extractYonyouTplusRows(result.payload);
  if (rows.length > WAREHOUSE_ROW_CAP) {
    return { recordCount: rows.length, truncated: true };
  }
  return {
    recordCount: rows.length,
    truncated: false,
    watermark: yonyouTplusCatalogWatermark(rows),
  };
}

function overallStatus(streams: YonyouTplusSyncStreamResult[]): ConnectorSyncLogStatus {
  if (streams.length === 0) {
    return "failure";
  }
  const failed = streams.some((stream) => stream.status === "failure");
  const warned = streams.some((stream) => stream.status === "warning");
  const succeeded = streams.some((stream) => stream.status === "success");
  if (failed && !succeeded && !warned) {
    return "failure";
  }
  if (failed || warned) {
    return "warning";
  }
  return "success";
}

function summarize(status: ConnectorSyncLogStatus, streams: YonyouTplusSyncStreamResult[]): string {
  const label = status === "success" ? "完成" : status === "warning" ? "部分完成" : "失败";
  if (streams.length === 0) {
    return `用友 T+ 同步${label}。`;
  }
  const parts = streams.map((stream) => `${stream.title} ${stream.recordCount} 条`);
  return `用友 T+ 同步${label}：${parts.join("，")}。`;
}

async function runSync(params: YonyouTplusSyncParams): Promise<YonyouTplusSyncResult> {
  const now = params.now ?? new Date();
  const nowIso = now.toISOString();
  const source = params.store.dataSources[params.sourceId];
  if (!source || source.tenantId !== params.tenantId) {
    throw new Error("DataSource not found.");
  }
  if (source.connectorId !== YONYOU_TPLUS_CONNECTOR_ID) {
    throw new Error("该数据源未接入用友 T+ 增量同步。");
  }
  const loadSecret = params.loadSecret ?? loadCredentialSecret;
  const finish = (
    status: ConnectorSyncLogStatus,
    streams: YonyouTplusSyncStreamResult[],
    summary?: string,
  ): YonyouTplusSyncResult => {
    if (streams.some((stream) => stream.pulled && stream.status !== "failure")) {
      source.lastSucceededAt = nowIso;
      source.status = "connected";
    }
    return {
      status,
      summary: summary ?? summarize(status, streams),
      streams,
    };
  };
  const failEarly = (title: string, detail: string): YonyouTplusSyncResult => {
    source.lastCheckedAt = nowIso;
    source.status = "error";
    const stream: YonyouTplusSyncStreamResult = {
      streamKey: "connection",
      title,
      status: "failure",
      recordCount: 0,
      pulled: false,
      advanced: false,
      detail,
    };
    appendLog({
      store: params.store,
      tenantId: params.tenantId,
      source,
      streamKey: stream.streamKey,
      title,
      status: "failure",
      detail,
      recordCount: 0,
      nowIso,
    });
    return finish("failure", [stream], `用友 T+ 同步失败：${detail}`);
  };

  const credentialId = source.credentialId?.trim() || "";
  if (!credentialId) {
    return failEarly("凭证", "数据源没有绑定用友 T+ 凭证。");
  }
  const secret = await loadSecret(credentialId);
  if (!secret) {
    return failEarly("凭证", "用友 T+ 凭证不存在或无法读取。");
  }
  const context: YonyouTplusProbeContext = {
    credentialId,
    vaultPath: params.vaultPath,
    messageStorePath: params.messageStorePath,
  };
  const probe = await probeYonyouTplusConnection(secret, context);
  source.lastCheckedAt = nowIso;
  if (!probe.ok) {
    return failEarly("连通性", probe.message);
  }
  const currentSecret = probe.refreshed ? ((await loadSecret(credentialId)) ?? secret) : secret;
  const streams: YonyouTplusSyncStreamResult[] = [];
  for (const stream of SYNC_STREAMS) {
    const watermark = readWatermark(
      params.store,
      params.tenantId,
      source.sourceId,
      stream.streamKey,
    );
    if (stream.kind === "catalog") {
      try {
        const pulled = await pullCatalog({ stream, secret: currentSecret, context });
        if (pulled.truncated || !pulled.watermark) {
          const detail = `已读取 ${pulled.recordCount} 条仓库。仓库查询没有日期条件，超过 ${WAREHOUSE_ROW_CAP} 条时不写目录指纹。`;
          appendLog({
            store: params.store,
            tenantId: params.tenantId,
            source,
            streamKey: stream.streamKey,
            title: stream.title,
            status: "warning",
            detail,
            recordCount: pulled.recordCount,
            nowIso,
          });
          streams.push({
            streamKey: stream.streamKey,
            title: stream.title,
            status: "warning",
            recordCount: pulled.recordCount,
            pulled: true,
            advanced: false,
            detail,
          });
          continue;
        }
        const changed = watermark !== pulled.watermark;
        writeWatermark({
          store: params.store,
          tenantId: params.tenantId,
          sourceId: source.sourceId,
          streamKey: stream.streamKey,
          watermark: pulled.watermark,
          nowIso,
        });
        const detail = changed
          ? `已读取 ${pulled.recordCount} 条仓库，目录指纹更新为 ${pulled.watermark}。`
          : `已读取 ${pulled.recordCount} 条仓库，目录未变化（${pulled.watermark}）。`;
        appendLog({
          store: params.store,
          tenantId: params.tenantId,
          source,
          streamKey: stream.streamKey,
          title: stream.title,
          status: "success",
          detail,
          recordCount: pulled.recordCount,
          watermark: pulled.watermark,
          nowIso,
        });
        streams.push({
          streamKey: stream.streamKey,
          title: stream.title,
          status: "success",
          recordCount: pulled.recordCount,
          pulled: true,
          watermark: pulled.watermark,
          advanced: changed,
          detail,
        });
      } catch (error) {
        const detail = errorText(error);
        appendLog({
          store: params.store,
          tenantId: params.tenantId,
          source,
          streamKey: stream.streamKey,
          title: stream.title,
          status: "failure",
          detail,
          recordCount: 0,
          nowIso,
        });
        streams.push({
          streamKey: stream.streamKey,
          title: stream.title,
          status: "failure",
          recordCount: 0,
          pulled: false,
          advanced: false,
          detail,
        });
      }
      continue;
    }
    const range = windowFor(stream.kind, now, watermark);
    if (watermark && watermark > range.end) {
      const detail = `水位 ${watermark} 已覆盖当前时间，本次未重复拉取。`;
      appendLog({
        store: params.store,
        tenantId: params.tenantId,
        source,
        streamKey: stream.streamKey,
        title: stream.title,
        status: "success",
        detail,
        recordCount: 0,
        watermark,
        nowIso,
      });
      streams.push({
        streamKey: stream.streamKey,
        title: stream.title,
        status: "success",
        recordCount: 0,
        pulled: false,
        watermark,
        advanced: false,
        detail,
      });
      continue;
    }
    try {
      const pulled = await pullStream({
        stream,
        secret: currentSecret,
        context,
        window: range,
      });
      if (pulled.truncated) {
        const detail = `已读取 ${pulled.recordCount} 条，窗口 ${windowLabel(range)} 未拉完，水位保持不变。`;
        appendLog({
          store: params.store,
          tenantId: params.tenantId,
          source,
          streamKey: stream.streamKey,
          title: stream.title,
          status: "warning",
          detail,
          recordCount: pulled.recordCount,
          nowIso,
        });
        streams.push({
          streamKey: stream.streamKey,
          title: stream.title,
          status: "warning",
          recordCount: pulled.recordCount,
          pulled: true,
          advanced: false,
          detail,
        });
        continue;
      }
      writeWatermark({
        store: params.store,
        tenantId: params.tenantId,
        sourceId: source.sourceId,
        streamKey: stream.streamKey,
        watermark: range.end,
        nowIso,
      });
      const detail =
        range.mode === "full"
          ? `已读取 ${pulled.recordCount} 条（首次全量），水位推进到 ${range.end}。`
          : `已读取 ${pulled.recordCount} 条，水位从 ${range.begin} 推进到 ${range.end}。`;
      appendLog({
        store: params.store,
        tenantId: params.tenantId,
        source,
        streamKey: stream.streamKey,
        title: stream.title,
        status: "success",
        detail,
        recordCount: pulled.recordCount,
        watermark: range.end,
        nowIso,
      });
      streams.push({
        streamKey: stream.streamKey,
        title: stream.title,
        status: "success",
        recordCount: pulled.recordCount,
        pulled: true,
        watermark: range.end,
        advanced: true,
        detail,
      });
    } catch (error) {
      const detail = errorText(error);
      appendLog({
        store: params.store,
        tenantId: params.tenantId,
        source,
        streamKey: stream.streamKey,
        title: stream.title,
        status: "failure",
        detail,
        recordCount: 0,
        nowIso,
      });
      streams.push({
        streamKey: stream.streamKey,
        title: stream.title,
        status: "failure",
        recordCount: 0,
        pulled: false,
        advanced: false,
        detail,
      });
    }
  }
  const status = overallStatus(streams);
  if (!streams.some((stream) => stream.status === "success") && status === "failure") {
    source.status = "error";
  }
  return finish(status, streams);
}

export async function syncYonyouTplusSource(
  params: YonyouTplusSyncParams,
): Promise<YonyouTplusSyncResult> {
  const key = `${params.tenantId}::${params.sourceId}`;
  const previous = syncLocks.get(key) ?? Promise.resolve({} as YonyouTplusSyncResult);
  const run = previous.then(
    () => runSync(params),
    () => runSync(params),
  );
  syncLocks.set(key, run);
  try {
    return await run;
  } finally {
    if (syncLocks.get(key) === run) {
      syncLocks.delete(key);
    }
  }
}
