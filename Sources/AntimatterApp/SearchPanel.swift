import AntimatterFoundation
import SwiftUI

struct SearchResultsView: View {
    @ObservedObject var search: SearchViewModel
    let channels: [MattermostChannel]
    let users: [String: MattermostUser]
    let onSelect: (MattermostPost) -> Void
    @State private var filtersAreExpanded = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                searchControls

                if search.isSearching {
                    HStack(spacing: 8) {
                        ProgressView().controlSize(.small)
                        Text("Searching messages…")
                    }
                    .font(.system(size: 12))
                    .foregroundStyle(WorkspaceTheme.secondaryText)
                } else if let error = search.error {
                    Text(error).font(.system(size: 12)).foregroundStyle(WorkspaceTheme.attention)
                } else if search.posts.isEmpty {
                    VStack(spacing: 6) {
                        Image(systemName: "magnifyingglass")
                            .font(.system(size: 18, weight: .medium))
                            .foregroundStyle(WorkspaceTheme.secondaryText)
                        Text("No messages found")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(WorkspaceTheme.primaryText)
                        Text("Try a different word or phrase.")
                            .font(.system(size: 11))
                            .foregroundStyle(WorkspaceTheme.secondaryText)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                } else {
                    ForEach(search.posts) { post in
                        Button {
                            onSelect(post)
                        } label: {
                            VStack(alignment: .leading, spacing: 5) {
                                HStack(spacing: 5) {
                                    Text(channelName(for: post))
                                    Text("·")
                                    Text(users[post.userID]?.displayName ?? "Unknown member")
                                    Spacer(minLength: 0)
                                    Text(timestamp(for: post))
                                }
                                .font(.system(size: 10, weight: .medium, design: .monospaced))
                                .foregroundStyle(WorkspaceTheme.secondaryText)
                                Text(post.message)
                                    .font(.system(size: 12))
                                    .foregroundStyle(WorkspaceTheme.primaryText)
                                    .lineLimit(2)
                            }
                            .padding(8)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(WorkspaceTheme.raisedSurface.opacity(0.6), in: RoundedRectangle(cornerRadius: WorkspaceTheme.compactCornerRadius, style: .continuous))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
                .frame(maxWidth: 760, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(20)
            }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(WorkspaceTheme.canvas)
    }

    private var searchControls: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                TextField("Search messages", text: $search.query)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit(runSearch)
                Button("Search", action: runSearch)
                    .buttonStyle(.borderedProminent)
                    .disabled(!canSearch)
            }

            DisclosureGroup("Filters", isExpanded: $filtersAreExpanded) {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Picker("Channel", selection: $search.filters.channel) {
                            Text("Every channel").tag(String?.none)
                            ForEach(channels) { channel in
                                Text(channel.displayName).tag(Optional(channel.name))
                            }
                        }
                        Picker("Sender", selection: $search.filters.sender) {
                            Text("Anyone").tag(String?.none)
                            ForEach(users.values.sorted { $0.displayName < $1.displayName }) { user in
                                Text(user.displayName).tag(Optional(user.username))
                            }
                        }
                    }

                    HStack {
                        DatePicker("After", selection: dateBinding(for: \.after), displayedComponents: .date)
                        DatePicker("Before", selection: dateBinding(for: \.before), displayedComponents: .date)
                    }

                    HStack {
                        Toggle("Has files", isOn: $search.filters.hasFiles)
                        TextField("File extension", text: $search.filters.fileExtension)
                            .textFieldStyle(.roundedBorder)
                            .frame(maxWidth: 180)
                        Picker("Thread", selection: $search.filters.threadScope) {
                            Text("All posts").tag(MattermostPostSearchFilters.ThreadScope.all)
                            Text("Thread roots").tag(MattermostPostSearchFilters.ThreadScope.roots)
                            Text("Replies").tag(MattermostPostSearchFilters.ThreadScope.replies)
                        }
                    }

                    HStack {
                        Toggle("Pinned only", isOn: $search.filters.pinnedOnly)
                        Toggle("Saved only", isOn: $search.filters.savedOnly)
                        Spacer()
                        Button("Clear filters") {
                            search.filters = MattermostPostSearchFilters()
                        }
                        .disabled(!search.filters.hasActiveFilters)
                    }
                    .font(.system(size: 12))
                }
                .padding(.top, 6)
            }
            .font(.system(size: 12, weight: .medium))
        }
        .padding(12)
        .background(WorkspaceTheme.raisedSurface.opacity(0.6), in: RoundedRectangle(cornerRadius: WorkspaceTheme.compactCornerRadius, style: .continuous))
    }

    private var canSearch: Bool {
        !search.query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
            search.filters.hasActiveFilters
    }

    private func dateBinding(
        for keyPath: WritableKeyPath<MattermostPostSearchFilters, Date?>
    ) -> Binding<Date> {
        Binding(
            get: { search.filters[keyPath: keyPath] ?? Date() },
            set: { search.filters[keyPath: keyPath] = $0 }
        )
    }

    private func runSearch() {
        guard canSearch else { return }
        Task { await search.search() }
    }

    private func channelName(for post: MattermostPost) -> String {
        channels.first(where: { $0.id == post.channelID })?.displayName ?? "Conversation"
    }

    private func timestamp(for post: MattermostPost) -> String {
        Date(timeIntervalSince1970: TimeInterval(post.createAt) / 1_000)
            .formatted(date: .abbreviated, time: .shortened)
    }
}
