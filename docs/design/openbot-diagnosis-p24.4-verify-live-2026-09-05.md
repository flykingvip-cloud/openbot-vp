# OpenBot Diagnosis Platform — P24.4 verify-live

Date: 2026-09-05

Status: **统一窗口暗发布已验证，功能保持关闭。** 运行 verify-live PASS。P22 已失效。四门 gate 仍为 false。P24.4 待验收勾选。

Task: `openbot-diagnosis-platform`

硬门禁：verify-live 通过 = 已发布窗口仍在线上且诊断保持暗发布。≠ 开 gate ≠ Production Ready ≠ 进入 P25。

---

## 1. 身份

| 项                          | SHA / 值                                           |
| --------------------------- | -------------------------------------------------- |
| 已发布窗口 / 容器 LIVE      | `7d3fdf5bfef57077f7956ccab07c3c960984331b`         |
| origin/main tip / candidate | `08cbb0681f085397a033a6b7746b20d10cbfb212`（#979） |
| origin/main ledger 打开行   | seq 64 / `7d3fdf5b`                                |
| RELEASE_RECORD Latest       | seq 64 / `7d3fdf5b`                                |
| provenance peeled           | `provenance/sha-7d3fdf5bfef5` → `7d3fdf5b`         |
| 禁止旧 candidate            | `bf81b0ffcb401d26640afc65ee85134812f651ea`         |

LIVE 是已发布窗口，也是当前 `origin/main` 的祖先。**不要把当前 tip 再切到线上。**

## 2. 运行验收（`2026-09-05T13:49:36Z`）

| 检查                                | 结果                                     |
| ----------------------------------- | ---------------------------------------- |
| build-info.commit                   | PASS `7d3fdf5b`                          |
| healthz                             | PASS 200 `{ok:true,status:live}`         |
| readyz                              | PASS `{ready:true,failing:[]}`           |
| gateway / UI                        | PASS 同镜像，`index-Ch6EMLgY.js`         |
| R9                                  | PASS                                     |
| 回滚镜像 / 安全快照                 | PASS `04690f8d2e`                        |
| 四门 gate                           | 全 false                                 |
| diagnosis live pack / core handlers | 未注册 / 无 `diagnosis.` methods         |
| Da Bai / conversation / remediation | disconnected                             |
| 容器诊断环境变量                    | 无 `DIAGNOSIS_*` / `OPENBOT_DIAGNOSIS_*` |
| P22                                 | 失效，须重新签署                         |

`2026-09-05T14:32:00Z` 重跑：forward-only allow；delivery-alignment PASS=3 WARN=3 FAIL=0；standalone production-preflight 仍是 **No-Go**（空 SLO / fail-closed），不得当 live 健康。convergence 身份链一致，enablement 仍关闭。未改历史账本，未补发 provenance。

## 3. 仍关闭

官方 `tasks.md` P15–P24.4 保持 `[ ]`，等待验收。

统一窗口暗发布已验证，功能保持关闭。
