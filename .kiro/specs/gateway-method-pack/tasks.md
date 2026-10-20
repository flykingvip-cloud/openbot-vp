# Implementation Plan: Gateway Method Pack (multi-agent land safety)

## Overview

Colocated RPC registration: new gateway methods ship as `*.pack.ts` beside handlers.
Packs merge into `listGatewayMethods`, `METHOD_SCOPE_GROUPS`, and `coreGatewayHandlers`
without editing the legacy root files manually.

## Agents

- cursor-fable · role: owner · scope: pack infrastructure + CI guard + pilot migrations · paths: src/gateway/server-methods/pack*.ts, src/gateway/server-methods/packs/\*\*, src/gateway/server-methods/*.pack.ts, scripts/check-gateway-method-packs.ts · since: 2026-07-08

## Rules (enforced by `pnpm lint:gateway:method-packs`)

1. New RPCs: add `feature.pack.ts` + register in `packs/registry.ts`.
2. Do **not** add pack-owned method names to `BASE_METHODS` or `BASE_METHOD_SCOPE_GROUPS`.
3. `externalHandlers: true` when handler bodies remain in a legacy module (e.g. `chat.ts`) until extracted.

## Tasks

- [x] Pack types + merge helpers + registry — cursor-fable
- [x] Pilot packs: `chat-checkpoints`, `steward-workspace-file`, `supervisor` — cursor-fable
- [x] Extract `chat.checkpoints.list` → `chat-checkpoints.ts` — cursor-fable
- [x] Migrate `fabric.*` RPC pack — cursor-fable
- [x] Migrate `daibai.*` + `support.cases.*` RPC packs — cursor-fable
- [x] UI: `gateway-subscriptions/exec-approval.ts` split — cursor-fable
- [x] UI: `wiring/chat-send.ts` cron context wiring — cursor-fable
- [x] Land: scoped commits (pack infra / migrations / UI split) — cursor-fable
