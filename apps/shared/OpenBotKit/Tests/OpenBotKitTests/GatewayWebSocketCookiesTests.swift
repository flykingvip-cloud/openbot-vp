import Foundation
import Testing
@testable import OpenBotKit

@Suite(.serialized)
struct GatewayWebSocketCookiesTests {
    @Test func sharedCookieDomainUsesParentForOpenBotCloud() {
        #expect(GatewayWebSocketCookies.sharedCookieDomain(forHost: "www.openbot.love") == ".openbot.love")
        #expect(GatewayWebSocketCookies.sharedCookieDomain(forHost: "admin.openbot.love") == ".openbot.love")
        #expect(GatewayWebSocketCookies.sharedCookieDomain(forHost: "openbot.love") == ".openbot.love")
        #expect(GatewayWebSocketCookies.sharedCookieDomain(forHost: "gateway.example.com") == "gateway.example.com")
    }

    @Test func applyPlatformSessionCookieIsVisibleToWwwAndSiblingHosts() {
        let cookieName = "openbot_ws_cookie_visibility_test"
        let storage = HTTPCookieStorage.shared
        storage.cookieAcceptPolicy = .always
        self.clear(cookieName, in: storage)
        defer { self.clear(cookieName, in: storage) }

        let www = URL(string: "https://www.openbot.love")!
        let admin = URL(string: "https://admin.openbot.love")!
        let wss = URL(string: "wss://www.openbot.love")!
        let value = "sessionid.signaturepart"

        GatewayWebSocketCookies.applyPlatformSessionCookie(
            value: value,
            gatewayBaseURL: www,
            storage: storage,
            cookieName: cookieName)

        let stored = (storage.cookies ?? []).filter { $0.name == cookieName }
        #expect(stored.count == 1)
        #expect(stored.first?.domain == ".openbot.love")
        #expect(stored.first?.value == value)

        let wwwCookies = storage.cookies(for: www) ?? []
        #expect(wwwCookies.contains { $0.name == cookieName && $0.value == value })

        let adminCookies = storage.cookies(for: admin) ?? []
        #expect(adminCookies.contains { $0.name == cookieName && $0.value == value })

        let header = GatewayWebSocketCookies.cookieHeader(for: wss, storage: storage)
        #expect(header?.contains("\(cookieName)=\(value)") == true)
    }

    @Test func applyReplacesStaleHostOnlyCookie() {
        let cookieName = "openbot_ws_cookie_replace_test"
        let storage = HTTPCookieStorage.shared
        storage.cookieAcceptPolicy = .always
        self.clear(cookieName, in: storage)
        defer { self.clear(cookieName, in: storage) }

        let www = URL(string: "https://www.openbot.love")!

        if let stale = HTTPCookie(properties: [
            .name: cookieName,
            .value: "stale-host-only",
            .domain: "www.openbot.love",
            .path: "/",
            .secure: "TRUE",
        ]) {
            storage.setCookie(stale)
        }

        GatewayWebSocketCookies.applyPlatformSessionCookie(
            value: "fresh-shared",
            gatewayBaseURL: www,
            storage: storage,
            cookieName: cookieName)

        let cookies = (storage.cookies ?? []).filter { $0.name == cookieName }
        #expect(cookies.count == 1)
        #expect(cookies.first?.value == "fresh-shared")
        #expect(cookies.first?.domain == ".openbot.love")
    }

    private func clear(_ cookieName: String, in storage: HTTPCookieStorage) {
        for cookie in storage.cookies ?? [] where cookie.name == cookieName {
            storage.deleteCookie(cookie)
        }
    }
}
