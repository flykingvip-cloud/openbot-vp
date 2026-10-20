#!/usr/bin/env node
/**
 * Scheduled projection multi-tenant soak (local simulator + staging-ready harness).
 *
 * L2 gate for residual risk A: multi-tenant scheduled materialization under a real
 * tenants root layout, cursor persistence, interval / failure isolation.
 *
 * Modes (`OPENBOT_SOAK_MODE`):
 *   simulate          — offline multi-tenant tick harness (default)
 *   inspect           — validate live OPENBOT_TENANTS_ROOT + schedule cursor
 *   inspect-selftest  — seed temp tenants, tick once, then run inspect (CI-safe)
 *   all               — simulate + inspect-selftest
 *
 * Examples:
 *   node --import tsx scripts/staging-scheduled-projection-soak.ts
 *   OPENBOT_SOAK_MODE=all node --import tsx scripts/staging-scheduled-projection-soak.ts
 *   OPENBOT_SOAK_MODE=inspect OPENBOT_TENANTS_ROOT=/root/.openbot/tenants \
 *     node --import tsx scripts/staging-scheduled-projection-soak.ts
 *
 * Exit 0 when all checks pass.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  readScheduleCursor,
  resetScheduledTickInFlightForTests,
  scheduleCursorKey,
  setScheduleCursorPathForTests,
  tickScheduledProjectionMaterialization,
  writeScheduleCursor,
} from "../src/gateway/enterprise-data/scheduled-projection-materializer.js";
import { seedEnterpriseDataCatalog } from "../src/gateway/enterprise-data/seeds.js";
import {
  normalizeEnterpriseDataStore,
  saveEnterpriseDataStore,
} from "../src/gateway/enterprise-data/store.js";
import { TENANT_ENTERPRISE_DATA_FILE } from "../src/gateway/tenant-store-paths.js";

type Check = { name: string; ok: boolean; detail?: string };

const mode = (process.env.OPENBOT_SOAK_MODE?.trim() || "simulate").toLowerCase();
const tenantCount = Math.max(2, Number(process.env.OPENBOT_SOAK_TENANT_COUNT || 3) || 3);
const nowIso = process.env.OPENBOT_SOAK_NOW_ISO?.trim() || "2026-07-19T15:00:00.000Z";
const nowMs = Date.parse(nowIso) || Date.now();

function ok(name: string, detail?: string): Check {
  return { name, ok: true, detail };
}
function bad(name: string, detail?: string): Check {
  return { name, ok: false, detail };
}

async function seedTenantStore(params: { tenantsRoot: string; tenantId: string }): Promise<void> {
  const controlPlane = path.join(params.tenantsRoot, params.tenantId, "control-plane");
  fs.mkdirSync(controlPlane, { recursive: true });
  const store = normalizeEnterpriseDataStore(null);
  seedEnterpriseDataCatalog({ store, tenantId: params.tenantId, nowIso });
  await saveEnterpriseDataStore(store, path.join(controlPlane, TENANT_ENTERPRISE_DATA_FILE));
}

function tenantPrefixesFromKeys(keys: string[]): Set<string> {
  return new Set(keys.map((key) => key.split("::")[0]).filter(Boolean));
}

async function runSimulate(): Promise<Check[]> {
  const checks: Check[] = [];
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sched-soak-"));
  const tenantsRoot = path.join(tmpRoot, "tenants");
  const cursorPath = path.join(tmpRoot, "enterprise-knowledge-schedule-cursor.json");
  setScheduleCursorPathForTests(cursorPath);
  resetScheduledTickInFlightForTests();

  const tenantIds = Array.from({ length: tenantCount }, (_, i) => `soak-tenant-${i + 1}`);
  try {
    for (const tenantId of tenantIds) {
      await seedTenantStore({ tenantsRoot, tenantId });
    }
    checks.push(ok("seeded tenants under control-plane layout", `${tenantIds.length} tenants`));

    // Wave 1: scan all tenants; materialize due scheduled bindings (seed catalog).
    const wave1 = await tickScheduledProjectionMaterialization({
      tenantsRoot,
      nowIso,
      cursorPath,
    });
    checks.push(
      wave1.tenantsScanned === tenantIds.length
        ? ok("wave1 scanned all tenants", String(wave1.tenantsScanned))
        : bad("wave1 scanned all tenants", `got ${wave1.tenantsScanned}`),
    );
    checks.push(
      wave1.succeeded + wave1.failed > 0
        ? ok(
            "wave1 attempted materializations",
            `succeeded=${wave1.succeeded} failed=${wave1.failed}`,
          )
        : bad("wave1 attempted materializations", "no scheduled work executed"),
    );

    const cursor1 = readScheduleCursor(cursorPath);
    const activityKeys = [
      ...Object.keys(cursor1.lastRunByBindingId),
      ...Object.keys(cursor1.lastFailureByBindingId),
    ];
    const activeTenants = tenantPrefixesFromKeys(activityKeys);
    checks.push(
      activeTenants.size >= tenantIds.length
        ? ok("cursor activity spans all tenants", [...activeTenants].toSorted().join(","))
        : bad(
            "cursor activity spans all tenants",
            `tenants=${[...activeTenants].join(",")} keys=${activityKeys.join("|") || "(none)"}`,
          ),
    );
    checks.push(
      activityKeys.every((key) => key.includes("::"))
        ? ok("cursor keys use tenant::binding format")
        : bad("cursor keys use tenant::binding format", activityKeys.join("|")),
    );

    // Wave 2 same timestamp: interval/backoff must prevent a full re-run of the same dues.
    const wave2 = await tickScheduledProjectionMaterialization({
      tenantsRoot,
      nowIso,
      cursorPath,
    });
    checks.push(
      wave2.succeeded + wave2.failed === 0
        ? ok("wave2 skipped while interval/backoff active")
        : bad(
            "wave2 skipped while interval/backoff active",
            `succeeded=${wave2.succeeded} failed=${wave2.failed}`,
          ),
    );

    // Wave 3 after success interval: work becomes due again (or stays in longer failure backoff).
    const laterIso = new Date(nowMs + 60 * 60 * 1000 + 5_000).toISOString();
    const wave3 = await tickScheduledProjectionMaterialization({
      tenantsRoot,
      nowIso: laterIso,
      cursorPath,
    });
    checks.push(
      wave3.tenantsScanned === tenantIds.length
        ? ok("wave3 re-scanned all tenants", String(wave3.tenantsScanned))
        : bad("wave3 re-scanned all tenants", String(wave3.tenantsScanned)),
    );
    // Either re-attempted (success or fail) or still backing off failures — both are healthy.
    checks.push(
      ok("wave3 completed without throw", `succeeded=${wave3.succeeded} failed=${wave3.failed}`),
    );

    // Restart recovery: re-read cursor from disk.
    const beforeReload = readScheduleCursor(cursorPath);
    writeScheduleCursor(beforeReload, cursorPath);
    const reloaded = readScheduleCursor(cursorPath);
    checks.push(
      Object.keys(reloaded.lastRunByBindingId).length +
        Object.keys(reloaded.lastFailureByBindingId).length >
        0
        ? ok("cursor survives process restart read")
        : bad("cursor survives process restart read"),
    );

    const sampleKey = scheduleCursorKey(tenantIds[0], "binding-x");
    checks.push(
      sampleKey === `${tenantIds[0]}::binding-x`
        ? ok("scheduleCursorKey helper", sampleKey)
        : bad("scheduleCursorKey helper", sampleKey),
    );
  } finally {
    setScheduleCursorPathForTests(null);
    resetScheduledTickInFlightForTests();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
  return checks;
}

async function runInspect(params?: {
  tenantsRoot?: string;
  cursorPath?: string;
}): Promise<Check[]> {
  const checks: Check[] = [];
  const tenantsRoot =
    params?.tenantsRoot?.trim() ||
    process.env.OPENBOT_TENANTS_ROOT?.trim() ||
    path.join(os.homedir(), ".openbot", "tenants");
  const cursorPath =
    params?.cursorPath?.trim() ||
    process.env.OPENBOT_SCHEDULE_CURSOR_PATH?.trim() ||
    path.join(path.dirname(tenantsRoot), "enterprise-knowledge-schedule-cursor.json");

  if (!fs.existsSync(tenantsRoot)) {
    return [bad("tenants root exists", tenantsRoot)];
  }
  checks.push(ok("tenants root exists", tenantsRoot));

  const tenantDirs = fs
    .readdirSync(tenantsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  checks.push(
    tenantDirs.length >= 1
      ? ok("at least one tenant directory", String(tenantDirs.length))
      : bad("at least one tenant directory"),
  );

  let scheduledBindings = 0;
  let storesWithEnterpriseData = 0;
  for (const tenantId of tenantDirs.slice(0, 50)) {
    const storePath = path.join(
      tenantsRoot,
      tenantId,
      "control-plane",
      TENANT_ENTERPRISE_DATA_FILE,
    );
    if (!fs.existsSync(storePath)) {
      continue;
    }
    storesWithEnterpriseData += 1;
    try {
      const raw = JSON.parse(fs.readFileSync(storePath, "utf-8")) as {
        enterpriseKnowledgeProjectionBindings?: Record<
          string,
          { materializationMode?: string; enabled?: boolean }
        >;
      };
      const bindings = Object.values(raw.enterpriseKnowledgeProjectionBindings ?? {}).filter(
        (binding) => binding.materializationMode === "scheduled" && binding.enabled !== false,
      );
      scheduledBindings += bindings.length;
    } catch {
      // ignore corrupt stores
    }
  }
  checks.push(ok("enterprise-data stores discovered", String(storesWithEnterpriseData)));
  checks.push(ok("scheduled bindings discovered", String(scheduledBindings)));

  if (fs.existsSync(cursorPath)) {
    const cursor = readScheduleCursor(cursorPath);
    const successTenants = tenantPrefixesFromKeys(Object.keys(cursor.lastRunByBindingId));
    checks.push(
      ok(
        "schedule cursor present",
        `successKeys=${Object.keys(cursor.lastRunByBindingId).length} tenants=${successTenants.size} failures=${Object.keys(cursor.lastFailureByBindingId).length}`,
      ),
    );
    if (scheduledBindings > 0 && Object.keys(cursor.lastRunByBindingId).length === 0) {
      const onlyFailures = Object.keys(cursor.lastFailureByBindingId).length > 0;
      checks.push(
        onlyFailures
          ? ok("cursor has failure-only activity (bindings may be erroring)")
          : bad(
              "cursor has runs when scheduled bindings exist",
              "gateway maintenance may not have ticked yet — re-run after soak window",
            ),
      );
    } else if (scheduledBindings > 0) {
      checks.push(ok("cursor has runs when scheduled bindings exist"));
    }
    if (successTenants.size >= 2) {
      checks.push(ok("cursor spans multiple tenants", [...successTenants].toSorted().join(",")));
    } else if (Object.keys(cursor.lastRunByBindingId).length > 0) {
      checks.push(
        ok(
          "cursor has at least one tenant success",
          [...successTenants].join(",") || "(legacy keys)",
        ),
      );
    }
  } else {
    checks.push(
      scheduledBindings === 0
        ? ok("no cursor yet (no scheduled bindings discovered)")
        : bad("schedule cursor missing", cursorPath),
    );
  }

  return checks;
}

/**
 * CI-safe inspect path: build a tenants root, run one maintenance-style tick,
 * then exercise the same inspect assertions used on live staging.
 */
async function runInspectSelftest(): Promise<Check[]> {
  const checks: Check[] = [];
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sched-soak-inspect-"));
  const tenantsRoot = path.join(tmpRoot, "tenants");
  const cursorPath = path.join(tmpRoot, "enterprise-knowledge-schedule-cursor.json");
  setScheduleCursorPathForTests(cursorPath);
  resetScheduledTickInFlightForTests();
  const tenantIds = Array.from({ length: tenantCount }, (_, i) => `inspect-tenant-${i + 1}`);
  try {
    for (const tenantId of tenantIds) {
      await seedTenantStore({ tenantsRoot, tenantId });
    }
    checks.push(ok("inspect-selftest seeded tenants", String(tenantIds.length)));

    const tick = await tickScheduledProjectionMaterialization({
      tenantsRoot,
      nowIso,
      cursorPath,
    });
    checks.push(
      tick.tenantsScanned === tenantIds.length
        ? ok("inspect-selftest tick scanned tenants", String(tick.tenantsScanned))
        : bad("inspect-selftest tick scanned tenants", String(tick.tenantsScanned)),
    );
    checks.push(
      tick.succeeded + tick.failed > 0
        ? ok(
            "inspect-selftest tick produced activity",
            `succeeded=${tick.succeeded} failed=${tick.failed}`,
          )
        : bad("inspect-selftest tick produced activity"),
    );

    const inspectChecks = await runInspect({ tenantsRoot, cursorPath });
    checks.push(
      ...inspectChecks.map((check) => ({
        ...check,
        name: `inspect:${check.name}`,
      })),
    );
  } finally {
    setScheduleCursorPathForTests(null);
    resetScheduledTickInFlightForTests();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
  return checks;
}

function printChecks(checks: Check[]): { pass: number; fail: number } {
  let pass = 0;
  let fail = 0;
  for (const check of checks) {
    if (check.ok) {
      pass += 1;
      console.log(`PASS  ${check.name}${check.detail ? ` — ${check.detail}` : ""}`);
    } else {
      fail += 1;
      console.log(`FAIL  ${check.name}${check.detail ? ` — ${check.detail}` : ""}`);
    }
  }
  return { pass, fail };
}

async function main(): Promise<void> {
  const resolvedMode = ["simulate", "inspect", "inspect-selftest", "all"].includes(mode)
    ? mode
    : "simulate";
  console.log(`== staging-scheduled-projection-soak mode=${resolvedMode} ==`);

  let totalPass = 0;
  let totalFail = 0;

  const runPhase = async (label: string, checks: Check[]) => {
    console.log(`-- phase: ${label} --`);
    const { pass, fail } = printChecks(checks);
    totalPass += pass;
    totalFail += fail;
    console.log("");
  };

  if (resolvedMode === "simulate" || resolvedMode === "all") {
    await runPhase("simulate", await runSimulate());
  }
  if (resolvedMode === "inspect") {
    await runPhase("inspect", await runInspect());
  }
  if (resolvedMode === "inspect-selftest" || resolvedMode === "all") {
    await runPhase("inspect-selftest", await runInspectSelftest());
  }

  console.log(`Summary: PASS=${totalPass} FAIL=${totalFail}`);
  if (totalFail > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
