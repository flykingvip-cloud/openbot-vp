# ADR: Agent terminology, canonical Registry, and unified ACL

- Date: 2026-07-31
- Status: Accepted (architecture decision only; implementation stays inside Phase -1)
- Scope: shared Agent identity and access control plane
- Supersedes ambiguity in: `docs/design/agent-growth-cloud-multitenant-architecture-review-2026-07-30.md`

This ADR records a decision. It does not grant release, PostgreSQL, cloud, or
multi instance approval. Security, Data Governance, and SRE sign off is still
outstanding and cannot be self certified by an implementer.

## Context

Request time authorization was previously able to pick a membership by object
order, and `AgentInstance` was used both as a business asset and as a runtime
mount. Growth, ownership, and entitlement consumers therefore had no single
canonical Agent subject to bind to, and the enterprise access policy model
(`EnterpriseAccessPolicy`) only expresses `allow` for `employee` and `seat`
subjects.

## Decision 1: frozen Agent terminology

| Term              | Definition                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| `AgentDefinition` | Reusable behavior, prompt, tool, and policy definition. Not an ownership or Growth subject.                         |
| `AgentAsset`      | Enterprise scoped business asset with a stable, immutable identity. The canonical subject for ownership and Growth. |
| `AgentDeployment` | Rebuildable runtime mount of an `AgentAsset` onto a seat, space, or runtime. Never a Growth subject.                |
| `AgentRevision`   | Immutable version of a definition or configuration.                                                                 |
| `AgentSnapshot`   | Materialized copy for migration, audit, or projection only. Not a version identifier.                               |
| `AgentInstance`   | Deprecated legacy alias. May only map to `AgentDeployment`.                                                         |

Rejected: promoting the existing `AgentInstance` to the canonical asset. It
carries runtime mount and rebuild semantics, so reusing it would couple
ownership, Growth history, and deployment lifecycle into one record.

## Decision 2: canonical Agent Registry contract

Canonical reference:

```ts
type AgentRef = {
  enterpriseId: string;
  agentAssetId: string;
};
```

- `agentAssetId` is a server generated opaque UUID. No API may depend on UUID
  ordering.
- Growth is keyed by `(enterpriseId, agentAssetId)`.
- `agentId` remains a legacy local identifier; `agentSlug` is a human readable
  enterprise scoped alias with `UNIQUE (enterpriseId, agentSlug)`.
- Every Growth, ACL, and ownership child record carries the enterprise boundary.
  A single global id column is not sufficient.

Ownership, phase one:

- Owner types are limited to `membership` and `seat`.
- Each active `AgentAsset` has exactly one active primary owner.
- An owner change closes the previous binding and preserves full history.
- Team and enterprise ownership are deferred until a Team Registry and its
  governance rules are frozen.
- Cross enterprise transfer of an `AgentAsset` is forbidden. A cross enterprise
  copy creates a new `AgentAsset` with governed provenance and never inherits the
  original Growth identity.

Legacy resolution must return one of four states: a unique canonical `AgentRef`,
no mapping, an ambiguous mapping that is quarantined, or a universal builtin that
has no asset identity at all (see Amendment 2). Guessing by slug, recency, or
first match is forbidden.

## Decision 3: unified ACL evolution

Decision: introduce `EnterpriseAccessPolicyV2` as a versioned replacement inside
the same enterprise access control plane, with a migration adapter for v1 data.

Rejected alternatives: unbounded field growth on v1; a parallel Growth specific
ACL; long lived dual authority between v1 and v2. Exactly one authoritative
policy set per tenant at any time.

Subjects: `membership`, `seat`, `service_principal`.
Canonical resource: `agent_asset`. Legacy `agent` resources must be resolved to
an `AgentRef` by the Registry resolver before reaching the evaluator.

Minimum permission set:

```text
agent.read
agent.execute
agent.manage
agent.ownership.transfer
growth.read
growth.observation.write
growth.correct
growth.repair
growth.aggregate
growth.export
```

### Amendment 1 (2026-07-31): non-agent resource types

Migrating tenant `001` showed that keeping `agent_asset` as the only V2 resource makes
enforcement impossible: 11 of its 61 active v1 grants are `agent`, and the other 50
cover `seat`, `space`, `memory`, and `capability`. Enforcing with only `agent_asset`
represented would silently drop those 50 grants, so V2 is extended rather than enforced
partially.

Resource types are now:

```text
agent_asset   canonical, identified by AgentRef (enterpriseId + agentAssetId)
seat
space
memory
capability
```

Permissions added, derived strictly from the (resource, action) pairs that actually
exist in the v1 data, so no right is invented:

```text
seat.read
space.read
memory.read
memory.write
capability.execute
```

`memory.write` is deliberately a first-class permission, unlike the rejected
`agent.write`: v1 expresses it directly for memory, and there is no broader `memory`
permission it could be folded into without widening access.

Identity boundary for the new types: only `agent_asset` has a canonical registry. The
other four are still identified by their v1 resource id, scoped by `enterpriseId`. That
means:

- their grants are `(enterpriseId, resourceType, resourceId)` tuples, never a bare
  global id;
- the Registry resolver is not consulted for them, and no quarantine applies;
- the `requireAssetStatus` and `requireOwnerBinding` conditions remain agent-only,
  because ownership and lifecycle are modelled for `AgentAsset` alone;
- giving them canonical ids later is a separate decision and must not be inferred from
  this amendment.

Unchanged by this amendment: default deny, explicit deny wins, enterprise mismatch is a
hard deny, inactive subject fails closed, owner baseline stays materialized and
agent-only, service principal permissions remain an intersection, and unknown conditions
fail closed.

### Amendment 2 (2026-08-01): universal builtin agents are not assets

Comparing the live granted surface against the evaluator in tenant `001` showed that the
builtin steward had been modelled as an enterprise asset owned by one seat, while the
runtime treats it as a private per-employee instance. Its legacy id is `main`, so a
Registry backfill created a canonical asset for it and bound the CEO seat as owner, and
migration copied three v1 grants onto that asset. The result was that enforcement would
have removed the steward from a member who happened to hold no grant for it, even though
no policy governs it at runtime.

Decision: an agent that every employee receives a private instance of is not an
`AgentAsset`. It has no canonical identity, no ownership, and no policy.

Concretely:

- legacy resolution gains a fourth state, `builtin-universal`, returned before the store
  is consulted, so a stray asset carrying that legacy id can never resolve into the
  ownership or policy model;
- backfill reports `skipped-builtin` instead of creating an asset or an owner binding;
- v1 migration reports `builtin-not-an-asset`, which is an expected skip rather than a
  decision item, because the runtime grants that agent to every employee regardless of
  policy and therefore nothing is lost;
- parity and the granted-surface comparison exclude it on both sides, so it counts as
  neither an agreement nor a divergence;
- the artifacts already written for tenant `001` (the canonical asset, its owner binding,
  and the three migrated policies) are retired as part of this amendment.

Rejected: materializing one allow policy per membership. It re-encodes an invariant as N
records that must be maintained on every membership change, so a new employee would have
no steward until a policy is written. That introduces a failure mode into a feature that
currently cannot fail, and it leaves one seat owning every employee's assistant, which a
seat handover would then transfer.

Deliberately left open: if restricting the steward for a specific employee becomes a
product requirement, it is expressed as an explicit `deny` policy for that subject, not as
N allows. The evaluator already gives explicit deny precedence over any allow, so no new
mechanism is needed and the universal default stays maintenance free.

Evaluation semantics:

- Enterprise mismatch is a hard deny.
- Default deny; an explicit deny always wins over any allow.
- An inactive or revoked subject, owner binding, or asset fails closed.
- An owner never bypasses the evaluator. Owner baseline permissions are
  materialized as explicit, auditable derived policies.
- For a `service_principal` acting with `onBehalfOfMembershipId`, the effective
  permission set is the intersection of principal and membership permissions.
  Union style widening is forbidden.
- Conditions are typed fields only. An unknown condition fails closed. No
  arbitrary expression DSL.
- Policy mutation, ownership transfer, correction, repair, and export are
  audited.

## Migration constraints for v1 data

v1 is `effect: "allow"` only, with `subjectType` in `employee | seat`, actions
`read | write | execute | manage`, and a legacy `agent` resource type.

- `employee` subjects are user scoped, so the adapter must resolve them to an
  exact membership inside the tenant. An ambiguous or missing membership is
  quarantined, never guessed.
- Legacy `agent` resource ids must go through the Registry resolver.
- Action mapping is `read -> agent.read`, `execute -> agent.execute`,
  `manage -> agent.manage`. v1 `write` has no counterpart in the frozen
  permission set and is quarantined rather than widened to `agent.manage`.
- Non agent v1 resources stay in the v1 domain for this phase and are reported as
  unsupported instead of being silently dropped.
- `agent.ownership.transfer` and every `growth.*` permission are never
  synthesized from v1 data.

## Consequences

Allowed to proceed locally: this ADR, canonical types, the Registry and its
resolver plus quarantine, membership and seat ownership history, the V2 evaluator,
the v1 compatibility adapter, local repositories, and targeted tests.

Still blocked: PostgreSQL schema or deployment, cloud resources, Growth cloud
writes, production cutover, multi Gateway writers, multi instance fanout, and any
release. Those require the outstanding Security, Data Governance, and SRE sign
off together with agreed SLO, RPO, RTO, and retention targets.
