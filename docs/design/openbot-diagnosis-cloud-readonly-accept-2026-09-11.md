# OpenBot 云端智能诊断只读线上验收

Date: 2026-09-11

**结论：部分通过。**

不能输出「云端诊断代码、只读报告 API、诊断 RPC、权限隔离和 UI 投影验收通过。」

本次全程只读：未翻转 gate、未生产 build/publish/restart、未灰度、未发真实大白消息、未执行修复、未改 ledger / RELEASE_RECORD / provenance、未提交 `.loom/registry.yaml`。

---

## 1. 发布身份

| 项                                                        | 结果                                                                           |
| --------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `git fetch origin` 后 `origin/main`                       | `79f2d5f57b9170877e24e40b76bb8982f63e4bb1`                                     |
| 预期 LIVE                                                 | 同 SHA，未变化，验收继续                                                       |
| 容器 `openbot-gateway-rc` `/app/dist/build-info.json`     | commit 同 SHA，version `2026.7.12-rc.2`                                        |
| `bun scripts/ops/l3-live-snapshot.ts --json --check`      | exit 0                                                                         |
| `deploy/production/scripts/verify-live-image-identity.sh` | PASS，OCI revision 同 SHA                                                      |
| healthz                                                   | 200 `{ok:true,status:live}`                                                    |
| readyz                                                    | `ready:true`                                                                   |
| 18789                                                     | 容器持有                                                                       |
| 回滚                                                      | `openbot-gateway-rc-prev-d537f2fdce-safety` / `rc-amd64-provenance-d537f2fdce` |
| Gateway 与 UI                                             | 同一 bundle `index-tvycM9fL.js`（www / biz / admin / gw 均为 200）             |

快照：`docs/design/openbot-diagnosis-cloud-readonly-accept-l3-2026-09-11.json`  
身份：`docs/design/openbot-diagnosis-cloud-readonly-accept-identity-2026-09-11.md`

---

## 2. 诊断能力与 gate

LIVE SHA 与 `origin/main` 相同，编译期四门与已批准的 P24.8 记录一致，**未在本任务中修改**：

| Gate                                      | P24.8 批准后 | LIVE 源码 |
| ----------------------------------------- | ------------ | --------- |
| `DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED`   | true         | true      |
| `DIAGNOSIS_REPORT_API_DEPLOYED`           | true         | true      |
| `DIAGNOSIS_DAIBAI_DELIVERY_ENABLED`       | true         | true      |
| `DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED` | true         | true      |

容器内无 `DIAGNOSIS_*` / `OPENBOT_DIAGNOSIS_*` 环境变量覆盖。

Live pack `diagnosis-reports` 已编入运行产物，方法字符串存在：

- `diagnosis.reports.query`
- `diagnosis.reports.get`
- `diagnosis.diagnose`（企业 UI 已打到该方法）

---

## 3. 授权身份

- P24.8 记录的 canary 仍是 `tenant-fixture-a`。LIVE 租户目录里没有这个 fixture。
- 本机浏览器已有企业会话，只能观察 `/enterprise/001/diagnosis`。`001` 不是书面批准的脱敏 fixture，验收中不把它的组织成员当测试数据展开。
- 平台诊断 `/platform/diagnosis` 被重定向到登录页，**没有**平台 `diagnosis.report_admin` 会话。
- 容器内 CLI + gateway token 不是 membership 注入的企业管理员，不能当作第 3 节要求的测试管理员。

---

## 4. 只读 RPC

| 调用                                         | 身份                                     | 结果                                    |
| -------------------------------------------- | ---------------------------------------- | --------------------------------------- |
| `diagnosis.reports.query`                    | CLI operator token                       | `forbidden`                             |
| `diagnosis.reports.get`（不存在的 reportId） | CLI operator token                       | `forbidden`（未泄露目标是否存在）       |
| `diagnosis.diagnose`                         | CLI operator token                       | `unauthorized`                          |
| `diagnosis.diagnose`                         | 企业浏览器会话，无 skill-invocation 事件 | UI 显示「没有可诊断的会话」；未生成报告 |
| `diagnosis.reports.query` schemaVersion=9    | CLI operator token                       | `forbidden`（认证层先拒绝，未落到 400） |
| 客户端 `tenantId` 伪造                       | CLI operator token                       | `forbidden`                             |
| 错误 gateway token                           | 无有效认证                               | `unauthorized` / WS 1008 token mismatch |
| `diagnosis.nope`                             | 有效 token                               | `unknown method`                        |

**未完成：** 用 membership 注入的诊断管理员拿到 `query`/`get` 成功体，因此没有验证 `schemaVersion` / `reportId` / targets / findings / evidenceRefs 的一致性和脱敏字段。LIVE 上不存在 `diagnosis-projections`，也没有可取的 reportId。

`diagnose` 的无副作用路径已验证：无 `events.jsonl` 时返回 no_session，不落 projection。未从 RPC JSON 核对 `completion` / `missingEvidence` / `verification=null` 字段。

---

## 5. 负向安全

| 用例                       | 状态                                  |
| -------------------------- | ------------------------------------- |
| 无/错误认证                | 通过（token mismatch → unauthorized） |
| 无诊断权限（CLI operator） | 通过（query/get → forbidden）         |
| 未知方法                   | 通过（404 等价：unknown method）      |
| 不存在目标 get             | 通过（forbidden，无存在性泄露）       |
| 非法 schema/cursor → 400   | **未隔离**（先被 forbidden）          |
| 跨租户 query/get → 403     | **未用两个租户身份证明**              |
| principal 冒用             | **未做**                              |
| 客户端 tenantId 冲突       | CLI 表现为 forbidden，不能单独归因    |

审计：`/root/.openbot/diagnosis-audit` 不存在。拒绝结果没有可读取的持久审计摘要。内存 audit 无法在进程外核对「有摘要、无 Evidence payload」。

---

## 6. UI 线上验收

| 路由                                                | 结果                                                    |
| --------------------------------------------------- | ------------------------------------------------------- |
| <https://www.openbot.love/>                         | 200，bundle `index-tvycM9fL.js`；员工控制台，不是诊断页 |
| <https://admin.openbot.love/platform/diagnosis>     | 跳到 `/platform/login`                                  |
| <https://biz.openbot.love/enterprise/001/diagnosis> | 已登录企业壳；一级页为观察 / 处置 / 证据                |

企业诊断页合同：

- `data-testid=enterprise-diagnosis`，`data-tenant-scope=001`
- 失败关闭文案存在：暂无数据不能当作正常或已恢复；趋势缺失；生产不完整
- 页面无「健康」「已解决」
- HTML 无 `prompt` / `toolResult` / `payload` / `messageBody`
- 「打开大白诊断」禁用，未发送会话引用
- 首次加载把 query 失败显示为「网关不可用」
- 点击「立即诊断」后改为「没有可诊断的会话」，网关不可用消失；未编造报告

平台跨租户脱敏摘要：**未验证**（未登录）。

---

## 7. 无副作用与 WeCom

| 检查                                           | 结果             |
| ---------------------------------------------- | ---------------- |
| 新增诊断 projection                            | 无（目录不存在） |
| 新增 `events.jsonl`                            | 无               |
| Doctor `--fix` / Channel restart / remediation | 未调用           |
| 真实大白消息                                   | 未发送           |
| ledger / RELEASE_RECORD / provenance           | 未改             |
| 平行 Report / Skill Health DB                  | 未建             |

WeCom 实际不是笼统的 `running=false`：

- `default`：enabled，未配置，stopped，缺 token
- `t_001_default`（OpenBot official）：enabled，configured，**running**

已知限制：官方通道在跑，但本任务禁止发真实消息，因此「真实对话闭环未验证」仍是缺口，不把它写成 WeCom 整通道宕机。

---

## 8. Go / No-Go

**Go 条件未齐。输出：部分通过。**

未齐项（任一即可阻止满过）：

1. 未用授权诊断管理员完成成功的 `query` / `get`
2. `diagnosis.diagnose` 只验证了 UI no_session，未核 RPC 字段
3. WeCom / 真实聊天闭环未验证
4. 大白投送未验证
5. remediation 未验证
6. 持久审计 / SLO 观测缺失

身份、live pack、四门 gate 与 P24.8 一致、失败关闭 UI 骨架、无副作用，这些成立。它们不够单独宣称云端诊断只读闭环验收通过。
