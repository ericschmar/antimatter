export function fontFamilyCssValue(fontFamily: string) {
	if (fontFamily === "system") {
		return '"Geist", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
	}
	return `"${fontFamily.replace(/"/g, '\\"')}", ui-sans-serif, system-ui, sans-serif`;
}
