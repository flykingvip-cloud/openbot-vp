/**
 * Read-only P1 fixtures for the platform productization console.
 * L1 rows are a projection seam: they stay hidden while the control plane is
 * unavailable. Nothing here is a signing key, a wild digest, or a write API.
 * Strategic revision 2026-10-10: SaaS is the only primary ops path.
 */

import { findArtifactByTrain, shortDigest, type ProductizationArtifact } from "./fixtures.ts";

export const PRODUCTIZATION_STRATEGIC_REVISION = "2026-10-10";

/** Locked operator line. SaaS full is the only shipping surface. */
export const PRODUCTIZATION_STRATEGIC_LINE =
  "SaaS 是唯一主运营路径。full 是 SaaS 主路径。产品化工作台只在平台端。";

export const L1_READONLY_BANNER =
  "L1 是非主路径只读占位，不表示设备准入，也不是 OEM 出货面。不可签发、吊销、换机。";

export const L1_FAIL_CLOSED_DETAIL =
  "控制面不可用。本页失败关闭，不伪造准入数据。筛选不会改成演示行。";

export const L1_DEEPLINK_EXPLANATION =
  "深链说明：只读许可视图的深链需要独立权限。本页解释深链形态，不发起请求，也不代开签发、吊销或换机。控制面不可用时不展示深链目标。";

export const L1_CONNECTED_NOTICE = "演示投影。控制面联通标记只供夹具验收，不是生产签发记录。";

export const L1_THIN_NOTE =
  "这里的关联是非主路径占位。订阅与渠道结算不在本页写成主账。设备标记与心跳不是出货指标。";

export type L1ControlPlaneAvailability = "unavailable" | "available";

export type L1Status = "admitted" | "grace" | "unbound" | "revoked";

export type L1LicenseProjection = {
  licenseId: string;
  sku: string;
  skuLabel: string;
  tenantId: string;
  deviceId: string | null;
  oemId: string;
  status: L1Status;
  lastHeartbeat: string | null;
};

export type L1Filter = {
  oemId: string;
  tenantId: string;
  sku: string;
  status: "all" | L1Status;
  keyword: string;
};

export const EMPTY_L1_FILTER: L1Filter = {
  oemId: "",
  tenantId: "",
  sku: "",
  status: "all",
  keyword: "",
};

let l1ControlPlane: L1ControlPlaneAvailability = "unavailable";

export function readL1ControlPlaneAvailability(): L1ControlPlaneAvailability {
  return l1ControlPlane;
}

export function setL1ControlPlaneAvailability(next: L1ControlPlaneAvailability): void {
  l1ControlPlane = next;
}

export function resetL1ControlPlaneAvailability(): void {
  l1ControlPlane = "unavailable";
}

const L1_DEMO_ROWS: readonly L1LicenseProjection[] = Object.freeze([
  Object.freeze({
    licenseId: "lic-demo-014",
    sku: "l1-thin-access",
    skuLabel: "渠道条款占位",
    tenantId: "tenant-demo-a",
    deviceId: "dev-demo-220",
    oemId: "oem-channel-demo",
    status: "admitted",
    lastHeartbeat: "2026-10-09 12:04",
  }),
  Object.freeze({
    licenseId: "lic-demo-015",
    sku: "l1-thin-access",
    skuLabel: "渠道条款占位",
    tenantId: "tenant-demo-b",
    deviceId: null,
    oemId: "oem-channel-demo",
    status: "unbound",
    lastHeartbeat: null,
  }),
  Object.freeze({
    licenseId: "lic-demo-016",
    sku: "l1-grace",
    skuLabel: "渠道条款宽限",
    tenantId: "tenant-demo-a",
    deviceId: "dev-demo-221",
    oemId: "oem-channel-other",
    status: "grace",
    lastHeartbeat: "2026-10-08 09:18",
  }),
]);

export function l1StatusLabel(status: L1Status): string {
  switch (status) {
    case "admitted":
      return "条款在册";
    case "grace":
      return "宽限期";
    case "unbound":
      return "未绑定";
    case "revoked":
      return "已吊销";
  }
}

export function l1ProjectionRows(): readonly L1LicenseProjection[] {
  if (l1ControlPlane !== "available") {
    return [];
  }
  return L1_DEMO_ROWS;
}

export function filterL1Projections(
  rows: readonly L1LicenseProjection[],
  filter: L1Filter,
): L1LicenseProjection[] {
  const oemId = filter.oemId.trim().toLowerCase();
  const tenantId = filter.tenantId.trim().toLowerCase();
  const sku = filter.sku.trim().toLowerCase();
  const keyword = filter.keyword.trim().toLowerCase();
  return rows.filter((row) => {
    if (oemId && !row.oemId.toLowerCase().includes(oemId)) {
      return false;
    }
    if (tenantId && !row.tenantId.toLowerCase().includes(tenantId)) {
      return false;
    }
    if (sku && !`${row.sku} ${row.skuLabel}`.toLowerCase().includes(sku)) {
      return false;
    }
    if (filter.status !== "all" && row.status !== filter.status) {
      return false;
    }
    if (!keyword) {
      return true;
    }
    const haystack = [
      row.licenseId,
      row.sku,
      row.skuLabel,
      row.tenantId,
      row.deviceId ?? "",
      row.oemId,
      l1StatusLabel(row.status),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(keyword);
  });
}

/** Explains the deep link. This string is not a navigation target. */
export function l1DeepLinkShape(licenseId: string): string {
  return `控制面只读许可视图 /licenses/${licenseId}`;
}

export type SurfaceMatrixRow = {
  id: string;
  capability: string;
  full: string;
};

export const SURFACE_MATRIX_ROWS: readonly SurfaceMatrixRow[] = Object.freeze([
  Object.freeze({
    id: "platform-workbench",
    capability: "平台端产品化工作台",
    full: "含，SaaS 主路径",
  }),
  Object.freeze({
    id: "employee",
    capability: "员工日常工作台",
    full: "含",
  }),
  Object.freeze({
    id: "enterprise",
    capability: "企业治理",
    full: "含，租户云侧",
  }),
  Object.freeze({
    id: "saas-ops",
    capability: "SaaS 云侧运营",
    full: "主路径",
  }),
  Object.freeze({
    id: "cloud-train",
    capability: "云侧发布列车",
    full: "含",
  }),
  Object.freeze({
    id: "license-write",
    capability: "许可签发、吊销、换机",
    full: "不含",
  }),
  Object.freeze({
    id: "signing-key",
    capability: "签发私钥",
    full: "不含",
  }),
  Object.freeze({
    id: "oem-channel",
    capability: "渠道白标、换肤预装与结算",
    full: "渠道白标预装与结算。不随服务器交付平台端",
  }),
  Object.freeze({
    id: "wild-digest",
    capability: "野版 digest 录入",
    full: "不含",
  }),
]);

export const SURFACE_MATRIX_NOTE = "矩阵只描述 SaaS full 的含与不含。full 是唯一默认运营路径。";

export type ReleaseWindowRow = {
  id: string;
  name: string;
  trainSeq: string;
  versionNarrative: string;
  digest: string;
  phaseLabel: string;
  goLabel: string;
  narrative: string;
};

export const RELEASE_WINDOW_NOTE =
  "本页叙述 SaaS 云侧制品的发布窗口与列车。GO 状态只读。本页不把 Fleet 写成必经项。";

function windowFromTrain(
  trainSeq: string,
  fields: Omit<ReleaseWindowRow, "trainSeq" | "versionNarrative" | "digest">,
): ReleaseWindowRow {
  const artifact: ProductizationArtifact | undefined = findArtifactByTrain(trainSeq);
  if (!artifact) {
    throw new Error(`productization release window missing train ${trainSeq}`);
  }
  return Object.freeze({
    ...fields,
    trainSeq: artifact.trainSeq,
    versionNarrative: artifact.versionNarrative,
    digest: artifact.digest,
  });
}

export const RELEASE_WINDOWS: readonly ReleaseWindowRow[] = Object.freeze([
  windowFromTrain("112", {
    id: "cloud-stable",
    name: "云侧稳定窗口",
    phaseLabel: "正式",
    goLabel: "只读 GO",
    narrative: "SaaS 云侧稳定窗口。",
  }),
  windowFromTrain("109", {
    id: "cloud-candidate",
    name: "云侧候选窗口",
    phaseLabel: "候选",
    goLabel: "只读保持",
    narrative: "SaaS 云侧候选窗口。尚未作为主路径晋升。",
  }),
  windowFromTrain("101", {
    id: "cloud-retired",
    name: "云侧历史窗口",
    phaseLabel: "废弃",
    goLabel: "只读不放行",
    narrative: "已离开云侧窗口的历史列车，只读备查。",
  }),
]);

export function releaseWindowDigestLabel(digest: string): string {
  return shortDigest(digest);
}

export type ProductizationAuditEvent = {
  id: string;
  at: string;
  actor: string;
  action: string;
  objectType: string;
  objectId: string;
  result: string;
  summary: string;
};

export const PRODUCTIZATION_AUDIT_EVENTS: readonly ProductizationAuditEvent[] = Object.freeze([
  Object.freeze({
    id: "aud-demo-112",
    at: "2026-10-09 14:22",
    actor: "productization.demo",
    action: "云侧通道改指",
    objectType: "channel",
    objectId: "stable-cloud",
    result: "演示记录",
    summary: "云侧稳定通道指向列车 seq-112。演示夹具，未写入生产台账。",
  }),
  Object.freeze({
    id: "aud-demo-wild",
    at: "2026-10-09 15:01",
    actor: "productization.demo",
    action: "对账拒绝野版",
    objectType: "digest",
    objectId: "列车外 digest",
    result: "拒绝",
    summary: "对账台拒绝列车外 digest，未写入台账。",
  }),
  Object.freeze({
    id: "aud-demo-matrix",
    at: "2026-10-09 15:10",
    actor: "productization.demo",
    action: "查看表面矩阵",
    objectType: "surface",
    objectId: "full",
    result: "只读",
    summary: "确认 full 为 SaaS 主路径。",
  }),
  Object.freeze({
    id: "aud-demo-window",
    at: "2026-10-09 15:16",
    actor: "productization.demo",
    action: "查看发布窗口",
    objectType: "window",
    objectId: "cloud-stable",
    result: "只读",
    summary: "读取 SaaS 云侧稳定窗口的列车叙事。",
  }),
  Object.freeze({
    id: "aud-demo-artifact",
    at: "2026-10-09 15:20",
    actor: "productization.demo",
    action: "查看制品",
    objectType: "artifact",
    objectId: "seq-112",
    result: "只读",
    summary: "打开列车 seq-112 的制品详情。无签发动作。",
  }),
]);

export type AuditFilter = {
  action: string;
  result: string;
  keyword: string;
};

export const EMPTY_AUDIT_FILTER: AuditFilter = {
  action: "all",
  result: "all",
  keyword: "",
};

export function auditActionOptions(): string[] {
  return [...new Set(PRODUCTIZATION_AUDIT_EVENTS.map((event) => event.action))];
}

export function auditResultOptions(): string[] {
  return [...new Set(PRODUCTIZATION_AUDIT_EVENTS.map((event) => event.result))];
}

export function filterAuditEvents(
  events: readonly ProductizationAuditEvent[],
  filter: AuditFilter,
): ProductizationAuditEvent[] {
  const keyword = filter.keyword.trim().toLowerCase();
  return events.filter((event) => {
    if (filter.action !== "all" && event.action !== filter.action) {
      return false;
    }
    if (filter.result !== "all" && event.result !== filter.result) {
      return false;
    }
    if (!keyword) {
      return true;
    }
    const haystack = [
      event.at,
      event.actor,
      event.action,
      event.objectType,
      event.objectId,
      event.result,
      event.summary,
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(keyword);
  });
}
