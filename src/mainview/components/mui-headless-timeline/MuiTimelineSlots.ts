import type {
	MessageActionsSlotProps,
	MessageAvatarSlotProps,
	MessageContentSlotProps,
	MessageGroupSlotProps,
	MessageListDateDividerSlotProps,
	MessageListRootSlotProps,
	MessageMetaSlotProps,
	MessageRootSlotProps,
} from "@mui/x-chat/headless";

export const muiTimelineSlotProps: {
	messageList: MessageListRootSlotProps;
	messageGroup: MessageGroupSlotProps;
	messageRoot: MessageRootSlotProps;
	messageAvatar: MessageAvatarSlotProps;
	messageContent: MessageContentSlotProps;
	messageMeta: MessageMetaSlotProps;
	messageActions: MessageActionsSlotProps;
	dateDivider: MessageListDateDividerSlotProps;
} = {
	messageList: {
		messageList: { className: "mui-message-list-root" },
		messageListScroller: { className: "mui-message-list-scroller" },
		messageListContent: { className: "mui-message-list-content" },
	},
	messageGroup: {
		group: (ownerState) => ({
			className: ownerState.isFirst
				? "mui-message-group"
				: "mui-message-group is-grouped",
		}),
		authorName: { className: "mui-message-group-author" },
		groupTimestamp: { className: "mui-message-group-timestamp" },
	},
	messageRoot: {
		root: (ownerState) => ({
			className: [
				"mui-message-root",
				ownerState.isOwnMessage ? "own" : "",
				ownerState.isGrouped ? "is-grouped" : "",
				ownerState.status === "error" ? "failed" : "",
				ownerState.status === "sending" ? "pending" : "",
			]
				.filter(Boolean)
				.join(" "),
		}),
	},
	messageAvatar: {
		avatar: { className: "mui-message-avatar" },
		image: { className: "mui-message-avatar-image" },
	},
	messageContent: {
		content: { className: "mui-message-content" },
		bubble: (ownerState) => ({
			className: ownerState.isOwnMessage
				? "mui-message-bubble own"
				: "mui-message-bubble",
		}),
	},
	messageMeta: {
		meta: { className: "mui-message-meta" },
		timestamp: { className: "mui-message-meta-timestamp" },
		status: { className: "mui-message-meta-status" },
		edited: { className: "mui-message-meta-edited" },
	},
	messageActions: {
		actions: { className: "mui-message-actions" },
	},
	dateDivider: {
		divider: { className: "mui-date-divider" },
		label: { className: "mui-date-divider-label" },
	},
};
