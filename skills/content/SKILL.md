---
name: content
description: |
  把研究或知识转化成高质量中性文稿：大纲、长短文、公众号正文、摘要、标题、审校终稿。
  遇到「写一篇」「出大纲」「改稿」「审校」「降 AI 味」「事实检查」「根据调研写文章」「对内简报」「先别写正文」务必使用。
  工作流：Brief → Research → Angle → Outline → Draft → Fact Check → Edit → Final。
  不负责深度研究本身、UI 设计、社媒监控。调研交接 deep-research；理解已有材料交接 knowledge；多平台再分发交接 content-ops。
---

# 内容生产

先判断用户要解决的传播问题，再写作。企业语气中性，不模仿任何作者，不用个人口吻或价值观包装。

## 先判断

1. 读者、场合、篇幅、必须保留的事实？
2. 事实源在哪：用户材料 / `knowledge` 产出 / `deep-research` 产出？没有源就先交接，不凭空开写。
3. 是否需要人工确认角度或敏感表述？

## 工作流

Brief → Research → Angle → Outline → Draft → Fact Check → Edit → Final

Research 只消费已有研究或点名补搜；未知问题整段研究交接 `deep-research`。细则：`references/workflow.md`。

### 正文必须区分

事实 | 观点 | 推测 | 案例 | 引用

标不出来的句子，不进终稿。

## Fact Check

读 `references/fact-check.md`。对每个关键事实：找来源、标注来源、无法验证则标记。禁止为流畅补造事实、数字、引语、市场容量。

## AI 味检查

读 `references/ai-taste.md`。至少改掉：空泛套话、机械「首先其次最后」、不自然转折、虚假权威、重复观点、无信息密度句。不为「降检测率」编造个人经历。

## 默认输出

```text
标题备选（3–5，不改事实）
大纲
正文
事实表（声明 / 类型 / 来源 / 状态）
未验证清单
审校摘记
```

用户只要大纲或摘要时，停在对应关。公众号排版交接 `wechat-article`；草稿箱由身份工具写入。PPT 交接 `cyber-ppt` / `pptx`。

## 禁区

- 人物模仿、特定作者文风、平台过度腔调
- 把调研或知识处理再实现一遍
- 未 Fact Check 的终稿

## 交接

| 需求               | 去向            |
| ------------------ | --------------- |
| 未知问题要先搞清   | `deep-research` |
| 已有长材料要先读懂 | `knowledge`     |
| 一源多平台         | `content-ops`   |
| 页面视觉           | `design`        |

## 组合

事实来自 `deep-research` 或 `knowledge`。终稿之后的多平台版本走 `content-ops`。页面表现走 `design`。

## 验收

- 事实表覆盖正文关键数字与引语
- 无法验证项未写成事实
- AI 味清单里的套话不进 Final
- 未确认 brief/角度前不写长稿

## 触发样例

- 「根据这份研究写一篇对内简报」
- 「出大纲，先别写正文」
- 「审校这篇，标出无法核实的数字」
