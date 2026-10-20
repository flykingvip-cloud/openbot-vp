/**
 * Golden DiagnosticRunGraph — fixture envelope only.
 * ReplayResult / runner DiagnosticRunGraph must not grow these fields.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  DiagnosisRelation,
  DiagnosticAssessment,
  DiagnosticAttribution,
  DiagnosticCase,
  DiagnosticEvidence,
  DiagnosticFinding,
  DiagnosticHypothesis,
  DiagnosticObservation,
  DiagnosticRun,
  DiagnosticVerification,
} from "./types.js";

/** Protocol Case plus slice-contract fields that validators ignore. */
export type FixtureCase = DiagnosticCase & {
  mergeKey?: string;
  mergedObservationPredicates?: string[];
};

/**
 * Frozen scenario graph on disk. Superset of the runner replay input.
 * `case` / findings / relations live here, never on ReplayResult.
 */
export type GoldenDiagnosticRunGraph = {
  schemaVersion: 1;
  graphKind: "DiagnosticRunGraph";
  run: DiagnosticRun;
  evidences: DiagnosticEvidence[];
  observations: DiagnosticObservation[];
  assessments: DiagnosticAssessment[];
  attributions: DiagnosticAttribution[];
  hypotheses: DiagnosticHypothesis[];
  findings: DiagnosticFinding[];
  relations: DiagnosisRelation[];
  case: FixtureCase;
  verification: DiagnosticVerification | null;
};

const DIAGNOSIS_FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

/**
 * Shared JSON reader for diagnosis/report golden graphs.
 * Test-only fixture loader — not Mode B F4 persistence convergence.
 * All Phase 1 / report tests must use this instead of local loadGraph copies.
 */
export function loadGoldenDiagnosticRunGraph(name: string): GoldenDiagnosticRunGraph {
  return JSON.parse(
    fs.readFileSync(path.join(DIAGNOSIS_FIXTURE_DIR, name), "utf8"),
  ) as GoldenDiagnosticRunGraph;
}
