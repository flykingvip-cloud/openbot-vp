---
name: openai-image-gen
description: >-
  当用户需要用 OpenAI Images API 生成/编辑位图（照片、插画、贴图、透明底抠图、批量变体）或产出缩略图画廊时务必使用本技能。
  不要用于 SVG/向量图标体系扩展、纯 HTML/CSS/canvas 图，或仓库内原生可编辑资产的小改。
homepage: https://platform.openai.com/docs/api-reference/images
metadata:
  {
    "openclaw":
      {
        "emoji": "🖼️",
        "requires": { "bins": ["python3"], "env": ["OPENAI_API_KEY"] },
        "primaryEnv": "OPENAI_API_KEY",
        "install":
          [
            {
              "id": "python-brew",
              "kind": "brew",
              "formula": "python",
              "bins": ["python3"],
              "label": "Install Python (brew)",
            },
          ],
      },
  }
---

# OpenAI Image Gen

通过 **OPENAI_API_KEY** 调用 Images API。默认用本技能 `scripts/gen.py`（批量 + `index.html` 画廊）。OpenBot 交付 = **工作区文件**，不是 Codex `$CODEX_HOME` / 内置 `image_gen` 工具。

## 何时用 / 不用

**用：** 新位图、参考图风格生成、局部编辑（换背景、抠透明底、去物）、多资产/多变体批量。

**不用：** 扩展现有 SVG/logo 体系；简单形状/线框用 HTML/CSS/canvas/`visualize` 更好；用户要确定性代码原生输出时。

## 意图判定

1. **生成 vs 编辑**：改已有图且要保留部分 → edit；仅作风格/构图参考 → generate。
2. **单资产 vs 批量**：多提示词用多次调用或 `--count`；`n`/count 是同一提示的变体，不是不同资产的替代。
3. 每张输入图标明角色：edit target / reference / compositing insert。

## 运行

出图可能超过常见 30s exec 超时；OpenClaw exec 建议 timeout=300。

```bash
python3 {baseDir}/scripts/gen.py
python3 {baseDir}/scripts/gen.py --count 16 --model gpt-image-1
python3 {baseDir}/scripts/gen.py --prompt "ultra-detailed studio photo of a lobster astronaut" --count 4
python3 {baseDir}/scripts/gen.py --size 1536x1024 --quality high --out-dir ./out/images
python3 {baseDir}/scripts/gen.py --model gpt-image-1.5 --background transparent --output-format webp
python3 {baseDir}/scripts/gen.py --model dall-e-3 --quality hd --size 1792x1024 --style vivid
```

默认输出目录：`~/Projects/tmp/openai-image-gen-*`（若存在）否则 `./tmp/...`。项目要用的资产必须拷进工作区，不要只留在临时目录。

## 模型参数摘要

| 模型         | size                                     | quality              | 其他                                                                        |
| ------------ | ---------------------------------------- | -------------------- | --------------------------------------------------------------------------- |
| gpt-image-\* | 1024x1024 / 1536x1024 / 1024x1536 / auto | auto/high/medium/low | `--background` transparent\|opaque\|auto；`--output-format` png\|jpeg\|webp |
| dall-e-3     | 1024x1024 / 1792x1024 / 1024x1792        | hd\|standard         | `--style` vivid\|natural；count 强制 1                                      |
| dall-e-2     | 256/512/1024                             | standard             | —                                                                           |

## 提示词与画廊

- 结构化提示与迭代：`references/prompting.md`
- 用例分类与样例：`references/sample-prompts.md`
- 批量：写出 `prompts.json` + `index.html` 缩略图画廊；项目交付物全部进工作区。
- 透明底：请求真正透明并保留 alpha；非破坏性保存（勿覆盖原资产，用 `*-v2.png` / `*-edited.png`）。

## 环境

- 需要 `OPENAI_API_KEY`；勿让用户在聊天里粘贴完整密钥。
- `uv pip install openai`（可选 pillow 做检查/缩放）。

## 不要 / 警告

- 平行新建 `imagegen` 技能名
- **警告：** 勿把 Codex 内置 `image_gen` / `$CODEX_HOME/generated_images` 当作唯一落点；交付进工作区。
- **警告：** 勿附带 `agents/openai.yaml` 或专有网络沙箱文档整包拷贝。
- 静默降级到用户未确认的模型

## 参考

- `references/prompting.md`
- `references/sample-prompts.md`
- `references/openbot-delivery.md`
- `ATTRIBUTION.md`
