# PRE-03 Anonymization Specification for Gate 4

- Document: `PRE03_ANONYMIZATION_SPEC_FOR_GATE4.md`
- Wave: Wave-V21-4 / W4B-1
- Date: 2026-11-28, timezone Asia/Shanghai (CST, UTC+8)
- Isolation branch: `codex/openbot/v21-wave4-gate4-prep`
- Isolation merge HEAD (W4B-2): `d7b86a1bd871383ee8a4178a1119ab655e0fdf7e`
- Parents of that merge: `8b83e4eba9b4eec5532046481ca98259c3bcf1d6` + `410bb78d4af9d961f9551a821ccf1c9bcd483173`
- Accepted main (unchanged): `8b83e4eba9b4eec5532046481ca98259c3bcf1d6`

## Status (binding)

- This document is a **specification only**. It is not an export, not a DBA request, and not a signed official PRE-03 field contract.
- **AUTH-V21-04 is not yet issued.** A named recipient has not been designated. EXT-02 remains unmet.
- **Space Gate 4 remains NOT_MET.** This document does not authorize an AUTH-V21-04 export, any production query, any dump of prod DBs / Qdrant / live tenant data, or any send of PRE-03 / EXT-02 packages.
- schema_v7_ddl_authorized=false. formal_t01_t27=NOT_RUN_NOT_ACCEPTED.
- Zero real production data was contacted in producing this specification. Samples below are **synthetic / anonymized examples only**.

## Source basis and explicit gaps

Field inventory is derived only from already-archived Team B PRE-03 / privacy / export contract texts and the Team A candidate schema archive. It is **not** derived from a live production catalog, a DBA export, or a current in-tree openbot-vp contract file.

Sources actually read for this specification:

| Source | Location | Fingerprint | Role |
|---|---|---|---|
| Team B PRE-03 redacted inventory request | archived pack `PRE_V7_TEAM_B/PRE-03_REDACTED_INVENTORY_REQUEST.md` (not present in openbot-vp isolation tree at `d7b86a1b`) | SHA-256 `2c10c17ab46c1b8c1047f6cf7320cfcde599a0112b7088472d9c230b5cdd1282` (419 bytes) | Authoritative Team B aggregate-only input rule |
| Team B B2-3 field mapping | pack `gate3-b22-handover/B2_3_PRE03_FIELD_MAPPING.md` | used as previously published Team B mapping text | Maps Team B aggregates to Team A candidate row format; states official PRE-03 contract is still unsigned |
| Team A candidate schema (unsigned) | archived `WAVE_B2_CHECKPOINT/pre03-candidate.schema.json` | SHA-256 `c68357ee45a62d83ddbcd50eb5a914f3b131b80985626bae97250db1d8c63463` (2161 bytes); title `CANDIDATE_PRE03_FORMAT_NOT_SIGNED` | **Team A candidate assertion**, not a signed official contract and not re-signed here |

**Gap (must not be filled by invention):** `PRE-03_REDACTED_INVENTORY_REQUEST.md` and `pre03-candidate.schema.json` are **not** in `openbot-vp` at isolation HEAD `d7b86a1b` (confirmed by `git ls-tree -r` name search). This agent did not query production schemas, information_schema, Qdrant collections, or live tenant tables. Therefore this inventory lists only fields and forbidden categories named in the sources above. It does **not** invent additional production column names (for example concrete email, phone, attachment, or document-body column identifiers) that cannot be read from those contracts.

## 1. Historical-data anonymization field inventory

Two independent products remain in the Team B mapping. They must not be collapsed into one object.

### 1.1 Product A — aggregate-only report (Team B required input)

Permitted output values are integers, booleans, enumerations, or non-identifying scope labels. No row-level identifiers.

| Field (from Team B PRE-03 request / B2-3 mapping) | Treatment | Notes |
|---|---|---|
| `generated_at` | keep (timestamp with timezone label) | Must not embed connection strings |
| `scope_description` | keep, but **redact** connection strings, passwords, cluster secrets, and host:port credentials | Logical environment / cluster name only |
| `tenant_count` | keep (integer aggregate) | |
| `null_tenant_kb_count` | keep (integer aggregate) | |
| `null_tenant_document_count` | keep (integer aggregate) | |
| `null_tenant_version_count` | keep (integer aggregate) | |
| `kb_count` | keep (integer aggregate) | |
| `team_count` | keep (integer aggregate, if metadata can distinguish) | If not distinguishable, report "not available from metadata" rather than invent a number |
| `collaboration_group_count` | keep (integer aggregate, if metadata can distinguish) | Same gap rule |
| `favorites_estimate` | keep only as an estimate or an explicit "cannot be counted from server tables" statement | Do not fabricate production counts |
| `legacy_alias_collision_count` | keep (integer aggregate) | Collision **counts**, not the aliases themselves |
| `name_or_id_collision_count` | keep (integer aggregate) | |
| `integrity` (scan complete? paginated? unclassifiable row count) | keep (structured completeness flags + integer remainder) | |

### 1.2 Product B — tokenized per-KB rows (Team A candidate; optional; requires separate written approval)

This format is **not signed**. If a later AUTH-V21-04 ever authorizes it, identifiers must already be tokenized on the DBA side before any file leaves the authorized environment. Keys, salts, and mapping tables must **not** be exported.

| Field (from candidate schema only) | Treatment | Notes |
|---|---|---|
| `format` | const `candidate-pre03-v1` | Reject any other value |
| `sanitized` | const `true` | Reject if missing or false |
| `provenance` | enum `SYNTHETIC_EXAMPLE` or `SANITIZED_CANDIDATE` | Mocks in this document use only `SYNTHETIC_EXAMPLE` |
| `rows[].legacy_kb_id` | **tokenize** to `^syn_[A-Za-z0-9_-]{1,64}$` | Never raw KB / business IDs |
| `rows[].tenant_id` | **tokenize** to the same pattern, or JSON `null` | Null is allowed (null-tenant cases) |
| `rows[].proposed_space_id` | must be JSON `null` until a later official allocation ruling | Export scripts must not assign target Spaces |
| `rows[].proposed_kb_id` | must be JSON `null` until a later official allocation ruling | Same |
| `rows[].alias_token` | **tokenize** or `null` | Collision relationships may be preserved only via stable tokens, never raw aliases |
| `rows[].name_token` | **tokenize** (required string in the candidate schema) | Never raw names |

### 1.3 Categories that must be stripped / hashed / tokenized / redacted (forbidden in both products)

Named as **categories** in the Team B PRE-03 request and B2-3 mapping. Concrete production column names are a gap and are not invented here.

| Category | Required treatment | Rationale |
|---|---|---|
| Document body / content / version text | **strip** (must not appear) | "Do not include document text" |
| Emails | **strip** | "Do not include … emails" |
| Auth tokens, API keys, session secrets, encryption keys, salts, ID-mapping tables | **strip** (must not be exported) | Tokenization keys stay on the DBA side |
| Raw identifiers (legacy KB IDs, tenant IDs, user IDs, space IDs, raw aliases, raw names) | **tokenize** (`syn_…`) or omit; never plaintext | "Do not include … tokens or raw identifiers" in the aggregate product; tokenized only in Product B if later authorized |
| Phone numbers, postal addresses, and other direct PII not listed as permitted fields | **strip** | Not a permitted field in either source contract |
| Connection strings, credentials, cluster secrets | **redact** from `scope_description` | B2-3 mapping |
| Proposed target Space / KB assignments made by an export script | **forbidden** until an official ruling; fields stay `null` | B2-3 mapping |

## 2. Official export format for a future authorized AUTH-V21-04 export

This is a layout specification only. No file below has been produced from production data.

### 2.1 Packaging (when later authorized)

Suggested (not executed) layout:

```
pre03-auth-v21-04-export/
  README.txt                         # authorization identifier, generated_at, scope_description
  pre03-aggregate-only.json          # Product A (required)
  pre03-token-rows.json              # Product B (optional; only if separately approved)
  SHA256SUMS.txt                     # hashes of the JSON artifacts, not of itself
```

Encoding: UTF-8, LF newlines, JSON objects with `additionalProperties` rejected by the checker for Product B. Product A should likewise be a single JSON object (no CSV of raw IDs). Filenames are suggestions inherited from the B2-3 mapping (`pre03-aggregate-only.json`) plus a clearly separate token-row file so aggregate counts are never stuffed into the `additionalProperties: false` Product B object.

### 2.2 Product A schema (Team B; not a signed JSON Schema file in-repo)

```json
{
  "generated_at": "<ISO-8601 with explicit timezone, e.g. 2026-11-28T16:00:00+08:00>",
  "scope_description": "<logical environment name only>",
  "tenant_count": 0,
  "null_tenant_kb_count": 0,
  "null_tenant_document_count": 0,
  "null_tenant_version_count": 0,
  "kb_count": 0,
  "team_count": 0,
  "collaboration_group_count": 0,
  "favorites_estimate": 0,
  "favorites_estimate_note": "<optional; required if favorites cannot be counted from server tables>",
  "legacy_alias_collision_count": 0,
  "name_or_id_collision_count": 0,
  "integrity": {
    "scan_complete": true,
    "paginated": false,
    "unclassifiable_row_count": 0
  }
}
```

Integer fields are aggregates only. If a count cannot be derived from permitted metadata, the exporter must say so rather than invent a number. This schema is a specification assembled from named fields in the Team B request and B2-3 mapping; there is no in-repo openbot-vp JSON Schema file for Product A at isolation HEAD `d7b86a1b`.

### 2.3 Product B schema

Exactly the archived candidate schema (`format=candidate-pre03-v1`, `sanitized=true`, `provenance` enum, `rows` maxItems 10000, each row the six fields above, `additionalProperties: false`). If more than 10000 rows are later authorized, they must be sharded with a cross-shard collision note; silent truncation is forbidden. `proposed_space_id` / `proposed_kb_id` stay `null` until an official allocation ruling.

## 3. Zero-PII automated validation rules

A future checker must **reject** a candidate export if any of the following is true. These rules are for a later authorized AUTH-V21-04 artifact; they are not a license to produce one now.

1. File contains document body, HTML/Markdown content fields, or attachment bytes / filenames that are not in the permitted field lists.
2. File contains an email address pattern (e.g. RFC-style `local@domain`) or a telephone-number pattern in any string value.
3. Product A contains any object key other than the permitted aggregate fields, or any string that looks like a raw business identifier used as a row key.
4. Product B `format` ≠ `candidate-pre03-v1`, or `sanitized` ≠ `true`, or `provenance` not in `{SYNTHETIC_EXAMPLE, SANITIZED_CANDIDATE}`.
5. Any Product B identifier field is a non-null string that does not match `^syn_[A-Za-z0-9_-]{1,64}$`.
6. Product B contains additional properties at the root or row level.
7. Product B `rows.length` > 10000 without an accompanying shard manifest and cross-shard collision statement.
8. Product B sets `proposed_space_id` or `proposed_kb_id` to a non-null value without a later official allocation ruling on file.
9. Export includes keys, salts, mapping tables, connection strings, or credentials.
10. Product A integer fields are missing while the README claims a complete scan, or `integrity.scan_complete` is true while `unclassifiable_row_count` is unexplained and non-zero in a way that contradicts completeness (checker should flag this for human review).
11. Any real tenant / user / email / phone sample is labeled as a "mock" but is not prefixed `syn_` / not obviously fictitious. Mocks in this specification use only `syn_` tokens and obviously fake aggregates.
12. Provenance claims `SANITIZED_CANDIDATE` while AUTH-V21-04 is still unissued — a checker used **today** must accept only `SYNTHETIC_EXAMPLE` mocks.

## 4. AUTH-V21-04 named-recipient vacancy table

All slots below are **VACANT**. No recipient name, DBA name, or responsible-person name is invented. PRE-03 / EXT-02 packages must not be sent until these slots are officially filled and AUTH-V21-04 is issued.

| Slot | Role | Name | Organization / team | Sign-off (date, signature) | Status |
|---|---|---|---|---|---|
| EXT-02 receiving DBA / data steward | Production-metadata read-only authorized DBA; executes a future authorized export | _VACANT — do not invent_ | _VACANT_ | _VACANT_ | vacant |
| EXT-02 request channel | Official delivery channel (email / ticket) for the DBA request | _VACANT — do not invent_ | _VACANT_ | _VACANT_ | vacant |
| Owner / authorizing official | Issues AUTH-V21-04 in writing | _VACANT — do not invent_ | _VACANT_ | _VACANT_ | vacant |
| Team B responsible person (countersign) | Confirms this specification and future artifact checks | _VACANT — do not invent_ | _VACANT_ | _VACANT_ | vacant |
| Team A responsible person (countersign, if required later) | Joint contract sign-off, if later required | _VACANT — do not invent_ | _VACANT_ | _VACANT_ | vacant |
| Legal / privacy reviewer (if required later) | Privacy review of a future authorized export | _VACANT — do not invent_ | _VACANT_ | _VACANT_ | vacant |

This table is the only AUTH-V21-04 recipient artifact produced in W4B-1. No package is addressed or sent.

## 5. Synthetic / anonymized mock samples (examples only)

The following objects are **examples**. They are not production payloads, not tenant data, and not the result of any database query. All identifiers use the `syn_` prefix. Do not treat these numbers as real counts.

### 5.1 Product A mock (`provenance` implied: specification example)

```json
{
  "generated_at": "2026-11-28T16:00:00+08:00",
  "scope_description": "SYNTHETIC_EXAMPLE: fictional non-production cluster name lab-mock-cluster (no connection string)",
  "tenant_count": 3,
  "null_tenant_kb_count": 1,
  "null_tenant_document_count": 2,
  "null_tenant_version_count": 2,
  "kb_count": 5,
  "team_count": 2,
  "collaboration_group_count": 1,
  "favorites_estimate": 0,
  "favorites_estimate_note": "SYNTHETIC_EXAMPLE: favorites not counted from any server table; placeholder zero with explicit note",
  "legacy_alias_collision_count": 1,
  "name_or_id_collision_count": 0,
  "integrity": {
    "scan_complete": true,
    "paginated": false,
    "unclassifiable_row_count": 0
  }
}
```

### 5.2 Product B mock (unsigned candidate shape; SYNTHETIC_EXAMPLE only)

```json
{
  "format": "candidate-pre03-v1",
  "sanitized": true,
  "provenance": "SYNTHETIC_EXAMPLE",
  "rows": [
    {
      "legacy_kb_id": "syn_kb_example_001",
      "tenant_id": "syn_tenant_example_aaa",
      "proposed_space_id": null,
      "proposed_kb_id": null,
      "alias_token": "syn_alias_example_alpha",
      "name_token": "syn_name_example_alpha"
    },
    {
      "legacy_kb_id": "syn_kb_example_002",
      "tenant_id": null,
      "proposed_space_id": null,
      "proposed_kb_id": null,
      "alias_token": "syn_alias_example_alpha",
      "name_token": "syn_name_example_beta"
    }
  ]
}
```

The repeated `alias_token` in the two mock rows is an **example** of how a stable token can represent an alias collision without exporting the raw alias. These rows are fictional.

## 6. Closing reminders

- AUTH-V21-04 is not issued. Gate 4 / Gate 5 / Gate 6 remain NOT_MET.
- This specification does not authorize an export, a production read, Schema v7 DDL, a PR to main, or a message to Team A or any DBA.
- Default feature flags stay false. Controlled Data Bridge remains unauthorized.
