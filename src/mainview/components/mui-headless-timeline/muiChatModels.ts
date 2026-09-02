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
import { traceSync } from "../../utils/perfTrace";
import { buildTimelineRows } from "../../utils/timeline";
export type MuiTimelineModelData = {
        channelId: string | null;
        currentUserId: string;
        users: Record<string, MattermostUser>;
        userColors: Record<string, string>;
        userImages: Record<string, string>;
        userStatuses: Record<string, MattermostUserStatus>;
};

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

type CachedMuiMessage = {
	post: MattermostPost;
	replies: MattermostPost[];
	user: MattermostUser | undefined;
	image: string | undefined;
	status: MattermostUserStatus | undefined;
	color: string | undefined;
	channelId: string | null;
	currentUserId: string;
	message: ChatMessage;
};

// The timeline rebuilds its message list whenever posts, users, avatars, or
// presence change. Without per-message identity, every rebuild allocates fresh
// ChatMessage objects, which defeats `MuiMessageItem`'s `memo` and re-renders
// every visible row. This cache reuses a message object as long as the inputs
// that produced it are referentially equal. Replies are compared by content
// (refs + length) so the cache stays effective during a post burst, where the
// posts array is reallocated but unchanged threads hold the same reply objects.
// See Phase 1c.
const muiMessageCache = new Map<string, CachedMuiMessage>();
let muiMessageCacheChannel: string | null = null;
const MUI_MESSAGE_CACHE_MAX = 1000;

export function __resetMuiMessageCache(): void {
	muiMessageCache.clear();
	muiMessageCacheChannel = null;
}

function repliesEqual(a: MattermostPost[], b: MattermostPost[]): boolean {
	if (a === b) return true;
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i += 1) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

export function buildMuiTimelineMessages(
	posts: MattermostPost[],
	context: MuiTimelineModelData,
): ChatMessage[] {
	return traceSync("buildMuiTimelineMessages", () => {
		if (context.channelId !== muiMessageCacheChannel) {
			muiMessageCache.clear();
			muiMessageCacheChannel = context.channelId;
		}
		return buildTimelineRows(posts)
			.filter((row) => row.type === "message")
			.map((row) => {
				const post = row.post;
				const user = context.users[post.user_id];
				const image = context.userImages[post.user_id];
				const status = context.userStatuses[post.user_id];
				const color = context.userColors[post.user_id];
				const cached = muiMessageCache.get(post.id);
				if (
					cached &&
					cached.post === post &&
					repliesEqual(cached.replies, row.replies) &&
					cached.user === user &&
					cached.image === image &&
					cached.status === status &&
					cached.color === color &&
					cached.channelId === context.channelId &&
					cached.currentUserId === context.currentUserId
				) {
					return cached.message;
				}
				const files = post.metadata?.files ?? [];
				const reactions = post.metadata?.reactions ?? [];
				const poll =
					post.type === POLL_POST_TYPE ? post.props?.poll : undefined;
				const message: ChatMessage = {
					id: post.id,
					conversationId: context.channelId ?? "timeline",
					role: post.user_id === context.currentUserId ? "user" : "assistant",
					parts: buildMuiMessageParts(post, row.replies),
					createdAt: new Date(post.create_at).toISOString(),
					updatedAt: new Date(post.update_at).toISOString(),
					editedAt:
						post.update_at > post.create_at && post.delete_at === 0
							? new Date(post.update_at).toISOString()
							: undefined,
					status: post.failed ? "error" : post.pending ? "sending" : "sent",
					author: {
						id: post.user_id,
						displayName: userLabel(user, post.user_id),
						avatarUrl: image,
						isOnline: status?.status === "online",
						role: post.user_id === context.currentUserId ? "user" : "assistant",
						metadata: { mattermostUser: user, status },
					},
					metadata: {
						post,
						replies: row.replies,
						files,
						reactions,
						poll,
						deleted: post.delete_at > 0,
						pending: Boolean(post.pending),
						failed: Boolean(post.failed),
						userColor: color,
					} satisfies MattermostMessageMetadata,
				};
				if (muiMessageCache.size >= MUI_MESSAGE_CACHE_MAX) {
					const oldestKey = muiMessageCache.keys().next().value;
					if (oldestKey !== undefined) muiMessageCache.delete(oldestKey);
				}
				muiMessageCache.set(post.id, {
					post,
					replies: row.replies,
					user,
					image,
					status,
					color,
					channelId: context.channelId,
					currentUserId: context.currentUserId,
					message,
				});
				return message;
			});
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
