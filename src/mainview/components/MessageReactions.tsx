import * as Tooltip from "@radix-ui/react-tooltip";
import { memo } from "react";
import type { MattermostReaction, MattermostUser } from "../types";
import { emojiNameToGlyph } from "../utils/emoji";
import { userLabel } from "../utils/format";

export type GroupedReaction = {
	emojiName: string;
	count: number;
	mine: boolean;
	userIds: string[];
};

export function groupReactions(
	reactions: MattermostReaction[],
	currentUserId: string,
) {
	const groups = new Map<string, GroupedReaction>();
	for (const reaction of reactions) {
		const existing = groups.get(reaction.emoji_name);
		if (existing) {
			existing.count += 1;
			if (reaction.user_id === currentUserId) existing.mine = true;
			if (!existing.userIds.includes(reaction.user_id))
				existing.userIds.push(reaction.user_id);
			continue;
		}
		groups.set(reaction.emoji_name, {
			emojiName: reaction.emoji_name,
			count: 1,
			mine: reaction.user_id === currentUserId,
			userIds: [reaction.user_id],
		});
	}
	return [...groups.values()];
}

function formatReactionUsers(names: string[]) {
	if (names.length <= 2) return names.join(" and ");
	return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}

export const ReactionPill = memo(function ReactionPill({
	reaction,
	users,
	onClick,
}: {
	reaction: GroupedReaction;
	users: Record<string, MattermostUser>;
	onClick: () => void;
}) {
	const glyph = emojiNameToGlyph(reaction.emojiName);
	const reactionUsers = reaction.userIds.map((userId) =>
		userLabel(users[userId], userId),
	);
	const tooltipLabel = `${formatReactionUsers(reactionUsers)} reacted with ${glyph}`;

	return (
		<Tooltip.Root>
			<Tooltip.Trigger asChild>
				<button
					aria-label={tooltipLabel}
					className={reaction.mine ? "reaction-pill mine" : "reaction-pill"}
					type="button"
					onClick={onClick}
				>
					<span>{glyph}</span>
					<span>{reaction.count}</span>
				</button>
			</Tooltip.Trigger>
			<Tooltip.Portal>
				<Tooltip.Content
					className="tooltip-content reaction-tooltip"
					side="top"
					sideOffset={6}
				>
					{tooltipLabel}
				</Tooltip.Content>
			</Tooltip.Portal>
		</Tooltip.Root>
	);
});
