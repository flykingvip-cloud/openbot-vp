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
