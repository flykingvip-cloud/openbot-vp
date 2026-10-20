# Discovery and Testing Playbook

## Route selection

1. Use a provider's documented capability listing when the requested function is unclear.
2. Use its documented route planner when a natural-language data need must map to a function and parameters.
3. Use a direct documented function when the need and contract are already exact.
4. Use the official SDK when authentication, signing, pagination, or protocol behavior is SDK-specific.
5. Use generic HTTP probing only for ordinary REST contracts.

Never infer an endpoint solely from naming conventions.

## Minimal probe design

Choose the smallest valid request:

- one instrument, object, or record;
- one to three fields unless the contract requires more;
- one day or the shortest documented date range;
- page size one;
- capabilities/metadata before expensive data calls;
- non-mutating method whenever possible.

For time-sensitive providers, choose a known valid historical interval rather than a future date. For realtime endpoints, verify the market/session state before treating an empty result as failure.

## Response classification

| Signal                                          | Classification                   | Next action                                  |
| ----------------------------------------------- | -------------------------------- | -------------------------------------------- |
| `2xx`, valid schema, provider success, complete | probe passed                     | prepare binding                              |
| `2xx`, valid schema, partial/incomplete flag    | limited                          | report limitation; bind only if useful       |
| `2xx`, empty payload                            | inconclusive                     | check entitlement, date/object, completeness |
| `2xx`, provider error object                    | failed                           | follow provider error code                   |
| `401`                                           | authentication failed            | verify secret source and header scheme       |
| `403`                                           | authorization/entitlement failed | inspect package rights; do not retry blindly |
| `404`                                           | route/object mismatch            | re-read official route contract              |
| `429`                                           | rate limited                     | honor `Retry-After`; stop probe loop         |
| timeout/DNS/TLS                                 | transport failed                 | verify base URL, network, certificate        |
| parse/schema mismatch                           | contract failed                  | compare content type and documented schema   |

## Consumption acceptance record

Capture this safe record for each test:

```json
{
  "sourceId": "src:example",
  "function": "documented_function",
  "parameters": { "object": "ONE_OBJECT", "fields": ["field"] },
  "httpStatus": 200,
  "providerStatus": "success",
  "complete": true,
  "rows": 1,
  "catalogUsed": true,
  "credentialExposed": false
}
```

## Two representative patterns

### Capability-routed financial provider

- Read the complete official agent/API document.
- Call the documented capabilities or route-plan function first.
- Keep historical, realtime, minute, fundamentals, flows, news, and thematic data contracts distinct.
- Inspect entitlement and completeness fields.
- Validate one symbol, minimal fields, shortest valid interval.

### Fixed REST endpoint

- Validate the documented base URL, path, method, and header name.
- Probe a harmless latest/status/capability request.
- Confirm response schema and provider-level status.
- Save base URL separately from request path so runtime routing can reuse the source.

## End-to-end acceptance matrix

| Layer          | Pass condition                     | Failure meaning                   |
| -------------- | ---------------------------------- | --------------------------------- |
| Transport      | request reaches provider           | network/base URL problem          |
| Authentication | provider accepts credential        | secret/header/entitlement problem |
| Contract       | response matches docs              | wrong route/function/schema       |
| Binding        | source ID persists                 | OpenBot write/context problem     |
| Catalog        | overview/routes saved              | automatic routing unavailable     |
| Consumption    | saved source answers minimal task  | runtime adapter/query problem     |
| Presentation   | source row appears under target KB | UI loading/render/cache problem   |
