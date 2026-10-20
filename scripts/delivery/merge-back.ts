import { pathToFileURL } from "node:url";

export type MergeBackPlan = {
  cutoverSha: string;
  sotBranch: string;
  reviewBranch: string;
  commands: string[];
};

function validateSha(sha: string): string {
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) {
    throw new Error("cutover SHA must contain 7 to 40 hexadecimal characters");
  }
  return sha.toLowerCase();
}

function validateBranch(branch: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch) || branch.includes("..")) {
    throw new Error("invalid SoT branch name");
  }
  return branch;
}

export function createMergeBackPlan(input: {
  cutoverSha: string;
  sotBranch: string;
}): MergeBackPlan {
  const cutoverSha = validateSha(input.cutoverSha);
  const sotBranch = validateBranch(input.sotBranch);
  const reviewBranch = `merge-back/${cutoverSha.slice(0, 12)}`;
  return {
    cutoverSha,
    sotBranch,
    reviewBranch,
    commands: [
      `git fetch origin ${sotBranch}`,
      `git switch -c ${reviewBranch} origin/${sotBranch}`,
      `git merge --no-ff ${cutoverSha}`,
      `git push -u origin ${reviewBranch}`,
      `gh pr create --base ${sotBranch} --head ${reviewBranch}`,
    ],
  };
}

function option(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? (args[index + 1] ?? null) : null;
}

/**
 * `main` is the sole trunk. The old default, `release/baseline-recovery-20260725`, is
 * frozen and must never receive a merge-back.
 */
export function resolveMergeBackArgs(args: string[]): {
  cutoverSha: string | null;
  sotBranch: string;
} {
  return {
    cutoverSha: option(args, "--cutover-sha"),
    sotBranch: option(args, "--sot-branch") ?? "main",
  };
}

function main(): void {
  const { cutoverSha, sotBranch } = resolveMergeBackArgs(process.argv.slice(2));
  if (!cutoverSha) {
    throw new Error("usage: delivery:merge-back-plan --cutover-sha <sha> [--sot-branch <branch>]");
  }
  const plan = createMergeBackPlan({ cutoverSha, sotBranch });
  process.stdout.write(`${JSON.stringify({ dryRun: true, autoPush: false, ...plan }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
