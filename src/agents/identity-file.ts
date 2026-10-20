import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_BOOTSTRAP_FILENAME,
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_USER_FILENAME,
} from "./workspace.js";

export type AgentIdentityFile = {
  name?: string;
  emoji?: string;
  theme?: string;
  creature?: string;
  vibe?: string;
  avatar?: string;
};

export type WorkspaceIdentityBootstrapState = {
  identityInitialized: boolean;
  userInitialized: boolean;
  bootstrapPending: boolean;
};

const IDENTITY_PLACEHOLDER_VALUES = new Set([
  "pick something you like",
  "ai? robot? familiar? ghost in the machine? something weirder?",
  "how do you come across? sharp? warm? chaotic? calm?",
  "your signature - pick one that feels right",
  "workspace-relative path, http(s) url, or data uri",
]);

const USER_PLACEHOLDER_VALUES = new Set(["optional"]);

function normalizeIdentityValue(value: string): string {
  let normalized = value.trim();
  normalized = normalized.replace(/^[*_]+|[*_]+$/g, "").trim();
  if (normalized.startsWith("(") && normalized.endsWith(")")) {
    normalized = normalized.slice(1, -1).trim();
  }
  normalized = normalized.replace(/[\u2013\u2014]/g, "-");
  normalized = normalized.replace(/\s+/g, " ").toLowerCase();
  return normalized;
}

function isIdentityPlaceholder(value: string): boolean {
  const normalized = normalizeIdentityValue(value);
  return IDENTITY_PLACEHOLDER_VALUES.has(normalized);
}

function isUserPlaceholder(value: string): boolean {
  const normalized = normalizeIdentityValue(value);
  return USER_PLACEHOLDER_VALUES.has(normalized);
}

const IDENTITY_FIELD_LABELS = ["name", "emoji", "creature", "vibe", "theme", "avatar"] as const;

type IdentityFieldLabel = (typeof IDENTITY_FIELD_LABELS)[number];

function identityFieldLabel(line: string): IdentityFieldLabel | null {
  const cleaned = line.trim().replace(/^\s*-\s*/, "");
  const colonIndex = cleaned.indexOf(":");
  if (colonIndex === -1) {
    return null;
  }
  const label = cleaned.slice(0, colonIndex).replace(/[*_]/g, "").trim().toLowerCase();
  return (IDENTITY_FIELD_LABELS as readonly string[]).includes(label)
    ? (label as IdentityFieldLabel)
    : null;
}

export function parseIdentityMarkdown(content: string): AgentIdentityFile {
  const identity: AgentIdentityFile = {};
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const label = identityFieldLabel(line);
    if (!label) {
      continue;
    }
    const cleaned = line.trim().replace(/^\s*-\s*/, "");
    const colonIndex = cleaned.indexOf(":");
    const value = cleaned
      .slice(colonIndex + 1)
      .replace(/^[*_]+|[*_]+$/g, "")
      .trim();
    if (!value) {
      continue;
    }
    if (isIdentityPlaceholder(value)) {
      continue;
    }
    identity[label] = value;
  }
  return identity;
}

/** Upsert Name/Emoji/Theme/… lines in IDENTITY.md without wiping unrelated content. */
export function upsertIdentityMarkdownFields(
  content: string,
  fields: Partial<AgentIdentityFile>,
): string {
  const updates = new Map<IdentityFieldLabel, string>();
  for (const label of IDENTITY_FIELD_LABELS) {
    const raw = fields[label];
    if (typeof raw !== "string") {
      continue;
    }
    const value = raw.replace(/\s+/g, " ").trim();
    if (!value) {
      continue;
    }
    updates.set(label, value);
  }
  if (updates.size === 0) {
    return content;
  }

  const lines = content.length > 0 ? content.split(/\r?\n/) : [];
  const seen = new Set<IdentityFieldLabel>();
  const nextLines = lines.map((line) => {
    const label = identityFieldLabel(line);
    if (!label || !updates.has(label) || seen.has(label)) {
      return line;
    }
    seen.add(label);
    const indent = line.match(/^\s*/)?.[0] ?? "";
    const bullet = /^\s*-/.test(line) ? "- " : "";
    const displayLabel = label.charAt(0).toUpperCase() + label.slice(1);
    return `${indent}${bullet}${displayLabel}: ${updates.get(label)}`;
  });

  const missing = [...updates.entries()].filter(([label]) => !seen.has(label));
  if (missing.length > 0) {
    if (nextLines.length > 0 && nextLines[nextLines.length - 1]?.trim() !== "") {
      nextLines.push("");
    }
    for (const [label, value] of missing) {
      const displayLabel = label.charAt(0).toUpperCase() + label.slice(1);
      nextLines.push(`- ${displayLabel}: ${value}`);
    }
    nextLines.push("");
  }
  return nextLines.join("\n");
}

export function identityHasValues(identity: AgentIdentityFile): boolean {
  return Boolean(
    identity.name ||
    identity.emoji ||
    identity.theme ||
    identity.creature ||
    identity.vibe ||
    identity.avatar,
  );
}

export function loadIdentityFromFile(identityPath: string): AgentIdentityFile | null {
  try {
    const content = fs.readFileSync(identityPath, "utf-8");
    const parsed = parseIdentityMarkdown(content);
    if (!identityHasValues(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function loadAgentIdentityFromWorkspace(workspace: string): AgentIdentityFile | null {
  const identityPath = path.join(workspace, DEFAULT_IDENTITY_FILENAME);
  return loadIdentityFromFile(identityPath);
}

function fileHasInitializedContent(filePath: string): boolean {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const normalized = content.trim();
    if (!normalized) {
      return false;
    }
    if (filePath.endsWith(DEFAULT_IDENTITY_FILENAME)) {
      return identityHasValues(parseIdentityMarkdown(content));
    }
    if (filePath.endsWith(DEFAULT_USER_FILENAME)) {
      for (const line of content.split(/\r?\n/)) {
        const cleaned = line.trim().replace(/^\s*-\s*/, "");
        const colonIndex = cleaned.indexOf(":");
        if (colonIndex === -1) {
          continue;
        }
        const value = cleaned
          .slice(colonIndex + 1)
          .replace(/^[*_]+|[*_]+$/g, "")
          .trim();
        if (!value || isUserPlaceholder(value)) {
          continue;
        }
        return true;
      }
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function resolveWorkspaceIdentityBootstrapState(
  workspace: string,
): WorkspaceIdentityBootstrapState {
  const identityPath = path.join(workspace, DEFAULT_IDENTITY_FILENAME);
  const userPath = path.join(workspace, DEFAULT_USER_FILENAME);
  const bootstrapPath = path.join(workspace, DEFAULT_BOOTSTRAP_FILENAME);
  return {
    identityInitialized: fileHasInitializedContent(identityPath),
    userInitialized: fileHasInitializedContent(userPath),
    bootstrapPending: fs.existsSync(bootstrapPath),
  };
}

const USER_GAP_FIELD_LABELS = ["name", "what to call them", "timezone"] as const;

function userGapFieldLabel(line: string): (typeof USER_GAP_FIELD_LABELS)[number] | null {
  const cleaned = line.trim().replace(/^\s*-\s*/, "");
  const colonIndex = cleaned.indexOf(":");
  if (colonIndex === -1) {
    return null;
  }
  const label = cleaned.slice(0, colonIndex).replace(/[*_]/g, "").trim().toLowerCase();
  return (USER_GAP_FIELD_LABELS as readonly string[]).includes(label)
    ? (label as (typeof USER_GAP_FIELD_LABELS)[number])
    : null;
}

/** Field labels only. Never returns file text or field values. */
export function listMissingIdentityFieldLabels(content: string): string[] {
  const parsed = parseIdentityMarkdown(content);
  return IDENTITY_FIELD_LABELS.filter((label) => !parsed[label]);
}

/** Field labels only. Never returns file text or field values. */
export function listMissingUserFieldLabels(content: string): string[] {
  const present = new Set<string>();
  for (const line of content.split(/\r?\n/)) {
    const label = userGapFieldLabel(line);
    if (!label) {
      continue;
    }
    const cleaned = line.trim().replace(/^\s*-\s*/, "");
    const colonIndex = cleaned.indexOf(":");
    const value = cleaned
      .slice(colonIndex + 1)
      .replace(/^[*_]+|[*_]+$/g, "")
      .trim();
    if (!value || isUserPlaceholder(value)) {
      continue;
    }
    present.add(label);
  }
  return USER_GAP_FIELD_LABELS.filter((label) => !present.has(label));
}

export function readWorkspaceIdentityGapLabels(workspace: string): {
  identity: string[];
  user: string[];
} {
  return {
    identity: readGapLabels(
      path.join(workspace, DEFAULT_IDENTITY_FILENAME),
      listMissingIdentityFieldLabels,
    ),
    user: readGapLabels(path.join(workspace, DEFAULT_USER_FILENAME), listMissingUserFieldLabels),
  };
}

function readGapLabels(filePath: string, listGaps: (content: string) => string[]): string[] {
  try {
    return listGaps(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return listGaps("");
  }
}
