import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";

const STORE_DIR = "cron-task-templates";
const STORE_VERSION = 1 as const;
const MAX_TEAM_TEMPLATES = 48;

import type { CronDataBindingRef } from "./personal-task-meta.js";
import { normalizeCronDataBindings } from "./personal-task-meta.js";

export type CronTaskTemplateRecord = {
  id: string;
  scope: "team";
  name: string;
  summary: string;
  category: string;
  intentText: string;
  goal: string;
  acceptanceRules: string[];
  schedulePreset: string;
  dailyTime: string;
  weeklyDay?: string;
  monthlyDay?: string;
  suggestedAgents: string[];
  suggestedGroups?: string[];
  priority?: string;
  dataBindings?: CronDataBindingRef[];
  updatedAtMs: number;
};

type CronTaskTemplateStoreFile = {
  version: typeof STORE_VERSION;
  templates: CronTaskTemplateRecord[];
};

function sanitizeKeyPart(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "_";
}

export function resolveTeamCronTemplateFileName(tenantId: string): string {
  return `team__${sanitizeKeyPart(tenantId)}.json`;
}

function resolveTeamCronTemplateFilePath(
  tenantId: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveStateDir(env), STORE_DIR, resolveTeamCronTemplateFileName(tenantId));
}

function emptyStore(): CronTaskTemplateStoreFile {
  return { version: STORE_VERSION, templates: [] };
}

async function readStore(filePath: string): Promise<CronTaskTemplateStoreFile> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<CronTaskTemplateStoreFile>;
    if (!parsed || parsed.version !== STORE_VERSION || !Array.isArray(parsed.templates)) {
      return emptyStore();
    }
    return {
      version: STORE_VERSION,
      templates: parsed.templates.filter((entry) => entry && typeof entry.id === "string"),
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") {
      return emptyStore();
    }
    throw err;
  }
}

async function writeStore(filePath: string, store: CronTaskTemplateStoreFile): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await fs.rename(tmp, filePath);
}

export async function listTeamCronTaskTemplates(
  tenantId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CronTaskTemplateRecord[]> {
  const filePath = resolveTeamCronTemplateFilePath(tenantId, env);
  const store = await readStore(filePath);
  return store.templates.toSorted((left, right) => right.updatedAtMs - left.updatedAtMs);
}

export async function upsertTeamCronTaskTemplate(params: {
  tenantId: string;
  template: Omit<CronTaskTemplateRecord, "scope" | "updatedAtMs"> & { updatedAtMs?: number };
  env?: NodeJS.ProcessEnv;
}): Promise<CronTaskTemplateRecord> {
  const env = params.env ?? process.env;
  const filePath = resolveTeamCronTemplateFilePath(params.tenantId, env);
  const store = await readStore(filePath);
  const now = params.template.updatedAtMs ?? Date.now();
  const nextRecord: CronTaskTemplateRecord = {
    ...params.template,
    scope: "team",
    updatedAtMs: now,
    dataBindings: normalizeCronDataBindings(params.template.dataBindings),
  };
  const without = store.templates.filter((entry) => entry.id !== nextRecord.id);
  store.templates = [nextRecord, ...without].slice(0, MAX_TEAM_TEMPLATES);
  await writeStore(filePath, store);
  return nextRecord;
}

export async function deleteTeamCronTaskTemplate(params: {
  tenantId: string;
  templateId: string;
  env?: NodeJS.ProcessEnv;
}): Promise<boolean> {
  const env = params.env ?? process.env;
  const filePath = resolveTeamCronTemplateFilePath(params.tenantId, env);
  const store = await readStore(filePath);
  const next = store.templates.filter((entry) => entry.id !== params.templateId);
  if (next.length === store.templates.length) {
    return false;
  }
  store.templates = next;
  await writeStore(filePath, store);
  return true;
}
