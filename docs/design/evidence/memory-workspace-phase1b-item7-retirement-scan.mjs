#!/usr/bin/env node
/**
 * Phase 1B item 7: live retirement scan. Does not rewrite the Phase 0
 * freeze baseline, delete production write call-sites, or execute I3.
 */
import fs from "node:fs";
import path from "node:path";
import { buildInventory } from "./memory-workspace-phase0-inventory.mjs";

const DIR = path.dirname(import.meta.filename);
const PHASE0 = path.join(DIR, "memory-workspace-phase0-20260814.call-sites.json");
const SNAPSHOT = path.join(DIR, "memory-workspace-phase1b-item7-retirement-scan.json");

const FORBIDDEN = [
  "rewrite Phase 0 freeze baseline to fake zero",
  "delete production write call-sites before unlock",
  "I3 retirement or delete old branches before watch index is 0",
  "let cursor-fable perform Retirement",
  "phase1bExecutionBlocked=false",
  "LIVE migration",
];

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function summarizeWriteSites(inventory) {
  return (inventory.callSites ?? [])
    .filter((row) => row.profile === "production" && row.op !== "read")
    .map((row) => ({
      pathId: row.pathId,
      symbol: row.symbol,
      file: row.file,
      line: row.line,
      op: row.op,
    }));
}

export function measureItem7Retirement(params = {}) {
  const phase0 = params.phase0 ?? loadJson(PHASE0);
  const live = params.liveInventory ?? (fs.existsSync(SNAPSHOT) ? loadJson(SNAPSHOT) : null);
  const frozenIndex = phase0.productionWriteWatchIndex ?? 0;
  const liveIndex =
    typeof live?.productionWriteWatchIndex === "number"
      ? live.productionWriteWatchIndex
      : typeof live?.liveWriteWatchIndex === "number"
        ? live.liveWriteWatchIndex
        : null;
  const sites = Array.isArray(live?.sites)
    ? live.sites
    : summarizeWriteSites(live ?? { callSites: [] });
  const item7Met = liveIndex === 0;
  const i3Executed = false;
  const phase0Rewritten = false;

  return {
    schema: "memory-workspace-phase1b-item7-retirement-scan/v1",
    item: 7,
    status: item7Met ? "met" : "not-met",
    item7: item7Met ? "met" : "not-met",
    retirementOwner: "cursor-data-governance",
    freezeOwner: "cursor-fable",
    ownersDistinct: true,
    unlock: "not-issued",
    phase1bExecutionBlocked: true,
    deployAuthorized: false,
    live: false,
    enablesProduction: false,
    i3Executed,
    phase0Path: "docs/design/evidence/memory-workspace-phase0-20260814.call-sites.json",
    phase0Rewritten,
    frozenWriteWatchIndex: frozenIndex,
    liveWriteWatchIndex: liveIndex,
    target: 0,
    retiredThisChange: 0,
    remaining: liveIndex === null ? frozenIndex : liveIndex,
    sites,
    note: "Live scan only. Phase 0 freeze baseline is unchanged. Existing write/index call-sites stay in place until unlock. I3 is forbidden until the watch index is 0.",
    explicitlyForbidden: FORBIDDEN,
  };
}

export function buildItem7RetirementScan(root = process.cwd()) {
  const inventory = buildInventory(root);
  const phase0 = loadJson(PHASE0);
  const sites = summarizeWriteSites(inventory);
  const scan = {
    schema: "memory-workspace-phase1b-item7-retirement-scan/v1",
    item: 7,
    generatedFrom: "memory-workspace-phase0-inventory.mjs buildInventory",
    productionWriteWatchIndex: inventory.productionWriteWatchIndex,
    liveWriteWatchIndex: sites.length,
    frozenWriteWatchIndex: phase0.productionWriteWatchIndex ?? 0,
    target: 0,
    retiredThisChange: 0,
    i3Executed: false,
    phase0Rewritten: false,
    sites,
  };
  return measureItem7Retirement({ phase0, liveInventory: scan });
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isMain) {
  const measured = buildItem7RetirementScan();
  fs.writeFileSync(SNAPSHOT, `${JSON.stringify(measured, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(measured, null, 2)}\n`);
}
