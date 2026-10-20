#!/usr/bin/env bun
/**
 * Live tenant addressing probe using real platform-auth membership data.
 * Validates L1/L2 path resolution for two staging enterprises (no browser login).
 *
 * Usage:
 *   OPENBOT_MULTITENANT=1 OPENBOT_TENANTS_ROOT=/root/.openbot/tenants \
 *     bun scripts/staging-live-tenant-addressing-probe.ts \
 *       --platform-auth /tmp/openbot-platform-auth.json \
 *       --tenant-a 001 --tenant-b workspace-2-87217301
 */

import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../src/config/config.js";
import {
  findMembershipByUserId,
  findUserByEmail,
  type PlatformAuthStore,
} from "../src/gateway/platform-auth.js";
import type { GatewayClient } from "../src/gateway/server-methods/types.js";
import {
  resolveControlPlaneStorePathForClient,
  resolveDataRootForClient,
} from "../src/gateway/tenant-context.js";
import { TENANT_SEAT_ASSETS_FILE } from "../src/gateway/tenant-store-paths.js";

type Args = {
  platformAuthPath: string;
  tenantA: string;
  tenantB: string;
};

function parseArgs(argv: string[]): Args {
  let platformAuthPath = "";
  let tenantA = process.env.OPENBOT_SMOKE_TENANT_A?.trim() || "001";
  let tenantB = process.env.OPENBOT_SMOKE_TENANT_B?.trim() || "workspace-2-87217301";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--platform-auth" && argv[i + 1]) {
      platformAuthPath = argv[++i].trim();
    } else if (arg === "--tenant-a" && argv[i + 1]) {
      tenantA = argv[++i].trim();
    } else if (arg === "--tenant-b" && argv[i + 1]) {
      tenantB = argv[++i].trim();
    }
  }
  if (!platformAuthPath) {
    throw new Error("missing --platform-auth <path>");
  }
  return { platformAuthPath: path.resolve(platformAuthPath), tenantA, tenantB };
}

function clientForEmail(email: string): GatewayClient {
  return {
    user: email,
    sessionDomain: "employee",
    sessionTenantId: null,
  } as GatewayClient;
}

function pickMembershipEmail(store: PlatformAuthStore, enterpriseId: string): string | null {
  const memberships = store.memberships ?? {};
  const users = store.users ?? {};
  const userById = new Map<string, { id: string; email?: string }>();
  if (Array.isArray(users)) {
    for (const u of users) {
      if (u?.id) {
        userById.set(u.id, u);
      }
    }
  } else {
    for (const u of Object.values(users)) {
      if (u?.id) {
        userById.set(u.id, u);
      }
    }
  }
  for (const m of Object.values(memberships)) {
    if (m?.enterpriseId !== enterpriseId) {
      continue;
    }
    const user = userById.get(m.userId);
    if (user?.email?.trim()) {
      return user.email.trim().toLowerCase();
    }
  }
  return null;
}

async function main(): Promise<void> {
  const { platformAuthPath, tenantA, tenantB } = parseArgs(process.argv.slice(2));
  process.env.OPENBOT_MULTITENANT = process.env.OPENBOT_MULTITENANT?.trim() || "1";
  const tenantsRoot =
    process.env.OPENBOT_TENANTS_ROOT?.trim() ||
    path.join(process.env.HOME ?? "/tmp", ".openbot", "tenants");

  const raw = await fs.readFile(platformAuthPath, "utf-8");
  const store = JSON.parse(raw) as PlatformAuthStore;

  const emailA = pickMembershipEmail(store, tenantA);
  const emailB = pickMembershipEmail(store, tenantB);
  if (!emailA || !emailB) {
    throw new Error(
      `missing membership email for tenant(s): a=${emailA ?? "none"} b=${emailB ?? "none"}`,
    );
  }

  const userA = findUserByEmail(store, emailA);
  const userB = findUserByEmail(store, emailB);
  const memA = userA ? findMembershipByUserId(store, userA.id) : undefined;
  const memB = userB ? findMembershipByUserId(store, userB.id) : undefined;
  if (memA?.enterpriseId !== tenantA || memB?.enterpriseId !== tenantB) {
    throw new Error("membership enterpriseId mismatch after lookup");
  }

  const cfg = loadConfig();
  const clientA = clientForEmail(emailA);
  const clientB = clientForEmail(emailB);

  const seatA = await resolveControlPlaneStorePathForClient(clientA, TENANT_SEAT_ASSETS_FILE, cfg);
  const seatB = await resolveControlPlaneStorePathForClient(clientB, TENANT_SEAT_ASSETS_FILE, cfg);
  const dataA = await resolveDataRootForClient(clientA, cfg);
  const dataB = await resolveDataRootForClient(clientB, cfg);

  const expectSeatA = path.join(tenantsRoot, tenantA, "control-plane", TENANT_SEAT_ASSETS_FILE);
  const expectSeatB = path.join(tenantsRoot, tenantB, "control-plane", TENANT_SEAT_ASSETS_FILE);
  const expectDataA = path.join(tenantsRoot, tenantA, "users", userA!.id, "OpenBot");
  const expectDataB = path.join(tenantsRoot, tenantB, "users", userB!.id, "OpenBot");

  const checks: Array<[string, string | undefined, string]> = [
    ["seatA", seatA, expectSeatA],
    ["seatB", seatB, expectSeatB],
    ["dataA", dataA, expectDataA],
    ["dataB", dataB, expectDataB],
  ];

  let pass = 0;
  for (const [label, got, want] of checks) {
    if (got === want) {
      console.log(`PASS  ${label} -> ${got}`);
      pass += 1;
    } else {
      console.error(`FAIL  ${label} got=${got ?? "<undefined>"} want=${want}`);
    }
  }

  const paths = [seatA, seatB, dataA, dataB].filter(Boolean) as string[];
  if (new Set(paths).size === 4) {
    console.log("PASS  all four paths disjoint");
    pass += 1;
  } else {
    console.error("FAIL  path set not disjoint");
  }

  if (seatA && seatB && !seatA.includes(tenantB) && !seatB.includes(tenantA)) {
    console.log("PASS  cross-tenant path negative (no tid leak in paths)");
    pass += 1;
  } else {
    console.error("FAIL  cross-tenant path leak");
  }

  console.log(`\nSummary: ${pass}/6 checks (emailA=${emailA} emailB=${emailB})`);
  if (pass < 6) {
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
