import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Package root (`packages/toolkit`), whether running from `src/` or `dist/`. */
export function packageRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // src/ → .. ; dist/ → ..
  return join(here, "..");
}

export function catalogPath(): string {
  return join(packageRoot(), "catalog", "tool-catalog.json");
}

export function combinationsPath(): string {
  return join(packageRoot(), "combos", "tool-combinations.json");
}

export function toolDefinitionSchemaPath(): string {
  return join(packageRoot(), "schemas", "tool-definition.schema.json");
}

export function executionReceiptSchemaPath(): string {
  return join(packageRoot(), "schemas", "execution-receipt.schema.json");
}

export function policyExamplePath(): string {
  return join(packageRoot(), "config", "policy.example.json");
}
