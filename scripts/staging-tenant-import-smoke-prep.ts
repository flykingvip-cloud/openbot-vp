#!/usr/bin/env bun
/**
 * Build minimal tenant-import.zip packages for staging dual-tenant smoke.
 *
 * Each package carries one user agent space + per-tenant seat-assets slice. Platform-auth
 * membership stays global (Q-A); tenant dirs must use real enterpriseId values from
 * openbot-platform-auth.json (not slug aliases like "acme").
 *
 * Usage:
 *   bun scripts/staging-tenant-import-smoke-prep.ts --out-dir /tmp/tenant-import-pkgs
 *   bun scripts/staging-tenant-import-smoke-prep.ts --out-dir ./pkgs --tenant-a 001 --tenant-b workspace-2-87217301
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildTenantImportPackage } from "../src/data/tenant-import/package.js";

const SAFE_TENANT_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

type TenantSmokeSpec = {
  targetTenantId: string;
  sourceUserId: string;
  userEmail: string;
  seatId: string;
  agentId: string;
};

function parseArgs(argv: string[]): { outDir: string; tenants: TenantSmokeSpec[] } {
  let outDir = "";
  let tenantA = process.env.OPENBOT_SMOKE_TENANT_A?.trim() || "001";
  let tenantB = process.env.OPENBOT_SMOKE_TENANT_B?.trim() || "workspace-2-87217301";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out-dir" && argv[i + 1]) {
      outDir = argv[++i].trim();
    } else if (arg === "--tenant-a" && argv[i + 1]) {
      tenantA = argv[++i].trim();
    } else if (arg === "--tenant-b" && argv[i + 1]) {
      tenantB = argv[++i].trim();
    }
  }
  if (!outDir) {
    throw new Error("missing --out-dir <path>");
  }
  for (const tid of [tenantA, tenantB]) {
    if (!SAFE_TENANT_ID.test(tid)) {
      throw new Error(`invalid tenant id: ${tid}`);
    }
  }
  const tenants: TenantSmokeSpec[] = [
    {
      targetTenantId: tenantA,
      sourceUserId: "u-smoke-a",
      userEmail: "smoke-a@staging.openbot.test",
      seatId: "seat-smoke-a",
      agentId: "main",
    },
    {
      targetTenantId: tenantB,
      sourceUserId: "u-smoke-b",
      userEmail: "smoke-b@staging.openbot.test",
      seatId: "seat-smoke-b",
      agentId: "main",
    },
  ];
  return { outDir: path.resolve(outDir), tenants };
}

async function buildMinimalPackage(spec: TenantSmokeSpec): Promise<Buffer> {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-smoke-pkg-"));
  try {
    const controlPlane = path.join(scratch, "control-plane");
    const userDir = path.join(scratch, `${spec.sourceUserId}-OpenBot`);
    await fs.mkdir(controlPlane, { recursive: true });
    await fs.writeFile(
      path.join(controlPlane, "seat-assets.json"),
      JSON.stringify({
        version: 4,
        seats: [{ seatId: spec.seatId, userId: spec.sourceUserId, agentId: spec.agentId }],
      }),
    );
    await fs.writeFile(
      path.join(controlPlane, "platform-auth-slice.json"),
      JSON.stringify({
        users: [{ id: spec.sourceUserId, email: spec.userEmail }],
      }),
    );
    await fs.mkdir(path.join(userDir, "agents", spec.agentId, "workspace"), { recursive: true });
    await fs.writeFile(
      path.join(userDir, "agents", spec.agentId, "workspace", "smoke.md"),
      `# staging smoke ${spec.targetTenantId}\n`,
    );
    await fs.mkdir(path.join(userDir, ".meta"), { recursive: true });
    await fs.writeFile(path.join(userDir, ".meta", "manifest.json"), "{}");
    const { buffer } = await buildTenantImportPackage({
      environment: "staging-smoke",
      sourceTenantId: "staging-src",
      targetTenantId: spec.targetTenantId,
      userDataSpaces: { [spec.sourceUserId]: userDir },
      controlPlaneDir: controlPlane,
    });
    return buffer;
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const { outDir, tenants } = parseArgs(process.argv.slice(2));
  await fs.mkdir(outDir, { recursive: true });
  for (const spec of tenants) {
    const buffer = await buildMinimalPackage(spec);
    const archivePath = path.join(outDir, `${spec.targetTenantId}.zip`);
    await fs.writeFile(archivePath, buffer);
    console.log(`wrote ${archivePath} (${buffer.byteLength} bytes)`);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
