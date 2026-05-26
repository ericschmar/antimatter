import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import data from "@emoji-mart/data";
import Picker from "@emoji-mart/react";
import { SmilePlus } from "lucide-react";
import { useState } from "react";
import type { ReactNode, SyntheticEvent } from "react";

type EmojiMartSelection = {
	id?: string;
	native?: string;
	shortcodes?: string;
};

export function EmojiPickerPopover({
	children,
	label = "Choose emoji",
	open,
	onSelectEmoji,
	onOpenChange,
}: {
	children?: ReactNode;
	label?: string;
	open?: boolean;
	onSelectEmoji: (emoji: string, emojiName: string) => void;
	onOpenChange?: (open: boolean) => void;
}) {
	const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
	const pickerOpen = open ?? uncontrolledOpen;
	const setPickerOpen = onOpenChange ?? setUncontrolledOpen;

	return (
		<DropdownMenu.Root open={pickerOpen} onOpenChange={setPickerOpen}>
			<DropdownMenu.Trigger asChild>
				{children ?? (
					<button aria-label={label} className="icon-button" type="button">
						<SmilePlus size={15} />
					</button>
				)}
			</DropdownMenu.Trigger>
			<DropdownMenu.Portal>
				<DropdownMenu.Content
					className="emoji-picker-content"
					sideOffset={6}
					onClick={stopPickerEvent}
					onKeyDown={stopPickerEvent}
					onPointerDown={stopPickerEvent}
				>
					<EmojiPickerPanel
						onSelectEmoji={(emoji, emojiName) => {
							onSelectEmoji(emoji, emojiName);
							setPickerOpen(false);
						}}
					/>
				</DropdownMenu.Content>
			</DropdownMenu.Portal>
		</DropdownMenu.Root>
	);
}

function stopPickerEvent(event: SyntheticEvent) {
	event.stopPropagation();
}

export function EmojiPickerPanel({
	onSelectEmoji,
}: {
	onSelectEmoji: (emoji: string, emojiName: string) => void;
}) {
	return (
		<Picker
			data={data}
			emojiButtonSize={32}
			emojiSize={20}
			maxFrequentRows={2}
			navPosition="bottom"
			perLine={8}
			previewPosition="none"
			searchPosition="sticky"
			set="native"
			theme="dark"
			onEmojiSelect={(emoji: EmojiMartSelection) => {
				onSelectEmoji(emoji.native ?? "", emoji.id ?? emoji.shortcodes ?? "");
			}}
		/>
	);
}
