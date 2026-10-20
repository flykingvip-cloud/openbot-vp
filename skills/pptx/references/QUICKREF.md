# PPTX Skill — Quick Reference

## Slide Type Cheat Sheet

| Type         | Method               | Key Args                                         |
| ------------ | -------------------- | ------------------------------------------------ |
| Cover        | `add_cover()`        | title, subtitle, author, date                    |
| Agenda       | `add_agenda()`       | items (list)                                     |
| Section      | `add_section()`      | num, label                                       |
| Exec Summary | `add_exec_summary()` | points (list)                                    |
| Text         | `add_text()`         | title, body (str/list)                           |
| Bullet       | `add_bullet()`       | title, bullets (list), two_column                |
| Two Column   | `add_two_column()`   | left_title, left_items, right_title, right_items |
| Table        | `add_table()`        | title, headers, rows                             |
| Matrix       | `add_matrix()`       | x_label, y_label, quadrants, marker              |
| Chart        | `add_chart_bar()`    | title, data (dict)                               |
| Quote        | `add_quote()`        | quote, author, source                            |
| Takeaway     | `add_takeaway()`     | points (list)                                    |
| Next Step    | `add_next_step()`    | steps [(num, action, owner),...]                 |
| Appendix     | `add_appendix()`     | items (list)                                     |
| Waterfall    | `add_waterfall()`    | title, steps [(label, delta, total),...]         |

## Theme Cheat Sheet

| Theme Name      | Use Case                             |
| --------------- | ------------------------------------ |
| `business_blue` | Default, consulting, finance, formal |
| `tech_dark`     | Tech, AI, data, modern               |
| `clean_light`   | Startup, marketing, clean            |

## Color Reference (business_blue)

```
primary    #1F4E79  (dark blue)   -- headers, backgrounds
secondary  #2E75B6  (blue)        -- section bars
accent     #5B9BD5  (light blue)  -- highlights, bullets
highlight  #ED7D31  (orange)      -- key numbers, emphasis
success    #70AD47  (green)       -- positive changes
danger     #FF0000  (red)         -- negative changes
text       #1F2D3D  (dark gray)   -- body text
gray2      #808080  (mid gray)     -- secondary text
gray4      #F2F2F2  (light gray)  -- table alternating rows
```

## Quick Start Code

```python
from pptx_engine import PresentationEngine

pe = PresentationEngine(
    title="My Report",
    theme="business_blue"
)

pe.add_cover(title="2024 Strategy Plan", subtitle="Annual Review")
pe.add_agenda(["Overview", "Analysis", "Recommendations"])
pe.add_exec_summary(["Finding 1", "Finding 2", "Recommendation"])

# Generate
out = pe.save("/path/to/output.pptx")
```

## File Locations

```
SKILL.md           -- This skill definition
scripts/
  pptx_engine.py   -- Core engine (import from here)
  office/         -- Dependencies (do not modify)
  node_modules/   -- pptxgenjs (Node.js fallback)
references/
  TEMPLATES.md    -- Slide structure templates
  QUICKREF.md     -- This file
assets/
  demo_output/    -- Generated demo PPTs
```
