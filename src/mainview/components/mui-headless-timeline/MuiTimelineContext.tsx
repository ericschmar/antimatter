import { createContext, useContext } from "react";
import type {
	MattermostChannel,
	MattermostFileInfo,
	MattermostPost,
	MattermostUser,
	MattermostUserStatus,
} from "../../types";

export type MuiMessageTimelineProps = {
	posts: MattermostPost[];
	channel: MattermostChannel | undefined;
	channelId: string | null;
	currentUser: MattermostUser;
	currentUserId: string;
	users: Record<string, MattermostUser>;
	userColors: Record<string, string>;
	userImages: Record<string, string>;
	userStatuses: Record<string, MattermostUserStatus>;
	loading: boolean;
	loadingHistory?: boolean;
	resolveImageSrc: (src: string) => Promise<string>;
	ownMessageIndicatorColor: string;
	showOwnMessageIndicators: boolean;
	showProfilePictures: boolean;
	useNewComposer: boolean;
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

export type MuiTimelineContextValue = MuiMessageTimelineProps;

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
