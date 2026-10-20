import Foundation
import OpenBotKit
import Testing

/// Covers the employee deep-link grammar v1 shared test vectors
/// (see `.kiro/specs/client-apps-pc-mobile/contracts/deeplink-grammar.md`).
/// These vectors are shared with the Android (Kotlin) parser and MUST stay in
/// lock-step; new cases have to be added on both sides.
@Suite struct DeepLinksGrammarTests {
    private func parse(_ string: String) -> DeepLinkRoute? {
        guard let url = URL(string: string) else {
            Issue.record("Invalid URL literal in test vector: \(string)")
            return nil
        }
        return DeepLinkParser.parse(url)
    }

    // MARK: - Shared test vectors (deeplink-grammar.md)

    @Test func employeeOverview() {
        #expect(parse("openbot://employee/overview") == .employee(.init(surface: .overview)))
    }

    @Test func employeeKnowledgeViaCanonicalScheme() {
        #expect(parse("openbot://employee/knowledge") == .employee(.init(surface: .knowledge)))
    }

    @Test func employeeUnknownSurfaceFallsBackToOverview() {
        #expect(parse("openbot://employee/bogus") == .employee(.init(surface: .overview)))
    }

    @Test func chatWithParams() {
        #expect(
            parse("openbot://chat?sessionKey=s1&agentId=a1")
                == .chat(.init(sessionKey: "s1", agentId: "a1")))
    }

    @Test func chatWithoutParams() {
        #expect(parse("openbot://chat") == .chat(.init(sessionKey: nil, agentId: nil)))
    }

    @Test func spaceWithId() {
        #expect(parse("openbot://space/sp_123") == .space(.init(spaceId: "sp_123")))
    }

    @Test func spaceWithEmptyIdIsRejected() {
        #expect(parse("openbot://space/") == nil)
    }

    @Test func knowledgeWithObjectAndKind() {
        #expect(
            parse("openbot://knowledge/obj_9?kind=doc")
                == .knowledge(.init(objectId: "obj_9", kind: "doc")))
    }

    @Test func knowledgeWithEmptyObjectIsRejected() {
        #expect(parse("openbot://knowledge/") == nil)
    }

    @Test func unsupportedSchemeIsRejected() {
        #expect(parse("https://gw.openbot.love/x") == nil)
    }

    @Test func pathTraversalIsRejected() {
        #expect(parse("openbot://employee/../etc") == nil)
    }

    @Test func unknownHostIsRejected() {
        #expect(parse("openbot://unknownhost") == nil)
    }

    // MARK: - Extra grammar edge cases

    @Test func employeeAcceptsQueryFormSurface() {
        #expect(parse("openbot://employee?surface=growth") == .employee(.init(surface: .growth)))
    }

    @Test func employeeWithoutSurfaceFallsBackToOverview() {
        #expect(parse("openbot://employee") == .employee(.init(surface: .overview)))
    }

    @Test func knowledgeWithoutKindOmitsIt() {
        #expect(parse("openbot://knowledge/obj_1") == .knowledge(.init(objectId: "obj_1", kind: nil)))
    }

    @Test func schemeIsCaseInsensitive() {
        #expect(parse("OPENBOT://employee/me") == .employee(.init(surface: .me)))
        #expect(parse("OPENBOT://employee/me") == .employee(.init(surface: .me)))
    }

    @Test func spaceRejectsEmbeddedScheme() {
        // `data:` prefix is an embedded-scheme injection and must be rejected.
        #expect(parse("openbot://space/data:text") == nil)
    }

    @Test func spaceRejectsEncodedEmbeddedScheme() {
        // `x%3A%2F%2Fy` decodes to `x://y` (embedded scheme) and must be rejected.
        #expect(parse("openbot://space/x%3A%2F%2Fy") == nil)
    }

    @Test func knowledgeRejectsTraversalObjectId() {
        #expect(parse("openbot://knowledge/..%2Fetc") == nil)
    }

    @Test func chatRejectsControlCharInParam() {
        // %01 is a control character (SOH) and must be rejected.
        #expect(parse("openbot://chat?sessionKey=%01bad") == nil)
    }

    // MARK: - Non-regression for existing hosts

    @Test func agentHostStillParses() {
        #expect(
            parse("openbot://agent?message=hello")
                == .agent(
                    .init(
                        message: "hello",
                        sessionKey: nil,
                        thinking: nil,
                        deliver: false,
                        to: nil,
                        channel: nil,
                        timeoutSeconds: nil,
                        key: nil)))
    }

    @Test func gatewayHostStillParses() {
        #expect(
            parse("openbot://gateway?host=127.0.0.1&port=18789&tls=0&token=abc")
                == .gateway(
                    .init(host: "127.0.0.1", port: 18789, tls: false, token: "abc", password: nil)))
    }

    @Test func workspaceHostStillParses() {
        #expect(
            parse("openbot://workspace?mode=default-local")
                == .workspace(.init(mode: .defaultLocal, path: nil)))
    }


    @Test func rejectsLegacyOpenClawScheme() {
        // Stage42 hard cut: openclaw:// is no longer accepted.
        #expect(parse("openclaw://employee/overview") == nil)
        #expect(parse("openclaw://chat") == nil)
    }
}
