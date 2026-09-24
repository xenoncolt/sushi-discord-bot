export interface Toast {
	id: number;
	kind: "success" | "error" | "info";
	text: string;
}

let next_id = 1;

export const toasts = $state<Toast[]>([]);

export function toast(text: string, kind: Toast["kind"] = "success", ms = 2600): void {
	const id = next_id++;
	// Autosave fires a lot; don't stack identical "Saved" notes.
	const same = toasts.findIndex(t => t.text === text && t.kind === kind);
	if (same >= 0) toasts.splice(same, 1);
	toasts.push({ id, kind, text });
	setTimeout(() => {
		const i = toasts.findIndex(t => t.id === id);
		if (i >= 0) toasts.splice(i, 1);
	}, ms);
}
