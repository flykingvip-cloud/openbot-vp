# Shared registration hand-off — enterprise-data.\* RPC methods

Signed hand-off note (— kiro, 2026-07-12) for the two cursor-fable-owned gateway
registration tables. Records the coordination so my registration lines land with
correct provenance when the owner next commits those files.

## Situation

My Agent OS backend work (committed) added RPC handlers that must be registered in two
shared tables owned by `cursor-fable` (per `.loom/registry.yaml`: task
`development-supervisor:cursor-fable`, paths `src/gateway/server-methods-list.ts` and
`src/gateway/method-scopes.ts`):

- `src/gateway/server-methods-list.ts` (`BASE_METHODS`)
- `src/gateway/method-scopes.ts` (`BASE_METHOD_SCOPE_GROUPS`)

These files are **not committed by me** because:

1. They carry cursor-fable's own uncommitted WIP (currently
   `data.migration.verifyReadiness`, `data.memory.list`,
   `enterprise-operational-identity.execute`, `collaboration.capsule.transition`), and
   AGENTS.md rule 2 forbids committing a shared file that still contains another agent's WIP.
2. `git-hooks/pre-commit` re-stages the whole working file (`git add --force`), so a
   partial-line commit is not possible while cursor-fable's lines are present.
3. cursor-fable is actively editing these files (line count grew during the session), so a
   transient edit-out/restore of their lines would race with their live edits.

**No action is required to preserve my lines:** they already sit in the shared working
tree, so the owner's next whole-file commit of either table includes them automatically.

## My lines to preserve (do not drop when landing)

`server-methods-list.ts` — under `BASE_METHODS`, after `enterprise-data.sources.sync-log`:

```
"enterprise-data.semantic-objects.list",
"enterprise-data.semantic-objects.get",
"enterprise-data.planner.plan",
"enterprise-data.planner.context",
"enterprise-data.events.list",
"enterprise-data.events.ingest",
"enterprise-data.event-subscriptions.list",
"enterprise-data.event-subscriptions.upsert",
"enterprise-data.event-subscriptions.delete",
```

`method-scopes.ts` — READ_SCOPE group (after `enterprise-data.sources.sync-log`):

```
"enterprise-data.semantic-objects.list",
"enterprise-data.semantic-objects.get",
"enterprise-data.planner.plan",
"enterprise-data.planner.context",
"enterprise-data.events.list",
"enterprise-data.event-subscriptions.list",
```

`method-scopes.ts` — WRITE_SCOPE group (after `enterprise-data.approval.requests.decide`):

```
"enterprise-data.events.ingest",
"enterprise-data.event-subscriptions.upsert",
"enterprise-data.event-subscriptions.delete",
```

## Provenance

These lines complete the registration for three landed commits:

- `semantic-object-catalog` (Agent: kiro-semantic-catalog) — `semantic-objects.*`
- `agent-data-planner` (Agent: kiro-data-planner) — `planner.*`
- `enterprise-data-event-bus` (Agent: kiro-event-bus) — `events.*` / `event-subscriptions.*`

`server-methods.test.ts` validates list/scope/handler consistency; it passes in the shared
working tree today (both agents' lines present) and will pass at the committed snapshot once
the owner lands either table.
