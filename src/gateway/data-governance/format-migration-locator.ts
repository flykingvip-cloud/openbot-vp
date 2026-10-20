import path from "node:path";
import { CATALOG_FIELD_LIMITS } from "./limits.js";

/** Safe content-version token: no path separators, no `..`, bounded charset. */
const SAFE_CONTENT_VERSION_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function hasControlOrWhitespace(value: string): boolean {
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f || ch === " " || ch === "\t") {
      return true;
    }
  }
  return false;
}

export function parseSafeContentVersionToken(
  value: string,
): { ok: true; value: string } | { ok: false } {
  const trimmed = value.trim();
  if (
    !trimmed ||
    trimmed.length > CATALOG_FIELD_LIMITS.contentVersionMax ||
    !SAFE_CONTENT_VERSION_TOKEN.test(trimmed) ||
    trimmed.includes("..") ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed.includes("\0") ||
    hasControlOrWhitespace(trimmed)
  ) {
    return { ok: false };
  }
  return { ok: true, value: trimmed };
}

const VERSION_SEGMENT = `${path.sep}versions${path.sep}`;

export function formatMigrationResourceRoot(locator: string): string {
  const idx = locator.lastIndexOf(VERSION_SEGMENT);
  if (idx >= 0) {
    return locator.slice(0, idx);
  }
  return `${locator}.root`;
}

export function resolveFormatMigrationVersionsRoot(currentLocator: string): string {
  return path.resolve(formatMigrationResourceRoot(currentLocator), "versions");
}

function isResolvedPathWithinRoot(root: string, candidate: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const rel = path.relative(resolvedRoot, resolvedCandidate);
  return Boolean(rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

export function resolveImmutableContentLocator(params: {
  currentLocator: string;
  contentVersion: string;
  checksum: string;
}): { ok: true; locator: string } | { ok: false } {
  const token = parseSafeContentVersionToken(params.contentVersion);
  if (!token.ok || !/^[a-f0-9]{64}$/.test(params.checksum)) {
    return { ok: false };
  }
  const versionsRoot = resolveFormatMigrationVersionsRoot(params.currentLocator);
  const dest = path.resolve(versionsRoot, `${token.value}-${params.checksum}`);
  if (!isResolvedPathWithinRoot(versionsRoot, dest)) {
    return { ok: false };
  }
  return { ok: true, locator: dest };
}

export function assertLocatorWithinFormatMigrationVersions(params: {
  anchorLocator: string;
  candidateLocator: string;
}): boolean {
  const versionsRoot = resolveFormatMigrationVersionsRoot(params.anchorLocator);
  return isResolvedPathWithinRoot(versionsRoot, params.candidateLocator);
}

export function validateFormatMigrationJournalLocators(journal: {
  previousLocator: string;
  nextLocator: string;
  contentVersion: string;
  fromContentVersion: string;
  resultChecksum: string;
}): boolean {
  if (!parseSafeContentVersionToken(journal.contentVersion).ok) {
    return false;
  }
  if (!parseSafeContentVersionToken(journal.fromContentVersion).ok) {
    return false;
  }
  if (!/^[a-f0-9]{64}$/.test(journal.resultChecksum)) {
    return false;
  }
  if (
    !assertLocatorWithinFormatMigrationVersions({
      anchorLocator: journal.previousLocator,
      candidateLocator: journal.nextLocator,
    })
  ) {
    return false;
  }
  const expected = resolveImmutableContentLocator({
    currentLocator: journal.previousLocator,
    contentVersion: journal.contentVersion,
    checksum: journal.resultChecksum,
  });
  return expected.ok && path.resolve(expected.locator) === path.resolve(journal.nextLocator);
}

export function parseGovernanceOperatedAt(
  value: string,
): { ok: true; value: string } | { ok: false } {
  const trimmed = value.trim();
  if (!trimmed || Number.isNaN(Date.parse(trimmed))) {
    return { ok: false };
  }
  return { ok: true, value: trimmed };
}
