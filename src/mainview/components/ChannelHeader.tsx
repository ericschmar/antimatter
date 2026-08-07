import * as Tooltip from "@radix-ui/react-tooltip";
import { memo, useMemo } from "react";
import type {
	AppSettings,
	MattermostChannel,
	MattermostChannelMember,
	MattermostUser,
	MattermostUserStatus,
} from "../types";
import { directChannelOtherUserId, initials, userLabel } from "../utils/format";
import { CallButton } from "./CallButton";

type ChannelHeaderProps = {
	channel: MattermostChannel | undefined;
	channelMembers: MattermostChannelMember[];
	currentUserId: string;
	settings: AppSettings;
	userImages: Record<string, string>;
	userStatuses: Record<string, MattermostUserStatus>;
	users: Record<string, MattermostUser>;
	onOpenUserPicker: () => void;
};

export const ChannelHeader = memo(function ChannelHeader({
	channel,
	channelMembers,
	currentUserId,
	settings,
	userImages,
	userStatuses,
	users,
	onOpenUserPicker,
}: ChannelHeaderProps) {
	const channelUsers = useMemo(
		() =>
			channelMembers
				.map((member) => users[member.user_id])
				.filter((user): user is MattermostUser => Boolean(user)),
		[channelMembers, users],
	);
	const channelHeader = channel?.header?.trim();
	const channelPurpose = channel?.purpose?.trim();
	const channelDescription = channelHeader || channelPurpose;
	const directUserId =
		channel && channel.type === "D"
			? directChannelOtherUserId(channel, currentUserId)
			: null;
	const directUser = directUserId ? users[directUserId] : undefined;
	const directUsername = directUser
		? userLabel(directUser, directUserId ?? directUser.id)
		: (directUserId ?? "Unknown user");
	const callTargetUserId =
		directUserId && (directUserId !== currentUserId || settings.devLoopback)
			? directUserId
			: null;

	return (
		<header className="channel-header">
			<div className="channel-header-copy">
				<p className="eyebrow">Channel</p>
				<div className="channel-header-title-row">
					<h2>
						{channel
							? channel.display_name || channel.name
							: "Select a channel"}
					</h2>
					{channelDescription ? (
						<div className="channel-header-topic">{channelDescription}</div>
					) : null}
				</div>
			</div>
			<div className="channel-header-actions">
				{channel && channelUsers.length > 0 ? (
					<Tooltip.Root>
						<Tooltip.Trigger asChild>
							<div className="member-stack" title="Channel members">
								{channelUsers.slice(0, 5).map((user) => (
									<span className="member-avatar" key={user.id}>
										{userImages[user.id] ? (
											<img alt="" src={userImages[user.id]} />
										) : (
											initials(userLabel(user, user.id))
										)}
										<span
											className={`status-dot ${userStatuses[user.id]?.status ?? "offline"}`}
										/>
									</span>
								))}
								<span className="member-count">{channelUsers.length}</span>
							</div>
						</Tooltip.Trigger>
						<Tooltip.Portal>
							<Tooltip.Content
								className="tooltip-content channel-members-tooltip"
								side="bottom"
								sideOffset={8}
							>
								<div className="channel-members-list">
									{channelUsers.map((user) => (
										<div key={user.id} className="channel-member-item">
											<span
												className={`member-status ${userStatuses[user.id]?.status ?? "offline"}`}
											/>
											<span className="member-name">
												{userLabel(user, user.id)}
											</span>
										</div>
									))}
								</div>
							</Tooltip.Content>
						</Tooltip.Portal>
					</Tooltip.Root>
				) : null}
				{callTargetUserId ? (
					<>
						<CallButton
							userId={callTargetUserId}
							username={directUsername}
							variant="audio"
						/>
						<CallButton
							userId={callTargetUserId}
							username={directUsername}
							variant="video"
						/>
					</>
				) : null}
				<button
					className="secondary-action"
					type="button"
					onClick={onOpenUserPicker}
				>
					Add user
				</button>
			</div>
		</header>
	);
});
