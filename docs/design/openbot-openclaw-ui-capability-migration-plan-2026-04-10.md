# OpenBot UI 能力优先迁移与 Legacy 冻结执行方案

Date: 2026-04-10

## Related Docs

- 当前现状审计与任务清单：[/design/openbot-openclaw-ui-current-state-audit-and-task-plan-2026-04-10](/design/openbot-openclaw-ui-current-state-audit-and-task-plan-2026-04-10)
- 产品入口矩阵：[/design/openbot-product-entry-matrix-2026-04-11](/design/openbot-product-entry-matrix-2026-04-11)
- 实施状态复核：[/design/openbot-openclaw-ui-implementation-status-review-2026-04-11](/design/openbot-openclaw-ui-implementation-status-review-2026-04-11)

## 1. 决策结论

本方案正式确立以下执行策略：

1. 冻结旧 OpenBot UI 壳层，不再作为产品主入口。
2. 旧能力不跟随旧页面一起保留，而是抽象为兼容能力层。
3. 新 OpenBot UI 只能依赖能力接口，不得依赖旧页面、旧 ViewModel、旧状态存取方式。
4. 迁移按功能域进行，不按旧页面逐页平移。
5. 每迁移一块能力域，都必须做行为一致性验证与回归验证。
6. 当新系统覆盖率和稳定性达标后，彻底删除 legacy UI。

一句话目标：

> 把 OpenBot 从产品 UI 系统降级为能力来源，再以能力兼容层为边界重建 OpenBot UI。

## 2. 背景与当前仓库现状

当前仓库中，旧 UI 并不是单纯的展示层，而是直接耦合状态、流程与运行时能力。

典型旧 UI 入口和壳层包括：

- `apps/ios/Sources/RootCanvas.swift`
- `apps/ios/Sources/Settings/SettingsTab.swift`
- `apps/ios/Sources/Onboarding/OnboardingWizardView.swift`
- `apps/macos/Sources/OpenBot/MenuContentView.swift`

这些文件当前不仅负责渲染，还直接绑定：

- onboarding 流程
- gateway 连接与配对
- 配置项读写
- chat / canvas 打开路径
- 设备能力开关
- 调试开关与 fallback 行为

底层可抽象能力主要分布在：

- `apps/ios/Sources/Model/NodeAppModel.swift`
- `apps/ios/Sources/Gateway/GatewayConnectionController.swift`
- `apps/macos/Sources/OpenBot/ConfigStore.swift`
- `apps/macos/Sources/OpenBot/ChannelsStore.swift`
- `apps/shared/OpenBotKit/Sources/OpenBotKit/`
- `apps/macos/Sources/OpenBotProtocol/GatewayModels.swift`

结论：

1. 不能简单“删旧页面”，否则会直接丢失行为。
2. 也不能只是“隐藏旧页面”，否则旧结构会继续污染新系统。
3. 必须先切断 UI 对业务能力和状态源的直接耦合，再迁移新 UI。

## 3. 总目标

本阶段要完成四件事：

1. 让旧 OpenBot UI 退出产品主链路。
2. 建立统一的 capability layer，作为旧能力到新系统的唯一接入边界。
3. 让新 OpenBot UI 只依赖 capability/use-case/domain store。
4. 为后续彻底移除 legacy UI 建立可验证的迁移路径与验收标准。

## 4. 非目标

本阶段明确不做：

1. 不在第一阶段直接全量删除旧 UI 文件。
2. 不在第一阶段同时重命名底层协议层和传输层所有 OpenBot 命名。
3. 不把旧 ViewModel 直接包装后继续透传给新 UI。
4. 不按旧页面的展示结构逐页复制到新页面。
5. 不把 onboarding 提前作为第一批迁移目标。

## 5. 核心原则

### 5.1 能力优先，不是页面优先

迁移对象必须是功能域：

- gateway
- config
- channels
- session
- chat / canvas
- onboarding

而不是：

- 设置页
- 首页
- 某个旧 tab
- 某个旧 sheet

### 5.2 旧 UI 冻结，不再演化

legacy UI 只允许：

- 行为参考
- debug fallback
- 灰度回退

legacy UI 不允许：

- 承接新需求
- 继续扩大依赖面
- 成为默认入口

### 5.3 新 UI 只依赖能力接口

新 OpenBot UI 只能依赖：

- capability facade
- use-case
- domain store
- domain model

新 OpenBot UI 不得依赖：

- 旧页面 view
- 旧 ViewModel
- 旧 Store
- `AppStorage`
- `UserDefaults`

### 5.4 语义适配发生在 capability 层

OpenBot 需要独立产品语义，但不要在迁移初期直接改底层协议与基础库命名。

允许保持兼容命名稳定的层：

- `apps/shared/OpenBotKit/Sources/OpenBotKit/`
- `apps/macos/Sources/OpenBotProtocol/GatewayModels.swift`

OpenBot 语义映射应发生在 capability/domain facade 层，而不是直接改传输层。

## 6. 四个硬约束

### 6.1 单一状态源

所有新 UI 状态必须逐步收敛到 capability/domain store。

禁止新 UI 直接访问：

- `AppStorage`
- `UserDefaults`
- 旧 UI 内部 `@State`
- 旧 `Store`

目标目录建议：

```text
capability/
  config/
  gateway/
  channels/
  session/
  chat/
  onboarding/
```

### 6.2 能力层语义适配

OpenBot 面向产品的术语必须在 capability facade 层完成适配，不允许在新 UI 中直接暴露 OpenBot 的旧产品语义。

建议映射关系：

| Legacy 概念 | OpenBot 语义 |
| ----------- | ------------ |
| agent       | 数字员工     |
| session     | 工作会话     |
| channel     | 连接能力     |
| memory      | 织忆         |
| plugin      | 技能         |

说明：

1. 该映射用于 OpenBot 域模型和 UI 文案。
2. 底层兼容协议与基础库可暂时保留 legacy 命名。
3. 任何跨层映射都必须集中在 facade/adapter，而不是散落在 view 中。

### 6.3 禁止 ViewModel 透传

硬规则：

1. 新 UI 不允许 `import` 旧 ViewModel。
2. 新 UI 不允许依赖旧 ViewModel 的字段语义。
3. 旧 ViewModel 不得作为 capability facade 的返回对象。

允许：

- `CapabilityFacade`
- `UseCase`
- `DomainStore`
- `DomainModel`

禁止：

- `NodeAppModel`
- `GatewayConnectionController`
- `ConfigStore`
- `ChannelsStore`

以上禁止项针对新 UI 直接依赖关系成立，不代表旧系统内部会立即消失。

### 6.4 Legacy UI 物理隔离

legacy UI 不能只是从导航上移除，必须做到物理隔离。

要求：

1. 迁入独立目录或模块。
2. 通过 feature flag 或 build flag 控制。
3. 若平台允许，release 默认不作为主入口。
4. review 中把 legacy 文件视为冻结区。

建议命名：

```text
legacy-openclaw-ui/
capability-compat/
openbot-ui/
```

## 7. 目标架构

### 7.1 三层结构

#### 7.1.1 Legacy Shell

职责：

1. 保留旧行为参考。
2. 提供必要的 debug fallback。
3. 承担短期回滚安全垫。

边界：

1. 不承接新产品需求。
2. 不再新增对底层能力的直接耦合。
3. 不作为新产品默认入口。

#### 7.1.2 Capability Layer

职责：

1. 抽象旧系统能力。
2. 统一状态源。
3. 做语义适配与数据模型整形。
4. 为新 UI 提供唯一调用边界。

子层建议：

1. `facade`
2. `use-case`
3. `domain-store`
4. `adapter`
5. `mapper`

#### 7.1.3 OpenBot UI

职责：

1. 承载新产品信息架构。
2. 承载新产品交互和文案语义。
3. 通过 capability 调用底层能力。

边界：

1. 不依赖 legacy view。
2. 不依赖 legacy ViewModel。
3. 不依赖 legacy 状态读写方式。

## 8. 模块与目录建议

以下是建议的目标结构，不要求一次性到位，但新增代码应尽量向该结构靠拢。

```text
ui/
  openbot/
    gateway/
    employee/
    workspace/
    settings/

capability/
  gateway/
    facade.ts
    use-cases.ts
    store.ts
    mapper.ts
    adapter-openclaw.ts
  config/
    facade.ts
    store.ts
    adapter-openclaw.ts
  channels/
    facade.ts
    store.ts
    adapter-openclaw.ts
  chat/
  session/
  onboarding/

legacy-openclaw-ui/
  ios/
  macos/
```

平台侧也可保留原目录，但要在逻辑上形成上述边界。

## 9. 第一批抽象对象

第一批必须优先抽象的能力边界：

### 9.1 Gateway

候选来源：

- `apps/ios/Sources/Gateway/GatewayConnectionController.swift`
- `apps/ios/Sources/Model/NodeAppModel.swift`
- `apps/macos/Sources/OpenBot/MenuContentView.swift`

目标能力：

1. gateway discovery
2. gateway connect / disconnect
3. gateway pair / trust / auth
4. gateway status snapshot
5. gateway setup / manual connect

### 9.2 Config

候选来源：

- `apps/macos/Sources/OpenBot/ConfigStore.swift`
- `apps/ios/Sources/Settings/SettingsTab.swift`

目标能力：

1. config load
2. config save
3. config draft
4. config validation / issue summary

### 9.3 Channels

候选来源：

- `apps/macos/Sources/OpenBot/ChannelsStore.swift`

目标能力：

1. channels status snapshot
2. channel account snapshot
3. channel default account
4. channel connect/login actions

### 9.4 Chat / Session / Canvas

候选来源：

- `apps/ios/Sources/Model/NodeAppModel.swift`
- `apps/ios/Sources/RootCanvas.swift`

目标能力：

1. main session resolution
2. chat session open
3. canvas action bridge
4. active agent resolution

### 9.5 Onboarding

候选来源：

- `apps/ios/Sources/Onboarding/OnboardingWizardView.swift`
- `apps/ios/Sources/RootCanvas.swift`

说明：

onboarding 在第一阶段只允许梳理，不建议先迁 UI。必须等 gateway/config 能力层稳定后再处理。

## 10. Capability Mapping 表

下表用于执行管理和复核，目标是明确每个 legacy 模块在新系统中的去向。

说明：

1. “是否复用”表示 legacy 逻辑或底层能力是否保留并被 capability 层继续消费。
2. “是否重写”表示该模块对应的 UI 壳层或面向产品的表达是否要在 OpenBot 侧重建。
3. 同一个 legacy 模块可能既有复用部分，也有重写部分。

| 旧模块                                                       | 新能力                    | 是否复用 | 是否重写 | 备注                                                |
| ------------------------------------------------------------ | ------------------------- | -------- | -------- | --------------------------------------------------- |
| `apps/ios/Sources/Gateway/GatewayConnectionController.swift` | `gateway.connect`         | Yes      | No       | 先抽连接、发现、配对、信任校验 use-case             |
| `apps/ios/Sources/Gateway/GatewayConnectionController.swift` | `gateway.discovery`       | Yes      | No       | 作为 gateway facade 底层 adapter 来源               |
| `apps/ios/Sources/Gateway/GatewayConnectionController.swift` | `gateway.pairing`         | Yes      | No       | pairing/trust 逻辑保留，入口改由新 UI 驱动          |
| `apps/macos/Sources/OpenBot/ConfigStore.swift`               | `config.store`            | Yes      | No       | 配置读写能力保留，但外部只经 capability facade 访问 |
| `apps/macos/Sources/OpenBot/ChannelsStore.swift`             | `channels.store`          | Yes      | No       | 状态快照和账号快照逻辑优先复用                      |
| `apps/ios/Sources/Model/NodeAppModel.swift`                  | `session.runtime`         | Partial  | Partial  | 只抽稳定能力；禁止整对象透传给新 UI                 |
| `apps/ios/Sources/Model/NodeAppModel.swift`                  | `chat.session`            | Partial  | Partial  | 会话解析和 agent 选择可复用，UI 交互要重建          |
| `apps/ios/Sources/Model/NodeAppModel.swift`                  | `canvas.bridge`           | Partial  | Partial  | 保留 action bridge，重写 OpenBot 侧承载界面         |
| `apps/shared/OpenBotKit/Sources/OpenBotKit/`                 | `protocol.runtime-kit`    | Yes      | No       | 兼容基础库，第一阶段不做语义级重命名                |
| `apps/macos/Sources/OpenBotProtocol/GatewayModels.swift`     | `protocol.gateway-models` | Yes      | No       | 保持协议稳定，语义映射上移到 facade 层              |
| `apps/ios/Sources/Settings/SettingsTab.swift`                | `config.ui`               | No       | Yes      | 旧设置页不复用，能力由 `config.store` 提供          |
| `apps/ios/Sources/RootCanvas.swift`                          | `workspace.shell`         | No       | Yes      | 旧首页/承载壳层退出产品主入口                       |
| `apps/ios/Sources/Onboarding/OnboardingWizardView.swift`     | `onboarding.ui`           | No       | Yes      | 流程要在能力稳定后重建，新旧流程不直接共用 UI       |
| `apps/macos/Sources/OpenBot/MenuContentView.swift`           | `desktop.shell`           | No       | Yes      | 菜单壳层重构为 OpenBot 语义入口                     |
| `apps/macos/Sources/OpenBot/MenuContentView.swift`           | `desktop.quick-actions`   | Partial  | Yes      | 快捷动作能力可复用，展示和入口重写                  |
| `apps/macos/Sources/OpenBot/ChannelsSettings.swift`          | `channels.ui`             | No       | Yes      | 旧 channel settings 视图冻结，新 UI 独立重建        |

执行时可继续扩展本表，原则是：

1. 能力优先判断是否复用。
2. UI 默认判断为重写，除非只是 debug/fallback 外壳。
3. 若出现 “Yes + Yes”，必须明确拆分出“复用的是哪层，重写的是哪层”。

## 11. 迁移顺序

### Phase 1: 冻结旧 UI 壳层

目标：

1. 从主导航和主入口中移除旧 UI。
2. 标记 legacy UI 为冻结区。
3. 给 legacy UI 增加 feature flag / build flag 保护。

完成标准：

1. 旧 UI 默认不作为 release 主入口。
2. 新功能不再落入 legacy 目录。
3. 所有新增 UI 需求默认进入 OpenBot UI 边界。

### Phase 2: 状态收敛

目标：

1. 建立 capability/domain store。
2. 停止新 UI 直接读写本地散落状态。
3. 为 gateway/config/channels 建立唯一状态源。

完成标准：

1. 新 UI 不直接访问 `AppStorage` / `UserDefaults`。
2. gateway/config/channels 都有显式 store 或 facade。
3. 状态读写链路可被测试验证。

### Phase 3: 能力抽象

目标：

1. 从 legacy 逻辑中提炼 use-case 和 facade。
2. 输出稳定 domain model。
3. 把旧系统行为封装到 adapter。

完成标准：

1. gateway/config/channels 第一批 facade 可用。
2. facade 接口与旧 UI 解耦。
3. 新 UI 可以只依赖 facade 运行核心流程。

### Phase 4: OpenBot UI 第一版

优先交付：

1. gateway 管理
2. 数字员工入口
3. 基础工作台

完成标准：

1. 新 UI 能跑通主路径。
2. 不再依赖 legacy view。
3. 主入口切换到 OpenBot UI。

### Phase 5: 功能域渐进迁移

推荐顺序：

1. gateway / connection
2. config / settings
3. channels
4. chat / canvas
5. onboarding

### Phase 6: Parity Test 与回归验证

每迁移一块能力域，都必须完成：

1. 行为一致性测试
2. 数据一致性验证
3. 回归验证

### Phase 7: 删除 Legacy UI

删除前提：

1. 核心功能覆盖率达到可接受阈值。
2. 无关键路径依赖 legacy fallback。
3. release 构建不再需要旧 UI。

## 12. 工程化约束

### 12.1 Import 规则

应在 lint、review 或 CI 中建立以下约束：

1. 新 UI 不得直接引用 `NodeAppModel`。
2. 新 UI 不得直接引用 `GatewayConnectionController`。
3. 新 UI 不得直接引用 `ConfigStore`。
4. 新 UI 不得直接引用 `ChannelsStore`。
5. 新 UI 不得直接读写 `AppStorage`。
6. 新 UI 不得直接读写 `UserDefaults`。

### 12.2 代码评审规则

凡是新 UI 相关 PR，必须回答：

1. 是否只依赖 capability facade？
2. 是否引入了新的 legacy 耦合？
3. 是否把业务逻辑放回 view？
4. 是否新增了第二套状态源？

### 12.3 Legacy 冻结规则

legacy UI 中允许的修改类型：

1. bugfix
2. 回退安全修复
3. 兼容层抽取所需的最小改动

legacy UI 中不允许的修改类型：

1. 新功能
2. 新信息架构
3. 新交互主路径
4. 新产品语义扩展

## 13. 验收标准

### 13.1 架构验收

满足以下条件时，架构迁移方向成立：

1. 新 OpenBot UI 不再直接依赖 legacy view。
2. 新 OpenBot UI 不再直接依赖 legacy ViewModel。
3. gateway/config/channels 存在 capability facade。
4. 新 UI 状态通过 capability/domain store 读取。

### 13.2 工程验收

满足以下条件时，迁移纪律成立：

1. release 构建中没有旧 UI 主入口。
2. legacy UI 被明确隔离并冻结。
3. 新增代码默认进入 capability 或 OpenBot UI 边界。
4. review 能阻止新的跨层耦合进入主分支。

### 13.3 业务验收

满足以下条件时，可进入 legacy 删除阶段：

1. gateway 主路径在新 UI 可用。
2. config 主路径在新 UI 可用。
3. channels 主路径在新 UI 可用。
4. 关键会话与工作台主路径在新 UI 可用。
5. parity test 能证明迁移前后关键行为一致。

## 14. 风险与控制

### 14.1 P0 风险

#### 状态分裂

表现：

1. 新 UI 写一套状态。
2. 旧 UI 写一套状态。
3. 用户行为不可预测。

控制措施：

1. 建立 capability/domain store。
2. 禁止新 UI 直接触达 legacy 状态源。
3. 对关键状态链路补集成测试。

#### 旧逻辑抽取不完整

表现：

1. 新 UI 看起来可用。
2. 关键行为仍藏在旧 view 或旧 controller 中。

控制措施：

1. 先抽 use-case，再迁 UI。
2. 用行为验收清单检查每个能力域。

### 14.2 P1 风险

#### 新 UI 被旧语义污染

控制措施：

1. 在 capability facade 层做集中语义映射。
2. 禁止在 view 层散落 rename 逻辑。

#### 团队直接复用旧组件

控制措施：

1. import 限制
2. review gate
3. legacy 物理隔离

## 15. 执行清单

### 15.1 立即执行

1. 确认 legacy UI 冻结范围。
2. 建立 capability 目录与第一批 facade 骨架。
3. 为 gateway/config/channels 设计统一状态接口。
4. 建立 import / state access review 规则。

### 15.2 第一批实现

1. `gateway` capability facade
2. `config` capability facade
3. `channels` capability facade
4. OpenBot UI 主入口切换方案

### 15.3 第一批复核

1. 新 UI 是否仍直接依赖 legacy store
2. 新 UI 是否仍直接依赖 `AppStorage` / `UserDefaults`
3. facade 是否只是旧对象透传
4. 旧 UI 是否仍被当作主产品入口

## 16. Review Checklist

提交与复核本方案相关变更时，必须逐项确认：

- 是否把迁移对象定义为能力域，而不是页面
- 是否把旧 UI 限定为冻结层
- 是否建立了 capability facade，而不是新的中间耦合层
- 是否避免了直接透传旧 ViewModel
- 是否避免了新 UI 直接读写旧状态源
- 是否对语义映射做了集中收口
- 是否补了 parity test 或明确了缺失原因
- 是否让 release 主入口继续远离 legacy UI

## 17. 最终判断

本方案不是“把旧页面藏起来”，而是：

1. 让旧页面退出产品主链路。
2. 让旧能力以兼容层形式继续服务。
3. 让新 OpenBot UI 在干净边界上生长。
4. 最终用结构性替换，而不是视觉性覆盖，完成新旧系统交接。
