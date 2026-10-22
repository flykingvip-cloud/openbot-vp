/**
 * App-level Chanjet message state for 用友 T+.
 * appTicket is rotated by the platform about every 10 minutes.
 * Enterprise permanent auth codes are keyed by Chanjet orgId.
 * The file is mode 0600 and is not a tenant business store.
 */
import path from "node:path";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR } from "../../utils.js";

const STORE_FILENAME = "yonyou-tplus-chanjet.json";
const MAX_EVENTS = 20;

export type YonyouTplusMessageEvent = {
  id?: string;
  msgType: string;
  receivedAt: string;
  orgId?: string;
  note?: string;
};

type AppTicketRecord = {
  appTicket: string;
  receivedAt: string;
};

type OrgPermanentRecord = {
  permanentAuthCode: string;
  appName?: string;
  appId?: string;
  updatedAt: string;
};

type YonyouTplusMessageFile = {
  appTickets: Record<string, AppTicketRecord>;
  orgPermanentAuth: Record<string, OrgPermanentRecord>;
  events: YonyouTplusMessageEvent[];
};

const fileLock = createAsyncLock();

export function resolveYonyouTplusMessageStorePath(customPath?: string): string {
  return customPath ?? path.join(CONFIG_DIR, "enterprise-data", STORE_FILENAME);
}

function emptyFile(): YonyouTplusMessageFile {
  return { appTickets: {}, orgPermanentAuth: {}, events: [] };
}

async function readFile(storePath: string): Promise<YonyouTplusMessageFile> {
  const file = await readJsonFile<YonyouTplusMessageFile>(storePath);
  if (!file || typeof file !== "object") {
    return emptyFile();
  }
  return {
    appTickets: file.appTickets ?? {},
    orgPermanentAuth: file.orgPermanentAuth ?? {},
    events: Array.isArray(file.events) ? file.events : [],
  };
}

async function updateFile(
  storePath: string | undefined,
  mutate: (file: YonyouTplusMessageFile) => void,
): Promise<void> {
  const resolved = resolveYonyouTplusMessageStorePath(storePath);
  await fileLock(async () => {
    const file = await readFile(resolved);
    mutate(file);
    file.events = file.events.slice(0, MAX_EVENTS);
    await writeJsonAtomic(resolved, file, { mode: 0o600 });
  });
}

export async function saveYonyouTplusAppTicket(params: {
  appKey: string;
  appTicket: string;
  receivedAt: string;
  storePath?: string;
}): Promise<void> {
  await updateFile(params.storePath, (file) => {
    file.appTickets[params.appKey] = {
      appTicket: params.appTicket,
      receivedAt: params.receivedAt,
    };
  });
}

export async function loadYonyouTplusAppTicket(
  appKey: string,
  storePath?: string,
): Promise<string | null> {
  const file = await readFile(resolveYonyouTplusMessageStorePath(storePath));
  const record = file.appTickets[appKey];
  return record?.appTicket?.trim() || null;
}

export async function saveYonyouTplusOrgPermanentAuth(params: {
  orgId: string;
  permanentAuthCode: string;
  appName?: string;
  appId?: string;
  updatedAt: string;
  storePath?: string;
}): Promise<void> {
  await updateFile(params.storePath, (file) => {
    file.orgPermanentAuth[params.orgId] = {
      permanentAuthCode: params.permanentAuthCode,
      appName: params.appName,
      appId: params.appId,
      updatedAt: params.updatedAt,
    };
  });
}

export async function loadYonyouTplusOrgPermanentAuth(
  orgId: string,
  storePath?: string,
): Promise<{ permanentAuthCode: string; appName?: string; appId?: string } | null> {
  const file = await readFile(resolveYonyouTplusMessageStorePath(storePath));
  const record = file.orgPermanentAuth[orgId];
  if (!record?.permanentAuthCode?.trim()) {
    return null;
  }
  return {
    permanentAuthCode: record.permanentAuthCode.trim(),
    appName: record.appName,
    appId: record.appId,
  };
}

export async function recordYonyouTplusMessageEvent(
  event: YonyouTplusMessageEvent,
  storePath?: string,
): Promise<void> {
  await updateFile(storePath, (file) => {
    file.events.unshift(event);
  });
}

export async function listYonyouTplusMessageEvents(
  storePath?: string,
): Promise<YonyouTplusMessageEvent[]> {
  const file = await readFile(resolveYonyouTplusMessageStorePath(storePath));
  return file.events;
}
