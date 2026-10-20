/**
 * learn.ts — path-glob suggestions with confidence (Requirement 3.2/3.4).
 *
 * `suggestPaths` is PURE (no I/O): given candidate files (the impure CLI feeds
 * it dirty-tree + git-log files NOT owned by other tasks), it induces candidate
 * globs by grouping files under their parent directory and scoring confidence by
 * density. It NEVER writes — `loom accept` (human-confirmed) does that (R3.3).
 */

export type PathSuggestion = {
  glob: string;
  confidence: number; // 0–100
  files: string[]; // the candidate files that motivated this glob
};

function parentDir(path: string): string | null {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? null : path.slice(0, slash);
}

/**
 * Confidence heuristic (documented, intentionally simple): denser directories
 * are stronger signals. 1 file → 45, 2 → 70, 3 → 95, capped at 95. A lone
 * root-level file is suggested verbatim at low confidence.
 */
function densityConfidence(fileCount: number): number {
  return Math.min(95, fileCount * 25 + 20);
}

/**
 * Suggest candidate path globs for a task from a set of candidate files.
 * The caller must pre-exclude files owned by OTHER tasks (R3.4) and files
 * already covered by the task's existing paths.
 */
export function suggestPaths(input: { candidateFiles: string[] }): PathSuggestion[] {
  const byDir = new Map<string, string[]>();
  const rootFiles: string[] = [];
  for (const file of input.candidateFiles) {
    const dir = parentDir(file);
    if (dir === null) {
      rootFiles.push(file);
      continue;
    }
    const bucket = byDir.get(dir) ?? [];
    bucket.push(file);
    byDir.set(dir, bucket);
  }

  const suggestions: PathSuggestion[] = [];
  for (const [dir, files] of byDir) {
    suggestions.push({
      glob: `${dir}/**`,
      confidence: densityConfidence(files.length),
      files: files.toSorted(),
    });
  }
  // Root-level files: suggest each verbatim (no directory to generalize over).
  for (const file of rootFiles.toSorted()) {
    suggestions.push({ glob: file, confidence: 45, files: [file] });
  }

  // Highest-confidence first; stable tiebreak by glob.
  return suggestions.toSorted(
    (a, b) => b.confidence - a.confidence || a.glob.localeCompare(b.glob),
  );
}

export function formatSuggestions(taskId: string, suggestions: PathSuggestion[]): string {
  if (suggestions.length === 0) {
    return `loom suggest: no new path suggestions for "${taskId}".`;
  }
  const lines = [`loom suggest for "${taskId}" (review, then \`loom accept\`):`];
  for (const s of suggestions) {
    lines.push(`  ${s.glob}  confidence: ${s.confidence}%  (${s.files.length} file(s))`);
  }
  lines.push("");
  lines.push("Nothing was written. Accept chosen globs with:");
  lines.push(`  loom accept --task ${taskId} --paths <glob[,glob...]>`);
  return lines.join("\n");
}
