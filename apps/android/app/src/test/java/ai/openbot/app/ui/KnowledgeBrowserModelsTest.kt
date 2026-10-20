package ai.openbot.app.ui

import ai.openbot.app.chat.buildContextScopeCatalogTree
import ai.openbot.app.chat.knowledgeBrowserSectionLabel
import java.util.Base64
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class KnowledgeBrowserModelsTest {
  @Test
  fun demoCatalog_groupsPersonalTeamEnterprise() {
    val tree = buildContextScopeCatalogTree(DEMO_KNOWLEDGE_CATALOG)
    assertEquals(
      listOf("个人空间", "团队空间", "企业空间"),
      tree.map { knowledgeBrowserSectionLabel(it.visibility) },
    )
    assertEquals("个人成果", tree[0].nodes[0].item.label)
    assertTrue(tree[0].nodes[0].children.any { it.item.label == "入职流程手册" })
  }

  @Test
  fun resolveKnowledgeBaseId_walksToKb() {
    val file =
      DEMO_KNOWLEDGE_CATALOG.first { it.id == "doc-onboarding" }
    val kbId = resolveKnowledgeBaseId(file, DEMO_KNOWLEDGE_CATALOG)
    assertEquals("kb-personal-achievements", kbId)
  }

  @Test
  fun parsePreview_decodesBase64Text() {
    val text = "# Hello\n\nBody line"
    val b64 = Base64.getEncoder().encodeToString(text.toByteArray(Charsets.UTF_8))
    val payload =
      """{"filename":"手册.md","mimeType":"text/markdown","byteLength":12,"textLike":true,"base64":"$b64"}"""
    val parsed = parseKnowledgeDocumentPreviewPayload(payload, "fallback")
    assertNotNull(parsed)
    assertEquals("手册.md", parsed!!.title)
    assertTrue(parsed.markdownOrPlain.contains("Body line"))
    assertTrue(parsed.fromPreview)
  }

  @Test
  fun buildPreviewParams_includesRenderFlag() {
    val json = buildKnowledgeDocumentPreviewParams("kb-1", "doc-1")
    assertTrue(json.contains("\"knowledgeBaseId\":\"kb-1\""))
    assertTrue(json.contains("\"documentId\":\"doc-1\""))
    assertTrue(json.contains("\"render\":true"))
  }

  @Test
  fun stubBody_includesTitle() {
    val stub = knowledgeDocumentStubBody("入职流程手册")
    assertEquals("入职流程手册", stub.title)
    assertTrue(stub.markdownOrPlain.contains("入职准备"))
    assertTrue(!stub.fromPreview)
  }
}

  @Test
  fun parseKnowledgeSearchResults_readsHits() {
    val json =
      """
      {
        "results": [
          {"id": "o1", "title": "入职手册", "summary": "简介", "knowledgeBaseId": "kb1"},
          {"id": "o2", "title": "制度", "summary": ""}
        ],
        "sourceSummary": {}
      }
      """.trimIndent()
    val hits = parseKnowledgeSearchResults(json)
    assertEquals(2, hits.size)
    assertEquals("入职手册", hits[0].title)
    assertEquals("kb1", hits[0].knowledgeBaseId)
  }

  @Test
  fun parsePreview_keepsHtmlSource() {
    val json = """{"filename":"a.html","html":"<p>Hello</p>","renderKind":"html"}"""
    val body = parseKnowledgeDocumentPreviewPayload(json, "fallback")
    assertEquals("a.html", body!!.title)
    assertEquals("<p>Hello</p>", body.htmlSource)
  }
