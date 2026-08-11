import type { DockviewApi, SerializedDockview } from "dockview-core";
import {
	DockviewReact,
	type DockviewTheme,
	type IDockviewPanelProps,
	themeDark,
} from "dockview-react";
import type { SyntheticEvent } from "react";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
} from "react";
import { Resizable, type ResizeCallbackData } from "react-resizable";
import {
	type ChatPanelPlacement,
	type ChatViewStateByChannel,
	type ChatWorkspaceState,
	canRestoreChatWorkspaceLayout,
} from "../state/chatWorkspace";
import type {
	AppSettings,
	MattermostChannel,
	MattermostChannelMember,
	MattermostFileInfo,
	MattermostPost,
	MattermostUser,
	MattermostUserStatus,
	TypingUsersByChannel,
} from "../types";
import { channelLabel } from "../utils/format";
import { ChannelHeader } from "./ChannelHeader";
import {
	getStablePanelPosts,
	type PanelPostsCache,
} from "./chatWorkspacePanelPosts";
import {
	MessageComposer,
	type MessageComposerHandle,
	type MessageComposerProps,
} from "./MessageComposer";
import { MuiMessageTimeline } from "./mui-headless-timeline/MuiMessageTimeline";
import { NewMessageComposer } from "./NewMessageComposer";

type ChatWorkspaceProps = {
	workspace: ChatWorkspaceState;
	channels: MattermostChannel[];
	users: Record<string, MattermostUser>;
	currentUserId: string;
	posts: MattermostPost[];
	settings: AppSettings;
	channelMembers: Record<string, MattermostChannelMember[]>;
	typingUsers: TypingUsersByChannel;
	userColors: Record<string, string>;
	userImages: Record<string, string>;
	userStatuses: Record<string, MattermostUserStatus>;
	loading: boolean;
	loadingHistory?: boolean;
	composerProps: MessageComposerProps;
	chatViewStates: ChatViewStateByChannel;
	resolveImageSrc: (src: string) => Promise<string>;
	onActivateTab: (tabId: string) => void;
	onCloseTab: (tabId: string) => void;
	onOpenTab: (
		channelId: string,
		placement?: ChatPanelPlacement,
		referenceTabId?: string,
	) => void;
	onLayoutChange: (layout: unknown) => void;
	onOpenAttachment: (file: MattermostFileInfo) => Promise<void>;
	onShowMessageContextMenu: (post: MattermostPost) => void;
	onSetUserColor: (userId: string, color: string) => void;
	onStartDm: (userId: string) => void;
	onReply: (viewId: string, post: MattermostPost) => void;
	onCancelEdit: (viewId: string) => void;
	onCancelReply: (viewId: string) => void;
	onSetDraftMarkdown: (viewId: string, draftMarkdown: string) => void;
	onSetComposerHeight: (viewId: string, height: number) => void;
	onOpenUserPicker: () => void;
	onSendMessage: (
		channelId: string,
		message: string,
		rootId?: string,
		files?: File[],
	) => Promise<void>;
	onComposerRef: (
		channelId: string,
		handle: MessageComposerHandle | null,
	) => void;
	onToggleReaction: (post: MattermostPost, emojiName: string) => Promise<void>;
	onVotePoll: (post: MattermostPost, optionId: string) => Promise<void>;
	onLoadMore?: (channelId: string) => void;
};

type ChatWorkspaceContextValue = Omit<
	ChatWorkspaceProps,
	"workspace" | "onLayoutChange"
>;

const ChatWorkspaceContext = createContext<ChatWorkspaceContextValue | null>(
	null,
);

type ChatPanelParams = {
	channelId: string;
	title: string;
	type: MattermostChannel["type"];
};

function ChatPanel({ api, params }: IDockviewPanelProps<ChatPanelParams>) {
	const workspaceProps = useContext(ChatWorkspaceContext);
	if (!workspaceProps) return null;

	const panelChannel = workspaceProps.channels.find(
		(channel) => channel.id === params.channelId,
	);
	const currentUser = workspaceProps.users[workspaceProps.currentUserId] ?? {
		id: workspaceProps.currentUserId,
		username: workspaceProps.currentUserId,
	};
	const panelPostsRef = useRef<PanelPostsCache>(null);
	const panelPosts = useMemo(() => {
		const result = getStablePanelPosts(
			workspaceProps.posts,
			params.channelId,
			panelPostsRef.current,
		);
		panelPostsRef.current = result.cache;
		return result.posts;
	}, [params.channelId, workspaceProps.posts]);
	const panelTypingUsers = useMemo(
		() =>
			Object.keys(workspaceProps.typingUsers[params.channelId] ?? {}).map(
				(userId) =>
					workspaceProps.users[userId] ?? {
						id: userId,
						username: "Someone",
					},
			),
		[params.channelId, workspaceProps.typingUsers, workspaceProps.users],
	);
	const panelState = workspaceProps.chatViewStates[api.id];
	const editTargetId = panelState?.editTargetId ?? null;
	const replyTargetId = panelState?.replyTargetId ?? null;
	const composerHeight = Math.min(
		panelState?.composerHeight ?? workspaceProps.composerProps.composerHeight,
		workspaceProps.composerProps.maxComposerHeight,
	);
	const panelComposerProps = {
		...workspaceProps.composerProps,
		composerHeight,
		draftMarkdown: panelState?.draftMarkdown ?? "",
		editTarget: panelPosts.find((post) => post.id === editTargetId) ?? null,
		replyTarget: panelPosts.find((post) => post.id === replyTargetId) ?? null,
		onCancelEdit: () => workspaceProps.onCancelEdit(api.id),
		onCancelReply: () => workspaceProps.onCancelReply(api.id),
		onRequestComposerHeight: (height: number) =>
			workspaceProps.onSetComposerHeight(api.id, height),
		onSend: (message: string, rootId?: string, files?: File[]) =>
			workspaceProps.onSendMessage(params.channelId, message, rootId, files),
		onSetDraftMarkdown: (draftMarkdown: string) =>
			workspaceProps.onSetDraftMarkdown(api.id, draftMarkdown),
	};
	const setComposerRef = useCallback(
		(handle: MessageComposerHandle | null) => {
			workspaceProps.onComposerRef(api.id, handle);
		},
		[api.id, workspaceProps.onComposerRef],
	);
	const resizeComposer = useCallback(
		(_: SyntheticEvent, data: ResizeCallbackData) => {
			workspaceProps.onSetComposerHeight(
				api.id,
				Math.min(
					data.size.height,
					workspaceProps.composerProps.maxComposerHeight,
				),
			);
		},
		[
			api.id,
			workspaceProps.composerProps.maxComposerHeight,
			workspaceProps.onSetComposerHeight,
		],
	);
	const loadMorePanelMessages = useCallback(() => {
		workspaceProps.onLoadMore?.(params.channelId);
	}, [params.channelId, workspaceProps.onLoadMore]);
	return (
		<div
			className="chat-workspace-panel"
			onFocus={() => workspaceProps.onActivateTab(api.id)}
			onPointerDown={() => workspaceProps.onActivateTab(api.id)}
		>
			<ChannelHeader
				channel={panelChannel}
				channelMembers={workspaceProps.channelMembers[params.channelId] ?? []}
				currentUserId={workspaceProps.currentUserId}
				settings={workspaceProps.settings}
				userImages={workspaceProps.userImages}
				userStatuses={workspaceProps.userStatuses}
				users={workspaceProps.users}
				onOpenUserPicker={workspaceProps.onOpenUserPicker}
			/>
			<MuiMessageTimeline
				channel={panelChannel}
				channelId={params.channelId}
				currentUser={currentUser}
				currentUserId={workspaceProps.currentUserId}
				loading={workspaceProps.loading}
				loadingHistory={workspaceProps.loadingHistory}
				posts={panelPosts}
				resolveImageSrc={workspaceProps.resolveImageSrc}
				ownMessageIndicatorColor={
					workspaceProps.settings.ownMessageIndicatorColor
				}
				showOwnMessageIndicators={
					workspaceProps.settings.showOwnMessageIndicators
				}
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
				onReply={(post) => workspaceProps.onReply(api.id, post)}
				onToggleReaction={workspaceProps.onToggleReaction}
				onVotePoll={workspaceProps.onVotePoll}
				onLoadMore={loadMorePanelMessages}
			/>
			<Resizable
				axis="y"
				height={composerHeight}
				maxConstraints={[0, workspaceProps.composerProps.maxComposerHeight]}
				minConstraints={[0, 0]}
				onResize={resizeComposer}
				resizeHandles={["n"]}
				width={0}
			>
				<div
					className="chat-workspace-panel-composer resizable-composer"
					style={{ height: composerHeight }}
				>
					{workspaceProps.settings.useNewComposer ? (
						<NewMessageComposer {...panelComposerProps} ref={setComposerRef} />
					) : (
						<MessageComposer {...panelComposerProps} ref={setComposerRef} />
					)}
				</div>
			</Resizable>
		</div>
	);
}

const dockviewComponents = {
	chat: ChatPanel,
};

const chatWorkspaceDockviewTheme: DockviewTheme = {
	...themeDark,
	name: "antimatter-chat-workspace",
	className: `${themeDark.className} chat-workspace-dockview-theme`,
};

export function ChatWorkspace({
	workspace,
	channels,
	users,
	currentUserId,
	posts,
	settings,
	channelMembers,
	typingUsers,
	userColors,
	userImages,
	userStatuses,
	loading,
	loadingHistory,
	composerProps,
	chatViewStates,
	resolveImageSrc,
	onActivateTab,
	onCloseTab,
	onOpenTab,
	onLayoutChange,
	onOpenAttachment,
	onShowMessageContextMenu,
	onSetUserColor,
	onStartDm,
	onReply,
	onCancelEdit,
	onCancelReply,
	onSetDraftMarkdown,
	onSetComposerHeight,
	onOpenUserPicker,
	onSendMessage,
	onComposerRef,
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
						position: tab.position,
					},
				];
			}),
		[channelsById, currentUserId, users, workspace.tabs],
	);
	const dockviewApiRef = useRef<DockviewApi | null>(null);

	useEffect(() => {
		if (!workspace.activeTabId) return;
		dockviewApiRef.current?.getPanel(workspace.activeTabId)?.api.setActive();
	}, [workspace.activeTabId]);

	const workspaceProps = useMemo(
		() => ({
			channels,
			users,
			currentUserId,
			posts,
			settings,
			channelMembers,
			typingUsers,
			userColors,
			userImages,
			userStatuses,
			loading,
			loadingHistory,
			composerProps,
			chatViewStates,
			resolveImageSrc,
			onActivateTab,
			onCloseTab,
			onOpenTab,
			onOpenAttachment,
			onShowMessageContextMenu,
			onSetUserColor,
			onStartDm,
			onReply,
			onCancelReply,
			onCancelEdit,
			onSetDraftMarkdown,
			onSetComposerHeight,
			onOpenUserPicker,
			onComposerRef,
			onToggleReaction,
			onVotePoll,
			onLoadMore,
			onSendMessage,
		}),
		[
			channels,
			users,
			currentUserId,
			posts,
			settings,
			channelMembers,
			typingUsers,
			userColors,
			userImages,
			userStatuses,
			loading,
			loadingHistory,
			composerProps,
			chatViewStates,
			resolveImageSrc,
			onActivateTab,
			onCloseTab,
			onOpenTab,
			onOpenAttachment,
			onShowMessageContextMenu,
			onSetUserColor,
			onStartDm,
			onReply,
			onCancelReply,
			onCancelEdit,
			onSetDraftMarkdown,
			onSetComposerHeight,
			onOpenUserPicker,
			onComposerRef,
			onToggleReaction,
			onVotePoll,
			onLoadMore,
			onSendMessage,
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
			<div className="chat-workspace-dockview">
				<ChatWorkspaceContext.Provider value={workspaceProps}>
					<DockviewReact
						key={Object.keys(workspace.tabs).join(":")}
						components={dockviewComponents}
						getTabContextMenuItems={({ panel }) => [
							{
								label: "Split right",
								action: () => {
									onOpenTab(
										(panel.params as ChatPanelParams).channelId,
										"right",
										panel.id,
									);
								},
							},
							{
								label: "Split down",
								action: () => {
									onOpenTab(
										(panel.params as ChatPanelParams).channelId,
										"below",
										panel.id,
									);
								},
							},
							"separator",
							"close",
							"closeOthers",
						]}
						theme={chatWorkspaceDockviewTheme}
						onReady={(event) => {
							dockviewApiRef.current = event.api;

							const restorableLayout = canRestoreChatWorkspaceLayout(
								workspace.layout,
								tabs,
							)
								? (workspace.layout as SerializedDockview)
								: null;

							for (const tab of tabs) {
								event.api.addPanel({
									id: tab.id,
									component: "chat",
									title: tab.title,
									position:
										!restorableLayout && tab.position
											? {
													referencePanel: tab.position.referenceTabId,
													direction: tab.position.placement,
												}
											: undefined,
									params: {
										channelId: tab.channelId,
										title: tab.title,
										type: tab.type,
									},
								});
							}
							if (restorableLayout) {
								event.api.fromJSON(restorableLayout, {
									reuseExistingPanels: false,
								});
							}
							if (workspace.activeTabId) {
								event.api.getPanel(workspace.activeTabId)?.api.setActive();
							}
							event.api.onDidActivePanelChange(({ panel }) => {
								if (panel) onActivateTab(panel.id);
							});
							event.api.onDidRemovePanel((panel) => {
								onCloseTab(panel.id);
							});
							event.api.onDidLayoutChange(() => {
								onLayoutChange(event.api.toJSON());
							});
						}}
					/>
				</ChatWorkspaceContext.Provider>
			</div>
		</section>
	);
}
