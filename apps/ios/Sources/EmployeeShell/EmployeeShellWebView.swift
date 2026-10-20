//
//  EmployeeShellWebView.swift
//  Tri-Platform Employee Shell — iOS container (Phase 2 skeleton).
//
//  ⚠️ UNVERIFIED SKELETON — written without a local iOS toolchain. Compile and
//  wire up on a Mac (xcodegen + Xcode). It is intentionally SDK-only (Foundation
//  / WebKit / SwiftUI) and self-contained so it can compile in isolation before
//  you connect it to the app's navigation, gateway URL, and employee session.
//
//  What it is:
//  - A WKWebView container for the Web employee shell, SEPARATE from the Canvas
//    web view (which uses `.nonPersistent()`); this uses a persistent data store
//    so the bootstrapped employee session cookie survives relaunches.
//  - Registers the `openbotEmployeeShell` script-message handler and decodes the
//    versioned bridge protocol (see ui/src/ui/employee-shell/native-bridge.ts).
//  - Bootstraps the session: obtains a one-time token (tokenProvider) and loads
//    `/native/bootstrap?token=…&target=…`; the gateway's 302 Set-Cookie lands the
//    HttpOnly employee session in THIS web view's own cookie jar.
//
//  Follow-up (native employee login): `tokenProvider` must call the mint endpoint
//  with a URLSession whose cookie jar already holds the employee platform-auth
//  session cookie. Obtaining that cookie (native login UI) is the remaining piece;
//  `EmployeeShellBootstrap.mintToken` is provided as the building block.
//

import Foundation
import OpenBotKit
import SwiftUI
import WebKit

// MARK: - Bridge protocol (mirrors ui/src/ui/employee-shell/native-bridge.ts)

/// Typed employee-shell intents emitted by the web embed toward this native host.
enum EmployeeShellIntent: Equatable {
    case ready(surface: String?)
    case openChat(sessionKey: String?, agentId: String?)
    case openAssistant(agentId: String?)
    case openSpace(spaceId: String)
    case openKnowledgeObject(objectId: String, kind: String?)
    case openDeviceSettings(section: String?)
}

enum EmployeeShellBridge {
    /// Must match EMPLOYEE_SHELL_HOST_HANDLER in native-host.ts.
    static let handlerName = "openbotEmployeeShell"
    /// Must match EMPLOYEE_SHELL_BRIDGE_VERSION in native-bridge.ts.
    static let protocolVersion = 1

    /// Parse an UNTRUSTED WKScriptMessage body (a JSON string) into a typed intent,
    /// rejecting unknown versions/types and missing required fields.
    static func parse(_ body: Any) -> EmployeeShellIntent? {
        let object: [String: Any]?
        if let string = body as? String, let data = string.data(using: .utf8) {
            object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        } else {
            object = body as? [String: Any]
        }
        guard let message = object else { return nil }
        guard (message["version"] as? Int) == protocolVersion else { return nil }
        guard let type = message["type"] as? String else { return nil }
        let payload = message["payload"] as? [String: Any] ?? [:]

        func nonEmpty(_ key: String) -> String? {
            guard let value = payload[key] as? String else { return nil }
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : trimmed
        }

        switch type {
        case "ready":
            return .ready(surface: nonEmpty("surface"))
        case "openChat":
            return .openChat(sessionKey: nonEmpty("sessionKey"), agentId: nonEmpty("agentId"))
        case "openAssistant":
            return .openAssistant(agentId: nonEmpty("agentId"))
        case "openSpace":
            guard let spaceId = nonEmpty("spaceId") else { return nil }
            return .openSpace(spaceId: spaceId)
        case "openKnowledgeObject":
            guard let objectId = nonEmpty("objectId") else { return nil }
            return .openKnowledgeObject(objectId: objectId, kind: nonEmpty("kind"))
        case "openDeviceSettings":
            return .openDeviceSettings(section: nonEmpty("section"))
        default:
            return nil
        }
    }
}

// MARK: - Bootstrap (mint + URL building)

enum EmployeeShellBootstrapError: Error {
    case badURL
    case unauthorized
    case missingToken
    case badResponse
}

enum EmployeeShellBootstrap {
    static let mintPath = "/native/bootstrap/mint"
    static let bootstrapPath = "/native/bootstrap"
    static let defaultTarget = "/embed/employee/overview"

    /// Phone shells opt into phone-only trims (design doc §15) via this marker; the
    /// web embed reads `shell=mobile` and adds the `employee-embed--mobile` root class.
    /// macOS keeps full web parity by NOT setting this.
    static let mobileShellMarker = "shell=mobile"

    /// Append the phone marker to a target so the web embed enables phone-only trims.
    static func withMobileShellMarker(_ target: String) -> String {
        if target.contains(mobileShellMarker) {
            return target
        }
        return target.contains("?") ? "\(target)&\(mobileShellMarker)" : "\(target)?\(mobileShellMarker)"
    }

    /// Append `path` + query onto `baseURL` (preserving any base path).
    static func makeURL(baseURL: URL, path: String, queryItems: [URLQueryItem]) -> URL? {
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            return nil
        }
        let base = components.path.hasSuffix("/") ? String(components.path.dropLast()) : components.path
        components.path = base + path
        components.queryItems = queryItems.isEmpty ? nil : queryItems
        return components.url
    }

    /// POST `/native/bootstrap/mint?target=…` using `session` (whose cookie jar MUST
    /// carry the employee platform-auth session cookie). Returns the one-time token.
    static func mintToken(
        baseURL: URL,
        session: URLSession = .shared,
        target: String
    ) async throws -> String {
        guard let url = makeURL(baseURL: baseURL, path: mintPath, queryItems: [
            URLQueryItem(name: "target", value: target),
        ]) else {
            throw EmployeeShellBootstrapError.badURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw EmployeeShellBootstrapError.badResponse
        }
        if http.statusCode == 401 {
            throw EmployeeShellBootstrapError.unauthorized
        }
        guard http.statusCode == 200,
              let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let token = object["token"] as? String, !token.isEmpty
        else {
            throw EmployeeShellBootstrapError.missingToken
        }
        return token
    }

    /// Build `/native/bootstrap?token=…&target=…`.
    static func bootstrapURL(baseURL: URL, token: String, target: String) -> URL? {
        makeURL(baseURL: baseURL, path: bootstrapPath, queryItems: [
            URLQueryItem(name: "token", value: token),
            URLQueryItem(name: "target", value: target),
        ])
    }
}

// MARK: - Script message handler

private final class EmployeeShellMessageHandler: NSObject, WKScriptMessageHandler {
    var onIntent: ((EmployeeShellIntent) -> Void)?

    func userContentController(
        _: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard message.name == EmployeeShellBridge.handlerName else { return }
        guard let intent = EmployeeShellBridge.parse(message.body) else { return }
        onIntent?(intent)
    }
}

// MARK: - SwiftUI container

struct EmployeeShellConfig {
    var gatewayBaseURL: URL
    var initialTarget: String = EmployeeShellBootstrap.defaultTarget
    /// Returns a one-time bootstrap token for `target`. Typically wraps
    /// `EmployeeShellBootstrap.mintToken` with the app's authenticated URLSession.
    var tokenProvider: (_ target: String) async throws -> String
}

struct EmployeeShellWebView: UIViewRepresentable {
    let config: EmployeeShellConfig
    var onIntent: (EmployeeShellIntent) -> Void = { _ in }
    var onBootstrapError: (Error) -> Void = { _ in }
    /// Fired when the WebView navigates to the public www auth/login surface.
    var onPublicAuthNavigation: () -> Void = {}
    /// Fired when `/embed/employee/*` finished loading without rendering auth-home.
    var onEmbedReady: () -> Void = {}

    func makeCoordinator() -> EmployeeShellCoordinator {
        EmployeeShellCoordinator(
            config: config,
            onIntent: onIntent,
            onBootstrapError: onBootstrapError,
            onPublicAuthNavigation: onPublicAuthNavigation,
            onEmbedReady: onEmbedReady)
    }

    func makeUIView(context: Context) -> WKWebView {
        context.coordinator.makeWebView()
    }

    func updateUIView(_: WKWebView, context: Context) {
        context.coordinator.onIntent = onIntent
        context.coordinator.onBootstrapError = onBootstrapError
        context.coordinator.onPublicAuthNavigation = onPublicAuthNavigation
        context.coordinator.onEmbedReady = onEmbedReady
    }

    static func dismantleUIView(_: WKWebView, coordinator: EmployeeShellCoordinator) {
        coordinator.teardown()
    }
}

@MainActor
final class EmployeeShellCoordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
    private let config: EmployeeShellConfig
    var onIntent: (EmployeeShellIntent) -> Void
    var onBootstrapError: (Error) -> Void
    var onPublicAuthNavigation: () -> Void
    var onEmbedReady: () -> Void
    private let messageHandler = EmployeeShellMessageHandler()
    private let uploadPicker = EmployeeShellUploadPicker()
    private weak var webView: WKWebView?
    private var didBootstrap = false
    private var settleTask: Task<Void, Never>?
    private var didReportReady = false
    private var didReportAuthFailure = false
    private var pendingBootstrapToken: String?
    private var pendingBootstrapTarget: String?
    private var didTryBootstrapFallback = false

    init(
        config: EmployeeShellConfig,
        onIntent: @escaping (EmployeeShellIntent) -> Void,
        onBootstrapError: @escaping (Error) -> Void,
        onPublicAuthNavigation: @escaping () -> Void,
        onEmbedReady: @escaping () -> Void
    ) {
        self.config = config
        self.onIntent = onIntent
        self.onBootstrapError = onBootstrapError
        self.onPublicAuthNavigation = onPublicAuthNavigation
        self.onEmbedReady = onEmbedReady
        super.init()
        self.messageHandler.onIntent = { [weak self] intent in
            guard let self else { return }
            // Bridge `ready` is advisory only — never reveal on it alone. The SPA
            // can paint `.shell--workspace` before platformAuth hydrates, then flip
            // to the public auth-home login page.
            self.onIntent(intent)
        }
    }

    func makeWebView() -> WKWebView {
        let contentController = WKUserContentController()
        contentController.add(self.messageHandler, name: EmployeeShellBridge.handlerName)
        contentController.addUserScript(
            WKUserScript(
                source: EmployeeShellFileChooser.captureInstallSource,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: false))

        let webConfig = WKWebViewConfiguration()
        webConfig.userContentController = contentController
        // Fresh jar per shell mount so we always inject the current native login
        // cookie (avoids stale www sessions from WKWebView's shared default store).
        webConfig.websiteDataStore = .nonPersistent()

        let webView = WKWebView(frame: .zero, configuration: webConfig)
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.navigationDelegate = self
        // iOS 18.4+ routes `<input type="file">` here. Earlier 18.x builds keep
        // WebKit's built-in upload UI because runOpenPanel is not in that SDK.
        webView.uiDelegate = self
        self.webView = webView
        self.bootstrapIfNeeded()
        return webView
    }

    func teardown() {
        self.settleTask?.cancel()
        self.settleTask = nil
        self.uploadPicker.cancel()
        self.webView?.configuration.userContentController
            .removeScriptMessageHandler(forName: EmployeeShellBridge.handlerName)
        self.webView?.navigationDelegate = nil
        self.webView?.uiDelegate = nil
        self.webView = nil
    }

    /// Re-run bootstrap (e.g. after the session cookie expired and the shell got a 401).
    func reBootstrap() {
        self.didBootstrap = false
        self.bootstrapIfNeeded()
    }

    private func bootstrapIfNeeded() {
        guard !self.didBootstrap else { return }
        self.didBootstrap = true
        // iOS is a PHONE shell: mark the target so the web enables phone-only trims.
        let target = EmployeeShellBootstrap.withMobileShellMarker(self.config.initialTarget)
        let baseURL = self.config.gatewayBaseURL
        Task { [weak self] in
            guard let self else { return }
            do {
                guard let webView = self.webView else { return }
                await Self.syncSharedCookies(into: webView, baseURL: baseURL)
                try? await Task.sleep(nanoseconds: 150_000_000)
                // Mint validates membership; bootstrap 302 plants the employee
                // session cookie into THIS WebView (Mac-aligned primary path).
                let token = try await self.config.tokenProvider(target)
                self.pendingBootstrapToken = token
                self.pendingBootstrapTarget = target
                guard let bootstrapURL = EmployeeShellBootstrap.bootstrapURL(
                    baseURL: baseURL, token: token, target: target)
                else {
                    self.onBootstrapError(EmployeeShellBootstrapError.badURL)
                    return
                }
                webView.load(URLRequest(url: bootstrapURL))
            } catch {
                self.onBootstrapError(error)
            }
        }
    }

    private static func embedURL(baseURL: URL, target: String) -> URL? {
        let pathPart: String
        let queryPart: String?
        if let q = target.firstIndex(of: "?") {
            pathPart = String(target[..<q])
            queryPart = String(target[target.index(after: q)...])
        } else {
            pathPart = target
            queryPart = nil
        }
        var items: [URLQueryItem] = []
        if let queryPart {
            items = queryPart.split(separator: "&").compactMap { pair in
                let parts = pair.split(separator: "=", maxSplits: 1).map(String.init)
                guard let name = parts.first, !name.isEmpty else { return nil }
                let value = parts.count > 1 ? parts[1] : ""
                return URLQueryItem(
                    name: name.removingPercentEncoding ?? name,
                    value: value.removingPercentEncoding ?? value)
            }
        }
        return EmployeeShellBootstrap.makeURL(baseURL: baseURL, path: pathPart, queryItems: items)
    }

    private static func syncSharedCookies(into webView: WKWebView, baseURL: URL) async {
        let storage = HTTPCookieStorage.shared
        let cookies =
            (storage.cookies(for: baseURL) ?? [])
                + (storage.cookies ?? []).filter {
                    $0.domain.contains("openbot.love")
                        && ($0.name.lowercased().contains("platform")
                            || $0.name.lowercased().contains("session")
                            || $0.name.lowercased().contains("openbot"))
                }
        // Deduplicate by name+domain+path.
        var seen = Set<String>()
        let store = webView.configuration.websiteDataStore.httpCookieStore
        for cookie in cookies {
            let key = "\(cookie.name)|\(cookie.domain)|\(cookie.path)"
            if seen.contains(key) { continue }
            seen.insert(key)
            await store.setCookie(cookie)
        }
    }

    /// Fallback: load embed with already-synced native login cookies (no one-time token).
    private func loadDirectEmbedFallback() {
        guard let target = self.pendingBootstrapTarget,
              let url = Self.embedURL(baseURL: self.config.gatewayBaseURL, target: target)
        else {
            self.reportAuthFailure()
            return
        }
        self.webView?.load(URLRequest(url: url))
    }

    // MARK: WKUIDelegate

    /// Public since iOS 18.4. Passing nil on cancel leaves the file input unchanged.
    /// On iOS 18.0–18.3 this method is not invoked.
    @available(iOS 18.4, *)
    func webView(
        _ webView: WKWebView,
        runOpenPanelWith parameters: WKOpenPanelParameters,
        initiatedByFrame _: WKFrameInfo,
        completionHandler: @escaping @MainActor @Sendable ([URL]?) -> Void
    ) {
        self.uploadPicker.present(
            from: webView,
            allowsMultipleSelection: parameters.allowsMultipleSelection,
            allowsDirectories: parameters.allowsDirectories,
            completion: completionHandler)
    }

    // MARK: WKNavigationDelegate

    func webView(
        _: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void)
    {
        // Cancel only hard navigations away from the embed shell. Do NOT treat this
        // as an immediate auth failure — SPA may still hydrate a valid session.
        if let url = navigationAction.request.url,
           Self.isPublicAuthURL(url, gatewayBase: self.config.gatewayBaseURL)
        {
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didFinish _: WKNavigation!) {
        guard let url = webView.url else { return }
        let path = url.path.lowercased()
        if path.hasPrefix("/embed/employee") || path.hasPrefix("/native/bootstrap") {
            self.startSessionSettleProbe(on: webView)
        }
    }

    func webView(
        _: WKWebView,
        decidePolicyFor navigationResponse: WKNavigationResponse,
        decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void)
    {
        if let http = navigationResponse.response as? HTTPURLResponse,
           http.statusCode == 401,
           let url = http.url,
           url.path.lowercased().hasPrefix("/native/bootstrap")
        {
            decisionHandler(.cancel)
            self.onBootstrapError(EmployeeShellBootstrapError.unauthorized)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_: WKWebView, didFail _: WKNavigation?, withError error: any Error) {
        let ns = error as NSError
        if ns.domain == NSURLErrorDomain, ns.code == NSURLErrorCancelled {
            return
        }
        self.onBootstrapError(error)
    }

    func webView(_: WKWebView, didFailProvisionalNavigation _: WKNavigation?, withError error: any Error) {
        let ns = error as NSError
        if ns.domain == NSURLErrorDomain, ns.code == NSURLErrorCancelled {
            return
        }
        self.onBootstrapError(error)
    }

    private enum SessionProbeVerdict: String {
        case ready
        case authPage
        case pending
        case unknown
    }

    /// Settle only on the real employee workbench DOM.
    ///
    /// Critical: production SPA first paints `.shell--workspace` while
    /// `platformAuthState` is still null, THEN flips to `.auth-home` (网页登录页).
    /// Treating `.shell--workspace` / bare session JSON as ready causes that flash.
    private func startSessionSettleProbe(on webView: WKWebView) {
        self.settleTask?.cancel()
        self.settleTask = Task { @MainActor [weak self] in
            guard let self else { return }
            var authHits = 0
            // ~20s @ 400ms
            for _ in 0..<50 {
                if Task.isCancelled || self.didReportAuthFailure { return }
                let verdict = await self.probeSessionState(webView)
                switch verdict {
                case .ready:
                    self.reportReady()
                    // Keep watching — SPA must not later flip to auth-home.
                    authHits = 0
                case .authPage:
                    if self.didReportReady {
                        // Was showing workbench, then SPA painted web login — hide it.
                        self.didReportReady = false
                        self.onPublicAuthNavigation()
                        self.didReportAuthFailure = true
                        return
                    }
                    authHits += 1
                    if authHits == 8, !self.didTryBootstrapFallback {
                        self.didTryBootstrapFallback = true
                        await Self.syncSharedCookies(
                            into: webView, baseURL: self.config.gatewayBaseURL)
                        try? await Task.sleep(nanoseconds: 150_000_000)
                        self.loadDirectEmbedFallback()
                        authHits = 0
                    } else if authHits >= 20 {
                        self.reportAuthFailure()
                        return
                    }
                case .pending, .unknown:
                    authHits = 0
                }
                if self.didReportReady, verdict == .ready {
                    // Stable workbench — stop probing.
                    return
                }
                try? await Task.sleep(nanoseconds: 400_000_000)
            }
            if !self.didReportReady {
                self.reportAuthFailure()
            }
        }
    }

    private func probeSessionState(_ webView: WKWebView) async -> SessionProbeVerdict {
        let script = """
          try {
            const hasAuth = !!document.querySelector(
              '.auth-home, [class*="auth-home"], [data-openbot-embed-auth="required"]'
            );
            if (hasAuth) return 'authPage';
            // Require the real workbench root — NOT `.shell--workspace`, which the
            // SPA paints during auth hydration before flipping to auth-home.
            const hasWorkbench = !!document.querySelector('.employee-workbench');
            if (hasWorkbench) return 'ready';
            return 'pending';
          } catch (e) {
            return 'unknown';
          }
        """
        do {
            let result = try await webView.callAsyncJavaScript(
                script, arguments: [:], in: nil, contentWorld: .page)
            if let raw = result as? String, let verdict = SessionProbeVerdict(rawValue: raw) {
                return verdict
            }
        } catch {
            return .unknown
        }
        return .unknown
    }

    private func reportReady() {
        guard !self.didReportReady, !self.didReportAuthFailure else { return }
        self.didReportReady = true
        self.settleTask?.cancel()
        self.onEmbedReady()
    }

    private func reportAuthFailure() {
        guard !self.didReportAuthFailure, !self.didReportReady else { return }
        self.didReportAuthFailure = true
        self.settleTask?.cancel()
        self.onPublicAuthNavigation()
    }

    /// Public marketing/auth routes that must never replace the native login gate.
    private static func isPublicAuthURL(_ url: URL, gatewayBase: URL) -> Bool {
        guard let host = url.host?.lowercased(), let baseHost = gatewayBase.host?.lowercased() else {
            return false
        }
        guard host == baseHost || host.hasSuffix(".\(baseHost)") || host.hasSuffix("openbot.love") else {
            return false
        }
        let path = url.path.lowercased()
        if path.hasPrefix("/native/bootstrap") { return false }
        if path.hasPrefix("/embed/employee") { return false }
        if path.hasPrefix("/__openbot/") { return false }
        // Bare site root / auth-home / login landings.
        if path == "/" || path.isEmpty { return true }
        if path.hasPrefix("/login") || path.hasPrefix("/auth") || path.hasPrefix("/sign-in") {
            return true
        }
        if path.contains("auth-home") {
            return true
        }
        return false
    }
}
