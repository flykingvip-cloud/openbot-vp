# 创建与渲染验收

## 生成（reportlab）

适合新 PDF：标题层级、段落、简单表、页眉页脚。复杂交互表单见 `acroforms.md`。

- 先定页尺寸与边距，再排内容。
- 每完成一版立刻渲 PNG。
- 中文用环境已装字体（PingFang / Noto Sans CJK / 微软雅黑）。

## 抽取

- `pdfplumber`：文本与表粗抽。
- `pypdf`：页操作、合并、表单字段。
- 不要用抽取结果证明布局正确。

## Poppler

```bash
pdftoppm -png input.pdf /path/to/qa/page
pdfinfo input.pdf
```

检查：页数、边距、标题层级、表线、页脚页码、溢出/重叠。

## OpenBot 差异

无需 Codex 容器依赖加载器。缺包则 `uv pip install` / `brew install poppler`。
