import { afterEach, describe, expect, it } from "vitest";
import { createSiteCapabilityTools } from "../agents/tools/site-capability-tools.js";
import { DEFAULT_BROWSER_EVALUATE_ENABLED } from "../browser/constants.js";
import { SKILL_CAPABILITY_VERBS } from "../gateway/skill-capability-contract.js";
import { resetAccountBrowserCoordinatorForTests } from "./coordinator.js";
import {
  SAR_ACCOUNT_QUERY_ID,
  SAR_BUDGET_QUERY_ID,
  SAR_FIXTURE_BINDING_ID,
  SAR_FIXTURE_PRINCIPAL,
  SAR_OTHER_PRINCIPAL,
  SAR_PUBLIC_QUERY_ID,
  SAR_PUBLIC_VERSION,
  SAR_SECRET_BINDING_ID,
  SAR_SECRET_PACKAGE_ID,
  SAR_SECRET_QUERY_ID,
  SAR_UNGRANTED_BINDING_ID,
  SAR_UNGRANTED_VERSION,
  createControllableSiteHarness,
} from "./fixture-runtime.js";
import { isEmptySuccess, isOrdinaryFailure } from "./result.js";
import { resetDefaultSiteCapabilityRuntimeForTests } from "./runtime.js";
import { SAR_FIXTURE_CREDENTIALS, SAR_FIXTURE_GROUND_TRUTH } from "./test-site.js";

const harnesses: Array<{ dispose: () => void }> = [];

afterEach(() => {
  for (const harness of harnesses) {
    harness.dispose();
  }
  harnesses.length = 0;
  resetDefaultSiteCapabilityRuntimeForTests();
  resetAccountBrowserCoordinatorForTests();
});

function harness() {
  const created = createControllableSiteHarness();
  harnesses.push(created);
  return created;
}

function leaked(value: unknown): boolean {
  const text = JSON.stringify(value);
  return (
    text.includes(SAR_SECRET_PACKAGE_ID) ||
    text.includes(SAR_SECRET_BINDING_ID) ||
    text.includes(SAR_FIXTURE_CREDENTIALS.password) ||
    text.includes("cdpUrl") ||
    text.includes("user-data-dir") ||
    text.includes("userDataDir") ||
    text.includes("fixture-public-pack") ||
    text.includes("fixture-account-pack")
  );
}

describe("P1 site runtime", () => {
  it("runs a public query and a logged-in query against fixture ground truth", async () => {
    const { site, runtime } = harness();
    const pub = await runtime.invoke(SAR_FIXTURE_PRINCIPAL, {
      capabilityId: SAR_PUBLIC_QUERY_ID,
      version: SAR_PUBLIC_VERSION,
      args: { query: SAR_FIXTURE_GROUND_TRUTH.publicQuery.query },
    });
    expect(pub.status).toBe("succeeded");
    expect(pub.verification).toBe("not_performed");
    expect(pub.completeness).toBe("complete");
    expect(pub.repair).toBe("none");
    expect(pub.data).toEqual({
      query: "widget",
      items: SAR_FIXTURE_GROUND_TRUTH.publicQuery.items,
    });
    expect(pub.evidenceRef).toMatch(/^ev_/);
    expect(pub.durationMs).toBeGreaterThanOrEqual(0);
    expect(leaked(pub)).toBe(false);
    expect(leaked(runtime.readEvidence(pub.evidenceRef))).toBe(false);

    const locked = await runtime.invoke(SAR_FIXTURE_PRINCIPAL, {
      capabilityId: SAR_ACCOUNT_QUERY_ID,
      version: SAR_PUBLIC_VERSION,
      args: { query: SAR_FIXTURE_GROUND_TRUTH.accountQuery.query },
    });
    expect(locked.status).toBe("failed");
    expect(locked.error).toMatchObject({
      code: "AUTH_REQUIRED",
      retry: "after_reauth",
      ordinaryFailure: true,
    });
    expect(isOrdinaryFailure(locked)).toBe(true);

    site.login(SAR_FIXTURE_CREDENTIALS.username, SAR_FIXTURE_CREDENTIALS.password);
    const orders = await runtime.invoke(SAR_FIXTURE_PRINCIPAL, {
      capabilityId: SAR_ACCOUNT_QUERY_ID,
      version: SAR_PUBLIC_VERSION,
      args: { query: SAR_FIXTURE_GROUND_TRUTH.accountQuery.query },
    });
    expect(orders.status).toBe("succeeded");
    expect(orders.data).toEqual({
      query: "order",
      orders: SAR_FIXTURE_GROUND_TRUTH.accountQuery.orders,
    });
    expect(leaked(orders)).toBe(false);
  });

  it("treats an empty match as success and a budget cut as partial", async () => {
    const { runtime } = harness();
    const empty = await runtime.invoke(SAR_FIXTURE_PRINCIPAL, {
      capabilityId: SAR_PUBLIC_QUERY_ID,
      version: SAR_PUBLIC_VERSION,
      args: { query: "no-such-widget" },
    });
    expect(isEmptySuccess(empty)).toBe(true);
    expect(empty.status).toBe("succeeded");
    expect(empty.data).toEqual({ query: "no-such-widget", items: [] });
    expect(isOrdinaryFailure(empty)).toBe(false);

    const partial = await runtime.invoke(SAR_FIXTURE_PRINCIPAL, {
      capabilityId: SAR_BUDGET_QUERY_ID,
      version: SAR_PUBLIC_VERSION,
      args: { query: "widget" },
    });
    expect(partial.status).toBe("succeeded");
    expect(partial.completeness).toBe("partial");
    expect(partial.verification).toBe("not_performed");
    expect(partial.repair).toBe("none");
    expect(partial.data).toEqual({
      query: "widget",
      items: [SAR_FIXTURE_GROUND_TRUTH.publicQuery.items[0]],
    });
    expect(isEmptySuccess(partial)).toBe(false);
  });

  it("marks an indeterminate read unknown and does not classify it as a failed retry", async () => {
    const { site, runtime } = harness();
    site.injectError("public", "RESULT_UNKNOWN");
    const unknown = await runtime.invoke(SAR_FIXTURE_PRINCIPAL, {
      capabilityId: SAR_PUBLIC_QUERY_ID,
      version: SAR_PUBLIC_VERSION,
      args: { query: "widget" },
    });
    expect(unknown.status).toBe("unknown");
    expect(unknown.status).not.toBe("failed");
    expect(unknown.verification).toBe("not_performed");
    expect(unknown.completeness).toBe("partial");
    expect(unknown.repair).toBe("none");
    expect(unknown.error).toMatchObject({
      code: "RESULT_UNKNOWN",
      retry: "not_ordinary",
      ordinaryFailure: false,
    });
    expect(isOrdinaryFailure(unknown)).toBe(false);
    expect(isEmptySuccess(unknown)).toBe(false);
  });

  it("lists only authorized summaries and describes without secrets", async () => {
    const { runtime } = harness();
    const page = runtime.list(SAR_FIXTURE_PRINCIPAL, { limit: 2 });
    expect(page.ok).toBe(true);
    if (!page.ok) {
      return;
    }
    expect(page.items.map((item) => item.capabilityId)).toEqual([
      SAR_ACCOUNT_QUERY_ID,
      SAR_BUDGET_QUERY_ID,
    ]);
    expect(page.nextCursor).toEqual(expect.any(String));
    expect(leaked(page)).toBe(false);

    const rest = runtime.list(SAR_FIXTURE_PRINCIPAL, { cursor: page.nextCursor ?? "", limit: 2 });
    expect(rest.ok).toBe(true);
    if (!rest.ok) {
      return;
    }
    expect(rest.items.map((item) => item.capabilityId)).toEqual([SAR_PUBLIC_QUERY_ID]);
    expect(rest.nextCursor).toBeNull();

    const described = runtime.describe(
      SAR_FIXTURE_PRINCIPAL,
      SAR_ACCOUNT_QUERY_ID,
      SAR_PUBLIC_VERSION,
    );
    expect(described.ok).toBe(true);
    if (!described.ok) {
      return;
    }
    expect(described.capability).toMatchObject({
      capabilityId: SAR_ACCOUNT_QUERY_ID,
      version: SAR_PUBLIC_VERSION,
      effect: "read",
      availability: "available",
      verification: "passed",
      accountRequirements: { authMode: "browser_session", bindingRequired: true },
    });
    expect(described.capability.inputSchema).toMatchObject({ type: "object" });
    expect(described.capability.outputSchema).toMatchObject({ type: "object" });
    expect(described.capability).not.toHaveProperty("packageId");
    expect(described.capability).not.toHaveProperty("plan");
    expect(leaked(described)).toBe(false);
    const describedText = JSON.stringify(described);
    expect(describedText).not.toContain("navigate");
    expect(describedText).not.toContain('"script"');
    expect(describedText).not.toContain("javascript");
    expect(describedText).not.toContain("evaluate");

    const hidden = runtime.describe(SAR_FIXTURE_PRINCIPAL, SAR_SECRET_QUERY_ID, SAR_PUBLIC_VERSION);
    expect(hidden).toEqual({
      ok: false,
      code: "NOT_AUTHORIZED",
      message: "capability is not available",
    });
    expect(leaked(hidden)).toBe(false);

    const other = runtime.list(SAR_OTHER_PRINCIPAL, { limit: 10 });
    expect(other.ok).toBe(true);
    if (!other.ok) {
      return;
    }
    expect(other.items.map((item) => item.capabilityId)).toEqual([SAR_SECRET_QUERY_ID]);
    expect(leaked(other)).toBe(false);
  });

  it("checks eligibility per invoke, pins the version, and ignores model identity", async () => {
    expect(DEFAULT_BROWSER_EVALUATE_ENABLED).toBe(true);
    expect(SKILL_CAPABILITY_VERBS).not.toContain("site.invoke");
    const { site, runtime } = harness();

    const missingVersion = await runtime.invoke(SAR_FIXTURE_PRINCIPAL, {
      capabilityId: SAR_PUBLIC_QUERY_ID,
      args: { query: "widget" },
    });
    expect(missingVersion.error?.code).toBe("VERSION_REQUIRED");
    expect(site.currentPage()).toBe("home");

    const wrongVersion = await runtime.invoke(SAR_FIXTURE_PRINCIPAL, {
      capabilityId: SAR_PUBLIC_QUERY_ID,
      version: SAR_UNGRANTED_VERSION,
      args: { query: "widget" },
    });
    expect(wrongVersion.status).toBe("failed");
    expect(wrongVersion.error?.code).toBe("NOT_AUTHORIZED");
    expect(site.currentPage()).toBe("home");
    expect(JSON.stringify(wrongVersion)).not.toContain("WRONG_VERSION");

    const otherUser = await runtime.invoke(SAR_OTHER_PRINCIPAL, {
      capabilityId: SAR_PUBLIC_QUERY_ID,
      version: SAR_PUBLIC_VERSION,
      args: { query: "widget" },
    });
    expect(otherUser.error?.code).toBe("NOT_AUTHORIZED");
    expect(leaked(otherUser)).toBe(false);

    const otherBinding = await runtime.invoke(SAR_FIXTURE_PRINCIPAL, {
      capabilityId: SAR_PUBLIC_QUERY_ID,
      version: SAR_PUBLIC_VERSION,
      accountBindingId: SAR_UNGRANTED_BINDING_ID,
      args: { query: "widget" },
    });
    expect(otherBinding.error?.code).toBe("POLICY_DENIED");
    expect(site.currentPage()).toBe("home");

    const script = await runtime.invoke(SAR_FIXTURE_PRINCIPAL, {
      capabilityId: SAR_PUBLIC_QUERY_ID,
      version: SAR_PUBLIC_VERSION,
      args: { query: "widget", script: "document.cookie" },
    });
    expect(script.error?.code).toBe("SAR_EVALUATE_REJECTED");
    expect(site.currentPage()).toBe("home");

    const cdp = await runtime.invoke(SAR_FIXTURE_PRINCIPAL, {
      capabilityId: SAR_PUBLIC_QUERY_ID,
      version: SAR_PUBLIC_VERSION,
      args: { query: "widget", cdpUrl: "ws://127.0.0.1:9222" },
    });
    expect(cdp.error?.code).toBe("CDP_BYPASS_REJECTED");
    expect(site.currentPage()).toBe("home");

    const tools = createSiteCapabilityTools({
      runtime,
      tenantId: SAR_FIXTURE_PRINCIPAL.tenantId,
      gatewayClientPlatformUserId: SAR_FIXTURE_PRINCIPAL.userId,
    });
    expect(tools.map((tool) => tool.name)).toEqual(["site_list", "site_describe", "site_invoke"]);
    const listed = await tools[0]?.execute?.("list", {
      tenantId: SAR_OTHER_PRINCIPAL.tenantId,
      userId: SAR_OTHER_PRINCIPAL.userId,
      limit: 10,
    });
    expect(JSON.stringify(listed?.details)).not.toContain(SAR_SECRET_QUERY_ID);
    expect(JSON.stringify(listed?.details)).toContain(SAR_PUBLIC_QUERY_ID);

    const invoked = await tools[2]?.execute?.("invoke", {
      tenantId: SAR_OTHER_PRINCIPAL.tenantId,
      userId: SAR_OTHER_PRINCIPAL.userId,
      capabilityId: SAR_PUBLIC_QUERY_ID,
      version: SAR_PUBLIC_VERSION,
      args: { query: "widget", tenantId: SAR_OTHER_PRINCIPAL.tenantId },
      accountBindingId: SAR_FIXTURE_BINDING_ID,
    });
    expect(invoked?.details).toMatchObject({
      status: "succeeded",
      capabilityId: SAR_PUBLIC_QUERY_ID,
      version: SAR_PUBLIC_VERSION,
    });
    expect(JSON.stringify(invoked?.details)).not.toContain(SAR_SECRET_PACKAGE_ID);

    const anonymous = createSiteCapabilityTools({ runtime });
    const hiddenList = await anonymous[0]?.execute?.("list", {
      tenantId: SAR_FIXTURE_PRINCIPAL.tenantId,
      userId: SAR_FIXTURE_PRINCIPAL.userId,
    });
    expect(hiddenList?.details).toMatchObject({
      ok: false,
      code: "IDENTITY_REQUIRED",
      items: [],
    });
    expect(JSON.stringify(hiddenList?.details)).not.toContain(SAR_PUBLIC_QUERY_ID);
  });
});
