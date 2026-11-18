import { resolveStateDir } from "../config/paths.js";
import { getSharedDataGovernanceCatalog } from "../gateway/data-governance/runtime-catalog.js";
import {
  applyWorkspaceCatalogCanonicalization,
  backupGovernanceCatalogFile,
  planWorkspaceCatalogCanonicalization,
  resolveOfficialWorkspaceRoots,
} from "../gateway/data-governance/workspace-locator-canonicalization.js";
import { note } from "../terminal/note.js";

export async function canonicalizeWorkspaceCatalogCommand(opts: {
  yes?: boolean;
  fixPermissions?: boolean;
}): Promise<void> {
  const roots = resolveOfficialWorkspaceRoots();
  const catalog = getSharedDataGovernanceCatalog({ stateDir: resolveStateDir(process.env) });
  const records = await catalog.list("workspace");
  const actions = planWorkspaceCatalogCanonicalization({ records, roots });
  if (actions.length === 0) {
    note("Workspace catalog already uses the official locator and steward id.");
    return;
  }
  for (const action of actions) {
    if (action.kind === "rewrite_locator") {
      note(`locator ${action.resourceId}: ${action.from} -> ${action.to}`);
    } else if (action.kind === "retire_short_steward") {
      note(
        `retire short steward id ${action.resourceId}; official ${action.officialResourceId}${action.mintOfficial ? " (mint)" : ""}`,
      );
    } else {
      note(`restore owner write on ${action.locator} (mode ${action.mode})`);
    }
  }
  if (opts.yes !== true) {
    note("Dry run only. Re-run with --yes to apply. Use --fix-permissions to restore owner write.");
    return;
  }
  const backup = backupGovernanceCatalogFile(roots.stateDir);
  note(`Catalog backup: ${backup}`);
  const report = await applyWorkspaceCatalogCanonicalization({
    catalog,
    actions,
    applyPermissions: opts.fixPermissions === true,
  });
  note(
    `Applied ${report.applied.length}; skipped ${report.skipped.length}; failed ${report.errors.length}.`,
  );
  for (const skip of report.skipped) {
    note(`skipped ${skip.action.kind}: ${skip.reason}`);
  }
  for (const failure of report.errors) {
    note(`FAILED ${failure.action.kind}: ${failure.error}`);
  }
  if (report.errors.length > 0) {
    throw new Error(
      `canonicalize workspace catalog completed with ${report.errors.length} failure(s)`,
    );
  }
}
