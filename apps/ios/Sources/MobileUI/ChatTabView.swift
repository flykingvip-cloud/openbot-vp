import OpenBotChatUI
import OpenBotKit
import OpenBotProtocol
import SwiftUI

/// 对话 tab. Reuses OpenBotKit `OpenBotChatView` (same transport, same `switchSession` / `abort`).
/// Chrome around that stack: agent strip, knowledge capsule, attach capsules, TalkMode mic.
/// No TO: header, no strip "+", no second message list, no WebView tab body.
struct ChatTabView: View {
    @Environment(NodeAppModel.self) private var appModel

    @State private var viewModel: OpenBotChatViewModel
    @State private var showKnowledge = false
    @State private var showTalk = false
    @State private var catalog: [ChatKnowledgeCatalogItem] = []
    @State private var catalogLoading = false
    @State private var catalogNote: String?

    private let gateway: GatewayNodeSession

    init(gateway: GatewayNodeSession, sessionKey: String) {
        self.gateway = gateway
        let transport = IOSGatewayChatTransport(gateway: gateway)
        self._viewModel = State(
            initialValue: OpenBotChatViewModel(
                sessionKey: sessionKey,
                transport: transport))
    }

    var body: some View {
        VStack(spacing: 0) {
            ChatAgentStripView(model: self.stripModel) { key in
                self.viewModel.switchSession(to: key)
            }
            Rectangle()
                .fill(Color(hex: 0xEEF0F3))
                .frame(height: 1)

            OpenBotChatView(
                viewModel: self.viewModel,
                showsSessionSwitcher: false,
                userAccent: self.appModel.seamColor,
                mobileChrome: OpenBotChatMobileChrome(
                    onOpenKnowledge: { self.showKnowledge = true },
                    onMic: { self.showTalk = true }))
        }
        .task {
            await self.appModel.refreshGatewayOverviewIfConnected()
        }
        .sheet(isPresented: self.$showKnowledge) {
            ChatKnowledgePickerSheet(
                viewModel: self.viewModel,
                catalog: self.catalog,
                loading: self.catalogLoading,
                note: self.catalogNote)
                .presentationDetents([.medium, .large])
                .task {
                    await self.loadKnowledgeCatalog()
                }
        }
        .fullScreenCover(isPresented: self.$showTalk) {
            ChatTalkModeCover()
        }
    }

    private var stripModel: AgentStripNavModel {
        buildAgentStripNavModel(
            agents: self.appModel.gatewayAgents.map { agent in
                AgentStripAgent(id: agent.id, name: Self.displayName(for: agent))
            },
            sessions: self.viewModel.sessions.map { session in
                AgentStripSession(
                    key: session.key,
                    displayName: session.displayName,
                    updatedAtMs: session.updatedAt)
            },
            activeSessionKey: self.viewModel.sessionKey,
            mainSessionKey: self.appModel.mainSessionKey)
    }

    private static func displayName(for agent: AgentSummary) -> String? {
        let direct = agent.name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !direct.isEmpty { return direct }
        if let identityName = agent.identity?["name"]?.value as? String {
            let trimmed = identityName.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty { return trimmed }
        }
        return nil
    }

    private func loadKnowledgeCatalog() async {
        if self.catalogLoading { return }
        self.catalogLoading = true
        self.catalogNote = nil
        defer { self.catalogLoading = false }

        if let parsed = await self.requestCatalog(
            method: "context.scope.sources.catalog",
            paramsJSON: "{}"),
            !parsed.isEmpty
        {
            self.catalog = parsed
            return
        }

        guard let basesData = try? await self.gateway.request(
            method: "knowledge.base.list",
            paramsJSON: "{}",
            timeoutSeconds: 15)
        else {
            self.catalog = []
            self.catalogNote = "暂无知识库（需 Gateway 返回 knowledge.base.list / context.scope 目录）"
            return
        }
        let basesText = String(data: basesData, encoding: .utf8) ?? ""
        let bases = ChatKnowledgeCatalogParser.parseKnowledgeBaseList(basesText)
        if bases.isEmpty {
            self.catalog = []
            self.catalogNote = "暂无知识库（需 Gateway 返回 knowledge.base.list / context.scope 目录）"
            return
        }
        var nested: [ChatKnowledgeCatalogItem] = []
        for base in bases {
            let params = #"{"knowledgeBaseId":"\#(Self.jsonEscape(base.sourceID))"}"#
            if let data = try? await self.gateway.request(
                method: "knowledge.base.sources.list",
                paramsJSON: params,
                timeoutSeconds: 15)
            {
                let text = String(data: data, encoding: .utf8) ?? ""
                nested.append(contentsOf: ChatKnowledgeCatalogParser.parseKnowledgeBaseSources(
                    parentID: base.sourceID,
                    raw: text))
            }
        }
        self.catalog = bases + nested
    }

    private func requestCatalog(method: String, paramsJSON: String) async -> [ChatKnowledgeCatalogItem]? {
        guard let data = try? await self.gateway.request(
            method: method,
            paramsJSON: paramsJSON,
            timeoutSeconds: 15),
            let text = String(data: data, encoding: .utf8)
        else { return nil }
        return ChatKnowledgeCatalogParser.parseContextScopeCatalog(text)
    }

    private static func jsonEscape(_ value: String) -> String {
        value
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
    }
}

/// Mic opens the existing TalkMode orb. Not speech-to-text inside the composer bubble.
private struct ChatTalkModeCover: View {
    @Environment(NodeAppModel.self) private var appModel
    @Environment(\.dismiss) private var dismiss
    @State private var restoreTalk = false

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            VStack(spacing: 0) {
                HStack {
                    Button {
                        self.dismiss()
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "chevron.left")
                            Text("返回对话")
                        }
                    }
                    .buttonStyle(.plain)
                    Spacer()
                    Text("语音对话")
                        .font(.headline)
                    Spacer()
                    Color.clear.frame(width: 88, height: 1)
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 16)
                .padding(.top, 12)
                Spacer()
                TalkOrbOverlay()
                Spacer()
            }
        }
        .onAppear {
            self.restoreTalk = self.appModel.talkMode.isEnabled
            if !self.restoreTalk {
                self.appModel.setTalkEnabled(true)
            }
        }
        .onDisappear {
            if !self.restoreTalk {
                self.appModel.setTalkEnabled(false)
            }
        }
    }
}
