export function showTeamUnreadDot(
	teamUnread: Record<string, boolean>,
	teamId: string,
	selectedTeamId: string | null,
): boolean {
	return Boolean(teamUnread[teamId]) && teamId !== selectedTeamId;
}
