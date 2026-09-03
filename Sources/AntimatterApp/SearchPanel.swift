import AntimatterFoundation
import SwiftUI

struct SearchPanel: View {
    @ObservedObject var search: SearchViewModel
    let onSelect: (MattermostPost) -> Void

    var body: some View {
        if search.isSearching || search.error != nil || !search.posts.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                if search.isSearching {
                    ProgressView().controlSize(.small)
                } else if let error = search.error {
                    Text(error).font(.system(size: 12)).foregroundStyle(WorkspaceTheme.attention)
                } else {
                    ForEach(search.posts) { post in
                        Button {
                            onSelect(post)
                        } label: {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(post.message).lineLimit(2)
                                Text("Open conversation")
                                    .font(.system(size: 10, design: .monospaced))
                                    .foregroundStyle(WorkspaceTheme.secondaryText)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(14)
            .background(WorkspaceTheme.surface)
        }
    }
}
