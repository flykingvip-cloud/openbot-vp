# 公众号文章编辑与发布

> 资产编号: `MKT-WECHAT-001`
> 类型: `composite_pack`
> 推荐执行方式: `semi_automatic`
> 当前状态: 已整理为可提交企业的资产包

## 1. 业务场景

这个资产用于把一篇准备发布到微信公众号的文章，从内容整理、排版成可进公众号的 HTML、封面生成、配图生成、素材上传，一路推进到微信草稿箱。

它不是单纯的“发文脚本”，而是一条完整的运营工作流资产，适合沉淀给市场、新媒体、内容运营团队复用。

## 2. 资产边界

这个资产负责：

- 文章内容整理为可发布格式
- 排版成公众号正文 HTML（已装 `gzh-design` 时走主题引擎；否则走本地合规底稿）
- 封面图生成
- 配图生成
- 微信永久素材上传（身份工具 `upload_thumb` / `upload_content_image`）
- 微信草稿创建（身份工具 `publish_draft`）
- 发布前校验

这个资产不负责：

- 自动群发最终消息
- 跳过人工审核直接外部发布
- 托管真实公众号密钥到仓库

## 3. 输入物

| 输入     | 说明                                            |
| -------- | ----------------------------------------------- |
| 文章标题 | 微信标题，需控制在 64 字节以内                  |
| 作者     | 展示在文章作者位                                |
| 摘要     | 草稿摘要与分享摘要                              |
| 正文内容 | Markdown / Word / PDF / 纯文本，或已排好的 HTML |
| 封面图   | 默认 `/tmp/cover.png`                           |
| 配图     | 一到三张正文配图，发布前需准备成可上传文件      |
| 微信凭证 | 已授权的企业/个人公众号身份，不要用环境变量换票 |

## 4. 输出物

| 输出                  | 说明                                   |
| --------------------- | -------------------------------------- |
| 草稿 `media_id`       | 微信草稿唯一标识                       |
| 封面 `thumb_media_id` | 草稿使用的封面素材 ID                  |
| 正文图片 URL 列表     | 微信永久素材接口返回的真实 URL         |
| 可预览草稿            | 在 `mp.weixin.qq.com` 草稿箱中人工预览 |
| 合规 HTML 正文        | 排版段产物，作为身份工具 `content`     |

## 5. 固定执行流程

必须顺序执行，任何一步失败就停止。

1. 准备文章内容文件
2. 排版为公众号正文 HTML（见 `references/typeset-handoff.md`），`validate_wechat_html.py` 必须通过
3. 生成封面图
4. 生成或整理正文配图
5. 校验输入文件完整性
6. 用已授权身份 `upload_thumb`（或 `publish_draft` 带 `thumbUrl`）得到封面
7. 上传正文图片素材（`upload_content_image`），得到真实 `url`
8. 替换正文内的图片占位符
9. `operational_identity` / `user_operational_identity` `publish_draft` 创建草稿
10. 人工登录后台预览并决定是否群发

## 6. 技术资源清单

### Bundled scripts

| 文件                              | 作用                                    |
| --------------------------------- | --------------------------------------- |
| `scripts/wrap_wechat_html.py`     | 本地合规底稿（未装主题引擎时）          |
| `scripts/validate_wechat_html.py` | 排版段 HTML 红线校验                    |
| `scripts/gen_cover.sh`            | 生成公众号封面图                        |
| `scripts/gen_article_imgs.py`     | 生成配图素材                            |
| `scripts/publish_agi_axios.js`    | leftover 发布脚本；身份已授权时禁止使用 |
| `scripts/publish_article.py`      | leftover 兼容入口，转调 leftover JS     |

### Bundled references

| 文件                               | 作用                               |
| ---------------------------------- | ---------------------------------- |
| `references/typeset-handoff.md`    | 排版段交接：主题引擎 vs 本地底稿   |
| `references/draft-handoff.md`      | 草稿箱真源：身份工具，不是遗留脚本 |
| `references/wechat-config.md`      | 配置模板与运行时约定               |
| `references/publish-postmortem.md` | 后端真实对话沉淀出的失败模式与经验 |

### External runtime assumptions

| 依赖        | 说明                             |
| ----------- | -------------------------------- |
| `sharp`     | 本仓库依赖，用于图片生成脚本     |
| `axios`     | 本仓库依赖，用于微信 API 请求    |
| `form-data` | 本仓库依赖，用于素材上传         |
| `node`      | 仅遗留发布脚本需要；活路径不跑它 |
| `python3`   | 运行配图生成脚本                 |

## 7. 凭证与安全规则

真实公众号凭证不应该进入资产包，也不应该再经遗留脚本用环境变量换票。

允许的提供方式：

- 企业席位已授权的 `wechat-official` 身份 + `operational_identity`
- 个人已授权的公众号身份 + `user_operational_identity`

不允许的方式：

- 在 `ASSET.md` 中写 live secrets
- 在脚本中硬编码真实 AppID / AppSecret
- 身份已授权时仍跑 `publish_agi_axios.js` 并读取 `WECHAT_APP_ID` / `WECHAT_APP_SECRET`
- 把个人机器上的配置路径当作团队标准路径

如果企业要接收这个资产，凭证应留在企业身份店。

## 8. 真实风险标签

建议风险标签：

- `external_publish`
- `credential_required`
- `brand_risk`
- `manual_review_required`

当正文带客户案例、截图或外部数据时，额外评估是否需要：

- `customer_data`

## 9. 已验证的失败模式

这些结论来自后端真实会话与工作区经验记录，而不是纸面推演。

### 失败模式 1: 用错上传接口

- `media/upload` 不能作为公众号草稿正文图片的正确路径
- 正文图片必须使用 `material/add_material?type=image`
- 封面必须使用 `material/add_material?type=thumb`

### 失败模式 2: 只看 `errcode === 0`

仅仅接口成功还不够，必须核对返回字段：

- 封面返回 `media_id`
- 正文图片返回 `url`
- 草稿创建返回 `media_id`

### 失败模式 3: 占位符图片 URL 没替换

如果正文里还是 `ILLUS1_URL` 这类占位符，草稿最终会是破图。

## 10. 推荐的人机分工

推荐执行方式是 `semi_automatic`，原因如下：

- 对外发布有品牌风险
- 标题、摘要、语气需要人工把关
- 配图和封面风格需要人工确认
- 群发动作不应该自动执行

推荐分工：

| 环节               | 角色              |
| ------------------ | ----------------- |
| 初稿整理           | AI 主导           |
| 封面/配图生成      | AI 生成，人工确认 |
| 素材上传与草稿创建 | 自动化            |
| 草稿预览与最终群发 | 人工              |

## 11. 适用团队

这个资产最适合：

- 市场团队
- 新媒体团队
- 内容运营团队
- AI 研究传播团队

不适合：

- 未装 `gzh-design` 时要求主题精排（本地底稿不能冒充主题）
- 需要音频/视频嵌入的文章
- 不允许人工审核的强自动发布场景

## 12. 建议的企业资产包提交字段

这部分直接对应员工端 `packageDraft`，用于把“整理好的运营工作流”推进到企业审核。

```json
{
  "packageTitle": "公众号文章编辑与发布",
  "packageSummary": "用于整理、排版、生成并发布公众号文章的复合资产包，覆盖 HTML 排版关、封面生成、配图上传、永久素材校验与草稿创建。",
  "assetPackageType": "composite_pack",
  "businessScenario": "公众号文章编辑与发布",
  "inputArtifacts": ["文章标题", "摘要", "正文 Markdown/HTML", "封面图", "正文配图"],
  "outputArtifacts": [
    "合规 HTML 正文",
    "微信公众号草稿 media_id",
    "thumb_media_id",
    "正文图片 URL",
    "可预览草稿"
  ],
  "dependencies": [
    "skills/wechat-article/scripts/wrap_wechat_html.py",
    "skills/wechat-article/scripts/validate_wechat_html.py",
    "skills/wechat-article/scripts/gen_cover.sh",
    "skills/wechat-article/scripts/gen_article_imgs.py",
    "skills/wechat-article/references/typeset-handoff.md",
    "skills/wechat-article/references/draft-handoff.md",
    "skills/wechat-article/references/wechat-config.md"
  ],
  "executionMode": "semi_automatic",
  "riskTags": ["external_publish", "credential_required", "brand_risk", "manual_review_required"],
  "targetTeams": ["市场", "新媒体", "内容运营"],
  "verifiedInProduction": true,
  "promotionIntent": "enterprise_standard",
  "needsEnterpriseSecrets": true,
  "notes": "真实凭证不得进入仓库；企业接收后需切换为统一密钥托管，并保留人工预览群发。"
}
```

## 13. 基于真实对话记录的产品建议

后台真实对话已经证明两件事：

1. 员工和机器人可以把这类工作流整理成相当完整的资产文档。
2. 但当前流程会停在“文档整理完成”，不会自然推进到“提交企业资产包”。

因此员工端下一步最应该补的是：

### 建议 A: 把“整理完成”改成显式双 CTA

不要只提示“已纳入资产列表”。

应直接给两个后续动作：

- `继续补充资产包`
- `提交企业资产包`

### 建议 B: 为复合资产自动预填提交字段

当对话结果里同时出现以下信号时，应自动切到资产包而不是轻量能力：

- 多脚本
- 固定步骤
- 外部发布
- 凭证依赖
- 明确输入输出

“公众号文章编辑与发布”正是这个典型案例。

### 建议 C: 把失败经验一起打包

员工提交企业时，不应只提交成功脚本，还应连同关键失败模式一起提交。

最少应带上：

- 为什么不能用 `media/upload`
- 为什么要区分 `thumb` 和 `image`
- 为什么必须校验返回字段，而不是只看 `errcode`

## 14. 当前完成定义

这份资产包达到“完整”的标准是：

- 技能入口合法
- 资产描述可提交企业
- 核心脚本在 bundle 内
- 配置模板已去敏
- 失败经验已沉淀为引用材料
- 明确了人工审核边界

如果要继续往前推进，下一步就不该再写说明文，而该直接做员工端“整理完成后的提交引导”。
