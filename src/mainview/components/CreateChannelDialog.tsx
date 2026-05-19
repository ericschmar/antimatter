import { useState } from "react";
import { slugifyChannelName } from "../utils/channelNames";

export function CreateChannelDialog({
	open,
	onClose,
	onCreate,
}: {
	open: boolean;
	onClose: () => void;
	onCreate: (displayName: string, name: string, type: "O" | "P") => void;
}) {
	const [displayName, setDisplayName] = useState("");
	const [name, setName] = useState("");
	const [type, setType] = useState<"O" | "P">("O");
	if (!open) return null;
	const channelName = name || slugifyChannelName(displayName);
	return (
		<div className="modal-backdrop" onMouseDown={onClose}>
			<form
				className="settings-panel"
				onMouseDown={(event) => event.stopPropagation()}
				onSubmit={(event) => {
					event.preventDefault();
					if (!displayName.trim() || !channelName) return;
					onCreate(displayName.trim(), channelName, type);
					setDisplayName("");
					setName("");
				}}
			>
				<header>
					<h2>Create channel</h2>
					<button type="button" onClick={onClose}>Cancel</button>
				</header>
				<label>
					<span>Display name</span>
					<input autoFocus required value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
				</label>
				<label>
					<span>URL name</span>
					<input placeholder={slugifyChannelName(displayName)} value={name} onChange={(event) => setName(event.target.value)} />
				</label>
				<label>
					<span>Type</span>
					<select value={type} onChange={(event) => setType(event.target.value as "O" | "P")}>
						<option value="O">Public</option>
						<option value="P">Private</option>
					</select>
				</label>
				<button className="primary-action" type="submit">Create</button>
			</form>
		</div>
	);
}
