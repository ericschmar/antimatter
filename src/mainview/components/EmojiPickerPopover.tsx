import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import data from "@emoji-mart/data";
import Picker from "@emoji-mart/react";
import { SmilePlus } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

type EmojiMartSelection = {
	id?: string;
	native?: string;
	shortcodes?: string;
};

export function EmojiPickerPopover({
	children,
	label = "Choose emoji",
	onSelectEmoji,
}: {
	children?: ReactNode;
	label?: string;
	onSelectEmoji: (emoji: string, emojiName: string) => void;
}) {
	const [open, setOpen] = useState(false);

	return (
		<DropdownMenu.Root open={open} onOpenChange={setOpen}>
			<DropdownMenu.Trigger asChild>
				{children ?? (
					<button aria-label={label} className="icon-button" type="button">
						<SmilePlus size={15} />
					</button>
				)}
			</DropdownMenu.Trigger>
			<DropdownMenu.Portal>
				<DropdownMenu.Content className="emoji-picker-content" sideOffset={6}>
					<EmojiPickerPanel
						onSelectEmoji={(emoji, emojiName) => {
							onSelectEmoji(emoji, emojiName);
							setOpen(false);
						}}
					/>
				</DropdownMenu.Content>
			</DropdownMenu.Portal>
		</DropdownMenu.Root>
	);
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
