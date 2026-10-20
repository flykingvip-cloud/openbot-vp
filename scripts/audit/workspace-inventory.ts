/**
 * Workspace inventory CLI (P0-a) — stdout only, read-only.
 *
 * Usage:
 *   OPENBOT_STATE_DIR=/path/to/.openbot \
 *     node --import tsx scripts/audit/workspace-inventory.ts --mode inventory-raw
 *
 *   OPENBOT_STATE_DIR=... node --import tsx scripts/audit/workspace-inventory.ts --mode inventory-raw \
 *     | node --import tsx scripts/audit/workspace-inventory.ts --mode summary-redacted --evidence-id inv-001
 *
 * Env limits (optional): MAX_CANDIDATES, MAX_FILES, MAX_DEPTH, MAX_BYTES_READ, MAX_FULL_HASH_BYTES
 */

import fs from "node:fs";
import {
  resolveInventoryContainmentRoot,
  runWorkspaceInventory,
  toRedactedInventorySummary,
  verifySummarySha256,
  WORKSPACE_INVENTORY_RAW_SCHEMA,
} from "../../src/gateway/workspace-inventory/index.js";

function die(message: string, code = 2): never {
  console.error(message);
  process.exit(code);
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    die(`${name} must be a non-negative number`);
  }
  return Math.floor(n);
}

function parseArgs(argv: string[]) {
  let mode = "inventory-raw";
  let evidenceId = "";
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--mode") {
      mode = argv[++i] ?? "";
      continue;
    }
    if (arg.startsWith("--mode=")) {
      mode = arg.slice("--mode=".length);
      continue;
    }
    if (arg === "--evidence-id") {
      evidenceId = argv[++i] ?? "";
      continue;
    }
    if (arg.startsWith("--evidence-id=")) {
      evidenceId = arg.slice("--evidence-id=".length);
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(`Usage:
  OPENBOT_STATE_DIR=... node --import tsx scripts/audit/workspace-inventory.ts --mode inventory-raw
  ... | node --import tsx scripts/audit/workspace-inventory.ts --mode summary-redacted --evidence-id <id>
`);
      process.exit(0);
    }
    die(`unknown argument: ${arg}`);
  }
  if (mode !== "inventory-raw" && mode !== "summary-redacted") {
    die(`--mode must be inventory-raw or summary-redacted (got ${mode})`);
  }
  return { mode, evidenceId };
}

function readStdinJson(): unknown {
  const text = fs.readFileSync(0, "utf8").trim();
  if (!text) {
    die("expected inventory JSON on stdin");
  }
  return JSON.parse(text);
}

function main() {
  const args = parseArgs(process.argv);
  const stateDirRaw = process.env.OPENBOT_STATE_DIR?.trim();
  if (!stateDirRaw && args.mode === "inventory-raw") {
    die("missing required env: OPENBOT_STATE_DIR");
  }

  if (args.mode === "inventory-raw") {
    const containmentRoot = resolveInventoryContainmentRoot(stateDirRaw!);
    const report = runWorkspaceInventory({
      containmentRoot,
      limits: {
        maxCandidates: envInt("MAX_CANDIDATES", 500),
        maxFiles: envInt("MAX_FILES", 20_000),
        maxDepth: envInt("MAX_DEPTH", 24),
        maxBytesRead: envInt("MAX_BYTES_READ", 256 * 1024 * 1024),
        maxFullHashBytes: envInt("MAX_FULL_HASH_BYTES", 2 * 1024 * 1024),
      },
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  const raw = process.stdin.isTTY
    ? runWorkspaceInventory({
        containmentRoot: resolveInventoryContainmentRoot(stateDirRaw!),
      })
    : (readStdinJson() as ReturnType<typeof runWorkspaceInventory>);

  const expectedSchema: string = WORKSPACE_INVENTORY_RAW_SCHEMA;
  if (raw?.schema !== expectedSchema) {
    die(`expected raw schema ${expectedSchema}`);
  }
  const evidenceId = args.evidenceId?.trim() || "workspace-inventory-unspecified";
  const summary = toRedactedInventorySummary(raw, evidenceId);
  if (!verifySummarySha256(summary)) {
    die("internal error: summarySha256 mismatch");
  }
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main();
