/**
 * In-memory controllable site wired through the P1 runtime.
 * Credentials stay on the fixture. They are not part of list or describe.
 */

import type { SkillLifecycleHint } from "../gateway/skill-capability-contract.js";
import type { LookupFn } from "../infra/net/ssrf.js";
import type { SiteCapabilityManifest } from "./contract.js";
import { SarExecutionAuthority, memoryEpochStore } from "./execution-authority.js";
import { SiteCapabilityRuntime, type SiteCapabilityRecord, type SitePlanStep } from "./runtime.js";
import type { ServerPrincipal } from "./session-handle.js";
import { SAR_FIXTURE_ORIGIN, ControllableTestSite, createTestSitePort } from "./test-site.js";
import type { SiteBusinessVerifier } from "./verification-gate.js";

const publicLookup = (async () => [{ address: "93.184.216.34", family: 4 }]) as unknown as LookupFn;

export const SAR_FIXTURE_PRINCIPAL: ServerPrincipal = { tenantId: "tenant-a", userId: "user-a" };
export const SAR_OTHER_PRINCIPAL: ServerPrincipal = { tenantId: "tenant-a", userId: "user-b" };
export const SAR_FIXTURE_BINDING_ID = "bind-a";
export const SAR_UNGRANTED_BINDING_ID = "bind-a-other";
export const SAR_SECRET_BINDING_ID = "bind-secret";
export const SAR_SECRET_PACKAGE_ID = "secret-pack";

export const SAR_PUBLIC_QUERY_ID = "fixture.sar.public.query";
export const SAR_ACCOUNT_QUERY_ID = "fixture.sar.account.query";
export const SAR_BUDGET_QUERY_ID = "fixture.sar.public.budget";
export const SAR_SECRET_QUERY_ID = "fixture.sar.secret.query";
export const SAR_PUBLIC_VERSION = "1.0.0";
export const SAR_UNGRANTED_VERSION = "9.9.9";

const PUBLIC_DIGEST = "sha256:fixture-public-1";
const ACCOUNT_DIGEST = "sha256:fixture-account-1";
const BUDGET_DIGEST = "sha256:fixture-budget-1";
const SECRET_DIGEST = "sha256:fixture-secret-1";
const WRONG_DIGEST = "sha256:fixture-wrong-9";

const READ_PERMISSIONS = ["navigate", "read_page", "request_context", "capture_result"] as const;

function manifest(
  id: string,
  version: string,
  operation: string,
  description: string,
  authMode: SiteCapabilityManifest["authMode"],
): SiteCapabilityManifest {
  return {
    schemaVersion: "1",
    id,
    version,
    site: "fixture.sar.test",
    operation,
    description,
    effect: "read",
    authMode,
    executionMode: "browser_dom",
    allowedOrigins: [SAR_FIXTURE_ORIGIN],
    permissions: [...READ_PERMISSIONS],
  };
}

function queryRecord(input: {
  manifest: SiteCapabilityManifest;
  authSummary: string;
  digest: string;
  packageId: string;
  plan: readonly SitePlanStep[];
  maxItems?: number;
  lifecycle?: SkillLifecycleHint;
  verification?: SiteCapabilityRecord["verification"];
}): SiteCapabilityRecord {
  return {
    manifest: input.manifest,
    inputFields: [{ name: "query", required: true }],
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        items: { type: "array" },
        orders: { type: "array" },
      },
    },
    accountSummary: input.authSummary,
    verification: input.verification ?? "passed",
    artifactDigest: input.digest,
    disabled: false,
    packageId: input.packageId,
    plan: input.plan,
    maxItems: input.maxItems,
    lifecycle: input.lifecycle ?? "published",
  };
}

const publicPlan: SitePlanStep[] = [
  { op: "navigate", urlTemplate: `${SAR_FIXTURE_ORIGIN}/public?q={query}` },
  { op: "capture_result", fields: ["query", "items"] },
];

const accountPlan: SitePlanStep[] = [
  { op: "navigate", urlTemplate: `${SAR_FIXTURE_ORIGIN}/account/query?q={query}` },
  { op: "capture_result", fields: ["query", "orders"] },
];

export function createControllableSiteHarness(options?: { verifier?: SiteBusinessVerifier }): {
  site: ControllableTestSite;
  runtime: SiteCapabilityRuntime;
  authority: SarExecutionAuthority;
  dispose: () => void;
} {
  const site = new ControllableTestSite();
  const authority = new SarExecutionAuthority(memoryEpochStore(), { lookupFn: publicLookup });
  authority.boot();
  authority.registerBinding({
    bindingId: SAR_FIXTURE_BINDING_ID,
    tenantId: SAR_FIXTURE_PRINCIPAL.tenantId,
    userId: SAR_FIXTURE_PRINCIPAL.userId,
  });
  authority.registerBinding({
    bindingId: SAR_UNGRANTED_BINDING_ID,
    tenantId: SAR_FIXTURE_PRINCIPAL.tenantId,
    userId: SAR_FIXTURE_PRINCIPAL.userId,
  });
  authority.registerBinding({
    bindingId: SAR_SECRET_BINDING_ID,
    tenantId: SAR_OTHER_PRINCIPAL.tenantId,
    userId: SAR_OTHER_PRINCIPAL.userId,
  });
  const runtime = new SiteCapabilityRuntime({
    authority,
    portForScope: () => createTestSitePort(site),
    ...(options?.verifier ? { verifier: options.verifier } : {}),
  });
  const publicRecord = queryRecord({
    manifest: manifest(
      SAR_PUBLIC_QUERY_ID,
      SAR_PUBLIC_VERSION,
      "public.query",
      "Read the public fixture catalog",
      "none",
    ),
    authSummary: "No site login. Runs in the caller's account browser.",
    digest: PUBLIC_DIGEST,
    packageId: "fixture-public-pack",
    plan: publicPlan,
  });
  const accountRecord = queryRecord({
    manifest: manifest(
      SAR_ACCOUNT_QUERY_ID,
      SAR_PUBLIC_VERSION,
      "account.query",
      "Read the signed-in fixture order list",
      "browser_session",
    ),
    authSummary: "Requires the signed-in account browser session for this capability.",
    digest: ACCOUNT_DIGEST,
    packageId: "fixture-account-pack",
    plan: accountPlan,
  });
  const budgetRecord = queryRecord({
    manifest: manifest(
      SAR_BUDGET_QUERY_ID,
      SAR_PUBLIC_VERSION,
      "public.budget",
      "Public fixture catalog with a one-item budget",
      "none",
    ),
    authSummary: "No site login. Runs in the caller's account browser.",
    digest: BUDGET_DIGEST,
    packageId: "fixture-budget-pack",
    plan: publicPlan,
    maxItems: 1,
  });
  const secretRecord = queryRecord({
    manifest: manifest(
      SAR_SECRET_QUERY_ID,
      SAR_PUBLIC_VERSION,
      "secret.query",
      "Private catalog for another account",
      "browser_session",
    ),
    authSummary: "Requires that account's browser session.",
    digest: SECRET_DIGEST,
    packageId: SAR_SECRET_PACKAGE_ID,
    plan: publicPlan,
  });
  const wrongVersion = queryRecord({
    manifest: manifest(
      SAR_PUBLIC_QUERY_ID,
      SAR_UNGRANTED_VERSION,
      "public.query",
      "Ungranted public query version",
      "none",
    ),
    authSummary: "No site login.",
    digest: WRONG_DIGEST,
    packageId: "fixture-wrong-pack",
    plan: [
      { op: "navigate", urlTemplate: `${SAR_FIXTURE_ORIGIN}/wrong?q={query}` },
      { op: "capture_result", fields: ["marker"] },
    ],
  });
  for (const record of [publicRecord, accountRecord, budgetRecord, secretRecord, wrongVersion]) {
    const registered = runtime.register(record);
    if (!registered.ok) {
      throw new Error(registered.message);
    }
  }
  runtime.grant({
    tenantId: SAR_FIXTURE_PRINCIPAL.tenantId,
    userId: SAR_FIXTURE_PRINCIPAL.userId,
    capabilityId: SAR_PUBLIC_QUERY_ID,
    version: SAR_PUBLIC_VERSION,
    artifactDigest: PUBLIC_DIGEST,
    accountBindingIds: [SAR_FIXTURE_BINDING_ID],
  });
  runtime.grant({
    tenantId: SAR_FIXTURE_PRINCIPAL.tenantId,
    userId: SAR_FIXTURE_PRINCIPAL.userId,
    capabilityId: SAR_ACCOUNT_QUERY_ID,
    version: SAR_PUBLIC_VERSION,
    artifactDigest: ACCOUNT_DIGEST,
    accountBindingIds: [SAR_FIXTURE_BINDING_ID],
  });
  runtime.grant({
    tenantId: SAR_FIXTURE_PRINCIPAL.tenantId,
    userId: SAR_FIXTURE_PRINCIPAL.userId,
    capabilityId: SAR_BUDGET_QUERY_ID,
    version: SAR_PUBLIC_VERSION,
    artifactDigest: BUDGET_DIGEST,
    accountBindingIds: [SAR_FIXTURE_BINDING_ID],
  });
  runtime.grant({
    tenantId: SAR_OTHER_PRINCIPAL.tenantId,
    userId: SAR_OTHER_PRINCIPAL.userId,
    capabilityId: SAR_SECRET_QUERY_ID,
    version: SAR_PUBLIC_VERSION,
    artifactDigest: SECRET_DIGEST,
    accountBindingIds: [SAR_SECRET_BINDING_ID],
  });
  return {
    site,
    runtime,
    authority,
    dispose: () => authority.dispose(),
  };
}
