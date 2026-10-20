# Knowledge Workbench Import IA

## Agents

- kiro-web-ui · role: owner · scope: 收口“录入知识”四通道入口；本地文件夹固定 `managed_push` 云端同步，不暴露同步方式选择器，Vault 不从此入口进入 · paths: `.kiro/specs/knowledge-workbench-import-ia/**`, `ui/src/ui/views/knowledge-universe-space-import.ts`, `ui/src/ui/views/knowledge-universe-space-import.node.test.ts`, `ui/src/ui/views/knowledge-universe-space-import-local-folder.ts`, `ui/src/ui/views/knowledge-universe-space-import-passive-connector.ts`, `ui/src/ui/controllers/knowledge-universe-local-folder.ts`, `ui/src/ui/controllers/knowledge-universe-local-folder-upload.ts`, `ui/src/ui/controllers/knowledge-universe-local-folder.node.test.ts`, `ui/src/ui/controllers/knowledge-universe-personal-space.ts`, `ui/src/ui/controllers/knowledge-universe-personal-space.node.test.ts` · since: 2026-07-23
  登记来源：`.loom/registry.yaml` 中的 `knowledge-workbench-import-ia:kiro-web-ui`（session `530209E9-D3E3-42D3-8714-27D2BCD90ED0`，ide `kiro`）。本块是派生视图，改动请先走 `loom register`。

## Tasks

- [x] 保留 `本地文件夹 / 网页 / 笔记 / 主动源` 四个通道，移除同步方式选择器与 Vault 入口。
- [x] 本地文件夹入口固定提交 `managed_push`，不得因历史状态退回 `local_index`。
- [x] “录入知识”默认使用已有个人空间；没有个人空间时自动创建后提交导入。
- [x] 完成本地文件夹文件枚举、`sync.plan`、分批 `sync.commit` 和最终删除闭环。
- [x] 通过目标测试、格式与静态检查，并核对真实页面关键 DOM。

## Notes

- 上述实现已在本分支落地（`6c15798995` land WIP、`a9c9f30315` 修类型与 gateway client 接线、`efa3d6e6d4` 标记完成）。本轮仅收尾未提交的入口视图与用例，并删除不可达的 passive-connector 面板。— kiro-web-ui
- 归属边界：`ui/src/ui/ports/employee/views/home-page-contracts.ts` 当前归 `codex-v111-recovery (ops-decommission)` 且带未提交改动，本任务不修改；`.loom/registry.yaml` 为共享热文件，登记后不由本任务提交。— kiro-web-ui
- kiro-web-ui · role: owner · scope: 收口“录入知识”二级整页、本地文件夹固定云端同步、默认个人空间与四通道提交闭环 · paths: `.kiro/specs/knowledge-workbench-import-ia/**`, `ui/src/ui/capability/knowledge-universe/endpoints.ts`, `ui/src/ui/capability/knowledge-universe/gateway-client.ts`, `ui/src/ui/ports/employee/views/home-page-contracts.ts`, `ui/src/ui/controllers/knowledge-universe.ts`, `ui/src/ui/controllers/knowledge-universe-workspace.ts`, `ui/src/ui/controllers/knowledge-universe-local-folder*.ts`, `ui/src/ui/controllers/knowledge-universe-personal-space*.ts`, `ui/src/ui/controllers/knowledge-universe-note-import.ts`, `ui/src/ui/controllers/knowledge-universe-url-import.ts`, `ui/src/ui/controllers/knowledge-universe-connector-bind.ts`, `ui/src/ui/views/knowledge-universe-ui-prefs.ts`, `ui/src/ui/views/knowledge-universe-page.ts`, `ui/src/ui/views/knowledge-universe-library-workspace-page.ts`, `ui/src/ui/views/knowledge-universe-space-import.ts`, `ui/src/ui/views/knowledge-universe-space-import-local-folder.ts`, `ui/src/ui/views/knowledge-universe-space-import.node.test.ts`, `src/gateway/knowledge/explicit-metadata-store.ts`, `src/gateway/knowledge/knowledge-base-sources-list.ts`, `src/gateway/knowledge/sources/local-folder-*.ts`, `src/gateway/knowledge/sources/source-descriptor.ts`, `src/gateway/knowledge/sources/source-document-link-store.ts`, `src/gateway/server-methods/knowledge.ts` · since: 2026-07-23

## Ownership handoff

- 已核验 `knowledge-vault-sync:cursor-vault-sync`、`tenant-context-propagation:kiro` 与 `knowledge-data-closure-audit:grok` 的目标路径均无未提交改动，原会话已停止或无活动会话；仅将本任务实际修改的 UI contract/client/workspace、knowledge handler 与 local-folder backend 路径转入当前 owner，其余前序范围保持不变。— kiro-web-ui
- [ ] 保留 `本地文件夹 / 网页 / 笔记 / 主动源` 四个通道，移除同步方式选择器与 Vault 入口。
- [ ] 本地文件夹入口固定提交 `managed_push`，不得因历史状态退回 `local_index`。
- [ ] “录入知识”默认使用已有个人空间；没有个人空间时自动创建后提交导入。
- [ ] 完成本地文件夹文件枚举、`sync.plan`、分批 `sync.commit` 和最终删除闭环。
- [ ] 通过目标测试、格式与静态检查，并核对真实页面关键 DOM。
