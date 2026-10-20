/**
 * loom.ts — Loom CLI entry (MVP / Wave 1).
 *
 * Subcommands (design §C5 Wave 1):
 *   loom import [--write] [--json]   build initial Registry from legacy sources
 *   loom status [--json]             ownership + lifecycle view
 *   loom audit  [...flags]           landing audit (delegates to worktree-audit)
 *   loom check  [--strict] [--json]  Shadow-mode zero-regression parity (M1 gate)
 *
 * Local-first, no network. All subcommands support `--json` for CI/pre-commit.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { runCheck, formatCheckReport } from "./loom/check.js";
import { claimTaskId, findUnattributedPaths, groupByDir } from "./loom/claim.js";
import {
  deriveAgentsBlock,
  deriveCodeowners,
  handleResolver,
  loadCodeownersConfig,
} from "./loom/derive.js";
import { Git } from "./loom/git.js";
import { globToRegExp, loadDirtyStatus, loadStagedFiles } from "./loom/glob.js";
import { importFromLegacy } from "./loom/import.js";
import { formatSuggestions, suggestPaths } from "./loom/learn.js";
import { formatLint, hasErrors, lintRegistry } from "./loom/lint.js";
import {
  start,
  land,
  abandon,
  reconcile,
  taskList,
  issueMatchesTaskId,
  type StartArgs,
} from "./loom/provision.js";
import { applyRegister, type RegisterSession } from "./loom/register.js";
import {
  emptyRegistry,
  loadRegistry,
  type Registry,
  RegistryNotFoundError,
  registryPath,
  saveRegistry,
  type TaskState,
} from "./loom/registry.js";
import { buildStatus, formatStatus } from "./loom/status.js";

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function readOpt(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

/**
 * Parse `--issue <n>` as a positive integer. Returns `undefined` when the flag is
 * absent and `null` when it is present but malformed, so callers can reject the
 * invocation instead of silently dropping the traceability binding.
 */
function readIssue(args: string[], name = "--issue"): number | undefined | null {
  const raw = readOpt(args, name);
  if (raw === undefined) {
    return undefined;
  }
  if (!/^\d+$/.test(raw)) {
    return null;
  }
  const value = Number(raw);
  return value > 0 ? value : null;
}

function readList(args: string[], name: string): string[] | undefined {
  const raw = readOpt(args, name);
  return raw === undefined
    ? undefined
    : raw
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
}

function loadOrEmpty() {
  try {
    return loadRegistry(process.cwd());
  } catch (error) {
    if (error instanceof RegistryNotFoundError) {
      return emptyRegistry();
    }
    throw error;
  }
}

function requireRegistry(): ReturnType<typeof loadRegistry> | null {
  try {
    return loadRegistry(process.cwd());
  } catch (error) {
    if (error instanceof RegistryNotFoundError) {
      console.error(error.message);
      return null;
    }
    throw error;
  }
}

function cmdImport(args: string[]): number {
  const asJson = hasFlag(args, "--json");
  const write = hasFlag(args, "--write");
  // --force bypasses the guard below and performs a FULL overwrite: it regenerates
  // the registry from legacy and discards ALL registry-native state (sessions,
  // ownerHistory, directly-registered tasks, parallel/orphan streams). The refusal
  // message enumerates exactly what would be lost, so --force = informed consent.
  const force = hasFlag(args, "--force");
  const { registry, conflicts } = importFromLegacy(process.cwd());

  // Guard: `import --write` FULLY REPLACES the registry from legacy sources
  // (LEGACY_RULES + `## Agents` blocks). The Registry has since become the
  // stateful source of truth, so a blind regenerate would silently destroy every
  // piece of state that has no legacy counterpart: task sessions, ownerHistory
  // takeover chains, directly-registered tasks, and landing streams that only
  // exist in the registry (e.g. parallel HUB, which legacy AuditRule cannot even
  // express). Refuse when data would be lost; require --force to override.
  if (write && !force) {
    let existing: Registry | null = null;
    try {
      existing = loadRegistry(process.cwd());
    } catch (error) {
      if (!(error instanceof RegistryNotFoundError)) {
        throw error;
      }
    }
    if (existing) {
      const importedStreamIds = new Set(registry.landingStreams.map((s) => s.id));
      const importedTaskIds = new Set(registry.tasks.map((t) => t.id));
      const droppedStreams = existing.landingStreams
        .filter((s) => !importedStreamIds.has(s.id))
        .map((s) => s.id);
      const droppedTasks = existing.tasks.filter((t) => !importedTaskIds.has(t.id)).length;
      const sessionCount = existing.tasks.reduce((n, t) => n + t.sessions.length, 0);
      const ownerHistoryCount = existing.tasks.reduce((n, t) => n + t.ownerHistory.length, 0);
      if (
        droppedStreams.length > 0 ||
        droppedTasks > 0 ||
        sessionCount > 0 ||
        ownerHistoryCount > 0
      ) {
        console.error(
          "Refusing `loom import --write`: it regenerates the Registry from legacy " +
            "sources and would destroy live state that has no legacy counterpart:",
        );
        console.error(`  - task sessions lost: ${sessionCount}`);
        console.error(`  - ownerHistory takeover chains lost: ${ownerHistoryCount}`);
        console.error(`  - directly-registered tasks dropped: ${droppedTasks}`);
        console.error(
          `  - landing streams with no legacy rule dropped: ${
            droppedStreams.length > 0 ? droppedStreams.join(", ") : "(none)"
          }`,
        );
        console.error(
          "\nThe Registry is now the source of truth; `import` is a one-time legacy " +
            "migration tool. Re-run with --force only if you truly intend to discard the above.",
        );
        return 1;
      }
    }
  }

  if (write) {
    saveRegistry(registry, process.cwd());
  }
  if (asJson) {
    console.log(JSON.stringify({ registry, conflicts, written: write }, null, 2));
  } else {
    console.log("Loom import (legacy → Registry)");
    console.log(`- tasks (ownership): ${registry.tasks.length}`);
    console.log(`- landing streams (audit): ${registry.landingStreams.length}`);
    console.log(`- conflicts: ${conflicts.length}`);
    for (const conflict of conflicts) {
      console.log(`  [${conflict.kind}] ${conflict.detail}`);
    }
    console.log(write ? `\nWrote ${registryPath()}` : "\n(dry run; pass --write to persist)");
  }
  return 0;
}

function cmdStatus(args: string[]): number {
  const asJson = hasFlag(args, "--json");
  const registry = requireRegistry();
  if (!registry) {
    return 1;
  }
  const view = buildStatus(registry);
  console.log(asJson ? JSON.stringify(view, null, 2) : formatStatus(view));
  return 0;
}

function cmdRegister(args: string[]): number {
  const taskId = readOpt(args, "--task");
  if (!taskId) {
    console.error("loom register requires --task <id>");
    return 1;
  }
  const sessionId = readOpt(args, "--session-id");
  const session: RegisterSession | undefined = sessionId
    ? {
        id: sessionId,
        ide: readOpt(args, "--ide") ?? "unknown",
        agent: readOpt(args, "--agent") ?? readOpt(args, "--owner") ?? "unknown",
      }
    : undefined;
  const issue = readIssue(args);
  if (issue === null) {
    console.error("loom register --issue must be a positive integer (the GitHub issue number).");
    return 1;
  }
  const next = applyRegister(loadOrEmpty(), {
    taskId,
    owner: readOpt(args, "--owner"),
    issue,
    intent: readList(args, "--intent"),
    paths: readList(args, "--paths"),
    state: readOpt(args, "--state") as TaskState | undefined,
    via: readOpt(args, "--via") as "verified" | "confirmed" | undefined,
    session,
  });
  saveRegistry(next, process.cwd());
  const task = next.tasks.find((t) => t.id === taskId)!;
  const issuePart = task.issue == null ? "" : `, issue=#${task.issue}`;
  console.log(
    `Registered "${task.id}" (owner=${task.owner}${issuePart}, state=${task.state}, paths=${task.paths.length}, sessions=${task.sessions.length}). Wrote ${registryPath()}`,
  );
  return 0;
}

function cmdDerive(args: string[]): number {
  const registry = requireRegistry();
  if (!registry) {
    return 1;
  }
  if (hasFlag(args, "--codeowners")) {
    return cmdDeriveCodeowners(registry, args);
  }
  console.log(deriveAgentsBlock(registry));
  return 0;
}

/**
 * `loom derive --codeowners` — render, write, or drift-check `.github/CODEOWNERS`
 * from the registry (engineering-governance R11.1/R11.2).
 */
function cmdDeriveCodeowners(registry: Registry, args: string[]): number {
  const cwd = process.cwd();
  const config = loadCodeownersConfig(cwd);
  const result = deriveCodeowners(registry, { handleFor: handleResolver(config) });

  // Fail loudly rather than emit `@some-agent-id`, which GitHub reports as an
  // unknown owner and which silently disables the whole file.
  if (result.unmapped.length > 0) {
    console.error(
      `loom derive --codeowners: ${result.unmapped.length} agent(s) have no GitHub handle mapping:`,
    );
    for (const agent of result.unmapped) {
      console.error(`  - ${agent}`);
    }
    console.error(
      "Add `codeowners.handles.<agent>` or `codeowners.defaultHandle` to .loom/config.yaml.",
    );
    console.error("Registry owners are agent ids, not GitHub accounts, so a mapping is required.");
    return 1;
  }
  for (const entry of result.skipped) {
    console.warn(`warning: skipped path "${entry.path}" — ${entry.reason}`);
  }

  const target = join(cwd, config.path);
  if (hasFlag(args, "--check")) {
    const actual = existsSync(target) ? readFileSync(target, "utf8") : null;
    if (actual === null) {
      console.error(`CODEOWNERS drift: ${config.path} is missing.`);
      console.error("Regenerate with `loom derive --codeowners --write`.");
      return 1;
    }
    if (actual !== result.content) {
      console.error(`CODEOWNERS drift: ${config.path} does not match the registry.`);
      console.error("Regenerate with `loom derive --codeowners --write`.");
      return 1;
    }
    console.log(`CODEOWNERS: OK (${config.path} matches the registry).`);
    return 0;
  }
  if (hasFlag(args, "--write")) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, result.content, "utf8");
    console.log(`Wrote ${config.path} from ${registryPath()}.`);
    return 0;
  }
  process.stdout.write(result.content);
  return 0;
}

function cmdLint(args: string[]): number {
  const asJson = hasFlag(args, "--json");
  const strict = hasFlag(args, "--strict");
  const registry = requireRegistry();
  if (!registry) {
    return 1;
  }
  const issues = lintRegistry(registry);
  console.log(asJson ? JSON.stringify(issues, null, 2) : formatLint(issues));
  if (strict && issues.length > 0) {
    return 1;
  }
  return hasErrors(issues) ? 1 : 0;
}

function cmdSuggest(args: string[]): number {
  const taskId = readOpt(args, "--task");
  if (!taskId) {
    console.error("loom suggest requires --task <id>");
    return 1;
  }
  const registry = requireRegistry();
  if (!registry) {
    return 1;
  }
  const target = registry.tasks.find((t) => t.id === taskId);
  if (!target) {
    console.error(`Unknown task "${taskId}". Register it first with \`loom register\`.`);
    return 1;
  }
  // Exclude files already covered by this task, and any file owned by another
  // task (R3.4: never cross into another task's matched paths).
  const ownGlobs = target.paths.map(globToRegExp);
  const otherGlobs = registry.tasks
    .filter((t) => t.id !== taskId)
    .flatMap((t) => t.paths.map(globToRegExp));
  const candidateFiles = loadDirtyStatus(process.cwd())
    .map((entry) => entry.path)
    .filter(
      (path) => !ownGlobs.some((re) => re.test(path)) && !otherGlobs.some((re) => re.test(path)),
    );
  const suggestions = suggestPaths({ candidateFiles });
  console.log(
    hasFlag(args, "--json")
      ? JSON.stringify(suggestions, null, 2)
      : formatSuggestions(taskId, suggestions),
  );
  return 0; // read-only; never writes
}

function cmdAccept(args: string[]): number {
  const taskId = readOpt(args, "--task");
  const paths = readList(args, "--paths");
  if (!taskId || !paths || paths.length === 0) {
    console.error("loom accept requires --task <id> --paths <glob[,glob...]>");
    return 1;
  }
  const registry = requireRegistry();
  if (!registry) {
    return 1;
  }
  if (!registry.tasks.some((t) => t.id === taskId)) {
    console.error(`Unknown task "${taskId}". Register it first with \`loom register\`.`);
    return 1;
  }
  const next = applyRegister(registry, { taskId, paths });
  saveRegistry(next, process.cwd());
  const task = next.tasks.find((t) => t.id === taskId)!;
  console.log(
    `Accepted ${paths.length} path glob(s) into "${taskId}" (now ${task.paths.length}). Wrote ${registryPath()}`,
  );
  return 0;
}

function resolveOwner(args: string[]): string | undefined {
  return readOpt(args, "--owner") ?? process.env.LOOM_AGENT;
}

function cmdUnattributed(args: string[]): number {
  const asJson = hasFlag(args, "--json");
  const staged = hasFlag(args, "--staged");
  const registry = requireRegistry();
  if (!registry) {
    return 1;
  }
  const files = staged
    ? loadStagedFiles(process.cwd())
    : loadDirtyStatus(process.cwd()).map((entry) => entry.path);
  const unattributed = findUnattributedPaths(registry, files);
  if (asJson) {
    console.log(JSON.stringify({ scope: staged ? "staged" : "dirty", unattributed }, null, 2));
    return 0;
  }
  console.log(`Loom unattributed (${staged ? "staged" : "dirty tree"}) — no agent signed in`);
  console.log(`- files checked: ${files.length}`);
  console.log(`- unattributed: ${unattributed.length}`);
  if (unattributed.length > 0) {
    console.log("");
    for (const [dir, paths] of [...groupByDir(unattributed)].toSorted((a, b) =>
      a[0].localeCompare(b[0]),
    )) {
      console.log(`  ${dir}/  (${paths.length})`);
    }
    const owner = resolveOwner(args) ?? "<your-agent-id>";
    console.log("");
    console.log("Sign in for the files you are committing (run before committing):");
    console.log(`  loom claim --staged --owner ${owner}`);
  }
  return 0;
}

function cmdClaim(args: string[]): number {
  const owner = resolveOwner(args);
  if (!owner) {
    console.error("loom claim requires --owner <id> (or set LOOM_AGENT).");
    return 1;
  }
  const staged = hasFlag(args, "--staged");
  const files = staged ? loadStagedFiles(process.cwd()) : (readList(args, "--paths") ?? []);
  if (files.length === 0) {
    console.error("loom claim requires --staged or --paths <a,b> with at least one path.");
    return 1;
  }
  const registry = loadOrEmpty();
  const taskId = readOpt(args, "--task") ?? claimTaskId(owner);
  // Only claim paths not already owned by another task (never steal ownership).
  const ownedByOther = new Set(
    files.filter((file) =>
      registry.tasks.some(
        (task) => task.id !== taskId && task.paths.some((glob) => globToRegExp(glob).test(file)),
      ),
    ),
  );
  const toClaim = files.filter((file) => !ownedByOther.has(file));
  if (ownedByOther.size > 0) {
    console.log(`Skipping ${ownedByOther.size} file(s) already owned by another task:`);
    for (const file of ownedByOther) {
      console.log(`  - ${file}`);
    }
  }
  if (toClaim.length === 0) {
    console.log("Nothing to claim (all files already owned).");
    return 0;
  }
  const next = applyRegister(registry, { taskId, owner, paths: toClaim });
  saveRegistry(next, process.cwd());
  console.log(
    `Signed in: claimed ${toClaim.length} path(s) under task "${taskId}" (owner=${owner}). Wrote ${registryPath()}`,
  );
  return 0;
}

function cmdAudit(args: string[]): number {
  // Delegate to the rich audit CLI (all output modes + flags), which itself
  // reads the Registry when present (registry-gated cutover).
  execFileSync("node", ["--import", "tsx", "scripts/worktree-audit.ts", ...args], {
    cwd: process.cwd(),
    stdio: "inherit",
  });
  return 0;
}

function cmdCheck(args: string[]): number {
  const asJson = hasFlag(args, "--json");
  const strict = hasFlag(args, "--strict");
  const result = runCheck(process.cwd());
  console.log(asJson ? JSON.stringify(result, null, 2) : formatCheckReport(result));
  return strict && !result.ok ? 1 : 0;
}

function parseIdentity(raw: string | undefined): { name: string; email: string } | undefined {
  if (!raw) {
    return undefined;
  }
  const sep = raw.indexOf(":");
  if (sep < 0) {
    throw new Error('--identity must be "Name:email@example.com"');
  }
  return { name: raw.slice(0, sep).trim(), email: raw.slice(sep + 1).trim() };
}

function cmdTaskStart(args: string[]): number {
  const taskId = readOpt(args, "--task");
  const owner = resolveOwner(args);
  if (!taskId || !owner) {
    console.error("loom task start requires --task <id> and --owner <id> (or LOOM_AGENT).");
    return 1;
  }
  const issue = readIssue(args);
  if (issue === null) {
    console.error("loom task start --issue must be a positive integer (the GitHub issue number).");
    return 1;
  }
  const startArgs: StartArgs = {
    taskId,
    owner,
    issue,
    from: readOpt(args, "--from"),
    identity: parseIdentity(readOpt(args, "--identity")),
    ide: readOpt(args, "--ide"),
    sessionId: readOpt(args, "--session-id"),
    dryRun: hasFlag(args, "--dry-run"),
  };
  const result = start(startArgs, {
    git: new Git(),
    loadRegistry: loadOrEmpty,
    saveRegistry: (registry) => saveRegistry(registry, process.cwd()),
  });
  // Traceability nudges (R2.4/R2.6). Advisory, never fatal: `start` succeeded and
  // failing here would leave a provisioned worktree with no way to record the bind.
  if (issue === undefined) {
    console.warn(
      `warning: task "${result.taskId}" has no issue binding. Pass --issue <n> so the change can be traced back to a requirement (loom lint: active-task-no-issue).`,
    );
  } else if (!issueMatchesTaskId(result.taskId, issue)) {
    console.warn(
      `warning: task id "${result.taskId}" does not reference issue #${issue}, so branch "${result.branch}" is not self-describing. Convention: <issue>-<slug>.`,
    );
  }
  if (hasFlag(args, "--json")) {
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }
  const verb = result.dryRun ? "[dry-run] would create" : "Created";
  console.log(`${verb} worktree for task "${result.taskId}":`);
  console.log(`  branch:   ${result.branch}`);
  console.log(`  worktree: ${result.worktreePath}`);
  console.log(`  base:     ${result.base}`);
  if (result.issue != null) {
    console.log(`  issue:    #${result.issue}`);
  }
  if (!result.dryRun) {
    console.log(`  enter it: cd ${result.worktreePath}`);
  }
  return 0;
}

function cmdTaskLand(args: string[]): number {
  const taskId = readOpt(args, "--task");
  const owner = resolveOwner(args);
  if (!taskId || !owner) {
    console.error("loom task land requires --task <id> and --owner <id> (or LOOM_AGENT).");
    return 1;
  }
  const modeOpt = readOpt(args, "--mode");
  if (modeOpt && modeOpt !== "merge" && modeOpt !== "pr") {
    console.error('loom task land --mode must be "merge" or "pr".');
    return 1;
  }
  const outcome = land(
    {
      taskId,
      owner,
      mode: modeOpt as "merge" | "pr" | undefined,
      keepBranch: hasFlag(args, "--keep-branch"),
      dryRun: hasFlag(args, "--dry-run"),
    },
    {
      git: new Git(),
      loadRegistry: loadOrEmpty,
      saveRegistry: (registry) => saveRegistry(registry, process.cwd()),
    },
  );
  if (hasFlag(args, "--json")) {
    console.log(JSON.stringify(outcome, null, 2));
  } else {
    console.log(`land "${outcome.taskId}" (${outcome.mode}): ${outcome.result}`);
    if (outcome.detail) {
      console.log(`  ${outcome.detail}`);
    }
  }
  return outcome.result === "SUCCESS" ? 0 : 1;
}

function cmdTaskAbandon(args: string[]): number {
  const taskId = readOpt(args, "--task");
  const owner = resolveOwner(args);
  if (!taskId || !owner) {
    console.error("loom task abandon requires --task <id> and --owner <id> (or LOOM_AGENT).");
    return 1;
  }
  const outcome = abandon(
    {
      taskId,
      owner,
      force: hasFlag(args, "--force"),
      yes: hasFlag(args, "--yes"),
      deleteBranch: hasFlag(args, "--delete-branch"),
      dryRun: hasFlag(args, "--dry-run"),
    },
    {
      git: new Git(),
      loadRegistry: loadOrEmpty,
      saveRegistry: (registry) => saveRegistry(registry, process.cwd()),
    },
  );
  if (hasFlag(args, "--json")) {
    console.log(JSON.stringify(outcome, null, 2));
    return outcome.blocked || outcome.needsConfirm ? 1 : 0;
  }
  const loss = outcome.lossSummary;
  const lossText = loss
    ? `${loss.dirty ? "uncommitted changes" : ""}${loss.dirty && loss.unpushed ? " + " : ""}${
        loss.unpushed ? `${loss.ahead} unpushed commit(s)` : ""
      }`
    : "";
  if (outcome.blocked) {
    console.error(
      `Refusing to abandon "${outcome.taskId}": worktree has ${lossText}. ` +
        `Commit/push first, or re-run with --force --yes to discard.`,
    );
    return 1;
  }
  if (outcome.needsConfirm) {
    console.error(
      `About to PERMANENTLY discard ${lossText} in ${outcome.worktreePath}.\n` +
        `This cannot be undone. Re-run with --force --yes to confirm.`,
    );
    return 1;
  }
  const verb = outcome.dryRun ? "[dry-run] would abandon" : "Abandoned";
  const suffix = lossText ? ` (discarded ${lossText})` : "";
  console.log(`${verb} "${outcome.taskId}" (${outcome.worktreePath})${suffix}`);
  return 0;
}

function cmdTaskList(args: string[]): number {
  const rows = taskList({ git: new Git(), loadRegistry: loadOrEmpty });
  if (hasFlag(args, "--json")) {
    console.log(JSON.stringify(rows, null, 2));
    return 0;
  }
  if (rows.length === 0) {
    console.log("No provisioned worktrees.");
    return 0;
  }
  console.log("Loom provisioned worktrees:");
  for (const row of rows) {
    const flags = [
      row.finding !== "OK" ? row.finding : "",
      row.dirty ? "dirty" : "",
      row.ahead ? `ahead ${row.ahead}` : "",
      row.behind ? `behind ${row.behind}` : "",
    ]
      .filter(Boolean)
      .join(", ");
    console.log(
      `  ${row.taskId} [${row.owner}] ${row.branch ?? "-"}  ${row.worktreePath ?? "-"}${flags ? `  (${flags})` : ""}`,
    );
  }
  return 0;
}

function cmdTaskReconcile(args: string[]): number {
  const modeOpt = readOpt(args, "--mode") ?? "report";
  if (modeOpt !== "dry" && modeOpt !== "report" && modeOpt !== "apply") {
    console.error('loom task reconcile --mode must be "dry", "report", or "apply".');
    return 1;
  }
  if (modeOpt === "apply" && !hasFlag(args, "--yes")) {
    console.error("loom task reconcile --mode apply requires --yes to confirm mutations.");
    return 1;
  }
  const report = reconcile(
    { taskId: readOpt(args, "--task"), mode: modeOpt },
    {
      git: new Git(),
      loadRegistry: loadOrEmpty,
      saveRegistry: (registry) => saveRegistry(registry, process.cwd()),
    },
  );
  if (hasFlag(args, "--json")) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }
  console.log(`Loom reconcile (${report.mode}):`);
  for (const row of report.rows) {
    console.log(
      `  ${row.finding.padEnd(18)} ${row.taskId} ${row.branch ?? ""} ${row.worktreePath ?? ""}`,
    );
  }
  if (report.repaired.length > 0) {
    console.log("Repaired:");
    for (const r of report.repaired) {
      console.log(`  ${r.taskId}: ${r.action}`);
    }
  }
  return 0;
}

function cmdTaskRepair(args: string[]): number {
  const taskId = readOpt(args, "--task");
  if (!taskId) {
    console.error("loom task repair requires --task <id>.");
    return 1;
  }
  // repair == single-task reconcile --mode apply (requires --yes).
  return cmdTaskReconcile([...args, "--mode", "apply"]);
}

function cmdTask(args: string[]): number {
  const [sub, ...rest] = args;
  switch (sub) {
    case "start":
      return cmdTaskStart(rest);
    case "land":
      return cmdTaskLand(rest);
    case "abandon":
      return cmdTaskAbandon(rest);
    case "list":
      return cmdTaskList(rest);
    case "reconcile":
      return cmdTaskReconcile(rest);
    case "repair":
      return cmdTaskRepair(rest);
    default:
      console.error(
        `Unknown task subcommand: ${sub ?? "(none)"}. Available: start, land, abandon, list, reconcile, repair`,
      );
      return 1;
  }
}

const COMMANDS: Record<string, (args: string[]) => number> = {
  import: cmdImport,
  register: cmdRegister,
  status: cmdStatus,
  audit: cmdAudit,
  check: cmdCheck,
  derive: cmdDerive,
  lint: cmdLint,
  suggest: cmdSuggest,
  accept: cmdAccept,
  unattributed: cmdUnattributed,
  claim: cmdClaim,
  task: cmdTask,
};

function usage(): void {
  console.log(
    "Usage: loom <import|register|status|audit|check|derive|lint|suggest|accept|unattributed|claim|task> [options]",
  );
  console.log(
    "  import [--write] [--json]                         build initial Registry from legacy sources",
  );
  console.log(
    "  register --task <id> [--owner <o>] [--paths a,b]  create/update an ownership task",
  );
  console.log("           [--issue <n>] [--intent a,b] [--state <s>]");
  console.log("           [--session-id <id> --ide <x> --agent <a>]");
  console.log("  status [--json]                                   ownership + lifecycle view");
  console.log(
    "  audit  [...flags]                                 landing audit (forwards to worktree-audit)",
  );
  console.log(
    "  check  [--strict] [--json]                        Shadow-mode zero-regression parity (M1 gate)",
  );
  console.log(
    "  derive                                            print the `## Agents` view from the Registry",
  );
  console.log(
    "  derive --codeowners [--write | --check]            derive .github/CODEOWNERS from the Registry",
  );
  console.log(
    "           (--check = CI drift gate; needs codeowners handles in .loom/config.yaml)",
  );
  console.log(
    "  lint   [--strict] [--json]                        Registry business-consistency checks",
  );
  console.log(
    "  suggest --task <id> [--json]                      propose path globs (read-only, confidence)",
  );
  console.log(
    "  accept  --task <id> --paths <a,b>                 write human-confirmed path globs",
  );
  console.log(
    "  unattributed [--staged] [--json]                  list files no agent has signed in for",
  );
  console.log(
    "  claim  --owner <id> [--staged | --paths <a,b>]    sign in: claim files for an agent",
  );
  console.log(
    "  task start --task <id> --owner <o> [--from <ref>] create isolated worktree + branch",
  );
  console.log("           [--issue <n>] [--identity Name:email] [--dry-run] [--json]");
  console.log("           (--issue binds the task to a GitHub issue: intent -> code join key)");
  console.log(
    "  task land  --task <id> --owner <o> [--mode merge|pr] two-phase land (gate+rebase, then merge/PR)",
  );
  console.log("           [--keep-branch] [--dry-run] [--json]");
  console.log(
    "  task abandon --task <id> --owner <o> [--force --yes]  tear down worktree (kept branch by default)",
  );
  console.log("           [--delete-branch] [--dry-run] [--json]  (--force --yes to discard work)");
  console.log(
    "  task list [--json]                                list provisioned worktrees + health",
  );
  console.log(
    "  task reconcile [--task <id>] [--mode dry|report|apply]  report/repair registry-vs-git drift",
  );
  console.log("           [--yes] [--json]  (default report = read-only; apply needs --yes)");
  console.log(
    "  task repair --task <id> --yes                     apply safe repairs for one task",
  );
}

function main(): void {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h") {
    usage();
    process.exit(command ? 0 : 1);
  }
  const handler = COMMANDS[command];
  if (!handler) {
    console.error(`Unknown command: ${command}`);
    usage();
    process.exit(1);
  }
  try {
    process.exit(handler(args));
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

export {
  cmdImport,
  cmdStatus,
  cmdAudit,
  cmdCheck,
  cmdRegister,
  cmdDerive,
  cmdLint,
  cmdSuggest,
  cmdAccept,
  cmdUnattributed,
  cmdClaim,
};
