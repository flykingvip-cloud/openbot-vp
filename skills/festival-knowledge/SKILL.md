---
name: festival-knowledge
description: Comprehensive knowledge of Chinese traditional festivals — origins, customs, cultural significance, and modern relevance. Use when the user asks about: (1) The history and origin of a Chinese festival, (2) Traditional customs and their meanings, (3) Festival-related cultural knowledge for content creation, or (4) Any question about Chinese traditional festivals (Spring Festival, Qingming, Dragon Boat, Mid-Autumn, Double Ninth, Lantern Festival, etc.).
---

# Festival Knowledge

## Overview

This skill provides structured, authoritative knowledge about Chinese traditional festivals using a **three-layer framework** (ancient roots → historical figures → folk customs). Each festival has a dedicated reference file with standardized information.

## Usage

When asked about a festival:

1. **Identify the target festival** from the user's query
2. **Read the corresponding reference file** from `references/` (e.g., `references/dragon-boat.md`)
3. **Present the information** using the three-layer structure:
   - 🌿 **Ancient Roots** — Pre-history origins (astronomy, totem, seasonal)
   - 📜 **Historical Layer** — Figures and stories that shaped it
   - 🏮 **Folk Customs** — Traditions, foods, and practices today
4. **Tailor depth** to the user's context:
   - General Q&A → concise overview
   - Content creation → full structure with cultural details
   - Academic/research → include references and scholarly perspectives

## Festivals Covered

| Festival                      | Reference File              | When          |
| ----------------------------- | --------------------------- | ------------- |
| 端午节 (Dragon Boat Festival) | `references/dragon-boat.md` | Lunar May 5th |

_More festivals can be added by contributors following the same template format._

## Output Guidelines

- Start with a concise answer (30-50 words summary)
- Then expand using the three-layer structure
- Use **端午安康** rather than "端午快乐" when giving blessings
- Include emoji for visual memorability (🐉🌿🍙🚣)
- Adapt tone: narrative for casual chat, structured for professional needs
