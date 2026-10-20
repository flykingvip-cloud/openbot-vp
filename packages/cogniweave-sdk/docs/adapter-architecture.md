# Adapter Architecture

This document defines how CogniWeave separates canonical storage from derived storage adapters.

## Goals

- keep `MetadataStore` as the canonical truth layer
- keep `GraphStore` and `VectorStore` as rebuildable derived layers
- allow backend-specific implementations without changing the public SDK contracts

## Adapter Layers

### Metadata Adapter

Responsibilities:

- canonical writes
- canonical reads
- event / atom / entity / scenario / problem / evidence / relation persistence
- write journal persistence
- optional transactional batch boundary (`withTransaction`) for canonical phase commit

Contract:

- `MetadataStore`

Reference implementation:

- `InMemoryMetadataStore`

### Graph Adapter

Responsibilities:

- derived node sync
- derived edge sync
- rebuild from canonical bundle

Contract:

- `GraphStore`

Reference implementation:

- `InMemoryGraphStore`

### Vector Adapter

Responsibilities:

- seed index sync
- seed index rebuild

Contract:

- `VectorStore`

Reference implementation:

- `InMemoryVectorStore`

## Factory Rule

SDK runtime creation should resolve adapters through a factory layer instead of directly importing backend classes from business logic.

This keeps:

- runtime wiring centralized
- backend switching explicit
- test/runtime environments aligned

## Initial Backend Strategy

Current status:

- `memory` backend is implemented
- `PostgresMetadataStore`, `Neo4jGraphStore`, and `PgVectorStore` are available as sql/cypher-first adapters
- placeholder adapters remain for unsupported backend names

Planned next backends:

- metadata: PostgreSQL
- graph: Neo4j or Memgraph
- vector: pgvector or OpenSearch

Current sql/cypher-first adapters:

- `PostgresMetadataStore`
- `Neo4jGraphStore`
- `PgVectorStore`

Current adapter maturity:

- `PostgresMetadataStore` is `sql-first`
- `Neo4jGraphStore` is `cypher-first`
- `PgVectorStore` is `sql-first`
- derived sync/rebuild paths are transaction-aware when backend transaction support is provided

## Invariants

- `MetadataStore` is the only source of truth
- `GraphStore` and `VectorStore` must be rebuildable from metadata
- adapter failures in derived layers must surface as `DERIVED_OUT_OF_SYNC`
- repair must always replay from canonical metadata
