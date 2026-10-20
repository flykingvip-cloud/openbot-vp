import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import { runLocalTenantImport } from "../../data/tenant-import/import-job.js";
import { buildTenantImportPackage } from "../../data/tenant-import/package.js";
import { buildRemapPlanFromPackage } from "../../data/tenant-import/plan-from-package.js";
import { preflightTenantImportArchive } from "../../data/tenant-import/preflight.js";
import { resolveTenantsRoot as resolveDefaultTenantsRoot } from "../../gateway/tenant-store-paths.js";
import { note } from "../../terminal/note.js";

/**
 * `openbot platform tenant-import` operator CLI (SaaS tenant data architecture §9–§12, K-08).
 *
 * Local operator commands that share the same `src/data/tenant-import/` core as the
 * `platform.tenant.*` RPC — package a tenant-import zip, preflight it, provision an empty tenant,
 * and run the import into the tenants volume. Intended for headless/pilot boxes; the Gateway RPC
 * remains the SaaS-side path. Mirrors the RPC contract so behavior stays identical.
 */

const SAFE_TENANT_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

function resolveTenantsRoot(override?: string): string {
  return override?.trim() || resolveDefaultTenantsRoot();
}

async function isDir(target: string): Promise<boolean> {
  return fs
    .stat(target)
    .then((s) => s.isDirectory())
    .catch(() => false);
}

function assertTenantId(tenantId: string): void {
  if (!SAFE_TENANT_ID.test(tenantId)) {
    throw new Error(`invalid tenant id: ${tenantId}`);
  }
}

export function registerPlatformCli(program: Command) {
  const platform = program
    .command("platform")
    .description("OpenBot platform operations (SaaS tenant lifecycle)");

  platform
    .command("tenant-provision")
    .description("Provision an empty tenant data tree (control-plane/, shared/, users/)")
    .requiredOption("--tenant <id>", "Target tenant id")
    .option("--tenants-root <path>", "Tenants volume root (default: <config>/tenants)")
    .action(async (opts: { tenant: string; tenantsRoot?: string }) => {
      assertTenantId(opts.tenant);
      const root = path.join(resolveTenantsRoot(opts.tenantsRoot), opts.tenant);
      for (const sub of ["control-plane", "shared", "users"]) {
        await fs.mkdir(path.join(root, sub), { recursive: true });
      }
      note(`Provisioned tenant: ${root}`);
    });

  const tenantImport = platform
    .command("tenant-import")
    .description("Package, preflight, and import tenant data (shared tenant-import core)");

  tenantImport
    .command("package")
    .description("Build a tenant-import.zip from a collected source root")
    .requiredOption(
      "--source-root <dir>",
      "Source root containing control-plane/, users/<uid>/OpenBot/, tenant-shared/",
    )
    .requiredOption("--source-tenant <id>", "Source tenant id (audit)")
    .requiredOption("--target <id>", "Target tenant id")
    .option("--out <path>", "Output zip path (default: ./tenant-import-<target>-<ts>.zip)")
    .option("--environment <env>", "Source environment label", "local-dev")
    .action(
      async (opts: {
        sourceRoot: string;
        sourceTenant: string;
        target: string;
        out?: string;
        environment: string;
      }) => {
        assertTenantId(opts.target);
        const sourceRoot = path.resolve(opts.sourceRoot);
        const controlPlaneDir = (await isDir(path.join(sourceRoot, "control-plane")))
          ? path.join(sourceRoot, "control-plane")
          : undefined;
        const tenantSharedDir = (await isDir(path.join(sourceRoot, "tenant-shared")))
          ? path.join(sourceRoot, "tenant-shared")
          : undefined;
        const usersRoot = path.join(sourceRoot, "users");
        const userEntries = await fs.readdir(usersRoot, { withFileTypes: true }).catch(() => []);
        const userDataSpaces: Record<string, string> = {};
        for (const entry of userEntries) {
          if (entry.isDirectory()) {
            userDataSpaces[entry.name] = path.join(usersRoot, entry.name, "OpenBot");
          }
        }
        if (Object.keys(userDataSpaces).length === 0) {
          throw new Error(`no user data spaces under ${usersRoot}`);
        }
        const result = await buildTenantImportPackage({
          environment: opts.environment,
          sourceTenantId: opts.sourceTenant,
          targetTenantId: opts.target,
          userDataSpaces,
          controlPlaneDir,
          tenantSharedDir,
        });
        const outPath =
          opts.out?.trim() || path.resolve(`tenant-import-${opts.target}-${Date.now()}.zip`);
        await fs.mkdir(path.dirname(outPath), { recursive: true });
        await fs.writeFile(outPath, result.buffer);
        note(`Package written: ${outPath}`);
        note(
          `Contents: ${String(result.manifest.stats.userCount)} user(s), ${String(result.manifest.stats.agentCount)} agent(s), ${String(result.manifest.stats.fileCount)} file(s)`,
        );
      },
    );

  tenantImport
    .command("preflight")
    .description("Validate a tenant-import package against a target tenant (read-only)")
    .requiredOption("--archive <path>", "Path to a tenant-import.zip")
    .requiredOption("--target <id>", "Target tenant id")
    .action(async (opts: { archive: string; target: string }) => {
      assertTenantId(opts.target);
      const report = await preflightTenantImportArchive({
        archivePath: opts.archive.trim(),
        jobTargetTenantId: opts.target,
      });
      note(
        `Preflight: ${report.ok ? "OK" : "REJECTED"} (${String(report.stats.entryCount)} entries)`,
      );
      for (const err of report.errors) {
        note(`  error: ${err}`);
      }
      for (const finding of report.secretFindings) {
        note(`  secret: ${finding.rule} @ ${finding.path}`);
      }
      if (!report.ok) {
        process.exitCode = 1;
      }
    });

  tenantImport
    .command("run")
    .description("Import a tenant-import package into the tenant tree (provisions if needed)")
    .requiredOption("--archive <path>", "Path to a tenant-import.zip")
    .requiredOption("--target <id>", "Target tenant id")
    .option("--tenants-root <path>", "Tenants volume root (default: <config>/tenants)")
    .option("--job-id <id>", "Import job id (default: generated)")
    .option("--dry-run", "Validate + build plan without staging/commit", false)
    .action(
      async (opts: {
        archive: string;
        target: string;
        tenantsRoot?: string;
        jobId?: string;
        dryRun?: boolean;
      }) => {
        assertTenantId(opts.target);
        const archivePath = opts.archive.trim();

        if (opts.dryRun === true) {
          const report = await preflightTenantImportArchive({
            archivePath,
            jobTargetTenantId: opts.target,
          });
          if (!report.ok) {
            note("Dry-run: preflight REJECTED");
            for (const err of report.errors) {
              note(`  error: ${err}`);
            }
            process.exitCode = 1;
            return;
          }
          const plan = await buildRemapPlanFromPackage({
            archivePath,
            targetTenantId: opts.target,
          });
          note(
            `Dry-run OK. Plan: tenant=${plan.tenantId}, users=${String(Object.keys(plan.users).length)}, agents=${String(Object.keys(plan.agents).length)}, seats=${String(Object.keys(plan.seats).length)} (no commit)`,
          );
          return;
        }

        const tenantLiveRoot = path.join(resolveTenantsRoot(opts.tenantsRoot), opts.target);
        for (const sub of ["control-plane", "shared", "users"]) {
          await fs.mkdir(path.join(tenantLiveRoot, sub), { recursive: true });
        }
        const jobId = opts.jobId?.trim() || randomUUID();
        const plan = await buildRemapPlanFromPackage({ archivePath, targetTenantId: opts.target });
        const result = await runLocalTenantImport({
          archivePath,
          jobTargetTenantId: opts.target,
          plan,
          stagingRoot: path.join(tenantLiveRoot, ".import-staging", jobId),
          tenantLiveRoot,
        });
        note(`Import ${result.ok ? "complete" : "FAILED"} (phase=${result.phase}, job=${jobId})`);
        note(`Committed files: ${String(result.committedFiles)}`);
        if (!result.ok) {
          for (const err of result.errors) {
            note(`  error: ${err}`);
          }
          process.exitCode = 1;
        }
      },
    );
}
