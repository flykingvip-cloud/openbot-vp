import Foundation
import Testing

struct KnowledgeBrowserModelsTests {
    @Test func `tree groups personal team enterprise`() {
        let items = Self.demoCatalog()
        let tree = buildKnowledgeCatalogTree(items)
        #expect(tree.map { knowledgeBrowserSectionLabel($0.id) } == ["个人空间", "团队空间", "企业空间"])
        #expect(tree[0].nodes[0].item.label == "个人成果")
        #expect(tree[0].nodes[0].children.contains { $0.item.label == "入职流程手册" })
    }

    @Test func `resolve knowledge base ID walks to parent`() throws {
        let items = Self.demoCatalog()
        let file = items.first { $0.sourceID == "doc-onboarding" }
        #expect(file != nil)
        #expect(try resolveKnowledgeBaseID(#require(file), catalog: items) == "kb-personal-achievements")
    }

    @Test func `filter expands matching parent`() {
        let tree = buildKnowledgeCatalogTree(Self.demoCatalog())
        let filtered = filterKnowledgeCatalogTree(tree, query: "入职")
        #expect(filtered.expandedKeys.contains("knowledge:kb-personal-achievements"))
        let labels = filtered.groups.flatMap(\.nodes).flatMap { [$0.item.label] + $0.children.map(\.item.label) }
        #expect(labels.contains("入职流程手册"))
    }

    @Test func `parse preview decodes base 64`() {
        let text = "# Hello\n\nBody line"
        let b64 = Data(text.utf8).base64EncodedString()
        let payload = """
        {"filename":"手册.md","mimeType":"text/markdown","base64":"\(b64)"}
        """
        let parsed = parseKnowledgeDocumentPreviewPayload(payload, fallbackTitle: "fallback")
        #expect(parsed?.title == "手册.md")
        #expect(parsed?.markdownOrPlain.contains("Body line") == true)
        #expect(parsed?.fromPreview == true)
        #expect(parsed?.htmlSource == nil)
    }

    @Test func `parse preview keeps HTML source`() {
        let payload = """
        {"filename":"a.html","html":"<p>Hello</p>","renderKind":"html"}
        """
        let parsed = parseKnowledgeDocumentPreviewPayload(payload, fallbackTitle: "fallback")
        #expect(parsed?.title == "a.html")
        #expect(parsed?.htmlSource == "<p>Hello</p>")
        #expect(parsed?.markdownOrPlain.contains("Hello") == true)
    }

    @Test func `preview params include render flag`() {
        let json = buildKnowledgeDocumentPreviewParams(knowledgeBaseId: "kb-1", documentId: "doc-1")
        #expect(json.contains("\"knowledgeBaseId\":\"kb-1\""))
        #expect(json.contains("\"documentId\":\"doc-1\""))
        #expect(json.contains("\"render\":true"))
    }

    @Test func `search params include query`() {
        let json = buildKnowledgeSearchParams(query: "入职", limit: 20)
        #expect(json.contains("\"query\":\"入职\""))
        #expect(json.contains("\"limit\":20"))
    }

    @Test func `parse search results reads hits`() {
        let raw = """
        {
          "results": [
            {"id": "o1", "title": "入职手册", "summary": "简介", "knowledgeBaseId": "kb1"},
            {"id": "o2", "title": "制度", "summary": ""}
          ]
        }
        """
        let hits = parseKnowledgeSearchResults(raw)
        #expect(hits.count == 2)
        #expect(hits[0].title == "入职手册")
        #expect(hits[0].knowledgeBaseId == "kb1")
        #expect(hits[1].knowledgeBaseId == nil)
    }

    @Test func `stub body includes title`() {
        let stub = knowledgeDocumentStubBody(title: "入职流程手册")
        #expect(stub.title == "入职流程手册")
        #expect(stub.markdownOrPlain.contains("入职准备"))
        #expect(stub.fromPreview == false)
        let blocks = knowledgeDocBlocks(title: stub.title, raw: stub.markdownOrPlain)
        #expect(blocks.contains { $0.text == "1. 入职准备" && $0.isHeading })
        #expect(!blocks.contains { $0.text == "入职流程手册" })
    }

    @Test func `favorite toggle round trip`() {
        let added = toggleKnowledgeFavoriteIDs([], kbID: "kb1")
        #expect(added == ["kb1"])
        let removed = toggleKnowledgeFavoriteIDs(added, kbID: "kb1")
        #expect(removed.isEmpty)
        #expect(parseKnowledgeFavoriteIDs(encodeKnowledgeFavoriteIDs(["a", "b"])) == ["a", "b"])
    }

    private static func demoCatalog() -> [ChatKnowledgeCatalogItem] {
        [
            ChatKnowledgeCatalogItem(
                type: "knowledge",
                sourceID: "kb-personal-achievements",
                label: "个人成果",
                parentId: nil,
                visibility: "private"),
            ChatKnowledgeCatalogItem(
                type: "file",
                sourceID: "doc-onboarding",
                label: "入职流程手册",
                parentId: "kb-personal-achievements",
                visibility: "private"),
            ChatKnowledgeCatalogItem(
                type: "knowledge",
                sourceID: "kb-team-achievements",
                label: "团队成果",
                parentId: nil,
                visibility: "team"),
            ChatKnowledgeCatalogItem(
                type: "file",
                sourceID: "doc-weekly",
                label: "周报",
                parentId: "kb-team-achievements",
                visibility: "team"),
            ChatKnowledgeCatalogItem(
                type: "knowledge",
                sourceID: "kb-external",
                label: "外部知识源",
                parentId: nil,
                visibility: "enterprise"),
        ]
    }
}
