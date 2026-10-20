#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveRepoRoot, runAsScript } from "./lib/ts-guard-utils.mjs";

const repoRoot = resolveRepoRoot(import.meta.url);
const scanRoot = path.join(repoRoot, "ui", "src", "ui", "ports", "enterprise", "views");

/** Canvas/graph surfaces may embed SVG directly. */
const allowedRelativePaths = new Set(["ui/src/ui/ports/enterprise/views/mesh-graph-canvas.ts"]);

async function collectFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && fullPath.endsWith(".ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

function findRawSvgViolations(content) {
  const lines = content.split("\n");
  const hits = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.includes("<svg") || line.includes("<SVG")) {
      hits.push(index + 1);
    }
  }
  return hits;
}

export async function main() {
  let stat;
  try {
    stat = await fs.stat(scanRoot);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  if (!stat.isDirectory()) {
    return;
  }

  const violations = [];
  for (const filePath of await collectFiles(scanRoot)) {
    const relPath = path.relative(repoRoot, filePath).split(path.sep).join("/");
    if (allowedRelativePaths.has(relPath)) {
      continue;
    }
    const content = await fs.readFile(filePath, "utf8");
    for (const line of findRawSvgViolations(content)) {
      violations.push(`${relPath}:${line}`);
    }
  }

  if (violations.length === 0) {
    return;
  }

  console.error("Found raw <svg> usage in enterprise views (use renderIcon instead):");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

runAsScript(import.meta.url, main);
