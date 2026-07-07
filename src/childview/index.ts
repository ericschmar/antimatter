import Electrobun, { Electroview } from "electrobun/view";
import type { WindowControlAction } from "../shared/electrobunRpc";
import type { AppSettingsPayload, SettingsWindowRPC } from "../shared/electrobunRpc";

const rpc = Electroview.defineRPC<SettingsWindowRPC>({
	maxRequestTime: 30000,
	handlers: {
		requests: {},
		messages: {
			setSettings: ({ settings }) => {
				renderSettings(settings);
			},
		},
	},
});

const electrobun = new Electrobun.Electroview({ rpc });

const fontFamilyInput = document.getElementById("font-family") as HTMLSelectElement;
const fontSizeInput = document.getElementById("font-size") as HTMLInputElement;
const themeInput = document.getElementById("theme") as HTMLSelectElement;
const showOwnMessageIndicatorsInput = document.getElementById("show-own-message-indicators") as HTMLInputElement;
const ownMessageIndicatorColorInput = document.getElementById("own-message-indicator-color") as HTMLInputElement;
const notificationPreferenceInput = document.getElementById("notification-preference") as HTMLSelectElement;
const notificationSoundsInput = document.getElementById("notification-sounds") as HTMLInputElement;
const showProfilePicturesInput = document.getElementById("show-profile-pictures") as HTMLInputElement;
const useNewComposerInput = document.getElementById("use-new-composer") as HTMLInputElement;
const closeButton = document.getElementById("close-settings") as HTMLButtonElement;
const windowControlButtons = document.querySelectorAll<HTMLButtonElement>("[data-window-action]");

void electrobun.rpc!.request.getSettings({}).then(renderSettings);
void electrobun.rpc!.request.getInstalledFonts({}).then(renderFonts).catch(() => {
	renderFonts([]);
});

for (const element of [
	fontFamilyInput,
	fontSizeInput,
	themeInput,
	showOwnMessageIndicatorsInput,
	ownMessageIndicatorColorInput,
	notificationPreferenceInput,
	notificationSoundsInput,
	showProfilePicturesInput,
	useNewComposerInput,
]) {
	element.addEventListener("input", updateSettings);
	element.addEventListener("change", updateSettings);
}

closeButton.addEventListener("click", () => {
	void electrobun.rpc!.request.closeSettingsWindow({});
});

for (const button of Array.from(windowControlButtons)) {
	button.addEventListener("click", () => {
		const action = button.dataset["windowAction"] as WindowControlAction | undefined;
		if (!action) return;
		void electrobun.rpc!.request.settingsWindowControl({ action });
	});
}

function renderFonts(fonts: string[]) {
	const selectedFont = fontFamilyInput.value || "system";
	fontFamilyInput.replaceChildren(new Option("System", "system"));
	for (const font of fonts) {
		fontFamilyInput.add(new Option(font, font));
	}
	fontFamilyInput.value = Array.from(fontFamilyInput.options).some((option) => option.value === selectedFont)
		? selectedFont
		: "system";
}

function renderSettings(settings: AppSettingsPayload) {
	if (!Array.from(fontFamilyInput.options).some((option) => option.value === settings.fontFamily)) {
		fontFamilyInput.add(new Option(settings.fontFamily, settings.fontFamily));
	}
	fontFamilyInput.value = settings.fontFamily;
	fontSizeInput.value = String(settings.fontSize);
	themeInput.value = settings.theme;
	document.documentElement.dataset["theme"] = settings.theme;
	showOwnMessageIndicatorsInput.checked = settings.showOwnMessageIndicators;
	ownMessageIndicatorColorInput.value = settings.ownMessageIndicatorColor;
	notificationPreferenceInput.value = settings.notificationPreference;
	notificationSoundsInput.checked = settings.notificationSounds;
	showProfilePicturesInput.checked = settings.showProfilePictures;
	useNewComposerInput.checked = settings.useNewComposer;
}

function readSettings(): AppSettingsPayload {
	return {
		fontFamily: fontFamilyInput.value || "system",
		fontSize: clamp(Number(fontSizeInput.value), 12, 18),
		theme: readOption(themeInput.value, ["default", "light", "high-contrast", "warm"], "default"),
		showOwnMessageIndicators: showOwnMessageIndicatorsInput.checked,
		ownMessageIndicatorColor: normalizeColorInput(ownMessageIndicatorColorInput.value, "#46a758"),
		notificationSounds: notificationSoundsInput.checked,
		notificationPreference: readOption(
			notificationPreferenceInput.value,
			["all", "mentions", "none"],
			"all",
		),
		showProfilePictures: showProfilePicturesInput.checked,
		useNewComposer: useNewComposerInput.checked,
	};
}

function updateSettings() {
	const settings = readSettings();
	fontSizeInput.value = String(settings.fontSize);
	document.documentElement.dataset["theme"] = settings.theme;
	void electrobun.rpc!.request.updateSettings({ settings });
}

function readOption<const T extends string>(
	value: string,
	options: readonly T[],
	fallback: T,
) {
	return options.includes(value as T) ? (value as T) : fallback;
}

function clamp(value: number, min: number, max: number) {
	if (!Number.isFinite(value)) return min;
	return Math.min(max, Math.max(min, value));
}

function normalizeColorInput(value: string, fallback: string) {
	return /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
}
