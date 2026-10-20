#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveRepoRoot, runAsScript } from "./lib/ts-guard-utils.mjs";

const repoRoot = resolveRepoRoot(import.meta.url);
const scanRoot = path.join(repoRoot, "ui", "src", "ui", "ports", "enterprise", "views");

const hexColorPattern = /#[0-9a-fA-F]{3,8}\b/g;

function isAllowedHexContext(line) {
  // CSS custom property fallbacks and color-mix() are tokenized, not ad-hoc palette usage.
  return line.includes("var(--") || line.includes("color-mix(");
}

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

function findHardcodedColorViolations(content) {
  const lines = content.split("\n");
  const hits = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!hexColorPattern.test(line)) {
      hexColorPattern.lastIndex = 0;
      continue;
    }
    hexColorPattern.lastIndex = 0;
    if (isAllowedHexContext(line)) {
      continue;
    }
    hits.push(index + 1);
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
    const content = await fs.readFile(filePath, "utf8");
    for (const line of findHardcodedColorViolations(content)) {
      violations.push(`${relPath}:${line}`);
    }
  }

  if (violations.length === 0) {
    return;
  }

  console.error("Found hardcoded hex colors in enterprise views:");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  console.error("Use design tokens / CSS variables instead of literal palette values.");
  process.exit(1);
}

runAsScript(import.meta.url, main);
