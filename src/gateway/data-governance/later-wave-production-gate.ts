/**
 * P4 later-wave production enablement gates (architecture §14.1 I4).
 * Independent deployment, key, region, and ops (C19) must all pass.
 * Does not cut over a LIVE container or write Catalog.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveSecurityProfile } from "../security-profile.js";
import { PROMOTION_KEY_HMAC_KEY_ENV } from "./cognitive-promotion-key.js";
import { isGovernanceAuthenticatedCall } from "./cognitive-recommendation-auth.js";
import { assertMigrationProductionBoundary, verifyC19ProbeEvidence } from "./migration-closure.js";
import { verifyPlatformDeploymentRegionReceipt } from "./placement-platform-verify.js";

export const LATER_WAVE_ENABLEMENT_RECEIPT_KIND = "p4_later_wave_enablement_receipt" as const;
export const LATER_WAVE_DEPLOYMENT_PROFILE_ENV = "OPENBOT_LATER_WAVE_DEPLOYMENT_PROFILE";
export const LATER_WAVE_C19_SUMMARY_PATH_ENV = "OPENBOT_C19_SUMMARY_PATH";

export const LATER_WAVE_ADAPTERS = ["tenant-cloud", "dedicated", "byos", "cold-archive"] as const;

export type LaterWaveAdapterEnablement = (typeof LATER_WAVE_ADAPTERS)[number];

export type LaterWaveDeploymentProfile = "personal" | "managed_enterprise" | "dedicated";

export type LaterWaveProductionGate = "independent_deployment" | "key" | "region" | "ops";

export type LaterWaveProductionFinding = {
  gate: LaterWaveProductionGate;
  passed: boolean;
  detail: string;
};

export type LaterWaveEnablementReceipt = {
  kind: typeof LATER_WAVE_ENABLEMENT_RECEIPT_KIND;
  receiptId: string;
  tenantId: string;
  adapter: LaterWaveAdapterEnablement;
  findings: LaterWaveProductionFinding[];
  productionReady: boolean;
  /** Host evaluation never cuts over a LIVE image. */
  liveCutover: false;
};

export type LaterWaveEnablementDeny =
  | "tenant_not_authorized"
  | "independent_deployment_denied"
  | "key_gate_denied"
  | "region_gate_denied"
  | "ops_gate_denied";

const EXPECTED_KEY_KIND: Record<LaterWaveAdapterEnablement, string> = {
  "tenant-cloud": "platform_tenant",
  dedicated: "dedicated_tenant",
  byos: "byos_customer",
  "cold-archive": "archive_tenant",
};

export function isLaterWaveAdapterEnablement(value: unknown): value is LaterWaveAdapterEnablement {
  return typeof value === "string" && (LATER_WAVE_ADAPTERS as readonly string[]).includes(value);
}

export function laterWaveKeyKindForAdapter(adapter: LaterWaveAdapterEnablement): string {
  return EXPECTED_KEY_KIND[adapter];
}

/** Host-derived isolation profile; client input must not select this. */
export function resolveLaterWaveDeploymentProfileFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): LaterWaveDeploymentProfile {
  const raw = env[LATER_WAVE_DEPLOYMENT_PROFILE_ENV]?.trim();
  if (raw === "dedicated" || raw === "managed_enterprise" || raw === "personal") {
    return raw;
  }
  const resolution = resolveSecurityProfile(undefined, env);
  if (resolution.profile === "managed_enterprise") {
    return "managed_enterprise";
  }
  return "personal";
}

function writeJsonReceipt(receiptDir: string, receiptId: string, payload: unknown): void {
  fs.mkdirSync(receiptDir, { recursive: true });
  fs.writeFileSync(
    path.join(receiptDir, `${receiptId}.json`),
    `${JSON.stringify(payload, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
}

/** I4 dedicated execution + no mix of dedicated profile with isolated later homes. */
export function assertLaterWaveIndependentDeployment(params: {
  adapter: LaterWaveAdapterEnablement;
  deploymentProfile: LaterWaveDeploymentProfile;
  env?: NodeJS.ProcessEnv;
}): { ok: true } | { ok: false; reasonCode: string } {
  const boundary = assertMigrationProductionBoundary({ env: params.env });
  if (!boundary.ok) {
    return boundary;
  }
  if (params.adapter === "dedicated") {
    if (params.deploymentProfile !== "dedicated") {
      return { ok: false, reasonCode: "dedicated_profile_required" };
    }
    return { ok: true };
  }
  if (params.deploymentProfile === "dedicated") {
    return { ok: false, reasonCode: "isolation_models_do_not_mix" };
  }
  return { ok: true };
}

/** Adapter-bound keyRef.kind; HMAC secret must be present; never client-supplied. */
export function assertLaterWaveKeyGate(params: {
  adapter: LaterWaveAdapterEnablement;
  keyRefKind: string | null;
  env?: NodeJS.ProcessEnv;
}): { ok: true } | { ok: false; reasonCode: string } {
  const env = params.env ?? process.env;
  if (!env[PROMOTION_KEY_HMAC_KEY_ENV]?.trim()) {
    return { ok: false, reasonCode: "hmac_key_missing" };
  }
  const expected = EXPECTED_KEY_KIND[params.adapter];
  if (params.keyRefKind !== expected) {
    return { ok: false, reasonCode: "key_kind_mismatch" };
  }
  return { ok: true };
}

/** Cloud/archive writes require a branded region receipt bound to auth.tenantId. */
export function assertLaterWaveRegionGate(params: {
  callerTenantId: string;
  trustedRegionPresent: boolean;
  receiptTenantId: string | null;
}): { ok: true } | { ok: false; reasonCode: string } {
  if (!params.trustedRegionPresent) {
    return { ok: false, reasonCode: "missing_trusted_region" };
  }
  if (!params.receiptTenantId || params.receiptTenantId !== params.callerTenantId) {
    return { ok: false, reasonCode: "region_tenant_mismatch" };
  }
  return { ok: true };
}

/** C19 live re-probe evidence (ops tracking; not an audit-baseline signature). */
export function assertLaterWaveOpsGate(params: { c19SummaryPath: string }):
  | {
      ok: true;
      summarySha256: string;
    }
  | { ok: false; reasonCode: string } {
  const pathValue = params.c19SummaryPath.trim();
  if (!pathValue) {
    return { ok: false, reasonCode: "c19_summary_missing" };
  }
  const verified = verifyC19ProbeEvidence({ summaryPath: pathValue });
  if (!verified.ok) {
    return { ok: false, reasonCode: verified.reasonCode };
  }
  return { ok: true, summarySha256: verified.summarySha256 };
}

export async function runLaterWaveProductionEnablement(params: {
  callerTenantId: string;
  authorizedTenantId: string;
  adapter: LaterWaveAdapterEnablement;
  deploymentProfile: LaterWaveDeploymentProfile;
  keyRefKind: string | null;
  trustedRegionPresent: boolean;
  receiptTenantId: string | null;
  c19SummaryPath: string;
  env?: NodeJS.ProcessEnv;
  receiptDir: string;
}): Promise<
  | { ok: true; receipt: LaterWaveEnablementReceipt }
  | { ok: false; reasonCode: LaterWaveEnablementDeny; receipt: LaterWaveEnablementReceipt }
> {
  const callerTenantId = params.callerTenantId.trim();
  const findings: LaterWaveProductionFinding[] = [];

  if (!callerTenantId || callerTenantId !== params.authorizedTenantId.trim()) {
    const receipt: LaterWaveEnablementReceipt = {
      kind: LATER_WAVE_ENABLEMENT_RECEIPT_KIND,
      receiptId: `p4lw-${randomUUID()}`,
      tenantId: callerTenantId,
      adapter: params.adapter,
      findings: [
        { gate: "independent_deployment", passed: false, detail: "tenant_not_authorized" },
      ],
      productionReady: false,
      liveCutover: false,
    };
    writeJsonReceipt(params.receiptDir, receipt.receiptId, receipt);
    return { ok: false, reasonCode: "tenant_not_authorized", receipt };
  }

  const deployment = assertLaterWaveIndependentDeployment({
    adapter: params.adapter,
    deploymentProfile: params.deploymentProfile,
    env: params.env,
  });
  findings.push({
    gate: "independent_deployment",
    passed: deployment.ok,
    detail: deployment.ok ? "boundary_ok" : deployment.reasonCode,
  });

  const key = assertLaterWaveKeyGate({
    adapter: params.adapter,
    keyRefKind: params.keyRefKind,
    env: params.env,
  });
  findings.push({
    gate: "key",
    passed: key.ok,
    detail: key.ok ? EXPECTED_KEY_KIND[params.adapter] : key.reasonCode,
  });

  const region = assertLaterWaveRegionGate({
    callerTenantId,
    trustedRegionPresent: params.trustedRegionPresent,
    receiptTenantId: params.receiptTenantId,
  });
  findings.push({
    gate: "region",
    passed: region.ok,
    detail: region.ok ? "trusted_region_bound" : region.reasonCode,
  });

  const ops = assertLaterWaveOpsGate({ c19SummaryPath: params.c19SummaryPath });
  findings.push({
    gate: "ops",
    passed: ops.ok,
    detail: ops.ok ? ops.summarySha256 : ops.reasonCode,
  });

  const productionReady = findings.every((finding) => finding.passed);
  const receipt: LaterWaveEnablementReceipt = {
    kind: LATER_WAVE_ENABLEMENT_RECEIPT_KIND,
    receiptId: `p4lw-${randomUUID()}`,
    tenantId: callerTenantId,
    adapter: params.adapter,
    findings,
    productionReady,
    liveCutover: false,
  };
  writeJsonReceipt(params.receiptDir, receipt.receiptId, receipt);

  if (productionReady) {
    return { ok: true, receipt };
  }
  if (!deployment.ok) {
    return { ok: false, reasonCode: "independent_deployment_denied", receipt };
  }
  if (!key.ok) {
    return { ok: false, reasonCode: "key_gate_denied", receipt };
  }
  if (!region.ok) {
    return { ok: false, reasonCode: "region_gate_denied", receipt };
  }
  return { ok: false, reasonCode: "ops_gate_denied", receipt };
}

/**
 * Operator host path: deployment profile, key kind, and C19 path come from env.
 * Region requires a signed branded receipt verified against the authenticated call.
 * Never claims LIVE cutover.
 */
export async function evaluateLaterWaveEnablementAtHost(params: {
  callerTenantId: string;
  authorizedTenantId: string;
  adapter: LaterWaveAdapterEnablement;
  signedRegionReceipt: unknown;
  call: unknown;
  env?: NodeJS.ProcessEnv;
  receiptDir: string;
}): Promise<
  | { ok: true; receipt: LaterWaveEnablementReceipt }
  | { ok: false; reasonCode: LaterWaveEnablementDeny; receipt: LaterWaveEnablementReceipt }
> {
  const env = params.env ?? process.env;
  const verified = isGovernanceAuthenticatedCall(params.call)
    ? verifyPlatformDeploymentRegionReceipt({
        signedReceipt: params.signedRegionReceipt,
        call: params.call,
      })
    : { ok: false as const, reasonCode: "missing_trusted_region" };
  return runLaterWaveProductionEnablement({
    callerTenantId: params.callerTenantId,
    authorizedTenantId: params.authorizedTenantId,
    adapter: params.adapter,
    deploymentProfile: resolveLaterWaveDeploymentProfileFromEnv(env),
    keyRefKind: laterWaveKeyKindForAdapter(params.adapter),
    trustedRegionPresent: verified.ok,
    receiptTenantId: verified.ok ? verified.receipt.tenantId : null,
    c19SummaryPath: env[LATER_WAVE_C19_SUMMARY_PATH_ENV] ?? "",
    env,
    receiptDir: params.receiptDir,
  });
}
