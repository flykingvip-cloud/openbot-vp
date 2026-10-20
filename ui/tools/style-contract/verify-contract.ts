#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const enterpriseViewsRoot = path.join(repoRoot, "ui", "src", "ui", "ports", "enterprise", "views");

async function collectSurfaceFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSurfaceFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && fullPath.endsWith("-surface.ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

function hasLitImport(content: string) {
  return content.includes('from "lit"') || content.includes("from 'lit'");
}

function hasSharedEnterpriseImports(content: string) {
  return (
    content.includes("renderIcon") ||
    content.includes("enterprise-surface-shared") ||
    content.includes("enterprise-module-header")
  );
}

function delegatesToAnotherSurface(content: string) {
  return /from "\.\/enterprise-.*-surface\.ts"/.test(content);
}

/** Form-only panels without iconography yet. */
const sharedImportExempt = new Set([
  "ui/src/ui/ports/enterprise/views/enterprise-retention-policy-surface.ts",
  "ui/src/ui/ports/enterprise/views/enterprise-memory-governance-surface.ts",
]);

async function main() {
  let stat;
  try {
    stat = await fs.stat(enterpriseViewsRoot);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  if (!stat.isDirectory()) {
    return;
  }

  const violations: string[] = [];
  for (const filePath of await collectSurfaceFiles(enterpriseViewsRoot)) {
    const relPath = path.relative(repoRoot, filePath).split(path.sep).join("/");
    const content = await fs.readFile(filePath, "utf8");
    if (delegatesToAnotherSurface(content)) {
      continue;
    }
    if (!hasLitImport(content)) {
      violations.push(`${relPath}: missing lit import`);
    }
    if (!sharedImportExempt.has(relPath) && !hasSharedEnterpriseImports(content)) {
      violations.push(
        `${relPath}: must use shared enterprise UI primitives (renderIcon / enterprise-surface-shared / enterprise-module-header)`,
      );
    }
  }

  if (violations.length === 0) {
    return;
  }

  console.error("Enterprise UI style contract violations:");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

void main();
