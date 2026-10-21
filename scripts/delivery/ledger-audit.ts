// CLI: audit a production release ledger against real git ancestry.
//
// The canonical ledger is the OHBE copy. When this repo only has the stub at
// deploy/production/LEDGER.md, the default invocation exits 0 and does not invent a local ledger.
//
// Read-only. Exit 0 when no errors, 30 when the ledger records a regression or a broken
// identity. Warnings (overlay debt, missing tag, unobserved row) never fail the run;
// they are the delivery debt report.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type { GitRunner } from "./forward-guard.ts";
import {
  externalLedgerMessage,
  LOCAL_LEDGER_PATH,
  localLedgerExternalized,
} from "./ledger-location.ts";
import { auditLedger, parseLedger } from "./ledger.ts";

const gitRunner: GitRunner = (args) => {
  const result = spawnSync("git", args, { encoding: "utf8" });
  return { code: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
};

function main(): number {
  const path = process.argv[2] ?? LOCAL_LEDGER_PATH;
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (process.argv[2] === undefined && localLedgerExternalized()) {
      console.log(externalLedgerMessage());
      console.log("ledger: external, audit skipped in openbot-vp");
      return 0;
    }
    console.error(`cannot read ledger at ${path}: ${(error as Error).message}`);
    return 30;
  }

  const { rows, errors } = parseLedger(text);
  for (const parseError of errors) {
    console.error(`${path}:${parseError.line}: ${parseError.message}`);
  }

  const audit = auditLedger(rows, gitRunner);
  const errorFindings = audit.findings.filter((f) => f.severity === "error");
  const warnings = audit.findings.filter((f) => f.severity === "warning");

  console.log(
    `ledger: ${rows.length} releases, ${errorFindings.length} errors, ${warnings.length} warnings`,
  );
  for (const finding of errorFindings) {
    console.error(`  ERROR seq ${finding.seq} [${finding.code}] ${finding.message}`);
  }
  for (const finding of warnings) {
    console.log(`  warn  seq ${finding.seq} [${finding.code}] ${finding.message}`);
  }

  return errors.length > 0 || errorFindings.length > 0 ? 30 : 0;
}

process.exit(main());
