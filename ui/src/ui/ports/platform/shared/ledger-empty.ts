/**
 * Three empty states shared by the platform delivery consoles.
 * Demo fixtures stay the default. These modes never write a ledger.
 */

export type LedgerViewMode = "demo" | "unloaded" | "disconnected";

export type LedgerEmptyKind = "demo-unloaded" | "filter-empty" | "backend-disconnected";

export type LedgerEmptyCopy = {
  kind: LedgerEmptyKind;
  title: string;
  detail: string;
};

const COPY: Record<LedgerEmptyKind, LedgerEmptyCopy> = {
  "demo-unloaded": {
    kind: "demo-unloaded",
    title: "演示未加载",
    detail: "演示夹具还没有装入这一页。不会因此创建制品、许可或安装记录。",
  },
  "filter-empty": {
    kind: "filter-empty",
    title: "筛选无结果",
    detail: "当前筛选没有匹配条目。放宽条件后仍只读演示数据，不写入台账。",
  },
  "backend-disconnected": {
    kind: "backend-disconnected",
    title: "后端未联通",
    detail: "交付台账未接通。页面保留演示数据徽章，不把空表当成已对账或已安装。",
  },
};

export function ledgerEmptyCopy(
  mode: LedgerViewMode,
  matchCount: number,
  filtering: boolean,
): LedgerEmptyCopy | null {
  if (mode === "disconnected") {
    return COPY["backend-disconnected"];
  }
  if (mode === "unloaded") {
    return COPY["demo-unloaded"];
  }
  if (filtering && matchCount === 0) {
    return COPY["filter-empty"];
  }
  return null;
}
