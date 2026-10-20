# Stage 3.1 — Four-tab SoT gap-close (stacked on stage30)

Closes remaining Me gaps where Web already exposes mobile-callable APIs/flows, and re-audits Chat / Tasks / Knowledge vs SoT + Web.

## Me closes

| Gap (#275) | Action | Web cite |
| --- | --- | --- |
| Identity add wizards | Buttons open Employee Shell「我的」embed (`onOpenEmployeeWorkbench`) / `#operational-identity` — no dead-end | `workbench-operational-identity-forms.ts`, `app-settings.ts` `#operational-identity` |
| Model catalog | `employee-model-access.summary` → 可用模型 rows | `MODEL_AUTHORIZATION_ENDPOINTS.employeeSummary`, `employee-model-access-section.ts` |
| `agents.create` / workspace | Managed local path: `workspaces.create` → `agents.create` (workspace required) → `robots.bind-workspace` | `render-model-workbench-actions.ts` |
| Account/password write | `EmployeeAuthClient.changePassword` → `/__openbot/platform-auth/password/change` | `platform-auth.ts` `changePlatformAuthPassword` |
| Group roster / invites | Parse `members.humans/bots` from `collaboration.spaces.list`; invite via `members.update` `invites.humans` | `spaces.ts`, `collaboration-group-members-table.ts` |

## Per-tab audit (after this pass)

### Chat
| Item | Status | Why |
| --- | --- | --- |
| Drag-reorder agent strip | **Still intentional gap** | Production Web does not persist strip order |
| Mic → voice bubble | **Still intentional gap** | Production Web chat mic is disabled; TalkMode under 我的→语音 |
| Send → stop square | **Closed earlier (#272)** | `chat.abort` while pending |
| Knowledge capsule parity | **Closed earlier (#272/#274)** | Shared catalog / selection APIs with Knowledge tab |

### Tasks
| Item | Status | Why |
| --- | --- | --- |
| Full cron wizard | **Still intentional gap** | Multi-step AI/templates/bindings are Web-only; phone keeps reduced `cron.add` |
| 任务成果预览 | **Still intentional gap** | Production Web assigned-tasks center also has no result preview panel |
| Filters / bulk | **Still intentional gap** | Desktop cron filters; no mobile-relevant Web equivalent |

### Knowledge
| Item | Status | Why |
| --- | --- | --- |
| 收藏 funnel | **Closed (client prefs)** | Mirrors Web `knowledge-universe-ui-prefs` favoriteKnowledgeBaseIds |
| HTML preview fidelity | **Improved** | `html` from `knowledge.document.preview` → WebView; plain/markdown fallback |
| Create/rename/⋯ | **Still intentional gap** | Cockpit tree menus invent mobile write UX without a thin shared API surface on phone |
| `knowledge.search` | **Closed** | Server search when query ≥2 chars (Web home command bar) |

## Test

- `./gradlew :app:compileDebugKotlin`
- `./gradlew :app:testDebugUnitTest --tests ai.openbot.app.ui.MeHubModelsTest --tests ai.openbot.app.ui.KnowledgeBrowserModelsTest --tests ai.openbot.app.employeeauth.EmployeeAuthChangePasswordBodyTest`
