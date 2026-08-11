import MDEditor from "@uiw/react-md-editor/nohighlight";
import "@uiw/react-markdown-preview/markdown.css";
import type { ComponentProps } from "react";
import {
	highlightMentionsInMarkdown,
	MarkdownMessage,
	MentionStrong,
	useImageLoadInfo,
	useResolvedImageSrc,
} from "./MarkdownMessage";

export function MarkdownRenderer({
	currentUsername,
	markdown,
	resolveImageSrc,
	useNewComposer,
}: {
	currentUsername?: string;
	markdown: string;
	resolveImageSrc: (src: string) => Promise<string>;
	useNewComposer: boolean;
}) {
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
}

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
	if (!src) return null;
	if (!resolvedSrc) {
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
			<span className="markdown-image-frame loading">Loading image...</span>
		);
	}
	return (
		<span
			className="markdown-image-frame loaded"
			style={{
				aspectRatio: loadInfo.width / loadInfo.height,
				width: Math.min(loadInfo.width, 520),
			}}
		>
			<img {...props} alt={alt ?? ""} loading="lazy" src={resolvedSrc ?? src} />
		</span>
	);
}
