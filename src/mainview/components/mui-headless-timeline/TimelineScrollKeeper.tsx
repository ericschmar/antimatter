import { useMessageListContext } from "@mui/x-chat/headless";
import { useEffect, useRef } from "react";

/** Height-stable window that ends the post-open settle (design 5d). */
export const TIMELINE_SETTLE_STABLE_MS = 200;
/** Hard bound for the settle window, however often the height changes. */
export const TIMELINE_SETTLE_MAX_MS = 2000;
const SETTLE_POLL_MS = 100;

export type KeeperSettle = {
	channelId: string | null;
	lastChangeAt: number;
	startedAt: number;
};

export function settleElapsed(settle: KeeperSettle, now: number) {
	return {
		stable: now - settle.lastChangeAt >= TIMELINE_SETTLE_STABLE_MS,
		timedOut: now - settle.startedAt >= TIMELINE_SETTLE_MAX_MS,
	};
}

/**
 * Decides whether a content-height change should re-pin the viewport.
 *
 * The library only re-pins to the bottom while streaming; outside streaming a
 * height change that grows the content silently pushes the bottom away. We
 * re-pin when the post-open settle window is active (channel just opened) or
 * when the viewport was at the bottom at its last scroll position.
 *
 * `wasAtBottom` is tracked in the scroller's scroll listener (computed from
 * geometry that is self-consistent at event time), not re-derived inside the
 * ResizeObserver callback: by the time an RO callback runs, the engine's
 * native scroll anchoring may have already adjusted `scrollTop` for the same
 * growth, and engines differ on whether that adjustment's scroll event is
 * delivered before or after the RO callback — so any distance computed from
 * a post-layout `scrollTop` is unreliable in both directions.
 */
export function shouldRePin(input: {
	isAtBottom: boolean;
	lastHeight: number | undefined;
	settle: KeeperSettle | null;
	wasAtBottom: boolean | undefined;
}): boolean {
	if (input.settle) return true;
	if (input.lastHeight === undefined) return input.isAtBottom;
	return (input.wasAtBottom ?? input.isAtBottom) === true;
}

/**
 * Stick-to-bottom controller rendered through `MessageList.Root`'s overlay
 * slot (the only app-reachable spot inside the message-list context). It
 * keeps the viewport pinned to the bottom while the user is parked there —
 * matching the Discord/Slack behavior the headless library only implements
 * while streaming — and owns the "settled open" window after a channel
 * switch: re-pin on every content-height change until the height is stable
 * for `TIMELINE_SETTLE_STABLE_MS` (bounded by `TIMELINE_SETTLE_MAX_MS`), then
 * release control to the user.
 *
 * Renders a zero-size marker element; all DOM measurement lives in effects,
 * so it is inert under server render.
 */
export function TimelineScrollKeeper({
	buffer,
	channelId,
}: {
	buffer: number;
	channelId: string | null;
}) {
	const { isAtBottom, scrollToBottom } = useMessageListContext();
	const anchorRef = useRef<HTMLSpanElement>(null);
	const liveRef = useRef({ buffer, channelId, isAtBottom, scrollToBottom });

	useEffect(() => {
		liveRef.current = { buffer, channelId, isAtBottom, scrollToBottom };
	});

	useEffect(() => {
		const anchor = anchorRef.current;
		const root = anchor?.closest(".mui-message-list-root") ?? null;
		const content = root?.querySelector<HTMLElement>(
			".mui-message-list-content",
		);
		const scroller = root?.querySelector<HTMLElement>(
			".mui-message-list-scroller",
		);
		if (!content || !scroller || typeof ResizeObserver === "undefined") {
			return;
		}
		const tracked: {
			channelId: string | null | undefined;
			lastHeight: number | undefined;
			settle: KeeperSettle | null;
			wasAtBottom: boolean | undefined;
		} = {
			channelId: undefined,
			lastHeight: undefined,
			settle: null,
			wasAtBottom: undefined,
		};

		const handleScroll = () => {
			// Scroll events fire before ResizeObserver callbacks in the same
			// frame, so an anchoring adjustment for a height change arrives
			// while the scroller already reports the NEW height. Those events
			// reflect layout compensation, not user intent, and would poison
			// the at-bottom signal in exactly the case we need it (parked at
			// bottom + content growth) — skip them. Genuine user scrolls
			// happen against a stable, already-observed height.
			if (
				tracked.lastHeight !== undefined &&
				Math.abs(scroller.scrollHeight - tracked.lastHeight) > 1
			) {
				return;
			}
			tracked.wasAtBottom =
				scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <=
				liveRef.current.buffer;
		};
		scroller.addEventListener("scroll", handleScroll, { passive: true });

		const observer = new ResizeObserver(() => {
			const live = liveRef.current;
			const now = performance.now();
			if (tracked.channelId !== live.channelId) {
				tracked.channelId = live.channelId;
				tracked.lastHeight = undefined;
				tracked.settle = {
					channelId: live.channelId,
					lastChangeAt: now,
					startedAt: now,
				};
			}
			const height = content.offsetHeight;
			const previousHeight = tracked.lastHeight;
			if (previousHeight === height) return;
			const rePin = shouldRePin({
				isAtBottom: live.isAtBottom,
				lastHeight: previousHeight,
				settle: tracked.settle,
				wasAtBottom: tracked.wasAtBottom,
			});
			tracked.lastHeight = height;
			if (rePin) {
				live.scrollToBottom({ behavior: "auto" });
				tracked.wasAtBottom = true;
				if (tracked.settle) tracked.settle.lastChangeAt = now;
			}
		});
		observer.observe(content);

		const pollId = setInterval(() => {
			if (!tracked.settle) return;
			const { stable, timedOut } = settleElapsed(
				tracked.settle,
				performance.now(),
			);
			if (stable || timedOut) tracked.settle = null;
		}, SETTLE_POLL_MS);

		return () => {
			observer.disconnect();
			clearInterval(pollId);
			scroller.removeEventListener("scroll", handleScroll);
		};
	}, []);

	return (
		<span
			aria-hidden="true"
			className="mui-timeline-scroll-keeper"
			ref={anchorRef}
		/>
	);
}
