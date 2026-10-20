# ATTRIBUTION

## Origin

OpenBot remodeled skill based on upstream **Tencent Meeting MCP skill** concepts
(meeting lifecycle, recording/transcript/smart minutes, feedback & privacy rules).
Directory renamed `tencent-meeting-skill` → `tencent-meeting` so frontmatter `name`
matches the skill folder.

## No proprietary dump claim

This is an OpenBot platform adaptation for `openbot/skills/`, not a claim of
ownership over Tencent Meeting product APIs. Runtime calls use the user's own
`TENCENT_MEETING_TOKEN` against documented MCP endpoints.

## Kept

- Python MCP proxy scripts under `scripts/`
- `config.json` baseUrl
- Privacy / feedback / error / version references (user-protection rules retained)

## Intentionally omitted or neutralized

- `workbuddy.json` / CodeBuddy `skill-card.md` packaging (non-required for OpenBot)
- Required third-party CDN icon URLs (`openplatform-cdn.codebuddy.cn`); optional branding not shipped
- Workbuddy-only display metadata as runtime dependency

## Boundary note

Generic agendas, minutes, action items, and email drafts belong to
`meeting-communication-core`. This skill is Tencent Meeting API/MCP only.
