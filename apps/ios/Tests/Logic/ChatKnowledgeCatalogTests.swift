import Foundation
import Testing

@Suite struct ChatKnowledgeCatalogTests {
    @Test func parsesContextScopeSourcesCatalog() {
        let raw = """
        {"sources":[{"type":"knowledge","id":"kb1","label":"产品库","parentId":null},{"type":"nope","id":"x","label":"skip"}]}
        """
        let items = ChatKnowledgeCatalogParser.parseContextScopeCatalog(raw)
        #expect(items.count == 1)
        #expect(items[0].sourceID == "kb1")
        #expect(items[0].type == "knowledge")
        #expect(items[0].label == "产品库")
    }

    @Test func parsesKnowledgeBaseListFallback() {
        let raw = """
        {"knowledgeBases":[{"knowledgeBaseId":"kb2","title":"制度"}]}
        """
        let items = ChatKnowledgeCatalogParser.parseKnowledgeBaseList(raw)
        #expect(items == [
            ChatKnowledgeCatalogItem(type: "knowledge", sourceID: "kb2", label: "制度", parentId: nil, visibility: nil),
        ])
    }

    @Test func parsesNestedSourceKinds() {
        let raw = """
        {"sources":[{"kind":"localFolder","id":"fold","title":"盘"},{"kind":"api","documentId":"cap","label":"接口"}]}
        """
        let items = ChatKnowledgeCatalogParser.parseKnowledgeBaseSources(parentID: "kb2", raw: raw)
        #expect(items.map(\.type) == ["folder", "api"])
        #expect(items.allSatisfy { $0.parentId == "kb2" })
    }
}
