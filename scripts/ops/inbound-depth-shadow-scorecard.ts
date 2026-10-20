#!/usr/bin/env node
/**
 * InboundDepth shadow harvest scorecard (ops).
 *
 * Reads durable JSONL written under
 *   $OPENBOT_STATE_DIR/inbound-depth-harvest/depth-decided-YYYY-MM-DD.jsonl
 * and prints wouldDepth mix + under-route risk samples for ROUTER go/no-go.
 *
 * Usage:
 *   bun scripts/ops/inbound-depth-shadow-scorecard.ts
 *   bun scripts/ops/inbound-depth-shadow-scorecard.ts --root /var/lib/openbot/state/inbound-depth-harvest
 *   bun scripts/ops/inbound-depth-shadow-scorecard.ts --file /path/to/depth-decided-2026-10-15.jsonl
 *
 * Read-only. No LIVE env mutation. Does not enable ROUTER.
 */
import fs from "node:fs";
import path from "node:path";
import {
  buildInboundDepthScorecard,
  readInboundDepthHarvestRecords,
  resolveInboundDepthHarvestRoot,
} from "../../src/gateway/chat-inbound-depth-harvest.ts";

type Args = {
  root?: string;
  file?: string;
  limit?: number;
  help?: boolean;
};

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (arg === "--root") {
      out.root = argv[++i];
      continue;
    }
    if (arg === "--file") {
      out.file = argv[++i];
      continue;
    }
    if (arg === "--limit") {
      const raw = argv[++i];
      const n = Number.parseInt(raw ?? "", 10);
      if (Number.isFinite(n) && n > 0) {
        out.limit = n;
      }
      continue;
    }
    throw new Error(`unknown arg: ${arg}`);
  }
  return out;
}

function printHelp(): void {
  process.stdout.write(`InboundDepth shadow scorecard

Usage:
  bun scripts/ops/inbound-depth-shadow-scorecard.ts [--root DIR] [--file FILE] [--limit N]

Default root: $OPENBOT_STATE_DIR/inbound-depth-harvest
  (or OPENCLAW_STATE_DIR / CLAWDBOT_STATE_DIR legacy)

Prints JSON scorecard: byWouldDepth, byMode, byReason, underRouteRisk*, goNoGoHints.
Does not flip ROUTER. Pair with deploy/production/exec-efficiency-inbound-depth-greyscale.md.
`);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const root = args.root
    ? path.resolve(args.root)
    : args.file
      ? undefined
      : resolveInboundDepthHarvestRoot();
  if (args.file && !fs.existsSync(args.file)) {
    throw new Error(`file not found: ${args.file}`);
  }
  if (root && !args.file && !fs.existsSync(root)) {
    process.stdout.write(
      `${JSON.stringify(
        {
          total: 0,
          root,
          goNoGoHints: ["no_samples", "harvest_dir_missing"],
          hint: "After DIGEST with SHADOW=1, depth_decided lines land under this root.",
        },
        null,
        2,
      )}\n`,
    );
    return;
  }
  const records = readInboundDepthHarvestRecords({
    rootDir: root,
    filePath: args.file,
    limit: args.limit,
  });
  const scorecard = buildInboundDepthScorecard(records);
  process.stdout.write(
    `${JSON.stringify(
      {
        ...scorecard,
        root: root ?? null,
        file: args.file ?? null,
      },
      null,
      2,
    )}\n`,
  );
}

main();
