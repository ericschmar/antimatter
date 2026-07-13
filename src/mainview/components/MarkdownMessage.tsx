import type { ComponentProps, CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const imageSrcCache = new Map<string, string>();
type ImageLoadInfo =
	| { state: "idle" | "failed" }
	| { state: "loaded"; width: number; height: number };
const imageLoadCache = new Map<string, ImageLoadInfo>();

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
					img: (props: ComponentProps<"img">) => (
						<MarkdownImage {...props} resolveImageSrc={resolveImageSrc} />
					),
				}}
				remarkPlugins={[remarkGfm]}
			>
				{renderedMarkdown}
			</ReactMarkdown>
		</div>
	);
}

export function highlightMentionsInMarkdown(
	markdown: string,
	currentUsername?: string,
) {
	if (!currentUsername) return markdown;
	const escapedUsername = currentUsername.replace(
		/[.*+?^${}()|[\]\\]/g,
		"\\$&",
	);
	const pattern = new RegExp(
		`@(${escapedUsername}|channel|here)(?=\\b|\\s|$)`,
		"gi",
	);
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
	const loadInfo = useImageLoadInfo(resolvedSrc);
	const frameStyle = imageFrameStyle(loadInfo, props.width, props.height);
	if (!src) return null;
	if (resolveImageSrc && !resolvedSrc) {
		return (
			<span className="markdown-image-frame loading">Loading image...</span>
		);
	}
	if (loadInfo.state === "failed") {
		return (
			<a
				className="markdown-image-fallback"
				href={resolvedSrc ?? src}
				rel="noreferrer"
				target="_blank"
			>
				Open image
			</a>
		);
	}
	if (loadInfo.state !== "loaded") {
		return (
			<span className="markdown-image-frame loading" style={frameStyle}>
				Loading image...
			</span>
		);
	}
	return (
		<span className="markdown-image-frame loaded" style={frameStyle}>
			<img {...props} alt={alt ?? ""} loading="lazy" src={resolvedSrc ?? src} />
		</span>
	);
}

export function useResolvedImageSrc(
	src: string | undefined,
	resolveImageSrc?: (src: string) => Promise<string>,
) {
	const [resolvedSrc, setResolvedSrc] = useState<string | null>(() =>
		src ? (imageSrcCache.get(src) ?? null) : null,
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
	return useImageLoadInfo(src).state;
}

export function useImageLoadInfo(src: string | null) {
	const [loadInfo, setLoadInfo] = useState<ImageLoadInfo>(() => {
		if (!src) return { state: "idle" };
		return imageLoadCache.get(src) ?? { state: "idle" };
	});

	useEffect(() => {
		if (!src) {
			setLoadInfo({ state: "idle" });
			return;
		}

		const cachedInfo = imageLoadCache.get(src);
		if (cachedInfo) {
			setLoadInfo(cachedInfo);
			return;
		}

		let cancelled = false;
		setLoadInfo({ state: "idle" });
		const image = new Image();
		image.onload = () => {
			const nextInfo = {
				height: image.naturalHeight || 1,
				state: "loaded" as const,
				width: image.naturalWidth || 1,
			};
			imageLoadCache.set(src, nextInfo);
			if (!cancelled) setLoadInfo(nextInfo);
		};
		image.onerror = () => {
			const nextInfo = { state: "failed" as const };
			imageLoadCache.set(src, nextInfo);
			if (!cancelled) setLoadInfo(nextInfo);
		};
		image.src = src;

		return () => {
			cancelled = true;
			image.onload = null;
			image.onerror = null;
		};
	}, [src]);

	return loadInfo;
}

function imageFrameStyle(
	loadInfo: ImageLoadInfo,
	width?: string | number,
	height?: string | number,
): CSSProperties | undefined {
	const explicitWidth = numericDimension(width);
	const explicitHeight = numericDimension(height);
	const aspectRatio =
		explicitWidth && explicitHeight
			? explicitWidth / explicitHeight
			: loadInfo.state === "loaded"
				? loadInfo.width / loadInfo.height
				: undefined;
	const intrinsicWidth =
		explicitWidth ?? (loadInfo.state === "loaded" ? loadInfo.width : undefined);
	if (!aspectRatio && !intrinsicWidth) return undefined;
	return {
		...(aspectRatio ? { aspectRatio } : {}),
		...(intrinsicWidth ? { width: Math.min(intrinsicWidth, 520) } : {}),
	};
}

function numericDimension(value: string | number | undefined) {
	if (typeof value === "number" && Number.isFinite(value) && value > 0)
		return value;
	if (typeof value !== "string") return undefined;
	const parsed = Number.parseFloat(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
