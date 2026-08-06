import { DockviewReact, type IDockviewPanelProps } from "dockview-react";
import { useMemo } from "react";
import { MessageTimeline } from "./MessageTimeline";
import type { ChatWorkspaceState } from "../state/chatWorkspace";
import type {
	AppSettings,
	MattermostChannel,
	MattermostFileInfo,
	MattermostPost,
	MattermostUser,
	MattermostUserStatus,
	TypingUsersByChannel,
} from "../types";
import { channelLabel } from "../utils/format";

type ChatWorkspaceProps = {
	workspace: ChatWorkspaceState;
	channels: MattermostChannel[];
	users: Record<string, MattermostUser>;
	currentUserId: string;
	posts: MattermostPost[];
	settings: AppSettings;
	typingUsers: TypingUsersByChannel;
	userColors: Record<string, string>;
	userImages: Record<string, string>;
	userStatuses: Record<string, MattermostUserStatus>;
	loading: boolean;
	loadingHistory?: boolean;
	resolveImageSrc: (src: string) => Promise<string>;
	onActivateTab: (tabId: string) => void;
	onCloseTab: (tabId: string) => void;
	onOpenAttachment: (file: MattermostFileInfo) => Promise<void>;
	onShowMessageContextMenu: (post: MattermostPost) => void;
	onSetUserColor: (userId: string, color: string) => void;
	onStartDm: (userId: string) => void;
	onReply: (post: MattermostPost) => void;
	onToggleReaction: (post: MattermostPost, emojiName: string) => Promise<void>;
	onVotePoll: (post: MattermostPost, optionId: string) => Promise<void>;
	onLoadMore?: () => void;
};

type ChatPanelParams = {
	channelId: string;
	title: string;
	type: MattermostChannel["type"];
	workspaceProps: Omit<ChatWorkspaceProps, "workspace" | "channels">;
};

function ChatPanel({ params }: IDockviewPanelProps<ChatPanelParams>) {
	const { workspaceProps } = params;
	const panelPosts = workspaceProps.posts.filter(
		(post) => post.channel_id === params.channelId,
	);
	const panelTypingUsers = Object.keys(
		workspaceProps.typingUsers[params.channelId] ?? {},
	).map(
		(userId) =>
			workspaceProps.users[userId] ?? {
				id: userId,
				username: "Someone",
			},
	);

	return (
		<div className="chat-workspace-panel">
			<MessageTimeline
				channelId={params.channelId}
				currentUserId={workspaceProps.currentUserId}
				loading={workspaceProps.loading}
				loadingHistory={workspaceProps.loadingHistory}
				posts={panelPosts}
				resolveImageSrc={workspaceProps.resolveImageSrc}
				ownMessageIndicatorColor={workspaceProps.settings.ownMessageIndicatorColor}
				showOwnMessageIndicators={workspaceProps.settings.showOwnMessageIndicators}
				showProfilePictures={workspaceProps.settings.showProfilePictures}
				useNewComposer={workspaceProps.settings.useNewComposer}
				typingUsers={panelTypingUsers}
				userColors={workspaceProps.userColors}
				userImages={workspaceProps.userImages}
				userStatuses={workspaceProps.userStatuses}
				users={workspaceProps.users}
				onOpenAttachment={workspaceProps.onOpenAttachment}
				onShowMessageContextMenu={workspaceProps.onShowMessageContextMenu}
				onSetUserColor={workspaceProps.onSetUserColor}
				onStartDm={workspaceProps.onStartDm}
				onReply={workspaceProps.onReply}
				onToggleReaction={workspaceProps.onToggleReaction}
				onVotePoll={workspaceProps.onVotePoll}
				onLoadMore={workspaceProps.onLoadMore}
			/>
		</div>
	);
}

const dockviewComponents = {
	chat: ChatPanel,
};

export function ChatWorkspace({
	workspace,
	channels,
	users,
	currentUserId,
	posts,
	settings,
	typingUsers,
	userColors,
	userImages,
	userStatuses,
	loading,
	loadingHistory,
	resolveImageSrc,
	onActivateTab,
	onCloseTab,
	onOpenAttachment,
	onShowMessageContextMenu,
	onSetUserColor,
	onStartDm,
	onReply,
	onToggleReaction,
	onVotePoll,
	onLoadMore,
}: ChatWorkspaceProps) {
	const channelsById = useMemo(
		() => Object.fromEntries(channels.map((channel) => [channel.id, channel])),
		[channels],
	);
	const tabs = useMemo(
		() =>
			Object.values(workspace.tabs).flatMap((tab) => {
				const channel = channelsById[tab.channelId];
				if (!channel) return [];
				return [
					{
						id: tab.id,
						channelId: tab.channelId,
						title: channelLabel(channel, users, currentUserId),
						type: channel.type,
					},
				];
			}),
		[channelsById, currentUserId, users, workspace.tabs],
	);
	const workspaceProps = useMemo(
		() => ({
			users,
			currentUserId,
			posts,
			settings,
			typingUsers,
			userColors,
			userImages,
			userStatuses,
			loading,
			loadingHistory,
			resolveImageSrc,
			onActivateTab,
			onCloseTab,
			onOpenAttachment,
			onShowMessageContextMenu,
			onSetUserColor,
			onStartDm,
			onReply,
			onToggleReaction,
			onVotePoll,
			onLoadMore,
		}),
		[
			users,
			currentUserId,
			posts,
			settings,
			typingUsers,
			userColors,
			userImages,
			userStatuses,
			loading,
			loadingHistory,
			resolveImageSrc,
			onActivateTab,
			onCloseTab,
			onOpenAttachment,
			onShowMessageContextMenu,
			onSetUserColor,
			onStartDm,
			onReply,
			onToggleReaction,
			onVotePoll,
			onLoadMore,
		],
	);

	if (tabs.length === 0) {
		return null;
	}

	return (
		<section
			className="chat-workspace-preview"
			aria-label="Chat workspace preview"
		>
			<div className="dockview-theme-dark chat-workspace-dockview">
				<DockviewReact
					components={dockviewComponents}
					onReady={(event) => {
						for (const tab of tabs) {
							event.api.addPanel({
								id: tab.id,
								component: "chat",
								title: tab.title,
								params: {
									channelId: tab.channelId,
									title: tab.title,
									type: tab.type,
									workspaceProps,
								},
							});
						}
						event.api.onDidActivePanelChange(({ panel }) => {
							if (panel) onActivateTab(panel.id);
						});
						event.api.onDidRemovePanel((panel) => {
							onCloseTab(panel.id);
						});
					}}
				/>
			</div>
		</section>
	);
}
