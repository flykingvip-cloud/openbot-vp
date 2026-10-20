import fs from "node:fs/promises";
import path from "node:path";
import type { IdRemapPlan } from "./id-remap.js";
import { TENANT_IMPORT_MANIFEST_NAME } from "./manifest.js";

/**
 * tenant-import content-level ID reference rewrite (SaaS tenant data architecture §10 "引用修复").
 *
 * `stage.ts` rewrites id-keyed PATHS (user/agent directory names). This module rewrites id
 * REFERENCES inside staged JSON — the seat→agent bindings, grant/policy owner ids, knowledge-base
 * ids, etc. — so they stay consistent with the remapped tenant. Rewrites are exact-value (and
 * exact object-key) matches only, never substrings, so a coincidental string like `"main"` in an
 * unrelated field is not touched unless that id was actually remapped.
 *
 * The remap plan is flattened to a source→target map containing only ids that actually change
 * (e.g. an agent kept as `main` produces no entry), which bounds the blast radius. The manifest is
 * never rewritten — it documents the source package for audit.
 */

export type IdReferenceMap = Record<string, string>;

/**
 * Flatten a remap plan to a source→target id map, including only ids that change. Agent ids are
 * included only when renamed (collision), so unchanged semantic ids like `main` stay untouched.
 */
export function flattenRemapPlanToIdMap(
  plan: IdRemapPlan,
  opts: { includeAgents?: boolean } = {},
): IdReferenceMap {
  const map: IdReferenceMap = {};
  const add = (source: string, target: string): void => {
    if (source && target && source !== target) {
      map[source] = target;
    }
  };
  for (const [source, remap] of Object.entries(plan.users)) {
    add(source, remap.targetUserId);
  }
  for (const [source, target] of Object.entries(plan.seats)) {
    add(source, target);
  }
  for (const [source, target] of Object.entries(plan.groups)) {
    add(source, target);
  }
  for (const [source, target] of Object.entries(plan.knowledgeBases)) {
    add(source, target);
  }
  for (const [source, target] of Object.entries(plan.identities)) {
    add(source, target);
  }
  if (opts.includeAgents !== false) {
    for (const [source, target] of Object.entries(plan.agents)) {
      add(source, target); // add() skips unchanged agents (source === target)
    }
  }
  return map;
}

/** Deep-rewrite exact string values and object keys that match a remapped id. Returns a new value. */
export function rewriteJsonIdReferences(value: unknown, idMap: IdReferenceMap): unknown {
  if (typeof value === "string") {
    return Object.prototype.hasOwnProperty.call(idMap, value) ? idMap[value] : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => rewriteJsonIdReferences(item, idMap));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const nextKey = Object.prototype.hasOwnProperty.call(idMap, key) ? idMap[key] : key;
      out[nextKey] = rewriteJsonIdReferences(child, idMap);
    }
    return out;
  }
  return value;
}

async function walkFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => null);
  if (!entries) {
    return out;
  }
  for (const entry of entries) {
    const abs = path.join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkFiles(abs)));
    } else if (entry.isFile()) {
      out.push(abs);
    }
  }
  return out;
}

export type ContentRewriteResult = {
  filesScanned: number;
  filesRewritten: number;
};

/**
 * Apply id-reference rewrites to every JSON file in a staged tree (excludes the manifest and
 * non-JSON / malformed files). Only writes a file back when its content actually changed.
 */
export async function applyContentIdRewriteToStaging(params: {
  stagedRoot: string;
  idMap: IdReferenceMap;
}): Promise<ContentRewriteResult> {
  const root = path.resolve(params.stagedRoot);
  let filesScanned = 0;
  let filesRewritten = 0;

  if (Object.keys(params.idMap).length === 0) {
    return { filesScanned, filesRewritten };
  }

  for (const file of await walkFiles(root)) {
    if (
      !file.toLowerCase().endsWith(".json") ||
      path.basename(file) === TENANT_IMPORT_MANIFEST_NAME
    ) {
      continue;
    }
    const text = await fs.readFile(file, "utf-8").catch(() => null);
    if (text === null) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      continue; // skip malformed JSON
    }
    filesScanned += 1;
    const rewritten = rewriteJsonIdReferences(parsed, params.idMap);
    // Compare normalized serializations so formatting differences never trigger a spurious write.
    if (JSON.stringify(rewritten) !== JSON.stringify(parsed)) {
      await fs.writeFile(file, `${JSON.stringify(rewritten, null, 2)}\n`);
      filesRewritten += 1;
    }
  }
  return { filesScanned, filesRewritten };
}
