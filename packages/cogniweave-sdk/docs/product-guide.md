# CogniWeave Product and Integration Guide

CogniWeave is a cognitive memory runtime SDK for AI agents.
It is designed to turn short-lived conversations, tool outputs, and agent runs into scoped,
traceable, reusable long-term memory.

This guide explains the product position, core capabilities, commercial value, target scenarios,
and practical integration paths for teams that want to embed CogniWeave into agent products.

## 1. Product Position

CogniWeave is not only a vector search helper.
It is a memory operating layer for agent systems.

Its job is to help an agent answer four product-critical questions:

- What should this agent remember?
- Who is allowed to reuse this memory?
- Why does this memory exist, and where did it come from?
- Can the memory survive restart, repair, and future service deployment?

The SDK is intended to become a standalone product that can run in three deployment shapes:

- Embedded SDK: a host application creates a CogniWeave runtime directly.
- Local durable runtime: an embedded runtime uses a local canonical metadata store.
- Service runtime: a future REST or sidecar service exposes CogniWeave across processes and hosts.

The current recommended commercialization posture is:

- Use embedded + local durable canonical metadata for product validation.
- Keep graph and vector indexes as rebuildable derived layers.
- Move to REST or external database service mode only after restart safety, repair, and scope isolation are validated.

## 2. Why CogniWeave Exists

Most AI memory systems start as retrieval systems.
They store text chunks, embed them, and return similar snippets.
That is useful, but it is not enough for durable agent memory.

Agent memory needs additional guarantees:

- Scope isolation: private, shared, group, and cross-agent memory must not bleed into each other.
- Provenance: important memories must link back to source evidence.
- Deduplication: repeated facts should merge instead of creating memory clutter.
- Repairability: derived graph and vector indexes should be rebuildable from canonical truth.
- Operational visibility: operators need to know whether memory is persistent, stale, or degraded.
- Product trust: users should not experience random amnesia after process restart.

CogniWeave is built to provide these guarantees as SDK-level primitives rather than one-off application code.

## 3. Commercial Value

CogniWeave creates business value in five main ways.

### 3.1 Better Agent Continuity

Agents can remember durable preferences, project decisions, recurring incidents, operating constraints,
and team knowledge across sessions.

User-facing impact:

- fewer repeated explanations
- better personalization
- more consistent agent behavior
- higher trust in long-running workflows

### 3.2 Safer Shared Memory

CogniWeave models memory scope explicitly.
This is essential for team agents, group chats, enterprise assistants, and multi-agent systems.

Commercial impact:

- safer tenant and workspace separation
- clearer enterprise permission story
- reduced risk of memory contamination
- stronger fit for collaborative products

### 3.3 Evidence-Backed Memory

Memory atoms can point back to evidence records.
This helps teams answer why a memory exists instead of treating memory as an unexplained embedding result.

Commercial impact:

- better auditability
- easier debugging
- more credible enterprise deployments
- stronger support and compliance posture

### 3.4 Durable Local Product Validation

The local SQLite canonical metadata backend lets teams validate long-term memory behavior before building a larger service platform.

Commercial impact:

- faster prototype-to-production path
- lower deployment friction
- easier demos
- better customer pilots
- clearer upgrade path to managed service mode

### 3.5 SDK Product Surface

CogniWeave is packaged as an independent SDK boundary.
It can be positioned as:

- a memory runtime for agent platforms
- a durable memory SDK for AI apps
- an enterprise memory governance layer
- a future managed memory service foundation

## 4. Core Concepts

### 4.1 Scope

Every memory object is attached to a scope.

```ts
type Scope = {
  workspaceId: string;
  projectId: string;
  agentId: string;
  visibility: "private" | "shared";
};
```

Use scope to separate:

- one user from another user
- one workspace from another workspace
- private agent memory from shared group memory
- one project or chat channel from another project or chat channel

Scope is part of canonical truth, not display metadata.

### 4.2 Evidence

Evidence records capture source snippets and locators.
They connect memory back to the original chat, document, tool log, diff, or agent run.

```ts
type EvidenceRecord = {
  id: string;
  type: string;
  uri: string;
  snippet: string;
  trustScore: number;
  scope: Scope;
  locator: {
    messageIds: string[];
    toolCallIds: string[];
    turnRange?: [number, number];
    documentOffsets?: [number, number];
  };
};
```

Evidence enables explainability, support debugging, and future governance workflows.

### 4.3 Memory Atom

A memory atom is a distilled reusable claim.
It is smaller and more structured than a transcript chunk.

Atoms include:

- claim type
- statement
- trigger conditions
- applicability boundaries
- provenance
- versioning
- conflict state
- confidence metrics

### 4.4 Event Skeleton

An event skeleton represents what happened in a source interaction.
It preserves goals, context, constraints, decisions, turning points, and outcomes.

Events are useful for long-running agent workflows because they let a system reconstruct why memory changed.

### 4.5 Canonical Store

The canonical metadata store is the source of truth for durable memory.
It should contain:

- ingestions
- events
- atoms
- scope data
- provenance
- evidence
- relations
- write journals

Graph and vector indexes should remain derived layers that can be rebuilt.

### 4.6 Write Journal

The write journal records memory write operations and derived index status.
It supports repair workflows when canonical writes succeed but derived sync fails.

This makes partial success visible instead of silent.

## 5. Main SDK Capabilities

CogniWeave currently provides the following major capabilities.

### 5.1 Task Framing

`frameTask()` converts raw input into a structured task frame.

Use it when you want the agent to understand:

- goals
- problems
- constraints
- scenario tags
- entities
- required memory atom types
- task type

### 5.2 Reasoning

`reason()` creates a cognitive package from a task frame.

The package includes:

- an answer summary
- reasoning paths
- why information
- risk markers
- supporting memory references

Use `reasonWithDebug()` during development to inspect path selection and debug signals.

### 5.3 Ingestion

`ingest()` records source input into the runtime.

Source types include:

- chat
- tool log
- document
- diff
- agent run
- external source

### 5.4 Distillation

`distill()` extracts events, memory atoms, entities, scenarios, problems, evidence, and relations from source input.

Use distillation to turn raw runtime data into reusable long-term memory.

### 5.5 Write-Back

`writeBack()` commits distilled memory into the canonical store and updates derived layers.

It distinguishes:

- canonical metadata success
- derived graph or vector sync success
- partial success
- failure

### 5.6 Evidence Resolution and Search

`resolveEvidence()` retrieves evidence records by atom or evidence id.
`searchEvidence()` searches evidence text within a scope.

This is useful for:

- answer grounding
- UI explainability
- support review
- transcript-backed memory search

### 5.7 Traceability

CogniWeave supports tracing:

- atoms
- reasoning packages
- reasoning sessions
- provenance
- evidence references

Traceability is one of the core differentiators from basic vector memory.

### 5.8 Repair

`repairIndexes()` repairs derived indexes after partial failure.
`rebuildFromTruth()` rebuilds derived state from canonical metadata.

This is the foundation for a durable and operable memory product.

## 6. Recommended Architecture

The recommended product architecture is:

```text
Application / Agent Runtime
  |
  | uses SDK contracts
  v
CogniWeave Runtime
  |
  | canonical truth
  v
Local or remote metadata store
  |
  | derived rebuildable layers
  v
Graph index / vector index / evidence projection
```

Important principle:

- Metadata is canonical truth.
- Graph is a derived projection.
- Vector index is a derived retrieval layer.
- Evidence should remain separately resolvable.
- Scope must be persisted with every object.

## 7. Current Backend Modes

### 7.1 Memory Backends

Use memory backends for development and fast tests.

```ts
import { createCogniWeaveRuntime } from "@cogniweave/sdk";

const runtime = createCogniWeaveRuntime({
  environment: "local",
  metadataBackend: "memory",
  graphBackend: "memory",
  evidenceBackend: "memory",
  vectorBackend: "memory",
});
```

This mode is useful for:

- unit tests
- local experiments
- demos that do not require restart recovery

It is not enough for stable long-term memory.

### 7.2 Local Persistent Metadata Backend

Use the local backend when the runtime must survive restart.

```ts
import { createCogniWeaveRuntime } from "@cogniweave/sdk";

const runtime = createCogniWeaveRuntime({
  environment: "local",
  metadataBackend: "local",
  metadataStorePath: ".runtime/cogniweave/canonical.sqlite",
  graphBackend: "memory",
  evidenceBackend: "memory",
  vectorBackend: "memory",
  enableVectorSeedRetrieval: true,
  defaultScope: {
    workspaceId: "workspace-main",
    projectId: "agent:main",
    agentId: "main",
    visibility: "private",
  },
});
```

This mode is recommended for:

- product pilots
- OpenBot embedded memory
- desktop agents
- single-node local agents
- enterprise proof of concept deployments

The local backend persists canonical metadata.
Graph and vector layers may still be rebuilt as derived state.

### 7.3 Placeholder External Backends

The SDK has adapter boundaries for external stores such as PostgreSQL metadata,
Neo4j graph, and pgvector vector indexes.

Use these as service-readiness boundaries.
Do not treat external service deployment as the first commercialization milestone.
Validate local durability and repair first.

## 8. Basic TypeScript Integration

Install the package in a host application:

```bash
pnpm add @cogniweave/sdk
```

Create a scope:

```ts
const scope = {
  workspaceId: "acme-workspace",
  projectId: "support-bot",
  agentId: "agent-support-main",
  visibility: "private" as const,
};
```

Create a durable local runtime:

```ts
import { createCogniWeaveRuntime } from "@cogniweave/sdk";

const memory = createCogniWeaveRuntime({
  environment: "local",
  metadataBackend: "local",
  metadataStorePath: ".runtime/cogniweave/canonical.sqlite",
  graphBackend: "memory",
  evidenceBackend: "memory",
  vectorBackend: "memory",
  defaultScope: scope,
});
```

Frame and reason:

```ts
const task = await memory.frameTask("The customer wants escalation rules remembered.", {
  scope,
});

const pkg = await memory.reason(task, {
  includeExplainability: true,
});
```

Write memory:

```ts
const writeResult = await memory.writeBack({
  rawInput: "Escalate payment failures to the billing owner before retrying.",
  scope,
  sourceType: "chat",
  sourceSessionId: "session-001",
  package: pkg,
});

console.log(writeResult.status);
console.log(writeResult.journalId);
```

Search evidence:

```ts
const evidence = await memory.searchEvidence("payment failures billing owner", {
  scope,
  maxResults: 5,
});
```

Trace a package:

```ts
const trace = await memory.tracePackage(pkg.packageId, { scope });
console.log(trace.selectedPathIds);
```

## 9. CLI Usage

The SDK includes a `cogniweave` CLI for local service and adapter validation.

Dry-run a memory runtime:

```bash
pnpm --dir packages/cogniweave-sdk exec cogniweave serve \
  --metadata-backend memory \
  --graph-backend memory \
  --vector-backend memory \
  --dry-run
```

Run with local persistent metadata:

```bash
pnpm --dir packages/cogniweave-sdk exec cogniweave serve \
  --metadata-backend local \
  --metadata-store-path .runtime/cogniweave/canonical.sqlite \
  --graph-backend memory \
  --vector-backend memory \
  --dry-run \
  --print-config
```

Bootstrap schemas when supported:

```bash
pnpm --dir packages/cogniweave-sdk exec cogniweave bootstrap-schema \
  --metadata-backend local \
  --metadata-store-path .runtime/cogniweave/canonical.sqlite
```

Use JSON output for CI:

```bash
pnpm --dir packages/cogniweave-sdk exec cogniweave serve \
  --metadata-backend local \
  --metadata-store-path .runtime/cogniweave/canonical.sqlite \
  --dry-run \
  --json
```

## 10. OpenBot Integration

OpenBot uses CogniWeave as an embedded memory backend.

The OpenBot integration exercises important SDK product capabilities:

- agent private memory
- session transcript ingest
- group and shared scope memory
- cross-agent manager group memory sharing
- evidence search
- local restart-safe canonical metadata persistence

OpenBot config can select the CogniWeave backend:

```ts
const cfg = {
  memory: {
    backend: "cogniweave",
    cogniweave: {
      mode: "embedded",
      writeSync: "sync",
      storePath: "~/.openbot/cogniweave/canonical.sqlite",
    },
  },
};
```

When `storePath` is omitted, OpenBot resolves a default local canonical store under the OpenBot state directory.

OpenBot currently uses:

- local SQLite metadata as canonical truth
- memory graph backend as derived state
- memory evidence backend as derived state
- memory vector backend as derived state
- persisted scope and write journal metadata through CogniWeave

This is the correct Phase A architecture:

- restart-safe enough to validate long-term behavior
- still simple enough to debug locally
- ready to evolve toward service mode

## 11. Application Scenarios

### 11.1 Personal Assistant Memory

Use CogniWeave to remember:

- user preferences
- writing style
- recurring tasks
- communication constraints
- personal workflow rules

Recommended scope:

- workspace per user
- private visibility
- project per assistant or product surface

### 11.2 Team Chat Memory

Use CogniWeave to remember:

- channel decisions
- incident handling rules
- project conventions
- team-specific escalation paths
- group preferences

Recommended scope:

- workspace per organization
- project per channel or group
- shared visibility
- shared agent id for group memory

### 11.3 Support Agent Memory

Use CogniWeave to remember:

- customer preferences
- known workarounds
- escalation rules
- product-specific troubleshooting patterns
- support evidence and ticket provenance

Commercial value:

- faster case handling
- better continuity across agents
- stronger auditability

### 11.4 Developer Agent Memory

Use CogniWeave to remember:

- repository conventions
- prior debugging findings
- release constraints
- dependency caveats
- code review decisions

Commercial value:

- better coding assistant reliability
- less repeated context loading
- safer repository-specific automation

### 11.5 Multi-Agent Systems

Use CogniWeave to share memory across manager and worker agents.

Examples:

- manager agent remembers project decisions
- worker agents contribute evidence
- shared group scope keeps coordination knowledge
- private scope preserves agent-specific context

This is one of CogniWeave's strongest product directions because basic vector memory rarely handles cross-agent governance well.

## 12. Integration Checklist

Use this checklist when integrating CogniWeave into a host product.

### 12.1 Product Design

- Define who owns a workspace.
- Define what counts as a project.
- Define private versus shared memory rules.
- Define what sources are allowed to write memory.
- Define what evidence can be exposed to users.

### 12.2 Technical Setup

- Choose backend mode.
- Use `metadataBackend: "local"` for restart-safe embedded deployments.
- Set `metadataStorePath`.
- Keep graph and vector indexes rebuildable.
- Create stable scope ids.
- Use `writeBack()` for canonical writes.
- Store source ids and session ids consistently.

### 12.3 Operational Setup

- Expose runtime mode in health or status output.
- Show canonical store path in local deployments.
- Track write journal status.
- Add repair or rebuild commands.
- Run evaluation and benchmark gates before release.

### 12.4 Safety Setup

- Persist scope with every object.
- Never query shared memory without explicit scope intent.
- Keep evidence access controlled.
- Treat vector results as retrieval hints, not canonical truth.
- Build repair from metadata truth, not from vector state.

## 13. Maturity Levels

### Level 1: Restart-Safe

Goal:

- memory survives process restart

Required:

- atoms persist
- events persist
- evidence persists
- scopes persist
- journal persists
- group and shared memory recover

Allowed:

- graph can rebuild
- vector index can rebuild

### Level 2: Repairable

Goal:

- derived layer damage can be repaired

Required:

- canonical truth remains intact
- repair uses journal and metadata truth
- graph and vector rebuild commands exist
- failed derived sync is observable

### Level 3: Service-Ready

Goal:

- CogniWeave can run as a service or sidecar

Required:

- health probes
- migrations
- remote configuration
- multi-process consistency
- auth and tenancy boundaries
- external database support

## 14. Recommended Adoption Path

### Phase A: Embedded Durable SDK

Use:

- `metadataBackend: "local"`
- local SQLite canonical store
- memory graph backend
- memory vector backend
- memory evidence backend

Validate:

- restart recovery
- scope isolation
- write journal correctness
- group memory behavior
- evidence search
- repair workflow

### Phase B: Sidecar or REST Runtime

Use:

- REST interface
- external metadata store
- derived graph and vector services

Validate:

- network failure behavior
- deployment lifecycle
- authentication
- multi-process consistency

### Phase C: Managed Memory Platform

Use:

- hosted service
- tenant isolation
- operational dashboards
- policy and governance
- customer-facing analytics

Validate:

- enterprise deployment patterns
- compliance posture
- usage metering
- service-level support

## 15. Evaluation and Quality Gates

Run SDK evaluation:

```bash
pnpm --dir packages/cogniweave-sdk run eval:mvp:gate
```

Run benchmark gate:

```bash
pnpm --dir packages/cogniweave-sdk run benchmark:mvp:gate
```

Run install smoke:

```bash
pnpm --dir packages/cogniweave-sdk run smoke:install
```

Run package build:

```bash
pnpm --dir packages/cogniweave-sdk run build
```

For OpenBot integration changes, also run targeted memory tests:

```bash
pnpm exec vitest run src/memory/cogniweave-manager.test.ts
```

## 16. Commercial Packaging Ideas

CogniWeave can be packaged into multiple commercial tiers.

### Developer SDK

Includes:

- TypeScript SDK
- local durable backend
- CLI
- examples
- local evaluation gates

Target buyers:

- AI app builders
- agent platform teams
- early enterprise pilots

### Team Runtime

Includes:

- sidecar service
- shared memory scopes
- repair commands
- status and health probes
- OpenBot reference integration

Target buyers:

- internal platform teams
- support automation teams
- developer productivity teams

### Enterprise Memory Platform

Includes:

- hosted or self-hosted service
- external databases
- tenancy and auth
- governance workflows
- audit and evidence UI
- advanced analytics

Target buyers:

- enterprise AI platform owners
- regulated workflow teams
- large multi-agent deployments

## 17. Positioning Summary

CogniWeave should be positioned as:

> A durable, scoped, evidence-backed memory runtime SDK for agent products.

Its strongest differentiation is not that it can retrieve similar text.
Its differentiation is that it can help agent systems build memory that is:

- scoped
- persistent
- explainable
- repairable
- product-operable
- ready to evolve from embedded SDK to service platform

For OpenBot, CogniWeave is the next-generation memory layer.
For external customers, it can become a standalone memory infrastructure product for AI agents.
