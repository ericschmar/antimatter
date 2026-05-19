import { useEffect, useState } from "react";
import { MattermostApiClient } from "../mattermostApi";
import type { MattermostUser } from "../types";
import { initials, userLabel } from "../utils/format";

export function UserPickerDialog({
	api,
	open,
	selectedTeamId,
	title,
	onClose,
	onSubmit,
}: {
	api: MattermostApiClient | null;
	open: boolean;
	selectedTeamId: string | null;
	title: string;
	onClose: () => void;
	onSubmit: (userIds: string[]) => void;
}) {
	const [query, setQuery] = useState("");
	const [users, setUsers] = useState<MattermostUser[]>([]);
	const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);

	useEffect(() => {
		if (!open || !api || query.trim().length < 2) {
			setUsers([]);
			return;
		}
		let cancelled = false;
		void api.searchUsers(query, selectedTeamId ?? undefined)
			.then((nextUsers) => {
				if (!cancelled) setUsers(nextUsers.slice(0, 12));
			})
			.catch(() => {
				if (!cancelled) setUsers([]);
			});
		return () => {
			cancelled = true;
		};
	}, [api, open, query, selectedTeamId]);

	if (!open) return null;
	return (
		<div className="modal-backdrop" onMouseDown={onClose}>
			<div className="settings-panel" role="dialog" onMouseDown={(event) => event.stopPropagation()}>
				<header>
					<h2>{title}</h2>
					<button type="button" onClick={onClose}>Cancel</button>
				</header>
				<input
					autoFocus
					placeholder="Search users..."
					value={query}
					onChange={(event) => setQuery(event.target.value)}
				/>
				<div className="user-picker-list">
					{users.map((user) => {
						const selected = selectedUserIds.includes(user.id);
						return (
							<button
								className={selected ? "selected" : ""}
								key={user.id}
								type="button"
								onClick={() =>
									setSelectedUserIds((current) =>
										selected ? current.filter((id) => id !== user.id) : [...current, user.id],
									)
								}
							>
								<span>{initials(user.nickname || user.username)}</span>
								{userLabel(user, user.id)}
							</button>
						);
					})}
				</div>
				<button
					className="primary-action"
					disabled={selectedUserIds.length === 0}
					type="button"
					onClick={() => {
						onSubmit(selectedUserIds);
						setQuery("");
						setUsers([]);
						setSelectedUserIds([]);
					}}
				>
					Apply
				</button>
			</div>
		</div>
	);
}
