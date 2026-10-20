/**
 * 销售线索 store（卓越版「联系销售」需求提交）。平台全局（非租户隔离），append-only。
 *
 * 落盘：`CONFIG_DIR/openbot-sales-leads.json`。
 */

import { randomUUID } from "node:crypto";
import path from "node:path";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";

const SALES_LEADS_STORE_VERSION = 1;

/** 销售线索记录。金额无关，纯线索表单。 */
export type SalesLead = {
  id: string;
  /** 触发线索的套餐 id（卓越版），可缺省。 */
  planId?: string;
  company: string;
  contact: string;
  phone: string;
  /** 预计席位规模（自由文本/数字串）。 */
  scale?: string;
  requirements?: string;
  /** 提交时的登录用户（若有）。 */
  submittedByUserId?: string;
  createdAt: string;
};

type SalesLeadsStore = {
  version: number;
  leads: SalesLead[]; // append-only
};

function createEmptyStore(): SalesLeadsStore {
  return { version: SALES_LEADS_STORE_VERSION, leads: [] };
}

export function resolveDefaultSalesLeadsStorePath(): string {
  return path.join(CONFIG_DIR, "openbot-sales-leads.json");
}

const withLock = createAsyncLock();

async function loadStore(storePath?: string): Promise<SalesLeadsStore> {
  const resolvedPath = resolveUserPath(storePath?.trim() || resolveDefaultSalesLeadsStorePath());
  const parsed = await readJsonFile<Partial<SalesLeadsStore>>(resolvedPath);
  if (!parsed) {
    return createEmptyStore();
  }
  return {
    version: SALES_LEADS_STORE_VERSION,
    leads: Array.isArray(parsed.leads) ? parsed.leads : [],
  };
}

async function saveStore(store: SalesLeadsStore, storePath?: string): Promise<void> {
  const resolvedPath = resolveUserPath(storePath?.trim() || resolveDefaultSalesLeadsStorePath());
  await writeJsonAtomic(resolvedPath, store);
}

export type CreateSalesLeadInput = {
  planId?: string;
  company: string;
  contact: string;
  phone: string;
  scale?: string;
  requirements?: string;
  submittedByUserId?: string;
};

/** 追加一条销售线索。返回完整记录。 */
export async function createSalesLead(
  input: CreateSalesLeadInput,
  storePath?: string,
): Promise<SalesLead> {
  return withLock(async () => {
    const store = await loadStore(storePath);
    const lead: SalesLead = {
      id: `lead-${randomUUID()}`,
      ...(input.planId ? { planId: input.planId } : {}),
      company: input.company,
      contact: input.contact,
      phone: input.phone,
      ...(input.scale ? { scale: input.scale } : {}),
      ...(input.requirements ? { requirements: input.requirements } : {}),
      ...(input.submittedByUserId ? { submittedByUserId: input.submittedByUserId } : {}),
      createdAt: new Date().toISOString(),
    };
    store.leads.push(lead);
    await saveStore(store, storePath);
    return lead;
  });
}

/** 列出全部销售线索（最新在前）。 */
export async function listSalesLeads(storePath?: string): Promise<SalesLead[]> {
  const store = await loadStore(storePath);
  return store.leads.toReversed();
}

/** 按 id 读取单条线索。 */
export async function getSalesLead(leadId: string, storePath?: string): Promise<SalesLead | null> {
  const store = await loadStore(storePath);
  return store.leads.find((lead) => lead.id === leadId) ?? null;
}
