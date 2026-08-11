import type {
	ChatConversation,
	ChatMessage,
	ChatMessagePart,
	ChatUser,
} from "@mui/x-chat/headless";
import { POLL_POST_TYPE } from "../../mattermostApi";
import type {
	MattermostChannel,
	MattermostFileInfo,
	MattermostPost,
	MattermostReaction,
	MattermostUser,
	MattermostUserStatus,
	PollProps,
} from "../../types";
import { userLabel } from "../../utils/format";
import { buildTimelineRows } from "../../utils/timeline";
import type { MuiTimelineContextValue } from "./MuiTimelineContext";

export type MattermostMessagePart =
	| ChatMessagePart
	| { type: "data-deleted"; data: { post: MattermostPost } }
	| { type: "data-poll"; data: { post: MattermostPost; poll: PollProps } }
	| {
			type: "data-attachments";
			data: { post: MattermostPost; files: MattermostFileInfo[] };
	  }
	| {
			type: "data-reactions";
			data: { post: MattermostPost; reactions: MattermostReaction[] };
	  }
	| {
			type: "data-replies";
			data: { post: MattermostPost; replies: MattermostPost[] };
	  };

export type MattermostMessageMetadata = {
	post: MattermostPost;
	replies: MattermostPost[];
	files: MattermostFileInfo[];
	reactions: MattermostReaction[];
	poll?: PollProps;
	deleted: boolean;
	pending: boolean;
	failed: boolean;
	userColor?: string;
};

export function buildMuiUsers(
	users: Record<string, MattermostUser>,
	userStatuses: Record<string, MattermostUserStatus>,
	userImages: Record<string, string>,
	currentUserId: string,
): ChatUser[] {
	return Object.values(users).map((user) => ({
		id: user.id,
		displayName: userLabel(user, user.id),
		avatarUrl: userImages[user.id],
		isOnline: userStatuses[user.id]?.status === "online",
		role: user.id === currentUserId ? "user" : "assistant",
		metadata: { mattermostUser: user, status: userStatuses[user.id] },
	}));
}

export function buildMuiConversation(
	channelId: string | null,
	participants: ChatUser[],
	channel?: MattermostChannel,
): ChatConversation {
	return {
		id: channelId ?? "timeline",
		title: channel?.display_name || channel?.name || "Timeline",
		participants,
		lastMessageAt: undefined,
		metadata: channel ? { mattermostChannel: channel } : undefined,
	};
}

export function buildMuiTimelineMessages(
	posts: MattermostPost[],
	context: MuiTimelineContextValue,
): ChatMessage[] {
	return buildTimelineRows(posts)
		.filter((row) => row.type === "message")
		.map((row) => {
			const author = context.users[row.post.user_id];
			const userColor = context.userColors[row.post.user_id];
			const files = row.post.metadata?.files ?? [];
			const reactions = row.post.metadata?.reactions ?? [];
			const poll =
				row.post.type === POLL_POST_TYPE ? row.post.props?.poll : undefined;
			return {
				id: row.post.id,
				conversationId: context.channelId ?? "timeline",
				role: row.post.user_id === context.currentUserId ? "user" : "assistant",
				parts: buildMuiMessageParts(row.post, row.replies),
				createdAt: new Date(row.post.create_at).toISOString(),
				updatedAt: new Date(row.post.update_at).toISOString(),
				editedAt:
					row.post.update_at > row.post.create_at && row.post.delete_at === 0
						? new Date(row.post.update_at).toISOString()
						: undefined,
				status: row.post.failed
					? "error"
					: row.post.pending
						? "sending"
						: "sent",
				author: {
					id: row.post.user_id,
					displayName: userLabel(author, row.post.user_id),
					avatarUrl: context.userImages[row.post.user_id],
					isOnline: context.userStatuses[row.post.user_id]?.status === "online",
					role:
						row.post.user_id === context.currentUserId ? "user" : "assistant",
					metadata: {
						mattermostUser: author,
						status: context.userStatuses[row.post.user_id],
					},
				},
				metadata: {
					post: row.post,
					replies: row.replies,
					files,
					reactions,
					poll,
					deleted: row.post.delete_at > 0,
					pending: Boolean(row.post.pending),
					failed: Boolean(row.post.failed),
					userColor,
				} satisfies MattermostMessageMetadata,
			};
		});
}

export function buildMuiMessageParts(
	post: MattermostPost,
	replies: MattermostPost[],
): MattermostMessagePart[] {
	if (post.delete_at > 0) {
		return [{ type: "data-deleted", data: { post } }];
	}

	const parts: MattermostMessagePart[] = [];
	const poll = post.type === POLL_POST_TYPE ? post.props?.poll : undefined;

	if (poll) {
		parts.push({ type: "data-poll", data: { post, poll } });
	} else if (post.message) {
		parts.push({ type: "text", text: post.message });
	}

	const files = post.metadata?.files ?? [];
	if (files.length > 0) {
		parts.push({ type: "data-attachments", data: { post, files } });
	}

	const reactions = post.metadata?.reactions ?? [];
	if (reactions.length > 0) {
		parts.push({ type: "data-reactions", data: { post, reactions } });
	}

	if (replies.length > 0) {
		parts.push({ type: "data-replies", data: { post, replies } });
	}

	return parts;
}
