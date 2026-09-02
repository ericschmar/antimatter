import { createContext, useContext } from "react";
import type {
        MattermostChannel,
        MattermostFileInfo,
        MattermostPost,
        MattermostUser,
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
 * Values shared by message rows and part renderers. Keep this limited to
 * instance identity and actions: lookup data belongs to each component's
 * tracked Valtio subscription so an update for one user cannot invalidate
 * every visible row.
 */
export type MuiTimelineContextValue = Pick<
	MuiMessageTimelineProps,
	| "onOpenAttachment"
	| "onShowMessageContextMenu"
	| "onSetUserColor"
	| "onStartDm"
	| "onReply"
	| "onToggleReaction"
	| "onVotePoll"
> & {
	currentUserId: string;
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
