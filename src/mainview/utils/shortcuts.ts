import type { ApplicationMenuAction } from "../../shared/electrobunRpc";

export type ShortcutAction = ApplicationMenuAction["action"];

type ShortcutEvent = {
	altKey?: boolean;
	ctrlKey?: boolean;
	key: string;
	metaKey?: boolean;
	shiftKey?: boolean;
};

export function readShortcutAction(event: ShortcutEvent): ShortcutAction | null {
	const key = event.key.toLowerCase();
	const primary = Boolean(event.metaKey || event.ctrlKey);
	if (!primary) return null;

	if (!event.altKey && !event.shiftKey && key === "k") return "command-menu";
	if (!event.altKey && !event.shiftKey && event.key === ",") return "settings";

	if (!event.altKey && !event.shiftKey && event.key === "1") {
		return "navigate-favorites";
	}
	if (!event.altKey && !event.shiftKey && event.key === "2") {
		return "navigate-channels";
	}
	if (!event.altKey && !event.shiftKey && event.key === "3") {
		return "navigate-dms";
	}

	if (!event.altKey && !event.shiftKey && isLeftBracket(event.key)) {
		return "navigate-prev-channel";
	}
	if (!event.altKey && !event.shiftKey && isRightBracket(event.key)) {
		return "navigate-next-channel";
	}
	if (!event.altKey && event.shiftKey && isLeftBracket(event.key)) {
		return "navigate-prev-unread";
	}
	if (!event.altKey && event.shiftKey && isRightBracket(event.key)) {
		return "navigate-next-unread";
	}
	if (event.altKey && !event.shiftKey && isLeftBracket(event.key)) {
		return "navigate-prev-mention";
	}
	if (event.altKey && !event.shiftKey && isRightBracket(event.key)) {
		return "navigate-next-mention";
	}

	if (!event.altKey && !event.shiftKey && key === "u") return "attach-file";
	if (!event.altKey && event.shiftKey && key === "u") return "attach-image";
	if (!event.altKey && !event.shiftKey && key === "e") {
		return "open-emoji-picker";
	}

	return null;
}

function isLeftBracket(key: string) {
	return key === "[" || key === "{";
}

function isRightBracket(key: string) {
	return key === "]" || key === "}";
}
