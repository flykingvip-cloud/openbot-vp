import type {
  CatalogCompareAndPutConflict,
  CatalogCompareAndPutParams,
  DataGovernanceCatalogStore,
} from "./catalog-store.js";
import type { CatalogRecord } from "./types.js";

export type PrivilegedCognitiveCasResult =
  | { ok: true; record: CatalogRecord }
  | { ok: false; conflict: CatalogCompareAndPutConflict };

type PrivilegedCognitiveCasWriter = {
  compareAndPut: (params: CatalogCompareAndPutParams) => Promise<PrivilegedCognitiveCasResult>;
  uniqueCreate: (record: CatalogRecord) => Promise<PrivilegedCognitiveCasResult>;
};

const WRITERS = new WeakMap<DataGovernanceCatalogStore, PrivilegedCognitiveCasWriter>();

/** Called only from the file catalog factory. Not a public Catalog API. */
export function attachPrivilegedCognitiveCatalogCas(
  store: DataGovernanceCatalogStore,
  writer: PrivilegedCognitiveCasWriter,
): void {
  WRITERS.set(store, writer);
}

/** Called only from cognitive write commands (update / merge). Not a public Catalog API. */
export function runPrivilegedCognitiveCatalogCas(
  store: DataGovernanceCatalogStore,
  params: CatalogCompareAndPutParams,
): Promise<PrivilegedCognitiveCasResult> {
  const writer = WRITERS.get(store);
  if (!writer) {
    throw new Error("governance_catalog_denied:schema_write_locked");
  }
  return writer.compareAndPut(params);
}

/** Unique-create a cognitive Catalog row (S3 derived memory). Fails if the id exists. */
export function runPrivilegedCognitiveCatalogCreate(
  store: DataGovernanceCatalogStore,
  record: CatalogRecord,
): Promise<PrivilegedCognitiveCasResult> {
  const writer = WRITERS.get(store);
  if (!writer) {
    throw new Error("governance_catalog_denied:schema_write_locked");
  }
  return writer.uniqueCreate(record);
}
