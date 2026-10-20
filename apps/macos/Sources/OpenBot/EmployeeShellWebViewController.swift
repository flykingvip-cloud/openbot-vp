//
//  EmployeeShellWebViewController.swift
//  Tri-Platform Employee Shell — macOS container (tasks 1.5-macos / 1.6-macos).
//
//  A WKWebView container SEPARATE from CanvasWindowController (which uses custom
//  scheme handlers + its own store). It:
//   - binds the PER-ACCOUNT `WKWebsiteDataStore(forIdentifier:)` (NOT `.default()`
//     and NOT the Canvas `.nonPersistent()` store) so the bootstrapped HttpOnly
//     employee session is isolated per account (contract §account-session-model);
//   - registers the `openbotEmployeeShell` bridge and decodes the versioned
//     protocol, routing `space`/`knowledge` to in-WebView embed navigation and
//     forwarding chat/assistant/device-settings to the native host;
//   - bootstraps an employee session via `/native/bootstrap` using a one-time
//     token minted with the account's client `URLSession` (NEVER `.shared`);
//   - detects a main-frame 401 (`decidePolicyFor navigationResponse`) and
//     silently re-bootstraps; a mint 401 surfaces to the host to return to login;
//   - shows a native placeholder (with retry + backoff) when the embed fails.
//
//  macOS keeps FULL web parity: it intentionally does NOT add `shell=mobile`, so
//  the embed shows the same features as the web (contract / D-MACOS-FORM).
//

import AppKit
import Foundation
import OpenBotKit
import OSLog
import WebKit

// MARK: - Bridge protocol (mirrors ui/src/ui/employee-shell/native-bridge.ts)

enum EmployeeShellIntent: Equatable {
    case ready(surface: String?)
    case openChat(sessionKey: String?, agentId: String?)
    case openAssistant(agentId: String?)
    case openSpace(spaceId: String)
    case openKnowledgeObject(objectId: String, kind: String?)
    case openDeviceSettings(section: String?)
    case signOut
}

enum EmployeeShellBridge {
    static let handlerName = "openbotEmployeeShell"
    static let protocolVersion = 1

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
        case "signOut":
            return .signOut
        default:
            return nil
        }
    }
}

// MARK: - Bootstrap (mint + URL building)

enum EmployeeShellBootstrapError: Error, Equatable {
    case badURL
    case unauthorized
    case missingToken
    case badResponse
}

enum EmployeeShellBootstrap {
    static let mintPath = "/native/bootstrap/mint"
    static let bootstrapPath = "/native/bootstrap"
    static let defaultTarget = "/embed/employee/overview"
    /// PlatformAuth / MainWindow cloud path: the same document the browser uses after login.
    static let cloudWorkbenchTarget = "/"

    static func makeURL(baseURL: URL, path: String, queryItems: [URLQueryItem]) -> URL? {
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            return nil
        }
        let base = components.path.hasSuffix("/") ? String(components.path.dropLast()) : components.path
        components.path = base + path
        components.queryItems = queryItems.isEmpty ? nil : queryItems
        return components.url
    }

    /// POST `/native/bootstrap/mint?target=…`. `session` MUST be the account's
    /// client session whose cookie jar carries the employee platform-auth cookie.
    /// There is intentionally NO `.shared` default (contract invariant 1).
    static func mintToken(
        baseURL: URL,
        session: URLSession,
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

    static func bootstrapURL(baseURL: URL, token: String, target: String) -> URL? {
        makeURL(baseURL: baseURL, path: bootstrapPath, queryItems: [
            URLQueryItem(name: "token", value: token),
            URLQueryItem(name: "target", value: target),
        ])
    }

    /// Loopback gateways can serve the employee embed without a mint cookie.
    static func isLoopbackGateway(_ url: URL) -> Bool {
        let host = (url.host ?? "")
            .trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
            .lowercased()
        return host == "127.0.0.1" || host == "localhost" || host == "::1"
    }

    /// Build a site-internal embed URL for in-WebView navigation (session already set).
    static func embedURL(baseURL: URL, path: String) -> URL? {
        // `path` may include a query string ("/embed/employee/workspace?spaceId=x").
        let split = path.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)
        let pathPart = String(split.first ?? "")
        let queryItems: [URLQueryItem]
        if split.count > 1 {
            var comps = URLComponents()
            comps.percentEncodedQuery = String(split[1])
            queryItems = comps.queryItems ?? []
        } else {
            queryItems = []
        }
        return self.makeURL(baseURL: baseURL, path: pathPart, queryItems: queryItems)
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

// MARK: - Config + view controller

struct EmployeeShellConfig {
    var gatewayBaseURL: URL
    var initialTarget: String = EmployeeShellBootstrap.defaultTarget
    /// Per-account persistent WebView store (`WKWebsiteDataStore(forIdentifier:)`).
    var websiteDataStore: WKWebsiteDataStore
    /// Returns a one-time bootstrap token for `target`; typically wraps
    /// `EmployeeShellBootstrap.mintToken` with the account's client `URLSession`.
    var tokenProvider: (_ target: String) async throws -> String
}

@MainActor
final class EmployeeShellWebViewController: NSViewController, WKNavigationDelegate, WKUIDelegate {
    private let config: EmployeeShellConfig
    /// Native-only intents (chat/assistant/device-settings/ready). Embed
    /// navigations (space/knowledge) are handled internally in this controller.
    var onIntent: (EmployeeShellIntent) -> Void
    /// Non-recoverable bootstrap/navigation error (after retries exhausted or a
    /// mint 401 which means the login session is gone → host returns to login).
    var onBootstrapError: (Error) -> Void
    /// First successful embed paint (M-TTI / cold-start telemetry hook).
    var onEmbedReady: () -> Void = {}
    private var didReportReady = false
    /// LIVE `/native/bootstrap` still coerces `target=/` to the embed overview.
    /// After the session cookie is set, navigate once to the requested homepage.
    private var didHonorInitialDocument = false

    private let logger = Logger(subsystem: "ai.openbot", category: "employee-shell")
    private let messageHandler = EmployeeShellMessageHandler()
    private let openPanelCoordinator = EmployeeShellOpenPanelCoordinator()
    private var webView: WKWebView?
    private var placeholder: EmployeeShellPlaceholderView?
    private var didBootstrap = false

    /// Consecutive silent re-bootstraps triggered by embed 401s. Bounded so a
    /// persistently-401 session does not loop forever (→ surfaces to host).
    private var consecutiveReauth = 0
    private static let maxConsecutiveReauth = 2
    /// Bootstrap retry backoff (embed load failures).
    private var bootstrapAttempts = 0
    private static let maxBootstrapAttempts = 4

    init(
        config: EmployeeShellConfig,
        onIntent: @escaping (EmployeeShellIntent) -> Void = { _ in },
        onBootstrapError: @escaping (Error) -> Void = { _ in }
    ) {
        self.config = config
        self.onIntent = onIntent
        self.onBootstrapError = onBootstrapError
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder _: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func loadView() {
        let container = NSView()

        let contentController = WKUserContentController()
        contentController.add(self.messageHandler, name: EmployeeShellBridge.handlerName)
        contentController.addUserScript(
            WKUserScript(
                source: EmployeeShellFileChooser.captureInstallSource,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: false))

        let webConfig = WKWebViewConfiguration()
        webConfig.userContentController = contentController
        // Per-account, persistent, isolated from the Canvas web view. Replaces the
        // skeleton `.default()` (an app-level singleton that cannot isolate accounts).
        webConfig.websiteDataStore = self.config.websiteDataStore

        let webView = WKWebView(frame: .zero, configuration: webConfig)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            webView.topAnchor.constraint(equalTo: container.topAnchor),
            webView.bottomAnchor.constraint(equalTo: container.bottomAnchor),
        ])
        self.webView = webView

        let placeholder = EmployeeShellPlaceholderView { [weak self] in
            self?.retryBootstrap()
        }
        placeholder.translatesAutoresizingMaskIntoConstraints = false
        placeholder.isHidden = true
        container.addSubview(placeholder)
        NSLayoutConstraint.activate([
            placeholder.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            placeholder.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            placeholder.topAnchor.constraint(equalTo: container.topAnchor),
            placeholder.bottomAnchor.constraint(equalTo: container.bottomAnchor),
        ])
        self.placeholder = placeholder

        self.view = container
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        self.messageHandler.onIntent = { [weak self] intent in self?.route(intent) }
        self.bootstrapIfNeeded()
    }

    /// Call when the controller is being discarded to drop the retained handler.
    func teardown() {
        self.openPanelCoordinator.teardown()
        self.webView?.configuration.userContentController
            .removeScriptMessageHandler(forName: EmployeeShellBridge.handlerName)
        self.webView?.navigationDelegate = nil
        self.webView?.uiDelegate = nil
    }

    /// Force a fresh bootstrap (e.g. after login / account switch / org switch).
    func reBootstrap() {
        self.didBootstrap = false
        self.bootstrapAttempts = 0
        self.consecutiveReauth = 0
        self.didHonorInitialDocument = false
        self.didReportReady = false
        self.bootstrapIfNeeded()
    }

    /// Navigate the shell to a specific embed surface (used by deep links).
    func navigate(toEmbedPath path: String) {
        guard let url = EmployeeShellBootstrap.embedURL(baseURL: self.config.gatewayBaseURL, path: path) else {
            return
        }
        self.setPlaceholder(hidden: true)
        self.webView?.load(URLRequest(url: url))
    }

    // MARK: - Intent routing (space/knowledge → embed; rest → native)

    private func route(_ intent: EmployeeShellIntent) {
        switch EmployeeEmbedRouting.action(for: intent) {
        case let .embedNavigation(path):
            self.navigate(toEmbedPath: path)
        case let .native(nativeIntent):
            self.onIntent(nativeIntent)
        }
    }

    // MARK: - Bootstrap

    private func retryBootstrap() {
        self.didBootstrap = false
        self.bootstrapIfNeeded()
    }

    private func bootstrapIfNeeded() {
        guard !self.didBootstrap else { return }
        self.didBootstrap = true
        self.bootstrapAttempts += 1
        // macOS keeps FULL web parity: do NOT add the `shell=mobile` marker.
        let target = self.config.initialTarget
        let baseURL = self.config.gatewayBaseURL
        Task { [weak self] in
            guard let self else { return }
            do {
                let token = try await self.config.tokenProvider(target)
                guard let url = EmployeeShellBootstrap.bootstrapURL(
                    baseURL: baseURL, token: token, target: target)
                else {
                    self.handleBootstrapFailure(EmployeeShellBootstrapError.badURL)
                    return
                }
                self.setPlaceholder(hidden: true)
                self.webView?.load(URLRequest(url: url))
            } catch {
                // A mint 401 is terminal here: the login session is gone → host
                // must return to the login screen (do not retry silently).
                if let e = error as? EmployeeShellBootstrapError, e == .unauthorized {
                    if EmployeeShellBootstrap.isLoopbackGateway(baseURL) {
                        self.navigate(toEmbedPath: target)
                        return
                    }
                    self.onBootstrapError(error)
                    return
                }
                self.handleBootstrapFailure(error)
            }
        }
    }

    /// Show placeholder + schedule a backoff retry (bounded). After the last
    /// attempt, surface the error to the host.
    private func handleBootstrapFailure(_ error: Error) {
        self.logger.error("employee shell bootstrap failed: \(String(describing: error), privacy: .public)")
        self.setPlaceholder(hidden: false, message: Self.describe(error))
        guard self.bootstrapAttempts < Self.maxBootstrapAttempts else {
            self.onBootstrapError(error)
            return
        }
        let delay = Double(1 << min(self.bootstrapAttempts, 4)) // 2,4,8,16s
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
            guard let self else { return }
            self.didBootstrap = false
            self.bootstrapIfNeeded()
        }
    }

    private func setPlaceholder(hidden: Bool, message: String? = nil) {
        if let message {
            self.placeholder?.setMessage(message)
        }
        self.placeholder?.isHidden = hidden
        self.webView?.isHidden = !hidden ? false : self.webView?.isHidden ?? false
    }

    /// If MainWindow asked for `/` and bootstrap 302'd to `/embed/employee/...`
    /// (LIVE server that does not yet allow homepage targets), load `/` now that
    /// the employee session cookie is in this WebView.
    private func honorCloudHomepageIfNeeded(_ webView: WKWebView) {
        guard !self.didHonorInitialDocument else { return }
        let wanted = self.config.initialTarget
        guard Self.homepagePath(wanted) != nil else {
            self.didHonorInitialDocument = true
            return
        }
        let landed = webView.url?.path ?? ""
        let landedPath = landed.isEmpty ? "/" : landed
        if landedPath == "/" {
            self.didHonorInitialDocument = true
            return
        }
        self.didHonorInitialDocument = true
        guard let url = EmployeeShellBootstrap.embedURL(
            baseURL: self.config.gatewayBaseURL, path: wanted)
        else {
            return
        }
        webView.load(URLRequest(url: url))
    }

    private static func homepagePath(_ target: String) -> String? {
        if target == "/" { return "/" }
        if target.hasPrefix("/?") { return "/" }
        return nil
    }

    private static func describe(_ error: Error) -> String {
        if let e = error as? EmployeeShellBootstrapError {
            switch e {
            case .unauthorized: return EmployeeShellStrings.string(.sessionExpiredReconnecting)
            case .badURL, .badResponse, .missingToken:
                return EmployeeShellStrings.string(.couldNotReachWorkspace)
            }
        }
        return EmployeeShellStrings.string(.couldNotLoadCheckConnection)
    }

    // MARK: WKUIDelegate

    /// macOS WebKit does not show a file picker unless this is implemented.
    /// Cancel (and a missing window) passes nil so the page's input stays unchanged.
    func webView(
        _ webView: WKWebView,
        runOpenPanelWith parameters: WKOpenPanelParameters,
        initiatedByFrame _: WKFrameInfo,
        completionHandler: @escaping @MainActor @Sendable ([URL]?) -> Void
    ) {
        self.openPanelCoordinator.present(
            webView: webView,
            window: webView.window ?? self.view.window,
            parameters: parameters,
            completionHandler: completionHandler)
    }

    // MARK: WKNavigationDelegate

    /// Detect a main-frame 401 → silently re-bootstrap (embed session expired).
    /// Bounded so a persistently-unauthorized session surfaces to the host.
    func webView(
        _: WKWebView,
        decidePolicyFor navigationResponse: WKNavigationResponse,
        decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
    ) {
        guard
            navigationResponse.isForMainFrame,
            let http = navigationResponse.response as? HTTPURLResponse,
            http.statusCode == 401
        else {
            decisionHandler(.allow)
            return
        }
        decisionHandler(.cancel)
        self.consecutiveReauth += 1
        if self.consecutiveReauth > Self.maxConsecutiveReauth {
            self.logger.error("employee shell repeated 401; surfacing to host")
            self.onBootstrapError(EmployeeShellBootstrapError.unauthorized)
            return
        }
        self.logger.info("employee shell main-frame 401 → silent re-bootstrap")
        self.didBootstrap = false
        self.bootstrapAttempts = 0
        self.bootstrapIfNeeded()
    }

    func webView(_ webView: WKWebView, didFinish _: WKNavigation?) {
        // A successful non-401 navigation clears the re-auth counter.
        self.consecutiveReauth = 0
        self.bootstrapAttempts = 0
        self.setPlaceholder(hidden: true)
        self.honorCloudHomepageIfNeeded(webView)
        if !self.didReportReady {
            self.didReportReady = true
            self.onEmbedReady()
        }
    }

    func webView(_: WKWebView, didFail _: WKNavigation?, withError error: any Error) {
        self.handleBootstrapFailure(error)
    }

    func webView(_: WKWebView, didFailProvisionalNavigation _: WKNavigation?, withError error: any Error) {
        self.handleBootstrapFailure(error)
    }
}

// MARK: - Offline / failure placeholder

/// Native placeholder shown when the embed cannot load (contract 2.6 / 7.2).
private final class EmployeeShellPlaceholderView: NSView {
    private let label = NSTextField(
        labelWithString: EmployeeShellStrings.string(.couldNotLoadCheckConnection))
    private let retry: () -> Void

    init(retry: @escaping () -> Void) {
        self.retry = retry
        super.init(frame: .zero)
        self.wantsLayer = true
        self.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor

        self.label.alignment = .center
        self.label.font = .systemFont(ofSize: 13)
        self.label.textColor = .secondaryLabelColor
        self.label.translatesAutoresizingMaskIntoConstraints = false

        let button = NSButton(
            title: EmployeeShellStrings.string(.retry), target: self, action: #selector(self.didTapRetry))
        button.bezelStyle = .rounded
        button.translatesAutoresizingMaskIntoConstraints = false

        let stack = NSStackView(views: [self.label, button])
        stack.orientation = .vertical
        stack.alignment = .centerX
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        self.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: self.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: self.centerYAnchor),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: self.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: self.trailingAnchor, constant: -24),
        ])
    }

    @available(*, unavailable)
    required init?(coder _: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func setMessage(_ message: String) {
        self.label.stringValue = message
    }

    @objc private func didTapRetry() {
        self.retry()
    }
}
