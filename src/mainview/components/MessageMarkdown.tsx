import MDEditor from "@uiw/react-md-editor/nohighlight";
import "@uiw/react-markdown-preview/markdown.css";
import type { ComponentProps, CSSProperties } from "react";
import { memo } from "react";
import { markRender } from "../utils/perfTrace";
import {
	highlightMentionsInMarkdown,
	MarkdownMessage,
	MentionStrong,
	useImageLoadInfo,
	useResolvedImageSrc,
} from "./MarkdownMessage";

export type MarkdownRendererProps = {
	currentUsername?: string;
	markdown: string;
	resolveImageSrc: (src: string) => Promise<string>;
	useNewComposer: boolean;
};

// Markdown parsing is the dominant per-render cost (Phase 0 measured ~1080 fresh
// parses for ~60 unique messages during startup). The timeline rebuilds its
// message list on every avatar/presence/post change, producing fresh `part`
// objects that cascade to this component even when the markdown string is
// identical. Comparing by value here lets React bail out and skip the parse.
export function markdownPropsEqual(
	prev: MarkdownRendererProps,
	next: MarkdownRendererProps,
): boolean {
	return (
		prev.markdown === next.markdown &&
		prev.currentUsername === next.currentUsername &&
		prev.useNewComposer === next.useNewComposer &&
		prev.resolveImageSrc === next.resolveImageSrc
	);
}

export const MarkdownRenderer = memo(function MarkdownRenderer({
	currentUsername,
	markdown,
	resolveImageSrc,
	useNewComposer,
}: MarkdownRendererProps) {
	markRender("MarkdownRenderer");
	if (useNewComposer) {
		return (
			<MDEditor.Markdown
				className="markdown-message markdown-message-new"
				components={{
					strong: (props: ComponentProps<"strong">) => (
						<MentionStrong {...props} />
					),
					img: (props: ComponentProps<"img">) => (
						<TimelineMarkdownImage
							{...props}
							resolveImageSrc={resolveImageSrc}
						/>
					),
				}}
				source={highlightMentionsInMarkdown(markdown, currentUsername)}
			/>
		);
	}
	return (
		<MarkdownMessage
			currentUsername={currentUsername}
			markdown={markdown}
			resolveImageSrc={resolveImageSrc}
		/>
	);
}, markdownPropsEqual);

function TimelineMarkdownImage({
	resolveImageSrc,
	src,
	alt,
	...props
}: ComponentProps<"img"> & {
	resolveImageSrc: (src: string) => Promise<string>;
}) {
	const resolvedSrc = useResolvedImageSrc(src, resolveImageSrc);
	const loadInfo = useImageLoadInfo(resolvedSrc);
	const frameStyle = markdownImageFrameStyle(loadInfo);
	if (!src) return null;
	if (!resolvedSrc) {
		return (
			<span className="markdown-image-frame loading" style={frameStyle}>
				Loading image...
			</span>
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

function markdownImageFrameStyle(
	loadInfo: ReturnType<typeof useImageLoadInfo>,
): CSSProperties {
	if (loadInfo.state !== "loaded") return { height: 240 };
	return {
		aspectRatio: loadInfo.width / loadInfo.height,
		width: Math.min(loadInfo.width, 520),
	};
}
