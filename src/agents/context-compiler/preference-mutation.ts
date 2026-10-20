import type { MemoryProfileEntry } from "./types.js";
import { upsertUserProfileEntry } from "./user-profile-store.js";

const QUESTION_MARKERS = /[?？]|能不能|可以吗|好吗|要不要|要不要考虑|吗$|呢$|吧$/u;

/**
 * High-confidence imperative preference mutations only.
 * Memory writes may miss; they must not invent.
 */
const PREFERRED_ADDRESS_PATTERNS: Array<{
  re: RegExp;
  nameGroup: number;
}> = [
  { re: /^(以后|今后|从今以后)请?叫我(.{1,12})$/u, nameGroup: 2 },
  { re: /^请以后叫我(.{1,12})$/u, nameGroup: 1 },
  { re: /^以后请叫我(.{1,12})$/u, nameGroup: 1 },
  { re: /^(please )?call me (.+?) from now on$/iu, nameGroup: 2 },
  { re: /^from now on,? (please )?call me (.+)$/iu, nameGroup: 2 },
  { re: /^(please )?always call me (.+)$/iu, nameGroup: 2 },
];

const REPLACE_ADDRESS_RE = /^(以后|今后)(不要|别)叫我.{1,12}(了)?[，,]\s*叫我(.{1,12})$/u;

function normalizeUtterance(text: string): string {
  return text
    .replace(/\s+/gu, " ")
    .replace(/[。.!！]+$/u, "")
    .trim();
}

function sanitizeName(raw: string): string | null {
  const name = raw.replace(/^["'“”‘’]+|["'“”‘’]+$/gu, "").trim();
  if (!name || name.length > 12) {
    return null;
  }
  if (QUESTION_MARKERS.test(name) || /[?？]/.test(name)) {
    return null;
  }
  if (/^(你|我|他|她|它)$/u.test(name)) {
    return null;
  }
  return name;
}

export type PreferenceMutation = {
  key: "preferred_address";
  value: string;
};

export function extractHighConfidencePreferenceMutation(text: string): PreferenceMutation | null {
  const normalized = normalizeUtterance(text);
  if (!normalized || QUESTION_MARKERS.test(normalized)) {
    return null;
  }

  const replaced = normalized.match(REPLACE_ADDRESS_RE);
  if (replaced?.[4]) {
    const name = sanitizeName(replaced[4]);
    return name ? { key: "preferred_address", value: name } : null;
  }

  for (const pattern of PREFERRED_ADDRESS_PATTERNS) {
    const match = normalized.match(pattern.re);
    const raw = match?.[pattern.nameGroup];
    if (!raw) {
      continue;
    }
    const name = sanitizeName(raw);
    if (name) {
      return { key: "preferred_address", value: name };
    }
  }
  return null;
}

export async function applyPreferenceMutation(params: {
  workspaceDir: string;
  text: string;
  sourceMessageId: string;
}): Promise<MemoryProfileEntry | "idempotent" | null> {
  const mutation = extractHighConfidencePreferenceMutation(params.text);
  if (!mutation) {
    return null;
  }
  const sourceMessageId = params.sourceMessageId.trim();
  if (!sourceMessageId) {
    return null;
  }
  return upsertUserProfileEntry({
    workspaceDir: params.workspaceDir,
    entry: {
      key: mutation.key,
      value: mutation.value,
      scope: "user",
      source: "conversation",
      sourceMessageId,
    },
  });
}
