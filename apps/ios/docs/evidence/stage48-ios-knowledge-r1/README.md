# Stage 48 — iOS Knowledge R1 (Track A3)

Date: 2026-10-03 (Asia/Shanghai). Branch `app/stage48-ios-knowledge-r1` from `app/stage47-ios-tasks-r1` @ `49d26b95c81ceccd002d3cdd69b0ff123ab3a88c`.

Native SwiftUI only. `EmployeeRootTabs` still owns the phone shell. The Knowledge tab is not a WebView.

## Landed

- Knowledge tab title 「我的知识库」 sits above the search field (same order as Android stage38 / the old stub).
- Tree uses the chat-capsule catalog: `context.scope.sources.catalog`, then `knowledge.base.list` + `knowledge.base.sources.list`. Sections are 收藏 / 个人空间 / 团队空间 / 企业空间 / 其他. Knowledge and folder rows expand; file rows open the reader. Long-press a knowledge base toggles a local favorite (UserDefaults). No Gateway write.
- Search (2+ characters) calls `knowledge.search` with `{ query, limit: 20 }` after a short debounce, and also filters the tree locally.
- Document preview is fullscreen inside the tab (no left rail, no WebView). Body is `knowledge.document.preview` with `{ knowledgeBaseId, documentId, render: true }` (html or base64). Missing kb / offline / unreadable payload falls back to the same placeholder text Android uses.

## Not done, and why

- Create / rename / ⋯ write menus are an intentional gap (calibrated ignore). No `knowledge.base.create` or `knowledge.base.update`.
- HTML from preview is shown as plain text plus the Web caption, not a WKWebView. The tab body stays native.
- No private Gateway methods. No iOS-only DEMO catalog.

## Build evidence

1. `cd apps/ios && xcodebuild -scheme OpenBot -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5' build` → **BUILD SUCCEEDED** (2026-10-03 09:04 CST). SwiftFormat (lint) and SwiftLint run-script phases stayed on. New knowledge files had no lint violations. Pre-existing warnings (including `SettingsTab.swift` superfluous_disable_command) are untouched.

2. `xcodebuild -scheme OpenBotLogicTests -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5' -derivedDataPath /tmp/openbot-stage48-logic test -only-testing:OpenBotLogicTests/KnowledgeBrowserModelsTests` → **TEST SUCCEEDED**. Tree grouping, kb id walk, filter, search params/hits, preview base64/html, stub blocks, and favorite toggle passed.

## Files

- `apps/ios/Sources/MobileUI/KnowledgeTabView.swift` (replaces `KnowledgeTabStub.swift`)
- `apps/ios/Sources/MobileUI/KnowledgeBrowserModels.swift`
- `apps/ios/Sources/MobileUI/ChatKnowledgeCatalog.swift` (optional `visibility` for section groups)
- `apps/ios/Sources/MobileUI/EmployeeRootTabs.swift`
- `apps/ios/Tests/Logic/KnowledgeBrowserModelsTests.swift`
- `apps/ios/Tests/Logic/ChatKnowledgeCatalogTests.swift`
- `apps/ios/project.yml`
- `apps/ios/SwiftSources.input.xcfilelist`
