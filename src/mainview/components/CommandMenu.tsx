import { useEffect, useState } from "react";
import { MattermostApiClient } from "../mattermostApi";
import type { MattermostChannel, MattermostPost, MattermostUser } from "../types";
import { channelLabel, userLabel } from "../utils/format";

export function CommandMenu({
	api,
	channels,
	currentUserId,
	open,
	selectedTeamId,
	users,
	onClose,
	onCreateDm,
	onOpenSettings,
	onSelectChannel,
	onSelectPost,
}: {
	api: MattermostApiClient | null;
	channels: MattermostChannel[];
	currentUserId: string;
	open: boolean;
	selectedTeamId: string | null;
	users: Record<string, MattermostUser>;
	onClose: () => void;
	onCreateDm: (userId: string) => void;
	onOpenSettings: () => void;
	onSelectChannel: (channel: MattermostChannel) => void;
	onSelectPost: (post: MattermostPost) => void;
}) {
	const [query, setQuery] = useState("");
	const [apiChannels, setApiChannels] = useState<MattermostChannel[]>([]);
	const [apiPosts, setApiPosts] = useState<MattermostPost[]>([]);
	const [apiUsers, setApiUsers] = useState<MattermostUser[]>([]);
	const [searching, setSearching] = useState(false);
	const [activeIndex, setActiveIndex] = useState(0);
	const trimmedQuery = query.trim();
	const localResults = channels
		.filter((channel) =>
			channelLabel(channel, users, currentUserId)
				.toLowerCase()
				.includes(trimmedQuery.toLowerCase()),
		)
		.slice(0, 8);
	const localChannelIds = new Set(channels.map((channel) => channel.id));
	const remoteChannels = apiChannels
		.filter((channel) => !localChannelIds.has(channel.id))
		.slice(0, 6);
	const remoteUsers = apiUsers
		.filter((user) => user.id !== currentUserId)
		.slice(0, 6);
	const postResults = apiPosts.slice(0, 8);
	const remoteChannelOffset = localResults.length;
	const postOffset = remoteChannelOffset + remoteChannels.length;
	const userOffset = postOffset + postResults.length;
	const settingsIndex = userOffset + remoteUsers.length;
	const commandItemCount = settingsIndex + 1;

	useEffect(() => {
		if (!open) {
			setQuery("");
			setApiChannels([]);
			setApiPosts([]);
			setApiUsers([]);
			setSearching(false);
			return;
		}
		if (!api || trimmedQuery.length < 2) {
			setApiChannels([]);
			setApiPosts([]);
			setApiUsers([]);
			setSearching(false);
			return;
		}

		let cancelled = false;
		setSearching(true);
		const timer = window.setTimeout(() => {
			void Promise.all([
				selectedTeamId
					? api.searchChannels(selectedTeamId, trimmedQuery).catch(() => [])
					: Promise.resolve([]),
				api.searchPosts(trimmedQuery, selectedTeamId ?? undefined).catch(() => ({
					order: [],
					posts: {} as Record<string, MattermostPost>,
				})),
				api.searchUsers(trimmedQuery, selectedTeamId ?? undefined).catch(() => []),
			]).then(([nextChannels, nextPosts, nextUsers]) => {
				if (cancelled) return;
				setApiChannels(nextChannels);
				setApiPosts(
					nextPosts.order.map((postId) => nextPosts.posts[postId]).filter(Boolean),
				);
				setApiUsers(nextUsers);
				setSearching(false);
			});
		}, 180);

		return () => {
			cancelled = true;
			window.clearTimeout(timer);
		};
	}, [api, open, selectedTeamId, trimmedQuery]);

	useEffect(() => {
		setActiveIndex(0);
	}, [query, apiChannels, apiPosts, apiUsers]);

	if (!open) return null;
	function runActiveCommand() {
		if (activeIndex < remoteChannelOffset) {
			onSelectChannel(localResults[activeIndex]);
			return;
		}
		if (activeIndex < postOffset) {
			onSelectChannel(remoteChannels[activeIndex - remoteChannelOffset]);
			return;
		}
		if (activeIndex < userOffset) {
			onSelectPost(postResults[activeIndex - postOffset]);
			return;
		}
		if (activeIndex < settingsIndex) {
			onCreateDm(remoteUsers[activeIndex - userOffset].id);
			return;
		}
		onOpenSettings();
	}
	return (
		<div className="modal-backdrop" onMouseDown={onClose}>
			<div className="command-panel" role="dialog" onMouseDown={(event) => event.stopPropagation()}>
				<input
					autoFocus
					placeholder="Search channels, people, or messages..."
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Escape") onClose();
						if (event.key === "ArrowDown") {
							event.preventDefault();
							setActiveIndex((current) => (current + 1) % commandItemCount);
						}
						if (event.key === "ArrowUp") {
							event.preventDefault();
							setActiveIndex((current) => (current - 1 + commandItemCount) % commandItemCount);
						}
						if (event.key === "Enter") {
							event.preventDefault();
							runActiveCommand();
						}
					}}
				/>
				<div className="command-results">
					{localResults.length > 0 && <p className="command-section-label">Channels</p>}
					{localResults.map((channel, index) => (
						<CommandChannelButton
							active={activeIndex === index}
							channel={channel}
							currentUserId={currentUserId}
							key={channel.id}
							users={users}
							onActive={() => setActiveIndex(index)}
							onSelect={onSelectChannel}
						/>
					))}
					{remoteChannels.length > 0 && <p className="command-section-label">Public channels</p>}
					{remoteChannels.map((channel, index) => (
						<CommandChannelButton
							active={activeIndex === remoteChannelOffset + index}
							channel={channel}
							currentUserId={currentUserId}
							key={channel.id}
							users={users}
							onActive={() => setActiveIndex(remoteChannelOffset + index)}
							onSelect={onSelectChannel}
						/>
					))}
					{postResults.length > 0 && <p className="command-section-label">Messages</p>}
					{postResults.map((post, index) => (
						<button
							className={activeIndex === postOffset + index ? "active" : undefined}
							key={post.id}
							type="button"
							onMouseEnter={() => setActiveIndex(postOffset + index)}
							onClick={() => onSelectPost(post)}
						>
							<span>msg</span>
							<strong>{users[post.user_id]?.username ?? "Unknown user"}</strong>
							<small>{post.message.replace(/\s+/g, " ").slice(0, 96) || "(empty message)"}</small>
						</button>
					))}
					{remoteUsers.length > 0 && <p className="command-section-label">People</p>}
					{remoteUsers.map((user, index) => (
						<button
							className={activeIndex === userOffset + index ? "active" : undefined}
							key={user.id}
							type="button"
							onMouseEnter={() => setActiveIndex(userOffset + index)}
							onClick={() => onCreateDm(user.id)}
						>
							<span>DM</span>
							<strong>{userLabel(user, currentUserId)}</strong>
							<small>@{user.username}</small>
						</button>
					))}
					{trimmedQuery.length >= 2 && searching && (
						<p className="command-empty">Searching Mattermost...</p>
					)}
					{trimmedQuery.length >= 2 &&
						!searching &&
						localResults.length === 0 &&
						remoteChannels.length === 0 &&
						postResults.length === 0 &&
						remoteUsers.length === 0 && (
							<p className="command-empty">No Mattermost results.</p>
						)}
					<button
						className={activeIndex === settingsIndex ? "active" : undefined}
						type="button"
						onMouseEnter={() => setActiveIndex(settingsIndex)}
						onClick={onOpenSettings}
					>
						<span>⌘</span>
						Settings
					</button>
				</div>
			</div>
		</div>
	);
}

function CommandChannelButton({
	active,
	channel,
	currentUserId,
	users,
	onActive,
	onSelect,
}: {
	active: boolean;
	channel: MattermostChannel;
	currentUserId: string;
	users: Record<string, MattermostUser>;
	onActive: () => void;
	onSelect: (channel: MattermostChannel) => void;
}) {
	const label = channelLabel(channel, users, currentUserId);
	return (
		<button
			className={active ? "active" : undefined}
			type="button"
			onMouseEnter={onActive}
			onClick={() => onSelect(channel)}
		>
			<span>{channel.type === "D" ? "DM" : "#"}</span>
			<strong>{label}</strong>
			{channel.type === "O" && channel.display_name && channel.name !== channel.display_name && (
				<small>{channel.name}</small>
			)}
		</button>
	);
}
