#!/usr/bin/env python3

# -_- coding: utf-8 -_-

"""
AI应用交流活动 PPT 生成脚本
面向中小企业，主题：让AI从玩具到生产力
"""

from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
from pptx.util import Inches, Pt
import io, os

# ─── 颜色主题 ───────────────────────────────────────

C_DARK_BLUE = RGBColor(0x1A, 0x3A, 0x6C) # 深蓝（主色）
C_LIGHT_BLUE = RGBColor(0x29, 0x6B, 0xBF) # 亮蓝
C_ACCENT = RGBColor(0x00, 0xC9, 0xA7) # 青绿（强调）
C_ORANGE = RGBColor(0xFF, 0x8C, 0x00) # 橙色（数据高亮）
C_WHITE = RGBColor(0xFF, 0xFF, 0xFF)
C_LIGHT_GRAY = RGBColor(0xF5, 0xF7, 0xFA)
C_DARK_GRAY = RGBColor(0x2D, 0x3A, 0x4A)
C_MID_GRAY = RGBColor(0x8A, 0x99, 0xB4)

SLIDE_W = Inches(13.33)
SLIDE_H = Inches(7.5)

# ─── 工具函数 ───────────────────────────────────────

def solid_fill(shape, color):
shape.fill.solid()
shape.fill.fore_color.rgb = color

def add_rect(slide, l, t, w, h, color, alpha=1.0):
shape = slide.shapes.add_shape(1, l, t, w, h) # MSO_SHAPE_TYPE.RECTANGLE = 1
solid_fill(shape, color)
shape.line.fill.background()
return shape

def add_text_box(slide, text, l, t, w, h,
font_size=18, bold=False, color=C_WHITE,
align=PP_ALIGN.LEFT, italic=False, font_name="Microsoft YaHei"):
txBox = slide.shapes.add_textbox(l, t, w, h)
tf = txBox.text_frame
tf.word_wrap = True
p = tf.paragraphs[0]
p.alignment = align
run = p.add_run()
run.text = text
run.font.size = Pt(font_size)
run.font.bold = bold
run.font.italic = italic
run.font.color.rgb = color
run.font.name = font_name
return txBox

def add_bullet_textbox(slide, items, l, t, w, h,
font_size=16, color=C_DARK_GRAY,
bullet_color=C_ACCENT, font_name="Microsoft YaHei"):
txBox = slide.shapes.add_textbox(l, t, w, h)
tf = txBox.text_frame
tf.word_wrap = True
for i, item in enumerate(items):
if i == 0:
p = tf.paragraphs[0]
else:
p = tf.add_paragraph()
p.space_before = Pt(8)
run = p.add_run()
run.text = item
run.font.size = Pt(font_size)
run.font.color.rgb = color
run.font.name = font_name
return txBox

def set_slide_bg(slide, color):
background = slide.background
fill = background.fill
fill.solid()
fill.fore_color.rgb = color

def add_divider_line(slide, l, t, w, color=C_ACCENT, thickness=Pt(3)):
line = slide.shapes.add_shape(1, l, t, w, Pt(3))
solid_fill(line, color)
line.line.fill.background()

def add_icon_badge(slide, icon_text, l, t, size=Inches(0.55), bg_color=C_ACCENT):
shape = slide.shapes.add_shape(9, l, t, size, size) # rounded rectangle
solid_fill(shape, bg_color)
shape.line.fill.background()
tb = slide.shapes.add_textbox(l, t + Pt(4), size, size)
p = tb.text_frame.paragraphs[0]
p.alignment = PP_ALIGN.CENTER
run = p.add_run()
run.text = icon_text
run.font.size = Pt(18)
run.font.bold = True
run.font.color.rgb = C_WHITE
run.font.name = "Arial"
return shape

# ════════════════════════════════════════════════════

# PPT 生成

# ════════════════════════════════════════════════════

prs = Presentation()
prs.slide_width = SLIDE_W
prs.slide_height = SLIDE_H

BLANK_LAYOUT = prs.slide_layouts[6] # 完全空白

# ┌─────────────────────────────────────────────────┐

# Slide 1 — 封面

# └─────────────────────────────────────────────────┘

def make_cover(prs):
slide = prs.slides.add_slide(BLANK_LAYOUT)
set_slide_bg(slide, C_DARK_BLUE)

    # 右侧装饰圆形
    add_rect(slide,
             Inches(9.5), Inches(-1.5),
             Inches(5), Inches(5.5),
             C_LIGHT_BLUE)
    add_rect(slide,
             Inches(10.8), Inches(4),
             Inches(4), Inches(5),
             C_ACCENT)

    # 左上角标签
    add_icon_badge(slide, "🎯", Inches(0.8), Inches(0.6))

    # 主标题
    add_text_box(slide,
                 "AI赋能中小企业",
                 Inches(0.8), Inches(1.8),
                 Inches(8.5), Inches(1.2),
                 font_size=48, bold=True, color=C_WHITE)

    # 副标题
    add_text_box(slide,
                 "从概念到落地的实战指南",
                 Inches(0.8), Inches(3.1),
                 Inches(8), Inches(0.8),
                 font_size=26, bold=False, color=C_ACCENT)

    # 描述
    add_text_box(slide,
                 "让每一家中小企业都能用得起、用得好AI",
                 Inches(0.8), Inches(4.0),
                 Inches(7.5), Inches(0.6),
                 font_size=16, color=C_MID_GRAY)

    # 底部信息栏
    add_rect(slide, Inches(0), Inches(6.2), SLIDE_W, Inches(1.3), C_LIGHT_BLUE)
    add_text_box(slide, "AI应用交流活动 · 2026",
                 Inches(0.8), Inches(6.45), Inches(5), Inches(0.5),
                 font_size=14, color=C_WHITE)
    add_text_box(slide, "面向群体：中小企业管理者 / 业务负责人",
                 Inches(6), Inches(6.45), Inches(6.5), Inches(0.5),
                 font_size=14, color=C_WHITE, align=PP_ALIGN.RIGHT)

# ┌─────────────────────────────────────────────────┐

# Slide 2 — 为什么现在必须关注AI

# └─────────────────────────────────────────────────┘

def make_why_now(prs):
slide = prs.slides.add_slide(BLANK_LAYOUT)
set_slide_bg(slide, C_LIGHT_GRAY)

    # 顶部深色条
    add_rect(slide, Inches(0), Inches(0), SLIDE_W, Inches(1.1), C_DARK_BLUE)
    add_text_box(slide, "为什么现在必须关注AI？",
                 Inches(0.6), Inches(0.25), Inches(10), Inches(0.7),
                 font_size=28, bold=True, color=C_WHITE)

    # 3个数据卡片
    cards = [
        ("💰", "60%", "AI可替代50%以上的\n重复性工作", C_ORANGE),
        ("📈", "40%", "首批AI落地企业\n效率提升超过40%", C_LIGHT_BLUE),
        ("⏱️", "3个月", "从0到AI Pilot\n最快只需3个月", C_ACCENT),
    ]
    for i, (icon, num, desc, col) in enumerate(cards):
        x = Inches(0.6 + i * 4.2)
        # 卡片背景
        card = slide.shapes.add_shape(1, x, Inches(1.5), Inches(3.9), Inches(3.0))
        solid_fill(card, C_WHITE)
        card.line.fill.background()
        # 顶部色条
        add_rect(slide, x, Inches(1.5), Inches(3.9), Inches(0.12), col)
        # 数字
        add_text_box(slide, num, x + Inches(0.2), Inches(1.85),
                     Inches(3.5), Inches(1.0),
                     font_size=52, bold=True, color=col)
        # 描述
        add_text_box(slide, desc, x + Inches(0.2), Inches(3.0),
                     Inches(3.5), Inches(1.2),
                     font_size=15, color=C_DARK_GRAY)
        # 图标
        add_text_box(slide, icon, x + Inches(2.9), Inches(1.6),
                     Inches(0.8), Inches(0.8),
                     font_size=32)

    # 底部结论
    add_rect(slide, Inches(0.6), Inches(4.9), Inches(12.1), Inches(0.9), C_DARK_BLUE)
    add_text_box(slide,
                 "结论：AI已从"前沿科技"变为"商业基础设施"，不跟进 = 主动放弃竞争力",
                 Inches(0.8), Inches(5.05), Inches(11.8), Inches(0.6),
                 font_size=16, bold=True, color=C_ACCENT)

# ┌─────────────────────────────────────────────────┐

# Slide 3 — 中小企业AI应用现状

# └─────────────────────────────────────────────────┘

def make_status(prs):
slide = prs.slides.add_slide(BLANK_LAYOUT)
set_slide_bg(slide, C_WHITE)

    add_rect(slide, Inches(0), Inches(0), SLIDE_W, Inches(1.1), C_DARK_BLUE)
    add_text_box(slide, "中小企业AI应用现状",
                 Inches(0.6), Inches(0.25), Inches(10), Inches(0.7),
                 font_size=28, bold=True, color=C_WHITE)

    # 左侧：现状数据条
    pains = [
        ("听说过AI，不知道怎么用", 78, C_ORANGE),
        ("试过工具但没坚持下来", 55, C_LIGHT_BLUE),
        ("担心成本太高、门槛太高", 67, C_ACCENT),
        ("缺乏专业人才和指导", 72, C_DARK_BLUE),
    ]
    add_text_box(slide, "常见困境",
                 Inches(0.6), Inches(1.35), Inches(3.5), Inches(0.5),
                 font_size=18, bold=True, color=C_DARK_GRAY)
    for i, (label, pct, col) in enumerate(pains):
        y = Inches(1.9 + i * 1.15)
        # 标签
        add_text_box(slide, label, Inches(0.6), y, Inches(4), Inches(0.45),
                     font_size=13, color=C_DARK_GRAY)
        # 进度条底
        add_rect(slide, Inches(0.6), y + Inches(0.5), Inches(5.0), Inches(0.22),
                 RGBColor(0xE8, 0xED, 0xF4))
        # 进度条填充
        bar_w = 5.0 * pct / 100
        add_rect(slide, Inches(0.6), y + Inches(0.5), Inches(bar_w), Inches(0.22), col)
        # 百分比
        add_text_box(slide, f"{pct}%", Inches(5.7), y + Inches(0.4),
                     Inches(0.6), Inches(0.4),
                     font_size=13, bold=True, color=col)

    # 右侧：核心痛点总结
    add_rect(slide, Inches(7.3), Inches(1.4), Inches(5.5), Inches(4.8), C_DARK_BLUE)
    add_text_box(slide, "🔑 核心痛点",
                 Inches(7.6), Inches(1.7), Inches(5), Inches(0.6),
                 font_size=20, bold=True, color=C_ACCENT)
    pain_points = [
        "认知断层：知道AI有用，不知道从哪切入",
        "工具迷阵：几百种工具，不知道哪个适合自己",
        "人才缺口：没有AI专家，不敢轻易尝试",
        "ROI模糊：不确定投入产出比，不敢下注",
    ]
    for i, pt in enumerate(pain_points):
        add_text_box(slide, f"▶  {pt}",
                     Inches(7.6), Inches(2.4 + i * 0.85),
                     Inches(5), Inches(0.75),
                     font_size=14, color=C_WHITE)

# ┌─────────────────────────────────────────────────┐

# Slide 4 — AI能帮企业做什么

# └─────────────────────────────────────────────────┘

def make_what_can(prs):
slide = prs.slides.add_slide(BLANK_LAYOUT)
set_slide_bg(slide, C_LIGHT_GRAY)

    add_rect(slide, Inches(0), Inches(0), SLIDE_W, Inches(1.1), C_DARK_BLUE)
    add_text_box(slide, "AI能帮企业做什么？",
                 Inches(0.6), Inches(0.25), Inches(10), Inches(0.7),
                 font_size=28, bold=True, color=C_WHITE)

    scenes = [
        ("🤖", "智能客服", "7×24在线\n降低人工成本60%", C_LIGHT_BLUE),
        ("✍️", "内容营销", "文案/配图/视频\n效率提升5-10倍", C_ACCENT),
        ("📊", "办公提效", "会议纪要/报表\n每月节省40+小时", C_ORANGE),
        ("📉", "数据分析", "自然语言查询\n无需SQL基础", C_DARK_BLUE),
    ]
    for i, (icon, title, desc, col) in enumerate(scenes):
        x = Inches(0.6 + i * 3.2)
        # 卡片
        card = slide.shapes.add_shape(1, x, Inches(1.5), Inches(2.9), Inches(4.8))
        solid_fill(card, C_WHITE)
        card.line.fill.background()
        # 顶部色块
        add_rect(slide, x, Inches(1.5), Inches(2.9), Inches(1.3), col)
        # 图标
        add_text_box(slide, icon, x + Inches(0.9), Inches(1.65),
                     Inches(1.1), Inches(1.0),
                     font_size=40, align=PP_ALIGN.CENTER)
        # 标题
        add_text_box(slide, title, x + Inches(0.15), Inches(3.0),
                     Inches(2.6), Inches(0.6),
                     font_size=18, bold=True, color=C_DARK_GRAY,
                     align=PP_ALIGN.CENTER)
        # 描述
        add_text_box(slide, desc, x + Inches(0.15), Inches(3.7),
                     Inches(2.6), Inches(1.8),
                     font_size=13, color=C_MID_GRAY,
                     align=PP_ALIGN.CENTER)

# ┌─────────────────────────────────────────────────┐

# Slide 5 — 场景一：智能客服

# └─────────────────────────────────────────────────┘

def make_scene_customer(prs):
slide = prs.slides.add_slide(BLANK_LAYOUT)
set_slide_bg(slide, C_WHITE)

    add_rect(slide, Inches(0), Inches(0), SLIDE_W, Inches(1.1), C_LIGHT_BLUE)
    add_text_box(slide, "场景一：智能客服 🤖",
                 Inches(0.6), Inches(0.25), Inches(10), Inches(0.7),
                 font_size=28, bold=True, color=C_WHITE)

    # 左侧方案
    add_text_box(slide, "解决方案",
                 Inches(0.6), Inches(1.35), Inches(3), Inches(0.5),
                 font_size=16, bold=True, color=C_LIGHT_BLUE)
    solution_items = [
        "接入企业微信/网站/小程序",
        "基于知识库的智能问答",
        "复杂问题无缝转人工",
        "7×24全天候在线",
    ]
    for i, item in enumerate(solution_items):
        add_text_box(slide, f"✅  {item}",
                     Inches(0.6), Inches(1.9 + i * 0.65),
                     Inches(4.5), Inches(0.55),
                     font_size=14, color=C_DARK_GRAY)

    # 中间案例
    add_rect(slide, Inches(5.3), Inches(1.4), Inches(3.8), Inches(5.0), C_LIGHT_GRAY)
    add_text_box(slide, "📋 案例：某电商公司",
                 Inches(5.5), Inches(1.6), Inches(3.5), Inches(0.5),
                 font_size=14, bold=True, color=C_DARK_GRAY)
    case_text = [
        "上线前：2名客服，响应慢",
        "↓",
        "接入AI客服机器人后：",
        "  • 日均处理咨询 800+ 条",
        "  • 人工介入率降至 20%",
        "  • 客服成本下降 55%",
        "  • 客户满意度提升至 92%",
    ]
    for i, line in enumerate(case_text):
        add_text_box(slide, line,
                     Inches(5.5), Inches(2.2 + i * 0.52),
                     Inches(3.5), Inches(0.5),
                     font_size=12, color=C_DARK_GRAY)

    # 右侧效果指标
    add_text_box(slide, "效果对比",
                 Inches(9.5), Inches(1.35), Inches(3.3), Inches(0.5),
                 font_size=16, bold=True, color=C_LIGHT_BLUE)
    metrics = [
        ("人工响应时间", "平均15分钟", "AI即时响应"),
        ("运行时间", "8小时", "7×24小时"),
        ("成本", "2人/月", "约0.3人/月"),
        ("覆盖率", "60%", "95%+"),
    ]
    for i, (label, before, after) in enumerate(metrics):
        y = Inches(1.9 + i * 1.0)
        add_rect(slide, Inches(9.5), y, Inches(3.3), Inches(0.85), C_LIGHT_GRAY)
        add_text_box(slide, label, Inches(9.6), y + Pt(4),
                     Inches(3.1), Inches(0.35),
                     font_size=11, bold=True, color=C_DARK_GRAY)
        add_text_box(slide, f"前：{before}  →  后：{after}",
                     Inches(9.6), y + Pt(26),
                     Inches(3.1), Inches(0.35),
                     font_size=11, color=C_MID_GRAY)

# ┌─────────────────────────────────────────────────┐

# Slide 6 — 场景二：内容营销

# └─────────────────────────────────────────────────┘

def make_scene_marketing(prs):
slide = prs.slides.add_slide(BLANK_LAYOUT)
set_slide_bg(slide, C_WHITE)

    add_rect(slide, Inches(0), Inches(0), SLIDE_W, Inches(1.1), C_ACCENT)
    add_text_box(slide, "场景二：内容营销 ✍️",
                 Inches(0.6), Inches(0.25), Inches(10), Inches(0.7),
                 font_size=28, bold=True, color=C_WHITE)

    # 工具链
    tools = [
        ("📝", "文案生成", "ChatGPT/Kimi", "产品文案、朋友圈、朋友圈文案"),
        ("🖼️", "图片生成", "Midjourney/通义", "海报、社媒配图、电商主图"),
        ("🎬", "视频脚本", "ChatGPT+剪映", "短视频脚本、分镜设计"),
        ("📧", "邮件营销", "Claude/Gemini", "个性化邮件、群发模板"),
    ]
    for i, (icon, title, tool, use_case) in enumerate(tools):
        x = Inches(0.6 + (i % 2) * 6.3)
        y = Inches(1.4 + (i // 2) * 2.8)
        add_rect(slide, x, y, Inches(5.9), Inches(2.5), C_LIGHT_GRAY)
        add_rect(slide, x, y, Inches(0.12), Inches(2.5), C_ACCENT)
        add_text_box(slide, icon + " " + title,
                     x + Inches(0.3), y + Inches(0.2),
                     Inches(5.4), Inches(0.6),
                     font_size=18, bold=True, color=C_DARK_GRAY)
        add_text_box(slide, f"推荐工具：{tool}",
                     x + Inches(0.3), y + Inches(0.9),
                     Inches(5.4), Inches(0.45),
                     font_size=13, bold=True, color=C_ACCENT)
        add_text_box(slide, f"适用场景：{use_case}",
                     x + Inches(0.3), y + Inches(1.4),
                     Inches(5.4), Inches(0.9),
                     font_size=13, color=C_MID_GRAY)

    # 底部效果
    add_rect(slide, Inches(0.6), Inches(6.7), Inches(12.1), Inches(0.6), C_DARK_BLUE)
    add_text_box(slide,
                 "💡 实际效果：一家小微企业使用AI工具后，内容产出从每月10篇提升至80篇，成本降低70%",
                 Inches(0.8), Inches(6.8), Inches(11.8), Inches(0.45),
                 font_size=14, color=C_ACCENT)

# ┌─────────────────────────────────────────────────┐

# Slide 7 — 场景三：办公提效

# └─────────────────────────────────────────────────┘

def make_scene_office(prs):
slide = prs.slides.add_slide(BLANK_LAYOUT)
set_slide_bg(slide, C_LIGHT_GRAY)

    add_rect(slide, Inches(0), Inches(0), SLIDE_W, Inches(1.1), C_DARK_BLUE)
    add_text_box(slide, "场景三：办公提效 📊",
                 Inches(0.6), Inches(0.25), Inches(10), Inches(0.7),
                 font_size=28, bold=True, color=C_WHITE)

    tasks = [
        ("📝", "会议纪要", "将1小时会议录音\n秒生成结构化纪要", "Otter.ai / 通义听悟"),
        ("📈", "数据报表", "自然语言描述需求\nAI自动生成Excel", "ChatGPT / 轻流"),
        ("📧", "邮件处理", "AI起草、润色、翻译\n批量回复客户邮件", "Claude / Gmail AI"),
        ("📋", "文档整理", "长文本摘要、提取关键信息\n快速生成汇报PPT", "Kimi / Gamma.ai"),
        ("📅", "日程管理", "AI解读日历空闲时间\n智能安排会议和行程", "Clockwise / Reclaim"),
        ("🔍", "资料检索", "上传PDF/Word后\n用自然语言问答找答案", "Notion AI / ChatDOC"),
    ]
    for i, (icon, title, desc, tool) in enumerate(tasks):
        col = i % 3
        row = i // 3
        x = Inches(0.6 + col * 4.2)
        y = Inches(1.4 + row * 2.8)
        card = slide.shapes.add_shape(1, x, y, Inches(3.9), Inches(2.5))
        solid_fill(card, C_WHITE)
        card.line.fill.background()
        add_rect(slide, x, y, Inches(3.9), Inches(0.1), C_LIGHT_BLUE)
        add_text_box(slide, f"{icon} {title}", x + Inches(0.2), y + Inches(0.25),
                     Inches(3.5), Inches(0.55),
                     font_size=16, bold=True, color=C_DARK_GRAY)
        add_text_box(slide, desc, x + Inches(0.2), y + Inches(0.85),
                     Inches(3.5), Inches(0.9),
                     font_size=12, color=C_MID_GRAY)
        add_text_box(slide, f"🔧 {tool}", x + Inches(0.2), y + Inches(1.85),
                     Inches(3.5), Inches(0.45),
                     font_size=11, bold=True, color=C_LIGHT_BLUE)

# ┌─────────────────────────────────────────────────┐

# Slide 8 — 场景四：数据分析

# └─────────────────────────────────────────────────┘

def make_scene_data(prs):
slide = prs.slides.add_slide(BLANK_LAYOUT)
set_slide_bg(slide, C_WHITE)

    add_rect(slide, Inches(0), Inches(0), SLIDE_W, Inches(1.1), C_ORANGE)
    add_text_box(slide, "场景四：数据分析 📉",
                 Inches(0.6), Inches(0.25), Inches(10), Inches(0.7),
                 font_size=28, bold=True, color=C_WHITE)

    # 左侧：痛点 vs 方案
    add_rect(slide, Inches(0.6), Inches(1.4), Inches(5.8), Inches(1.5), C_LIGHT_GRAY)
    add_text_box(slide, "😰 传统方式痛点",
                 Inches(0.8), Inches(1.55), Inches(5.5), Inches(0.45),
                 font_size=14, bold=True, color=C_ORANGE)
    add_text_box(slide,
                 "• 需要写SQL代码，需工程师支持\n"
                 "• 数据分散在多个Excel/系统里\n"
                 "• 分析一个数据需求，排队等3-5天",
                 Inches(0.8), Inches(2.05), Inches(5.5), Inches(0.8),
                 font_size=12, color=C_DARK_GRAY)

    add_rect(slide, Inches(0.6), Inches(3.05), Inches(5.8), Inches(1.5), C_LIGHT_GRAY)
    add_text_box(slide, "🚀 AI方式优势",
                 Inches(0.8), Inches(3.2), Inches(5.5), Inches(0.45),
                 font_size=14, bold=True, color=C_ACCENT)
    add_text_box(slide,
                 "• 直接用中文提问：'本月销售额是多少？'\n"
                 "• AI自动生成SQL/图表，几秒出结果\n"
                 "• 无需任何编程基础，人人都是分析师",
                 Inches(0.8), Inches(3.7), Inches(5.5), Inches(0.8),
                 font_size=12, color=C_DARK_GRAY)

    # 右侧：示例对话
    add_rect(slide, Inches(6.8), Inches(1.4), Inches(5.9), Inches(5.0), C_DARK_BLUE)
    add_text_box(slide, "💬 自然语言查询示例",
                 Inches(7.0), Inches(1.6), Inches(5.5), Inches(0.5),
                 font_size=14, bold=True, color=C_ACCENT)

    examples = [
        ("用户问", "本月各区域销售额排名？"),
        ("AI回答", "华东 280万 / 华南 210万 / 华北 195万\n（附柱状图）", C_ACCENT),
        ("用户问", "哪些客户30天没下单了？"),
        ("AI回答", "共47个客户，列表如下（可一键导出）", C_ACCENT),
        ("用户问", "本月退货率比上月高多少？"),
        ("AI回答", "退货率从 3.2% 升至 5.1%，增加1.9个百分点\n主要来源：广州仓、服装品类", C_ACCENT),
    ]
    for i, (role, text, *extra) in enumerate(examples):
        col = C_LIGHT_GRAY if role == "用户问" else RGBColor(0x22, 0x55, 0x88)
        txt_col = C_DARK_GRAY if role == "用户问" else C_WHITE
        y = Inches(2.2 + i * 0.75)
        badge_col = C_ORANGE if role == "用户问" else C_ACCENT
        badge = slide.shapes.add_shape(1, Inches(7.0), y, Inches(0.7), Inches(0.4))
        solid_fill(badge, badge_col)
        badge.line.fill.background()
        add_text_box(slide, "👉" if role == "用户问" else "🤖",
                     Inches(7.0), y, Inches(0.7), Inches(0.4),
                     font_size=11, color=C_WHITE, align=PP_ALIGN.CENTER)
        add_text_box(slide, text,
                     Inches(7.8), y, Inches(4.8), Inches(0.65),
                     font_size=11, color=txt_col)

# ┌─────────────────────────────────────────────────┐

# Slide 9 — 中小企业落地路径

# └─────────────────────────────────────────────────┘

def make_path(prs):
slide = prs.slides.add_slide(BLANK_LAYOUT)
set_slide_bg(slide, C_LIGHT_GRAY)

    add_rect(slide, Inches(0), Inches(0), SLIDE_W, Inches(1.1), C_DARK_BLUE)
    add_text_box(slide, "中小企业AI落地路径",
                 Inches(0.6), Inches(0.25), Inches(10), Inches(0.7),
                 font_size=28, bold=True, color=C_WHITE)

    steps = [
        ("1️⃣", "试点阶段", "1-2个月", C_LIGHT_BLUE,
         ["选择1个高频痛点场景",
          "选定1-2款易用工具",
          "小范围试用，收集反馈",
          "验证ROI，确认方向"]),
        ("2️⃣", "扩展阶段", "3-6个月", C_ACCENT,
         ["将成功经验复制到更多场景",
          "建立企业内部AI使用规范",
          "培训员工，降低使用门槛",
          "接入业务流程，形成习惯"]),
        ("3️⃣", "深化阶段", "6个月以上", C_ORANGE,
         ["建立专属知识库",
          "打通内部系统数据",
          "探索私有化部署（可选）",
          "形成企业AI竞争优势"]),
    ]
    for i, (num, title, timeline, col, items) in enumerate(steps):
        x = Inches(0.5 + i * 4.3)
        # 卡片
        card = slide.shapes.add_shape(1, x, Inches(1.4), Inches(4.0), Inches(5.0))
        solid_fill(card, C_WHITE)
        card.line.fill.background()
        # 顶部
        add_rect(slide, x, Inches(1.4), Inches(4.0), Inches(1.3), col)
        add_text_box(slide, num, x + Inches(0.2), Inches(1.55),
                     Inches(3.6), Inches(0.7),
                     font_size=28, bold=True, color=C_WHITE)
        add_text_box(slide, title, x + Inches(0.2), Inches(2.2),
                     Inches(3.6), Inches(0.45),
                     font_size=18, bold=True, color=C_WHITE)
        # 时间标签
        add_rect(slide, x + Inches(2.7), Inches(2.15), Inches(1.1), Inches(0.38), C_DARK_BLUE)
        add_text_box(slide, timeline, x + Inches(2.7), Inches(2.18),
                     Inches(1.1), Inches(0.32),
                     font_size=10, color=C_WHITE, align=PP_ALIGN.CENTER)
        # 事项
        for j, item in enumerate(items):
            add_text_box(slide, f"• {item}",
                         x + Inches(0.25), Inches(2.9 + j * 0.65),
                         Inches(3.6), Inches(0.55),
                         font_size=13, color=C_DARK_GRAY)
        # 箭头
        if i < 2:
            add_text_box(slide, "→",
                         x + Inches(4.05), Inches(3.6),
                         Inches(0.4), Inches(0.6),
                         font_size=30, bold=True, color=C_MID_GRAY)

# ┌─────────────────────────────────────────────────┐

# Slide 10 — 工具推荐清单

# └─────────────────────────────────────────────────┘

def make_tools(prs):
slide = prs.slides.add_slide(BLANK_LAYOUT)
set_slide_bg(slide, C_WHITE)

    add_rect(slide, Inches(0), Inches(0), SLIDE_W, Inches(1.1), C_DARK_BLUE)
    add_text_box(slide, "工具推荐清单（免费/低成本）",
                 Inches(0.6), Inches(0.25), Inches(10), Inches(0.7),
                 font_size=28, bold=True, color=C_WHITE)

    categories = [
        ("🤖  AI助手", C_LIGHT_BLUE, [
            "ChatGPT (免费版) - 通用对话",
            "Kimi (免费) - 长文本处理",
            "通义千问 (免费) - 中文场景",
            "Claude (付费$20/月) - 办公写作",
        ]),
        ("✍️  内容创作", C_ACCENT, [
            "ChatGPT - 文案生成",
            "Canva AI - 海报设计",
            "剪映AI - 视频剪辑",
            "Midjourney (付费) - 图片生成",
        ]),
        ("📊  办公提效", C_ORANGE, [
            "通义听悟 - 会议转录",
            "Notion AI - 文档整理",
            "Gamma - AI生成PPT",
            "GitMind - AI思维导图",
        ]),
        ("💬  客服营销", C_DARK_BLUE, [
            "OpenBot - 智能客服/微信接入",
            "Intercom (付费) - 客服平台",
            "ManyChat (免费基础) - 社交客服",
            "LeadsBridge - 线索管理",
        ]),
    ]
    for i, (cat_title, col, tools_list) in enumerate(categories):
        col_idx = i % 2
        row_idx = i // 2
        x = Inches(0.6 + col_idx * 6.4)
        y = Inches(1.35 + row_idx * 3.0)
        add_rect(slide, x, y, Inches(6.0), Inches(2.7), C_LIGHT_GRAY)
        add_rect(slide, x, y, Inches(6.0), Inches(0.5), col)
        add_text_box(slide, cat_title, x + Inches(0.2), y + Pt(6),
                     Inches(5.6), Inches(0.4),
                     font_size=15, bold=True, color=C_WHITE)
        for j, tool in enumerate(tools_list):
            add_text_box(slide, f"• {tool}",
                         x + Inches(0.2), y + Inches(0.65 + j * 0.48),
                         Inches(5.6), Inches(0.42),
                         font_size=12, color=C_DARK_GRAY)

# ┌─────────────────────────────────────────────────┐

# Slide 11 — 避坑指南

# └─────────────────────────────────────────────────┘

def make_pitfalls(prs):
slide = prs.slides.add_slide(BLANK_LAYOUT)
set_slide_bg(slide, C_LIGHT_GRAY)

    add_rect(slide, Inches(0), Inches(0), SLIDE_W, Inches(1.1), C_ORANGE)
    add_text_box(slide, "避坑指南 ⚠️ 常见3大误区",
                 Inches(0.6), Inches(0.25), Inches(10), Inches(0.7),
                 font_size=28, bold=True, color=C_WHITE)

    pitfalls = [
        ("❌ 误区一", "盲目追求大模型，忽视实际需求",
         "很多企业一上来就要部署GPT-4、Llama，\n结果员工根本用不起来。",
         "✅ 先从简单工具入手，用免费版验证场景，\n有效果再考虑付费升级。",
         C_LIGHT_BLUE),
        ("❌ 误区二", "把AI当万能药，期待立竿见影",
         "以为上一套AI系统就能解决所有问题，\n没考虑流程改造和人员适应。",
         "✅ AI是工具，需要配套的流程优化和培训，\n设定合理预期，小步快跑。",
         C_ACCENT),
        ("❌ 误区三", "数据安全意识薄弱，忽视合规",
         "随意把客户数据发给第三方AI，\n没有数据脱敏和访问控制。",
         "✅ 选择有数据安全认证的工具，\n敏感数据先做脱敏处理，了解合规要求。",
         C_DARK_BLUE),
    ]
    for i, (badge, title, wrong, right, col) in enumerate(pitfalls):
        y = Inches(1.3 + i * 2.05)
        add_rect(slide, Inches(0.6), y, Inches(12.1), Inches(1.85), C_WHITE)
        add_rect(slide, Inches(0.6), y, Inches(0.12), Inches(1.85), col)
        add_text_box(slide, badge,
                     Inches(0.9), y + Inches(0.1),
                     Inches(2), Inches(0.4),
                     font_size=12, bold=True, color=col)
        add_text_box(slide, title,
                     Inches(2.8), y + Inches(0.1),
                     Inches(9.7), Inches(0.4),
                     font_size=15, bold=True, color=C_DARK_GRAY)
        add_text_box(slide, wrong,
                     Inches(0.9), y + Inches(0.5),
                     Inches(5.5), Inches(0.85),
                     font_size=12, color=C_MID_GRAY)
        add_text_box(slide, right,
                     Inches(6.5), y + Inches(0.5),
                     Inches(6.0), Inches(0.85),
                     font_size=12, bold=True, color=C_ACCENT)

# ┌─────────────────────────────────────────────────┐

# Slide 12 — 总结 & Q&A

# └─────────────────────────────────────────────────┘

def make_qa(prs):
slide = prs.slides.add_slide(BLANK_LAYOUT)
set_slide_bg(slide, C_DARK_BLUE)

    # 装饰
    add_rect(slide, Inches(9.0), Inches(0), Inches(4.33), Inches(3.5), C_LIGHT_BLUE)
    add_rect(slide, Inches(10.5), Inches(3.5), Inches(2.83), Inches(4), C_ACCENT)

    add_text_box(slide, "核心观点回顾 📌",
                 Inches(0.8), Inches(0.6), Inches(8), Inches(0.7),
                 font_size=30, bold=True, color=C_ACCENT)

    summary = [
        "1. AI已不是选择题，而是生存题 —— 越早入场，成本越低",
        "2. 从1个痛点开始，用免费工具试点，不要贪大求全",
        "3. AI是助手不是替代者，最终价值靠人来实现",
        "4. 安全合规是底线，数据保护意识不能少",
        "5. 持续学习，AI迭代很快，保持跟进才能保持优势",
    ]
    for i, line in enumerate(summary):
        add_text_box(slide, line,
                     Inches(0.8), Inches(1.5 + i * 0.72),
                     Inches(11.5), Inches(0.6),
                     font_size=16, color=C_WHITE)

    # 分隔线
    add_rect(slide, Inches(0.8), Inches(5.1), Inches(11.5), Inches(0.05), C_MID_GRAY)

    # Q&A
    add_text_box(slide, "Q & A",
                 Inches(0.8), Inches(5.35), Inches(4), Inches(1.0),
                 font_size=44, bold=True, color=C_WHITE)
    add_text_box(slide, "欢迎提问！",
                 Inches(0.8), Inches(6.35), Inches(4), Inches(0.5),
                 font_size=18, color=C_ACCENT)

    add_text_box(slide, "📧 daniel.hhd@gmail.com\n🔧 openbot | 技能孵化专家",
                 Inches(7.5), Inches(5.8), Inches(5), Inches(1.2),
                 font_size=13, color=C_MID_GRAY, align=PP_ALIGN.RIGHT)

# ─── 生成所有幻灯片 ────────────────────────────────

make_cover(prs)
make_why_now(prs)
make_status(prs)
make_what_can(prs)
make_scene_customer(prs)
make_marketing = make_scene_marketing(prs)
make_office = make_scene_office(prs)
make_data = make_scene_data(prs)
make_path(prs)
make_tools(prs)
make_pitfalls(prs)
make_qa(prs)

# ─── 保存 ─────────────────────────────────────────

output*path = "/Users/daniel/AI应用交流活动*中小企业AI落地指南.pptx"
prs.save(output_path)
print(f"✅ PPT已生成：{output_path}")
