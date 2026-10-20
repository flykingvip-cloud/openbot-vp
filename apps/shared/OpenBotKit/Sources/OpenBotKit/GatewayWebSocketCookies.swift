import Foundation

/// Attach platform-auth session cookies to Gateway WebSocket upgrades.
///
/// CFNetwork does not reliably send `HTTPCookieStorage` cookies on
/// `URLSessionWebSocketTask` handshakes. Cloud auth (`trusted-proxy` + platform
/// session) depends on `Cookie: openbot_platform_session=…` reaching nginx→gateway,
/// so we explicitly set the Cookie header from shared storage.
public enum GatewayWebSocketCookies {
    public static let platformSessionCookieName = "openbot_platform_session"

    /// Cookie Domain matching gateway `platformAuth.cookieDomain` for OpenBot cloud.
    /// Apple requires a leading `.` for multi-host cookies.
    public static func sharedCookieDomain(forHost host: String) -> String {
        let lowered = host.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if lowered == "openbot.love" || lowered.hasSuffix(".openbot.love") {
            return ".openbot.love"
        }
        return lowered
    }

    public static func cookieHeader(
        for url: URL,
        storage: HTTPCookieStorage = .shared
    ) -> String? {
        let cookies = storage.cookies(for: url) ?? []
        guard !cookies.isEmpty else { return nil }
        return HTTPCookie.requestHeaderFields(with: cookies)["Cookie"]
    }

    public static func makeWebSocketTask(
        session: URLSession,
        url: URL,
        storage: HTTPCookieStorage = .shared
    ) -> URLSessionWebSocketTask {
        var request = URLRequest(url: url)
        if let header = self.cookieHeader(for: url, storage: storage) {
            request.setValue(header, forHTTPHeaderField: "Cookie")
        }
        let task = session.webSocketTask(with: request)
        // Avoid "Message too long" receive errors for large snapshots / history payloads.
        task.maximumMessageSize = 16 * 1024 * 1024 // 16 MB
        return task
    }

    /// Persist a platform session cookie with the correct Domain for cloud hosts.
    public static func applyPlatformSessionCookie(
        value: String,
        gatewayBaseURL: URL,
        storage: HTTPCookieStorage = .shared,
        cookieName: String = platformSessionCookieName
    ) {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        guard var components = URLComponents(url: gatewayBaseURL, resolvingAgainstBaseURL: false)
        else {
            return
        }
        components.path = "/"
        components.query = nil
        components.fragment = nil
        guard let root = components.url, let host = root.host, !host.isEmpty else { return }

        // Drop stale host-only / mismatched-domain copies first.
        Self.clearPlatformSessionCookies(for: root, storage: storage, cookieName: cookieName)

        let isSecure = (root.scheme ?? "").lowercased() == "https"
        // Prefer Domain=.openbot.love for cloud hosts so www/admin/biz share the
        // session. Bare "openbot.love" is host-only on Darwin and will NOT match www.
        let props: [HTTPCookiePropertyKey: Any] = [
            .name: cookieName,
            .value: trimmed,
            .domain: Self.sharedCookieDomain(forHost: host),
            .originURL: root,
            .path: "/",
            .secure: isSecure ? "TRUE" : "FALSE",
        ]
        guard let cookie = HTTPCookie(properties: props) else { return }
        storage.setCookie(cookie)
    }

    public static func clearPlatformSessionCookies(
        for gatewayBaseURL: URL,
        storage: HTTPCookieStorage = .shared,
        cookieName: String = platformSessionCookieName
    ) {
        let host = (gatewayBaseURL.host ?? "").lowercased()
        let matched =
            (storage.cookies(for: gatewayBaseURL) ?? [])
                + (storage.cookies ?? []).filter { cookie in
                    guard cookie.name == cookieName else { return false }
                    let domain = cookie.domain.lowercased()
                    if host.isEmpty { return domain.contains("openbot.love") }
                    return domain == host
                        || domain == ".\(host)"
                        || domain.hasSuffix("openbot.love") && host.hasSuffix("openbot.love")
                }
        for cookie in matched where cookie.name == cookieName {
            storage.deleteCookie(cookie)
        }
    }
}
