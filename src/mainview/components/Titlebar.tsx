import { Minus, Search, Square, X } from "lucide-react";
import type { WindowControlAction } from "../../shared/electrobunRpc";
import "./Titlebar.css";

export function Titlebar({
	onOpenSearch,
	onWindowControl,
}: {
	onOpenSearch?: () => void;
	onWindowControl: (action: WindowControlAction) => void;
}) {
	return (
		<header className="titlebar electrobun-webkit-app-region-drag">
			<div className="window-controls electrobun-webkit-app-region-no-drag">
				<button
					aria-label="Close window"
					className="window-control close"
					type="button"
					onClick={() => onWindowControl("close")}
				>
					<X size={10} strokeWidth={3} />
				</button>
				<button
					aria-label="Minimize window"
					className="window-control minimize"
					type="button"
					onClick={() => onWindowControl("minimize")}
				>
					<Minus size={10} strokeWidth={3} />
				</button>
				<button
					aria-label="Maximize window"
					className="window-control maximize"
					type="button"
					onClick={() => onWindowControl("maximize")}
				>
					<Square size={8} strokeWidth={3} />
				</button>
			</div>
			<div className="titlebar-title">Antimatter</div>
			{onOpenSearch ? (
				<button
					aria-label="Open search"
					className="titlebar-search-badge electrobun-webkit-app-region-no-drag"
					type="button"
					onClick={onOpenSearch}
				>
					<Search size={13} />
					<span>Search</span>
					<kbd>⌘K</kbd>
				</button>
			) : null}
		</header>
	);
}
