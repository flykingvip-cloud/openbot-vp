# OpenBot Active Knowledge Source Contract

## Read path

| Purpose                 | RPC                           | Key input                                  | Required evidence                  |
| ----------------------- | ----------------------------- | ------------------------------------------ | ---------------------------------- |
| Resolve destination     | `knowledge.base.list`         | none                                       | exact ID, title, visibility        |
| Inspect one destination | `knowledge.base.get`          | `knowledgeBaseId`                          | membership and metadata            |
| List owned bindings     | `knowledge.source.list`       | optional `knowledgeBaseId`                 | stable binding record              |
| List consumable sources | `knowledge.base.sources.list` | `knowledgeBaseId`, optional `plane`/`kind` | active source in aggregated result |

## Write path

### `knowledge.source.bind`

Use this RPC only for active source kinds:

- `api`
- `external`
- `capability`

Input shape:

```json
{
  "knowledgeBaseId": "kb_example",
  "kind": "api",
  "title": "Provider Data API",
  "endpoint": "https://api.example.test",
  "metadata": {
    "auth.header": "X-API-Key",
    "auth.apiKey": "<protected secret>",
    "request.method": "GET",
    "request.path": "/v1/capabilities"
  }
}
```

Rules:

- The caller must have a resolved user context and write access to the knowledge base.
- Do not send `visibility`; the source inherits the knowledge base visibility.
- Metadata values must be strings.
- Active bindings are registered, not chunk-indexed.
- Identity is stable for the combination of knowledge base, kind, and endpoint (or title when endpoint is absent).
- Capture `binding.id` from the response.

### `knowledge.source.catalog.sync`

Input:

```json
{ "sourceId": "src:example" }
```

Use after binding when the provider exposes a catalog, capability list, schema, or route planner. Preserve catalog sync errors separately from binding state.

## Aggregated source result

`knowledge.base.sources.list` combines passive documents and active bindings. An active API source should satisfy:

```json
{
  "id": "src:example",
  "title": "Provider Data API",
  "kind": "api",
  "plane": "active",
  "knowledgeBaseId": "kb_example"
}
```

Active API bindings normally have no `documentId`. Consumers and UI code must not filter them out merely because they are not documents.

## Presentation contract

For an expanded, selected knowledge base, the employee knowledge tree renders active sources from `libraryWorkspaceSources` separately from document rows. Expected DOM evidence:

- `data-testid="ku-cockpit-tree-source"`
- `data-source-id="src:..."`
- visible source title
- no `该知识空间暂无文档` empty state when either documents or active sources exist

## Security notes

- Never return secret metadata in user-facing source summaries.
- Prefer a secret reference or protected storage when the runtime supports it.
- Do not put authorization values in endpoint query parameters.
- Validate tenant, membership, and knowledge-base visibility on every bind/list/sync operation.
