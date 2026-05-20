import * as Tooltip from "@radix-ui/react-tooltip";
import { Resizable, type ResizeCallbackData } from "react-resizable";
import type { RefObject, SyntheticEvent } from "react";
import { useSnapshot } from "valtio";
import { CommandMenu } from "../components/CommandMenu";
import { CreateChannelDialog } from "../components/CreateChannelDialog";
import {
	MessageComposer,
	type MessageComposerHandle,
} from "../components/MessageComposer";
import { MessageTimeline } from "../components/MessageTimeline";
import { Sidebar } from "../components/Sidebar";
import { Titlebar } from "../components/Titlebar";
import { UserPickerDialog } from "../components/UserPickerDialog";
import { MattermostApiClient } from "../mattermostApi";
import type { AppUpdateState } from "../../shared/electrobunRpc";
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
} from "../types";
import { channelLabel, initials, isTeamChannel } from "../utils/format";
import { electrobun } from "./rpc";
import { uiActions, uiStore } from "../state/uiStore";

export function ChatShell({
	api,
	channelEmojis,
	channelMembers,
	channelOrder,
	channels,
	collapsedSections,
	composerRef,
	currentUser,
	favoriteChannelSet,
	maxSidebarWidth,
	minSidebarWidth,
	posts,
	appUpdate,
	resolveImageSrc,
	sections,
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
	onCreateChannel,
	onCreateDm,
	onEditMessage,
	onLoadMoreMessages,
	onMoveChannel,
	onOpenAttachment,
	onOpenSettings,
	onSelectChannel,
	onSelectPost,
	onSelectTeam,
	onSendMessage,
	onSendTyping,
	onSetChannelEmoji,
	onSetSidebarWidth,
	onShowChannelContextMenu,
	onShowMessageContextMenu,
	onSignOut,
	onStartReply,
	onToggleChannelSection,
	onToggleFavoriteChannel,
	onToggleReaction,
	onUnarchiveChannel,
}: ChatShellProps) {
	const ui = useSnapshot(uiStore);
	const editTarget = ui.editTarget as MattermostPost | null;
	const replyTarget = ui.replyTarget as MattermostPost | null;
	const selectedChannelUsers = channelMembers
		.map((member) => users[member.user_id])
		.filter((user): user is MattermostUser => Boolean(user));
	const typingUsers = (
		selectedChannelId ? Object.keys(ui.typingUsers[selectedChannelId] ?? {}) : []
	).map(
		(userId) =>
			users[userId] ?? {
				id: userId,
				username: "Someone",
			},
	);

	function resizeSidebar(_: SyntheticEvent, data: ResizeCallbackData) {
		onSetSidebarWidth(data.size.width);
	}

	return (
		<Tooltip.Provider>
			<div className="window-shell">
				<Titlebar
					onWindowControl={(action) => {
						void electrobun.rpc!.request.windowControl({ action });
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
								teams={teams}
								userImages={userImages}
								userStatuses={userStatuses}
								users={users}
								wsStatus={ui.wsStatus}
								onArchiveChannel={onArchiveChannel}
								onMoveChannel={onMoveChannel}
								onSelectChannel={onSelectChannel}
								onSelectTeam={onSelectTeam}
								onSetChannelEmoji={onSetChannelEmoji}
								onShowChannelContextMenu={onShowChannelContextMenu}
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
						<header className="channel-header">
							<div>
								<p className="eyebrow">Channel</p>
								<h2>
									{selectedChannel
										? channelLabel(selectedChannel, users, currentUser.id)
										: "Select a channel"}
								</h2>
								{selectedChannel?.purpose ? (
									<p>{selectedChannel.purpose}</p>
								) : null}
							</div>
							<div className="channel-header-actions">
								<Tooltip.Root>
									<Tooltip.Trigger asChild>
										<div className="member-stack" aria-label="Channel members">
											{selectedChannelUsers.slice(0, 5).map((user) => (
												<span className="member-avatar" key={user.id}>
													{userImages[user.id] ? (
														<img alt="" src={userImages[user.id]} />
													) : (
														initials(user.nickname || user.username)
													)}
													<span className={`status-dot ${userStatuses[user.id]?.status ?? "offline"}`} />
												</span>
											))}
											{channelMembers.length > 5 ? (
												<span className="member-count">+{channelMembers.length - 5}</span>
											) : null}
										</div>
									</Tooltip.Trigger>
									<Tooltip.Portal>
										<Tooltip.Content
											className="tooltip-content channel-members-tooltip"
											side="bottom"
											sideOffset={6}
										>
											<div className="channel-members-list">
												{selectedChannelUsers.map((user) => (
													<div key={user.id} className="channel-member-item">
														<span className={`member-status ${userStatuses[user.id]?.status ?? "offline"}`} />
														<span className="member-name">
															{user.nickname || user.username}
														</span>
													</div>
												))}
											</div>
										</Tooltip.Content>
									</Tooltip.Portal>
								</Tooltip.Root>
								{selectedChannel && isTeamChannel(selectedChannel) ? (
									<button className="secondary-action" type="button" onClick={() => uiActions.setAddUserOpen(true)}>
										Add user
									</button>
								) : null}
							</div>
						</header>

						{ui.error ? (
							<div className="inline-error">
								<span>{ui.error}</span>
								<button type="button" onClick={() => uiActions.setError(null)}>
									Dismiss
								</button>
							</div>
						) : null}

						{appUpdate.status === "downloading" || appUpdate.updateReady ? (
							<div className="update-banner">
								<span>
									{appUpdate.updateReady
										? appUpdate.version
											? `Antimatter ${appUpdate.version} is ready to install.`
											: "An Antimatter update is ready to install."
										: appUpdate.message ?? "Downloading Antimatter update..."}
								</span>
								{appUpdate.updateReady ? (
									<button type="button" onClick={onApplyAppUpdate}>
										Restart
									</button>
								) : null}
							</div>
						) : null}

						<section className="chat-body">
							<MessageTimeline
								currentUserId={currentUser.id}
								loading={ui.status === "loading"}
								loadingHistory={ui.loadingHistory}
								posts={posts}
								resolveImageSrc={resolveImageSrc}
								typingUsers={typingUsers}
								userColors={userColors}
								userImages={userImages}
								userStatuses={userStatuses}
								users={users}
								onOpenAttachment={onOpenAttachment}
								onShowMessageContextMenu={onShowMessageContextMenu}
								onReply={onStartReply}
								onToggleReaction={onToggleReaction}
								onLoadMore={onLoadMoreMessages}
							/>
							<MessageComposer
								currentUserId={currentUser.id}
								disabled={!selectedChannelId || ui.status === "loading"}
								editTarget={editTarget}
								ref={composerRef}
								replyTarget={replyTarget}
								userColors={userColors}
								users={users}
								onCancelEdit={onCancelEdit}
								onCancelReply={onCancelReply}
								onEdit={onEditMessage}
								onSend={onSendMessage}
								onTyping={onSendTyping}
							/>
						</section>
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
					onCreate={(displayName, name, type) => void onCreateChannel(displayName, name, type)}
				/>
				<UserPickerDialog
					api={api}
					open={ui.createDmOpen}
					selectedTeamId={selectedTeamId}
					title="Create direct message"
					onClose={() => uiActions.setCreateDmOpen(false)}
					onSubmit={(userIds) => void onCreateDm(userIds)}
				/>
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
			</div>
		</Tooltip.Provider>
	);
}

type ChatShellProps = {
	api: MattermostApiClient | null;
	channelEmojis: Record<string, string>;
	channelMembers: MattermostChannelMember[];
	channelOrder: Readonly<Record<string, readonly string[]>>;
	channels: MattermostChannel[];
	collapsedSections: Record<ChannelSectionKey, boolean>;
	composerRef: RefObject<MessageComposerHandle | null>;
	currentUser: MattermostUser;
	favoriteChannelSet: Set<string>;
	maxSidebarWidth: number;
	minSidebarWidth: number;
	posts: MattermostPost[];
	appUpdate: AppUpdateState;
	resolveImageSrc: (src: string) => Promise<string>;
	sections: Record<ChannelSectionKey, MattermostChannel[]>;
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
	onCreateChannel: (displayName: string, name: string, type: "O" | "P") => Promise<void>;
	onCreateDm: (userIds: string[]) => Promise<void>;
	onEditMessage: (post: MattermostPost, message: string) => Promise<void>;
	onLoadMoreMessages: () => Promise<void>;
	onMoveChannel: (section: ChannelSectionKey, channelIds: string[]) => void;
	onOpenAttachment: (file: MattermostFileInfo) => Promise<void>;
	onOpenSettings: (settings: AppSettings) => void;
	onSelectChannel: (channel: MattermostChannel) => Promise<void>;
	onSelectPost: (post: MattermostPost) => Promise<void>;
	onSelectTeam: (team: MattermostTeam) => Promise<void>;
	onSendMessage: (message: string, rootId?: string, files?: File[]) => Promise<void>;
	onSendTyping: (rootId?: string) => Promise<void>;
	onSetChannelEmoji: (channelId: string, emoji: string) => void;
	onSetSidebarWidth: (width: number) => void;
	onShowChannelContextMenu: (channel: MattermostChannel) => void;
	onShowMessageContextMenu: (post: MattermostPost) => void;
	onSignOut: () => void;
	onStartReply: (post: MattermostPost) => void;
	onToggleChannelSection: (section: ChannelSectionKey) => void;
	onToggleFavoriteChannel: (channelId: string) => void;
	onToggleReaction: (post: MattermostPost, emojiName: string) => Promise<void>;
	onUnarchiveChannel: (channelId: string) => void;
};
