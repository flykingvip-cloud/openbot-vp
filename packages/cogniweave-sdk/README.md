# CogniWeave SDK

CogniWeave is a cognitive memory runtime for AI agents.
This package is the dedicated workspace for the CogniWeave SDK and its long-term development.
It is intended to be developed as a standalone product inside this repository.

## Purpose

This package is intended to hold the stable domain model and runtime contracts for:

- memory distillation
- event skeletons
- task framing
- path reasoning
- evidence tracing
- memory governance
- CLI startup for local service execution

## Current Status

The package now includes a runnable reference runtime baseline.
It is now configured as a publishable npm package boundary, although no registry release is performed by this repository change.
It currently provides:

- core product-domain types
- SDK contract interfaces
- a product and integration guide for commercial positioning and adoption planning
- compiled `dist/` artifacts for package consumption
- a dedicated workspace package boundary for future implementation
- package-local product and engineering documentation
- a minimal CLI service entrypoint
- an installable `cogniweave` bin entry
- a `smoke:serve` dry-run script for startup validation
- a tarball install smoke gate (`smoke:install`) for independent import + CLI validation
- a minimal Python SDK client (`python/cogniweave_sdk`)
- an MVP evaluation runner (`eval:mvp`, `eval:mvp:gate`)
- an MVP benchmark runner (`benchmark:mvp`, `benchmark:mvp:gate`)
- a container-based rollback integration runner (`integration:rollback`)

## Structure

```text
packages/cogniweave-sdk/
  README.md
  docs/
    README.md
    benchmarking.md
    cli.md
    evaluation.md
    integration-testing.md
    product-guide.md
    prd-v1.1.md
    python-sdk.md
    quickstart.md
    runtime-examples.md
    technical-spec-v1.4.md
  datasets/
    mvp-core-eval.json
  scripts/
    benchmark-mvp.ts
    docker-compose.integration.yml
    eval-mvp.ts
    integration-rollback.mjs
  examples/
    minimal.ts
    writeback-repair.ts
  package.json
  python/
    cogniweave_sdk/
    tests/
  tsconfig.json
  src/
    cli.ts
    contracts.ts
    index.ts
    models.ts
```

## Initial Public Surface

- `@cogniweave/sdk`
- `@cogniweave/sdk/models`
- `@cogniweave/sdk/contracts`

## Publish State

- npm package boundary: publishable
- registry release status: not performed by this change

## Source of Truth

The package-local source of truth lives in:

- `packages/cogniweave-sdk/docs/product-guide.md`
- `packages/cogniweave-sdk/docs/prd-v1.1.md`
- `packages/cogniweave-sdk/docs/technical-spec-v1.4.md`

For commercial positioning, target scenarios, adoption guidance, and OpenBot integration posture,
start with `packages/cogniweave-sdk/docs/product-guide.md`.

## Runtime Verification

- quality gate: `pnpm --dir packages/cogniweave-sdk run eval:mvp:gate`
- performance gate: `pnpm --dir packages/cogniweave-sdk run benchmark:mvp:gate`
- package build: `pnpm --dir packages/cogniweave-sdk run build`
- independent install smoke: `pnpm --dir packages/cogniweave-sdk run smoke:install`
- container rollback integration: `pnpm --dir packages/cogniweave-sdk run integration:rollback`
