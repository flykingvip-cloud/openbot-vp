import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PROMOTION_KEY_HMAC_KEY_ENV } from "./cognitive-promotion-key.js";
import { authenticateGovernanceCall } from "./cognitive-recommendation-auth.js";
import {
  assertLaterWaveIndependentDeployment,
  assertLaterWaveKeyGate,
  assertLaterWaveOpsGate,
  assertLaterWaveRegionGate,
  evaluateLaterWaveEnablementAtHost,
  LATER_WAVE_C19_SUMMARY_PATH_ENV,
  LATER_WAVE_DEPLOYMENT_PROFILE_ENV,
  resolveLaterWaveDeploymentProfileFromEnv,
  runLaterWaveProductionEnablement,
} from "./later-wave-production-gate.js";
import {
  installPlacementRegionTrustSecretForTests,
  signPlatformDeploymentRegionReceiptForTests,
} from "./placement-resolve.test-harness.js";

const resolveTenantContextMock = vi.hoisted(() =>
  vi.fn(async (): Promise<{ tenantId: string; userId: string; domain: string } | null> => null),
);

vi.mock("../tenant-context.js", () => ({
  resolveTenantContext: resolveTenantContextMock,
  resolveAuthoritativeMembership: vi.fn(async () => ({ tenantId: null, userId: null })),
  TenantContextError: class TenantContextError extends Error {
    constructor(
      message: string,
      readonly code: string,
    ) {
      super(message);
    }
  },
}));

const TENANT = "tenant-acme";
const c19SummaryPath = path.resolve(
  process.cwd(),
  "docs/design/evidence/workspace-isolation-20260810-001.summary.json",
);

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "p4-later-gate-"));
  tempDirs.push(dir);
  return dir;
}

const HMAC_ENV = {
  [PROMOTION_KEY_HMAC_KEY_ENV]: "later-wave-hmac-test-key",
};

describe("later-wave independent deployment gate", () => {
  it("allows dedicated adapter only on dedicated profile", () => {
    expect(
      assertLaterWaveIndependentDeployment({
        adapter: "dedicated",
        deploymentProfile: "dedicated",
        env: { OPENBOT_SECURITY_PROFILE: "personal_local" },
      }),
    ).toEqual({ ok: true });
    expect(
      assertLaterWaveIndependentDeployment({
        adapter: "dedicated",
        deploymentProfile: "personal",
        env: { OPENBOT_SECURITY_PROFILE: "personal_local" },
      }),
    ).toEqual({ ok: false, reasonCode: "dedicated_profile_required" });
  });

  it("refuses to mix dedicated profile with tenant-cloud, byos, or archive", () => {
    for (const adapter of ["tenant-cloud", "byos", "cold-archive"] as const) {
      expect(
        assertLaterWaveIndependentDeployment({
          adapter,
          deploymentProfile: "dedicated",
          env: { OPENBOT_SECURITY_PROFILE: "personal_local" },
        }),
      ).toEqual({ ok: false, reasonCode: "isolation_models_do_not_mix" });
    }
  });

  it("fail-closes Managed Enterprise without dedicated execution boundary", () => {
    expect(
      assertLaterWaveIndependentDeployment({
        adapter: "tenant-cloud",
        deploymentProfile: "managed_enterprise",
        env: {
          OPENBOT_SECURITY_PROFILE: "managed_enterprise",
          OPENBOT_TENANT_EXECUTION_BOUNDARY: "shared_process",
        },
      }),
    ).toEqual({ ok: false, reasonCode: "production_boundary_missing" });
  });
});

describe("later-wave key gate", () => {
  it("requires HMAC and exact keyRef.kind per adapter", () => {
    expect(
      assertLaterWaveKeyGate({
        adapter: "byos",
        keyRefKind: "byos_customer",
        env: HMAC_ENV,
      }),
    ).toEqual({ ok: true });
    expect(
      assertLaterWaveKeyGate({
        adapter: "byos",
        keyRefKind: "platform_tenant",
        env: HMAC_ENV,
      }),
    ).toEqual({ ok: false, reasonCode: "key_kind_mismatch" });
    expect(
      assertLaterWaveKeyGate({
        adapter: "dedicated",
        keyRefKind: "dedicated_tenant",
        env: {},
      }),
    ).toEqual({ ok: false, reasonCode: "hmac_key_missing" });
    expect(
      assertLaterWaveKeyGate({
        adapter: "cold-archive",
        keyRefKind: "archive_tenant",
        env: HMAC_ENV,
      }),
    ).toEqual({ ok: true });
    expect(
      assertLaterWaveKeyGate({
        adapter: "tenant-cloud",
        keyRefKind: "platform_tenant",
        env: HMAC_ENV,
      }),
    ).toEqual({ ok: true });
  });
});

describe("later-wave region gate", () => {
  it("requires a trusted region receipt bound to the caller tenant", () => {
    expect(
      assertLaterWaveRegionGate({
        callerTenantId: TENANT,
        trustedRegionPresent: true,
        receiptTenantId: TENANT,
      }),
    ).toEqual({ ok: true });
    expect(
      assertLaterWaveRegionGate({
        callerTenantId: TENANT,
        trustedRegionPresent: false,
        receiptTenantId: TENANT,
      }),
    ).toEqual({ ok: false, reasonCode: "missing_trusted_region" });
    expect(
      assertLaterWaveRegionGate({
        callerTenantId: TENANT,
        trustedRegionPresent: true,
        receiptTenantId: "tenant-other",
      }),
    ).toEqual({ ok: false, reasonCode: "region_tenant_mismatch" });
  });
});

describe("later-wave ops gate", () => {
  it("verifies C19 summarySha256 and fail-closes on a missing path", () => {
    const ok = assertLaterWaveOpsGate({ c19SummaryPath });
    expect(ok.ok).toBe(true);
    expect(assertLaterWaveOpsGate({ c19SummaryPath: "" })).toEqual({
      ok: false,
      reasonCode: "c19_summary_missing",
    });
    expect(assertLaterWaveOpsGate({ c19SummaryPath: path.join(tmp(), "missing.json") })).toEqual({
      ok: false,
      reasonCode: "c19_summary_missing",
    });
  });
});

describe("runLaterWaveProductionEnablement", () => {
  it("enables BYOS only when all four gates pass", async () => {
    const result = await runLaterWaveProductionEnablement({
      callerTenantId: TENANT,
      authorizedTenantId: TENANT,
      adapter: "byos",
      deploymentProfile: "personal",
      keyRefKind: "byos_customer",
      trustedRegionPresent: true,
      receiptTenantId: TENANT,
      c19SummaryPath,
      env: { ...HMAC_ENV, OPENBOT_SECURITY_PROFILE: "personal_local" },
      receiptDir: tmp(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.receipt.productionReady).toBe(true);
    expect(result.receipt.findings.map((f) => f.gate)).toEqual([
      "independent_deployment",
      "key",
      "region",
      "ops",
    ]);
    expect(result.receipt.findings.every((f) => f.passed)).toBe(true);
    expect(result.receipt.liveCutover).toBe(false);
  });

  it("enables dedicated adapter when dedicated profile and HMAC match", async () => {
    const result = await runLaterWaveProductionEnablement({
      callerTenantId: TENANT,
      authorizedTenantId: TENANT,
      adapter: "dedicated",
      deploymentProfile: "dedicated",
      keyRefKind: "dedicated_tenant",
      trustedRegionPresent: true,
      receiptTenantId: TENANT,
      c19SummaryPath,
      env: { ...HMAC_ENV, OPENBOT_SECURITY_PROFILE: "personal_local" },
      receiptDir: tmp(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.receipt.productionReady).toBe(true);
    expect(result.receipt.liveCutover).toBe(false);
  });

  it("does not claim productionReady when any gate fails", async () => {
    const result = await runLaterWaveProductionEnablement({
      callerTenantId: TENANT,
      authorizedTenantId: TENANT,
      adapter: "byos",
      deploymentProfile: "dedicated",
      keyRefKind: "byos_customer",
      trustedRegionPresent: true,
      receiptTenantId: TENANT,
      c19SummaryPath,
      env: { ...HMAC_ENV, OPENBOT_SECURITY_PROFILE: "personal_local" },
      receiptDir: tmp(),
    });
    expect(result).toMatchObject({
      ok: false,
      reasonCode: "independent_deployment_denied",
    });
    if (result.ok) {
      return;
    }
    expect(result.receipt.productionReady).toBe(false);
  });

  it("denies enablement when HMAC or region receipt is missing", async () => {
    const receiptDir = tmp();
    const noHmac = await runLaterWaveProductionEnablement({
      callerTenantId: TENANT,
      authorizedTenantId: TENANT,
      adapter: "tenant-cloud",
      deploymentProfile: "personal",
      keyRefKind: "platform_tenant",
      trustedRegionPresent: true,
      receiptTenantId: TENANT,
      c19SummaryPath,
      env: { OPENBOT_SECURITY_PROFILE: "personal_local" },
      receiptDir,
    });
    expect(noHmac).toMatchObject({ ok: false, reasonCode: "key_gate_denied" });

    const noRegion = await runLaterWaveProductionEnablement({
      callerTenantId: TENANT,
      authorizedTenantId: TENANT,
      adapter: "cold-archive",
      deploymentProfile: "personal",
      keyRefKind: "archive_tenant",
      trustedRegionPresent: false,
      receiptTenantId: TENANT,
      c19SummaryPath,
      env: { ...HMAC_ENV, OPENBOT_SECURITY_PROFILE: "personal_local" },
      receiptDir,
    });
    expect(noRegion).toMatchObject({ ok: false, reasonCode: "region_gate_denied" });
  });

  it("denies cross-tenant enablement", async () => {
    const result = await runLaterWaveProductionEnablement({
      callerTenantId: TENANT,
      authorizedTenantId: "tenant-other",
      adapter: "dedicated",
      deploymentProfile: "dedicated",
      keyRefKind: "dedicated_tenant",
      trustedRegionPresent: true,
      receiptTenantId: TENANT,
      c19SummaryPath,
      env: HMAC_ENV,
      receiptDir: tmp(),
    });
    expect(result).toMatchObject({ ok: false, reasonCode: "tenant_not_authorized" });
    if (result.ok) {
      return;
    }
    expect(result.receipt.liveCutover).toBe(false);
  });
});

describe("later-wave host enablement", () => {
  afterEach(() => {
    resolveTenantContextMock.mockReset();
    resolveTenantContextMock.mockResolvedValue(null);
  });

  it("derives dedicated profile only from host env", () => {
    expect(
      resolveLaterWaveDeploymentProfileFromEnv({
        OPENBOT_SECURITY_PROFILE: "personal_local",
      }),
    ).toBe("personal");
    expect(
      resolveLaterWaveDeploymentProfileFromEnv({
        [LATER_WAVE_DEPLOYMENT_PROFILE_ENV]: "dedicated",
        OPENBOT_SECURITY_PROFILE: "personal_local",
      }),
    ).toBe("dedicated");
  });

  it("passes when HMAC, signed region, C19, and profile are host-derived", async () => {
    const restoreSecret = installPlacementRegionTrustSecretForTests();
    resolveTenantContextMock.mockResolvedValue({
      tenantId: TENANT,
      userId: "u-host",
      domain: "enterprise",
    });
    const auth = await authenticateGovernanceCall({
      connect: { scopes: ["operator.admin"] },
    } as never);
    expect(auth.ok).toBe(true);
    if (!auth.ok) {
      restoreSecret();
      return;
    }
    const result = await evaluateLaterWaveEnablementAtHost({
      callerTenantId: TENANT,
      authorizedTenantId: TENANT,
      adapter: "byos",
      signedRegionReceipt: signPlatformDeploymentRegionReceiptForTests({
        receiptId: "drr-host-byos",
        tenantId: TENANT,
        region: "us-west-2",
      }),
      call: auth.call,
      env: {
        ...HMAC_ENV,
        OPENBOT_SECURITY_PROFILE: "personal_local",
        [LATER_WAVE_C19_SUMMARY_PATH_ENV]: c19SummaryPath,
      },
      receiptDir: tmp(),
    });
    restoreSecret();
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.receipt.productionReady).toBe(true);
    expect(result.receipt.liveCutover).toBe(false);
  });

  it("does not accept a client boolean in place of a signed region receipt", async () => {
    resolveTenantContextMock.mockResolvedValue({
      tenantId: TENANT,
      userId: "u-host",
      domain: "enterprise",
    });
    const auth = await authenticateGovernanceCall({
      connect: { scopes: ["operator.admin"] },
    } as never);
    expect(auth.ok).toBe(true);
    if (!auth.ok) {
      return;
    }
    const result = await evaluateLaterWaveEnablementAtHost({
      callerTenantId: TENANT,
      authorizedTenantId: TENANT,
      adapter: "tenant-cloud",
      signedRegionReceipt: { trustedRegionPresent: true, tenantId: TENANT },
      call: auth.call,
      env: {
        ...HMAC_ENV,
        OPENBOT_SECURITY_PROFILE: "personal_local",
        [LATER_WAVE_C19_SUMMARY_PATH_ENV]: c19SummaryPath,
      },
      receiptDir: tmp(),
    });
    expect(result).toMatchObject({ ok: false, reasonCode: "region_gate_denied" });
    if (result.ok) {
      return;
    }
    expect(result.receipt.productionReady).toBe(false);
    expect(result.receipt.liveCutover).toBe(false);
  });
});
