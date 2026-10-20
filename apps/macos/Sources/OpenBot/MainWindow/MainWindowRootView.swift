import AppKit
import SwiftUI
import WebKit

struct MainWindowRootView: View {
    @Bindable var authStore: PlatformAuthSessionStore

    var body: some View {
        Group {
            if self.authStore.isAuthenticated {
                SignedInWorkspaceView(authStore: self.authStore)
            } else {
                PlatformAuthView(store: self.authStore)
            }
        }
        .frame(minWidth: 880, minHeight: 620)
    }
}

/// Post-login workspace host. Uses EmployeeShell WKWebView when gateway cookie is ready;
/// otherwise shows a minimal signed-in home until bootstrap succeeds.
struct SignedInWorkspaceView: View {
    @Bindable var authStore: PlatformAuthSessionStore
    @State private var bootstrapError: String?

    var body: some View {
        ZStack {
            if let base = self.authStore.gatewayBaseURL {
                EmployeeShellRepresentable(
                    gatewayBaseURL: base,
                    authStore: self.authStore,
                    onBootstrapError: { error in
                        self.bootstrapError = error.localizedDescription
                    })
            } else {
                self.fallbackHome
            }

            if let bootstrapError {
                VStack(spacing: 12) {
                    Text("工作区加载失败")
                        .font(.headline)
                    Text(bootstrapError)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                    HStack(spacing: 12) {
                        Button("重试") {
                            self.bootstrapError = nil
                        }
                        Button("退出登录") {
                            Task { await self.authStore.logout() }
                        }
                    }
                }
                .padding(24)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .padding(40)
            }
        }
    }

    private var fallbackHome: some View {
        VStack(spacing: 16) {
            Text("已登录")
                .font(.title2.weight(.semibold))
            Text(self.authStore.session?.email ?? "")
                .foregroundStyle(.secondary)
            Button("退出登录") {
                Task { await self.authStore.logout() }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(nsColor: .windowBackgroundColor))
    }
}

struct EmployeeShellRepresentable: NSViewControllerRepresentable {
    var gatewayBaseURL: URL
    var authStore: PlatformAuthSessionStore
    var onBootstrapError: (Error) -> Void

    func makeNSViewController(context: Context) -> EmployeeShellHostController {
        EmployeeShellHostController(
            gatewayBaseURL: self.gatewayBaseURL,
            authStore: self.authStore,
            onBootstrapError: self.onBootstrapError)
    }

    func updateNSViewController(_ controller: EmployeeShellHostController, context: Context) {
        controller.onBootstrapError = self.onBootstrapError
        controller.authStore = self.authStore
    }
}

@MainActor
final class EmployeeShellHostController: NSViewController {
    var onBootstrapError: (Error) -> Void
    var authStore: PlatformAuthSessionStore

    private let gatewayBaseURL: URL
    private var shellController: EmployeeShellWebViewController?

    init(
        gatewayBaseURL: URL,
        authStore: PlatformAuthSessionStore,
        onBootstrapError: @escaping (Error) -> Void
    ) {
        self.gatewayBaseURL = gatewayBaseURL
        self.authStore = authStore
        self.onBootstrapError = onBootstrapError
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder _: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func loadView() {
        let root = NSView(frame: NSRect(x: 0, y: 0, width: 960, height: 680))
        self.view = root

        let shell = EmployeeShellWebViewController(
            config: EmployeeShellConfig(
                gatewayBaseURL: self.gatewayBaseURL,
                initialTarget: EmployeeShellBootstrap.cloudWorkbenchTarget,
                // Cloud PlatformAuth is a single session, so the embed uses the
                // default persistent store (shares cookie storage populated by
                // PlatformAuthClient / GatewayWebSocketCookies) rather than a
                // per-account `WKWebsiteDataStore(forIdentifier:)`.
                websiteDataStore: .default(),
                tokenProvider: { [gatewayBaseURL] target in
                    let session = await PlatformAuthClient.shared.urlSessionForAuthenticatedCalls()
                    return try await EmployeeShellBootstrap.mintToken(
                        baseURL: gatewayBaseURL,
                        session: session,
                        target: target)
                }),
            onIntent: { [weak self] intent in
                guard let self else { return }
                if case .signOut = intent {
                    Task { await self.authStore.logout() }
                }
            },
            onBootstrapError: { [weak self] error in
                self?.onBootstrapError(error)
            })
        self.shellController = shell
        self.addChild(shell)

        shell.view.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(shell.view)
        NSLayoutConstraint.activate([
            shell.view.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            shell.view.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            shell.view.topAnchor.constraint(equalTo: root.topAnchor),
            shell.view.bottomAnchor.constraint(equalTo: root.bottomAnchor),
        ])
    }
}
