# Phase D1 — manifest delta

## File

`docs/design/convergence-evidence/2026-07-20/feature-manifests/auth_tenant.yaml`

## Before (Day0 blank)

- `decision: NEEDS_PRODUCT_DECISION`
- Empty `rpc_methods` / `auth_rules` / `tests` arrays

## After (D1)

- `decision: ACCEPT_WITH_REWORK`
- `rpc_methods`: `enterprise.organization.snapshot`
- `runtime_modules`: organization handler, billing-helpers, seat-context, tenant-context, billing/scope
- `auth_rules`: forged tenant reject + method scope registration
- `tests`: three real vitest paths including new tenant-scope suite
- `d1_notes`: thin-pack summary + deferred items

## Honesty bound

Manifest does **not** claim full platform-auth control UI, agent roster, or closure of unrelated unclassified RPC holes.
