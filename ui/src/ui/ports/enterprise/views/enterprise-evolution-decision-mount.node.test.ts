// @vitest-environment jsdom
/**
 * D3.3 mount tests: the enterprise Mesh page and the closed runtime gate.
 * The page imports the enterprise Decision Surface element and would place it
 * after the Mesh surface only when the reviewed gate is open. It is closed.
 * Claim grade: code-present. Not runtime-enabled. Not production-proven.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "lit";
import { afterEach, describe, expect, it } from "vitest";
import { EVOLUTION_ENTERPRISE_DECISION_COPY } from "../evolution-decision/copy.ts";
import { enterprisePrincipal } from "../evolution-decision/evolution-decision-test-fixtures.ts";
import { enterpriseEvolutionDecisionSurfaceMountEnabled } from "../evolution-decision/runtime-gate.ts";
import type { EnterprisePortReadModel } from "../semantic/enterprise-read-model.ts";
import { renderMeshGovernanceSurface } from "./enterprise-mesh-governance-surface.ts";
import type { EnterpriseSurfaceProps } from "./enterprise-surface-types.ts";
import { renderEnterpriseSurface } from "./enterprise-surfaces-core.ts";

const TAG = "enterprise-evolution-decision-surface";
const CORE = "ui/src/ui/ports/enterprise/views/enterprise-surfaces-core.ts";

function noop() {}

/** Any action group and handler the Mesh page asks for is a no-op. */
const noopActions = new Proxy(
  {},
  {
    get: (_target, group) =>
      group === "then"
        ? undefined
        : new Proxy({}, { get: (_inner, key) => (key === "then" ? undefined : noop) }),
  },
);

function meshReadModel(): EnterprisePortReadModel {
  return {
    currentTenantId: "acme",
    currentTenantLabel: "Acme",
    authenticatedUser: "admin@example.com",
    membershipRole: "enterprise-admin",
    connected: true,
    memberCount: 1,
    memberUsers: ["admin@example.com"],
    memberSummaries: [],
    adminCount: 1,
    seatCount: 0,
    occupiedSeatCount: 0,
    vacantSeatCount: 0,
    handoverSeatCount: 0,
    frozenSeatCount: 0,
    handoverCaseCount: 0,
    pendingOfferCount: 0,
    seatSummaries: [],
    handoverSummaries: [],
    offerSummaries: [],
    agentCount: 1,
    defaultAgentId: "main",
    presenceCount: 1,
    runtimeHosts: [],
    sessionsCount: 0,
    nodeCount: 1,
    groupIds: [],
    cronJobCount: 0,
    meshSummary: {
      userCount: 1,
      agentCount: 1,
      groupCount: 0,
      onlineAgentCount: 1,
      activeAgentCount: 1,
      activeGroupCount: 0,
      activeAgentRate: 1,
      activeGroupRate: 0,
      totalCost: 0,
      totalTokens: 0,
      costPerSession: 0,
      sessionCount: 0,
      inefficientAssetCount: 0,
      unattributedCostCount: 0,
      unownedAssetCount: 0,
      governanceIssueCount: 0,
    },
    meshUsers: [],
    meshAgents: [],
    meshGroups: [],
    meshAnomalies: [],
    totalTokens: 0,
    totalCost: 0,
    channelIds: [],
    providerIds: [],
    configuredModelIds: [],
    configIssueLabels: [],
    resolverOptions: [],
  } as unknown as EnterprisePortReadModel;
}

function meshProps(extra: Record<string, unknown> = {}): EnterpriseSurfaceProps {
  return {
    tab: "enterpriseMesh",
    basePath: "",
    readModel: meshReadModel(),
    actions: noopActions,
    authPanelProps: {
      basePath: "",
      state: {
        enabled: true,
        sessionKind: "enterprise-admin",
        membershipRole: "enterprise-admin",
        tenantName: "Acme",
        enterprise: { id: "acme", name: "Acme", status: "active", seatUsed: 1, seatQuota: 5 },
        session: { tenantId: "acme" },
      },
    },
    seatOfferEditor: { kind: "closed" },
    handoverEditor: { kind: "closed" },
    ...extra,
  } as unknown as EnterpriseSurfaceProps;
}

function renderMeshPage(props: EnterpriseSurfaceProps = meshProps()): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  render(renderEnterpriseSurface(props), container);
  return container;
}

function expectNoDecisionSurface(container: HTMLElement) {
  expect(container.querySelector(TAG)).toBeNull();
  expect(container.querySelector(".enterprise-evolution-decision")).toBeNull();
  expect(container.querySelector("[data-evolution-decision]")).toBeNull();
  expect(container.textContent).not.toContain(EVOLUTION_ENTERPRISE_DECISION_COPY.title);
  expect(container.textContent).not.toContain("code-present");
  expect(container.textContent).not.toContain("runtime-enabled");
}

/** Code only: block and line comments removed. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");
  document.cookie = "evolutionEnterpriseDecisionRuntime=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  document.body.innerHTML = "";
});

describe("enterprise Mesh page runtime gate", () => {
  it("does not mount the Decision Surface on the Mesh page while the gate is closed", () => {
    expect(enterpriseEvolutionDecisionSurfaceMountEnabled()).toBe(false);
    const container = renderMeshPage();
    expect(container.querySelector(".enterprise-surface--mesh")).not.toBeNull();
    expect(container.querySelector("governance-assets-page")).not.toBeNull();
    expectNoDecisionSurface(container);
  });

  it("returns the Mesh template itself, so the Mesh page is unchanged", () => {
    const props = meshProps();
    const page = renderEnterpriseSurface(props) as unknown as { strings: TemplateStringsArray };
    const mesh = renderMeshGovernanceSurface(props, "") as unknown as {
      strings: TemplateStringsArray;
    };
    // Same template literal, not a wrapper around it.
    expect(page.strings).toBe(mesh.strings);
  });

  it("ignores URL, storage, cookies, forms, and page-level claims", () => {
    window.history.replaceState(
      null,
      "",
      "/enterprise/mesh?evolutionEnterpriseDecisionRuntime=1&EVOLUTION_ENTERPRISE_DECISION_RUNTIME_ENABLED=true#evolution-decision",
    );
    window.localStorage.setItem("EVOLUTION_ENTERPRISE_DECISION_RUNTIME_ENABLED", "true");
    window.sessionStorage.setItem("evolutionEnterpriseDecisionRuntime", "1");
    document.cookie = "evolutionEnterpriseDecisionRuntime=1";
    const form = document.createElement("form");
    form.innerHTML = `<input name="EVOLUTION_ENTERPRISE_DECISION_RUNTIME_ENABLED" value="true" />`;
    document.body.append(form);

    const container = renderMeshPage(
      meshProps({
        evolutionDecisionRuntimeEnabled: true,
        evolutionEnterpriseDecisionRuntimeEnabled: true,
        evolutionDecisionPrincipal: enterprisePrincipal(),
        runtimeEnabled: true,
      }),
    );
    expect(container.querySelector(".enterprise-surface--mesh")).not.toBeNull();
    expectNoDecisionSurface(container);
  });

  it("does not mount the Decision Surface on any other enterprise tab", () => {
    for (const tab of [
      "enterpriseOverview",
      "enterpriseOrganization",
      "enterpriseCapabilityCenter",
      "enterpriseUsage",
    ]) {
      const container = renderMeshPage(meshProps({ tab }));
      expect([tab, container.querySelector(TAG)]).toEqual([tab, null]);
    }
  });
});

describe("the Mesh page mount point", () => {
  const code = withoutComments(readFileSync(join(process.cwd(), CORE), "utf8"));

  it("is the only use of the element, bare and behind the gate, after the Mesh surface", () => {
    expect(code.match(/<enterprise-evolution-decision-surface[\s>]/g)).toHaveLength(1);
    expect(code).toMatch(
      /case "enterpriseMesh": \{\s*const mesh = renderMeshGovernanceSurface\(normalizedProps, basePath\);\s*return enterpriseEvolutionDecisionSurfaceMountEnabled\(\)\s*\?\s*html`\$\{mesh\}<enterprise-evolution-decision-surface><\/enterprise-evolution-decision-surface>`\s*:\s*mesh;\s*\}/,
    );
  });

  it("wires no principal, snapshot source, submit context, command ids, or client", () => {
    for (const binding of [
      ".principal=",
      ".historySource=",
      ".submitContexts=",
      ".commandIdFactory=",
    ]) {
      expect([binding, code.includes(binding)]).toEqual([binding, false]);
    }
  });

  it("reaches the Decision Surface only through its element module and gate", () => {
    const decisionImports = [
      ...code.matchAll(/\bimport\s+(?:[^"';]*?\s+from\s+)?["']([^"']+)["']/g),
    ]
      .map((match) => match[1] ?? "")
      .filter((specifier) => /evolution/.test(specifier));
    expect(decisionImports.toSorted()).toEqual([
      "../evolution-decision/runtime-gate.ts",
      "./enterprise-evolution-decision-surface.ts",
    ]);
    expect(code).toMatch(
      /import \{ enterpriseEvolutionDecisionSurfaceMountEnabled \} from "\.\.\/evolution-decision\/runtime-gate\.ts";/,
    );
    expect(code).toMatch(/import "\.\/enterprise-evolution-decision-surface\.ts";/);
    expect(code).not.toContain("@openbot/evolution-core");
    expect(code).not.toContain("packages/evolution-core");
  });
});
