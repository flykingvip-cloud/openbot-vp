import { beforeEach, describe, expect, it } from "vitest";
import { i18n, t } from "../i18n/index.ts";
import {
  canonicalizeTab,
  CONSOLE_TABS,
  CONTROL_SECTION_TABS,
  ENTERPRISE_SURFACE_TABS,
  TAB_GROUPS,
  iconForTab,
  inferBasePathFromPathname,
  isControlSectionTab,
  isConsoleTab,
  isEnterpriseResolverPath,
  matchTabRoute,
  hasPlatformPricingSubRoute,
  hasCostBudgetUsageSubRoute,
  isPlatformModulePath,
  normalizeBasePath,
  normalizePath,
  parseCostBudgetSubRouteFromPath,
  pathForTab,
  portForTab,
  routeContextFromPath,
  subtitleForTab,
  tabFromPath,
  titleForTab,
  type Tab,
} from "./navigation.ts";

const ALL_TABS: Tab[] = [...TAB_GROUPS.flatMap((group) => group.tabs), ...CONSOLE_TABS] as Tab[];

beforeEach(async () => {
  await i18n.setLocale("en");
});

describe("iconForTab", () => {
  it("returns a non-empty string for every tab", () => {
    for (const tab of ALL_TABS) {
      const icon = iconForTab(tab);
      expect(icon).toBeTruthy();
      expect(typeof icon).toBe("string");
      expect(icon.length).toBeGreaterThan(0);
    }
  });

  it("returns stable icons for known tabs", () => {
    expect(iconForTab("chat")).toBe("messageSquare");
    expect(iconForTab("me")).toBe("user");
    expect(iconForTab("personas")).toBe("brain");
    expect(iconForTab("contacts")).toBe("users");
    expect(iconForTab("groups")).toBe("messagesSquare");
    expect(iconForTab("control")).toBe("settings");
    expect(iconForTab("platformDashboard")).toBe("barChart");
    expect(iconForTab("enterpriseOverview")).toBe("barChart");
    expect(iconForTab("opsIncidents")).toBe("barChart");
    expect(iconForTab("channels")).toBe("link");
    expect(iconForTab("instances")).toBe("radio");
    expect(iconForTab("sessions")).toBe("fileText");
    expect(iconForTab("cron")).toBe("loader");
    expect(iconForTab("skills")).toBe("zap");
    expect(iconForTab("models")).toBe("brain");
    expect(iconForTab("domains")).toBe("folder");
    expect(iconForTab("nodes")).toBe("monitor");
    expect(iconForTab("config")).toBe("settings");
    expect(iconForTab("debug")).toBe("bug");
    expect(iconForTab("logs")).toBe("scrollText");
  });

  it("returns a fallback icon for unknown tab", () => {
    // TypeScript won't allow this normally, but runtime could receive unexpected values
    const unknownTab = "unknown" as Tab;
    expect(iconForTab(unknownTab)).toBe("folder");
  });
});

describe("titleForTab", () => {
  it("returns a non-empty string for every tab", () => {
    for (const tab of ALL_TABS) {
      const title = titleForTab(tab);
      expect(title).toBeTruthy();
      expect(typeof title).toBe("string");
    }
  });

  it("returns expected titles", () => {
    expect(titleForTab("chat")).toBe(t("tabs.chat"));
    expect(titleForTab("me")).toBe(t("tabs.me"));
    expect(titleForTab("control")).toBe(t("tabs.control"));
    expect(titleForTab("platformDashboard")).toBe(t("tabs.platformDashboard"));
    expect(titleForTab("enterpriseOverview")).toBe(t("tabs.enterpriseOverview"));
    expect(titleForTab("enterpriseDataGovernanceCenter")).toBe(
      t("tabs.enterpriseDataGovernanceCenter"),
    );
    expect(titleForTab("opsIncidents")).toBe(t("tabs.opsIncidents"));
    expect(titleForTab("opsRecovery")).toBe(t("tabs.opsRecovery"));
  });

  it("has real translations for every enterprise sub-nav tab (no raw tabs.* key leaks)", () => {
    // t() returns the raw key when a locale entry is missing; that raw key would
    // be rendered verbatim in the sidebar if an enterprise sub-nav locale key regresses.
    for (const tab of ENTERPRISE_SURFACE_TABS) {
      expect(titleForTab(tab), `tabs.${tab} translation missing`).not.toBe(`tabs.${tab}`);
      expect(subtitleForTab(tab), `subtitles.${tab} translation missing`).not.toBe(
        `subtitles.${tab}`,
      );
    }
  });
});

describe("subtitleForTab", () => {
  it("returns a string for every tab", () => {
    for (const tab of ALL_TABS) {
      const subtitle = subtitleForTab(tab);
      expect(typeof subtitle).toBe("string");
    }
  });

  it("returns descriptive subtitles", () => {
    expect(subtitleForTab("chat")).toBe(t("subtitles.chat"));
    expect(subtitleForTab("platformDashboard")).toBe(t("subtitles.platformDashboard"));
    expect(subtitleForTab("config")).toContain("openbot.json");
  });
});

describe("canonicalizeTab", () => {
  it("maps legacy chat onto workbench home", () => {
    expect(canonicalizeTab("chat")).toBe("me");
  });

  it("maps retired ops aliases onto canonical ops tabs", () => {
    expect(canonicalizeTab("overview")).toBe("platformDashboard");
    expect(canonicalizeTab("sessions")).toBe("platformAdvanced");
    expect(canonicalizeTab("cron")).toBe("platformSystemSettings");
    expect(canonicalizeTab("debug")).toBe("platformAdvanced");
    expect(canonicalizeTab("logs")).toBe("platformAdvanced");
  });

  it("maps retired platform and enterprise aliases onto canonical tabs", () => {
    expect(canonicalizeTab("channels")).toBe("platformAdvanced");
    expect(canonicalizeTab("platformMarketplace")).toBe("platformCapabilities");
    expect(canonicalizeTab("platformLab")).toBe("platformModels");
    expect(canonicalizeTab("enterpriseDashboard")).toBe("enterpriseOverview");
    expect(canonicalizeTab("enterpriseCollaboration")).toBe("enterpriseMesh");
    expect(canonicalizeTab("enterpriseBudget")).toBe("enterpriseUsage");
    expect(canonicalizeTab("enterpriseModels")).toBe("enterpriseSettings");
    expect(canonicalizeTab("enterpriseModelPool")).toBe("enterpriseSettings");
  });
});

describe("portForTab", () => {
  it("maps legacy builder tab ids onto the platform port", () => {
    expect(portForTab("agents")).toBe("platform");
    expect(portForTab("skills")).toBe("platform");
    expect(portForTab("tools")).toBe("platform");
    expect(portForTab("models")).toBe("platform");
    expect(portForTab("releases")).toBe("platform");
  });

  it("never resolves to a retired builder port", () => {
    for (const tab of ["agents", "skills", "tools", "models", "releases"] as const) {
      expect(portForTab(tab)).not.toBe("builder");
    }
  });
});

describe("normalizeBasePath", () => {
  it("strips trailing file-like segments", () => {
    expect(normalizeBasePath("/2026全球具身智能趋势报告.pdf")).toBe("");
    expect(normalizeBasePath("/ui/report.pdf")).toBe("/ui");
  });

  it("returns empty string for falsy input", () => {
    expect(normalizeBasePath("")).toBe("");
  });

  it("adds leading slash if missing", () => {
    expect(normalizeBasePath("ui")).toBe("/ui");
  });

  it("removes trailing slash", () => {
    expect(normalizeBasePath("/ui/")).toBe("/ui");
  });

  it("returns empty string for root path", () => {
    expect(normalizeBasePath("/")).toBe("");
  });

  it("handles nested paths", () => {
    expect(normalizeBasePath("/apps/openclaw")).toBe("/apps/openclaw");
  });
});

describe("isPlatformModulePath", () => {
  it("matches platform root and module prefixes", () => {
    expect(isPlatformModulePath("/platform")).toBe(true);
    expect(isPlatformModulePath("/platform/pricing")).toBe(true);
    expect(isPlatformModulePath("/platform/pricing/plan-1")).toBe(true);
    expect(isPlatformModulePath("/enterprise/acme/usage/overview")).toBe(false);
    expect(isPlatformModulePath("/ui/platform/models")).toBe(true);
  });
});

describe("pathForTab platform href safety", () => {
  it("does not produce protocol-relative paths when basePath is root", () => {
    const href = pathForTab("platformPricing", "/");
    expect(href).toBe("/platform/pricing");
    expect(href.startsWith("//")).toBe(false);
  });
});

describe("normalizePath", () => {
  it("returns / for falsy input", () => {
    expect(normalizePath("")).toBe("/");
  });

  it("adds leading slash if missing", () => {
    expect(normalizePath("chat")).toBe("/chat");
  });

  it("removes trailing slash except for root", () => {
    expect(normalizePath("/chat/")).toBe("/chat");
    expect(normalizePath("/")).toBe("/");
  });
});

describe("pathForTab", () => {
  it("returns correct path without base", () => {
    expect(pathForTab("chat")).toBe("/");
    expect(pathForTab("trialApply")).toBe("/trial/apply");
    expect(pathForTab("enterpriseLogin")).toBe("/enterprise/login");
    expect(pathForTab("platformLogin")).toBe("/platform/login");
    expect(pathForTab("opsIncidents")).toBe("/platform");
    expect(pathForTab("platformDashboard")).toBe("/platform");
    expect(pathForTab("enterpriseOverview")).toBe("/enterprise");
    expect(pathForTab("enterpriseOrganization")).toBe("/enterprise/organization");
    expect(pathForTab("enterpriseDataGovernanceCenter")).toBe("/enterprise/data-governance");
    expect(pathForTab("enterpriseAgents")).toBe("/enterprise/capabilities");
    expect(pathForTab("enterpriseCapabilityCenter")).toBe("/enterprise/capabilities");
    expect(pathForTab("enterpriseMesh")).toBe("/enterprise/mesh");
    expect(pathForTab("enterpriseModelPool")).toBe("/enterprise/settings");
    expect(pathForTab("enterpriseModelPool", "", { tenantId: "acme" })).toBe(
      "/enterprise/acme/settings",
    );
    expect(pathForTab("enterpriseUsage")).toBe("/enterprise/usage");
    expect(pathForTab("enterpriseSettings")).toBe("/enterprise/settings");
    // Scheme A: 渠道凭证 nested under 系统设置 (no first-level nav item)
    expect(pathForTab("enterpriseChannels")).toBe("/enterprise/settings/channels");
    expect(pathForTab("enterpriseChannels", "", { tenantId: "acme" })).toBe(
      "/enterprise/acme/settings/channels",
    );
    expect(ALL_TABS.map(String)).not.toContain("workplaceInstall");
    expect(ALL_TABS.map(String)).not.toContain("feishuInstall");
    expect(pathForTab("platformSystemSettings")).toBe("/platform/system-settings");
    expect(pathForTab("platformAdvanced")).toBe("/platform/advanced");
    expect(pathForTab("agents")).toBe("/platform/agents");
    expect(pathForTab("skills")).toBe("/platform/capabilities");
    expect(pathForTab("tools")).toBe("/platform/advanced");
    expect(pathForTab("models")).toBe("/platform/models");
    expect(pathForTab("releases")).toBe("/platform/system-settings");
    expect(pathForTab("opsRuntime")).toBe("/platform/advanced");
    expect(pathForTab("me")).toBe("/");
  });

  it("prepends base path", () => {
    expect(pathForTab("chat", "/ui")).toBe("/ui");
    expect(pathForTab("trialApply", "/ui")).toBe("/ui/trial/apply");
    expect(pathForTab("enterpriseLogin", "/ui")).toBe("/ui/enterprise/login");
    expect(pathForTab("platformLogin", "/ui")).toBe("/ui/platform/login");
    expect(pathForTab("opsRuntime", "/apps/openclaw")).toBe("/apps/openclaw/platform/advanced");
    expect(pathForTab("platformDashboard", "/ui")).toBe("/ui/platform");
    expect(pathForTab("enterpriseOverview", "/ui")).toBe("/ui/enterprise");
    expect(pathForTab("enterpriseOrganization", "/ui")).toBe("/ui/enterprise/organization");
    expect(pathForTab("enterpriseDataGovernanceCenter", "/ui")).toBe(
      "/ui/enterprise/data-governance",
    );
    expect(pathForTab("enterpriseCapabilityCenter", "/ui")).toBe("/ui/enterprise/capabilities");
    expect(pathForTab("platformSystemSettings", "/ui")).toBe("/ui/platform/system-settings");
    expect(pathForTab("platformAdvanced", "/ui")).toBe("/ui/platform/advanced");
    expect(pathForTab("agents", "/ui")).toBe("/ui/platform/agents");
    expect(pathForTab("me", "/ui")).toBe("/ui");
  });

  it("builds tenant-bound enterprise routes when tenant context is present", () => {
    expect(pathForTab("enterpriseOverview", "", { tenantId: "acme" })).toBe(
      "/enterprise/acme/overview",
    );
    expect(pathForTab("enterpriseOrganization", "", { tenantId: "acme" })).toBe(
      "/enterprise/acme/organization/users",
    );
    expect(pathForTab("enterpriseDataGovernanceCenter", "", { tenantId: "acme" })).toBe(
      "/enterprise/acme/data-governance/overview",
    );
    expect(pathForTab("enterpriseCapabilityCenter", "", { tenantId: "acme" })).toBe(
      "/enterprise/acme/capabilities",
    );
  });

  it("builds stable object deep-links when cross-port context is present", () => {
    expect(
      pathForTab("opsRuntime", "", {
        context: { runtimeId: "runtime-42" },
      }),
    ).toBe("/platform/advanced/runtime/runtime-42");
    expect(
      pathForTab("enterpriseMesh", "", {
        tenantId: "acme",
        context: { groupId: "support" },
      }),
    ).toBe("/enterprise/acme/mesh/overview/groups/support");
    expect(
      pathForTab("enterpriseAgents", "", {
        tenantId: "acme",
        context: { agentId: "agent-7" },
      }),
    ).toBe("/enterprise/acme/capabilities");
    expect(
      pathForTab("enterpriseOrganization", "", {
        tenantId: "acme",
        context: { handoverCaseId: "handover-7" },
      }),
    ).toBe("/enterprise/acme/organization/handover/handover-7");
    expect(
      pathForTab("enterpriseUsage", "", {
        tenantId: "acme",
        context: { agentId: "agent-7" },
      }),
    ).toBe("/enterprise/acme/usage/overview/agents/agent-7");
    expect(
      pathForTab("enterpriseUsage", "", {
        tenantId: "acme",
        context: { groupId: "support" },
      }),
    ).toBe("/enterprise/acme/usage/overview/groups/support");
    expect(
      pathForTab("enterpriseCapabilityCenter", "", {
        tenantId: "acme",
        context: { capabilityId: "sales-priority" },
      }),
    ).toBe("/enterprise/acme/capabilities/sales-priority");
    expect(
      pathForTab("tools", "", {
        context: { capabilityId: "channel-core" },
      }),
    ).toBe("/platform/advanced");
  });

  it("redirects deprecated usage-management sub-routes into the capability center", () => {
    // 模块已整合：旧 `/usage-management/{sub}` 深链解析为能力中心对应路由段。
    expect(matchTabRoute("/enterprise/acme/usage-management/robots")?.tab).toBe(
      "enterpriseCapabilityCenter",
    );
    expect(matchTabRoute("/enterprise/acme/usage-management/analytics")?.context).toMatchObject({
      tenantId: "acme",
      enterpriseCapabilityRoute: "analytics",
    });
    expect(matchTabRoute("/enterprise/acme/usage-management/governance")?.context).toMatchObject({
      tenantId: "acme",
      enterpriseCapabilityRoute: "governance",
    });
    expect(matchTabRoute("/enterprise/acme/usage-management/installs")?.context).toMatchObject({
      tenantId: "acme",
      enterpriseCapabilityRoute: "install-management",
    });
  });

  it("builds capability-center routes for the deprecated usage-management tab via context", () => {
    for (const sub of ["robots", "analytics", "governance"] as const) {
      expect(
        pathForTab("enterpriseCapabilityCenter", "", {
          tenantId: "acme",
          context: { enterpriseCapabilityRoute: sub },
        }),
      ).toBe(`/enterprise/acme/capabilities/${sub}`);
    }
  });

  it("does not treat enterprise agent section names as agent object ids", () => {
    expect(routeContextFromPath("/enterprise/acme/agents/my-agents")).toEqual({
      tenantId: "acme",
      enterpriseCapabilityRoute: "robots",
    });
    expect(matchTabRoute("/enterprise/acme/agents/my-agents")?.canonicalPath).toBe(
      "/enterprise/acme/capabilities",
    );
  });

  it("maps legacy enterprise channels leaf to 系统设置 · 渠道凭证 (scheme A)", () => {
    const legacy = matchTabRoute("/enterprise/acme/channels");
    expect(legacy?.tab).toBe("enterpriseSettings");
    expect(legacy?.usedLegacyAlias).toBe(true);
    expect(legacy?.canonicalPath).toBe("/enterprise/acme/settings/channels");
    expect(legacy?.context).toMatchObject({ tenantId: "acme" });

    const nested = matchTabRoute("/enterprise/acme/settings/channels");
    expect(nested?.tab).toBe("enterpriseSettings");
    expect(nested?.usedLegacyAlias).toBe(false);
    expect(nested?.canonicalPath).toBe("/enterprise/acme/settings/channels");

    expect(ENTERPRISE_SURFACE_TABS).not.toContain("enterpriseChannels");
    expect(ENTERPRISE_SURFACE_TABS).not.toContain("enterpriseModelPool");
  });

  it("maps legacy /enterprise/budget onto cost and budget", () => {
    const root = matchTabRoute("/enterprise/budget");
    expect(root?.tab).toBe("enterpriseUsage");
    expect(root?.usedLegacyAlias).toBe(true);
    expect(root?.canonicalPath).toBe("/enterprise/usage");
    expect(root?.context).toBeNull();

    const tenant = matchTabRoute("/enterprise/acme/budget");
    expect(tenant?.tab).toBe("enterpriseUsage");
    expect(tenant?.usedLegacyAlias).toBe(true);
    expect(tenant?.canonicalPath).toBe("/enterprise/acme/usage/overview");
    expect(tenant?.context).toMatchObject({ tenantId: "acme" });

    expect(isEnterpriseResolverPath("/enterprise/budget")).toBe(true);
    expect(isEnterpriseResolverPath("/enterprise/diagnosis")).toBe(true);
    expect(isEnterpriseResolverPath("/enterprise/data-governance")).toBe(true);
  });
});

describe("tabFromPath", () => {
  it("returns tab for valid path", () => {
    expect(tabFromPath("/chat")).toBe("me");
    expect(tabFromPath("/ops/incidents")).toBe("platformDashboard");
    expect(tabFromPath("/enterprise/login")).toBe("enterpriseLogin");
    expect(tabFromPath("/platform/login")).toBe("platformLogin");
    expect(tabFromPath("/ope")).toBe("platformDashboard");
    expect(tabFromPath("/ops/runtime")).toBe("platformAdvanced");
    expect(tabFromPath("/platform")).toBe("platformDashboard");
    expect(tabFromPath("/enterprise")).toBe("enterpriseOverview");
    expect(tabFromPath("/enterprise/organization")).toBe("enterpriseOrganization");
    expect(tabFromPath("/enterprise/data-governance")).toBe("enterpriseDataGovernanceCenter");
    expect(tabFromPath("/enterprise/agents")).toBe("enterpriseCapabilityCenter");
    expect(tabFromPath("/enterprise/capabilities")).toBe("enterpriseCapabilityCenter");
    expect(tabFromPath("/enterprise/mesh")).toBe("enterpriseMesh");
    expect(tabFromPath("/enterprise/model-pool")).toBe("enterpriseSettings");
    expect(tabFromPath("/enterprise/acme/model-pool")).toBe("enterpriseSettings");
    expect(tabFromPath("/enterprise/usage")).toBe("enterpriseUsage");
    expect(tabFromPath("/enterprise/settings")).toBe("enterpriseSettings");
    expect(tabFromPath("/enterprise/acme/settings/channels")).toBe("enterpriseSettings");
    expect(tabFromPath("/enterprise/acme/channels")).toBe("enterpriseSettings");
    expect(tabFromPath("/builder")).toBe("platformCapabilities");
    expect(tabFromPath("/platform/system-settings")).toBe("platformSystemSettings");
    expect(tabFromPath("/platform/channels")).toBe("platformAdvanced");
    expect(tabFromPath("/builder/agents")).toBe("platformAgents");
    expect(tabFromPath("/builder/skills")).toBe("platformCapabilities");
    expect(tabFromPath("/enterprise/capabilities/incubation")).toBe("enterpriseCapabilityCenter");
    expect(tabFromPath("/enterprise/acme/mesh/executions")).toBe("enterpriseMesh");
    expect(tabFromPath("/enterprise/acme/data-governance/overview")).toBe(
      "enterpriseDataGovernanceCenter",
    );
    expect(tabFromPath("/enterprise/acme/capabilities")).toBe("enterpriseCapabilityCenter");
    expect(tabFromPath("/enterprise/acme/capabilities/incubation")).toBe(
      "enterpriseCapabilityCenter",
    );
  });

  it("returns me for root path", () => {
    expect(tabFromPath("/")).toBe("me");
  });

  it("keeps /me as a compatibility alias", () => {
    expect(tabFromPath("/me")).toBe("me");
  });

  it("handles base paths", () => {
    expect(tabFromPath("/ui/chat", "/ui")).toBe("me");
    expect(tabFromPath("/apps/openclaw/ops/runtime", "/apps/openclaw")).toBe("platformAdvanced");
    expect(tabFromPath("/ui/platform", "/ui")).toBe("platformDashboard");
    expect(tabFromPath("/ui/enterprise", "/ui")).toBe("enterpriseOverview");
  });

  it("keeps only the remaining non-ops root compatibility aliases", () => {
    expect(tabFromPath("/channels")).toBe("platformAdvanced");
    expect(tabFromPath("/ope")).toBe("platformDashboard");
    expect(tabFromPath("/overview")).toBeNull();
    expect(tabFromPath("/sessions")).toBeNull();
    expect(tabFromPath("/control")).toBeNull();
  });

  it("retires cross-port builder aliases but preserves new platform IA routes", () => {
    expect(tabFromPath("/platform/agents")).toBe("platformAgents");
    expect(tabFromPath("/platform/skills")).toBeNull();
    expect(tabFromPath("/platform/models")).toBe("platformModels");
    expect(tabFromPath("/control/channels")).toBeNull();
    expect(tabFromPath("/control/agents")).toBeNull();
    expect(tabFromPath("/control/models")).toBeNull();
  });

  it("retires legacy top-level builder aliases while redirecting builder namespace to platform", () => {
    expect(tabFromPath("/builder")).toBe("platformCapabilities");
    expect(tabFromPath("/builder/tools")).toBe("platformAdvanced");
    expect(tabFromPath("/builder/models")).toBe("platformModels");
    expect(tabFromPath("/builder/releases")).toBe("platformSystemSettings");
    expect(tabFromPath("/agents")).toBeNull();
    expect(tabFromPath("/skills")).toBeNull();
    expect(tabFromPath("/tools")).toBeNull();
    expect(tabFromPath("/models")).toBeNull();
    expect(tabFromPath("/releases")).toBeNull();
  });

  it("returns null for unknown path", () => {
    expect(tabFromPath("/unknown")).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(tabFromPath("/CHAT")).toBe("me");
    expect(tabFromPath("/OPS/INCIDENTS")).toBe("platformDashboard");
  });

  it("extracts enterprise route context from tenant-bound routes", () => {
    expect(routeContextFromPath("/enterprise/acme/overview")).toEqual({ tenantId: "acme" });
    expect(matchTabRoute("/enterprise/acme/organization/users")?.canonicalPath).toBe(
      "/enterprise/acme/organization/users",
    );
    expect(routeContextFromPath("/enterprise/acme/organization/handover/handover-7")).toEqual({
      tenantId: "acme",
      handoverCaseId: "handover-7",
    });
  });

  it("extracts stable cross-port deep-link context from object routes", () => {
    expect(routeContextFromPath("/enterprise/acme/agents/agent-7")).toEqual({
      tenantId: "acme",
      agentId: "agent-7",
      enterpriseCapabilityRoute: "robots",
    });
    expect(routeContextFromPath("/enterprise/acme/mesh/overview/groups/support")).toEqual({
      tenantId: "acme",
      groupId: "support",
    });
    expect(routeContextFromPath("/enterprise/acme/mesh/overview/people/alice@example.com")).toEqual(
      {
        tenantId: "acme",
        userId: "alice@example.com",
      },
    );
    expect(parseCostBudgetSubRouteFromPath("/enterprise/acme/usage/subscription")).toBe(
      "subscription",
    );
    expect(parseCostBudgetSubRouteFromPath("/enterprise/acme/usage/orders")).toBe("orders");
    expect(parseCostBudgetSubRouteFromPath("/enterprise/acme/usage/invoices")).toBe("invoices");
    expect(parseCostBudgetSubRouteFromPath("/enterprise/acme/usage/overview/agents/agent-7")).toBe(
      "overview",
    );
    expect(parseCostBudgetSubRouteFromPath("/enterprise/acme/usage/invalid")).toBeNull();
    expect(hasCostBudgetUsageSubRoute("/enterprise/acme/usage/plan-orders")).toBe(true);
    expect(hasCostBudgetUsageSubRoute("/enterprise/acme/usage/settings")).toBe(true);
    expect(hasCostBudgetUsageSubRoute("/enterprise/acme/usage/invalid")).toBe(false);
    expect(hasPlatformPricingSubRoute("/platform/pricing/plan-1")).toBe(true);
    expect(hasPlatformPricingSubRoute("/platform/pricing/new")).toBe(true);
    expect(hasPlatformPricingSubRoute("/platform/pricing/plans/plan-1")).toBe(true);
    expect(hasPlatformPricingSubRoute("/platform/pricing/plans")).toBe(true);
    expect(hasPlatformPricingSubRoute("/platform/pricing")).toBe(false);
    expect(routeContextFromPath("/enterprise/acme/usage/overview/agents/agent-7")).toEqual({
      tenantId: "acme",
      agentId: "agent-7",
    });
    expect(routeContextFromPath("/enterprise/acme/usage/overview/groups/support")).toEqual({
      tenantId: "acme",
      groupId: "support",
    });
    expect(routeContextFromPath("/enterprise/capabilities/incubation")).toEqual({
      enterpriseCapabilityRoute: "incubation",
    });
    expect(routeContextFromPath("/enterprise/acme/capabilities/incubation")).toEqual({
      tenantId: "acme",
      enterpriseCapabilityRoute: "incubation",
    });
    // 旧 usage-management 子路由整合后映射为能力中心路由段。
    expect(routeContextFromPath("/enterprise/acme/usage-management/analytics")).toEqual({
      tenantId: "acme",
      enterpriseCapabilityRoute: "analytics",
    });
    expect(routeContextFromPath("/enterprise/usage-management/governance")).toEqual({
      enterpriseCapabilityRoute: "governance",
    });
    expect(routeContextFromPath("/builder/tools/channel-core")).toEqual({
      capabilityId: "channel-core",
    });
    expect(routeContextFromPath("/ops/incidents/inc-99")).toEqual({
      incidentId: "inc-99",
    });
    expect(routeContextFromPath("/ops/runtime/runtime-42")).toEqual({
      sourcePage: "platformAdvanced",
      sourcePort: "platform",
      runtimeId: "runtime-42",
    });
  });

  it("recognizes the enterprise resolver route", () => {
    expect(isEnterpriseResolverPath("/enterprise")).toBe(true);
    expect(isEnterpriseResolverPath("/enterprise/acme/overview")).toBe(false);
  });
});

describe("inferBasePathFromPathname", () => {
  it("ignores file-like pathnames so __openbot stays origin-rooted", () => {
    expect(inferBasePathFromPathname("/2026全球具身智能趋势报告.pdf")).toBe("");
    expect(
      inferBasePathFromPathname(`/${encodeURIComponent("2026全球具身智能趋势报告.pdf")}`),
    ).toBe("");
    expect(inferBasePathFromPathname("/chat/2026全球具身智能趋势报告.pdf")).toBe("");
    expect(inferBasePathFromPathname("/ui/chat/report.pdf")).toBe("/ui");
    // Non-file prefix remains a candidate install base (same as pathname `/docs`).
    expect(inferBasePathFromPathname("/docs/guide.docx")).toBe("/docs");
  });

  it("returns empty string for root", () => {
    expect(inferBasePathFromPathname("/")).toBe("");
  });

  it("returns empty string for direct tab path", () => {
    expect(inferBasePathFromPathname("/chat")).toBe("");
    expect(inferBasePathFromPathname("/ops/incidents")).toBe("");
    expect(inferBasePathFromPathname("/platform")).toBe("");
    expect(inferBasePathFromPathname("/builder/agents")).toBe("");
    expect(inferBasePathFromPathname("/enterprise")).toBe("");
    expect(inferBasePathFromPathname("/platform/advanced")).toBe("");
  });

  it("infers base path from nested paths", () => {
    expect(inferBasePathFromPathname("/ui/chat")).toBe("/ui");
    expect(inferBasePathFromPathname("/apps/openclaw/ops/runtime")).toBe("/apps/openclaw");
    expect(inferBasePathFromPathname("/ui/platform")).toBe("/ui");
    expect(inferBasePathFromPathname("/ui/builder/agents")).toBe("/ui");
    expect(inferBasePathFromPathname("/ui/enterprise")).toBe("/ui");
    expect(inferBasePathFromPathname("/ui/platform/advanced")).toBe("/ui");
    expect(inferBasePathFromPathname("/ui/embed/employee/overview")).toBe("/ui");
  });

  it("does not treat employee embed routes as an install base path", () => {
    expect(inferBasePathFromPathname("/embed/employee/overview")).toBe("");
    expect(inferBasePathFromPathname("/embed/employee/me")).toBe("");
    expect(inferBasePathFromPathname("/embed")).toBe("");
  });

  it("does not treat retired route roots as app base paths", () => {
    expect(inferBasePathFromPathname("/control/agents")).toBe("");
    expect(inferBasePathFromPathname("/control-ui/enterprise/upbeyond/organization/users")).toBe(
      "",
    );
    expect(inferBasePathFromPathname("/platform/agents")).toBe("");
    expect(inferBasePathFromPathname("/builder")).toBe("");
    expect(inferBasePathFromPathname("/ope")).toBe("");
    expect(inferBasePathFromPathname("/agents")).toBe("");
  });

  it("handles index.html suffix", () => {
    expect(inferBasePathFromPathname("/index.html")).toBe("");
    expect(inferBasePathFromPathname("/ui/index.html")).toBe("/ui");
  });
});

describe("TAB_GROUPS", () => {
  it("contains all expected groups", () => {
    const labels = TAB_GROUPS.map((g) => g.label);
    expect(labels).toContain("frontstage");
    expect(labels).toContain("enterprise");
    expect(labels).toContain("platform");
    expect(labels).not.toContain("builder");
  });

  it("only reuses the shared dashboard entry tabs across groups", () => {
    const allTabs = TAB_GROUPS.flatMap((g) => g.tabs);
    const duplicates = allTabs.filter((tab, index) => allTabs.indexOf(tab) !== index);
    expect(new Set(duplicates)).toEqual(
      new Set(["platformDashboard", "enterpriseOverview", "opsIncidents"]),
    );
  });
});

describe("isConsoleTab", () => {
  it("recognizes console tabs and excludes frontstage tabs", () => {
    expect(isConsoleTab("opsIncidents")).toBe(true);
    expect(isConsoleTab("opsLogs")).toBe(true);
    expect(isConsoleTab("me")).toBe(false);
    expect(isConsoleTab("control")).toBe(true);
  });
});

describe("control navigation contracts", () => {
  it("keeps the primary control sections canonical and ordered", () => {
    expect(CONTROL_SECTION_TABS).toEqual([
      "opsIncidents",
      "channels",
      "sessions",
      "platformAgents",
      "enterpriseAgents",
    ]);
  });

  it("recognizes control sections as a subset of console tabs", () => {
    expect(isControlSectionTab("opsIncidents")).toBe(true);
    expect(isControlSectionTab("platformAgents")).toBe(true);
    expect(isControlSectionTab("cron")).toBe(false);
    expect(isControlSectionTab("me")).toBe(false);
  });
});
