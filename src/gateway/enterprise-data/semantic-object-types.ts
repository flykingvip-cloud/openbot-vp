// Semantic Object Catalog — shared types.
// Spec: .kiro/specs/semantic-object-catalog/{requirements,design}.md
//
// Metadata-First catalog: describes canonical enterprise objects (Customer / Order /
// Product / Inventory …) and maps their canonical fields to physical source fields.
// It NEVER stores business data rows — fetching is done by the existing invoke/data
// gateway. This is the "language" agents understand, and the metadata map that the
// (future) Agent Data Planner consumes.
//
// Design decision D1: this lives in a SEPARATE store file (openbot-enterprise-semantic-objects.json)
// and does NOT touch EnterpriseDataStore. We only READ two shared types from ./types.js.

import type { ConnectorActionRef, DataClassification } from "./types.js";

/** Canonical enterprise object category — the vocabulary agents reason about. */
export type SemanticObjectKind =
  | "customer"
  | "order"
  | "product"
  | "inventory"
  | "employee"
  | "contract"
  | "invoice"
  | "custom";

/** Canonical field data type. `reference` points at another semantic object. */
export type SemanticFieldType =
  | "id"
  | "string"
  | "number"
  | "boolean"
  | "date"
  | "datetime"
  | "enum"
  | "money"
  | "reference";

/** One canonical field on a semantic object (describes structure, holds no value). */
export type SemanticField = {
  /** Canonical field name, e.g. "customerName". Unique within one object. */
  fieldKey: string;
  displayName: string;
  type: SemanticFieldType;
  description?: string;
  /** Data classification — aligned with the existing masking pipeline (types.ts). */
  classification?: DataClassification;
  /** For type=reference: the objectKey this field points to (e.g. "customer"). */
  referenceObjectKey?: string;
  required?: boolean;
};

/** Maps a canonical field to a physical field path exposed by a source action. */
export type SemanticFieldMapping = {
  /** Must reference a declared field on the same object. */
  fieldKey: string;
  /** Physical path in the action output, e.g. "records[].Name". */
  sourceFieldPath: string;
};

/**
 * Binds a semantic object to a physical DataSource + ConnectorAction that supplies it.
 * The "understand data, not tables" bridge. Existence of sourceId/action is validated
 * by the cross-store layer (resolver/handler/Planner), not here (design decision D3).
 */
export type SemanticObjectSourceBinding = {
  bindingId: string;
  /** DataSource.sourceId (lives in EnterpriseDataStore — validated cross-store). */
  sourceId: string;
  /** Which connector action yields rows of this object. */
  action: ConnectorActionRef;
  /** Canonical field ← physical field-path mapping. */
  fieldMappings: SemanticFieldMapping[];
  /** Optional governance link to a business capability (DataCapability). */
  capabilityId?: string;
  /** Preferred binding when multiple sources supply the object (at most one true). */
  primary?: boolean;
};

export type SemanticObjectLifecycle = "draft" | "active" | "deprecated";

/** Canonical enterprise object — Metadata-First catalog entry (no business data). */
export type SemanticObject = {
  objectId: string;
  tenantId: string;
  /** Stable slug, unique within a tenant, e.g. "customer" / "sales-order". */
  objectKey: string;
  /** Human display name, e.g. "客户". */
  displayName: string;
  kind: SemanticObjectKind;
  description: string;
  fields: SemanticField[];
  sourceBindings: SemanticObjectSourceBinding[];
  lifecycle: SemanticObjectLifecycle;
  /** "demo" marks auto-seeded sample catalog entries (not user-authored). */
  seedOrigin?: "demo";
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
};

/** Independent, versioned store for the semantic object catalog (design decision D1). */
export type SemanticObjectStore = {
  version: number;
  semanticObjects: Record<string, SemanticObject>;
};

export const SEMANTIC_OBJECT_STORE_VERSION = 1;
