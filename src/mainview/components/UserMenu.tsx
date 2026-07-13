import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, LogOut, Wifi, WifiOff } from "lucide-react";
import type { MattermostUser, WebSocketStatus } from "../types";
import { initials } from "../utils/format";

export function UserMenu({
	imageSrc,
	status,
	user,
	wsStatus,
	onSignOut,
}: {
	imageSrc?: string;
	status?: string;
	user: MattermostUser;
	wsStatus: WebSocketStatus;
	onSignOut: () => void;
}) {
	return (
		<DropdownMenu.Root>
			<DropdownMenu.Trigger className="user-trigger">
				<span className="user-trigger-avatar">
					{imageSrc ? (
						<img alt="" src={imageSrc} />
					) : (
						initials(user.nickname || user.username)
					)}
					<span className={`status-dot ${status ?? "offline"}`} />
				</span>
				<ChevronDown size={14} />
			</DropdownMenu.Trigger>
			<DropdownMenu.Portal>
				<DropdownMenu.Content className="dropdown-content" sideOffset={8}>
					<DropdownMenu.Label className="dropdown-label">
						{user.username}
					</DropdownMenu.Label>
					<DropdownMenu.Item className="dropdown-item">
						{wsStatus === "connected" ? (
							<Wifi size={14} />
						) : (
							<WifiOff size={14} />
						)}
						{wsStatus}
					</DropdownMenu.Item>
					<DropdownMenu.Separator className="dropdown-separator" />
					<DropdownMenu.Item
						className="dropdown-item danger"
						onSelect={onSignOut}
					>
						<LogOut size={14} />
						Sign out
					</DropdownMenu.Item>
				</DropdownMenu.Content>
			</DropdownMenu.Portal>
		</DropdownMenu.Root>
	);
}
