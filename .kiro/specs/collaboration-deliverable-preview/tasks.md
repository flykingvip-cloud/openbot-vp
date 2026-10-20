# Tasks: collaboration-deliverable-preview

## Agents

- cursor-unify-artifact-preview · role: owner · scope: 成果打开只走 artifact 侧栏，禁止闪到 markdown 工具输出 · paths: ui/src/ui/views/chat.ts, ui/src/ui/views/chat.test.ts, ui/src/ui/views/artifact-sidebar.ts, ui/src/ui/wiring/workspace-file-preview.ts, ui/src/ui/wiring/workspace-file-preview.node.test.ts, ui/src/ui/wiring/steward-workspace-file.ts, ui/src/ui/wiring/steward-deliverable-preview.node.test.ts, ui/src/ui/wiring/group-workspace-file.ts, ui/src/ui/wiring/group-deliverable-preview-flow.ts · since: 2026-08-20
- kiro-html-artifact · role: contributor · scope: HTML 成果路径识别、会话工作区读取、安全预览与 Fly app 标识更正 · paths: `.kiro/specs/collaboration-deliverable-preview/tasks.md`, `fly.toml`, `fly.private.toml`, `src/shared/preview-artifact/deliverable-envelope.ts`, `src/shared/preview-artifact/resolve-preview-artifact.ts`, `ui/src/ui/chat/deliverable-envelope.ts`, `ui/src/ui/chat/generated-preview-artifact.ts`, `ui/src/ui/controllers/steward-workspace-file.ts`, `ui/src/ui/wiring/steward-workspace-file.ts`, `ui/src/ui/wiring/group-deliverable-preview-flow.ts`, `src/gateway/server-methods/steward-workspace-file.ts` · since: 2026-07-30
- cursor-composer · role: contributor · scope: 协作组成果预览/保存/组 workspace · paths: `src/gateway/knowledge/deliverables/group-manifest.ts`, `src/gateway/server-methods/group-workspace-file.ts`, `ui/src/ui/views/artifact-sidebar.ts` · since: 2026-07-24

## P5 HTML 成果预览闭环

- [x] 保留安全的 workspace 相对路径并识别 `.html` / `.htm` 成果 — kiro-html-artifact
- [x] 按当前会话 agent 工作区受控读取成果文件 — kiro-html-artifact
- [x] HTML 成果进入净化后的侧栏预览并保留下载降级 — kiro-html-artifact
- [x] 完成目标诊断、相关测试与构建验证 — kiro-html-artifact
- [x] 更正 Fly 部署 app 标识为 OpenBot，并保留兼容环境和数据卷 — kiro-html-artifact

## P0 基础设施

- [x] group-workspace-file RPC + pack 注册 — cursor-composer
- [x] UI 预览按 groupId 读组文件 — cursor-composer
- [x] capture identity groupId::logicalId + drafts 排除 — cursor-composer
- [x] 协作群 assistant 头像 senderLabel — cursor-composer

## P1 预览 Command Bar

- [x] artifact-sidebar：保存/编辑/分享 + 状态 chip — cursor-composer
- [x] 移除 download 主按钮 — cursor-composer
- [x] knowledge.deliverables.saveAndArchive RPC — cursor-composer
- [x] 移除 Stage 顶栏整理为草稿/整理本次能力 — cursor-composer

## P2 logicalId + manifest

- [x] 信封 `logicalId=` 解析（shared + UI） — cursor-composer
- [x] capture identity 优先 logicalId（group/owner scope） — cursor-composer
- [x] 协作组 envelope 写 `drafts/{logicalId}/` + manifest.drafts — cursor-composer
- [x] 协作组仅 envelope 触发 capture（on-deliverable-envelope） — cursor-composer
- [x] 保存 pin manifest.canonical + KB 标题 — cursor-composer
- [x] `workbench.group-manifest.read` + UI 重开预览恢复 chip — cursor-composer

## P3 预览区能力提醒

- [x] L2–L4 预览区底部条件提醒 + openSkillSave 接线 — cursor-composer

## P4 draft TTL + 组 checkpoint

- [x] manifest draft TTL（7 天）+ 晋升后清理 draft 树 — cursor-composer
- [x] 协作组 turn checkpoint 快照组 workspace + restore 对齐 — cursor-composer

## 验收修复（专家 D1–D5）

- [x] D1 `workbench.group-manifest.read` 写入 pack methods/scopes — cursor-composer
- [x] D2 组/steward 文件加载后 merge manifest chip，不再 infer 覆盖 — cursor-composer
- [x] D3 保存成功/失败 Toast（文案与 chip 一致） — cursor-composer
- [x] D4 协作组有 groupId 时跳过 steward fallback；manifest 路径优先 — cursor-composer
- [x] D5 组 checkpoint 集成测试：content-addressed snapshot + restore — cursor-composer
- [x] `deliverable-save.test.ts` 覆盖 merge / resolveGroupWorkspaceReadTarget — cursor-composer

## 余量项收尾

- [x] dirty 接线：inline 编辑后重启用保存 — cursor-composer
- [x] 无 KB 选择：仅 Toast 提示，chip 不变 — cursor-composer
- [x] logicalId 推断 `drafts/{slug}/content.md` 组路径 — cursor-composer
- [x] `save-and-archive.test.ts` 三合一集成测试 — cursor-composer
- [x] `artifact-sidebar-deliverable.test.ts` dirty/toast UI 单测 — cursor-composer
- [x] 清理 Stage 死代码 + `resolveGroupWorkspaceFilename` — cursor-composer
- [x] 修复 `save-and-archive.ts` agent-scope 导入路径 — cursor-composer
- [x] 补全 personal settings 缺失模块以恢复 stage 测试 — cursor-composer
- [x] `app.group-deliverable-preview.node.test.ts` 协作组预览 E2E（`openArtifactDeliverablePreview`：manifest → group-file.read → chip，不走 steward） — cursor-composer
