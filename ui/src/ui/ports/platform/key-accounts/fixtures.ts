/**
 * Demo fixtures for the platform key-account console (K-01..K-08).
 * Labeled as demo data. Nothing here issues a bill or writes the productization ledger.
 * Signed App preinstall packages are read from the productization catalog.
 */

import {
  findSignedAppPreinstallPackage,
  listSignedAppPreinstallPackages,
  UNSIGNED_APP_PREINSTALL_ID,
  type SignedAppPreinstallPackage,
} from "./signed-app-catalog.ts";

export type SignedAppPackage = SignedAppPreinstallPackage;
export const UNSIGNED_APP_PACKAGE_ID = UNSIGNED_APP_PREINSTALL_ID;
export const listSignedAppPackages = listSignedAppPreinstallPackages;
export const findSignedPackage = findSignedAppPreinstallPackage;

export const KEY_ACCOUNT_STRATEGIC_REVISION = "2026-10-10";

export const KEY_ACCOUNT_STRATEGIC_LINE =
  "SaaS 是唯一主运营路径。OEM 是渠道白牌 App 预装加上渠道结算（分成或批发）。";

export const KEY_ACCOUNT_PREINSTALL_LINE = "预装不等于可用权益，也不等于无限再分发。";

export const KEY_ACCOUNT_DEMO_NOTICE =
  "演示数据。伙伴、白牌、预装关联、域内审计和合作条款只存在于本次页面，不写入计费，也不改产品化制品主账。";

export const KEY_ACCOUNT_DEMO_DETAIL_CODE = "KA-0011";

/** Phrases that must not appear in this module's rendered copy. */
export const KEY_ACCOUNT_FORBIDDEN_PHRASES = [
  "私有化 Runtime 主路径",
  "一体机私有化",
  "第二壳",
  "第二产品",
  "平行控制面",
  "Fleet 必选",
  "一机一装",
  "设备 License",
  "部署 Gateway",
  "Appliance 整包",
  "Appliance Runtime",
  "野版包上传",
  "未签名包出货",
  "OEM 主路径",
  "私有整包出货",
] as const;

export type PartnerType = "key-account" | "channel-oem";
export type PartnerStatus = "intent" | "active" | "paused" | "ended";
export type SettlementMode = "share" | "wholesale";

export type WhiteLabelDraft = {
  displayName: string;
  logoName: string;
  primary: string;
  accent: string;
  splash: string;
};

export type PublishedWhiteLabel = WhiteLabelDraft & {
  version: string;
};

export type PartnerSeed = {
  code: string;
  displayName: string;
  type: PartnerType;
  status: PartnerStatus;
  contact: string;
  owner: string;
  note: string;
  settlementMode: SettlementMode;
  settlementId: string;
  updatedAt: string;
  draft: WhiteLabelDraft | null;
  published: PublishedWhiteLabel | null;
  previousPublished: PublishedWhiteLabel | null;
  packageIds: readonly string[];
  terms: PartnerTerms;
};

export type SettlementSummary = {
  partnerCode: string;
  period: string;
  status: "reconciled" | "open";
  updatedAt: string;
};

/** Read-only business-master paste. This module never writes share ratios. */
export type PartnerTerms = {
  contractRef: string;
  effectiveFrom: string;
  shareSummary: string;
  wholesaleSummary: string;
  pasted: string;
  sourceLabel: string;
};

export const KEY_ACCOUNT_AUDIT_ACTIONS = [
  "伙伴建档",
  "伙伴状态变更",
  "白牌发布",
  "预装关联",
  "预装解除关联",
] as const;

export type KeyAccountAuditAction = (typeof KEY_ACCOUNT_AUDIT_ACTIONS)[number];

export type KeyAccountAuditEvent = {
  id: string;
  at: string;
  actor: string;
  action: KeyAccountAuditAction;
  partnerCode: string;
  objectId: string;
  summary: string;
};

export type KeyAccountAuditFilter = {
  action: "all" | KeyAccountAuditAction;
  partner: string;
  keyword: string;
};

const northLabel: WhiteLabelDraft = {
  displayName: "北境渠道",
  logoName: "north-mark.svg",
  primary: "#1F4B99",
  accent: "#E8EEF8",
  splash: "北境渠道工作台",
};

export const KEY_ACCOUNT_PARTNERS: readonly PartnerSeed[] = Object.freeze([
  Object.freeze({
    code: "KA-0011",
    displayName: "北境渠道",
    type: "channel-oem",
    status: "active",
    contact: "林可",
    owner: "平台商务 · 周衡",
    note: "渠道封面与分成结算。",
    settlementMode: "share",
    settlementId: "settle-ka-0011",
    updatedAt: "2026-10-09",
    draft: { ...northLabel },
    published: { ...northLabel, version: "WL-v3" },
    previousPublished: {
      displayName: "北境渠道",
      logoName: "north-mark-v2.svg",
      primary: "#16356F",
      accent: "#F4F7FB",
      splash: "北境渠道",
      version: "WL-v2",
    },
    packageIds: Object.freeze(["app-pre-202610-a"]),
    terms: Object.freeze({
      contractRef: "CTR-KA-0011",
      effectiveFrom: "2026-07-01",
      shareSummary: "渠道结算按分成。比例以商务主数据为准，本页只读。",
      wholesaleSummary: "当前不是批发。批发条款未启用。",
      pasted: "渠道白牌 App 预装，按分成结算。预装不等于可用权益，也不等于无限再分发。",
      sourceLabel: "商务主数据（演示粘贴）",
    }),
  }),
  Object.freeze({
    code: "KA-0018",
    displayName: "澄海集团",
    type: "key-account",
    status: "intent",
    contact: "赵敏",
    owner: "平台商务 · 周衡",
    note: "直客大客户，尚未配置渠道封面。",
    settlementMode: "wholesale",
    settlementId: "settle-ka-0018",
    updatedAt: "2026-10-08",
    draft: null,
    published: null,
    previousPublished: null,
    packageIds: Object.freeze([]),
    terms: Object.freeze({
      contractRef: "CTR-KA-0018",
      effectiveFrom: "未生效",
      shareSummary: "当前不是分成。分成条款未启用。",
      wholesaleSummary: "渠道结算按批发。单价与账期以商务主数据为准，本页只读。",
      pasted: "直客大客户意向。条款等待商务主数据粘贴确认，本页只展示摘要。",
      sourceLabel: "商务主数据（演示粘贴）",
    }),
  }),
  Object.freeze({
    code: "KA-0024",
    displayName: "澜湾分销",
    type: "channel-oem",
    status: "paused",
    contact: "何安",
    owner: "平台商务 · 苏晚",
    note: "暂停出货，封面仍保留。",
    settlementMode: "wholesale",
    settlementId: "settle-ka-0024",
    updatedAt: "2026-10-06",
    draft: {
      displayName: "澜湾分销",
      logoName: "lanwan.svg",
      primary: "#0E7C66",
      accent: "#E7F6F2",
      splash: "澜湾分销",
    },
    published: {
      displayName: "澜湾分销",
      logoName: "lanwan.svg",
      primary: "#0E7C66",
      accent: "#E7F6F2",
      splash: "澜湾分销",
      version: "WL-v1",
    },
    previousPublished: null,
    packageIds: Object.freeze(["app-pre-202610-b"]),
    terms: Object.freeze({
      contractRef: "CTR-KA-0024",
      effectiveFrom: "2026-04-01",
      shareSummary: "当前不是分成。分成条款未启用。",
      wholesaleSummary: "渠道结算按批发。暂停出货期间条款仍只读保留。",
      pasted: "渠道白牌 App 预装，按批发结算。预装不等于可用权益，也不等于无限再分发。",
      sourceLabel: "商务主数据（演示粘贴）",
    }),
  }),
]);

export const KEY_ACCOUNT_AUDIT_EVENTS: readonly KeyAccountAuditEvent[] = Object.freeze([
  Object.freeze({
    id: "aud-ka-0011-status",
    at: "2026-10-09 11:20",
    actor: "平台商务 · 周衡",
    action: "伙伴状态变更",
    partnerCode: "KA-0011",
    objectId: "KA-0011",
    summary: "演示记录。北境渠道状态记为合作中。原因：渠道封面与分成结算。",
  }),
  Object.freeze({
    id: "aud-ka-0011-label",
    at: "2026-10-09 11:40",
    actor: "平台商务 · 周衡",
    action: "白牌发布",
    partnerCode: "KA-0011",
    objectId: "WL-v3",
    summary:
      "演示记录。发布渠道封面 WL-v3。包标识 app-pre-202610-a 只读交叉引用，不改制品 digest。",
  }),
  Object.freeze({
    id: "aud-ka-0011-link",
    at: "2026-10-09 16:05",
    actor: "平台商务 · 周衡",
    action: "预装关联",
    partnerCode: "KA-0011",
    objectId: "app-pre-202610-a",
    summary: "演示记录。关联已签名 App 预装包 app-pre-202610-a。验签状态只读。",
  }),
  Object.freeze({
    id: "aud-ka-0018-create",
    at: "2026-10-08 09:12",
    actor: "平台商务 · 周衡",
    action: "伙伴建档",
    partnerCode: "KA-0018",
    objectId: "KA-0018",
    summary: "演示记录。澄海集团进入伙伴台账，状态为意向。",
  }),
  Object.freeze({
    id: "aud-ka-0024-link",
    at: "2026-10-06 18:02",
    actor: "平台商务 · 苏晚",
    action: "预装关联",
    partnerCode: "KA-0024",
    objectId: "app-pre-202610-b",
    summary: "演示记录。关联已签名 App 预装包 app-pre-202610-b。验签状态只读。",
  }),
]);

export const SETTLEMENT_SUMMARIES: readonly SettlementSummary[] = Object.freeze([
  Object.freeze({
    partnerCode: "KA-0011",
    period: "2026-09",
    status: "reconciled",
    updatedAt: "2026-10-02",
  }),
]);

/** Read-only channel shipment batches. Compared with preinstall versions. No device list. */
export type ShipmentBatch = {
  id: string;
  partnerCode: string;
  packageId: string;
  whiteLabelVersion: string;
  shippedAt: string;
  summary: string;
};

export const KEY_ACCOUNT_SHIPMENT_BATCHES: readonly ShipmentBatch[] = Object.freeze([
  Object.freeze({
    id: "SHIP-202610-011",
    partnerCode: "KA-0011",
    packageId: "app-pre-202610-a",
    whiteLabelVersion: "WL-v3",
    shippedAt: "2026-10-09",
    summary: "渠道出货批次，对照已签名 App 预装版本。只读。",
  }),
  Object.freeze({
    id: "SHIP-202610-024",
    partnerCode: "KA-0024",
    packageId: "app-pre-202610-b",
    whiteLabelVersion: "WL-v1",
    shippedAt: "2026-10-06",
    summary: "暂停前的渠道出货批次。只读保留，没有设备清单。",
  }),
]);

export function partnerTypeLabel(type: PartnerType): string {
  return type === "channel-oem" ? "渠道OEM" : "大客户";
}

export function partnerStatusLabel(status: PartnerStatus): string {
  switch (status) {
    case "intent":
      return "意向";
    case "active":
      return "合作中";
    case "paused":
      return "暂停";
    case "ended":
      return "终止";
  }
}

export function settlementModeLabel(mode: SettlementMode): string {
  return mode === "share" ? "分成" : "批发";
}

export function emptyPartnerTerms(code: string, mode: SettlementMode): PartnerTerms {
  const share = mode === "share";
  return {
    contractRef: `CTR-${code}`,
    effectiveFrom: "未粘贴",
    shareSummary: share ? "分成条款尚未从商务主数据粘贴。" : "当前模式不是分成。",
    wholesaleSummary: share ? "当前模式不是批发。" : "批发条款尚未从商务主数据粘贴。",
    pasted: "演示新建。条款只读，等待商务主数据粘贴。",
    sourceLabel: "商务主数据（演示粘贴）",
  };
}

export function filterKeyAccountAudit(
  events: readonly KeyAccountAuditEvent[],
  filter: KeyAccountAuditFilter,
): KeyAccountAuditEvent[] {
  const partner = filter.partner.trim().toUpperCase();
  const keyword = filter.keyword.trim().toLowerCase();
  return events.filter((event) => {
    if (filter.action !== "all" && event.action !== filter.action) {
      return false;
    }
    if (partner && partner !== "ALL" && event.partnerCode.toUpperCase() !== partner) {
      return false;
    }
    if (!keyword) {
      return true;
    }
    return [event.at, event.actor, event.action, event.partnerCode, event.objectId, event.summary]
      .join(" ")
      .toLowerCase()
      .includes(keyword);
  });
}

export function containsForbiddenKeyAccountPhrase(text: string): string | null {
  return KEY_ACCOUNT_FORBIDDEN_PHRASES.find((phrase) => text.includes(phrase)) ?? null;
}
