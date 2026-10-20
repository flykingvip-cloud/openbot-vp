import Foundation

public enum OpenBotRemindersCommand: String, Codable, Sendable {
    case list = "reminders.list"
    case add = "reminders.add"
}

public enum OpenBotReminderStatusFilter: String, Codable, Sendable {
    case incomplete
    case completed
    case all
}

public struct OpenBotRemindersListParams: Codable, Sendable, Equatable {
    public var status: OpenBotReminderStatusFilter?
    public var limit: Int?

    public init(status: OpenBotReminderStatusFilter? = nil, limit: Int? = nil) {
        self.status = status
        self.limit = limit
    }
}

public struct OpenBotRemindersAddParams: Codable, Sendable, Equatable {
    public var title: String
    public var dueISO: String?
    public var notes: String?
    public var listId: String?
    public var listName: String?

    public init(
        title: String,
        dueISO: String? = nil,
        notes: String? = nil,
        listId: String? = nil,
        listName: String? = nil)
    {
        self.title = title
        self.dueISO = dueISO
        self.notes = notes
        self.listId = listId
        self.listName = listName
    }
}

public struct OpenBotReminderPayload: Codable, Sendable, Equatable {
    public var identifier: String
    public var title: String
    public var dueISO: String?
    public var completed: Bool
    public var listName: String?

    public init(
        identifier: String,
        title: String,
        dueISO: String? = nil,
        completed: Bool,
        listName: String? = nil)
    {
        self.identifier = identifier
        self.title = title
        self.dueISO = dueISO
        self.completed = completed
        self.listName = listName
    }
}

public struct OpenBotRemindersListPayload: Codable, Sendable, Equatable {
    public var reminders: [OpenBotReminderPayload]

    public init(reminders: [OpenBotReminderPayload]) {
        self.reminders = reminders
    }
}

public struct OpenBotRemindersAddPayload: Codable, Sendable, Equatable {
    public var reminder: OpenBotReminderPayload

    public init(reminder: OpenBotReminderPayload) {
        self.reminder = reminder
    }
}
