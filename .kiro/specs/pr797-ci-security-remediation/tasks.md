# PR797 CI 与生产依赖安全整改

## Agents

- cursor · role: owner · scope: 生产依赖 high/critical 最小升级与 PR #797 CI 失败证据（不接管无关任务、不改 ruleset、不绕过分支保护） · paths: .kiro/specs/pr797-ci-security-remediation/\*\*, docs/design/evidence/pr797-ci-security-remediation\*, extensions/diagnostics-otel/package.json, extensions/matrix/package.json, pnpm-lock.yaml · since: 2026-08-29

## Scope

- 独立安全整改分支，不把依赖升级混入 PR #797 两份治理文档。
- Labeler / label-issues：仓库 App 私钥缺失，属基础设施，不改工作流。
- check-docs：242 条为主干既有文档债，不在本任务批量改无关 docs。
