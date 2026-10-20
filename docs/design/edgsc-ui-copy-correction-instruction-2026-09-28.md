# EDGSC 员工端与企业端文案修正指令

> 日期：2026-09-28
> 读者：执行代理
> 范围：只改文案、状态标签、提示和对应测试。不改接口、不改物化行为、不改页面结构。
>
> **2026-09-28 验收通过。** 独立对照提交 `9e6e5892c`（PR #161）。第 6 节 7 条均符合。员工端能力卡浏览器测试 8 passed；企业端向导与创建事务 8 passed。提交说明里的 “Accepted by EDGSC-UI文案验收” 是执行记录，不是本次验收结论。

## 1. 为什么改

知识宇宙现在只消费已经写入的供给记录。新鲜度来自这些记录，不来自连接器是否连通。打开知识宇宙不会触发按需物化。只有企业端点「立即物化」，或定时绑定的网关节拍，才会写出供给记录。

当前两处界面还在用旧说法：

- 员工端知识宇宙能力卡把「陈旧」解释成连接器断开，把「查看目录说明」写成「调用（受治理）」，「未知」没有任何标记。
- 企业端把不作物化的选项写成「直接数据输出」，把 `on_demand` 写成「按需触发 / 已就绪」。

平台端没有对应页面，不要改 `ui/src/ui/ports/platform/**`。

## 2. 禁止事项

- 不要改 RPC、网关、物化调度、新鲜度计算。
- 不要删除输出方式 `direct`。它仍然创建数据能力，供员工执行路径 `enterprise-data.invoke` 使用。它不创建投影、绑定和供给记录。
- 不要改存储值。`outputMode` 仍是 `"direct" | "projection"`。`materializationMode` 仍是 `"on_demand" | "scheduled" | "event_driven"`。向导创建投影绑定时仍写入 `materializationMode: "on_demand"`。
- 不要从类型定义里删除 `event_driven`。只从新建表单的下拉里拿掉。已有记录仍要能显示。
- 不要把「新鲜度 SLA（分钟，可选）」改成连接器状态。它是投影配置。
- 不要改数据源健康面板。连接器断开继续显示「已断开」。
- 不要改连接器包状态「已就绪 / 待安装连接器包」（`enterprise-data-governance-center-surface.ts` 约第 1301 行）。
- 不要改知识索引卡的「预览检索」。那条只属于 `cap:knowledge-index-retrieval`。
- 不要重做布局、边框、卡片结构或信息架构。
- 不要改 `docs/zh-CN/**`。

## 3. 员工端

只动知识宇宙「数据能力空间」的能力卡。

### 3.1 新鲜度徽章

文件：`ui/src/ui/views/knowledge-universe-data-capability-card.ts`

现状：只有 `freshness === "stale"` 才出现徽章。`fresh` 和缺省都不显示。

改成三种可见状态：

| `freshness`           | 徽章文案         | 说明（`title`）                                                |
| --------------------- | ---------------- | -------------------------------------------------------------- |
| `stale`               | 陈旧             | 已写入的供给记录已过期。打开本页不会重新查询连接器。           |
| `unknown`，或字段缺失 | 未供给           | 还没有已写入的供给记录。连接器是否连通不代表这里有可消费内容。 |
| `fresh`               | 不显示新鲜度徽章 | 维持现状                                                       |

徽章 class 保持现有 stale class。未供给使用新 class `knowledge-universe__data-capability-card-badge--unknown`，不要复用 stale 的样式语义。不要新增 CSS 体系；若现有 stale 徽章只靠 class 着色，未供给徽章沿用同一徽章组件、用中性色即可。没有现成中性色时，只加一条与 stale 徽章同结构的规则。

文案放进 i18n，不要在组件里写死中文：

- `ui/src/i18n/locales/zh-CN.ts` 的 `frontstage.workbench.knowledgeUniverse.dataCapabilities`
- `ui/src/i18n/locales/en.ts` 同一路径

建议键：

| 键                 | zh-CN                                                          | en                                                                                                          |
| ------------------ | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `staleBadge`       | 陈旧                                                           | Stale                                                                                                       |
| `staleBadgeHint`   | 已写入的供给记录已过期。打开本页不会重新查询连接器。           | The saved supply record is expired. Opening this page does not query the connector again.                   |
| `unknownBadge`     | 未供给                                                         | Not supplied                                                                                                |
| `unknownBadgeHint` | 还没有已写入的供给记录。连接器是否连通不代表这里有可消费内容。 | No supply record has been written yet. A connected connector does not mean this page has something to read. |

删掉旧提示「支撑该能力的连接器已断开或异常，数据可能已过期」及其英文对应句。

类型注释：`ui/src/ui/capability/knowledge-universe/types.ts` 第 188 行。把 “Connector-derived freshness (stale => backing connector disconnected/errored).” 改成：供给记录新鲜度。`stale` 表示已写入记录过期，`unknown` 表示还没有供给记录。

### 3.2 查看供给说明

同一张卡上，已授权且不是知识索引能力时，现在的按钮是「调用（受治理）」。点击后走 `knowledge.capability.invoke`，返回的是目录说明：标题、摘要、来源系统、场景、供给新鲜度。这条路径不调用连接器。

改文案，不改点击后的请求：

| 键             | 现文案         | 改为             |
| -------------- | -------------- | ---------------- |
| `invokeAction` | 调用（受治理） | 查看供给说明     |
| `invoking`     | 调用中…        | 读取中…          |
| `invokeDenied` | 调用未获授权   | 当前席位未获授权 |

英文：

| 键             | 改为                        |
| -------------- | --------------------------- |
| `invokeAction` | View supply notes           |
| `invoking`     | Reading…                    |
| `invokeDenied` | This seat is not authorized |

成功结果区在摘要下方加一句，使用新键 `invokeResultNote`：

- zh-CN：以上是已登记的能力说明和供给新鲜度，不是连接器实时查询结果。
- en：These are the registered capability notes and supply freshness, not a live connector query.

授权失败、申请权限、审批中、预览检索、示例徽章保持原行为。

### 3.3 员工端测试

文件：`ui/src/ui/views/knowledge-universe-data-capability-card.browser.test.ts`

- 用例名不要再写 “backing connector”。
- `freshness: "stale"` 仍显示「陈旧」，`title` 为新的过期说明。
- 缺省或 `freshness: "unknown"` 显示「未供给」，不显示「陈旧」。
- `freshness: "fresh"` 不显示「陈旧」或「未供给」。
- 示例徽章与陈旧徽章仍可同时出现。

## 4. 企业端

### 4.1 数据产品向导：输出定义

文件：

- `ui/src/ui/ports/enterprise/views/enterprise-data-capability/product-editor-modal.ts`
- `ui/src/ui/ports/enterprise/views/enterprise-data-capability/product-wizard.ts`
- `ui/src/ui/ports/enterprise/views/enterprise-data-capability/product-create-transaction.ts`
- `ui/src/ui/ports/enterprise/views/enterprise-data-capability/product-detail-panel.ts`

第 3 步副标题现为：「选择直接数据输出，或绑定投影物化模板（可在产品详情「输出与物化」继续配置）。」

改为：「选择是否写成知识供给。不作物化时，知识宇宙没有可消费内容；员工执行仍走受治理的企业数据调用。」

选项：

| value（不要改） | 现标签       | 改为                   |
| --------------- | ------------ | ---------------------- |
| `direct`        | 直接数据输出 | 仅登记能力             |
| `projection`    | 投影物化     | 投影物化并供给知识宇宙 |

选「仅登记能力」时，在下拉下方显示一句说明：「不会创建投影和供给记录。知识宇宙里该能力会显示为未供给。」

选「投影物化并供给知识宇宙」时，保留模板选择。在模板下方显示一句说明：「创建后绑定为手动物化。需要在「输出与物化」点击「立即物化」，知识宇宙才会出现供给记录。」

校验失败文案，`product-wizard.ts`：

- 现文案：「请选择投影模板，或改用直接数据输出。」
- 改为：「请选择投影模板。若只登记能力、不供给知识宇宙，请改用「仅登记能力」。」

创建成功通知，`product-create-transaction.ts`：

- 投影路径现通知「已创建输出规格并完成供给绑定。」改为：「已创建输出规格并完成供给绑定。请到「输出与物化」点击「立即物化」，知识宇宙才会出现供给记录。」
- `direct` 路径在启用通知之外追加一条：「未创建供给记录。知识宇宙不会出现可消费内容。」
- 创建事务的分支不要改：`direct` 仍不调用投影规格和绑定接口；`projection` 仍创建规格，并把绑定写成 `on_demand`。

产品详情「输出与物化」空态，`product-detail-panel.ts`：

- 现文案：「尚未绑定投影物化。」
- 改为：「尚未绑定投影物化。知识宇宙目前没有该产品的供给记录。」
- 「前往输出与物化」按钮保留。

在 `product-wizard.node.test.ts` 增加一步：`outputMode: "projection"` 且模板为空时，失败文案等于上面的新句子。现有 direct 草稿的通过用例保持通过。

### 4.2 新建供给绑定：触发模式

文件：`ui/src/ui/ports/enterprise/views/enterprise-data-governance-center-surface.ts` 约第 2782–2794 行。

下拉改为：

| value（不要改） | 标签     |
| --------------- | -------- |
| `on_demand`     | 手动物化 |
| `scheduled`     | 定时同步 |

删除 `<option value="event_driven">事件驱动</option>`。默认值继续是 `on_demand`。若编辑已有 `event_driven` 记录时当前值不在下拉里，显示一项只读选项「事件驱动（无执行器）」，value 仍为 `event_driven`，避免保存时把旧值弄丢。新建表单不要出现这项。

在下拉下方加一句：「手动物化不会在打开知识宇宙时执行，需要到「输出与物化」点击「立即物化」。定时同步由网关定时节拍执行。」

不要改「新鲜度 SLA（分钟，可选）」的字段名和写入位置。

### 4.3 输出与物化页

文件：`ui/src/ui/ports/enterprise/views/enterprise-data-capability/outputs-page.ts`

`MATERIALIZATION_MODE_LABEL`：

| 存储值         | 现标签               | 改为                 |
| -------------- | -------------------- | -------------------- |
| `on_demand`    | 按需触发             | 手动物化             |
| `scheduled`    | 定时同步             | 定时同步             |
| `cron`         | 定时同步             | 定时同步             |
| `event_driven` | 现在会直接显示原始值 | 事件驱动（无执行器） |

运行状态列：

| 条件                           | 现标签 | 改为   |
| ------------------------------ | ------ | ------ |
| 已启用且 `scheduled` 或 `cron` | 调度中 | 调度中 |
| 已启用且不是定时               | 已就绪 | 待物化 |
| 未启用                         | 已停用 | 已停用 |

「待物化」使用中性或警告色，不要再用表示正常运行的 `ok`。定时的「调度中」继续用 `ok`。

按钮文案「立即物化 / 物化中…」不改，点击行为不改。

在「供给绑定与调度」标题下加一句提示：「待物化表示绑定已启用，但还没有因为打开知识宇宙而自动写出供给记录。」

## 5. 不要改的界面

- 平台端全部页面。
- 数据源健康面板的「已断开」。
- 连接器安装状态「已就绪」。
- 能力目录「知识供给 N」的计数。它已经按供给记录计数。
- 审批、血缘、总览队列。
- `ui/src/ui/capability/runtime-canonical/types.ts` 里运行时加载的 “按需触发”。那不是投影物化模式。

## 6. 验收

执行代理做完后，逐条核对：

1. 知识宇宙能力卡：过期记录显示「陈旧」，且提示不再提到连接器断开；没有供给记录显示「未供给」；已有新鲜供给记录不出现这两枚徽章。
2. 已授权非索引能力的按钮是「查看供给说明」。成功结果含来源、新鲜度和「不是连接器实时查询结果」。请求仍是 `knowledge.capability.invoke`。
3. 向导里不再出现「直接数据输出」。选仅登记能力不会创建投影；选投影物化仍创建 `on_demand` 绑定，并提示必须点「立即物化」。
4. 新建供给绑定下拉只有「手动物化」和「定时同步」。新建流程不能再选「事件驱动」。
5. 输出页里，启用的 `on_demand` 绑定显示「手动物化」和「待物化」，不显示「已就绪」。
6. 数据源健康、新鲜度 SLA、平台端页面无 diff。
7. 运行：

```bash
OPENBOT_TEST_PROFILE=low OPENBOT_TEST_SERIAL_GATEWAY=1 pnpm exec vitest run \
  ui/src/ui/views/knowledge-universe-data-capability-card.browser.test.ts \
  ui/src/ui/ports/enterprise/views/enterprise-data-capability/product-wizard.node.test.ts \
  ui/src/ui/ports/enterprise/views/enterprise-data-capability/product-create-transaction.node.test.ts
```

相关测试全部通过后再停。不要顺手提交。
