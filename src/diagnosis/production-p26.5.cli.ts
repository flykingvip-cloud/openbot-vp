#!/usr/bin/env bun
/**
 * P26.5 readonly diagnosis admission runner.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DIAGNOSIS_P26_5_FROZEN_CANDIDATE_SHA,
  evaluateDiagnosisProductionP26_5,
  renderDiagnosisProductionP26_5Markdown,
} from "./production-p26.5.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");

type CliOptions = {
  candidateSha?: string;
  liveSha?: string;
  jsonOut?: string;
  mdOut?: string;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (!next) {
        throw new Error(`${arg} requires a value`);
      }
      index += 1;
      return next;
    };
    switch (arg) {
      case "--candidate-sha":
        options.candidateSha = value();
        break;
      case "--live-sha":
        options.liveSha = value();
        break;
      case "--json-out":
        options.jsonOut = value();
        break;
      case "--md-out":
        options.mdOut = value();
        break;
      default:
        if (arg.startsWith("-")) {
          throw new Error(`unknown flag ${arg}`);
        }
    }
  }
  return options;
}

function writeIfRequested(filePath: string | undefined, contents: string): void {
  if (!filePath) {
    return;
  }
  const resolved = path.resolve(repoRoot, filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, contents);
}

export async function runDiagnosisProductionP26_5(options: CliOptions = {}) {
  return evaluateDiagnosisProductionP26_5({
    candidateSha: options.candidateSha ?? DIAGNOSIS_P26_5_FROZEN_CANDIDATE_SHA,
    liveSha: options.liveSha ?? process.env.OPENBOT_DIAGNOSIS_LIVE_SHA,
  });
}

if (import.meta.main) {
  const options = parseArgs(process.argv.slice(2));
  const report = await runDiagnosisProductionP26_5(options);
  writeIfRequested(options.jsonOut, `${JSON.stringify(report, null, 2)}\n`);
  writeIfRequested(options.mdOut, renderDiagnosisProductionP26_5Markdown(report));
  console.log(renderDiagnosisProductionP26_5Markdown(report));
  process.exit(report.readonlyAdmissionReady ? 0 : 1);
}
