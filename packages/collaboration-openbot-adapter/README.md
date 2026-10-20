# OpenBot Collaboration OpenBot Adapter

Internal OpenBot host adapter package for collaboration runtime and core.

## Status

- workspace-internal package
- OpenBot-host-specific adapter layer
- not intended for second-host direct reuse
- not approved for standalone publish yet

## Scope

- storage adapters
- audit adapters
- session projection adapters
- directory adapters

## Local checks

```bash
pnpm --dir packages/collaboration-openbot-adapter run test
pnpm --dir packages/collaboration-openbot-adapter run typecheck
```
