---
name: nano-pdf
description: >-
  当用户需要创建、编辑、填写、渲染或核验 PDF（含布局质检、AcroForm 表单）时务必使用本技能。
  汇报、申报、研究报告、评审用 PDF 须先按 references/consulting-report-design.md 做信息设计，再排版生成。
  覆盖自然语言改页（nano-pdf CLI）、reportlab/pdfplumber/pypdf 生成与抽取、Poppler 渲图验收。
  不要在「只要 Word/Docs」或「只要 PPTX」场景用（分别走 documents / cyber-ppt）。
homepage: https://pypi.org/project/nano-pdf/
metadata:
  {
    "openclaw":
      {
        "emoji": "📄",
        "requires": { "bins": ["nano-pdf"] },
        "install":
          [
            {
              "id": "uv",
              "kind": "uv",
              "package": "nano-pdf",
              "bins": ["nano-pdf"],
              "label": "Install nano-pdf (uv)",
            },
          ],
      },
  }
---

# nano-pdf（PDF 创建 / 编辑 / 渲染核验）

OpenBot 终端交付：**工作区文件**（`.pdf` + 可选 QA PNG）。不要依赖 Codex artifact API、`openai.yaml`、或 `:codex-file-citation`。

## 何时用

| 意图                       | 做法                                                   |
| -------------------------- | ------------------------------------------------------ |
| 自然语言改某一页文案/版式  | `nano-pdf` CLI                                         |
| 汇报 / 申报 / 研究报告 PDF | 先读 `references/consulting-report-design.md`，再生成  |
| 新建带排版的 PDF           | `reportlab`（见 `references/create-render.md`）        |
| 抽文本 / 表单字段          | `pdfplumber` / `pypdf`                                 |
| 填 AcroForm                | `pypdf` + 逻辑字段核验（见 `references/acroforms.md`） |
| 交付前布局验收             | `pdftoppm` 渲 PNG 后目视检查                           |

## 快速开始（自然语言改页）

```bash
nano-pdf edit deck.pdf 1 "Change the title to 'Q3 Results' and fix the typo in the subtitle"
```

- 页码可能是 0-based 或 1-based；结果偏一页时换另一种重试。
- 改完务必渲图核验再交付。

## 标准工作流

1. **先看图再信文本**：用 Poppler 渲页；文本抽取不能证明布局正确。
2. **汇报 / 申报 / 研究类 PDF**：先完成 `consulting-report-design.md` 的 ①②（结构 + 信息设计），再进入排版与生成。
3. **生成**：新文档用 reportlab；小改可用 nano-pdf 或 pypdf。
4. **表单**：填 AcroForm 时同时检查 `/AcroForm/Fields` 与页级 `/Widget`（见 references）。
5. **再渲再查**：每次有意义的改动后重新 `pdftoppm`，检查裁切、重叠、错位、不可读字形。
6. **交付**：只交最终 PDF；QA PNG 默认不交。

## 依赖

```bash
uv pip install nano-pdf
uv pip install reportlab pdfplumber pypdf
brew install poppler   # macOS；Debian: sudo apt-get install -y poppler-utils
pdftoppm -png "$INPUT_PDF" "$OUTPUT_PREFIX"
```

## 落盘约定（OpenBot）

- 中间文件：任务 `work/` 或工作区 `tmp/pdfs/`；完成后可删。
- 终稿：用户指定路径，或工作区 `output/pdf/` / Desktop 等授权目录。
- 勿把系统临时目录当唯一落点。

## 质量门槛

- 字体、边距、层级一致；无裁切/重叠/坏表/黑块。
- 仅用 ASCII 连字符；引用人类可读；禁止残留工具 token。
- 最新一轮 PNG 检查通过前不得交付。

## 不要 / 警告

- **警告：** 勿使用 Codex `mark_artifact_operation_started` / artifact citation 协议；OpenBot 交付以工作区文件为准。
- **警告：** 勿附带或依赖 `agents/openai.yaml`、专有容器工具树整包拷贝。
- **不要：** 公众号正文 HTML / 成稿 / 草稿箱走 `wechat-article`，不要用本技能冒充公众号排版。

## 参考

- `references/consulting-report-design.md` — 汇报 / 申报 / 研究报告的信息设计（通用，不绑定品牌叙事）
- `references/create-render.md` — 生成与 Poppler 验收
- `references/acroforms.md` — 可填表单逻辑核验
- `references/openbot-delivery.md` — 落盘与附件
- `ATTRIBUTION.md`
