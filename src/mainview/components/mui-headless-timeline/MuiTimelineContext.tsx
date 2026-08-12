import { createContext, useContext } from "react";
import type {
	AppSettings,
	MattermostChannel,
	MattermostFileInfo,
	MattermostPost,
	MattermostUser,
	MattermostUserStatus,
} from "../../types";

/**
 * Props that are scoped to a single timeline instance: the channel being
 * rendered, its posts, loading state, and the per-instance callbacks. These
 * still vary per render site (e.g. a workspace split panel vs. the standalone
 * view) and are passed explicitly to `MuiMessageTimeline`.
 */
export type MuiMessageTimelineProps = {
	posts: MattermostPost[];
	channel: MattermostChannel | undefined;
	channelId: string | null;
	loading: boolean;
	loadingHistory?: boolean;
	typingUsers: MattermostUser[];
	onOpenAttachment: (file: MattermostFileInfo) => Promise<void>;
	onShowMessageContextMenu: (post: MattermostPost) => void;
	onSetUserColor: (userId: string, color: string) => void;
	onStartDm: (userId: string) => void;
	onReply: (post: MattermostPost) => void;
	onToggleReaction: (post: MattermostPost, emojiName: string) => Promise<void>;
	onVotePoll: (post: MattermostPost, optionId: string) => Promise<void>;
	onLoadMore?: () => void;
};

/**
 * The full value consumed inside the timeline subtree. The lookup data half
 * (users, colors, images, statuses, current user, settings, image resolver) is
 * sourced from `chatDataStore` by `MuiMessageTimeline` rather than drilled in
 * as props; the instance half comes from `MuiMessageTimelineProps`.
 */
export type MuiTimelineContextValue = MuiMessageTimelineProps & {
	currentUser: MattermostUser;
	currentUserId: string;
	users: Record<string, MattermostUser>;
	userColors: Record<string, string>;
	userImages: Record<string, string>;
	userStatuses: Record<string, MattermostUserStatus>;
	settings: AppSettings;
	resolveImageSrc: (src: string) => Promise<string>;
};

const MuiTimelineContext = createContext<MuiTimelineContextValue | null>(null);

export function MuiTimelineProvider({
	children,
	value,
}: {
	children: React.ReactNode;
	value: MuiTimelineContextValue;
}) {
	return (
		<MuiTimelineContext.Provider value={value}>
			{children}
		</MuiTimelineContext.Provider>
	);
}

export function useMuiTimelineContext() {
	const context = useContext(MuiTimelineContext);
	if (!context) {
		throw new Error(
			"useMuiTimelineContext must be used within MuiTimelineProvider",
		);
	}
	return context;
}
