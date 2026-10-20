# OpenBot capabilities to toolkit catalog toolId

Phase 1 wraps and aligns existing OpenBot surfaces with the portable catalog.
It does not rip out or replace shipping tools.

| Catalog toolId    | OpenBot capability / surface (examples)                                                     | Notes                                  |
| ----------------- | ------------------------------------------------------------------------------------------- | -------------------------------------- |
| workspace         | src/agents/apply-patch.ts, workspace browse/file APIs, docs tools/apply-patch.md / diffs.md | Search/read/write/patch/diff           |
| shell             | src/infra/exec-\*.ts, docs tools/exec.md, elevated/sandbox exec                             | Controlled command execution           |
| web               | src/agents/tools/web-tools.ts, web-search.ts, web-fetch.ts, docs tools/web.md               | Search + fetch with citations          |
| mcp-connectors    | MCP/plugin tool invoke, docs/tools/plugin.md, AOR ToolInvoker / plugin skills               | External tool discovery and calls      |
| approval          | src/infra/exec-approvals\*.ts, docs tools/exec-approvals.md                                 | Approval before consequential actions  |
| receipt           | src/infra/execution-chain-provenance.ts, skill execution-chain-audit                        | Auditable start/evidence/complete/fail |
| browser           | src/agents/tools/browser-tool.ts, docs tools/browser.md                                     | Navigate / inspect / act / screenshot  |
| computer-use      | skill peekaboo, nodes-tool, desktop automation                                              | Desktop/UI when no structured API      |
| office-artifacts  | pdf-tool, skills documents / office-automation-core / nano-pdf, docs tools/pdf.md           | Docs, sheets, decks, PDF               |
| automation        | cron-tool, schedule-tool                                                                    | Recurring / delayed workflows          |
| visualization     | skills visualize, canvas / cursor-canvas, canvas-tool                                       | Charts, diagrams, dashboards           |
| task-coordination | sessions spawn/send tools, subagents, organization-tasks, AOR orchestration                 | Long-running / parallel / handoff      |

## Combinations

| Combination id                  | Catalog tools                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------------- |
| minimum-tool-kernel             | workspace, shell, web, mcp-connectors, approval, receipt                           |
| office-workbench                | workspace, web, mcp-connectors, office-artifacts, visualization, approval, receipt |
| automation-operations           | automation, mcp-connectors, task-coordination, approval, receipt                   |
| interactive-application-control | browser, computer-use, approval, receipt                                           |

Skills select a combination, resolve via ToolRegistry, then (Phase 2) Policy to Approval before Execution, and always emit a Receipt.
