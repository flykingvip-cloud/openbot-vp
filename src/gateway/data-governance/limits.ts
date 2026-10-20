/** Machine-checkable size budgets for metadata-only catalog records. */
export const CATALOG_FIELD_LIMITS = {
  resourceIdMax: 256,
  bindingIdMax: 256,
  locatorMax: 2048,
  contentVersionMax: 128,
  principalIdMax: 256,
  maxBindingsPerRecord: 32,
  /** Serialized CatalogRecord JSON (bytes, UTF-8). */
  maxRecordBytes: 64 * 1024,
  /** Entire catalog file soft ceiling (bytes). */
  maxCatalogFileBytes: 8 * 1024 * 1024,
} as const;
