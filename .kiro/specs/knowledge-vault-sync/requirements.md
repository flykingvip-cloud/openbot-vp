# Requirements — Knowledge Vault Sync（同步仓库）

Date: 2026-07-22  
Status: P0 基线（待评审）；**入口 IA 于 2026-07-23 最终决策后修订**  
Product name: OpenBot 同步仓库（Vault Sync）  
Agent: cursor-vault-sync

> **Product entry（最终，2026-07-23）**：Vault Sync **能力保留**；当前「录入知识」页面 **不提供 Vault 入口**（`TBD / 暂不开放`）。  
> 「本地文件夹」tab **不属于** Vault；固定 `managed_push`（明文 Gateway 同步，非 E2EE），由 Import IA（`knowledge-workbench-import-ia:kiro-web-ui`）收口。  
> **历史**：中间「方案 A」（Vault 并入本地文件夹·同步方式三档）已 **superseded / 废止** —— 见 `docs/design/openbot-knowledge-vault-sync-import-entry-merge-alignment-2026-07-23.md` §9。  
> 在新入口确定前：**不得**经 `importKind="vaultSync"`、高级设置、隐藏按钮或模式选择器向产品用户暴露 Vault。

## 1. Problem

知识工作台需要类似 Obsidian Sync 的跨设备本地 Vault：本地优先、端到端加密、增量同步、版本历史、冲突处理与选择性同步。外部云盘导入（百度/阿里/夸克）是另一条能力，不得与 E2EE Vault 混淆。

## 2. Non-goals（不可违反）

1. 同步对象是本地 Vault **文件**，不是 Knowledge Runtime 的 SQLite / Embedding / 派生索引。
2. E2EE 模式下服务器只能看到密文、设备游标、配额与必要路由元数据。
3. E2EE 模式下服务器不得生成全文索引、Embedding、摘要或 RAG。
4. Knowledge Runtime 仅在解密后的可信设备或企业自托管 Gateway 上构建。
5. 「私密同步」(E2EE) 与「企业托管知识」必须是两个明确模式，不得混淆安全承诺。
6. 不以 Syncthing / rsync / 通用云盘作为产品核心。
7. 不以 CouchDB 存明文文档。
8. P1 不引入 Automerge / Yjs / 其他 CRDT；先做文件级修订 + 三方合并。
9. 不自行实现未经审计的密码学原语。
10. 不修改 `pnpm.patchedDependencies`，不更新 Carbon。
11. **不**把 Vault 挂回当前「录入知识 → 本地文件夹」；不把 `managed_push`（明文）说成 E2EE Vault。
12. **不**在验收中声称「录入知识已交付 Vault UI」或「本地文件夹云端同步闭环已完成」（后者属 Import IA 核实范围）。

## 3. User-facing capabilities

| ID  | Requirement                                                                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | **产品入口 = TBD / 暂不开放**。Vault Sync 协议/客户端/设备/团队能力继续保留；当前「录入知识」仅 4 tab（本地文件夹 / 网页 / 笔记 / 主动源），**无** Vault tab、**无**同步方式选择器、**无**从本地文件夹进入 Vault 的路径。外部云盘仍在「外部来源导入」。 |
| R1a | **边界**：`managed_push`（本地文件夹，明文 Gateway，非 E2EE，Import IA）≠ Vault Sync（客户端 E2EE + 设备/团队）。二者不得共用产品入口或混用安全承诺文案。                                                                                               |
| R2  | 新建同步仓库 / 打开本地仓库 / 连接远程仓库（协议与表单组件可保留；**产品暴露入口待定**）                                                                                                                                                                |
| R3  | 独立同步密码解锁（非账户密码）；恢复码；设备撤销                                                                                                                                                                                                        |
| R4  | 选择性同步：文件夹、图片、音频、视频、PDF、其他附件                                                                                                                                                                                                     |
| R5  | 同步状态：已同步、同步中、离线、冲突、错误、暂停                                                                                                                                                                                                        |
| R6  | 设备管理、同步日志、版本历史、恢复已删文件                                                                                                                                                                                                              |
| R7  | 文本三方合并；不安全时 conflict copy；二进制禁止自动合并                                                                                                                                                                                                |
| R8  | 所有新文案使用 OpenBot；更新 en + zh-CN i18n（不直接改 `docs/zh-CN`）                                                                                                                                                                                   |

## 4. Protocol requirements

| ID  | Requirement                                                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------- |
| P1  | 不可变 `FileRevision`（含 vaultId / opaquePathId / revisionId / parentRevisionIds / deviceSequence / E2EE 字段 / tombstone） |
| P2  | 每设备 `deviceSequence` 单调递增；`revisionId` 稳定、可验证、幂等                                                            |
| P3  | 服务端用 `parentRevisionIds` 检测分叉，不读内容                                                                              |
| P4  | 删除用 tombstone；历史可恢复                                                                                                 |
| P5  | WebSocket 只通知 cursor/revision；Blob 走批量 HTTP / 对象存储                                                                |
| P6  | commit API 支持幂等键、断点续传、失败重试                                                                                    |
| P7  | 不同步 SQLite、临时文件、锁文件、Knowledge Runtime 派生物                                                                    |

## 5. Cryptography requirements

| ID  | Requirement                                                                               |
| --- | ----------------------------------------------------------------------------------------- |
| C1  | 每 Vault 独立同步密码 + 随机 salt                                                         |
| C2  | 内存困难 KDF → base key → HKDF 分离 content / metadata / path-lookup / manifest-auth keys |
| C3  | 认证加密 + AAD 绑定 vaultId、opaquePathId、revisionId、encryptionVersion                  |
| C4  | 真实路径与文件名加密；opaquePathId 为带密钥不可逆标识                                     |
| C5  | 设备密钥存 Keychain / Keystore；Web UI 不得把 Vault 密钥写入 localStorage                 |
| C6  | 固定测试向量 + 篡改 / 错误密码 / nonce 唯一性测试；fail closed                            |

## 6. Acceptance gates（摘录）

详见设计文档 §验收。关键门槛：离线编辑后多设备一致；泄漏密文无法还原路径/内容；错误密码与篡改 fail closed；幂等重试不重复历史；并发不静默覆盖；删除可恢复；≥10k 文件分页 inventory（禁止 500 静默截断）；≥200MB 附件不走 Gateway WebSocket Base64；E2EE 云端无明文；同步后本地 Runtime 增量更新。

## 7. Phasing

- **P0** 协议 + 威胁模型 + 合约（本文件 + design）— 评审前不大规模实现
- **P1** 桌面双设备 MVP
- **P2** WebSocket / 历史 / 选择性同步 / 设备撤销 / 分块上传
- **P3** 移动端适配
- **P4** 团队 Vault（成员密钥封装）；仅真实多人同文档协作后再评估 CRDT
