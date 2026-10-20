/**
 * In-memory demo state for the key-account skeleton.
 * Mutations stay in the page session. Settlement rows are read-only.
 */

import {
  KEY_ACCOUNT_AUDIT_EVENTS,
  KEY_ACCOUNT_PARTNERS,
  UNSIGNED_APP_PACKAGE_ID,
  emptyPartnerTerms,
  findSignedPackage,
  listSignedAppPackages,
  partnerStatusLabel,
  type KeyAccountAuditAction,
  type KeyAccountAuditEvent,
  type PartnerSeed,
  type PartnerStatus,
  type PartnerType,
  type PublishedWhiteLabel,
  type WhiteLabelDraft,
} from "./fixtures.ts";

export type KeyAccountPartner = Omit<PartnerSeed, "packageIds"> & {
  packageIds: string[];
  /** Package ids that received the current published cover. */
  publishedOntoPackageIds: string[];
  previousPublishedOntoPackageIds: string[];
  statusReason: string;
};

export type KeyAccountNotice = { tone: "ok" | "warn"; text: string };

let partners: KeyAccountPartner[] = clonePartners();
let notice: KeyAccountNotice | null = null;
let sessionAudit: KeyAccountAuditEvent[] = [];
let auditSeq = 0;

function cloneDraft(draft: WhiteLabelDraft | null): WhiteLabelDraft | null {
  return draft ? { ...draft } : null;
}

function clonePublished(label: PublishedWhiteLabel | null): PublishedWhiteLabel | null {
  return label ? { ...label } : null;
}

function clonePartners(): KeyAccountPartner[] {
  return KEY_ACCOUNT_PARTNERS.map((partner) => ({
    ...partner,
    draft: cloneDraft(partner.draft),
    published: clonePublished(partner.published),
    previousPublished: clonePublished(partner.previousPublished),
    packageIds: [...partner.packageIds],
    publishedOntoPackageIds: partner.published ? [...partner.packageIds] : [],
    previousPublishedOntoPackageIds: partner.previousPublished ? [...partner.packageIds] : [],
    statusReason: "",
    terms: { ...partner.terms },
  }));
}

function recordAudit(input: {
  action: KeyAccountAuditAction;
  partnerCode: string;
  objectId: string;
  summary: string;
}): void {
  auditSeq += 1;
  sessionAudit = [
    {
      id: `aud-demo-session-${auditSeq}`,
      at: "演示 · 刚刚",
      actor: "平台商务 · 演示",
      ...input,
    },
    ...sessionAudit,
  ];
}

export function resetKeyAccountState(): void {
  partners = clonePartners();
  notice = null;
  sessionAudit = [];
  auditSeq = 0;
}

export function listKeyAccountAuditEvents(): readonly KeyAccountAuditEvent[] {
  return [...sessionAudit, ...KEY_ACCOUNT_AUDIT_EVENTS];
}

export function listKeyAccountPartners(): readonly KeyAccountPartner[] {
  return partners;
}

export function readKeyAccountNotice(): KeyAccountNotice | null {
  return notice;
}

export function findKeyAccountPartner(code: string | null | undefined): KeyAccountPartner | null {
  const normalized = code?.trim().toUpperCase() ?? "";
  if (!normalized) {
    return null;
  }
  return partners.find((partner) => partner.code.toUpperCase() === normalized) ?? null;
}

export function createKeyAccountPartner(input: {
  code: string;
  displayName: string;
  type: PartnerType;
  contact: string;
}): KeyAccountNotice {
  const code = input.code.trim().toUpperCase();
  const displayName = input.displayName.trim();
  if (!/^KA-\d{4}$/.test(code)) {
    notice = { tone: "warn", text: "伙伴编码需要是 KA- 加四位数字。" };
    return notice;
  }
  if (!displayName) {
    notice = { tone: "warn", text: "请填写显示名。" };
    return notice;
  }
  if (partners.some((partner) => partner.code === code)) {
    notice = { tone: "warn", text: "这个伙伴编码已经在台账里。" };
    return notice;
  }
  partners = [
    {
      code,
      displayName,
      type: input.type,
      status: "intent",
      contact: input.contact.trim() || "未填写",
      owner: "平台商务 · 演示",
      note: "演示新建。",
      settlementMode: "share",
      settlementId: `settle-${code.toLowerCase()}`,
      updatedAt: "演示 · 刚刚",
      draft: null,
      published: null,
      previousPublished: null,
      packageIds: [],
      publishedOntoPackageIds: [],
      previousPublishedOntoPackageIds: [],
      statusReason: "",
      terms: emptyPartnerTerms(code, "share"),
    },
    ...partners,
  ];
  recordAudit({
    action: "伙伴建档",
    partnerCode: code,
    objectId: code,
    summary: `演示记录。${displayName} 进入伙伴台账，状态为意向。`,
  });
  notice = { tone: "ok", text: `已加入演示台账 ${code}。` };
  return notice;
}

export function changeKeyAccountStatus(
  code: string,
  status: PartnerStatus,
  reason: string,
): KeyAccountNotice {
  const partner = findKeyAccountPartner(code);
  const trimmed = reason.trim();
  if (!partner) {
    notice = { tone: "warn", text: "没有这个伙伴。" };
    return notice;
  }
  if (!trimmed) {
    notice = { tone: "warn", text: "变更状态需要填写原因。" };
    return notice;
  }
  if (partner.status === status) {
    notice = { tone: "warn", text: "状态没有变化。" };
    return notice;
  }
  const previous = partnerStatusLabel(partner.status);
  partner.status = status;
  partner.statusReason = trimmed;
  partner.updatedAt = "演示 · 刚刚";
  recordAudit({
    action: "伙伴状态变更",
    partnerCode: partner.code,
    objectId: partner.code,
    summary: `演示记录。状态从${previous}改为${partnerStatusLabel(status)}。原因：${trimmed}。`,
  });
  notice = { tone: "ok", text: "状态已在演示台账中更新。" };
  return notice;
}

export function saveWhiteLabelDraft(code: string, draft: WhiteLabelDraft): KeyAccountNotice {
  const partner = findKeyAccountPartner(code);
  if (!partner) {
    notice = { tone: "warn", text: "没有这个伙伴。" };
    return notice;
  }
  if (!draft.displayName.trim()) {
    notice = { tone: "warn", text: "展示名不能为空。" };
    return notice;
  }
  partner.draft = {
    displayName: draft.displayName.trim(),
    logoName: draft.logoName.trim(),
    primary: draft.primary.trim(),
    accent: draft.accent.trim(),
    splash: draft.splash.trim(),
  };
  partner.updatedAt = "演示 · 刚刚";
  notice = { tone: "ok", text: "白牌草稿已保存在演示数据中。" };
  return notice;
}

export function publishWhiteLabel(code: string): KeyAccountNotice {
  const partner = findKeyAccountPartner(code);
  if (!partner?.draft) {
    notice = { tone: "warn", text: "先保存草稿，再发布到关联预装配置。" };
    return notice;
  }
  if (partner.published) {
    partner.previousPublished = { ...partner.published };
    partner.previousPublishedOntoPackageIds = [...partner.publishedOntoPackageIds];
  }
  const nextVersion = nextWhiteLabelVersion(
    partner.published?.version ?? partner.previousPublished?.version,
  );
  partner.published = { ...partner.draft, version: nextVersion };
  partner.publishedOntoPackageIds = [...partner.packageIds];
  partner.updatedAt = "演示 · 刚刚";
  const binding = labelBindingText(partner.publishedOntoPackageIds);
  recordAudit({
    action: "白牌发布",
    partnerCode: partner.code,
    objectId: nextVersion,
    summary: `演示记录。发布渠道封面 ${nextVersion}。${binding}不改制品 digest。`,
  });
  notice = { tone: "ok", text: `已发布渠道封面 ${nextVersion}。${binding}` };
  return notice;
}

function labelBindingText(packageIds: readonly string[]): string {
  if (packageIds.length === 0) {
    return "尚未关联已签名预装包，封面已发布，关联后再发布才会写到预装配置。";
  }
  return `已写到关联预装配置：${packageIds.join("、")}。`;
}

export function rollbackWhiteLabel(code: string): KeyAccountNotice {
  const partner = findKeyAccountPartner(code);
  if (!partner?.previousPublished) {
    notice = { tone: "warn", text: "没有可回滚的上一版封面。" };
    return notice;
  }
  const current = partner.published;
  const currentOnto = [...partner.publishedOntoPackageIds];
  partner.published = { ...partner.previousPublished };
  partner.publishedOntoPackageIds = [...partner.previousPublishedOntoPackageIds];
  partner.draft = {
    displayName: partner.published.displayName,
    logoName: partner.published.logoName,
    primary: partner.published.primary,
    accent: partner.published.accent,
    splash: partner.published.splash,
  };
  partner.previousPublished = current ? { ...current } : null;
  partner.previousPublishedOntoPackageIds = current ? currentOnto : [];
  partner.updatedAt = "演示 · 刚刚";
  const binding = labelBindingText(partner.publishedOntoPackageIds);
  recordAudit({
    action: "白牌发布",
    partnerCode: partner.code,
    objectId: partner.published.version,
    summary: `演示记录。回滚渠道封面到 ${partner.published.version}。${binding}不改制品 digest。`,
  });
  notice = { tone: "ok", text: `已回滚到 ${partner.published.version}。` };
  return notice;
}

function nextWhiteLabelVersion(current: string | undefined): string {
  const match = current?.match(/^WL-v(\d+)$/);
  const next = match ? Number(match[1]) + 1 : 1;
  return `WL-v${next}`;
}

export function associateSignedPackage(code: string, packageId: string): KeyAccountNotice {
  const partner = findKeyAccountPartner(code);
  const trimmed = packageId.trim();
  if (!partner) {
    notice = { tone: "warn", text: "没有这个伙伴。" };
    return notice;
  }
  if (trimmed === UNSIGNED_APP_PACKAGE_ID || !findSignedPackage(trimmed)) {
    notice = { tone: "warn", text: "这个标识不是已签名 App 预装包，不能关联。" };
    return notice;
  }
  if (partner.packageIds.includes(trimmed)) {
    notice = { tone: "warn", text: "这个预装包已经关联。" };
    return notice;
  }
  partner.packageIds = [...partner.packageIds, trimmed];
  partner.updatedAt = "演示 · 刚刚";
  recordAudit({
    action: "预装关联",
    partnerCode: partner.code,
    objectId: trimmed,
    summary: `演示记录。关联已签名 App 预装包 ${trimmed}。验签状态只读，不改制品 digest。`,
  });
  notice = { tone: "ok", text: "已关联已签名 App 预装包。" };
  return notice;
}

export function unlinkSignedPackage(code: string, packageId: string): KeyAccountNotice {
  const partner = findKeyAccountPartner(code);
  if (!partner) {
    notice = { tone: "warn", text: "没有这个伙伴。" };
    return notice;
  }
  const hadLink = partner.packageIds.includes(packageId);
  partner.packageIds = partner.packageIds.filter((id) => id !== packageId);
  partner.updatedAt = "演示 · 刚刚";
  if (hadLink) {
    recordAudit({
      action: "预装解除关联",
      partnerCode: partner.code,
      objectId: packageId,
      summary: `演示记录。解除已签名 App 预装包 ${packageId} 的渠道关联。`,
    });
  }
  notice = { tone: "ok", text: "已解除关联。" };
  return notice;
}

export function signedPackageChoices(): readonly { id: string; versionNarrative: string }[] {
  return listSignedAppPackages();
}

export function whiteLabelVersionForPackage(partner: KeyAccountPartner, packageId: string): string {
  if (partner.published && partner.publishedOntoPackageIds.includes(packageId)) {
    return partner.published.version;
  }
  return "未发布到该关联";
}

export function emptyWhiteLabelDraft(displayName: string): WhiteLabelDraft {
  return {
    displayName,
    logoName: "",
    primary: "#1F4B99",
    accent: "#E8EEF8",
    splash: "",
  };
}
