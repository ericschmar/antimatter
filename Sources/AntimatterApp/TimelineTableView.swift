import AppKit
import SwiftUI

enum TableSnapshotUpdatePlan: Equatable {
    case incremental(removals: IndexSet, insertions: IndexSet)
    case reload

    static func make(oldIDs: [String], newIDs: [String]) -> Self {
        let oldIDSet = Set(oldIDs)
        let newIDSet = Set(newIDs)
        let retainedOldIDs = oldIDs.filter(newIDSet.contains)
        let retainedNewIDs = newIDs.filter(oldIDSet.contains)

        guard oldIDs.count == oldIDSet.count,
              newIDs.count == newIDSet.count,
              retainedOldIDs == retainedNewIDs
        else { return .reload }

        return .incremental(
            removals: IndexSet(oldIDs.indices.filter { !newIDSet.contains(oldIDs[$0]) }),
            insertions: IndexSet(newIDs.indices.filter { !oldIDSet.contains(newIDs[$0]) })
        )
    }
}

struct TimelineTableScrollRequest: Equatable {
    enum Anchor {
        case center
        case bottom
    }

    let id = UUID()
    let rowID: String
    let postID: String
    let anchor: Anchor
}

struct TimelineTableView: NSViewRepresentable {
    typealias NSViewType = TimelineScrollView

    let rowIDs: [String]
    let scrollRequest: TimelineTableScrollRequest?
    let onScrollApplied: (String) -> Void
    @EnvironmentObject private var userColorSettings: UserColorSettings
    let rowContent: @MainActor (Int, @escaping (ReactionTooltip?) -> Void) -> AnyView

    func makeCoordinator() -> Coordinator {
        Coordinator(rowIDs: [], userColorSettings: userColorSettings, rowContent: rowContent)
    }

    func makeNSView(context: Context) -> TimelineScrollView {
        let tableView = NSTableView()
        let column = NSTableColumn(identifier: NSUserInterfaceItemIdentifier("timeline"))
        column.resizingMask = .autoresizingMask
        tableView.addTableColumn(column)
        tableView.headerView = nil
        tableView.backgroundColor = .clear
        tableView.selectionHighlightStyle = .none
        tableView.allowsColumnSelection = false
        tableView.allowsMultipleSelection = false
        tableView.allowsEmptySelection = true
        tableView.intercellSpacing = .zero
        tableView.columnAutoresizingStyle = .lastColumnOnlyAutoresizingStyle
        tableView.rowHeight = 44
        tableView.usesAutomaticRowHeights = true
        tableView.dataSource = context.coordinator
        tableView.delegate = context.coordinator

        let scrollView = TimelineScrollView()
        scrollView.drawsBackground = false
        scrollView.hasVerticalScroller = true
        scrollView.hasHorizontalScroller = false
        scrollView.autohidesScrollers = true
        scrollView.automaticallyAdjustsContentInsets = false
        scrollView.contentInsets = NSEdgeInsets(top: 10, left: 0, bottom: 10, right: 0)
        scrollView.documentView = tableView
        scrollView.timelineTableView = tableView
        context.coordinator.tableView = tableView
        context.coordinator.scrollView = scrollView
        return scrollView
    }

    func updateNSView(_ scrollView: TimelineScrollView, context: Context) {
        context.coordinator.rowContent = rowContent
        context.coordinator.userColorSettings = userColorSettings
        context.coordinator.onScrollApplied = onScrollApplied
        context.coordinator.apply(rowIDs: rowIDs, scrollRequest: scrollRequest)
    }

    @MainActor
    final class Coordinator: NSObject, NSTableViewDataSource, NSTableViewDelegate {
        private static let cellID = NSUserInterfaceItemIdentifier("timeline-hosting-cell")

        fileprivate weak var tableView: NSTableView?
        fileprivate weak var scrollView: TimelineScrollView?
        fileprivate var rowContent: @MainActor (Int, @escaping (ReactionTooltip?) -> Void) -> AnyView
        fileprivate var userColorSettings: UserColorSettings
        fileprivate var onScrollApplied: (String) -> Void = { _ in }
        private let anchorRegistry = TimelineAnchorRegistry()
        private var rowIDs: [String]
        private var handledScrollRequestID: UUID?
        private var activeScrollRequestID: UUID?

        init(
            rowIDs: [String],
            userColorSettings: UserColorSettings,
            rowContent: @escaping @MainActor (Int, @escaping (ReactionTooltip?) -> Void) -> AnyView
        ) {
            self.rowIDs = rowIDs
            self.userColorSettings = userColorSettings
            self.rowContent = rowContent
        }

        func numberOfRows(in tableView: NSTableView) -> Int {
            rowIDs.count
        }

        func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
            guard rowIDs.indices.contains(row) else { return nil }
            let cell = (tableView.makeView(withIdentifier: Self.cellID, owner: nil) as? TimelineHostingCell)
                ?? TimelineHostingCell(identifier: Self.cellID)
            configure(cell, for: row)
            return cell
        }

        func tableView(_ tableView: NSTableView, didRemove rowView: NSTableRowView, forRow row: Int) {
            scrollView?.hideTooltip()
        }

        private func configure(_ cell: TimelineHostingCell, for row: Int) {
            guard rowIDs.indices.contains(row) else { return }
            cell.setRootView(
                AnyView(
                    rowContent(row) { [weak self] tooltip in
                        self?.presentTooltip(tooltip)
                    }
                    .environmentObject(userColorSettings)
                    .environment(\.timelineAnchorRegistry, anchorRegistry)
                ),
                rowID: rowIDs[row]
            )
        }

        fileprivate func apply(rowIDs newRowIDs: [String], scrollRequest: TimelineTableScrollRequest?) {
            guard let tableView, let scrollView else { return }
            let anchor = visibleAnchor(in: tableView, retaining: Set(newRowIDs))
            let plan = TableSnapshotUpdatePlan.make(oldIDs: rowIDs, newIDs: newRowIDs)
            rowIDs = newRowIDs

            switch plan {
            case .reload:
                tableView.reloadData()
            case .incremental(let removals, let insertions):
                if !removals.isEmpty || !insertions.isEmpty {
                    tableView.beginUpdates()
                    if !removals.isEmpty { tableView.removeRows(at: removals, withAnimation: []) }
                    if !insertions.isEmpty { tableView.insertRows(at: insertions, withAnimation: []) }
                    tableView.endUpdates()
                }

                let visibleRows = tableView.rows(in: tableView.visibleRect)
                if visibleRows.location != NSNotFound, visibleRows.length > 0 {
                    let rowIndexes = IndexSet(
                        integersIn: visibleRows.location..<(visibleRows.location + visibleRows.length)
                    )
                    for row in rowIndexes {
                        if let cell = tableView.view(atColumn: 0, row: row, makeIfNecessary: false)
                            as? TimelineHostingCell {
                            configure(cell, for: row)
                        }
                    }
                    tableView.noteHeightOfRows(withIndexesChanged: rowIndexes)
                }
            }

            tableView.layoutSubtreeIfNeeded()
            scrollView.updateBottomInset()

            if let scrollRequest, scrollRequest.id != handledScrollRequestID {
                if activeScrollRequestID != scrollRequest.id {
                    activeScrollRequestID = scrollRequest.id
                    scroll(request: scrollRequest, attemptsRemaining: 8, in: tableView)
                }
            } else if let anchor, let row = rowIDs.firstIndex(of: anchor.rowID) {
                activeScrollRequestID = nil
                restore(anchor: anchor, row: row, in: tableView)
            }
        }

        private func visibleAnchor(in tableView: NSTableView, retaining newRowIDs: Set<String>) -> VisibleAnchor? {
            let visibleRows = tableView.rows(in: tableView.visibleRect)
            guard visibleRows.location != NSNotFound,
                  visibleRows.length > 0
            else { return nil }
            let range = visibleRows.location..<(visibleRows.location + visibleRows.length)
            if let row = TableVisibleAnchorPlan.preferredRow(
                rowIDs: rowIDs,
                visibleRows: range,
                retaining: newRowIDs
            ) {
                return VisibleAnchor(
                    rowID: rowIDs[row],
                    offset: tableView.visibleRect.minY - tableView.rect(ofRow: row).minY
                )
            }
            return nil
        }

        private func restore(anchor: VisibleAnchor, row: Int, in tableView: NSTableView) {
            guard let clipView = tableView.enclosingScrollView?.contentView else { return }
            let y = tableView.rect(ofRow: row).minY + anchor.offset
            clipView.scroll(to: NSPoint(x: clipView.bounds.minX, y: y))
            tableView.enclosingScrollView?.reflectScrolledClipView(clipView)
        }

        private func scroll(
            request: TimelineTableScrollRequest,
            attemptsRemaining: Int,
            in tableView: NSTableView
        ) {
            guard activeScrollRequestID == request.id,
                  let row = rowIDs.firstIndex(of: request.rowID),
                  let scrollView = tableView.enclosingScrollView
            else { return }
            let clipView = scrollView.contentView
            let rowRect = tableView.rect(ofRow: row)
            let fallbackY: CGFloat = switch request.anchor {
            case .center:
                rowRect.midY - clipView.bounds.height / 2
            case .bottom:
                rowRect.maxY - clipView.bounds.height + scrollView.contentInsets.bottom
            }
            clipView.scroll(to: NSPoint(x: clipView.bounds.minX, y: fallbackY))
            scrollView.reflectScrolledClipView(clipView)
            tableView.layoutSubtreeIfNeeded()

            guard let targetView = anchorRegistry.view(for: .post(request.postID)) else {
                guard attemptsRemaining > 0 else { return }
                DispatchQueue.main.async { [weak self, weak tableView] in
                    guard let self, let tableView,
                          self.activeScrollRequestID == request.id
                    else { return }
                    self.scroll(
                        request: request,
                        attemptsRemaining: attemptsRemaining - 1,
                        in: tableView
                    )
                }
                return
            }
            let targetRect = targetView.convert(targetView.bounds, to: tableView)
            let y: CGFloat = switch request.anchor {
            case .center:
                targetRect.midY - clipView.bounds.height / 2
            case .bottom:
                targetRect.maxY - clipView.bounds.height + scrollView.contentInsets.bottom
            }
            NSAnimationContext.runAnimationGroup { context in
                context.duration = 0.15
                context.timingFunction = CAMediaTimingFunction(name: .easeOut)
                clipView.animator().setBoundsOrigin(NSPoint(x: clipView.bounds.minX, y: y))
            } completionHandler: { [weak self, weak scrollView] in
                Task { @MainActor [weak self, weak scrollView] in
                    guard let self, self.activeScrollRequestID == request.id else { return }
                    if let scrollView {
                        scrollView.reflectScrolledClipView(scrollView.contentView)
                    }
                    self.handledScrollRequestID = request.id
                    self.activeScrollRequestID = nil
                    self.onScrollApplied(request.postID)
                }
            }
        }

        private func presentTooltip(_ tooltip: ReactionTooltip?) {
            guard let scrollView else { return }
            guard let tooltip,
                  let anchorView = anchorRegistry.view(for: .reaction(tooltip.id))
            else {
                scrollView.hideTooltip()
                return
            }
            scrollView.showTooltip(
                tooltip,
                anchorRect: anchorView.convert(anchorView.bounds, to: scrollView.tooltipOverlayView)
            )
        }

        private struct VisibleAnchor {
            let rowID: String
            let offset: CGFloat
        }
    }
}

enum TableVisibleAnchorPlan {
    static func preferredRow(
        rowIDs: [String],
        visibleRows: Range<Int>,
        retaining newRowIDs: Set<String>
    ) -> Int? {
        visibleRows.first { row in
            rowIDs.indices.contains(row)
                && rowIDs[row] != "load-earlier"
                && !rowIDs[row].hasPrefix("day-")
                && newRowIDs.contains(rowIDs[row])
        }
    }
}

@MainActor
final class TimelineScrollView: NSScrollView {
    weak var timelineTableView: NSTableView?
    fileprivate let tooltipOverlayView = TimelineTooltipOverlayView()
    private var isUpdatingInset = false
    private var previousViewportWidth: CGFloat = 0

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        tooltipOverlayView.translatesAutoresizingMaskIntoConstraints = false
        addSubview(tooltipOverlayView)
        NSLayoutConstraint.activate([
            tooltipOverlayView.leadingAnchor.constraint(equalTo: leadingAnchor),
            tooltipOverlayView.trailingAnchor.constraint(equalTo: trailingAnchor),
            tooltipOverlayView.topAnchor.constraint(equalTo: topAnchor),
            tooltipOverlayView.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func layout() {
        super.layout()
        let viewportWidth = contentView.bounds.width
        if abs(viewportWidth - previousViewportWidth) > 0.5,
           let tableView = timelineTableView,
           tableView.numberOfRows > 0 {
            previousViewportWidth = viewportWidth
            tableView.tableColumns.first?.width = viewportWidth
            tableView.noteHeightOfRows(withIndexesChanged: IndexSet(integersIn: 0..<tableView.numberOfRows))
        }
        updateBottomInset()
    }

    fileprivate func updateBottomInset() {
        guard !isUpdatingInset, let tableView = timelineTableView else { return }
        isUpdatingInset = true
        defer { isUpdatingInset = false }
        let contentHeight = tableView.numberOfRows > 0
            ? tableView.rect(ofRow: tableView.numberOfRows - 1).maxY
            : 0
        let topInset = max(10, contentView.bounds.height - contentHeight - 10)
        if abs(contentInsets.top - topInset) > 0.5 {
            contentInsets = NSEdgeInsets(top: topInset, left: 0, bottom: 10, right: 0)
        }
    }

    fileprivate func showTooltip(_ tooltip: ReactionTooltip, anchorRect: NSRect) {
        tooltipOverlayView.show(tooltip, anchorRect: anchorRect)
    }

    fileprivate func hideTooltip() {
        tooltipOverlayView.hide()
    }
}

@MainActor
private final class TimelineTooltipOverlayView: NSHostingView<AnyView> {
    init() {
        super.init(rootView: AnyView(EmptyView()))
    }

    @available(*, unavailable)
    required init(rootView: AnyView) {
        fatalError("init(rootView:) has not been implemented")
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    func show(_ tooltip: ReactionTooltip, anchorRect: NSRect) {
        rootView = AnyView(
            ReactionTooltipView(text: tooltip.text)
                .position(x: anchorRect.midX, y: anchorRect.maxY + 18)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        )
    }

    func hide() {
        rootView = AnyView(EmptyView())
    }
}

enum TimelineAnchorID: Hashable {
    case post(String)
    case reaction(String)
}

@MainActor
final class TimelineAnchorRegistry {
    private final class WeakView {
        weak var value: NSView?
        init(_ value: NSView) { self.value = value }
    }

    private var views: [TimelineAnchorID: WeakView] = [:]

    func register(_ view: NSView, for id: TimelineAnchorID) {
        views[id] = WeakView(view)
    }

    func unregister(_ view: NSView, for id: TimelineAnchorID) {
        guard views[id]?.value === view else { return }
        views[id] = nil
    }

    func view(for id: TimelineAnchorID) -> NSView? {
        views[id]?.value
    }
}

private struct TimelineAnchorRegistryKey: EnvironmentKey {
    static let defaultValue: TimelineAnchorRegistry? = nil
}

extension EnvironmentValues {
    var timelineAnchorRegistry: TimelineAnchorRegistry? {
        get { self[TimelineAnchorRegistryKey.self] }
        set { self[TimelineAnchorRegistryKey.self] = newValue }
    }
}

struct TimelineAnchorReporter: NSViewRepresentable {
    @Environment(\.timelineAnchorRegistry) private var registry
    let id: TimelineAnchorID

    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        registry?.register(view, for: id)
        return view
    }

    func updateNSView(_ view: NSView, context: Context) {
        context.coordinator.update(view: view, id: id, registry: registry)
    }

    static func dismantleNSView(_ view: NSView, coordinator: Coordinator) {
        coordinator.registry?.unregister(view, for: coordinator.id)
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(id: id, registry: registry)
    }

    @MainActor
    final class Coordinator {
        fileprivate var id: TimelineAnchorID
        fileprivate weak var registry: TimelineAnchorRegistry?

        init(id: TimelineAnchorID, registry: TimelineAnchorRegistry?) {
            self.id = id
            self.registry = registry
        }

        func update(view: NSView, id: TimelineAnchorID, registry: TimelineAnchorRegistry?) {
            self.registry?.unregister(view, for: self.id)
            self.id = id
            self.registry = registry
            registry?.register(view, for: id)
        }
    }
}

@MainActor
private final class TimelineHostingCell: NSTableCellView {
    private let hostingView = NSHostingView(rootView: AnyView(EmptyView()))
    private var rowID: String?

    init(identifier: NSUserInterfaceItemIdentifier) {
        super.init(frame: .zero)
        self.identifier = identifier
        hostingView.translatesAutoresizingMaskIntoConstraints = false
        hostingView.sizingOptions = [.intrinsicContentSize]
        hostingView.setContentHuggingPriority(.defaultLow, for: .horizontal)
        hostingView.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        addSubview(hostingView)
        NSLayoutConstraint.activate([
            hostingView.leadingAnchor.constraint(equalTo: leadingAnchor),
            hostingView.trailingAnchor.constraint(equalTo: trailingAnchor),
            hostingView.topAnchor.constraint(equalTo: topAnchor),
            hostingView.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func setRootView(_ rootView: AnyView, rowID: String) {
        self.rowID = rowID
        hostingView.rootView = AnyView(rootView.id(rowID))
    }

    override func prepareForReuse() {
        super.prepareForReuse()
        rowID = nil
        hostingView.rootView = AnyView(EmptyView())
    }
}
