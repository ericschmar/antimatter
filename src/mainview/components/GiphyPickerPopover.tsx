import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Film } from "lucide-react";
import type { ReactNode, SyntheticEvent } from "react";
import { useEffect, useMemo, useState } from "react";

const GIPHY_LIMIT = 24;

export type GiphyImageRendition = {
	height?: string;
	url?: string;
	webp?: string;
	width?: string;
};

export type GiphyGif = {
	id?: string;
	title?: string;
	url?: string;
	images?: Record<string, GiphyImageRendition | undefined>;
};

type GiphyApiResponse = {
	data?: GiphyGif[];
};

export function GiphyPickerPopover({
	apiKey,
	children,
	label = "Insert GIF",
	open,
	onSelectGif,
	onOpenChange,
}: {
	apiKey: string;
	children?: ReactNode;
	label?: string;
	open?: boolean;
	onSelectGif: (gif: GiphyGif) => void;
	onOpenChange?: (open: boolean) => void;
}) {
	const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [gifs, setGifs] = useState<GiphyGif[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const pickerOpen = open ?? uncontrolledOpen;
	const setPickerOpen = onOpenChange ?? setUncontrolledOpen;
	const trimmedQuery = query.trim();

	useEffect(() => {
		if (!pickerOpen) return;
		const controller = new AbortController();
		const timer = window.setTimeout(
			() => {
				setLoading(true);
				setError(null);
				void fetchGifs(apiKey, trimmedQuery, controller.signal)
					.then((nextGifs) => setGifs(nextGifs))
					.catch((err) => {
						if (err instanceof DOMException && err.name === "AbortError")
							return;
						setGifs([]);
						setError("Could not load GIFs.");
					})
					.finally(() => {
						if (!controller.signal.aborted) setLoading(false);
					});
			},
			trimmedQuery ? 250 : 0,
		);

		return () => {
			controller.abort();
			window.clearTimeout(timer);
		};
	}, [apiKey, pickerOpen, trimmedQuery]);

	const statusLabel = useMemo(() => {
		if (loading) return "Loading GIFs...";
		if (error) return error;
		if (gifs.length === 0) return "No GIFs found.";
		return null;
	}, [error, gifs.length, loading]);

	return (
		<DropdownMenu.Root open={pickerOpen} onOpenChange={setPickerOpen}>
			<DropdownMenu.Trigger asChild>
				{children ?? (
					<button aria-label={label} className="icon-button" type="button">
						<Film size={15} />
					</button>
				)}
			</DropdownMenu.Trigger>
			<DropdownMenu.Portal>
				<DropdownMenu.Content
					className="giphy-picker-content"
					sideOffset={6}
					onClick={stopPickerEvent}
					onKeyDown={stopPickerEvent}
					onPointerDown={stopPickerEvent}
				>
					<div className="giphy-searchbox">
						<input
							aria-label="Search GIFs"
							className="giphy-search-input"
							placeholder="Search GIFs"
							type="search"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
						/>
						<div className="giphy-results" role="listbox">
							{gifs.map((gif) => {
								const preview = gifPreview(gif);
								if (!preview) return null;
								return (
									<button
										aria-label={gif.title || "Insert GIF"}
										className="giphy-result"
										key={gif.id ?? preview.url}
										type="button"
										onClick={() => {
											onSelectGif(gif);
											setPickerOpen(false);
										}}
									>
										<img
											alt={gif.title ?? ""}
											loading="lazy"
											src={preview.url}
										/>
									</button>
								);
							})}
							{statusLabel ? (
								<div className="giphy-picker-status" role="status">
									{statusLabel}
								</div>
							) : null}
						</div>
						<div className="giphy-attribution">Powered by GIPHY</div>
					</div>
				</DropdownMenu.Content>
			</DropdownMenu.Portal>
		</DropdownMenu.Root>
	);
}

function stopPickerEvent(event: SyntheticEvent) {
	event.stopPropagation();
}

async function fetchGifs(apiKey: string, query: string, signal: AbortSignal) {
	const endpoint = query ? "search" : "trending";
	const url = new URL(`https://api.giphy.com/v1/gifs/${endpoint}`);
	url.searchParams.set("api_key", apiKey);
	url.searchParams.set("limit", String(GIPHY_LIMIT));
	url.searchParams.set("rating", "g");
	if (query) url.searchParams.set("q", query);

	const response = await fetch(url, { signal });
	if (!response.ok) throw new Error(`Giphy returned ${response.status}.`);
	const body = (await response.json()) as GiphyApiResponse;
	return body.data ?? [];
}

function gifPreview(gif: GiphyGif) {
	const rendition =
		gif.images?.["fixed_width_downsampled"] ??
		gif.images?.["fixed_width"] ??
		gif.images?.["downsized_medium"] ??
		gif.images?.["original"];
	const url = rendition?.webp ?? rendition?.url;
	if (!url) return null;
	return {
		height: numericDimension(rendition?.height) ?? 120,
		url,
		width: numericDimension(rendition?.width) ?? 160,
	};
}

function numericDimension(value: string | undefined) {
	if (!value) return undefined;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
