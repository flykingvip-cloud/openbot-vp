import { hashText } from "../../../../memory/internal.js";
import { normalizeChunkTextForHash } from "../semantic-hash.js";

export type ExtractedClaim = {
  subject: string;
  predicate: string;
  objectValue: string;
  claimText: string;
  normalizedKey: string;
};

const CLAIM_LINE_PATTERNS: RegExp[] = [
  /^(?<subject>[\u4e00-\u9fa5A-Za-z0-9][\u4e00-\u9fa5A-Za-z0-9/_-]{0,24})(?:是|为|等于|达到|约为)\s*(?<value>.+)$/u,
  /^(?<subject>[\u4e00-\u9fa5A-Za-z0-9][\u4e00-\u9fa5A-Za-z0-9/_-]{0,24})\s*[:：=]\s*(?<value>.+)$/u,
  /^(?<subject>[\u4e00-\u9fa5A-Za-z0-9][\u4e00-\u9fa5A-Za-z0-9/_-]{0,24})\s+(?<value>\d+(?:\.\d+)?%?)$/u,
];

function normalizeToken(value: string): string {
  return normalizeChunkTextForHash(value)
    .replace(/[：:=]/g, " ")
    .trim();
}

export function buildClaimNormalizedKey(subject: string, predicate: string): string {
  return hashText(`${normalizeToken(subject)}|${normalizeToken(predicate)}`);
}

function parseClaimLine(line: string): ExtractedClaim | null {
  const trimmed = line.trim().replace(/^[-*•]\s*/, "");
  if (trimmed.length < 4) {
    return null;
  }
  for (const pattern of CLAIM_LINE_PATTERNS) {
    const match = pattern.exec(trimmed);
    if (!match?.groups) {
      continue;
    }
    const subject = match.groups.subject?.trim() ?? "";
    const objectValue = match.groups.value?.trim() ?? "";
    if (!subject || !objectValue) {
      continue;
    }
    const predicate = trimmed.includes("=") ? "equals" : "states";
    const claimText = trimmed;
    return {
      subject,
      predicate,
      objectValue,
      claimText,
      normalizedKey: buildClaimNormalizedKey(subject, predicate),
    };
  }
  return null;
}

export function extractClaimsFromText(text: string): ExtractedClaim[] {
  const claims: ExtractedClaim[] = [];
  const seen = new Set<string>();
  for (const rawLine of text.split(/\n+/)) {
    const claim = parseClaimLine(rawLine);
    if (!claim) {
      continue;
    }
    const dedupeKey = `${claim.normalizedKey}:${claim.objectValue}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    claims.push(claim);
  }
  return claims;
}
