# localFolder 被动连接器 复检整改清单（部署前）

Date: 2026-07-14
Status: 待工程执行
作者: 复检方（只读代码复检产出）
复检对象分支: `release/candidate-20260712`
整改落地分支: `release/candidate-20260712`（同分支；本清单不在该分支上，需工程侧执行）
关联文档:

- 设计基线: `docs/design/openbot-knowledge-runtime-source-connector-2026-07-14.md`
- 实现自验收: `docs/design/openbot-localfolder-passive-connector-acceptance-request-2026-07-14.md`

---

## 0. 复检结论回顾

代码级复检**通过**：P0–P5 净新增能力完整落地，验收红线（消费边界 / 路径不出云 / RPC 边界 / 不复活隐式收件箱）全部守住，chunk 级 delta 的向量零重嵌保留、三层模型、两轮内审修复均已到位。未发现正确性缺陷。

本清单只收录**非阻塞跟进项**。其中 R1 建议作为「对外开放外部文件夹路径」的**灰度前置条件**，其余可随迭代处理。

**复检局限（需工程补齐）**：复检为只读代码审阅，**未实跑** `pnpm build` / `pnpm tsgo` / vitest（受多 agent 不切分支约束）。见 R6。

---

## 1. 整改项

### R1 [中·隐私] 密钥扫描与出网告知只做了部分

- **现状**：入库过滤仅靠扩展名白名单（`SUPPORTED_EXTENSIONS`，`src/gateway/knowledge/personal-document-upload.ts`）+ 用户 exclude glob。`.env` 类无扩展名文件会因 mime 落到 `application/octet-stream` 被跳过；但 `.txt/.md/.csv` 内**含密钥的正文**仍会被抽取、切块、向量化并（managed / 第三方 embedding 时）离开本机。无内容级密钥检测，无「哪些内容会离开本机」的显式告知。
- **风险场景**：本能力的头号诉求是「连接外部文件夹（如 `D:\销售资料`）」，走 `allowOutsideDataRoot: true`（`src/gateway/knowledge/sources/local-folder-path-policy.ts`）。域内默认限定在 Data Space（`~/OpenBot`）已降低风险，域外开关一旦对真实用户开放，密钥/隐私外泄面显著扩大。设计文档 §4.2 将此列为上线红线。
- **建议修复**：
  1. 在 `scanLocalFolderBinding` / sync.commit 的读取入口加内容级密钥扫描（可复用仓库 `.detect-secrets.cfg` 规则），命中则跳过并计入 `skipped` + 原因。
  2. embedding provider 为远程时，在绑定 UI（`ui/src/ui/views/knowledge-universe-space-import-local-folder.ts`）显式告知「正文将发送至 \<provider\> 以生成向量」，并在 `allowOutsideDataRoot` 勾选处二次确认。
  3. 提供「仅本地 embedding」选项路径（若配置支持）。
- **验收**：含密钥的样例 `.txt` 不入索引；远程 embedding + 外部路径绑定时 UI 出现出网告知与二次确认。
- **时机**：**对外开放外部路径前必须**（灰度前置）。

### R2 [中·容量] 大文件夹静默截断

- **现状**：`LOCAL_FOLDER_SCAN_MAX_FILES = 500`（`src/gateway/knowledge/sources/local-folder-runtime.ts`）。超出后 `walkLocalFolderFiles` 置 `truncated=true` 并停止，但无续扫 / 分页；UI 未必透出。上千文件的文件夹会**静默漏文件**，与「连接大文件夹」诉求冲突。
- **建议修复**：
  1. `LocalFolderScanSummary.truncated` 透传到 `status` 并在 UI 明确提示「已扫描前 N 个，还有未索引文件」。
  2. 提供续扫 / 分批（按目录或按 mtime 游标）或可配置上限（带资源上限保护）。
- **验收**：>500 文件目录连接后，UI 显示截断态；续扫可覆盖剩余文件。
- **时机**：GA 前。

### R3 [低·回归防护] 消费边界缺 localFolder 显式用例

- **现状**：`src/gateway/knowledge/knowledge-consumption-boundary.test.ts` 未新增 localFolder / passive-connector 用例；边界目前靠 `local-folder-types.test.ts`、`passive-connector.test.ts` 的 plane 单测（已断言 passive）兜底。
- **建议修复**：在 boundary 测试补一条：localFolder / gitRepo / cloudDrive / mailAttachment 均不触发 active 连接器（enterprise-data 等）的 live 调用。
- **验收**：新用例通过；未来把某新 kind 误加入 `ACTIVE_SOURCE_KINDS` 会红。
- **时机**：随迭代。

### R4 [低·硬化] path-policy 未解析符号链接

- **现状**：`assertLocalFolderRootPathAllowed` 用 `path.resolve`（不解析 symlink）。指向 Data Space 外的**符号链接根目录**可能绕过前缀判定。（walk 阶段子级 symlink 已安全跳过，仅根路径这一处。）
- **建议修复**：对 root 先 `fs.realpathSync` 归一，再做 Data Space 前缀判定；不存在路径给明确错误。
- **验收**：软链指向域外时按域外处理（需 `allowOutsideDataRoot`）。
- **时机**：随 R1 一起做。

### R5 [低·可读] walk 目录排除逻辑冗余

- **现状**：`walkLocalFolderFiles` 内目录排除分支（`isPathIncluded(..., includeGlobs:["**/*"])` 外层 + 内层再 `excludeGlobs.some(...)` 三变体）功能正确但重复、难读。
- **建议修复**：抽一个 `isDirExcluded(relativePath, excludeGlobs)` 直接判定并 `continue`。
- **验收**：现有 `local-folder-runtime.test.ts` 仍绿；排除行为不变。
- **时机**：随手清理。

---

## 2. 流程 / 门禁项

### R6 [必做] 部署前自动化门禁（需在实现分支执行）

在 `release/candidate-20260712` 上执行（复检方受多 agent 不切分支约束未跑）：

```bash
pnpm build
pnpm tsgo
pnpm exec vitest run \
  src/gateway/knowledge/sources/local-folder-runtime.test.ts \
  src/gateway/knowledge/sources/local-folder-watcher.test.ts \
  src/gateway/knowledge/sources/local-folder-sync.test.ts \
  src/gateway/knowledge/sources/local-folder-path-policy.test.ts \
  src/gateway/knowledge/sources/passive-connector.test.ts \
  src/gateway/knowledge/chunk-delta.test.ts \
  src/gateway/knowledge/kb-ingest.test.ts \
  src/gateway/knowledge/document-obsidian-extract.test.ts \
  src/gateway/knowledge/runtime/explicit-graph-enrichment.test.ts \
  src/gateway/knowledge/timeline-read-model.test.ts \
  ui/src/ui/views/knowledge-universe-space-import.node.test.ts
```

- **验收**：build / tsgo / 上述 vitest 全绿。

### R7 [跟踪] 明确延期项（非缺陷，验收文档 §5 已声明）

- 远端 Git / 云盘 / Mail 真实 list-fetch 适配器（当前 `ready=false` 脚手架，可 bind + plan/commit，无 OAuth/爬取）。
- 桌面端 managed_push 推送 Agent（合约已具备，客户端组件另立项）。
- chunk 多版本并行存档（P4 当前稳定 anchor 重写当前槽；`document_versions` 保留文档级历史）。

---

## 3. 优先级建议

| 项                             | 严重度 | 时机                           |
| ------------------------------ | ------ | ------------------------------ |
| R6 门禁                        | 必做   | 提交/构建镜像前                |
| R1 隐私（密钥扫描 + 出网告知） | 中     | 对外开放外部路径前（灰度前置） |
| R4 realpath 软链               | 低     | 随 R1                          |
| R2 大文件夹截断                | 中     | GA 前                          |
| R3 边界回归用例                | 低     | 随迭代                         |
| R5 walk 可读性                 | 低     | 随手                           |
| R7 延期项                      | 跟踪   | 另立项                         |
