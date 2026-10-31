import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/i;
const SHA_IN_TEXT_PATTERN = /[0-9a-f]{40}/i;

export type LiveShaSource = "injected" | "endpoint" | "container" | "container-copy" | "none";

export type LiveShaResolution = {
  sha: string | null;
  source: LiveShaSource;
  recordSha: string | null;
  warnings: string[];
};

export type LiveShaReaders = {
  endpoint: () => Promise<string | null>;
  container: () => Promise<string | null>;
  stoppedContainer: () => Promise<string | null>;
  releaseRecord: () => Promise<string | null>;
  /**
   * Raw text of a ledger file, or null when unreadable.
   * The default path is the historical openbot-vp copy and is not the live ledger.
   * Live ledger: deploy/production/releases.jsonl (Path B machine SoT in this repo)
   */
  ledger: () => Promise<string | null>;
};

function extractCommitFromRecord(record: Record<string, unknown>): string | null {
  const direct = record.commit;
  if (typeof direct === "string") {
    // Explicit commit field: only accept a full git SHA. UI overlays often put a
    // label here (e.g. "homepage-mac-download-255"); never scrape sibling digests
    // such as entrySha256, which also match /[0-9a-f]{40}/.
    return FULL_SHA_PATTERN.test(direct) ? direct.toLowerCase() : null;
  }
  const buildInfo = record["build-info"] ?? record.buildInfo;
  if (typeof buildInfo === "object" && buildInfo !== null) {
    return extractCommitFromRecord(buildInfo as Record<string, unknown>);
  }
  return null;
}

function extractCommit(value: string | null): string | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed === "object" && parsed !== null) {
      return extractCommitFromRecord(parsed as Record<string, unknown>);
    }
  } catch {
    // Some version endpoints return decorated text instead of JSON.
  }
  return value.match(SHA_IN_TEXT_PATTERN)?.[0]?.toLowerCase() ?? null;
}

export function parseLatestCutoverSha(markdown: string | null): string | null {
  if (!markdown) {
    return null;
  }
  // Prefer the managed generated current-identity block (ledger↔doc anti-drift).
  const begin = "<!-- BEGIN GENERATED: current-identity -->";
  const end = "<!-- END GENERATED: current-identity -->";
  const beginAt = markdown.indexOf(begin);
  const endAt = markdown.indexOf(end);
  if (beginAt >= 0 && endAt > beginAt) {
    const block = markdown.slice(beginAt + begin.length, endAt);
    const machine = block.match(/gatewaySha=([0-9a-f]{40})/i);
    if (machine) {
      return machine[1].toLowerCase();
    }
    const table = block
      .split("\n")
      .find((line) => /^\|\s*gatewaySha\s*\|/i.test(line))
      ?.match(SHA_IN_TEXT_PATTERN)?.[0];
    if (table) {
      return table.toLowerCase();
    }
  }
  // Fallback: legacy "## Latest cutover" table (may lag until regenerate).
  const latest = markdown.match(/## Latest cutover[^]*?(?=\n---|\n## |$)/i)?.[0] ?? "";
  const sourceRow = latest.split("\n").find((line) => /^\|\s*Source revision\s*\|/i.test(line));
  return sourceRow?.match(SHA_IN_TEXT_PATTERN)?.[0]?.toLowerCase() ?? null;
}

function extractFirstTarFile(buffer: Buffer): string | null {
  if (buffer.length < 512) {
    return buffer.toString("utf8");
  }
  const sizeText = buffer.subarray(124, 136).toString("ascii").replaceAll("\0", "").trim();
  const size = Number.parseInt(sizeText, 8);
  if (!Number.isFinite(size) || size < 0 || 512 + size > buffer.length) {
    return buffer.toString("utf8");
  }
  return buffer.subarray(512, 512 + size).toString("utf8");
}

async function readSshText(host: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("ssh", [
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      host,
      ...args,
    ]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function readStoppedContainer(
  host: string,
  container: string,
  buildInfoPath: string,
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "ssh",
      [
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=10",
        host,
        "podman",
        "cp",
        `${container}:${buildInfoPath}`,
        "-",
      ],
      { encoding: "buffer", maxBuffer: 1024 * 1024 },
    );
    return extractFirstTarFile(stdout);
  } catch {
    return null;
  }
}

export function createDefaultLiveShaReaders(options?: {
  endpoint?: string;
  host?: string;
  container?: string;
  buildInfoPath?: string;
  releaseRecordPath?: string;
  ledgerPath?: string;
}): LiveShaReaders {
  const endpoint = options?.endpoint ?? process.env.OPENBOT_PRODUCTION_BUILD_INFO_URL ?? "";
  const host = options?.host ?? process.env.OPENBOT_PRODUCTION_SSH_HOST ?? "root@8.217.93.71";
  const container =
    options?.container ?? process.env.OPENBOT_PRODUCTION_CONTAINER ?? "openbot-gateway-rc";
  const buildInfoPath =
    options?.buildInfoPath ??
    process.env.OPENBOT_PRODUCTION_BUILD_INFO_PATH ??
    "/app/dist/build-info.json";
  const releaseRecordPath = options?.releaseRecordPath ?? "deploy/production/RELEASE_RECORD.md";
  // Historical openbot-vp path. The file is gone; reading it is not a live SoT lookup.
  // Live ledger: deploy/production/releases.jsonl (Path B machine SoT in this repo)
  const ledgerPath = options?.ledgerPath ?? "deploy/production/releases.jsonl";

  return {
    endpoint: async () => {
      if (!endpoint) {
        return null;
      }
      try {
        const response = await fetch(endpoint, { signal: AbortSignal.timeout(5_000) });
        return response.ok ? await response.text() : null;
      } catch {
        return null;
      }
    },
    container: () => readSshText(host, ["podman", "exec", container, "cat", buildInfoPath]),
    stoppedContainer: () => readStoppedContainer(host, container, buildInfoPath),
    releaseRecord: async () => {
      try {
        return await fs.readFile(releaseRecordPath, "utf8");
      } catch {
        return null;
      }
    },
    ledger: async () => {
      try {
        return await fs.readFile(ledgerPath, "utf8");
      } catch {
        return null;
      }
    },
  };
}

export async function resolveLiveSha(options: {
  injectedSha?: string;
  readers: LiveShaReaders;
}): Promise<LiveShaResolution> {
  const recordSha = parseLatestCutoverSha(await options.readers.releaseRecord());
  const warnings: string[] = [];
  const injected = options.injectedSha?.trim().toLowerCase();
  if (injected) {
    if (!FULL_SHA_PATTERN.test(injected)) {
      return {
        sha: null,
        source: "none",
        recordSha,
        warnings: ["injected LIVE SHA must contain 40 hexadecimal characters"],
      };
    }
    if (recordSha && recordSha !== injected) {
      warnings.push(`running/injected LIVE ${injected} differs from release record ${recordSha}`);
    }
    return { sha: injected, source: "injected", recordSha, warnings };
  }

  const candidates: Array<
    [Exclude<LiveShaSource, "injected" | "none">, () => Promise<string | null>]
  > = [
    ["endpoint", options.readers.endpoint],
    ["container", options.readers.container],
    ["container-copy", options.readers.stoppedContainer],
  ];
  for (const [source, reader] of candidates) {
    const sha = extractCommit(await reader());
    if (!sha) {
      continue;
    }
    if (recordSha && recordSha !== sha) {
      warnings.push(`running artifact LIVE ${sha} differs from release record ${recordSha}`);
    }
    return { sha, source, recordSha, warnings };
  }

  return {
    sha: null,
    source: "none",
    recordSha,
    warnings: ["unable to resolve LIVE from a running artifact"],
  };
}
