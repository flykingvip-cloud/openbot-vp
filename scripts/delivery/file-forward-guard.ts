/**
 * R8/R9 of the delivery-alignment-guard spec: forward-only at file level.
 *
 * `isForwardOnly` proves history containment and nothing more. A candidate can contain
 * every LIVE commit and still replace a file with an older variant that drops exports
 * which are running in production right now. `detectRegressedPaths` catches whole
 * deleted paths and returns `reverted: []` as a placeholder; this module fills that half
 * in by comparing the exported surface of each file.
 *
 * Measured on the audit that produced this: 55 lost exports across 20 files, every one
 * of them still deployed, plus two RPC registries that dropped 67 and 85 already
 * advertised method names. None of it is visible to a commit-level ancestry check.
 */

export type ExportSurface = {
  names: ReadonlySet<string>;
  /**
   * `export * from "x"` cannot be enumerated without resolving the target module, so a
   * file carrying one can never be reported as "nothing lost". Callers warn instead.
   */
  starReexports: readonly string[];
};

/** Reads one version of the tree. Git-backed in production, plain map in tests. */
export type TreeReader = {
  read(path: string): string | null;
  list(): readonly string[];
  /**
   * Optional fast path for "which files mention this token". Without it, locating a moved
   * export means reading every file in the tree, which is fine for a map in a test and
   * eleven thousand `git show` calls in a real repository.
   */
  grep?(token: string): readonly string[];
};

export type LostExportDisposition = "moved" | "gone";

export type LostExport = {
  name: string;
  disposition: LostExportDisposition;
  /** Where the symbol turned up in the candidate, when it moved rather than vanished. */
  movedTo?: string;
};

export type FileVerdict = "identical" | "regression" | "diverged" | "ahead" | "new" | "deleted";

export type FileFinding = {
  path: string;
  verdict: FileVerdict;
  lost: LostExport[];
  added: string[];
  /** Non-empty means the lost/added sets are a lower bound, not the whole truth. */
  starReexportWarning: readonly string[];
};

const DECLARATION_EXPORT =
  /^[ \t]*export[ \t]+(?:declare[ \t]+)?(?:default[ \t]+)?(?:async[ \t]+)?(?:function[ \t]*\*?|class|const|let|var|type|interface|enum|abstract[ \t]+class)[ \t]+([A-Za-z_$][\w$]*)/gm;
const BRACED_EXPORT = /^[ \t]*export[ \t]+(?:type[ \t]+)?\{([^}]*)\}/gms;
const STAR_REEXPORT = /^[ \t]*export[ \t]+\*[ \t]+from[ \t]*["']([^"']+)["']/gm;
const STAR_NAMESPACE_REEXPORT = /^[ \t]*export[ \t]+\*[ \t]+as[ \t]+([A-Za-z_$][\w$]*)[ \t]+from/gm;

/**
 * Collect the names a module exports.
 *
 * The re-export forms are the trap. Parsing only declaration-style exports reports every
 * "extract to a shared module" refactor as a deletion: during the audit
 * `export { redactSecretText as redactSecrets }` was read as a lost export and produced a
 * false regression. So braced forms count too, and an aliased entry contributes the name
 * *after* `as`, because that is what importers see.
 */
export function parseExportSurface(source: string): ExportSurface {
  const names = new Set<string>();
  for (const match of source.matchAll(DECLARATION_EXPORT)) {
    names.add(match[1]);
  }
  for (const match of source.matchAll(STAR_NAMESPACE_REEXPORT)) {
    names.add(match[1]);
  }
  for (const match of source.matchAll(BRACED_EXPORT)) {
    for (const entry of match[1].split(",")) {
      const trimmed = entry.trim();
      if (!trimmed) {
        continue;
      }
      const aliased = /\bas[ \t]+([A-Za-z_$][\w$]*)[ \t]*$/.exec(trimmed);
      if (aliased) {
        names.add(aliased[1]);
        continue;
      }
      const bare = /^(?:type[ \t]+)?([A-Za-z_$][\w$]*)$/.exec(trimmed);
      if (bare) {
        names.add(bare[1]);
      }
    }
  }
  const starReexports = [...source.matchAll(STAR_REEXPORT)].map((match) => match[1]);
  return { names, starReexports };
}

/**
 * Where did a lost export go?
 *
 * Without this every refactor that moves a symbol into a shared module is reported as a
 * regression, the tool gets ignored, and it stops catching the real thing. Scans the
 * candidate for another module that exports the same name.
 */
function locateExport(name: string, candidate: TreeReader, excludePath: string): string | null {
  const searchSpace = candidate.grep ? candidate.grep(name) : candidate.list();
  for (const path of searchSpace) {
    if (path === excludePath || !/\.(ts|tsx|mts|cts)$/.test(path)) {
      continue;
    }
    const source = candidate.read(path);
    if (!source || !source.includes(name)) {
      continue;
    }
    if (parseExportSurface(source).names.has(name)) {
      return path;
    }
  }
  return null;
}

/**
 * Compare one file's exported surface between the deployed baseline and the candidate.
 *
 * The baseline is the LIVE commit, never the tip of an integration branch. During the
 * audit the two were measured diverged, and using the tip would have cleared files that
 * drop still-running exports.
 */
export function classifyFile(
  path: string,
  baseline: TreeReader,
  candidate: TreeReader,
): FileFinding {
  const before = baseline.read(path);
  const after = candidate.read(path);
  const empty = { lost: [] as LostExport[], added: [] as string[], starReexportWarning: [] };
  if (before === null) {
    return after === null
      ? { path, verdict: "identical", ...empty }
      : { path, verdict: "new", ...empty, added: [...parseExportSurface(after).names].toSorted() };
  }
  if (after === null) {
    return {
      path,
      verdict: "deleted",
      ...empty,
      lost: [...parseExportSurface(before).names]
        .toSorted()
        .map((name) => resolveDisposition(name, candidate, path)),
    };
  }
  if (before === after) {
    return { path, verdict: "identical", ...empty };
  }
  const beforeSurface = parseExportSurface(before);
  const afterSurface = parseExportSurface(after);
  const lost = [...beforeSurface.names]
    .filter((name) => !afterSurface.names.has(name))
    .toSorted()
    .map((name) => resolveDisposition(name, candidate, path));
  const added = [...afterSurface.names].filter((name) => !beforeSurface.names.has(name)).toSorted();
  const starReexportWarning = [
    ...new Set([...beforeSurface.starReexports, ...afterSurface.starReexports]),
  ].toSorted();
  const gone = lost.filter((entry) => entry.disposition === "gone");
  const verdict: FileVerdict =
    gone.length > 0 ? "regression" : lost.length === 0 && added.length > 0 ? "ahead" : "diverged";
  return { path, verdict, lost, added, starReexportWarning };
}

function resolveDisposition(name: string, candidate: TreeReader, path: string): LostExport {
  const movedTo = locateExport(name, candidate, path);
  return movedTo ? { name, disposition: "moved", movedTo } : { name, disposition: "gone" };
}

export type FileAuditSummary = {
  findings: FileFinding[];
  counts: Record<FileVerdict, number>;
  /** Files that drop exports with nowhere else to find them. The blocking set. */
  regressions: FileFinding[];
};

export function auditFiles(
  paths: readonly string[],
  baseline: TreeReader,
  candidate: TreeReader,
): FileAuditSummary {
  const findings = paths.toSorted().map((path) => classifyFile(path, baseline, candidate));
  const counts: Record<FileVerdict, number> = {
    identical: 0,
    regression: 0,
    diverged: 0,
    ahead: 0,
    new: 0,
    deleted: 0,
  };
  for (const finding of findings) {
    counts[finding.verdict] += 1;
  }
  return {
    findings,
    counts,
    regressions: findings.filter(
      (finding) => finding.verdict === "regression" || finding.verdict === "deleted",
    ),
  };
}

const RELATIVE_IMPORT = /(?:from|import)[ \t]*\(?[ \t]*["'](\.[^"']*)["']/g;

export type DependencyFinding = {
  specifier: string;
  /** Path it resolves to in the target tree, or null when nothing matches. */
  resolvedTo: string | null;
};

function joinPath(fromDir: string, specifier: string): string {
  const segments = fromDir ? fromDir.split("/") : [];
  for (const part of specifier.split("/")) {
    if (part === "." || part === "") {
      continue;
    }
    if (part === "..") {
      segments.pop();
      continue;
    }
    segments.push(part);
  }
  return segments.join("/");
}

/**
 * R9: can this version of the file even be written onto the target tree?
 *
 * Repairing a file-level regression means writing the deployed version back, and that
 * only works when that version's own relative imports resolve on the target. Three
 * attempts during the audit produced one success and two dependency cascades; the second
 * bottomed out in a capability the target branch was missing wholesale, so that merge was
 * only possible on the other line. Checking first turns a multi-hour discovery into a
 * command.
 */
export function resolveRelativeDependencies(
  path: string,
  source: string,
  target: TreeReader,
): DependencyFinding[] {
  const directory = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  const specifiers = [...new Set([...source.matchAll(RELATIVE_IMPORT)].map((match) => match[1]))];
  return specifiers.toSorted().map((specifier) => {
    const base = joinPath(directory, specifier);
    const withoutJs = base.replace(/\.js$/, "");
    const candidates = [
      base,
      `${withoutJs}.ts`,
      `${withoutJs}.tsx`,
      `${base}.ts`,
      `${base}.tsx`,
      `${withoutJs}/index.ts`,
      `${base}/index.ts`,
    ];
    const resolvedTo = candidates.find((entry) => target.read(entry) !== null) ?? null;
    return { specifier, resolvedTo };
  });
}

export type RepairFeasibility = {
  path: string;
  feasible: boolean;
  unresolved: string[];
};

/** Whether the baseline version of `path` can be written onto `target` as-is. */
export function canWriteBaselineOnto(
  path: string,
  baseline: TreeReader,
  target: TreeReader,
): RepairFeasibility {
  const source = baseline.read(path);
  if (source === null) {
    return { path, feasible: false, unresolved: [] };
  }
  const unresolved = resolveRelativeDependencies(path, source, target)
    .filter((finding) => finding.resolvedTo === null)
    .map((finding) => finding.specifier);
  return { path, feasible: unresolved.length === 0, unresolved };
}
