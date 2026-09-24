import {
	MSG_LIMITS,
	type ButtonKind,
	type MessageDoc,
	type MsgButton,
	type MsgEmbed,
	type MsgMedia,
	type MsgNode,
	type MsgRow,
	type MsgSelect,
	type NodeType
} from "./api";

// The builder's half of messages/schema.ts: the same shapes, made here so a
// new block appears the instant it is asked for rather than after a round
// trip, plus the checks that tell somebody a piece won't be posted while there
// is still time to fix it.
//
// The bot re-checks everything it is sent — nothing here is trusted over
// there — but the two files describe the same document and should be changed
// together.

let counter = 0;

export function uid(): string {
	return `${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function newMedia(): MsgMedia {
	return { id: uid(), url: "", alt: "", spoiler: false };
}

export function newButton(kind: ButtonKind = "link"): MsgButton {
	return {
		id: uid(),
		kind,
		label: "",
		emoji: "",
		style: "secondary",
		disabled: false,
		url: "",
		channel_id: null,
		role_mode: "toggle",
		role_ids: [],
		remove_ids: [],
		reply_text: "",
		reply_public: false,
		after: { mode: "nothing", label: "", style: "keep", disable: false }
	};
}

export function newSelect(): MsgSelect {
	return { id: uid(), kind: "role", placeholder: "Pick your roles", min: 0, max: 1, disabled: false, options: [] };
}

export function newOption() {
	return { id: uid(), label: "", description: "", emoji: "", role_id: null };
}

export function newRow(type: MsgRow["type"] = "buttons"): MsgRow {
	return { id: uid(), type, buttons: type === "buttons" ? [newButton()] : [], select: newSelect() };
}

export function newField() {
	return { id: uid(), name: "Field name", value: "Field value", inline: false };
}

export function newEmbed(): MsgEmbed {
	return {
		id: uid(),
		color: "#5865f2",
		author: { name: "", url: "", icon_url: "" },
		title: "New embed",
		url: "",
		description: "Say something here.",
		fields: [],
		image: "",
		thumbnail: "",
		footer: { text: "", icon_url: "" },
		timestamp: "none",
		timestamp_at: ""
	};
}

export function newNode(type: NodeType): MsgNode {
	return {
		id: uid(),
		type,
		text: type === "text" || type === "section" ? "New paragraph" : "",
		accessory: "thumbnail",
		thumbnail: newMedia(),
		button: newButton(),
		items: type === "gallery" ? [newMedia()] : [],
		divider: true,
		spacing: "small",
		row: newRow(),
		file: newMedia(),
		accent: "#5865f2",
		spoiler: false,
		children: type === "container" ? [newNode("text")] : []
	};
}

// A copy of a block needs its own keys throughout, or the original and the
// copy would share a row in every list that tracks them by id.
export function reKey(n: MsgNode): MsgNode {
	const copy: MsgNode = JSON.parse(JSON.stringify(n)) as MsgNode;
	copy.id = uid();
	copy.thumbnail.id = uid();
	copy.button.id = uid();
	copy.file.id = uid();
	copy.items = copy.items.map(m => ({ ...m, id: uid() }));
	copy.row = {
		...copy.row,
		id: uid(),
		buttons: copy.row.buttons.map(b => ({ ...b, id: uid() })),
		select: { ...copy.row.select, id: uid(), options: copy.row.select.options.map(o => ({ ...o, id: uid() })) }
	};
	copy.children = copy.children.map(reKey);
	return copy;
}

export function emptyDoc(): MessageDoc {
	return {
		mode: "v2",
		content: "",
		embeds: [],
		rows: [],
		attachments: [],
		nodes: [newNode("container")],
		tts: false,
		silent: false,
		suppress_embeds: false,
		mentions: { everyone: false, roles: false, users: true }
	};
}


// ---- counting -------------------------------------------------------------
// Mirrors the same names in messages/schema.ts.

export function countRow(r: MsgRow): number {
	return 1 + (r.type === "buttons" ? r.buttons.length : 1);
}

export function countNode(n: MsgNode): number {
	switch (n.type) {
		case "section":
			return 3;
		case "row":
			return countRow(n.row);
		case "container":
			return 1 + n.children.reduce((sum, c) => sum + countNode(c), 0);
		default:
			return 1;
	}
}

export function countNodes(nodes: MsgNode[]): number {
	return nodes.reduce((sum, n) => sum + countNode(n), 0);
}

export function countV2Text(nodes: MsgNode[]): number {
	let total = 0;
	for (const n of nodes) {
		if (n.type === "text" || n.type === "section") total += n.text.length;
		if (n.type === "container") total += countV2Text(n.children);
	}
	return total;
}

export function countEmbedText(embeds: MsgEmbed[]): number {
	let total = 0;
	for (const e of embeds) {
		total += e.title.length + e.description.length + e.footer.text.length + e.author.name.length;
		for (const f of e.fields) total += f.name.length + f.value.length;
	}
	return total;
}

export function countFiles(doc: MessageDoc): number {
	if (doc.mode === "classic") return doc.attachments.filter(a => a.url.trim()).length;
	let total = 0;
	const walk = (nodes: MsgNode[]) => {
		for (const n of nodes) {
			if (n.type === "file" && n.file.url.trim()) total++;
			if (n.type === "container") walk(n.children);
		}
	};
	walk(doc.nodes);
	return total;
}


// ---- what won't be posted --------------------------------------------------
// Mirrors the "dropped" reasons in messages/build.ts, so nobody has to press
// Send to find out that a button is going to be left behind.

const CUSTOM_EMOJI = /^<a?:\w{2,32}:\d{15,21}>$/u;
const EMOJI_PARTS = /^[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\u200d\ufe0f\u20e3\d#*]{1,20}$/u;
const EMOJI_CORE = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u;

export function badEmoji(raw: string): boolean {
	const e = raw.trim();
	if (!e) return false;
	return !CUSTOM_EMOJI.test(e) && !(EMOJI_PARTS.test(e) && EMOJI_CORE.test(e));
}

export function isHttps(url: string): boolean {
	return /^https:\/\/\S+$/.test(url.trim());
}

export function isLink(url: string): boolean {
	return /^https?:\/\/\S+$/.test(url.trim());
}

export function buttonProblem(b: MsgButton): string {
	if (!b.label.trim() && (badEmoji(b.emoji) || !b.emoji.trim())) return "Needs a label or an emoji";
	if (b.kind === "link" && !isLink(b.url)) return "Needs a full https:// link";
	if (b.kind === "channel" && !b.channel_id) return "Pick a channel";
	if (b.kind === "role" && !b.role_ids.length && !b.remove_ids.length) return "Pick at least one role";
	if (b.kind === "reply" && !b.reply_text.trim()) return "Needs something to say back";
	return "";
}

// Not a reason to leave the button out, just something that won't do what it
// looks like it will.
export function buttonWarning(b: MsgButton): string {
	if (buttonProblem(b)) return "";
	if (b.after.mode === "everyone" && !b.after.label && b.after.style === "keep" && !b.after.disable) {
		return "Set to change after a press, but nothing about it changes";
	}
	if (b.kind === "role" && b.role_mode === "toggle" && b.remove_ids.length) {
		return "“Also take away” is ignored when a press is toggling the roles back off";
	}
	return "";
}

export function selectProblem(s: MsgSelect): string {
	const usable = s.options.filter(o => o.label.trim() && o.role_id);
	if (!usable.length) return "Needs at least one option with a label and a role";
	if (s.min > usable.length) return "Asks for more picks than it offers";
	return "";
}

export function rowProblem(r: MsgRow): string {
	if (r.type === "select") return selectProblem(r.select);
	return r.buttons.some(b => !buttonProblem(b)) ? "" : "Every button in this row is unfinished";
}

export function nodeProblem(n: MsgNode): string {
	switch (n.type) {
		case "text":
			return n.text.trim() ? "" : "Empty — nothing will be posted";
		case "section":
			if (!n.text.trim()) return "Empty — nothing will be posted";
			if (n.accessory === "button") {
				const problem = buttonProblem(n.button);
				return problem ? `${problem} — the text would go out on its own` : "";
			}
			return isHttps(n.thumbnail.url) ? "" : "Needs an https:// image — the text would go out on its own";
		case "gallery":
			return n.items.some(i => isHttps(i.url)) ? "" : "Needs at least one https:// image";
		case "file":
			return isHttps(n.file.url) ? "" : "Needs an https:// link to the file to upload";
		case "row":
			return rowProblem(n.row);
		default:
			return "";
	}
}

export function embedProblem(e: MsgEmbed): string {
	const filled = e.title.trim() || e.description.trim() || e.author.name.trim() || e.footer.text.trim()
		|| isHttps(e.image) || isHttps(e.thumbnail) || e.fields.some(f => f.name.trim() && f.value.trim());
	if (!filled) return "Empty — Discord won't accept it";
	if (e.url.trim() && !e.title.trim()) return "A title link needs a title to sit on";
	return "";
}

// The reasons a Send would be refused outright, rather than the pieces it
// would quietly leave behind.
export function docProblems(doc: MessageDoc): string[] {
	const out: string[] = [];

	if (doc.mode === "v2") {
		const total = countNodes(doc.nodes);
		if (total > MSG_LIMITS.v2_total) out.push(`${total} components — Discord allows ${MSG_LIMITS.v2_total} in one message.`);
		if (doc.nodes.length > MSG_LIMITS.v2_top) out.push(`${doc.nodes.length} blocks at the top level — only ${MSG_LIMITS.v2_top} fit. Put some inside a container.`);
		const text = countV2Text(doc.nodes);
		if (text > MSG_LIMITS.v2_text) out.push(`${text.toLocaleString()} characters of text — the limit is ${MSG_LIMITS.v2_text.toLocaleString()}.`);
		if (!doc.nodes.some(n => !nodeProblem(n) || n.type === "container" || n.type === "separator")) {
			out.push("There's nothing finished in this message yet.");
		}
	} else {
		const text = countEmbedText(doc.embeds);
		if (text > MSG_LIMITS.embed_total) out.push(`${text.toLocaleString()} characters across the embeds — the limit is ${MSG_LIMITS.embed_total.toLocaleString()}.`);
		if (doc.rows.length > MSG_LIMITS.rows) out.push(`${doc.rows.length} component rows — only ${MSG_LIMITS.rows} fit under a message.`);
		const empty = !doc.content.trim()
			&& !doc.embeds.some(e => !embedProblem(e))
			&& !doc.rows.some(r => !rowProblem(r))
			&& !doc.attachments.some(a => isHttps(a.url));
		if (empty) out.push("There's nothing in this message yet.");
	}

	return out;
}
