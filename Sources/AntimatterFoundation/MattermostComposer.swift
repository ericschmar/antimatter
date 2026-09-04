import Foundation

public struct MattermostPostRequest: Encodable, Sendable {
    public let channelID: String
    public let message: String
    public let fileIDs: [String]
    public let rootID: String

    public init(channelID: String, message: String, fileIDs: [String] = [], rootID: String = "") {
        self.channelID = channelID
        self.message = message
        self.fileIDs = fileIDs
        self.rootID = rootID
    }

    enum CodingKeys: String, CodingKey {
        case channelID = "channel_id"
        case message
        case fileIDs = "file_ids"
        case rootID = "root_id"
    }
}

public struct MattermostPostUpdate: Encodable, Sendable {
    public let id: String
    public let message: String

    public init(id: String, message: String) {
        self.id = id
        self.message = message
    }
}

public actor MattermostPostSender {
    private let client: MattermostAPIClient

    public init(client: MattermostAPIClient) {
        self.client = client
    }

    public func send(_ request: MattermostPostRequest) async throws -> MattermostPost {
        try await client.post("/api/v4/posts", body: request)
    }

    public func update(_ update: MattermostPostUpdate) async throws -> MattermostPost {
        try await client.put("/api/v4/posts/\(update.id)", body: update)
    }

    public func delete(postID: String) async throws {
        let _: EmptyResponse = try await client.delete("/api/v4/posts/\(postID)")
    }
}

private struct EmptyResponse: Decodable, Sendable {}

public actor MattermostFileUploader {
    private let client: MattermostAPIClient

    public init(client: MattermostAPIClient) {
        self.client = client
    }

    /// Uploads all files as one Mattermost multipart request and returns their server-assigned IDs.
    public func upload(channelID: String, fileURLs: [URL]) async throws -> [MattermostFile] {
        let boundary = "Antimatter-\(UUID().uuidString)"
        var body = Data()
        appendField(named: "channel_id", value: channelID, to: &body, boundary: boundary)

        for url in fileURLs {
            let isAccessingSecurityScopedResource = url.startAccessingSecurityScopedResource()
            defer {
                if isAccessingSecurityScopedResource {
                    url.stopAccessingSecurityScopedResource()
                }
            }

            let data = try Data(contentsOf: url)
            appendFile(
                named: "files",
                filename: url.lastPathComponent,
                data: data,
                to: &body,
                boundary: boundary
            )
        }
        body.append(Data("--\(boundary)--\r\n".utf8))

        let response: MattermostFileUploadResponse = try await client.postMultipart(
            "/api/v4/files",
            body: body,
            boundary: boundary
        )
        return response.fileInfos
    }

    private func appendField(named name: String, value: String, to body: inout Data, boundary: String) {
        body.append(Data("--\(boundary)\r\n".utf8))
        body.append(Data("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n".utf8))
        body.append(Data("\(value)\r\n".utf8))
    }

    private func appendFile(
        named name: String,
        filename: String,
        data: Data,
        to body: inout Data,
        boundary: String
    ) {
        let escapedFilename = filename.replacingOccurrences(of: "\"", with: "%22")
        body.append(Data("--\(boundary)\r\n".utf8))
        body.append(Data("Content-Disposition: form-data; name=\"\(name)\"; filename=\"\(escapedFilename)\"\r\n".utf8))
        body.append(Data("Content-Type: application/octet-stream\r\n\r\n".utf8))
        body.append(data)
        body.append(Data("\r\n".utf8))
    }
}

private struct MattermostFileUploadResponse: Decodable, Sendable {
    let fileInfos: [MattermostFile]

    enum CodingKeys: String, CodingKey {
        case fileInfos = "file_infos"
    }
}
