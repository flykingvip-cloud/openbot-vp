# Publish Postmortem

This reference condenses the real failure patterns seen in the backend dialogue and workspace notes for the WeChat article workflow.

## Proven Failure Modes

### 1. Using the wrong upload API

- `media/upload` returns `media_id` but not a usable inline image URL.
- Draft publishing requires permanent material uploads:
  - cover: `material/add_material?type=thumb`
  - inline image: `material/add_material?type=image`

### 2. Mixing up `thumb` and `image`

- Cover uploads need `type=thumb` and produce `thumb_media_id`.
- Inline article images need `type=image` and produce `url`.
- Swapping them leads to `40007` or visually broken drafts.

### 3. Treating `errcode === 0` as enough

- A call can succeed structurally while still returning the wrong field for the next step.
- Validate the exact output contract after every step:
  - cover upload must return `media_id`
  - inline image upload must return `url`
  - draft creation must return `media_id`

### 4. Letting placeholder image URLs leak into HTML

- If the HTML still contains `ILLUS1_URL`-style placeholders, the draft will render broken images.
- Replace placeholders only after the real permanent-material URLs are returned.

## Operational Lessons From The Dialogue Record

- The assistant successfully organized `ASSET.md` and `SKILL.md`, but stopped at documentation cleanup instead of moving straight into asset-package submission.
- The missing step was not knowledge creation; it was transition guidance:
  - "`asset draft created`"
  - "`review package fields`"
  - "`submit to enterprise`"
- For employee UX, this means the product should treat "workflow organized successfully" as a trigger for a next-step submission CTA, not as the end of the journey.
