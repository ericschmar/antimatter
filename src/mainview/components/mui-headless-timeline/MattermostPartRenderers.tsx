import type { ChatPartRendererMap } from "@mui/x-chat/headless";
import { memo, useMemo } from "react";
import { markRender } from "../../utils/perfTrace";
import { MessageAttachments } from "../MessageAttachments";
import { MarkdownRenderer } from "../MessageMarkdown";
import { groupReactions, ReactionPill } from "../MessageReactions";
import { useMuiTimelineContext } from "./MuiTimelineContext";
import { MuiTimelineReplies } from "./MuiTimelineReplies";
import type { MattermostMessagePart } from "./muiChatModels";

export const mattermostPartRenderers: ChatPartRendererMap = {
	text: ({ part }) => <MattermostTextPart part={part} />,
	"data-deleted": ({ part }) => (
		<MattermostDeletedPart
			part={part as Extract<MattermostMessagePart, { type: "data-deleted" }>}
		/>
	),
	"data-poll": ({ part }) => (
		<MattermostPollPart
			part={part as Extract<MattermostMessagePart, { type: "data-poll" }>}
		/>
	),
	"data-attachments": ({ part }) => (
		<MattermostAttachmentsPart
			part={
				part as Extract<MattermostMessagePart, { type: "data-attachments" }>
			}
		/>
	),
	"data-reactions": ({ part }) => (
		<MattermostReactionsPart
			part={part as Extract<MattermostMessagePart, { type: "data-reactions" }>}
		/>
	),
	"data-replies": ({ part }) => (
		<MuiTimelineReplies
			part={part as Extract<MattermostMessagePart, { type: "data-replies" }>}
		/>
	),
} as ChatPartRendererMap;

const MattermostTextPart = memo(function MattermostTextPart({
	part,
}: {
	part: Extract<MattermostMessagePart, { type: "text" }>;
}) {
	markRender("MattermostTextPart");
	const context = useMuiTimelineContext();
	return (
		<MarkdownRenderer
			currentUsername={context.users[context.currentUserId]?.username}
			markdown={part.text}
			resolveImageSrc={context.resolveImageSrc}
			useNewComposer={context.useNewComposer}
		/>
	);
});

const MattermostDeletedPart = memo(function MattermostDeletedPart({
	part: _part,
}: {
	part: Extract<MattermostMessagePart, { type: "data-deleted" }>;
}) {
	return <div className="markdown-message mui-deleted-message">(deleted)</div>;
});

const MattermostPollPart = memo(function MattermostPollPart({
	part,
}: {
	part: Extract<MattermostMessagePart, { type: "data-poll" }>;
}) {
	const context = useMuiTimelineContext();
	const { poll, post } = part.data;
	const selectedOptionId = poll.votes[context.currentUserId];
	const totalVotes = Object.keys(poll.votes).length;
	return (
		<div className="poll-message mui-poll-part">
			<div className="poll-question">{poll.question}</div>
			<div className="poll-options">
				{poll.options.map((option) => {
					const voteCount = Object.values(poll.votes).filter(
						(optionId) => optionId === option.id,
					).length;
					const selected = selectedOptionId === option.id;
					return (
						<button
							className={selected ? "poll-option selected" : "poll-option"}
							key={option.id}
							type="button"
							onClick={() => void context.onVotePoll(post, option.id)}
						>
							<span>{option.text}</span>
							<span
								className="poll-option-votes"
								title={`${voteCount} ${voteCount === 1 ? "vote" : "votes"}`}
							>
								{voteCount} {voteCount === 1 ? "vote" : "votes"}
							</span>
						</button>
					);
				})}
			</div>
			<div className="poll-total-votes">
				{totalVotes} {totalVotes === 1 ? "vote" : "votes"} total
			</div>
		</div>
	);
});

const MattermostAttachmentsPart = memo(function MattermostAttachmentsPart({
	part,
}: {
	part: Extract<MattermostMessagePart, { type: "data-attachments" }>;
}) {
	const context = useMuiTimelineContext();
	return (
		<div className="mui-attachments-part">
			<MessageAttachments
				files={part.data.files}
				resolveImageSrc={context.resolveImageSrc}
				onOpenAttachment={context.onOpenAttachment}
			/>
		</div>
	);
});

const MattermostReactionsPart = memo(function MattermostReactionsPart({
	part,
}: {
	part: Extract<MattermostMessagePart, { type: "data-reactions" }>;
}) {
	const context = useMuiTimelineContext();
	const groupedReactions = useMemo(
		() => groupReactions(part.data.reactions, context.currentUserId),
		[part.data.reactions, context.currentUserId],
	);
	if (groupedReactions.length === 0) return null;
	return (
		<div className="reaction-list mui-reactions-part">
			{groupedReactions.map((reaction) => (
				<ReactionPill
					key={reaction.emojiName}
					reaction={reaction}
					users={context.users}
					onClick={() =>
						void context.onToggleReaction(part.data.post, reaction.emojiName)
					}
				/>
			))}
		</div>
	);
});
