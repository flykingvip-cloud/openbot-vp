# Deep research report checklist

Use with skill `finance-research` playbook B.

## Artifacts (workspace-relative)

```
output/finance/<symbol>/
  market.json
  news.json
  report.md
  manifest.json
```

## Manifest fields

- `run_id`, `symbol`, `created_at` (ISO UTC)
- `sources[]` with url + fetched_at
- `checksums` SHA256 for each artifact file

## Quality bar

- Every numeric claim cites market.json field or news URL
- Unknowns listed explicitly
- No trade recommendations
