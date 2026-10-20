# OpenBot Toolkit Blueprint

This package defines a portable tool architecture inspired by publicly documented Codex and ChatGPT Work capabilities. It is a specification package, not a copy of OpenAI's internal implementations.

## Contents

- catalog/tool-catalog.json: twelve tool families and their contracts
- combos/tool-combinations.json: minimal core, office workflow, and automation combinations
- schemas/tool-definition.schema.json: validation schema for catalog entries
- schemas/execution-receipt.schema.json: auditable execution receipt
- src/contracts.ts: implementation-neutral TypeScript interfaces
- config/policy.example.json: example risk and approval policy
- src/policy.ts: policy loader + evaluator (Phase 2)
- src/approval.ts: approval channel hook + test mock (Phase 2)
- src/gated-executor.ts: Policy to Approval to Receipt wrapper (Phase 2)

## Recommended execution model

Skill selects workflow
-> registry discovers allowed tools
-> policy evaluates scope and risk
-> approval resolves consequential actions
-> executor invokes the adapter
-> verifier checks observable results
-> receipt records evidence and side effects

Adapters may be implemented as local functions, hosted tools, MCP tools, or service connectors.

## Phase status

This tree lives at packages/toolkit as @openbot/toolkit.

Pipeline: Skill to Registry to Policy to Approval to Execution to Verification to Receipt

Phase 1 (done): ToolRegistry, receipt helpers, capability mapping, and tests.

Phase 2 (done in this package): Policy evaluator, approval hook/mock, gated executor,
gateway /tools/invoke wire, and unit tests for allow / allow-with-receipt /
require-approval / deny plus sample receipts.

Phase 2 gates every call through Policy then Approval then Receipt:

1. Load config/policy.example.json (or parseToolkitPolicy / loadToolkitPolicy)
2. Evaluate risk / sideEffects / destructive / credential facts
3. high+sideEffects or destructive leads to require-approval (approval channel hook or test mock)
4. success / fail / deny all write schema-aligned ExecutionReceipt via Phase 1 helpers
5. One thin Gateway integration at src/gateway/tools-invoke-http.ts
   (toolkit-phase2-gate.ts) - not a full adapter rewrite

See docs/capability-mapping.md.

Tests: from packages/toolkit run the package test script.
