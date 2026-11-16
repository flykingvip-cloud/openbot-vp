/**
 * Official-path knowledge reuse for Batch 1 isolation demos and tests.
 *
 * Persists an original deliverable with verifiable fictional price facts,
 * then retrieves it from the reserved-folder saved path, reads the original
 * text, extracts the facts, performs a real comparison, and cites accurately.
 * URI concatenation alone is not a pass.
 */
import fs from "node:fs";
import path from "node:path";
import { PERSONAL_DELIVERABLES_KB_TITLE } from "../gateway/knowledge/deliverable-folders.js";
import {
  findDeliverableArchiveByLogicalId,
  getDeliverableArchiveRecord,
  setDeliverableArchiveRecord,
} from "../gateway/knowledge/deliverables/archive-store.js";
import { computeRawContentHash } from "../gateway/knowledge/document-fingerprint.js";
import { buildDeliverableCiteUri, parseCiteUri } from "../gateway/knowledge/ke/cite.js";
import { createKnowledgeBase } from "../gateway/knowledge/knowledge-base-store.js";
import {
  readKnowledgeFolderFile,
  resolveKnowledgeDirectoryLayoutForBase,
  writeKnowledgeFolderFile,
} from "../gateway/knowledge/knowledge-directory.js";
import {
  readReservedDeliverableOriginal,
  reservedDeliverableDocumentId,
} from "../gateway/knowledge/reserved-deliverable-original.js";

export const PRICE_WATCH_FILENAME = "price-watch.md";
export const PRICE_WATCH_LOGICAL_ID = "logical-price-watch";
export const PRICE_WATCH_DELIVERABLE_ID = "dlv-demo-price-watch";
export const PRICE_WATCH_TITLE = "竞品价格预警";

/** Isolated-demo fictional products. Not real market prices. */
export const PRICE_WATCH_ORIGINAL_MARKDOWN = `# 竞品价格预警

采集说明：以下为隔离演示用虚构商品与虚构价格，不得当作真实市价或生产数据。

| 商品 | SKU | 采集日 | 价格（CNY） |
| --- | --- | --- | --- |
| 北风台灯 | LightNorth-LX1 | 2026-11-01 | 128.00 |
| 北风台灯 | LightNorth-LX1 | 2026-11-15 | 147.20 |
| 晴川水杯 | Rainbrook-CUP2 | 2026-11-01 | 45.00 |
| 晴川水杯 | Rainbrook-CUP2 | 2026-11-15 | 40.50 |
`;

export type PriceObservation = {
  product: string;
  sku: string;
  collectedOn: string;
  priceCny: number;
};

export type ProductMove = {
  product: string;
  sku: string;
  firstDate: string;
  lastDate: string;
  firstPriceCny: number;
  lastPriceCny: number;
  changeCny: number;
  percentChange: number;
  absPercentChange: number;
};

export type KnowledgeReuseResult = {
  originalPath: string;
  originalBytes: number;
  originalHash: string;
  cite: string;
  parsedKind: string | null;
  readRecord: {
    api: string;
    path: string;
    bytes: number;
    hash: string;
    excerpt: string;
    hashMatchesArchive: boolean;
  };
  extracted: PriceObservation[];
  comparison: {
    moves: ProductMove[];
    largerMoveSku: string;
    largerMoveProduct: string;
    largerMoveAbsPercent: number;
  };
  followupBody: string;
  followupPath: string;
  crossTenant: {
    foreignArchiveRecord: unknown;
    foreignLogicalLookup: unknown;
    foreignReservedRead: unknown;
    foreignFolderRead: unknown;
    deny: "empty";
  };
  result: "pass";
};

function isHeaderOrDivider(cells: string[]): boolean {
  if (cells[0] === "商品") {
    return true;
  }
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

export function parsePriceWatchFacts(text: string): PriceObservation[] {
  const rows: PriceObservation[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes("|")) {
      continue;
    }
    const cells = line
      .split("|")
      .map((cell) => cell.trim())
      .filter((_, index, all) => index > 0 && index < all.length - 1);
    if (cells.length < 4 || isHeaderOrDivider(cells)) {
      continue;
    }
    const priceCny = Number(cells[3]);
    if (!Number.isFinite(priceCny) || !/^\d{4}-\d{2}-\d{2}$/.test(cells[2] ?? "")) {
      continue;
    }
    rows.push({
      product: cells[0] ?? "",
      sku: cells[1] ?? "",
      collectedOn: cells[2] ?? "",
      priceCny,
    });
  }
  return rows;
}

export function comparePriceMoves(observations: readonly PriceObservation[]): {
  moves: ProductMove[];
  largerMoveSku: string;
  largerMoveProduct: string;
  largerMoveAbsPercent: number;
} {
  const grouped = new Map<string, PriceObservation[]>();
  for (const row of observations) {
    const list = grouped.get(row.sku) ?? [];
    list.push(row);
    grouped.set(row.sku, list);
  }
  const moves: ProductMove[] = [];
  for (const list of grouped.values()) {
    const sorted = [...list].toSorted((a, b) => a.collectedOn.localeCompare(b.collectedOn));
    if (sorted.length < 2) {
      continue;
    }
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const changeCny = Number((last.priceCny - first.priceCny).toFixed(2));
    const percentChange =
      first.priceCny === 0 ? 0 : Number(((changeCny / first.priceCny) * 100).toFixed(2));
    moves.push({
      product: first.product,
      sku: first.sku,
      firstDate: first.collectedOn,
      lastDate: last.collectedOn,
      firstPriceCny: first.priceCny,
      lastPriceCny: last.priceCny,
      changeCny,
      percentChange,
      absPercentChange: Math.abs(percentChange),
    });
  }
  const larger = [...moves].toSorted((a, b) => b.absPercentChange - a.absPercentChange)[0];
  if (!larger) {
    throw new Error("price-watch original did not contain two dated prices per product");
  }
  return {
    moves,
    largerMoveSku: larger.sku,
    largerMoveProduct: larger.product,
    largerMoveAbsPercent: larger.absPercentChange,
  };
}

export function formatPriceWatchFollowup(input: {
  cite: string;
  savedPath: string;
  hash: string;
  extracted: readonly PriceObservation[];
  comparison: ReturnType<typeof comparePriceMoves>;
}): string {
  const moveLines = input.comparison.moves.map((move) => {
    const sign = move.percentChange > 0 ? "+" : "";
    return `- ${move.product}（${move.sku}）：${move.firstDate} 为 ${move.firstPriceCny.toFixed(2)} CNY，${move.lastDate} 为 ${move.lastPriceCny.toFixed(2)} CNY，变动 ${sign}${move.changeCny.toFixed(2)} CNY（${sign}${move.percentChange.toFixed(2)}%）`;
  });
  return [
    "# 价格跟踪续报",
    "",
    "引用上一任务交付物（官方 cite，而非仅拼接字符串展示）：",
    input.cite,
    `保存路径：${input.savedPath}`,
    `原文 SHA-256：${input.hash}`,
    "",
    "从原文读取并提取的事实：",
    ...input.extracted.map(
      (row) =>
        `- ${row.product} / ${row.sku} / ${row.collectedOn} / ${row.priceCny.toFixed(2)} CNY`,
    ),
    "",
    "计算（后次价格相对首次价格的百分比变动，比较绝对幅度）：",
    ...moveLines,
    "",
    `结论：变动幅度更大的是 ${input.comparison.largerMoveProduct}（${input.comparison.largerMoveSku}），绝对幅度 ${input.comparison.largerMoveAbsPercent.toFixed(2)}%。`,
    "",
  ].join("\n");
}

export function runOfficialKnowledgeReuse(params: {
  workRoot: string;
  workspaceId?: string;
  deliverableId?: string;
}): KnowledgeReuseResult {
  const workRoot = params.workRoot;
  const kbStorePath = path.join(workRoot, "tenant-a", "knowledge-bases.json");
  const archivePath = path.join(workRoot, "tenant-a", "deliverable-archive.json");
  const tenantsRoot = path.join(workRoot, "tenant-a", "tenants");
  const configDir = path.join(workRoot, "tenant-a", "config");
  fs.mkdirSync(configDir, { recursive: true });

  const kb = createKnowledgeBase(
    {
      title: PERSONAL_DELIVERABLES_KB_TITLE,
      visibility: "private",
      ownerId: "user-a",
      tenantId: "tenant-a",
    },
    kbStorePath,
  );
  const layout = resolveKnowledgeDirectoryLayoutForBase(kb, { tenantsRoot, configDir });
  const buffer = Buffer.from(PRICE_WATCH_ORIGINAL_MARKDOWN, "utf8");
  const originalPath = writeKnowledgeFolderFile({
    layout,
    filename: PRICE_WATCH_FILENAME,
    buffer,
  });
  const originalHash = computeRawContentHash(buffer);
  const deliverableId = params.deliverableId ?? PRICE_WATCH_DELIVERABLE_ID;
  setDeliverableArchiveRecord({
    deliverableId,
    knowledgeBaseId: kb.id,
    documentId: "doc-price-watch",
    logicalId: PRICE_WATCH_LOGICAL_ID,
    filename: PRICE_WATCH_FILENAME,
    title: PRICE_WATCH_TITLE,
    rawHash: originalHash,
    archivedByUserId: "user-a",
    storePath: archivePath,
  });
  const archiveLookup = findDeliverableArchiveByLogicalId({
    knowledgeBaseId: kb.id,
    logicalId: PRICE_WATCH_LOGICAL_ID,
    storePath: archivePath,
  });
  if (!archiveLookup) {
    throw new Error("official archive lookup by logical id returned empty");
  }
  const documentId = reservedDeliverableDocumentId({
    knowledgeBaseId: kb.id,
    filename: PRICE_WATCH_FILENAME,
    archive: archiveLookup,
  });
  const reserved = readReservedDeliverableOriginal({
    knowledgeBaseId: kb.id,
    documentId,
    kbStorePath,
    archiveStorePath: archivePath,
    tenantsRoot,
    configDir,
  });
  if (!reserved) {
    throw new Error("official reserved-folder read returned empty");
  }
  const folderRead = readKnowledgeFolderFile({
    layout,
    filename: PRICE_WATCH_FILENAME,
  });
  if (!folderRead) {
    throw new Error("official knowledge folder read returned empty");
  }
  const text = reserved.buffer.toString("utf8");
  const hash = computeRawContentHash(reserved.buffer);
  const extracted = parsePriceWatchFacts(text);
  if (extracted.length < 4) {
    throw new Error(`failed to extract verifiable facts from original; got ${extracted.length}`);
  }
  const comparison = comparePriceMoves(extracted);
  const cite = buildDeliverableCiteUri({
    workspaceId: params.workspaceId ?? "ws-tenant-a",
    deliverableId,
    versionId: "v1",
  });
  const parsed = parseCiteUri(cite);
  const followupBody = formatPriceWatchFollowup({
    cite,
    savedPath: folderRead.absolutePath,
    hash,
    extracted,
    comparison,
  });
  const followupPath = path.join(workRoot, "artifacts", "price-watch-followup.md");
  fs.mkdirSync(path.dirname(followupPath), { recursive: true });
  fs.writeFileSync(followupPath, followupBody, "utf8");

  const foreignRoot = path.join(workRoot, "tenant-b");
  const foreignKbStore = path.join(foreignRoot, "knowledge-bases.json");
  const foreignArchive = path.join(foreignRoot, "deliverable-archive.json");
  const foreignTenantsRoot = path.join(foreignRoot, "tenants");
  const foreignConfigDir = path.join(foreignRoot, "config");
  fs.mkdirSync(foreignConfigDir, { recursive: true });
  const foreignKb = createKnowledgeBase(
    {
      title: PERSONAL_DELIVERABLES_KB_TITLE,
      visibility: "private",
      ownerId: "user-b",
      tenantId: "tenant-b",
    },
    foreignKbStore,
  );
  const foreignLayout = resolveKnowledgeDirectoryLayoutForBase(foreignKb, {
    tenantsRoot: foreignTenantsRoot,
    configDir: foreignConfigDir,
  });
  const foreignArchiveRecord = getDeliverableArchiveRecord(deliverableId, foreignArchive);
  const foreignLogical = findDeliverableArchiveByLogicalId({
    knowledgeBaseId: kb.id,
    logicalId: PRICE_WATCH_LOGICAL_ID,
    storePath: foreignArchive,
  });
  const foreignReserved = readReservedDeliverableOriginal({
    knowledgeBaseId: kb.id,
    documentId,
    kbStorePath: foreignKbStore,
    archiveStorePath: foreignArchive,
    tenantsRoot: foreignTenantsRoot,
    configDir: foreignConfigDir,
  });
  const foreignFolder = readKnowledgeFolderFile({
    layout: foreignLayout,
    filename: PRICE_WATCH_FILENAME,
  });

  const excerptLines = extracted
    .map((row) => `${row.product} ${row.sku} ${row.collectedOn} ${row.priceCny.toFixed(2)}`)
    .join(" | ");

  return {
    originalPath,
    originalBytes: reserved.buffer.byteLength,
    originalHash,
    cite,
    parsedKind: parsed?.kind ?? null,
    readRecord: {
      api: "readReservedDeliverableOriginal + readKnowledgeFolderFile",
      path: folderRead.absolutePath,
      bytes: reserved.buffer.byteLength,
      hash,
      excerpt: excerptLines,
      hashMatchesArchive: hash === (archiveLookup.record.rawHash ?? ""),
    },
    extracted,
    comparison,
    followupBody,
    followupPath,
    crossTenant: {
      foreignArchiveRecord: foreignArchiveRecord ?? null,
      foreignLogicalLookup: foreignLogical ?? null,
      foreignReservedRead: foreignReserved
        ? { filename: foreignReserved.filename, bytes: foreignReserved.buffer.byteLength }
        : null,
      foreignFolderRead: foreignFolder
        ? { path: foreignFolder.absolutePath, bytes: foreignFolder.buffer.byteLength }
        : null,
      deny: "empty",
    },
    result: "pass",
  };
}
