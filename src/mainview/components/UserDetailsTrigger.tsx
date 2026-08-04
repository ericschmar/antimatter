import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { MessageCircle } from "lucide-react";
import { memo } from "react";
import type { MattermostUser } from "../types";
import { initials, userLabel } from "../utils/format";
import { USER_COLOR_PALETTE } from "../utils/userColors";

export const UserDetailsTrigger = memo(function UserDetailsTrigger({
	currentUserId,
	fallback,
	imageSrc,
	status,
	triggerClassName = "message-author",
	userColor,
	user,
	onSetUserColor,
	onStartDm,
}: {
	currentUserId: string;
	fallback: string;
	imageSrc?: string;
	status?: string;
	triggerClassName?: string;
	userColor?: string;
	user: MattermostUser | undefined;
	onSetUserColor: (userId: string, color: string) => void;
	onStartDm: (userId: string) => void;
}) {
	const label = fallback === currentUserId ? "You" : userLabel(user, fallback);
	const selectedColor = userColor ?? USER_COLOR_PALETTE[0];
	return (
		<DropdownMenu.Root>
			<DropdownMenu.Trigger
				className={triggerClassName}
				style={userColor ? { color: userColor } : undefined}
				type="button"
			>
				<UserStatusDot inline status={status} />
				<span className="message-author-name">{label}</span>
			</DropdownMenu.Trigger>
			<DropdownMenu.Portal>
				<DropdownMenu.Content className="user-popover" sideOffset={6}>
					<div className="user-popover-header">
						<div className="user-avatar">
							{imageSrc ? (
								<img alt="" src={imageSrc} />
							) : (
								initials(user?.nickname || user?.username || fallback)
							)}
							<UserStatusDot status={status} />
						</div>
						<div>
							<p>{label}</p>
							<span>{user?.username ? `@${user.username}` : fallback}</span>
							<span>{status ?? "offline"}</span>
						</div>
					</div>
					{user?.position ? (
						<p className="user-popover-detail">{user.position}</p>
					) : null}
					<DropdownMenu.Separator className="dropdown-separator" />
					<div className="user-color-section">
						<p>Color</p>
						<div className="user-color-grid">
							{USER_COLOR_PALETTE.map((color) => (
								<button
									aria-label={`Use ${color}`}
									aria-pressed={
										color.toLowerCase() === userColor?.toLowerCase()
									}
									className="user-color-swatch"
									key={color}
									style={{ backgroundColor: color }}
									type="button"
									onClick={() => onSetUserColor(fallback, color)}
								/>
							))}
						</div>
						<label className="user-color-custom">
							<span>Custom</span>
							<input
								type="color"
								value={selectedColor}
								onChange={(event) =>
									onSetUserColor(fallback, event.currentTarget.value)
								}
							/>
						</label>
					</div>
					<DropdownMenu.Separator className="dropdown-separator" />
					<DropdownMenu.Item
						className="dropdown-item"
						onSelect={() => onStartDm(fallback)}
					>
						<MessageCircle size={14} />
						Start DM
					</DropdownMenu.Item>
				</DropdownMenu.Content>
			</DropdownMenu.Portal>
		</DropdownMenu.Root>
	);
});

const UserStatusDot = memo(function UserStatusDot({
	inline = false,
	status,
}: {
	inline?: boolean;
	status?: string;
}) {
	return (
		<span
			className={`status-dot ${inline ? "inline" : ""} ${status ?? "offline"}`}
			title={status ?? "offline"}
		/>
	);
});
