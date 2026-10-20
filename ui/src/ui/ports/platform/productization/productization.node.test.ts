import { describe, expect, it } from "vitest";
import { selectPortsForSurface } from "../../../../../../scripts/openbot-surface.mjs";
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
import { createProductizationDemoState, saveChannelPointer } from "./channels.ts";
import { PRODUCTIZATION_ARTIFACTS, findArtifactByTrain, shortDigest } from "./fixtures.ts";
import { setProductizationLedgerMode } from "./ledger-mode.ts";
import {
  L1_FAIL_CLOSED_DETAIL,
  L1_READONLY_BANNER,
  PRODUCTIZATION_STRATEGIC_LINE,
  filterAuditEvents,
  filterL1Projections,
  l1ProjectionRows,
  setL1ControlPlaneAvailability,
} from "./p1-fixtures.ts";
import { openL1Projection } from "./p1-pages.ts";
import {
  openProductizationChannelPreview,
  renderProductizationSurface,
  resetProductizationPageState,
  setProductizationArtifactKeyword,
} from "./page.ts";
import { reconcileQuery } from "./reconcile.ts";
import {
  PRODUCTIZATION_ROUTES,
  productizationArtifactHref,
  productizationHref,
  productizationRoutesForPort,
  resolveProductizationRoute,
} from "./routes.ts";

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

describe("productization route registration", () => {
  it("registers P-01..P-08 only on the platform port", () => {
    expect(productizationRoutesForPort("platform").map((route) => route.page)).toEqual([
      "P-00",
      "P-01",
      "P-02",
      "P-03",
      "P-04",
      "P-05",
      "P-06",
      "P-07",
      "P-08",
    ]);
    for (const route of PRODUCTIZATION_ROUTES) {
      expect(route.port).toBe("platform");
      expect(route.writesLedger).toBe(false);
    }
    expect(productizationRoutesForPort("employee")).toEqual([]);
    expect(productizationRoutesForPort("enterprise")).toEqual([]);
    expect(productizationRoutesForPort("ops")).toEqual([]);
  });

  it("resolves platform paths and keeps detail paths from collapsing", () => {
    expect(tabFromPath("/platform/productization")).toBe("platformProductization");
    expect(tabFromPath("/platform/productization/artifacts")).toBe("platformProductization");
    expect(tabFromPath("/platform/productization/channels")).toBe("platformProductization");
    expect(tabFromPath("/platform/productization/reconcile")).toBe("platformProductization");
    expect(tabFromPath("/ui/platform/productization/l1", "/ui")).toBe("platformProductization");
    expect(portForTab("platformProductization")).toBe("platform");
    expect(isPlatformTab("platformProductization")).toBe(true);
    expect(isEnterpriseTab("platformProductization")).toBe(false);

    const artifact = findArtifactByTrain("112");
    expect(artifact).toBeTruthy();
    const href = productizationArtifactHref("", artifact!.digest);
    const match = matchTabRoute(href);
    expect(match?.tab).toBe("platformProductization");
    expect(match?.usedLegacyAlias).toBe(false);
    expect(match?.canonicalPath).toBe(href);
    expect(resolveProductizationRoute("/platform/productization").id).toBe("overview");
    expect(resolveProductizationRoute("/platform/productization").page).toBe("P-00");
    expect(resolveProductizationRoute("/platform/productization").title).toBe("发布概览");
    expect(resolveProductizationRoute("/platform/productization").subtitle).toContain(
      "发布与制品 · 版本列车",
    );
    expect(resolveProductizationRoute("/platform/productization/artifacts").id).toBe("artifacts");
    expect(resolveProductizationRoute(href).id).toBe("artifactDetail");
    expect(resolveProductizationRoute("/platform/productization/channels").page).toBe("P-03");
    expect(resolveProductizationRoute("/platform/productization/l1").page).toBe("P-05");
    expect(resolveProductizationRoute("/platform/productization/surfaces").page).toBe("P-06");
    expect(resolveProductizationRoute("/platform/productization/windows").page).toBe("P-07");
    expect(resolveProductizationRoute("/platform/productization/audit").page).toBe("P-08");
    expect(productizationHref("/ui", "surfaces")).toBe("/ui/platform/productization/surfaces");
    expect(productizationHref("/ui", "windows")).toBe("/ui/platform/productization/windows");
    expect(productizationHref("/ui", "audit")).toBe("/ui/platform/productization/audit");
    expect(productizationHref("/ui", "reconcile")).toBe("/ui/platform/productization/reconcile");
  });

  it("does not register productization for employee or enterprise navigation", () => {
    expect(tabFromPath("/enterprise/acme/productization")).not.toBe("platformProductization");
    expect(tabFromPath("/productization")).toBeNull();
    expect(ENTERPRISE_SURFACE_TABS).not.toContain("platformProductization");
    for (const port of ["employee", "enterprise"] as const) {
      const tabs = tabGroupsForPort(port).flatMap((group) => [...group.tabs]);
      expect(tabs).not.toContain("platformProductization");
    }
    expect(canAccessTab(enterpriseMember, "platformProductization")).toBe(false);
    expect(
      tabGroupsForPort("platform")
        .flatMap((group) => [...group.tabs])
        .includes("platformProductization"),
    ).toBe(true);
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
    expect(PRODUCTIZATION_ROUTES.some((route) => route.port !== "platform")).toBe(false);
  });
});

describe("productization reconcile and channel guard", () => {
  it("aligns a train entry and rejects a wild digest without writing", () => {
    const linked = reconcileQuery({ trainSeq: "seq-112" });
    expect(linked.outcome).toBe("drift");
    expect(linked.wrote).toBe(false);
    expect(linked.cards.map((card) => card.status)).toEqual(["aligned", "drift", "aligned"]);
    expect(linked.diffs.some((diff) => diff.includes("关联 digest"))).toBe(true);

    const drifted = reconcileQuery({ trainSeq: "108" });
    expect(drifted.outcome).toBe("drift");
    expect(drifted.wrote).toBe(false);
    expect(drifted.diffs.length).toBeGreaterThan(0);

    const wild = reconcileQuery({ digest: `sha256:${"ab".repeat(32)}` });
    expect(wild.outcome).toBe("rejected");
    expect(wild.code).toBe("wild-digest");
    expect(wild.wrote).toBe(false);

    const other = findArtifactByTrain("108");
    const crossed = reconcileQuery({ trainSeq: "112", digest: other?.digest });
    expect(crossed.code).toBe("cross-artifact");
    expect(crossed.wrote).toBe(false);
  });

  it("refuses wild, unreconciled, and fleet writes", () => {
    expect(Object.isFrozen(PRODUCTIZATION_ARTIFACTS)).toBe(true);
    const state = createProductizationDemoState();
    const digests = state.channels.map((channel) => channel.currentDigest);
    const wild = saveChannelPointer(state, {
      channelId: "stable-cloud",
      name: "云发布稳定",
      description: "",
      kind: "cloud-release",
      digest: `sha256:${"cd".repeat(32)}`,
      confirmed: true,
    });
    expect(wild.result).toMatchObject({ ok: false, code: "wild-digest" });
    expect(wild.state).toBe(state);
    expect(state.channels.map((channel) => channel.currentDigest)).toEqual(digests);

    const retired = findArtifactByTrain("101");
    const blocked = saveChannelPointer(state, {
      channelId: "stable-cloud",
      name: "云发布稳定",
      description: "",
      kind: "cloud-release",
      digest: retired!.digest,
      confirmed: true,
    });
    expect(blocked.result).toMatchObject({ ok: false, code: "unreconciled" });
    expect(blocked.state.channels.map((channel) => channel.currentDigest)).toEqual(digests);

    const fleet = saveChannelPointer(state, {
      channelId: "fleet-hw-stable",
      name: "Fleet 镜像（非主路径）",
      description: "",
      kind: "cloud-release",
      digest: findArtifactByTrain("112")!.digest,
      confirmed: true,
    });
    expect(fleet.result).toMatchObject({ ok: false, code: "fleet-readonly" });

    const unconfirmed = saveChannelPointer(state, {
      channelId: null,
      name: "临时云通道",
      description: "演示",
      kind: "joint-review",
      digest: findArtifactByTrain("109")!.digest,
      confirmed: false,
    });
    expect(unconfirmed.result).toMatchObject({ ok: false, code: "unreconciled" });
    expect(unconfirmed.state.channels).toHaveLength(state.channels.length);

    const created = saveChannelPointer(unconfirmed.state, {
      channelId: null,
      name: "临时云通道",
      description: "演示",
      kind: "joint-review",
      digest: findArtifactByTrain("109")!.digest,
      confirmed: true,
      idFactory: () => "cloud-demo-test",
    });
    expect(created.result).toMatchObject({ ok: false, code: "unreconciled" });
    expect(created.state.channels).toHaveLength(unconfirmed.state.channels.length);
    expect(shortDigest(findArtifactByTrain("112")!.digest)).toMatch(/…$/);
  });
});

describe("productization pages", () => {
  it("renders P0 pages without a license action or a wild-digest write", () => {
    resetProductizationPageState();
    const artifact = findArtifactByTrain("112");
    const pages = [
      "/platform/productization/artifacts",
      productizationArtifactHref("", artifact!.digest),
      "/platform/productization/channels",
      "/platform/productization/reconcile",
    ];
    for (const pathname of pages) {
      const text = templateText(renderProductizationSurface({ basePath: "", pathname }));
      expect(text).not.toContain("签发");
      expect(text).not.toContain("吊销");
      expect(text).not.toContain("换机");
    }

    const detail = templateText(
      renderProductizationSurface({
        basePath: "",
        pathname: productizationArtifactHref("", artifact!.digest),
      }),
    );
    expect(detail).toContain("打开对账台");
    expect(detail).toContain("复制 digest");
    expect(detail).toContain(artifact!.digest);
    expect(detail).not.toContain("签发许可");

    const channels = templateText(
      renderProductizationSurface({
        basePath: "",
        pathname: "/platform/productization/channels",
      }),
    );
    expect(channels).toContain("license-cloud");
    expect(channels).toContain("不是近端必经控制面");
    expect(channels).not.toContain("硬件 Fleet");

    const wild = templateText(
      renderProductizationSurface({
        basePath: "",
        pathname: "/platform/productization/reconcile",
        search: `?digest=${encodeURIComponent(`sha256:${"ab".repeat(32)}`)}`,
      }),
    );
    expect(wild).toContain("拒绝野版");
    expect(wild).toContain("未写入");
  });

  it("fail-closes L1 when the control plane is unavailable", () => {
    resetProductizationPageState();
    const text = templateText(
      renderProductizationSurface({
        basePath: "",
        pathname: "/platform/productization/l1",
      }),
    );
    expect(text).toContain(L1_READONLY_BANNER);
    expect(text).toContain(L1_FAIL_CLOSED_DETAIL);
    expect(text).toContain("不伪造准入数据");
    expect(text).toContain("深链说明");
    expect(text).not.toContain("lic-demo-");
    expect(text).not.toContain("签发许可");
    expect(text).not.toContain("发起换机");
    expect(l1ProjectionRows()).toEqual([]);
  });
});

const P1_PAGES = [
  "/platform/productization/l1",
  "/platform/productization/surfaces",
  "/platform/productization/windows",
  "/platform/productization/audit",
] as const;

const FORBIDDEN_OEM_SHIP_COPY = [
  "OEM 主路径",
  "私有整包出货",
  "私有整包",
  "Fleet 是 OEM 必经",
  "一体机是主运营",
  "一体机私有化",
  "一次买断",
  "Appliance Runtime",
  "OEM Runtime",
  "私有化 OpenBot",
  "一机一装",
  "license-cloud 为主写",
  "硬件 Fleet",
  "双轨",
  "平台不可达双闸",
  "薄 L1",
  "本机能力",
];

const PRODUCTIZATION_VISIBLE_PAGES = [
  "/platform/productization/artifacts",
  "/platform/productization/channels",
  "/platform/productization/reconcile",
  ...P1_PAGES,
] as const;

describe("productization P1 pages", () => {
  it("keeps P1 routes on the platform port and states the SaaS primary path", () => {
    resetProductizationPageState();
    for (const pathname of P1_PAGES) {
      const view = resolveProductizationRoute(pathname);
      expect(view.page).toMatch(/^P-0[5-8]$/);
      const text = templateText(renderProductizationSurface({ basePath: "", pathname }));
      expect(text).toContain(PRODUCTIZATION_STRATEGIC_LINE);
      expect(text).not.toContain("appliance");
      expect(text).toContain("data-productization-strategic=2026-10-10");
      expect(text).not.toContain("签发许可");
      expect(text).not.toContain("私钥材料");
      for (const phrase of FORBIDDEN_OEM_SHIP_COPY) {
        expect(text, pathname).not.toContain(phrase);
      }
    }
    expect(productizationRoutesForPort("employee")).toEqual([]);
    expect(productizationRoutesForPort("enterprise")).toEqual([]);
  });

  it("shows a read-only L1 drawer only after the control plane is marked available", () => {
    resetProductizationPageState();
    setL1ControlPlaneAvailability("available");
    openL1Projection("lic-demo-014");
    const text = templateText(
      renderProductizationSurface({
        basePath: "",
        pathname: "/platform/productization/l1",
      }),
    );
    expect(text).toContain("lic-demo-014");
    expect(text).toContain("查看");
    expect(text).toContain("控制面只读许可视图 /licenses/lic-demo-014");
    expect(text).toContain(L1_READONLY_BANNER);
    expect(text).not.toContain("href=");
    expect(text).not.toContain("签发许可");
    expect(text).not.toContain("吊销许可");
    expect(text).not.toContain("发起换机");
    expect(
      filterL1Projections(l1ProjectionRows(), {
        oemId: "oem-channel-other",
        tenantId: "",
        sku: "",
        status: "all",
        keyword: "",
      }).map((row) => row.licenseId),
    ).toEqual(["lic-demo-016"]);
  });

  it("describes only the SaaS full surface in the capability matrix", () => {
    resetProductizationPageState();
    const text = templateText(
      renderProductizationSurface({
        basePath: "",
        pathname: "/platform/productization/surfaces",
      }),
    );
    expect(text).toContain("full · SaaS 主路径");
    expect(text).not.toContain("appliance");
    expect(text).toContain("平台端产品化工作台");
    expect(text).toContain("不含");
    expect(text).toContain("渠道白标、换肤预装与结算");
    expect(text).toContain("本页只描述 SaaS full");
    expect(text).not.toContain("平台不可达双闸");
  });

  it("keeps forbidden OEM ship phrases off productization pages", () => {
    resetProductizationPageState();
    const artifact = findArtifactByTrain("112");
    const drifted = findArtifactByTrain("108");
    const pages = [
      ...PRODUCTIZATION_VISIBLE_PAGES.map((pathname) => ({ pathname, search: "" })),
      { pathname: productizationArtifactHref("", artifact!.digest), search: "" },
      { pathname: productizationArtifactHref("", drifted!.digest), search: "" },
      { pathname: "/platform/productization/reconcile", search: "?train=108" },
    ];
    for (const page of pages) {
      const text = templateText(renderProductizationSurface({ basePath: "", ...page }));
      for (const phrase of FORBIDDEN_OEM_SHIP_COPY) {
        expect(text, `${page.pathname} ${phrase}`).not.toContain(phrase);
      }
      expect(text).toContain(PRODUCTIZATION_STRATEGIC_LINE);
      expect(text).not.toContain("appliance");
    }

    resetProductizationPageState();
    setL1ControlPlaneAvailability("available");
    openL1Projection("lic-demo-014");
    const l1 = templateText(
      renderProductizationSurface({ basePath: "", pathname: "/platform/productization/l1" }),
    );
    for (const phrase of FORBIDDEN_OEM_SHIP_COPY) {
      expect(l1, phrase).not.toContain(phrase);
    }
    expect(l1).toContain("设备标记");
    expect(l1).toContain("不是出货指标");

    resetProductizationPageState();
    openProductizationChannelPreview("fleet-hw-stable");
    const fleet = templateText(
      renderProductizationSurface({
        basePath: "",
        pathname: "/platform/productization/channels",
      }),
    );
    for (const phrase of FORBIDDEN_OEM_SHIP_COPY) {
      expect(fleet, phrase).not.toContain(phrase);
    }
    expect(fleet).toContain("不是近端必经控制面");
  });

  it("narrates SaaS cloud release windows without a GO write action", () => {
    resetProductizationPageState();
    const artifact = findArtifactByTrain("112");
    const text = templateText(
      renderProductizationSurface({
        basePath: "",
        pathname: "/platform/productization/windows",
      }),
    );
    expect(text).toContain("云侧稳定窗口");
    expect(text).toContain("只读 GO");
    expect(text).toContain("SaaS 云侧候选窗口");
    expect(text).toContain(shortDigest(artifact!.digest));
    expect(text).not.toContain("确认放行");
    expect(text).not.toContain("Fleet 通道");
  });

  it("lists productization-domain audit fixtures as read-only", () => {
    resetProductizationPageState();
    const text = templateText(
      renderProductizationSurface({
        basePath: "",
        pathname: "/platform/productization/audit",
      }),
    );
    expect(text).toContain("云侧通道改指");
    expect(text).toContain("对账拒绝野版");
    expect(text).toContain("不提供写入入口");
    expect(text).toContain("无补写入口");
    expect(text).not.toContain("补写审计");
    expect(
      filterAuditEvents(
        [
          {
            id: "aud-demo-wild",
            at: "2026-10-09 15:01",
            actor: "productization.demo",
            action: "对账拒绝野版",
            objectType: "digest",
            objectId: "列车外 digest",
            result: "拒绝",
            summary: "对账台拒绝列车外 digest，未写入台账。",
          },
        ],
        { action: "对账拒绝野版", result: "all", keyword: "未写入" },
      ),
    ).toHaveLength(1);
  });
});

const DELIVERY_MARKETING_COPY = ["漏斗", "招商", "报价"] as const;

describe("productization delivery overview", () => {
  it("lands on release health and keeps artifacts reachable", () => {
    resetProductizationPageState();
    const overview = templateText(
      renderProductizationSurface({ basePath: "", pathname: "/platform/productization" }),
    );
    expect(overview).toContain("data-productization-page=overview");
    expect(overview).toContain("发布与制品 · 版本列车");
    expect(overview).toContain("发布健康");
    expect(overview).toContain("通道对齐");
    expect(overview).toContain("3/3");
    expect(overview).toContain("待晋升");
    expect(overview).toContain("seq-109");
    expect(overview).toContain("seq-108");
    expect(overview).toContain("data-pz-drift-count=1");
    expect(overview).toContain("/platform/pricing");
    expect(overview).toContain("演示夹具");
    expect(overview).not.toContain("签发");
    for (const phrase of DELIVERY_MARKETING_COPY) {
      expect(overview).not.toContain(phrase);
    }
    for (const phrase of FORBIDDEN_OEM_SHIP_COPY) {
      expect(overview).not.toContain(phrase);
    }

    const artifacts = templateText(
      renderProductizationSurface({
        basePath: "",
        pathname: "/platform/productization/artifacts",
      }),
    );
    const trainAt = artifacts.indexOf("列车序号");
    const versionAt = artifacts.indexOf("版本叙事", trainAt);
    const signatureAt = artifacts.indexOf("签名", versionAt);
    const channelAt = artifacts.indexOf("通道", signatureAt);
    expect(trainAt).toBeGreaterThan(artifacts.indexOf("状态"));
    expect(versionAt).toBeGreaterThan(trainAt);
    expect(signatureAt).toBeGreaterThan(versionAt);
    expect(channelAt).toBeGreaterThan(signatureAt);
    expect(artifacts).toContain("data-pz-drift=true");
    expect(artifacts).toContain("data-pz-drift=false");
    expect(artifacts).toContain("漂移");
  });

  it("offers a channel edit only after a ledger reconcile", () => {
    resetProductizationPageState();
    const drifted = templateText(
      renderProductizationSurface({
        basePath: "",
        pathname: "/platform/productization/reconcile",
        search: "?train=108",
      }),
    );
    expect(drifted).toContain("去改通道");
    expect(drifted).toContain("data-pz-go-channel");
    expect(drifted).toContain("/platform/productization/channels");
    expect(drifted).toContain("不会写入野版");

    const wild = templateText(
      renderProductizationSurface({
        basePath: "",
        pathname: "/platform/productization/reconcile",
        search: `?digest=${encodeURIComponent(`sha256:${"ab".repeat(32)}`)}`,
      }),
    );
    expect(wild).toContain("拒绝野版");
    expect(wild).not.toContain("去改通道");
    expect(wild).not.toContain("签发");
  });

  it("keeps install cross-references read-only on artifact detail", () => {
    resetProductizationPageState();
    const artifact = findArtifactByTrain("112");
    const detail = templateText(
      renderProductizationSurface({
        basePath: "",
        pathname: productizationArtifactHref("", artifact!.digest),
      }),
    );
    expect(detail).toContain('data-pz-install-xref="readonly"');
    expect(detail).toContain("关联的预装（只读）");
    expect(detail).toContain("app-pre-202610-a");
    expect(detail).toContain("不写入 digest 台账");
    expect(detail).toContain("打开对账台");
    expect(detail).not.toContain("签发");
  });

  it("distinguishes unloaded, filtered, and disconnected artifact lists", () => {
    resetProductizationPageState();
    setProductizationLedgerMode("unloaded");
    const unloaded = templateText(
      renderProductizationSurface({
        basePath: "",
        pathname: "/platform/productization/artifacts",
      }),
    );
    expect(unloaded).toContain("data-empty-kind=demo-unloaded");
    expect(unloaded).toContain("演示未加载");
    expect(unloaded).toContain("演示夹具");

    resetProductizationPageState();
    setProductizationArtifactKeyword("没有这条列车");
    const filtered = templateText(
      renderProductizationSurface({
        basePath: "",
        pathname: "/platform/productization/artifacts",
      }),
    );
    expect(filtered).toContain("data-empty-kind=filter-empty");
    expect(filtered).toContain("筛选无结果");

    resetProductizationPageState();
    setProductizationLedgerMode("disconnected");
    const disconnected = templateText(
      renderProductizationSurface({
        basePath: "",
        pathname: "/platform/productization",
      }),
    );
    expect(disconnected).toContain("data-empty-kind=backend-disconnected");
    expect(disconnected).toContain("后端未联通");
    expect(disconnected).toContain("演示夹具");
  });
});
