# 网页调研工作流

```text
用户问题
  ↓
任务解析
  ↓
研究计划生成
  ↓
循环执行：
  ├─ 搜索
  ├─ 选择来源
  ├─ 读取网页
  ├─ 抽取证据
  ├─ 更新主张—证据矩阵
  └─ 判断是否需要追加搜索
  ↓
质量检查
  ↓
报告综合
  ↓
引用校验
  ↓
工作区交付 / 保存到知识库
```

建议状态：`queued` `planning` `searching` `reading` `extracting` `verifying` `synthesizing` `validating` `completed` `failed` `needs_clarification`。

工程约束：搜索和抓取设超时与重试；正文截断去重；记录工具调用便于审计。不要对内网、localhost、链路本地或云 metadata 地址发请求。
