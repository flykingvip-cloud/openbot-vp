# ATTRIBUTION

## Origin

OpenBot remodeled skill based on upstream **Tencent Survey (腾讯问卷)** MCP skill
concepts: create/query/update question & logic, list answers, device OAuth setup.
Frontmatter `name` matches directory `tencent-survey`.

## License

Upstream `LICENSE` (MIT, Copyright (c) 2025 Tencent) retained in this skill tree.

## No proprietary dump claim

OpenBot platform adaptation for `openbot/skills/`. API access uses the operator's
`TENCENT_SURVEY_TOKEN` or OAuth device flow against documented wj.qq.com endpoints.

## Kept

- `setup.sh` (skill root + `scripts/` mirror)
- Full `references/` tool docs and auth guide
- MIT LICENSE

## Intentionally omitted or neutralized

- `workbuddy.json` packaging (non-required; display strings noted here only:
  腾讯问卷 / Tencent Survey)
- Required third-party CDN icons (none shipped)

## Boundary note

No overlap with office cores for generic documents/spreadsheets analytics.
Platform-specific survey CRUD stays in this skill only.
