import { useEffect, useMemo, useState } from "react";
import type { ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const imageSrcCache = new Map<string, string>();
const imageLoadCache = new Map<string, "loaded" | "failed">();

export function MarkdownMessage({
	currentUsername,
	markdown,
	resolveImageSrc,
}: {
	currentUsername?: string;
	markdown: string;
	resolveImageSrc?: (src: string) => Promise<string>;
}) {
	const renderedMarkdown = useMemo(
		() => highlightMentionsInMarkdown(markdown, currentUsername),
		[currentUsername, markdown],
	);
	return (
		<div className="markdown-message">
			<ReactMarkdown
				components={{
					img: (props: ComponentProps<"img">) => <MarkdownImage {...props} resolveImageSrc={resolveImageSrc} />,
				}}
				remarkPlugins={[remarkGfm]}
			>
				{renderedMarkdown}
			</ReactMarkdown>
		</div>
	);
}

function highlightMentionsInMarkdown(markdown: string, currentUsername?: string) {
	if (!currentUsername) return markdown;
	const escapedUsername = currentUsername.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const pattern = new RegExp(`@(${escapedUsername}|channel|here)(?=\\b|\\s|$)`, "gi");
	return markdown.replace(pattern, "**$&**");
}

function MarkdownImage({
	resolveImageSrc,
	src,
	alt,
	...props
}: ComponentProps<"img"> & {
	resolveImageSrc?: (src: string) => Promise<string>;
}) {
	const resolvedSrc = useResolvedImageSrc(src, resolveImageSrc);
	const loadState = useImageLoadState(resolvedSrc);
	if (!src) return null;
	if (resolveImageSrc && !resolvedSrc) {
		return <span className="markdown-image-loading">Loading image...</span>;
	}
	if (loadState === "failed") {
		return (
			<a className="markdown-image-fallback" href={resolvedSrc ?? src} rel="noreferrer" target="_blank">
				Open image
			</a>
		);
	}
	if (loadState !== "loaded") {
		return <span className="markdown-image-loading">Loading image...</span>;
	}
	return <img {...props} alt={alt ?? ""} loading="lazy" src={resolvedSrc ?? src} />;
}

export function useResolvedImageSrc(
	src: string | undefined,
	resolveImageSrc?: (src: string) => Promise<string>,
) {
	const [resolvedSrc, setResolvedSrc] = useState<string | null>(() =>
		src ? imageSrcCache.get(src) ?? null : null,
	);

	useEffect(() => {
		let cancelled = false;
		if (!src || !resolveImageSrc) return;
		const cachedSrc = imageSrcCache.get(src);
		if (cachedSrc) {
			setResolvedSrc(cachedSrc);
			return;
		}

		void resolveImageSrc(src)
			.then((nextSrc) => {
				imageSrcCache.set(src, nextSrc);
				if (!cancelled) setResolvedSrc(nextSrc);
			})
			.catch(() => {
				imageSrcCache.set(src, src);
				if (!cancelled) setResolvedSrc(src);
			});

		return () => {
			cancelled = true;
		};
	}, [resolveImageSrc, src]);

	return resolvedSrc;
}

export function useImageLoadState(src: string | null) {
	const [loadState, setLoadState] = useState<"idle" | "loaded" | "failed">(() => {
		if (!src) return "idle";
		return imageLoadCache.get(src) ?? "idle";
	});

	useEffect(() => {
		if (!src) {
			setLoadState("idle");
			return;
		}

		const cachedState = imageLoadCache.get(src);
		if (cachedState) {
			setLoadState(cachedState);
			return;
		}

		let cancelled = false;
		setLoadState("idle");
		const image = new Image();
		image.onload = () => {
			imageLoadCache.set(src, "loaded");
			if (!cancelled) setLoadState("loaded");
		};
		image.onerror = () => {
			imageLoadCache.set(src, "failed");
			if (!cancelled) setLoadState("failed");
		};
		image.src = src;

		return () => {
			cancelled = true;
			image.onload = null;
			image.onerror = null;
		};
	}, [src]);

	return loadState;
}
