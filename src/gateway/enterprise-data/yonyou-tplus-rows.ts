/**
 * Chanjet / 用友 T+ list-body unwrap shared by the adapter, sync, and AggregateTemplate.
 *
 * Live handlers historically returned `{ records: <entire Chanjet body> }`. Warehouse Query
 * is often a bare row array; inventory QueryPage is a page object with `Data` (see
 * yonyou-tplus-sync.test.ts). AggregateTemplate after #222 only accepted Array.isArray(records),
 * so inventory Feed stayed `{ count:0, items:[] }` while sync listedRows still counted rows.
 */

function objectRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

/** Prefer the `records` envelope used by handlers; otherwise the raw body. */
export function yonyouTplusPayloadBody(payload: unknown): unknown {
  const record = objectRecord(payload);
  if (record && "records" in record) {
    return record.records;
  }
  return payload;
}

/**
 * Extract a flat row list from a Chanjet list/page body (or handler `{ records }` envelope).
 * Order matches sync: bare array, result, Data, Rows, data.Rows, then data as array.
 */
export function extractYonyouTplusRows(value: unknown): unknown[] {
  const body = yonyouTplusPayloadBody(value);
  if (Array.isArray(body)) {
    return body;
  }
  const record = objectRecord(body);
  if (!record) {
    return [];
  }
  if (Array.isArray(record.result)) {
    return record.result;
  }
  if (Array.isArray(record.Data)) {
    return record.Data;
  }
  if (Array.isArray(record.Rows)) {
    return record.Rows;
  }
  if (Array.isArray(record.items)) {
    return record.items;
  }
  if (Array.isArray(record.records)) {
    return record.records;
  }
  const data = objectRecord(record.data);
  if (data && Array.isArray(data.Rows)) {
    return data.Rows;
  }
  if (data && Array.isArray(data.Data)) {
    return data.Data;
  }
  if (Array.isArray(record.data)) {
    return record.data;
  }
  return [];
}

/** Last segment of a Chanjet selectFields path (`SaleDelivery.Code` → `Code`). */
export function yonyouTplusSelectFieldLeaf(selectField: string): string {
  const trimmed = selectField.trim();
  if (!trimmed) {
    return trimmed;
  }
  const parts = trimmed.split(".");
  return parts[parts.length - 1] ?? trimmed;
}

/**
 * Stable record key for FindVoucherList positional Rows.
 * Strip only the voucher root (`SaleDelivery.` / `SaleOrder.`) so nested paths
 * stay distinct: `SaleDelivery.Code` → `Code`, but
 * `SaleDelivery.SaleDeliveryDetails.Inventory.Code` → `SaleDeliveryDetails.Inventory.Code`
 * (leaf-only keys would collide on every `.Code`).
 */
export function yonyouTplusSelectFieldPathKey(selectField: string): string {
  const trimmed = selectField.trim();
  if (!trimmed) {
    return trimmed;
  }
  const dot = trimmed.indexOf(".");
  if (dot <= 0) {
    return trimmed;
  }
  return trimmed.slice(dot + 1);
}

/**
 * Assign `value` at dotted path under `root`, creating plain objects as needed.
 * Lets PUBLIC seeds like `records[*].Customer.Name` resolve via nested walk
 * (masking splits on `.`; flat `"Customer.Name"` keys would not match).
 */
export function assignYonyouTplusPathValue(
  root: Record<string, unknown>,
  pathKey: string,
  value: unknown,
): void {
  const segments = pathKey.split(".").filter(Boolean);
  if (segments.length === 0) {
    return;
  }
  let cursor: Record<string, unknown> = root;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i];
    const existing = cursor[segment];
    if (existing == null || typeof existing !== "object" || Array.isArray(existing)) {
      const next: Record<string, unknown> = {};
      cursor[segment] = next;
      cursor = next;
    } else {
      cursor = existing as Record<string, unknown>;
    }
  }
  cursor[segments[segments.length - 1]] = value;
}

/**
 * Chanjet FindVoucherList often returns `Rows` as positional arrays matching
 * `selectFields`. Map those to nested objects so ensure-package PUBLIC seeds
 * (`records[*].Code` / `VoucherDate` / `Customer.Name` / detail paths) apply
 * the same way as partner QueryPage object rows. Non-array rows are left unchanged.
 */
export function normalizeYonyouTplusVoucherRows(
  rows: unknown[],
  selectFields: readonly string[] | undefined,
): unknown[] {
  if (!selectFields || selectFields.length === 0) {
    return rows;
  }
  const keys = selectFields.map(yonyouTplusSelectFieldPathKey);
  return rows.map((row) => {
    if (!Array.isArray(row)) {
      return row;
    }
    const record: Record<string, unknown> = {};
    for (let index = 0; index < row.length && index < keys.length; index += 1) {
      const key = keys[index];
      if (!key) {
        continue;
      }
      assignYonyouTplusPathValue(record, key, row[index]);
    }
    return record;
  });
}
