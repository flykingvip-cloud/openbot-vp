import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const baseGitEnv = {
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
};
const baseRunEnv: NodeJS.ProcessEnv = { ...process.env, ...baseGitEnv };

const run = (cwd: string, cmd: string, args: string[] = [], env?: NodeJS.ProcessEnv) => {
  return execFileSync(cmd, args, {
    cwd,
    encoding: "utf8",
    env: env ? { ...baseRunEnv, ...env } : baseRunEnv,
  }).trim();
};

function setupHookSandbox(dir: string) {
  mkdirSync(path.join(dir, "git-hooks"), { recursive: true });
  mkdirSync(path.join(dir, "scripts", "pre-commit"), { recursive: true });
  mkdirSync(path.join(dir, "scripts"), { recursive: true });
  symlinkSync(
    path.join(process.cwd(), "git-hooks", "pre-commit"),
    path.join(dir, "git-hooks", "pre-commit"),
  );
  writeFileSync(
    path.join(dir, "scripts", "pre-commit", "run-node-tool.sh"),
    "#!/usr/bin/env bash\nexit 0\n",
    {
      encoding: "utf8",
      mode: 0o755,
    },
  );
  writeFileSync(
    path.join(dir, "scripts", "pre-commit", "filter-staged-files.mjs"),
    "process.exit(0);\n",
    "utf8",
  );
  writeFileSync(path.join(dir, "scripts", "worktree-audit.ts"), "console.log('audit');\n", "utf8");
}

describe("git-hooks/pre-commit (integration)", () => {
  it("does not treat staged filenames as git-add flags (e.g. --all)", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-pre-commit-"));
    run(dir, "git", ["init", "-q"]);

    // Use the real hook script and lightweight helper stubs.
    setupHookSandbox(dir);
    const fakeBinDir = path.join(dir, "bin");
    mkdirSync(fakeBinDir, { recursive: true });
    writeFileSync(
      path.join(fakeBinDir, "node"),
      `#!/usr/bin/env bash
for arg in "$@"; do
  case "$arg" in
    *worktree-audit.ts)
      exit 0
      ;;
  esac
done
exec /usr/local/bin/node "$@"
`,
      {
        encoding: "utf8",
        mode: 0o755,
      },
    );

    // Create an untracked file that should NOT be staged by the hook.
    writeFileSync(path.join(dir, "secret.txt"), "do-not-stage\n", "utf8");

    // Stage a maliciously-named file. Older hooks using `xargs git add` could run `git add --all`.
    writeFileSync(path.join(dir, "--all"), "flag\n", "utf8");
    run(dir, "git", ["add", "--", "--all"]);

    // Run the hook directly (same logic as when installed via core.hooksPath).
    run(dir, "bash", ["git-hooks/pre-commit"], {
      PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
    });

    const staged = run(dir, "git", ["diff", "--cached", "--name-only"]).split("\n").filter(Boolean);
    expect(staged).toEqual(["--all"]);
  });

  it("blocks staged changes that mix landing groups", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-pre-commit-"));
    run(dir, "git", ["init", "-q"]);
    setupHookSandbox(dir);

    const fakeBinDir = path.join(dir, "bin");
    mkdirSync(fakeBinDir, { recursive: true });
    writeFileSync(
      path.join(fakeBinDir, "node"),
      `#!/usr/bin/env bash
for arg in "$@"; do
  case "$arg" in
    *worktree-audit.ts)
      echo "mixed landing groups" >&2
      exit 1
      ;;
  esac
done
exit 0
`,
      {
        encoding: "utf8",
        mode: 0o755,
      },
    );

    writeFileSync(path.join(dir, "ui-change.ts"), "console.log('ui');\n", "utf8");
    writeFileSync(path.join(dir, "pkg-change.ts"), "console.log('pkg');\n", "utf8");
    run(dir, "git", ["add", "--", "ui-change.ts", "pkg-change.ts"]);

    expect(() =>
      run(dir, "bash", ["git-hooks/pre-commit"], {
        PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
      }),
    ).toThrowError(/mixed landing groups/);
  });

  it("invokes oxfmt without the unsupported double-dash separator", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-pre-commit-"));
    run(dir, "git", ["init", "-q"]);

    setupHookSandbox(dir);
    const fakeBinDir = path.join(dir, "bin");
    mkdirSync(fakeBinDir, { recursive: true });
    writeFileSync(
      path.join(fakeBinDir, "node"),
      `#!/usr/bin/env bash
for arg in "$@"; do
  case "$arg" in
    *worktree-audit.ts)
      exit 0
      ;;
  esac
done
exec /usr/local/bin/node "$@"
`,
      {
        encoding: "utf8",
        mode: 0o755,
      },
    );
    writeFileSync(
      path.join(dir, "scripts", "pre-commit", "filter-staged-files.mjs"),
      `#!/usr/bin/env node
const mode = process.argv[2];
if (mode === "format") {
  process.stdout.write("package.json");
  process.stdout.write("\\0");
}
`,
      { encoding: "utf8", mode: 0o755 },
    );
    writeFileSync(
      path.join(dir, "scripts", "pre-commit", "run-node-tool.sh"),
      `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" = "oxfmt" ]]; then
  shift
  printf '%s\n' "$@" > oxfmt-args.txt
fi
exit 0
`,
      {
        encoding: "utf8",
        mode: 0o755,
      },
    );

    writeFileSync(path.join(dir, "package.json"), '{\n"name":"x"\n}\n', "utf8");
    run(dir, "git", ["add", "--", "package.json"]);

    run(dir, "bash", ["git-hooks/pre-commit"], {
      PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
    });

    const args = run(dir, "cat", ["oxfmt-args.txt"]).split("\n").filter(Boolean);
    expect(args).toEqual(["--write", "package.json"]);
  });
});
