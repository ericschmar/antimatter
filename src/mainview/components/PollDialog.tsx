import { useState } from "react";
import type { PollProps } from "../types";
import "./PollDialog.css";

export function PollDialog({
	open,
	onOpenChange,
	onSubmit,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSubmit: (poll: PollProps) => void;
}) {
	const [question, setQuestion] = useState("");
	const [options, setOptions] = useState(["", ""]);
	if (!open) return null;

	const trimmedQuestion = question.trim();
	const trimmedOptions = options.map((option) => option.trim()).filter(Boolean);
	const canSubmit = trimmedQuestion.length > 0 && trimmedOptions.length >= 2;

	function close() {
		onOpenChange(false);
	}

	return (
		<div className="modal-backdrop" onMouseDown={close}>
			<form
				className="settings-panel poll-dialog"
				onMouseDown={(event) => event.stopPropagation()}
				onSubmit={(event) => {
					event.preventDefault();
					if (!canSubmit) return;
					onSubmit({
						question: trimmedQuestion,
						options: trimmedOptions.map((text, index) => ({
							id: `option-${index + 1}`,
							text,
						})),
						votes: {},
					});
					setQuestion("");
					setOptions(["", ""]);
					close();
				}}
			>
				<header>
					<h2>Create poll</h2>
					<button type="button" onClick={close}>
						Cancel
					</button>
				</header>
				<label>
					<span>Question</span>
					<input
						required
						value={question}
						onChange={(event) => setQuestion(event.target.value)}
					/>
				</label>
				<div className="poll-dialog-options">
					<span>Options</span>
					{options.map((option, index) => (
						<input
							aria-label={`Option ${index + 1}`}
							key={index}
							placeholder={`Option ${index + 1}`}
							value={option}
							onChange={(event) =>
								setOptions((current) =>
									current.map((value, i) =>
										i === index ? event.target.value : value,
									),
								)
							}
						/>
					))}
					<button
						className="secondary-action poll-dialog-add-option"
						type="button"
						onClick={() => setOptions((current) => [...current, ""])}
					>
						Add option
					</button>
				</div>
				<button className="primary-action" disabled={!canSubmit} type="submit">
					Create poll
				</button>
			</form>
		</div>
	);
}
