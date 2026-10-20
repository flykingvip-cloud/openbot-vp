# REST API Mapping

This document maps the current SDK contracts to a service-oriented REST surface.

The rule is:

- REST should mirror SDK concepts 1:1
- REST must not weaken idempotency or journal semantics

## Endpoints

### POST /v1/tasks/frame

Purpose:

- map to `frameTask()`

Request body:

- `raw_input`
- `scope`
- `hints`
- `force_llm`

Response body:

- `TaskFrame`

### POST /v1/reason

Purpose:

- map to `reason()`

Request body:

- `task_frame`
- `max_paths`
- `include_explainability`
- `include_optional_evidence_refs`

Response body:

- `CognitivePackage`

### POST /v1/reason/debug

Purpose:

- map to `reasonWithDebug()`

Response body:

- `CognitivePackage`
- `ReasonDebugPayload`

### POST /v1/ingest

Purpose:

- map to `ingest()`

Response body:

- `IngestResult`

### POST /v1/distill

Purpose:

- map to `distill()`

Response body:

- `DistillationResult`

### POST /v1/write-back

Purpose:

- map to `writeBack()`

Response body:

- `WriteBackResult`

## Trace Endpoints

### GET /v1/atoms/{atom_id}/trace

- maps to `trace()`

### GET /v1/packages/{package_id}/trace

- maps to `tracePackage()`

### GET /v1/reasoning-sessions/{session_id}/trace

- maps to `traceReasoningSession()`

## Evidence Endpoints

### POST /v1/evidence/resolve

- maps to `resolveEvidence()`

### GET /v1/atoms/{atom_id}/evidence-refs

- maps to `getEvidenceRefs()`

## Repair Endpoints

### POST /v1/repair/indexes

- maps to `repairIndexes()`

### POST /v1/rebuild/from-truth

- maps to `rebuildFromTruth()`

### GET /v1/journals/{journal_id}

- maps to `getWriteJournal()`

## Idempotency

REST must support:

- `Idempotency-Key` request header for write endpoints
- returning `journal_id` on write endpoints
- returning canonical identifiers such as `event_key` where relevant

## Scope Enforcement

Every write and cold-layer read endpoint must enforce scope semantics.

Read endpoints (`trace`, `evidence`, `journal`) require request scope via headers:

- `x-cogniweave-workspace-id`
- `x-cogniweave-project-id`
- `x-cogniweave-agent-id`
- `x-cogniweave-visibility`

## Node Server Entry Point

The framework-agnostic service can be mounted with:

- `createCogniWeaveHttpServer(service)`
- `handleCogniWeaveHttpRequest(service, req, res)`

This is the reference integration path for the SDK's REST surface.
