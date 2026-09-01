import * as Tooltip from "@radix-ui/react-tooltip";
import { Image as ImageIcon, X } from "lucide-react";
import type { RefObject, SyntheticEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Resizable, type ResizeCallbackData } from "react-resizable";
import { useSnapshot } from "valtio";
import type {
	ApplicationMenuAction,
	AppUpdateState,
} from "../../shared/electrobunRpc";
import { CallErrorToast } from "../components/CallErrorToast";
import { ChannelHeader } from "../components/ChannelHeader";
import { ChatWorkspace } from "../components/ChatWorkspace";
import { CommandMenu } from "../components/CommandMenu";
import { CreateChannelDialog } from "../components/CreateChannelDialog";
import { IncomingCallToast } from "../components/IncomingCallToast";
import {
	MessageComposer,
	type MessageComposerHandle,
	type MessageComposerProps,
} from "../components/MessageComposer";
import { MuiMessageTimeline } from "../components/mui-headless-timeline/MuiMessageTimeline";
import { NewMessageComposer } from "../components/NewMessageComposer";
import { PollDialog } from "../components/PollDialog";
import { Sidebar } from "../components/Sidebar";
import { Titlebar } from "../components/Titlebar";
import { UserPickerDialog } from "../components/UserPickerDialog";
import { useCall } from "../contexts/CallContext";
import type { MattermostApiClient } from "../mattermostApi";
import type { ChatPanelPlacement } from "../state/chatWorkspace";
import { chatWorkspaceStore } from "../state/chatWorkspaceStore";
import { uiActions, uiStore } from "../state/uiStore";
import {
	loadDismissedAppUpdateBannerKey,
	saveDismissedAppUpdateBannerKey,
} from "../storage";
import type {
	AppSettings,
	ChannelSectionKey,
	MattermostChannel,
	MattermostChannelMember,
	MattermostFileInfo,
	MattermostPost,
	MattermostTeam,
	MattermostUser,
	MattermostUserStatus,
	PollProps,
} from "../types";
import {
	findAdjacentMentionChannel,
	findAdjacentUnreadChannel,
	findAdjacentVisibleChannel,
	findSectionStartChannel,
} from "../utils/channelNavigation";
import { directChannelOtherUserId, userLabel } from "../utils/format";
import { readShortcutAction } from "../utils/shortcuts";
import { electrobun } from "./rpc";

export function ChatShell({
	api,
	channelEmojis,
	channelMembers,
	channelOrder,
	channels,
	collapsedSections,
	composerRef,
	composerHeight,
	currentUser,
	favoriteChannelSet,
	giphyApiKey,
	maxComposerHeight,
	maxSidebarWidth,
	minComposerHeight,
	minSidebarWidth,
	posts,
	workspacePosts,
	appUpdate,
	sections,
	onActivateChatTab,
	onCloseActiveChatTab,
	onCloseChatTab,
	selectedChannel,
	selectedChannelId,
	selectedTeam,
	selectedTeamId,
	settings,
	sidebarWidth,
	teams,
	userColors,
	userImages,
	users,
	userStatuses,
	onAddUserToSelectedChannel,
	onApplyAppUpdate,
	onArchiveChannel,
	onCancelEdit,
	onCancelReply,
	onCancelChatEdit,
	onCancelChatReply,
	onCreateChannel,
	onCreateDm,
	onEditMessage,
	onLoadMoreMessages,
	onOpenChatPanel,
	onMoveChannel,
	onPinChannel,
	onOpenAttachment,
	onOpenSettings,
	onSelectChannel,
	onSelectPost,
	onSelectTeam,
	onSendMessage,
	onSendPoll,
	onSendTyping,
	onSetChannelEmoji,
	onSetChatComposerHeight,
	onSetChatWorkspaceLayout,
	onSetComposerHeight,
	onSetDraftMarkdown,
	onSetUserColor,
	onSetSidebarWidth,
	onShowChannelContextMenu,
	onShowMessageContextMenu,
	onSignOut,
	onStartReply,
	onToggleChannelSection,
	onToggleFavoriteChannel,
	onToggleReaction,
	onUnarchiveChannel,
	onVotePoll,
}: ChatShellProps) {
	const ui = useSnapshot(uiStore);
	const { workspace: chatWorkspace, chatViewStates } =
		useSnapshot(chatWorkspaceStore);
	const { session } = useCall();
	const [dismissedAppUpdateToastKey, setDismissedAppUpdateToastKey] = useState(
		() => loadDismissedAppUpdateBannerKey() ?? "",
	);
	const [pollDialogOpen, setPollDialogOpen] = useState(false);
	const panelComposerRefs = useRef(new Map<string, MessageComposerHandle>());
	const appUpdateToastKey = getAppUpdateToastKey(appUpdate);
	const showAppUpdateToast =
		Boolean(appUpdateToastKey) &&
		appUpdateToastKey !== dismissedAppUpdateToastKey;
	const showNetworkOutageToast =
		ui.wsStatus === "disconnected" || ui.wsStatus === "error";
	const rpcTimeoutError = rpcTimeoutMessage(ui.error);
	const stackedToastCount = [showAppUpdateToast, showNetworkOutageToast].filter(
		Boolean,
	).length;

	function dismissAppUpdateToast() {
		if (!appUpdateToastKey) return;
		saveDismissedAppUpdateBannerKey(appUpdateToastKey);
		setDismissedAppUpdateToastKey(appUpdateToastKey);
	}
	const startDm = useCallback(
		(userId: string) => {
			void onCreateDm([userId]);
		},
		[onCreateDm],
	);
	const openUserPicker = useCallback(() => {
		uiActions.setAddUserOpen(true);
	}, []);
	const registerPanelComposerRef = useCallback(
		(channelId: string, handle: MessageComposerHandle | null) => {
			if (handle) {
				panelComposerRefs.current.set(channelId, handle);
			} else {
				panelComposerRefs.current.delete(channelId);
			}
		},
		[],
	);
	const getActiveComposer = useCallback(
		() =>
			selectedChannelId
				? (panelComposerRefs.current.get(selectedChannelId) ??
					composerRef.current)
				: composerRef.current,
		[composerRef, selectedChannelId],
	);
	const editTargetId = selectedChannelId
		? (chatViewStates[selectedChannelId]?.editTargetId ?? null)
		: null;
	const editTarget = editTargetId
		? (posts.find((post) => post.id === editTargetId) ?? null)
		: null;
	const replyTargetId = selectedChannelId
		? (chatViewStates[selectedChannelId]?.replyTargetId ?? null)
		: null;
	const replyTarget = replyTargetId
		? (posts.find((post) => post.id === replyTargetId) ?? null)
		: null;
	const draftMarkdown = selectedChannelId
		? (chatViewStates[selectedChannelId]?.draftMarkdown ?? "")
		: "";
	const selectedChannelUsers = channelMembers
		.map((member) => users[member.user_id])
		.filter((user): user is MattermostUser => Boolean(user));
	const hasRenderableChatWorkspace = Boolean(
		chatWorkspace &&
			Object.values(chatWorkspace.tabs).some((tab) =>
				channels.some((channel) => channel.id === tab.channelId),
			),
	);
	const selectedDirectUserId =
		selectedChannel && selectedChannel.type === "D"
			? directChannelOtherUserId(selectedChannel, currentUser.id)
			: null;
	const selectedDirectUser = selectedDirectUserId
		? users[selectedDirectUserId]
		: undefined;
	const selectedDirectUsername = selectedDirectUser
		? userLabel(
				selectedDirectUser,
				selectedDirectUserId ?? selectedDirectUser.id,
			)
		: (selectedDirectUserId ?? "Unknown user");
	const callParticipantUser = session?.otherUserId
		? users[session.otherUserId]
		: selectedDirectUser;
	const callParticipantName = callParticipantUser
		? userLabel(
				callParticipantUser,
				session?.otherUserId ?? selectedDirectUserId ?? callParticipantUser.id,
			)
		: (session?.otherUserId ?? selectedDirectUsername);
	const workspaceChannelMembers = selectedChannelId
		? { [selectedChannelId]: channelMembers }
		: {};
	const callParticipantAvatar = session?.otherUserId
		? userImages[session.otherUserId]
		: selectedDirectUserId
			? userImages[selectedDirectUserId]
			: undefined;
	const effectiveMaxComposerHeight = Math.max(
		minComposerHeight,
		Math.min(
			maxComposerHeight,
			typeof window === "undefined"
				? maxComposerHeight
				: Math.floor(window.innerHeight * 0.44),
		),
	);
	const visibleComposerHeight = Math.min(
		composerHeight,
		effectiveMaxComposerHeight,
	);
	const typingUsers = (
		selectedChannelId
			? Object.keys(ui.typingUsers[selectedChannelId] ?? {})
			: []
	).map(
		(userId) =>
			users[userId] ?? {
				id: userId,
				username: "Someone",
			},
	);
	const composerProps: MessageComposerProps = {
		composerHeight: visibleComposerHeight,
		currentUserId: currentUser.id,
		disabled: !selectedChannelId,
		draftMarkdown,
		editTarget,
		giphyApiKey,
		maxComposerHeight: effectiveMaxComposerHeight,
		mentionUsers: selectedChannelUsers,
		replyTarget,
		userColors,
		users,
		onCancelEdit,
		onCancelReply,
		onEdit: onEditMessage,
		onOpenPollDialog: () => setPollDialogOpen(true),
		onRequestComposerHeight: onSetComposerHeight,
		onSend: (message, rootId, files) => {
			if (!selectedChannelId) return Promise.resolve();
			return onSendMessage(selectedChannelId, message, rootId, files);
		},
		onSetDraftMarkdown: (nextDraftMarkdown) => {
			if (!selectedChannelId) return;
			onSetDraftMarkdown(selectedChannelId, nextDraftMarkdown);
		},
		onTyping: onSendTyping,
	};

	function resizeSidebar(_: SyntheticEvent, data: ResizeCallbackData) {
		onSetSidebarWidth(data.size.width);
	}

	function resizeComposer(_: SyntheticEvent, data: ResizeCallbackData) {
		onSetComposerHeight(Math.min(data.size.height, effectiveMaxComposerHeight));
	}

	const handleShortcutAction = useCallback(
		(action: ApplicationMenuAction["action"]) => {
			const navigationContext = {
				channelOrder,
				currentUserId: currentUser.id,
				notifications: ui.channelNotifications,
				sections,
				selectedChannelId,
				users,
			};
			let nextChannel: MattermostChannel | null = null;

			if (action === "navigate-favorites") {
				nextChannel = findSectionStartChannel(navigationContext, "favorites");
			}
			if (action === "navigate-channels") {
				nextChannel = findSectionStartChannel(navigationContext, "channels");
			}
			if (action === "navigate-dms") {
				nextChannel = findSectionStartChannel(navigationContext, "dms");
			}
			if (action === "navigate-prev-channel") {
				nextChannel = findAdjacentVisibleChannel(navigationContext, -1);
			}
			if (action === "navigate-next-channel") {
				nextChannel = findAdjacentVisibleChannel(navigationContext, 1);
			}
			if (action === "navigate-prev-unread") {
				nextChannel = findAdjacentUnreadChannel(navigationContext, -1);
			}
			if (action === "navigate-next-unread") {
				nextChannel = findAdjacentUnreadChannel(navigationContext, 1);
			}
			if (action === "navigate-prev-mention") {
				nextChannel = findAdjacentMentionChannel(navigationContext, -1);
			}
			if (action === "navigate-next-mention") {
				nextChannel = findAdjacentMentionChannel(navigationContext, 1);
			}
			if (nextChannel) {
				void onSelectChannel(nextChannel);
				return true;
			}
			if (action.startsWith("navigate-")) return true;
			if (action === "attach-file") {
				getActiveComposer()?.attachFiles();
				return true;
			}
			if (action === "attach-image") {
				getActiveComposer()?.attachImages();
				return true;
			}
			if (action === "open-emoji-picker") {
				getActiveComposer()?.openEmojiPicker();
				return true;
			}
			if (action === "close-active-tab") {
				onCloseActiveChatTab();
				return true;
			}
			return false;
		},
		[
			channelOrder,
			currentUser.id,
			getActiveComposer,
			onCloseActiveChatTab,
			onSelectChannel,
			sections,
			selectedChannelId,
			ui.channelNotifications,
			users,
		],
	);

	useEffect(() => {
		function handleApplicationMenu(event: Event) {
			handleShortcutAction(
				(event as CustomEvent<ApplicationMenuAction>).detail.action,
			);
		}

		function handleKeyDown(event: KeyboardEvent) {
			const action = readShortcutAction(event);
			if (!action) return;
			if (!handleShortcutAction(action)) return;
			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
		}

		window.addEventListener("application-menu-action", handleApplicationMenu);
		window.addEventListener("keydown", handleKeyDown, { capture: true });
		return () => {
			window.removeEventListener(
				"application-menu-action",
				handleApplicationMenu,
			);
			window.removeEventListener("keydown", handleKeyDown, { capture: true });
		};
	}, [handleShortcutAction]);

	return (
		<Tooltip.Provider>
			<div className="window-shell">
				<Titlebar
					onOpenSearch={() => uiActions.setCommandOpen(true)}
					onWindowControl={(action) => {
						void electrobun.rpc?.request.windowControl({ action });
					}}
				/>
				<div
					className="app-shell"
					style={{ gridTemplateColumns: `${sidebarWidth}px minmax(0, 1fr)` }}
				>
					<Resizable
						axis="x"
						height={0}
						maxConstraints={[maxSidebarWidth, 0]}
						minConstraints={[minSidebarWidth, 0]}
						resizeHandles={["e"]}
						width={sidebarWidth}
						onResize={resizeSidebar}
					>
						<div className="resizable-sidebar" style={{ width: sidebarWidth }}>
							<Sidebar
								activeCallParticipantName={callParticipantName}
								channelEmojis={channelEmojis}
								channelOrder={channelOrder}
								collapsedSections={collapsedSections}
								currentUser={currentUser}
								favoriteChannelSet={favoriteChannelSet}
								notifications={ui.channelNotifications}
								sections={sections}
								selectedChannelId={selectedChannelId}
								selectedTeam={selectedTeam}
								selectedTeamId={selectedTeamId}
								teamUnread={ui.teamUnread}
								teams={teams}
								userImages={userImages}
								userStatuses={userStatuses}
								users={users}
								wsStatus={ui.wsStatus}
								onArchiveChannel={onArchiveChannel}
								onMoveChannel={onMoveChannel}
								onPinChannel={onPinChannel}
								onSelectChannel={onSelectChannel}
								onSelectTeam={onSelectTeam}
								onSetChannelEmoji={onSetChannelEmoji}
								onShowChannelContextMenu={onShowChannelContextMenu}
								onOpenChatPanel={onOpenChatPanel}
								onOpenCreateChannel={() => uiActions.setCreateChannelOpen(true)}
								onOpenCreateDm={() => uiActions.setCreateDmOpen(true)}
								onSignOut={onSignOut}
								onToggleCollapsed={onToggleChannelSection}
								onToggleFavorite={onToggleFavoriteChannel}
								onUnarchiveChannel={onUnarchiveChannel}
							/>
						</div>
					</Resizable>

					<main className="main-panel">
						{hasRenderableChatWorkspace || !selectedChannelId ? null : (
							<ChannelHeader
								channel={selectedChannel}
								channelMembers={channelMembers}
								currentUserId={currentUser.id}
								settings={settings}
								userImages={userImages}
								userStatuses={userStatuses}
								users={users}
								onOpenUserPicker={openUserPicker}
							/>
						)}

						{hasRenderableChatWorkspace && chatWorkspace ? (
							<ChatWorkspace
								channelMembers={workspaceChannelMembers}
								composerProps={composerProps}
								loading={ui.status === "loading"}
								loadingHistory={ui.loadingHistory}
								onActivateTab={onActivateChatTab}
								onLayoutChange={onSetChatWorkspaceLayout}
								onOpenTab={onOpenChatPanel}
								onOpenUserPicker={openUserPicker}
								onCancelEdit={onCancelChatEdit}
								onCancelReply={onCancelChatReply}
								onCloseTab={onCloseChatTab}
								onLoadMore={(channelId) => void onLoadMoreMessages(channelId)}
								onOpenAttachment={onOpenAttachment}
								onReply={onStartReply}
								onSetComposerHeight={onSetChatComposerHeight}
								onSetDraftMarkdown={onSetDraftMarkdown}
								onSendMessage={onSendMessage}
								onComposerRef={registerPanelComposerRef}
								onSetUserColor={onSetUserColor}
								onShowMessageContextMenu={onShowMessageContextMenu}
								onStartDm={startDm}
								onToggleReaction={onToggleReaction}
								onVotePoll={onVotePoll}
								posts={workspacePosts}
								typingUsers={ui.typingUsers}
							/>
						) : selectedChannelId ? (
							<section className="chat-body">
								<MuiMessageTimeline
									channel={selectedChannel}
									channelId={selectedChannelId}
									loading={ui.status === "loading"}
									loadingHistory={ui.loadingHistory}
									posts={posts}
									typingUsers={typingUsers}
									onOpenAttachment={onOpenAttachment}
									onShowMessageContextMenu={onShowMessageContextMenu}
									onSetUserColor={onSetUserColor}
									onStartDm={startDm}
									onReply={(post) => {
										if (selectedChannelId)
											onStartReply(selectedChannelId, post);
									}}
									onToggleReaction={onToggleReaction}
									onVotePoll={onVotePoll}
									onLoadMore={onLoadMoreMessages}
								/>
								<Resizable
									axis="y"
									height={visibleComposerHeight}
									maxConstraints={[0, effectiveMaxComposerHeight]}
									minConstraints={[0, minComposerHeight]}
									resizeHandles={["n"]}
									width={0}
									onResize={resizeComposer}
								>
									<div
										className="resizable-composer"
										style={{ height: visibleComposerHeight }}
									>
										{settings.useNewComposer ? (
											<NewMessageComposer
												{...composerProps}
												ref={composerRef}
											/>
										) : (
											<MessageComposer {...composerProps} ref={composerRef} />
										)}
									</div>
								</Resizable>
							</section>
						) : (
							<section className="chat-empty">
								<div aria-hidden="true" className="chat-empty-image">
									<ImageIcon size={30} strokeWidth={1.5} />
								</div>
								<h2>Select a conversation</h2>
								<p>Pick a channel or direct message from the sidebar.</p>
							</section>
						)}
					</main>
				</div>
				<CommandMenu
					api={api}
					channels={channels}
					currentUserId={currentUser.id}
					open={ui.commandOpen}
					selectedTeamId={selectedTeamId}
					users={users}
					onClose={() => uiActions.setCommandOpen(false)}
					onCreateDm={(userId) => {
						uiActions.setCommandOpen(false);
						void onCreateDm([userId]);
					}}
					onSelectPost={(post) => {
						uiActions.setCommandOpen(false);
						void onSelectPost(post);
					}}
					onSelectChannel={(channel) => {
						uiActions.setCommandOpen(false);
						void onSelectChannel(channel);
					}}
					onOpenSettings={() => {
						uiActions.setCommandOpen(false);
						onOpenSettings(settings);
					}}
				/>
				<CreateChannelDialog
					open={ui.createChannelOpen}
					onClose={() => uiActions.setCreateChannelOpen(false)}
					onCreate={(displayName, name, type) =>
						void onCreateChannel(displayName, name, type)
					}
				/>
				<UserPickerDialog
					api={api}
					open={ui.createDmOpen}
					selectedTeamId={selectedTeamId}
					title="Create direct message"
					onClose={() => uiActions.setCreateDmOpen(false)}
					onSubmit={(userIds) => void onCreateDm(userIds)}
				/>
				<IncomingCallToast
					callerAvatar={callParticipantAvatar}
					callerName={callParticipantName}
				/>
				{showAppUpdateToast ? (
					<div className="update-toast" role="status">
						<div className="update-toast-body">
							<span>
								{appUpdate.updateReady
									? appUpdate.version
										? `Antimatter ${appUpdate.version} is ready to install.`
										: "An Antimatter update is ready to install."
									: (appUpdate.message ?? "Downloading Antimatter update...")}
							</span>
							<button
								aria-label="Dismiss update notification"
								className="update-toast-dismiss"
								title="Dismiss"
								type="button"
								onClick={dismissAppUpdateToast}
							>
								<X size={14} />
							</button>
						</div>
						{appUpdate.updateReady ? (
							<button type="button" onClick={onApplyAppUpdate}>
								Restart
							</button>
						) : null}
					</div>
				) : null}
				{showNetworkOutageToast ? (
					<div
						className={`update-toast network-outage-toast${showAppUpdateToast ? " stacked" : ""}`}
						role="status"
					>
						<div className="update-toast-body">
							<span>Network connection lost. Reconnecting…</span>
						</div>
					</div>
				) : null}
				{rpcTimeoutError ? (
					<div
						className="update-toast rpc-timeout-toast"
						role="alert"
						style={
							stackedToastCount > 0
								? { bottom: 20 + stackedToastCount * 98 }
								: undefined
						}
					>
						<div className="update-toast-body">
							<span>{rpcTimeoutError}</span>
							<button
								aria-label="Dismiss error notification"
								className="update-toast-dismiss"
								title="Dismiss"
								type="button"
								onClick={() => uiActions.setError(null)}
							>
								<X size={14} />
							</button>
						</div>
					</div>
				) : null}
				<CallErrorToast />
				<UserPickerDialog
					api={api}
					open={ui.addUserOpen}
					selectedTeamId={selectedTeamId}
					title="Add user to channel"
					onClose={() => uiActions.setAddUserOpen(false)}
					onSubmit={(userIds) => {
						const [userId] = userIds;
						if (userId) void onAddUserToSelectedChannel(userId);
					}}
				/>
				<PollDialog
					open={pollDialogOpen}
					onOpenChange={setPollDialogOpen}
					onSubmit={(poll) => void onSendPoll(poll)}
				/>
			</div>
		</Tooltip.Provider>
	);
}

// Electrobun rejects requests with exactly this message once maxRequestTime
// expires, so match it verbatim to route RPC timeouts to the toast.
function rpcTimeoutMessage(error: string | null): string | null {
	return error === "RPC request timed out." ? error : null;
}

function getAppUpdateToastKey(appUpdate: AppUpdateState) {
	const phase = appUpdate.updateReady
		? "ready"
		: appUpdate.status === "downloading"
			? "downloading"
			: null;
	if (!phase) return "";

	return [
		phase,
		appUpdate.hash,
		appUpdate.version,
		appUpdate.localHash,
		appUpdate.localVersion,
		appUpdate.message,
	]
		.filter(Boolean)
		.join(":");
}

type ChatShellProps = {
	api: MattermostApiClient | null;
	channelEmojis: Record<string, string>;
	channelMembers: MattermostChannelMember[];
	channelOrder: Readonly<Record<string, readonly string[]>>;
	channels: MattermostChannel[];
	collapsedSections: Record<ChannelSectionKey, boolean>;
	composerRef: RefObject<MessageComposerHandle | null>;
	composerHeight: number;
	currentUser: MattermostUser;
	favoriteChannelSet: Set<string>;
	giphyApiKey?: string;
	maxComposerHeight: number;
	maxSidebarWidth: number;
	minComposerHeight: number;
	minSidebarWidth: number;
	posts: MattermostPost[];
	workspacePosts: MattermostPost[];
	appUpdate: AppUpdateState;
	sections: Record<ChannelSectionKey, MattermostChannel[]>;
	onActivateChatTab: (tabId: string) => void;
	onCloseActiveChatTab: () => void;
	onCloseChatTab: (tabId: string) => void;
	selectedChannel: MattermostChannel | undefined;
	selectedChannelId: string | null;
	selectedTeam: MattermostTeam | undefined;
	selectedTeamId: string | null;
	settings: AppSettings;
	sidebarWidth: number;
	teams: MattermostTeam[];
	userColors: Record<string, string>;
	userImages: Record<string, string>;
	users: Record<string, MattermostUser>;
	userStatuses: Record<string, MattermostUserStatus>;
	onAddUserToSelectedChannel: (userId: string) => Promise<void>;
	onApplyAppUpdate: () => void;
	onArchiveChannel: (channelId: string) => void;
	onCancelEdit: () => void;
	onCancelReply: () => void;
	onCancelChatEdit: (channelId: string) => void;
	onCancelChatReply: (channelId: string) => void;
	onCreateChannel: (
		displayName: string,
		name: string,
		type: "O" | "P",
	) => Promise<void>;
	onCreateDm: (userIds: string[]) => Promise<void>;
	onEditMessage: (post: MattermostPost, message: string) => Promise<void>;
	onLoadMoreMessages: (channelId?: string) => Promise<void>;
	onOpenChatPanel: (
		channelId: string,
		placement?: ChatPanelPlacement,
		referenceTabId?: string,
	) => void;
	onMoveChannel: (section: ChannelSectionKey, channelIds: string[]) => void;
	onPinChannel: (channel: MattermostChannel) => void;
	onOpenAttachment: (file: MattermostFileInfo) => Promise<void>;
	onOpenSettings: (settings: AppSettings) => void;
	onSelectChannel: (channel: MattermostChannel) => Promise<void>;
	onSelectPost: (post: MattermostPost) => Promise<void>;
	onSelectTeam: (team: MattermostTeam) => Promise<void>;
	onSendMessage: (
		channelId: string,
		message: string,
		rootId?: string,
		files?: File[],
	) => Promise<void>;
	onSendPoll: (poll: PollProps) => Promise<void>;
	onSendTyping: (rootId?: string) => Promise<void>;
	onSetChannelEmoji: (channelId: string, emoji: string) => void;
	onSetChatComposerHeight: (viewId: string, height: number) => void;
	onSetChatWorkspaceLayout: (layout: unknown) => void;
	onSetComposerHeight: (height: number) => void;
	onSetDraftMarkdown: (viewId: string, draftMarkdown: string) => void;
	onSetUserColor: (userId: string, color: string) => void;
	onSetSidebarWidth: (width: number) => void;
	onShowChannelContextMenu: (channel: MattermostChannel) => void;
	onShowMessageContextMenu: (post: MattermostPost) => void;
	onSignOut: () => void;
	onStartReply: (viewId: string, post: MattermostPost) => void;
	onToggleChannelSection: (section: ChannelSectionKey) => void;
	onToggleFavoriteChannel: (channelId: string) => void;
	onToggleReaction: (post: MattermostPost, emojiName: string) => Promise<void>;
	onUnarchiveChannel: (channelId: string) => void;
	onVotePoll: (post: MattermostPost, optionId: string) => Promise<void>;
};
