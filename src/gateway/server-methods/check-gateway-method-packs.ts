#!/usr/bin/env node
/**
 * Guard: gateway method packs stay consistent and pack-owned methods remain registered.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isGatewayMethodClassified } from "../method-scopes.js";
import { listGatewayMethods } from "../server-methods-list.js";
import { validateGatewayMethodPacks } from "./pack-merge.js";
import { GATEWAY_METHOD_PACK_MANIFEST, PACK_OWNED_METHOD_NAMES } from "./packs/manifest.js";
import { GATEWAY_METHOD_PACKS } from "./packs/registry.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function assertManifestMatchesPacks(): string[] {
  const errors: string[] = [];
  if (GATEWAY_METHOD_PACKS.length !== GATEWAY_METHOD_PACK_MANIFEST.length) {
    errors.push("manifest length mismatch vs GATEWAY_METHOD_PACKS");
  }
  for (let i = 0; i < GATEWAY_METHOD_PACK_MANIFEST.length; i += 1) {
    const manifest = GATEWAY_METHOD_PACK_MANIFEST[i];
    const pack = GATEWAY_METHOD_PACKS[i];
    if (!pack || manifest.id !== pack.id) {
      errors.push(`manifest/pack order mismatch at index ${i}`);
      continue;
    }
    if (JSON.stringify(manifest.methods) !== JSON.stringify(pack.methods)) {
      errors.push(`manifest methods mismatch for ${manifest.id}`);
    }
    if (JSON.stringify(manifest.scopes) !== JSON.stringify(pack.scopes)) {
      errors.push(`manifest scopes mismatch for ${manifest.id}`);
    }
  }
  return errors;
}

function assertNoLegacyDuplicates(): string[] {
  const errors: string[] = [];
  const listPath = path.join(REPO_ROOT, "src/gateway/server-methods-list.ts");
  const scopesPath = path.join(REPO_ROOT, "src/gateway/method-scopes.ts");
  const listSource = readFileSync(listPath, "utf8");
  const scopesSource = readFileSync(scopesPath, "utf8");

  const listBase = listSource.slice(
    listSource.indexOf("const BASE_METHODS"),
    listSource.indexOf("export function listGatewayMethods"),
  );
  const scopesBase = scopesSource.slice(
    scopesSource.indexOf("const BASE_METHOD_SCOPE_GROUPS"),
    scopesSource.indexOf("export function getMethodScopeGroups"),
  );

  for (const method of PACK_OWNED_METHOD_NAMES) {
    const needle = `"${method}"`;
    if (listBase.indexOf(needle) >= 0) {
      errors.push(`legacy duplicate in BASE_METHODS: ${method} (remove; pack owns it)`);
    }
    if (scopesBase.indexOf(needle) >= 0) {
      errors.push(`legacy duplicate in BASE_METHOD_SCOPE_GROUPS: ${method} (remove; pack owns it)`);
    }
  }
  return errors;
}

function main(): void {
  const errors = [
    ...validateGatewayMethodPacks(GATEWAY_METHOD_PACKS),
    ...assertManifestMatchesPacks(),
    ...assertNoLegacyDuplicates(),
  ];

  const listed = new Set(listGatewayMethods());
  for (const method of PACK_OWNED_METHOD_NAMES) {
    if (!listed.has(method)) {
      errors.push(`pack method not in listGatewayMethods(): ${method}`);
    }
    if (!isGatewayMethodClassified(method)) {
      errors.push(`pack method not classified in method-scopes: ${method}`);
    }
  }

  if (errors.length > 0) {
    console.error("check-gateway-method-packs failed:\n");
    for (const err of errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }

  console.log(
    `check-gateway-method-packs ok (${GATEWAY_METHOD_PACKS.length} packs, ${PACK_OWNED_METHOD_NAMES.size} methods)`,
  );
}

main();
