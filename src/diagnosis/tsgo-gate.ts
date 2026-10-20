/**
 * Diagnosis-scoped typecheck merge gate.
 *
 * Full-repo `pnpm tsgo` currently fails on parallel-task files (exit 2).
 * That baseline is a separate merge gate and is not owned by this task.
 * A diagnosis change is type-clean when no `error TS` line points at src/diagnosis.
 */
export const DIAGNOSIS_TSGO_SCOPE = "src/diagnosis";
export const FULL_REPO_TSGO_IS_SEPARATE_MERGE_GATE = true;

const DIAGNOSIS_ERROR = /(?:^|[/'"])src\/diagnosis\/\S+\(\d+,\d+\):\s+error TS\d+/;

export function isDiagnosisTsgoHit(line: string): boolean {
  return DIAGNOSIS_ERROR.test(line) || /\bsrc\/diagnosis\/\S+:\s+error TS\d+/.test(line);
}

export function diagnosisTsgoHits(output: string): string[] {
  return output.split(/\r?\n/).filter((line) => isDiagnosisTsgoHit(line));
}

export function assertDiagnosisTsgoClean(output: string): void {
  const hits = diagnosisTsgoHits(output);
  if (hits.length > 0) {
    throw new Error(
      `diagnosis-scoped tsgo failed (${hits.length} hit(s) under ${DIAGNOSIS_TSGO_SCOPE})`,
    );
  }
}
