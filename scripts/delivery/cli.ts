import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { decideDelivery, type GitRunner } from "./forward-guard.js";
import { parseLedger } from "./ledger.js";
import {
  createDefaultLiveShaReaders,
  parseLatestCutoverSha,
  resolveLiveSha,
  type LiveShaReaders,
} from "./resolve-live-sha.js";
import { evaluateSotConsistency } from "./sot-consistency.js";

const EXIT_ALLOW = 0;
const EXIT_BLOCK = 20;
const EXIT_UNKNOWN_LIVE = 21;
const DEFAULT_PROTECTED_GLOBS = ["src/**", "ui/src/**", "dist/**"];

type ParsedOptions = {
  candidate?: string;
  liveSha?: string;
  intentionalRevert?: string;
  allowUnknownLive: boolean;
  sotRef?: string;
  trunkRef?: string;
  useReleaseRecordLive: boolean;
  releaseRecord?: string;
};

type CliDependencies = {
  git: GitRunner;
  readers: LiveShaReaders;
};

export type CliResult = {
  code: 0 | 20 | 21;
  payload: Record<string, unknown>;
};

function parseOptions(args: string[]): ParsedOptions {
  const options: ParsedOptions = {
    allowUnknownLive: false,
    useReleaseRecordLive: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = () => {
      const next = args[index + 1];
      if (!next) {
        throw new Error(`${arg} requires a value`);
      }
      index += 1;
      return next;
    };
    switch (arg) {
      case "--":
        break;
      case "--candidate":
        options.candidate = value();
        break;
      case "--live-sha":
        options.liveSha = value();
        break;
      case "--intentional-revert":
        options.intentionalRevert = value();
        break;
      case "--allow-unknown-live":
        options.allowUnknownLive = true;
        break;
      case "--sot-ref":
        // Accepted for backward compatibility. check-sot no longer treats an advanceable
        // branch as the SoT; it anchors on the open ledger row + provenance tag + origin/main.
        options.sotRef = value();
        break;
      case "--trunk-ref":
        options.trunkRef = value();
        break;
      case "--use-release-record-live":
        options.useReleaseRecordLive = true;
        break;
      case "--release-record":
        options.releaseRecord = value();
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

export function createGitRunner(cwd = process.cwd()): GitRunner {
  return (args) => {
    const result = spawnSync("git", args, { cwd, encoding: "utf8" });
    return {
      code: result.status ?? 1,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  };
}

function resolveCommit(ref: string, git: GitRunner): string | null {
  const result = git(["rev-parse", "--verify", `${ref}^{commit}`]);
  return result.code === 0 ? result.stdout.trim() : null;
}

async function resolveRecordLive(readers: LiveShaReaders): Promise<string | null> {
  return parseLatestCutoverSha(await readers.releaseRecord());
}

export async function runDeliveryCli(
  argv: string[],
  dependencies?: Partial<CliDependencies>,
): Promise<CliResult> {
  const [command = "verify", ...rawOptions] = argv;
  if (command !== "verify" && command !== "check-sot") {
    throw new Error(`unknown delivery command: ${command}`);
  }
  const options = parseOptions(rawOptions);
  const git = dependencies?.git ?? createGitRunner();
  const readers =
    dependencies?.readers ??
    createDefaultLiveShaReaders({ releaseRecordPath: options.releaseRecord });
  const injectedSha = options.useReleaseRecordLive
    ? await resolveRecordLive(readers)
    : options.liveSha;
  const liveResolution = await resolveLiveSha({ injectedSha: injectedSha ?? undefined, readers });

  if (command === "check-sot") {
    const trunkRef = options.trunkRef ?? "origin/main";
    const ledgerText = await readers.ledger();
    const ledgerOpenShas = ledgerText
      ? parseLedger(ledgerText)
          .rows.filter((row) => row.liveTo === undefined)
          .map((row) => row.gatewaySha)
      : [];
    const sot = evaluateSotConsistency({
      liveSha: liveResolution.sha,
      releaseRecordSha: liveResolution.recordSha,
      ledgerOpenShas,
      resolveProvenanceTag: (sha) => resolveCommit(`provenance/sha-${sha.slice(0, 12)}`, git),
      trunkContainsLive: (sha) => git(["merge-base", "--is-ancestor", sha, trunkRef]).code === 0,
    });
    const sotCode =
      sot.verdict === "allow"
        ? EXIT_ALLOW
        : sot.verdict === "unknown"
          ? EXIT_UNKNOWN_LIVE
          : EXIT_BLOCK;
    return {
      code: sotCode,
      payload: {
        command,
        verdict: sot.verdict,
        live: sot.live,
        ledgerLive: sot.ledgerLive,
        liveSource: liveResolution.source,
        trunkRef,
        ledgerOpenShas,
        reasons: sot.reasons,
        warnings: liveResolution.warnings,
        releaseRecordSha: liveResolution.recordSha,
        recommendation: sot.recommendation,
      },
    };
  }

  const candidateRef = options.candidate ?? "HEAD";
  const candidate = resolveCommit(candidateRef, git) ?? candidateRef;
  const decision = decideDelivery({
    live: liveResolution.sha,
    candidate,
    protectedGlobs: DEFAULT_PROTECTED_GLOBS,
    git,
    allowUnknownLive: options.allowUnknownLive,
    intentionalRevert: options.intentionalRevert,
  });

  const code =
    decision.verdict === "allow"
      ? EXIT_ALLOW
      : liveResolution.sha === null
        ? EXIT_UNKNOWN_LIVE
        : EXIT_BLOCK;
  const recommendation =
    decision.verdict === "block"
      ? "Candidate is behind or diverged from LIVE; rebase or merge LIVE before cutover."
      : null;

  return {
    code,
    payload: {
      command,
      verdict: decision.verdict,
      live: liveResolution.sha,
      liveSource: liveResolution.source,
      candidate,
      candidateRef,
      forwardOnly: decision.forwardOnly,
      regressions: decision.regressions,
      reasons: decision.reasons,
      warnings: liveResolution.warnings,
      releaseRecordSha: liveResolution.recordSha,
      intentionalRevert: decision.intentionalRevert ?? null,
      recommendation,
    },
  };
}

async function main(): Promise<void> {
  try {
    const result = await runDeliveryCli(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result.payload, null, 2)}\n`);
    process.exitCode = result.code;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 20;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
