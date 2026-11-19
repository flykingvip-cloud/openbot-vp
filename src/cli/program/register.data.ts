import { Command } from "commander";
import { canonicalizeWorkspaceCatalogCommand } from "../../commands/canonicalize-workspace-catalog.js";
import {
  executeForgetPlan,
  parseForgetScope,
  resolveForgetPlan,
} from "../../commands/data-forget.js";
import { loadConfig } from "../../config/config.js";
import { buildDataRootInfo } from "../../data/data-root-info.js";
import { preflightMigration, startMigration } from "../../data/migration-engine.js";
import { note } from "../../terminal/note.js";
import { formatCliCommand } from "../command-format.js";

export function registerDataCli(program: Command) {
  const data = program.command("data").description("OpenBot Data Space management");

  data
    .command("info")
    .description("Show current data root location and usage")
    .action(async () => {
      const info = buildDataRootInfo(loadConfig());
      if (info.mode === "managed") {
        note("Data is managed by OpenBot cloud.");
        return;
      }
      note(`Data root: ${info.displayRoot ?? info.rootPath ?? "unknown"}`);
      if (info.volumeName) {
        note(`Volume: ${info.volumeName}`);
      }
      if (info.usedBytesLabel) {
        note(`Used (migration bundle estimate): ${info.usedBytesLabel}`);
      }
    });

  data
    .command("migrate")
    .description("Migrate OpenBot data to another folder (shared Migration Engine)")
    .requiredOption(
      "--target <path>",
      "Target parent directory (OpenBot subfolder will be created)",
    )
    .option("--include-cache", "Include rebuildable cache/ in migration", false)
    .action(async (opts: { target: string; includeCache?: boolean }) => {
      const preflight = await preflightMigration({
        targetPath: opts.target,
        includeCache: opts.includeCache === true,
      });
      if (!preflight.ok) {
        throw new Error(preflight.error ?? "Preflight failed");
      }
      note(`Estimated size: ${String(preflight.estimatedBytes)} bytes`);
      note(`Target: ${preflight.targetRoot}`);
      const job = await startMigration({
        targetPath: opts.target,
        includeCache: opts.includeCache === true,
      });
      if (job.phase === "done") {
        note(`Migration complete: ${job.targetRoot}`);
        note(`Restart gateway: ${formatCliCommand("openbot gateway run")}`);
        return;
      }
      throw new Error(job.error ?? "Migration failed");
    });

  data
    .command("forget")
    .description(
      "Forget (delete) local OpenBot data for a session, agent, or tenant (dry-run by default)",
    )
    .requiredOption("--scope <scope>", "Deletion scope: session | agent | tenant")
    .requiredOption("--id <id>", "Session id / agent id / tenant id to forget")
    .option("--dry-run", "Only list what would be deleted (default unless --yes)", false)
    .option("--yes", "Actually delete the enumerated targets", false)
    .option(
      "--purge-temp",
      "Also purge the OpenBot-managed temp root contents (not attributable per id)",
      false,
    )
    .action(
      async (opts: {
        scope: string;
        id: string;
        dryRun?: boolean;
        yes?: boolean;
        purgeTemp?: boolean;
      }) => {
        const scope = parseForgetScope(opts.scope);
        const plan = resolveForgetPlan({
          cfg: loadConfig(),
          scope,
          id: opts.id,
          purgeTemp: opts.purgeTemp === true,
        });

        note(`Scope: ${plan.scope} · id: ${plan.id}`);
        for (const edit of plan.storeEdits) {
          note(`store edit: ${edit.storePath} (remove ${edit.keys.join(", ")})`);
        }
        for (const target of plan.targets) {
          note(
            `${target.exists ? "delete" : "skip (missing)"}: ${target.path} — ${target.description}`,
          );
        }
        if (plan.storeEdits.length === 0 && plan.targets.length === 0) {
          note("Nothing found to forget.");
          return;
        }

        const execute = opts.yes === true && opts.dryRun !== true;
        if (!execute) {
          note(`Dry run only. Re-run with --yes to delete.`);
          return;
        }

        const report = await executeForgetPlan(plan);
        for (const edit of report.removedStoreKeys) {
          note(`removed from store ${edit.storePath}: ${edit.keys.join(", ") || "(none)"}`);
        }
        for (const deleted of report.deleted) {
          note(`deleted: ${deleted}`);
        }
        for (const skipped of report.skipped) {
          note(`skipped (missing): ${skipped}`);
        }
        for (const failure of report.failed) {
          note(`FAILED: ${failure.path} — ${failure.error}`);
        }
        if (report.failed.length > 0) {
          throw new Error(`data forget completed with ${report.failed.length} failure(s)`);
        }
      },
    );

  data
    .command("canonicalize-workspace-catalog")
    .description(
      "Rewrite historical workspace locators to STATE_DIR/TENANTS_ROOT and retire short steward ids (dry-run by default)",
    )
    .option(
      "--yes",
      "Apply the planned catalog updates (creates a catalog.json backup first)",
      false,
    )
    .option(
      "--fix-permissions",
      "Also restore owner-write on official workspace directories",
      false,
    )
    .action(async (opts: { yes?: boolean; fixPermissions?: boolean }) => {
      await canonicalizeWorkspaceCatalogCommand({
        yes: opts.yes === true,
        fixPermissions: opts.fixPermissions === true,
      });
    });
}
