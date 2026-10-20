# Surface Routing 矩阵（Phase D0 / D1 合同）

路由函数只读现有 Surface 注册表和调用方给出的服务端事实。它不写注册表。

默认端：

| 服务端事实                      | 默认 Decision 端          | 参与约束                                                                                                                                            |
| ------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| agent，本人所有（`agent_self`） | 员工端                    | 无                                                                                                                                                  |
| agent，企业管理且委托有效       | 企业端                    | 若同时触及员工个人资产，员工最终授权                                                                                                                |
| agent，企业管理但无委托         | 员工端                    | 无委托则企业端不能成为决定端                                                                                                                        |
| knowledge，个人                 | 员工端                    | 无                                                                                                                                                  |
| knowledge，企业                 | 企业端                    | 若触及员工个人资产，员工最终授权                                                                                                                    |
| capability，企业私有            | 企业端                    | 若触及员工个人资产，员工最终授权                                                                                                                    |
| capability，平台公共            | 平台端                    | 若平台修复影响企业，企业参与 Canary                                                                                                                 |
| organization，企业              | 企业端                    | 若触及员工个人资产，员工最终授权                                                                                                                    |
| system                          | 平台端                    | 若平台修复影响企业，企业参与 Canary                                                                                                                 |
| 跨租户重复问题                  | 平台端，只升级为脱敏 Case | 不复制个人证据，也不把原租户 surface 的变更权交给平台。Case 上只允许 hold / reject。若标记触及个人资产，员工最终授权仍只覆盖个人 agent 或 knowledge |
| 未注册或禁止的 surface          | 无端                      | 失败关闭                                                                                                                                            |

所有权种类必须与 `EvolutionTarget.domain` 以及已注册 surface 的 `domain` 一致，否则 `inconsistent_target`。

## 与现有注册表的对应

路由不发明 surface。`getEvolutionSurface` 返回空且标识在 `FORBIDDEN_SURFACE_IDS` 中时，结果为 `forbidden_surface`。不在注册表中时为 `unknown_surface`。

`system.engineering-remediation` 属于未知标识。D1 用保留常量记下这个名字，路由结果为 `surface_not_registered`，`registered: false`，端点不开放授权。确认 `listEvolutionSurfaces()` 的返回值不含该标识。

## 参与约束不是新状态

- `enterprise_canary`：平台仍是决定端。`apply_canary`、`verify`、`promote` 还要求服务端事实 `enterpriseCanaryAcknowledged`。平台角色本身不算已参与。
- `employee_final_authorization`：企业可以发起 hold / reject。`start_experiment`、`apply_canary`、`promote` 还要求 `employeeFinalAuthorization`。员工本人发出 `employee_final_authorization` 时，只接受已证明所有者的个人 agent 或 knowledge，并走现有 `evolution.delegation.approve`，不走 Adapter。capability、organization、system 以及其他未证明所有者的域为 `owner_unproven`。`authorize` 与 `approve_application` 在现有 RPC 出现之前失败关闭，不能用 suggest 代替。

## 不在路由里做的事

- 不读取客户端命令里的租户或角色。
- 不把 Perception 查询当成路由结果。
- 不把 Decision 端写回 Evolution Surface 的 `authorityRole`。`authorityRole` 仍是注册表字段。
