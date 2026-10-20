import OpenBotChatUI
import OpenBotKit
import OpenBotProtocol
import Foundation
import OSLog

struct IOSGatewayChatTransport: OpenBotChatTransport, Sendable {
    private static let logger = Logger(subsystem: "ai.openbot", category: "ios.chat.transport")
    private let gateway: GatewayNodeSession

    init(gateway: GatewayNodeSession) {
        self.gateway = gateway
    }

    func abortRun(sessionKey: String, runId: String) async throws {
        struct Params: Codable {
            var sessionKey: String
            var runId: String
        }
        let data = try JSONEncoder().encode(Params(sessionKey: sessionKey, runId: runId))
        let json = String(data: data, encoding: .utf8)
        _ = try await self.gateway.request(method: "chat.abort", paramsJSON: json, timeoutSeconds: 10)
    }

    func listSessions(limit: Int?) async throws -> OpenBotChatSessionsListResponse {
        struct Params: Codable {
            var includeGlobal: Bool
            var includeUnknown: Bool
            var limit: Int?
        }
        let data = try JSONEncoder().encode(Params(includeGlobal: true, includeUnknown: false, limit: limit))
        let json = String(data: data, encoding: .utf8)
        let res = try await self.gateway.request(method: "sessions.list", paramsJSON: json, timeoutSeconds: 15)
        return try JSONDecoder().decode(OpenBotChatSessionsListResponse.self, from: res)
    }

    func setActiveSessionKey(_ sessionKey: String) async throws {
        // Operator clients receive chat events without node-style subscriptions.
        // (chat.subscribe is a node event, not an operator RPC method.)
    }

    func requestHistory(sessionKey: String) async throws -> OpenBotChatHistoryPayload {
        struct Params: Codable { var sessionKey: String }
        let data = try JSONEncoder().encode(Params(sessionKey: sessionKey))
        let json = String(data: data, encoding: .utf8)
        let res = try await self.gateway.request(method: "chat.history", paramsJSON: json, timeoutSeconds: 15)
        return try JSONDecoder().decode(OpenBotChatHistoryPayload.self, from: res)
    }

    func sendMessage(
        sessionKey: String,
        message: String,
        thinking: String,
        idempotencyKey: String,
        attachments: [OpenBotChatAttachmentPayload],
        contextScope: OpenBotChatContextScopePayload?) async throws -> OpenBotChatSendResponse
    {
        let startLogMessage =
            "chat.send start sessionKey=\(sessionKey) "
            + "len=\(message.count) attachments=\(attachments.count)"
        Self.logger.info(
            "\(startLogMessage, privacy: .public)"
        )
        struct SourceWire: Encodable {
            var type: String
            var id: String
            var parentId: String?

            func encode(to encoder: Encoder) throws {
                var container = encoder.container(keyedBy: CodingKeys.self)
                try container.encode(self.type, forKey: .type)
                try container.encode(self.id, forKey: .id)
                try container.encodeIfPresent(self.parentId, forKey: .parentId)
            }

            private enum CodingKeys: String, CodingKey {
                case type
                case id
                case parentId
            }
        }

        struct ScopeWire: Encodable {
            var mode: String
            var lifetime: String
            var sources: [SourceWire]
        }

        struct Params: Encodable {
            var sessionKey: String
            var message: String
            var thinking: String
            var attachments: [OpenBotChatAttachmentPayload]?
            var timeoutMs: Int
            var idempotencyKey: String
            var contextScope: ScopeWire?

            func encode(to encoder: Encoder) throws {
                var container = encoder.container(keyedBy: CodingKeys.self)
                try container.encode(self.sessionKey, forKey: .sessionKey)
                try container.encode(self.message, forKey: .message)
                try container.encode(self.thinking, forKey: .thinking)
                try container.encodeIfPresent(self.attachments, forKey: .attachments)
                try container.encode(self.timeoutMs, forKey: .timeoutMs)
                try container.encode(self.idempotencyKey, forKey: .idempotencyKey)
                try container.encodeIfPresent(self.contextScope, forKey: .contextScope)
            }

            private enum CodingKeys: String, CodingKey {
                case sessionKey
                case message
                case thinking
                case attachments
                case timeoutMs
                case idempotencyKey
                case contextScope
            }
        }

        let scopeWire = contextScope.map { scope in
            ScopeWire(
                mode: scope.mode,
                lifetime: scope.lifetime,
                sources: scope.sources.map { source in
                    SourceWire(type: source.type, id: source.id, parentId: source.parentId)
                })
        }
        let params = Params(
            sessionKey: sessionKey,
            message: message,
            thinking: thinking,
            attachments: attachments.isEmpty ? nil : attachments,
            timeoutMs: 30000,
            idempotencyKey: idempotencyKey,
            contextScope: scopeWire)
        let data = try JSONEncoder().encode(params)
        let json = String(data: data, encoding: .utf8)
        do {
            let res = try await self.gateway.request(method: "chat.send", paramsJSON: json, timeoutSeconds: 35)
            let decoded = try JSONDecoder().decode(OpenBotChatSendResponse.self, from: res)
            Self.logger.info("chat.send ok runId=\(decoded.runId, privacy: .public)")
            return decoded
        } catch {
            Self.logger.error("chat.send failed \(error.localizedDescription, privacy: .public)")
            throw error
        }
    }

    func requestHealth(timeoutMs: Int) async throws -> Bool {
        let seconds = max(1, Int(ceil(Double(timeoutMs) / 1000.0)))
        let res = try await self.gateway.request(method: "health", paramsJSON: nil, timeoutSeconds: seconds)
        return (try? JSONDecoder().decode(OpenBotGatewayHealthOK.self, from: res))?.ok ?? true
    }

    func events() -> AsyncStream<OpenBotChatTransportEvent> {
        AsyncStream { continuation in
            let task = Task {
                let stream = await self.gateway.subscribeServerEvents()
                for await evt in stream {
                    if Task.isCancelled { return }
                    switch evt.event {
                    case "tick":
                        continuation.yield(.tick)
                    case "seqGap":
                        continuation.yield(.seqGap)
                    case "health":
                        guard let payload = evt.payload else { break }
                        let ok = (try? GatewayPayloadDecoding.decode(
                            payload,
                            as: OpenBotGatewayHealthOK.self))?.ok ?? true
                        continuation.yield(.health(ok: ok))
                    case "chat":
                        guard let payload = evt.payload else { break }
                        if let chatPayload = try? GatewayPayloadDecoding.decode(
                            payload,
                            as: OpenBotChatEventPayload.self)
                        {
                            continuation.yield(.chat(chatPayload))
                        }
                    case "agent":
                        guard let payload = evt.payload else { break }
                        if let agentPayload = try? GatewayPayloadDecoding.decode(
                            payload,
                            as: OpenBotAgentEventPayload.self)
                        {
                            continuation.yield(.agent(agentPayload))
                        }
                    default:
                        break
                    }
                }
            }

            continuation.onTermination = { @Sendable _ in
                task.cancel()
            }
        }
    }
}
