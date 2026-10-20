import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? packageRoot,
    encoding: "utf8",
    env: options.env ?? process.env,
    stdio: options.stdio ?? "pipe",
  });

  if (result.status !== 0) {
    const message =
      `Command failed: ${command} ${args.join(" ")}\n` +
      `cwd=${options.cwd ?? packageRoot}\n` +
      `status=${result.status}\n` +
      `stdout=${result.stdout ?? ""}\n` +
      `stderr=${result.stderr ?? ""}`;
    throw new Error(message);
  }

  return (result.stdout ?? "").trim();
}

function getCliBinPath(installRoot) {
  return process.platform === "win32"
    ? join(installRoot, "node_modules", ".bin", "cogniweave.cmd")
    : join(installRoot, "node_modules", ".bin", "cogniweave");
}

function main() {
  const tempRoot = mkdtempSync(join(tmpdir(), "cogniweave-install-smoke-"));
  const packDir = join(tempRoot, "pack");
  const installDir = join(tempRoot, "install");
  const npmCacheDir = join(tempRoot, "npm-cache");
  const env = {
    ...process.env,
    npm_config_cache: npmCacheDir,
  };

  try {
    mkdirSync(packDir, { recursive: true });
    mkdirSync(installDir, { recursive: true });
    mkdirSync(npmCacheDir, { recursive: true });

    const tarballName = run("npm", ["pack", "--pack-destination", packDir], { env })
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1);

    if (!tarballName) {
      throw new Error("npm pack did not produce a tarball name");
    }

    const tarballPath = join(packDir, tarballName);

    run("npm", ["init", "-y"], { cwd: installDir, env });
    run("npm", ["install", tarballPath], { cwd: installDir, env });

    run(
      "node",
      [
        "--input-type=module",
        "-e",
        [
          "const sdk = await import('@cogniweave/sdk');",
          "const contracts = await import('@cogniweave/sdk/contracts');",
          "if (typeof sdk.InMemoryCogniWeaveEngine !== 'function') {",
          "  throw new Error('missing InMemoryCogniWeaveEngine export');",
          "}",
          "if (typeof contracts !== 'object' || contracts === null) {",
          "  throw new Error('contracts subpath import failed');",
          "}",
          "console.log('import-ok');",
        ].join(" "),
      ],
      { cwd: installDir, env },
    );

    run(getCliBinPath(installDir), ["--version", "--json"], { cwd: installDir, env });

    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          tarball: tarballName,
          checks: ["root-import", "contracts-subpath-import", "cli-version"],
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

main();
