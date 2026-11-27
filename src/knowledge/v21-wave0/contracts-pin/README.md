# contracts/v21-reuse-v1 — DRAFT_WAVE_V21_0_NOT_FROZEN

Isolated Wave-V21-0 contract pack. This directory is NOT part of the historical M1 frozen 28-asset tree and must not rewrite `verify_frozen.py` hashes or `m1-freeze-manifest.json`.

Five packs: model-adapter, controlled-data-bridge, memory-resource-bridge, ai-execution-trace, openapi-v3-draft. Each has JSON Schema or OpenAPI plus Python/TypeScript DTO drafts and desensitized golden vectors (syn_* identifiers only).

Rules encoded here:
- No hardcoded model credentials or implicit paid SDK calls. Provider handles are injection slots (`slot:`, `deleg:`, `svc:`).
- Controlled Data Bridge Mode A/B/C only; unmatched mode Fail-Closed (M-03). MVP Text-to-SQL is forbidden. `policy_generation`, `masking_receipt`, `freshness_ts`, and `tombstone` are mandatory.
- `policy_generation` is a strict integer 1..9007199254740991.
- Memory discovery is read-only `resource_type=agent_memory`. `RevocationPurgeReceipt.purged` requires four success channel receipts (M-05).
- Unified trace locks tenant_id, user_id, agent_id, trace_id, run_id, plan_id, policy_generation, cost_attribution.
- `/v3/*` is a DRAFT and must not be mounted in the production HTTP app. Space APIs stay on `/v2/spaces`.

Recompute the handoff manifest (SHA-256 of every committed file except the manifest itself, POSIX path, stable sort, raw bytes):

`python contracts/v21-reuse-v1/validate.py`

Team B independently reruns that command and compares `v21-contract-manifest.json` plus the SHA-256 of that file. `package-lock.json`, `__pycache__/`, and `*.pyc` are excluded from the contract manifest because they are local toolchain or bytecode artifacts.

TypeScript: `npm ci --ignore-scripts --no-audit --no-fund --prefix contracts/v21-reuse-v1`, then `tsc -p contracts/v21-reuse-v1/tsconfig.json`, then `node contracts/v21-reuse-v1/ts-generated/check.js`.
