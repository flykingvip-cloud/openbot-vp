# Tasks: Collaboration Human Mentions

## Agents

- `cursor-human-mentions` · role: owner · scope: human mention protocol + UI + notifications · paths: `.kiro/specs/collaboration-human-mentions/**`, `src/organization/mention-*`, `src/organization/human-mention-notifications*`, `src/organization/runtime.ts`, `src/gateway/protocol/schema/logs-chat.ts`, `src/gateway/server-methods/chat.ts`, `src/gateway/server-methods/workbench.ts`, `src/gateway/workbench/pending-tasks-read-model.ts`, `ui/src/ui/app-render.ts`, `ui/src/ui/app-chat.ts`, `ui/src/ui/components/mention/**`, `ui/src/ui/controllers/chat.ts`, `ui/src/styles/chat/**` · since: 2026-07-21

## Status

- [x] Spec + Loom register / ownership handoff
- [x] Protocol MentionTarget + validator + runtime humans
- [x] Human mention notification store + pending-tasks + RPCs
- [x] UI candidates + send metadata + renderer muted
- [x] Tests green (mention/UI/chat/collaboration scoped vitest)
- [x] Browser acceptance fixture + screenshot
- [x] Commit `4918357f46` — cursor-human-mentions
- [x] Risk fixes: send opts typing, mention deep-link focus/scroll, `allowTransientCooldownProbe` typo, deep-link projection tests — cursor-human-mentions
