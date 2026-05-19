export function fileToUploadItem(file: File) {
	return new Promise<{
		clientId: string;
		name: string;
		type: string;
		dataUrl: string;
	}>((resolve, reject) => {
		const reader = new FileReader();
		reader.addEventListener("load", () => {
			resolve({
				clientId: crypto.randomUUID(),
				name: file.name,
				type: file.type || "application/octet-stream",
				dataUrl: String(reader.result ?? ""),
			});
		});
		reader.addEventListener("error", () =>
			reject(reader.error ?? new Error("Could not read file.")),
		);
		reader.readAsDataURL(file);
	});
}
