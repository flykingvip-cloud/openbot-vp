# Memory Search Embedding Resilience Tasks

## Agents

- cursor-composer · role: owner · scope: memory_search embedding error classification, query retry, FTS degrade · paths: .kiro/specs/memory-search-embedding-resilience/\*\*, src/memory/embedding-error.ts, src/memory/embedding-error.test.ts, src/memory/embedding-retry.ts, src/memory/embedding-retry.test.ts, src/memory/manager-embedding-ops.ts, src/memory/manager.ts, src/memory/manager.embedding-batches.test.ts, src/memory/manager.search-degrade.test.ts, src/memory/embedding-manager.test-harness.ts, src/agents/tools/memory-tool.ts, src/agents/tools/memory-tool.test.ts, src/agents/tools/memory-tool.citations.test.ts, test/helpers/memory-tool-manager-mock.ts · since: 2026-08-09

## Implementation

- [x] Classify embedding errors (billing > rate_limit > auth/timeout/overloaded/provider_error); structured unavailable payload. — cursor-composer
- [x] Share batch/query embedding retry helper; retry only transient classes; respect Retry-After. — cursor-composer
- [x] Hybrid search: on query embed failure after retries, return FTS keyword results as degraded when available. — cursor-composer
- [x] Tests for classification, retry, FTS degrade, unavailable, citations regression, no secret leakage. — cursor-composer
