import { describe, expect, it, beforeEach } from "vitest";
import { selectPortsForSurface } from "../../../../../../scripts/openbot-surface.mjs";
import { PLATFORM_NAV_SECTIONS, visiblePlatformNavSections } from "../../../app-render.helpers.ts";
import {
  ENTERPRISE_SURFACE_TABS,
  isEnterpriseTab,
  isPlatformTab,
  matchTabRoute,
  portForTab,
  tabFromPath,
  tabGroupsForPort,
} from "../../../navigation.ts";
import { canAccessTab } from "../../../routing/port-permissions.ts";
import {
  PLATFORM_KEY_ACCOUNT_READ,
  PLATFORM_KEY_ACCOUNT_WRITE,
  PLATFORM_PRODUCTIZATION_READ,
  PLATFORM_PRODUCTIZATION_WRITE,
} from "../domain-access.ts";
import { PRODUCTIZATION_ARTIFACTS } from "../productization/fixtures.ts";
import { renderProductizationSurface } from "../productization/page.ts";
import { PRODUCTIZATION_ROUTES, PRODUCTIZATION_TAB } from "../productization/routes.ts";
import { setDeliveryBoardKeyword } from "./delivery-board.ts";
import {
  KEY_ACCOUNT_DEMO_DETAIL_CODE,
  KEY_ACCOUNT_FORBIDDEN_PHRASES,
  KEY_ACCOUNT_STRATEGIC_REVISION,
  UNSIGNED_APP_PACKAGE_ID,
  containsForbiddenKeyAccountPhrase,
  filterKeyAccountAudit,
} from "./fixtures.ts";
import { setKeyAccountLedgerMode } from "./ledger-mode.ts";
import {
  renderKeyAccountSurface,
  resetKeyAccountPageState,
  setKeyAccountLedgerKeyword,
} from "./page.ts";
import {
  KEY_ACCOUNT_ROUTES,
  KEY_ACCOUNT_TAB,
  keyAccountHref,
  keyAccountRoutesForPort,
  resolveKeyAccountRoute,
} from "./routes.ts";
import {
  findSignedAppPreinstallPackage,
  listSignedAppPreinstallPackages,
} from "./signed-app-catalog.ts";
import {
  associateSignedPackage,
  changeKeyAccountStatus,
  findKeyAccountPartner,
  listKeyAccountAuditEvents,
  publishWhiteLabel,
  rollbackWhiteLabel,
  saveWhiteLabelDraft,
  unlinkSignedPackage,
} from "./state.ts";

function templateText(node: unknown): string {
  const parts: string[] = [];
  const seen = new Set<object>();
  const visit = (value: unknown) => {
    if (typeof value === "string") {
      parts.push(value);
      return;
    }
    if (typeof value === "number") {
      parts.push(String(value));
      return;
    }
    if (!value || typeof value !== "object") {
      return;
    }
    if (seen.has(value)) {
      return;
    }
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }
    const record = value as {
      strings?: ArrayLike<string>;
      _$strings?: ArrayLike<string>;
      values?: unknown[];
    };
    const strings = record.strings ?? record._$strings;
    if (strings && record.values) {
      for (let index = 0; index < strings.length; index += 1) {
        parts.push(String(strings[index] ?? ""));
        if (index < record.values.length) {
          visit(record.values[index]);
        }
      }
    }
  };
  visit(node);
  return parts.join("");
}

const enterpriseMember = {
  bootstrapAuthMode: "trusted-proxy" as const,
  bootstrapAuthSession: {
    provider: "trusted-proxy" as const,
    user: "member@example.com",
    tenantId: "acme",
  },
  platformAuthState: {
    enabled: true,
    hasUsers: true,
    allowRegistration: false,
    membershipRole: "member" as const,
  },
};

const pages = [
  "/platform/key-accounts",
  "/platform/key-accounts/partners",
  `/platform/key-accounts/partners/${KEY_ACCOUNT_DEMO_DETAIL_CODE}`,
  "/platform/key-accounts/white-label",
  "/platform/key-accounts/preinstall",
  "/platform/key-accounts/settlement",
  "/platform/key-accounts/settlement/reconcile",
  "/platform/key-accounts/audit",
  "/platform/key-accounts/terms",
  "/platform/key-accounts/shipments",
] as const;

describe("key-account route registration", () => {
  beforeEach(() => {
    resetKeyAccountPageState();
  });

  it("registers K-01..K-08 only on the platform port", () => {
    expect(keyAccountRoutesForPort("platform").map((route) => route.page)).toEqual([
      "K-00",
      "K-01",
      "K-02",
      "K-03",
      "K-04",
      "K-05",
      "K-05",
      "K-06",
      "K-07",
      "K-08",
    ]);
    for (const route of KEY_ACCOUNT_ROUTES) {
      expect(route.port).toBe("platform");
      expect(route.issuesBilling).toBe(false);
      expect(route.path.startsWith("/platform/key-accounts")).toBe(true);
      expect(route.path.includes("productization")).toBe(false);
    }
    expect(
      KEY_ACCOUNT_ROUTES.filter((route) => route.priority === "P1").map((route) => route.page),
    ).toEqual(["K-06", "K-07"]);
    expect(
      KEY_ACCOUNT_ROUTES.filter((route) => route.priority === "P2").map((route) => route.id),
    ).toEqual(["settlementReconcile", "shipments"]);
    expect(KEY_ACCOUNT_ROUTES.filter((route) => route.readOnly).map((route) => route.page)).toEqual(
      ["K-00", "K-05", "K-06", "K-07", "K-08"],
    );
    expect(keyAccountRoutesForPort("employee")).toEqual([]);
    expect(keyAccountRoutesForPort("enterprise")).toEqual([]);
    expect(keyAccountRoutesForPort("ops")).toEqual([]);
    expect(PRODUCTIZATION_ROUTES.some((route) => route.path.includes("key-accounts"))).toBe(false);
  });

  it("resolves platform paths and keeps partner detail from collapsing", () => {
    expect(tabFromPath("/platform/key-accounts")).toBe(KEY_ACCOUNT_TAB);
    expect(tabFromPath("/platform/key-accounts/partners")).toBe("platformKeyAccounts");
    expect(tabFromPath("/platform/key-accounts/white-label")).toBe("platformKeyAccounts");
    expect(tabFromPath("/platform/key-accounts/preinstall")).toBe("platformKeyAccounts");
    expect(tabFromPath("/platform/key-accounts/settlement")).toBe("platformKeyAccounts");
    expect(tabFromPath("/platform/key-accounts/settlement/reconcile")).toBe("platformKeyAccounts");
    expect(tabFromPath("/platform/key-accounts/audit")).toBe("platformKeyAccounts");
    expect(tabFromPath("/platform/key-accounts/terms")).toBe("platformKeyAccounts");
    expect(tabFromPath("/platform/key-accounts/shipments")).toBe("platformKeyAccounts");
    expect(tabFromPath("/ui/platform/key-accounts/partners/KA-0011", "/ui")).toBe(
      "platformKeyAccounts",
    );
    expect(portForTab("platformKeyAccounts")).toBe("platform");
    expect(isPlatformTab("platformKeyAccounts")).toBe(true);
    expect(isEnterpriseTab("platformKeyAccounts")).toBe(false);
    expect(KEY_ACCOUNT_TAB).not.toBe(PRODUCTIZATION_TAB);

    const href = keyAccountHref("", "detail", "KA-0011");
    const match = matchTabRoute(href);
    expect(match?.tab).toBe("platformKeyAccounts");
    expect(match?.usedLegacyAlias).toBe(false);
    expect(match?.canonicalPath).toBe(href.toLowerCase());
    expect(resolveKeyAccountRoute(String(match?.canonicalPath)).partnerCode).toBe("KA-0011");
    expect(resolveKeyAccountRoute(href).id).toBe("detail");
    expect(resolveKeyAccountRoute(href).page).toBe("K-02");
    expect(resolveKeyAccountRoute("/platform/key-accounts/white-label").page).toBe("K-03");
    expect(resolveKeyAccountRoute("/platform/key-accounts/preinstall").page).toBe("K-04");
    expect(resolveKeyAccountRoute("/platform/key-accounts/settlement").page).toBe("K-05");
    expect(
      resolveKeyAccountRoute("/platform/key-accounts/settlement/reconcile", "", "?partner=KA-0011"),
    ).toEqual(
      expect.objectContaining({
        id: "settlementReconcile",
        page: "K-05",
        partnerCode: "KA-0011",
      }),
    );
    expect(resolveKeyAccountRoute("/platform/key-accounts/shipments").page).toBe("K-08");
    expect(resolveKeyAccountRoute("/platform/key-accounts/audit").page).toBe("K-06");
    expect(resolveKeyAccountRoute("/platform/key-accounts/audit").id).toBe("audit");
    expect(resolveKeyAccountRoute("/platform/key-accounts/terms", "", "?partner=KA-0011")).toEqual(
      expect.objectContaining({ id: "terms", page: "K-07", partnerCode: "KA-0011" }),
    );
    expect(keyAccountHref("/ui", "settlement", "KA-0018")).toBe(
      "/ui/platform/key-accounts/settlement?partner=KA-0018",
    );
    expect(keyAccountHref("/ui", "audit", "KA-0011")).toBe(
      "/ui/platform/key-accounts/audit?partner=KA-0011",
    );
    expect(keyAccountHref("", "terms", "KA-0018")).toBe(
      "/platform/key-accounts/terms?partner=KA-0018",
    );
    expect(keyAccountHref("", "settlementReconcile", "KA-0011")).toBe(
      "/platform/key-accounts/settlement/reconcile?partner=KA-0011",
    );
    expect(keyAccountHref("/ui", "shipments", "KA-0024")).toBe(
      "/ui/platform/key-accounts/shipments?partner=KA-0024",
    );
    expect(tabFromPath("/platform/productization/artifacts")).toBe("platformProductization");
  });

  it("does not register key accounts for employee or enterprise navigation", () => {
    expect(tabFromPath("/enterprise/acme/key-accounts")).not.toBe("platformKeyAccounts");
    expect(tabFromPath("/key-accounts")).toBeNull();
    expect(ENTERPRISE_SURFACE_TABS).not.toContain("platformKeyAccounts");
    for (const port of ["employee", "enterprise"] as const) {
      const tabs = tabGroupsForPort(port).flatMap((group) => [...group.tabs]);
      expect(tabs).not.toContain("platformKeyAccounts");
      expect(tabs).not.toContain("platformProductization");
    }
    expect(canAccessTab(enterpriseMember, "platformKeyAccounts")).toBe(false);
    const platformTabs = tabGroupsForPort("platform").flatMap((group) => [...group.tabs]);
    expect(platformTabs).toContain("platformKeyAccounts");
    expect(platformTabs).toContain("platformProductization");
    expect(platformTabs.indexOf("platformKeyAccounts")).not.toBe(
      platformTabs.indexOf("platformProductization"),
    );
  });

  it("stays on the SaaS full platform port", () => {
    expect(selectPortsForSurface("full")).toEqual([
      "employee",
      "enterprise",
      "platform",
      "diagnosis",
    ]);
    expect(selectPortsForSurface(undefined)).toContain("platform");
    expect(() => selectPortsForSurface("appliance")).toThrow(/full/);
    expect(KEY_ACCOUNT_ROUTES.some((route) => route.port !== "platform")).toBe(false);
  });
});

describe("key-account isolation from productization", () => {
  beforeEach(() => {
    resetKeyAccountPageState();
  });

  it("keeps two sibling nav sections instead of nesting under productization", () => {
    const productization = PLATFORM_NAV_SECTIONS.find(
      (section) => section.id === "platform-productization",
    );
    const keyAccounts = PLATFORM_NAV_SECTIONS.find(
      (section) => section.id === "platform-key-accounts",
    );
    expect(productization?.label).toBe("发布与制品");
    expect(productization?.subtitle).toBe("版本·通道·对账");
    expect(keyAccounts?.label).toBe("大客户管理");
    expect(keyAccounts?.subtitle).toBe("白牌·预装·授权·安装");
    expect(productization?.entries.every((entry) => entry.tab === "platformProductization")).toBe(
      true,
    );
    expect(keyAccounts?.entries.every((entry) => entry.tab === "platformKeyAccounts")).toBe(true);
    expect(
      productization?.entries.some((entry) => entry.pathSuffix?.includes("key-accounts")),
    ).toBe(false);
    expect(keyAccounts?.entries.map((entry) => entry.label)).toEqual([
      "交付状态",
      "伙伴台账",
      "伙伴详情",
      "白牌配置",
      "预装包关联",
      "结算对账入口",
      "域内审计",
      "合作条款摘要",
      "出货批次",
    ]);
    expect(keyAccounts?.entries.map((entry) => entry.pathSuffix)).toEqual([
      "",
      "/partners",
      "/partners/KA-0011",
      "/white-label",
      "/preinstall",
      "/settlement",
      "/audit",
      "/terms",
      "/shipments",
    ]);
    const productizationIndex = PLATFORM_NAV_SECTIONS.findIndex(
      (section) => section.id === "platform-productization",
    );
    const keyAccountIndex = PLATFORM_NAV_SECTIONS.findIndex(
      (section) => section.id === "platform-key-accounts",
    );
    expect(keyAccountIndex).toBe(productizationIndex + 1);
  });

  it("hides the other section when only one domain scope is held, and rejects the route", () => {
    const productizationOnly = visiblePlatformNavSections([PLATFORM_PRODUCTIZATION_READ]);
    expect(productizationOnly.some((section) => section.id === "platform-key-accounts")).toBe(
      false,
    );
    expect(productizationOnly.some((section) => section.id === "platform-productization")).toBe(
      true,
    );

    const keyAccountOnly = visiblePlatformNavSections([
      PLATFORM_KEY_ACCOUNT_READ,
      PLATFORM_KEY_ACCOUNT_WRITE,
    ]);
    expect(keyAccountOnly.some((section) => section.id === "platform-productization")).toBe(false);
    expect(keyAccountOnly.some((section) => section.id === "platform-key-accounts")).toBe(true);

    const both = visiblePlatformNavSections([
      PLATFORM_PRODUCTIZATION_WRITE,
      PLATFORM_KEY_ACCOUNT_READ,
    ]);
    expect(both.filter((section) => section.id.startsWith("platform-")).length).toBeGreaterThan(1);
    expect(both.some((section) => section.id === "platform-productization")).toBe(true);
    expect(both.some((section) => section.id === "platform-key-accounts")).toBe(true);

    const deniedKeyAccounts = templateText(
      renderKeyAccountSurface({
        basePath: "",
        pathname: "/platform/key-accounts/partners",
        scopes: [PLATFORM_PRODUCTIZATION_READ],
      }),
    );
    expect(deniedKeyAccounts).toContain('data-route-rejected="true"');
    expect(deniedKeyAccounts).toContain("路由已拒绝");
    expect(deniedKeyAccounts).not.toContain("KA-0011");

    const deniedProductization = templateText(
      renderProductizationSurface({
        basePath: "",
        pathname: "/platform/productization/artifacts",
        scopes: [PLATFORM_KEY_ACCOUNT_READ],
      }),
    );
    expect(deniedProductization).toContain("data-domain-denied=productization");
    expect(deniedProductization).not.toContain("制品总览");
  });
});

describe("key-account pages", () => {
  beforeEach(() => {
    resetKeyAccountPageState();
  });

  it("renders the P0 skeleton without forbidden phrases or billing issuance", () => {
    for (const pathname of pages) {
      const text = templateText(renderKeyAccountSurface({ basePath: "", pathname }));
      expect(text).toContain(`data-key-account-strategic=${KEY_ACCOUNT_STRATEGIC_REVISION}`);
      expect(text).toContain("演示数据");
      expect(containsForbiddenKeyAccountPhrase(text)).toBeNull();
      for (const phrase of KEY_ACCOUNT_FORBIDDEN_PHRASES) {
        expect(text).not.toContain(phrase);
      }
      expect(text).not.toContain("生成账单");
      expect(text).not.toContain("确认收款");
      expect(text).not.toContain("调整分成");
    }
  });

  it("shows the ledger, detail shortcuts, white-label skin, signed packages, and settlement placeholder", () => {
    const ledger = templateText(
      renderKeyAccountSurface({ basePath: "", pathname: "/platform/key-accounts/partners" }),
    );
    expect(ledger).toContain("KA-0011");
    expect(ledger).toContain("北境渠道");
    expect(ledger).toContain("渠道OEM");
    expect(ledger).toContain("新建伙伴");
    expect(ledger).toContain("SaaS 是唯一主运营路径");

    const detail = templateText(
      renderKeyAccountSurface({
        basePath: "",
        pathname: "/platform/key-accounts/partners/KA-0011",
      }),
    );
    expect(detail).toContain("白牌配置");
    expect(detail).toContain("预装包关联");
    expect(detail).toContain("结算对账入口");
    expect(detail).toContain("白牌预装");
    expect(detail).toContain("合作条款摘要");
    expect(detail).toContain("查看审计");
    expect(detail).toContain("/platform/key-accounts/terms?partner=KA-0011");
    expect(detail).toContain("/platform/key-accounts/audit?partner=KA-0011");
    expect(detail).toContain("CTR-KA-0011");

    const emptyLabel = templateText(
      renderKeyAccountSurface({
        basePath: "",
        pathname: "/platform/key-accounts/white-label",
        search: "?partner=KA-0018",
      }),
    );
    expect(emptyLabel).toContain("保存前不可对外称为已白牌出货");
    expect(emptyLabel).toContain("主题主色");

    const preinstall = templateText(
      renderKeyAccountSurface({
        basePath: "",
        pathname: "/platform/key-accounts/preinstall",
        search: "?partner=KA-0011",
      }),
    );
    expect(preinstall).toContain("app-pre-202610-a");
    expect(preinstall).toContain("已验签");
    expect(preinstall).not.toContain(UNSIGNED_APP_PACKAGE_ID);
    expect(preinstall).not.toContain('type="file"');

    const settlement = templateText(
      renderKeyAccountSurface({
        basePath: "",
        pathname: "/platform/key-accounts/settlement",
        search: "?partner=KA-0011",
      }),
    );
    expect(settlement).toContain("/platform/key-accounts/settlement/reconcile?partner=KA-0011");
    expect(settlement).not.toContain("#reconcile-view");
    expect(settlement).toContain("不在此签发账单");
    expect(settlement).toContain("复制伙伴结算标识");
    expect(settlement).toContain("2026-09");
    expect(settlement).toContain('data-settlement-slot="placeholder"');

    const reconcile = templateText(
      renderKeyAccountSurface({
        basePath: "",
        pathname: "/platform/key-accounts/settlement/reconcile",
        search: "?partner=KA-0011",
      }),
    );
    expect(reconcile).toContain('data-settlement-view="placeholder"');
    expect(reconcile).toContain("结算对账占位");
    expect(reconcile).toContain("settle-ka-0011");
    expect(reconcile).toContain("2026-09");
    expect(reconcile).toContain("返回结算入口");
    expect(reconcile).not.toContain("生成账单");
    expect(reconcile).not.toContain("确认收款");
    expect(reconcile).not.toContain("调整分成");
    expect(containsForbiddenKeyAccountPhrase(reconcile)).toBeNull();

    const shipments = templateText(
      renderKeyAccountSurface({
        basePath: "",
        pathname: "/platform/key-accounts/shipments",
        search: "?partner=KA-0011",
      }),
    );
    expect(shipments).toContain('data-ka-readonly="shipments"');
    expect(shipments).toContain("SHIP-202610-011");
    expect(shipments).toContain("app-pre-202610-a");
    expect(shipments).toContain("WL-v3");
    expect(shipments).not.toContain("SHIP-202610-024");
    expect(shipments).not.toContain("生成账单");
    expect(containsForbiddenKeyAccountPhrase(shipments)).toBeNull();
  });

  it("refuses an unsigned package id and leaves the partner links unchanged", () => {
    const before = findKeyAccountPartner("KA-0011")?.packageIds.slice() ?? [];
    const result = associateSignedPackage("KA-0011", UNSIGNED_APP_PACKAGE_ID);
    expect(result.tone).toBe("warn");
    expect(result.text).toContain("已签名 App 预装包");
    expect(findKeyAccountPartner("KA-0011")?.packageIds).toEqual(before);
    expect(containsForbiddenKeyAccountPhrase(result.text)).toBeNull();
  });

  it("renders read-only domain audit and contract terms without billing writes", () => {
    const audit = templateText(
      renderKeyAccountSurface({
        basePath: "",
        pathname: "/platform/key-accounts/audit",
        search: "?partner=KA-0011",
      }),
    );
    expect(audit).toContain("data-key-account-code=K-06");
    expect(audit).toContain('data-ka-readonly="audit"');
    expect(audit).toContain("只读，不能改写");
    expect(audit).toContain("伙伴状态变更");
    expect(audit).toContain("白牌发布");
    expect(audit).toContain("预装关联");
    expect(audit).toContain("WL-v3");
    expect(audit).toContain("app-pre-202610-a");
    expect(audit).toContain("北境渠道状态记为合作中");
    expect(audit).not.toContain("澄海集团进入伙伴台账");
    expect(audit).not.toContain("app-pre-202610-b");
    expect(audit).not.toContain("生成账单");
    expect(audit).not.toContain("确认收款");
    expect(audit).not.toContain("调整分成");
    expect(containsForbiddenKeyAccountPhrase(audit)).toBeNull();

    const terms = templateText(
      renderKeyAccountSurface({
        basePath: "",
        pathname: "/platform/key-accounts/terms",
        search: "?partner=KA-0024",
      }),
    );
    expect(terms).toContain("data-key-account-code=K-07");
    expect(terms).toContain('data-ka-readonly="terms"');
    expect(terms).toContain("CTR-KA-0024");
    expect(terms).toContain("批发");
    expect(terms).toContain("商务主数据（演示粘贴）");
    expect(terms).toContain("打开商务主数据外链");
    expect(terms).toContain("没有账单签发");
    expect(terms).not.toContain("生成账单");
    expect(terms).not.toContain("确认收款");
    expect(terms).not.toContain("调整分成");
    expect(terms).not.toContain('type="file"');
    expect(containsForbiddenKeyAccountPhrase(terms)).toBeNull();
  });

  it("filters audit rows and records demo domain actions without accepting an unsigned package", () => {
    const seeded = filterKeyAccountAudit(listKeyAccountAuditEvents(), {
      action: "白牌发布",
      partner: "KA-0011",
      keyword: "WL-v3",
    });
    expect(seeded.map((event) => event.id)).toEqual(["aud-ka-0011-label"]);

    publishWhiteLabel("KA-0011");
    const published = listKeyAccountAuditEvents()[0];
    expect(published?.action).toBe("白牌发布");
    expect(published?.at).toContain("演示");
    expect(published?.summary).toContain("不改制品 digest");

    changeKeyAccountStatus("KA-0018", "active", "演示确认合作");
    expect(listKeyAccountAuditEvents()[0]?.action).toBe("伙伴状态变更");
    expect(listKeyAccountAuditEvents()[0]?.partnerCode).toBe("KA-0018");

    unlinkSignedPackage("KA-0024", "app-pre-202610-b");
    expect(listKeyAccountAuditEvents()[0]?.action).toBe("预装解除关联");

    const before = listKeyAccountAuditEvents().length;
    associateSignedPackage("KA-0011", UNSIGNED_APP_PACKAGE_ID);
    expect(listKeyAccountAuditEvents()).toHaveLength(before);

    const visible = templateText(
      renderKeyAccountSurface({
        basePath: "",
        pathname: "/platform/key-accounts/audit",
        search: "?partner=KA-0018",
      }),
    );
    expect(visible).toContain("伙伴状态变更");
    expect(visible).toContain("演示确认合作");
    expect(containsForbiddenKeyAccountPhrase(visible)).toBeNull();
  });

  it("rejects key-account audit and terms when the operator only holds productization", () => {
    for (const pathname of ["/platform/key-accounts/audit", "/platform/key-accounts/terms"]) {
      const denied = templateText(
        renderKeyAccountSurface({
          basePath: "",
          pathname,
          scopes: [PLATFORM_PRODUCTIZATION_READ],
        }),
      );
      expect(denied).toContain('data-route-rejected="true"');
      expect(denied).toContain("data-domain-denied=key-accounts");
      expect(denied).not.toContain("CTR-KA-0011");
      expect(denied).not.toContain("域内只读");
    }
  });

  it("hides write actions when the operator only has key-account read", () => {
    const text = templateText(
      renderKeyAccountSurface({
        basePath: "",
        pathname: "/platform/key-accounts/partners",
        scopes: [PLATFORM_KEY_ACCOUNT_READ],
      }),
    );
    expect(text).toContain("KA-0011");
    expect(text).not.toContain("新建伙伴");
    const detail = templateText(
      renderKeyAccountSurface({
        basePath: "",
        pathname: "/platform/key-accounts/partners/KA-0011",
        scopes: [PLATFORM_KEY_ACCOUNT_READ],
      }),
    );
    expect(detail).toContain("查看审计");
    expect(detail).toContain("合作条款摘要");
    expect(detail).not.toContain("变更状态");
  });
});

describe("key-account P2 transitions", () => {
  beforeEach(() => {
    resetKeyAccountPageState();
  });

  it("changes partner status with a reason and records the audit feed", () => {
    const missing = changeKeyAccountStatus("KA-0018", "active", "  ");
    expect(missing.tone).toBe("warn");
    expect(findKeyAccountPartner("KA-0018")?.status).toBe("intent");

    const same = changeKeyAccountStatus("KA-0018", "intent", "重复确认");
    expect(same.tone).toBe("warn");
    expect(findKeyAccountPartner("KA-0018")?.statusReason).toBe("");

    const changed = changeKeyAccountStatus("KA-0018", "paused", "渠道封面尚未就绪");
    expect(changed.tone).toBe("ok");
    expect(findKeyAccountPartner("KA-0018")).toMatchObject({
      status: "paused",
      statusReason: "渠道封面尚未就绪",
      note: "直客大客户，尚未配置渠道封面。",
    });
    expect(listKeyAccountAuditEvents()[0]).toMatchObject({
      action: "伙伴状态变更",
      partnerCode: "KA-0018",
    });
    expect(listKeyAccountAuditEvents()[0]?.summary).toContain("从意向改为暂停");
    expect(listKeyAccountAuditEvents()[0]?.summary).toContain("渠道封面尚未就绪");

    const detail = templateText(
      renderKeyAccountSurface({
        basePath: "",
        pathname: "/platform/key-accounts/partners/KA-0018",
      }),
    );
    expect(detail).toContain("data-ka-status-select");
    expect(detail).toContain("data-ka-status-submit");
    expect(detail).toContain("变更状态");
    expect(detail).toContain("暂停");
    expect(detail).toContain("渠道封面尚未就绪");
    expect(containsForbiddenKeyAccountPhrase(detail)).toBeNull();
  });

  it("saves a white-label draft, publishes it onto associated packages, and rolls back", () => {
    const partner = findKeyAccountPartner("KA-0011");
    expect(partner?.published?.version).toBe("WL-v3");
    expect(partner?.publishedOntoPackageIds).toEqual(["app-pre-202610-a"]);

    const saved = saveWhiteLabelDraft("KA-0011", {
      displayName: "北境渠道封面",
      logoName: "north-mark.svg",
      primary: "#1F4B99",
      accent: "#E8EEF8",
      splash: "北境渠道工作台",
    });
    expect(saved.tone).toBe("ok");
    expect(findKeyAccountPartner("KA-0011")?.published?.version).toBe("WL-v3");
    expect(findKeyAccountPartner("KA-0011")?.draft?.displayName).toBe("北境渠道封面");

    const published = publishWhiteLabel("KA-0011");
    expect(published.tone).toBe("ok");
    expect(published.text).toContain("WL-v4");
    expect(published.text).toContain("app-pre-202610-a");
    expect(findKeyAccountPartner("KA-0011")?.published).toMatchObject({
      version: "WL-v4",
      displayName: "北境渠道封面",
    });
    expect(findKeyAccountPartner("KA-0011")?.previousPublished?.version).toBe("WL-v3");
    expect(findKeyAccountPartner("KA-0011")?.publishedOntoPackageIds).toEqual(["app-pre-202610-a"]);

    const rolled = rollbackWhiteLabel("KA-0011");
    expect(rolled.tone).toBe("ok");
    expect(rolled.text).toContain("WL-v3");
    expect(findKeyAccountPartner("KA-0011")?.published?.version).toBe("WL-v3");
    expect(findKeyAccountPartner("KA-0011")?.draft?.displayName).toBe("北境渠道");
    expect(listKeyAccountAuditEvents()[0]?.summary).toContain("回滚渠道封面到 WL-v3");
    expect(listKeyAccountAuditEvents()[0]?.summary).toContain("不改制品 digest");

    const empty = rollbackWhiteLabel("KA-0018");
    expect(empty.tone).toBe("warn");
    expect(empty.text).toContain("没有可回滚的上一版封面");

    const preview = templateText(
      renderKeyAccountSurface({
        basePath: "",
        pathname: "/platform/key-accounts/white-label",
        search: "?partner=KA-0011",
      }),
    );
    expect(preview).toContain('data-ka-preview="readonly"');
    expect(preview).toContain("预览只读示意");
    expect(preview).toContain("保存草稿");
    expect(preview).toContain("发布到关联预装配置");
    expect(preview).toContain("回滚上一版");
    expect(containsForbiddenKeyAccountPhrase(preview)).toBeNull();
  });

  it("associates only signed packages from the productization catalog", () => {
    const digestsBefore = PRODUCTIZATION_ARTIFACTS.map((artifact) => artifact.digest);
    const catalog = listSignedAppPreinstallPackages();
    expect(catalog.map((item) => item.id)).toEqual(["app-pre-202610-a", "app-pre-202610-b"]);
    expect(catalog.every((item) => item.signed && item.signature === "verified")).toBe(true);
    expect(findSignedAppPreinstallPackage(UNSIGNED_APP_PACKAGE_ID)).toBeNull();
    for (const item of catalog) {
      expect(
        PRODUCTIZATION_ARTIFACTS.some(
          (artifact) =>
            artifact.digest === item.artifactDigest && artifact.signature === "verified",
        ),
      ).toBe(true);
    }
    expect(PRODUCTIZATION_ARTIFACTS.map((artifact) => artifact.digest)).toEqual(digestsBefore);

    const linked = associateSignedPackage("KA-0018", "app-pre-202610-b");
    expect(linked.tone).toBe("ok");
    expect(findKeyAccountPartner("KA-0018")?.packageIds).toEqual(["app-pre-202610-b"]);
    expect(listKeyAccountAuditEvents()[0]?.summary).toContain("不改制品 digest");

    const refused = associateSignedPackage("KA-0018", "not-a-signed-package");
    expect(refused.tone).toBe("warn");
    expect(findKeyAccountPartner("KA-0018")?.packageIds).toEqual(["app-pre-202610-b"]);
    expect(PRODUCTIZATION_ARTIFACTS.map((artifact) => artifact.digest)).toEqual(digestsBefore);

    const preinstall = templateText(
      renderKeyAccountSurface({
        basePath: "",
        pathname: "/platform/key-accounts/preinstall",
        search: "?partner=KA-0018",
      }),
    );
    expect(preinstall).toContain("产品化已签名目录");
    expect(preinstall).toContain("app-pre-202610-a");
    expect(preinstall).toContain("app-pre-202610-b");
    expect(preinstall).not.toContain(UNSIGNED_APP_PACKAGE_ID);
    expect(preinstall).toContain("未发布到该关联");
    expect(preinstall).toContain("查看包元数据只读");
    expect(containsForbiddenKeyAccountPhrase(preinstall)).toBeNull();
  });
});

const DELIVERY_MARKETING_COPY = ["漏斗", "招商", "报价"] as const;

describe("key-account delivery board", () => {
  beforeEach(() => {
    resetKeyAccountPageState();
  });

  it("uses a five-state delivery home instead of a sales board", () => {
    expect(resolveKeyAccountRoute("/platform/key-accounts").id).toBe("delivery");
    expect(resolveKeyAccountRoute("/platform/key-accounts").page).toBe("K-00");
    expect(resolveKeyAccountRoute("/platform/key-accounts/partners").id).toBe("ledger");

    const board = templateText(
      renderKeyAccountSurface({ basePath: "", pathname: "/platform/key-accounts" }),
    );
    expect(board).toContain('data-ka-delivery="five-state"');
    expect(board).toContain("白牌·预装·授权·安装");
    expect(board).toContain("客户交付状态");
    expect(board).toContain("白牌");
    expect(board).toContain("预装");
    expect(board).toContain("授权");
    expect(board).toContain("安装");
    expect(board).toContain("结算入口");
    expect(board).toContain("KA-0011");
    expect(board).toContain("未绑定预装");
    expect(board).toContain("seq-108");
    expect(board).toContain("演示数据");
    expect(board).not.toContain("生成账单");
    expect(board).not.toContain("确认收款");
    expect(board).not.toContain("调整分成");
    for (const phrase of DELIVERY_MARKETING_COPY) {
      expect(board).not.toContain(phrase);
    }
    expect(containsForbiddenKeyAccountPhrase(board)).toBeNull();
  });

  it("links authorization and commerce from the partner detail without billing actions", () => {
    const detail = templateText(
      renderKeyAccountSurface({
        basePath: "",
        pathname: "/platform/key-accounts/partners/KA-0011",
      }),
    );
    expect(detail).toContain('data-ka-auth-block="readonly"');
    expect(detail).toContain("授权与签发");
    expect(detail).toContain("data-ka-seat-link");
    expect(detail).toContain("/platform/pricing");
    expect(detail).toContain("data-ka-commerce-link");
    expect(detail).toContain("/platform/pricing?tab=commerce");
    expect(detail).toContain('data-ka-install-track="readonly"');
    expect(detail).toContain("seq-112");
    expect(detail).not.toContain("生成账单");
    expect(detail).not.toContain("确认收款");
    expect(detail).not.toContain("调整分成");
    for (const phrase of DELIVERY_MARKETING_COPY) {
      expect(detail).not.toContain(phrase);
    }
  });

  it("tracks the bound train on the preinstall page", () => {
    const text = templateText(
      renderKeyAccountSurface({
        basePath: "",
        pathname: "/platform/key-accounts/preinstall",
        search: "?partner=KA-0011&train=112",
      }),
    );
    expect(text).toContain("data-ka-bound-train=112");
    expect(text).toContain("已对齐");
    expect(text).toContain("不写入 digest 台账");
    expect(text).toContain("预装不等于可用权益");

    const missed = templateText(
      renderKeyAccountSurface({
        basePath: "",
        pathname: "/platform/key-accounts/preinstall",
        search: "?partner=KA-0011&train=999",
      }),
    );
    expect(missed).toContain('data-empty-kind="filter-empty"');
    expect(missed).toContain("筛选无结果");
  });

  it("distinguishes unloaded, filtered, and disconnected delivery views", () => {
    setKeyAccountLedgerMode("unloaded");
    const unloaded = templateText(
      renderKeyAccountSurface({ basePath: "", pathname: "/platform/key-accounts" }),
    );
    expect(unloaded).toContain("data-empty-kind=demo-unloaded");
    expect(unloaded).toContain("演示未加载");
    expect(unloaded).toContain("演示数据");

    resetKeyAccountPageState();
    setDeliveryBoardKeyword("不存在的客户");
    const filtered = templateText(
      renderKeyAccountSurface({ basePath: "", pathname: "/platform/key-accounts" }),
    );
    expect(filtered).toContain("data-empty-kind=filter-empty");

    resetKeyAccountPageState();
    setKeyAccountLedgerKeyword("不存在的客户");
    const ledger = templateText(
      renderKeyAccountSurface({ basePath: "", pathname: "/platform/key-accounts/partners" }),
    );
    expect(ledger).toContain("data-empty-kind=filter-empty");
    expect(ledger).toContain("筛选无结果");

    resetKeyAccountPageState();
    setKeyAccountLedgerMode("disconnected");
    const disconnected = templateText(
      renderKeyAccountSurface({ basePath: "", pathname: "/platform/key-accounts/partners" }),
    );
    expect(disconnected).toContain("data-empty-kind=backend-disconnected");
    expect(disconnected).toContain("后端未联通");
    expect(disconnected).toContain("演示数据");
  });
});
