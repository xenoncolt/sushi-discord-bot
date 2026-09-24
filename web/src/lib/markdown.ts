// Discord's flavour of markdown, rendered for the previews.
//
// The point of a preview is to be trusted, so this covers what people
// actually type — headings, subtext, quotes, lists, code, spoilers, links,
// mentions, timestamps and custom emoji — rather than the handful the first
// version of the welcome preview needed. Anything it doesn't know is left as
// typed, which is also what Discord does.
//
// Everything is escaped on the way in and only this file's own tags come out,
// so a message body can never inject markup into the dashboard.

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

function esc(s: string): string {
	return s.replace(/[&<>"]/g, c => ESCAPES[c]);
}

// Names to show for the ids in a message: a bare id for a user, "&id" for a
// role, "#id" for a channel. Anything missing falls back to a generic word,
// the same way Discord shows an unknown mention.
export type Mentions = Record<string, string>;

const TIME_STYLES = ["t", "T", "d", "D", "f", "F", "R"] as const;

function timestamp(seconds: number, style: string): string {
	const date = new Date(seconds * 1000);
	if (Number.isNaN(date.getTime())) return "invalid date";

	if (style === "R") {
		const diff = date.getTime() - Date.now();
		const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
		const units: [Intl.RelativeTimeFormatUnit, number][] = [
			["year", 31536000000],
			["month", 2592000000],
			["day", 86400000],
			["hour", 3600000],
			["minute", 60000],
			["second", 1000]
		];
		for (const [unit, ms] of units) {
			if (Math.abs(diff) >= ms || unit === "second") return rtf.format(Math.round(diff / ms), unit);
		}
	}

	const date_only: Intl.DateTimeFormatOptions = { dateStyle: style === "D" ? "long" : "short" };
	const time_only: Intl.DateTimeFormatOptions = { timeStyle: style === "T" ? "medium" : "short" };
	switch (style) {
		case "t":
		case "T":
			return date.toLocaleTimeString("en-GB", time_only);
		case "d":
		case "D":
			return date.toLocaleDateString("en-GB", date_only);
		default:
			return date.toLocaleString("en-GB", { ...date_only, ...time_only });
	}
}

// Inline code and code blocks are lifted out before anything else runs, so
// **stars** inside them stay stars. They go back in at the very end.
class Vault {
	private items: string[] = [];

	keep(html: string): string {
		this.items.push(html);
		return `\u0000${this.items.length - 1}\u0000`;
	}

	restore(html: string): string {
		return html.replace(/\u0000(\d+)\u0000/g, (_, i) => this.items[Number(i)] ?? "");
	}
}

function inline(src: string, mentions: Mentions, vault: Vault): string {
	let out = src;

	// Code first: nothing inside a span of code is markdown.
	out = out.replace(/``?`?([^`]+?)``?`?/g, (whole, code: string) =>
		whole.startsWith("`") ? vault.keep(`<code class="md-code">${code}</code>`) : whole
	);

	// A custom emoji is a picture, and a plain one is already a character.
	out = out.replace(/&lt;(a)?:(\w{2,32}):(\d{15,21})&gt;/g, (_, animated: string, name: string, id: string) =>
		vault.keep(`<img class="md-emoji" src="https://cdn.discordapp.com/emojis/${id}.${animated ? "gif" : "webp"}?size=44" alt=":${name}:" title=":${name}:" />`)
	);

	out = out.replace(/&lt;t:(-?\d{1,15})(?::([a-zA-Z]))?&gt;/g, (_, unix: string, style: string) =>
		vault.keep(`<span class="md-time">${esc(timestamp(Number(unix), TIME_STYLES.includes(style as never) ? style : "f"))}</span>`)
	);

	// Mentions. The unknown-name fallbacks match what Discord shows when it
	// can't resolve one either.
	// The id pattern is looser than a real snowflake on purpose: a preview of
	// an unsent message stands in a placeholder like <@me> for whoever will
	// receive it, and that should light up as a mention too.
	out = out
		.replace(/&lt;@&amp;(\w{1,25})&gt;/g, (_, id: string) => vault.keep(`<span class="md-mention">@${esc(mentions[`&${id}`] ?? "unknown-role")}</span>`))
		.replace(/&lt;@!?(\w{1,25})&gt;/g, (_, id: string) => vault.keep(`<span class="md-mention">@${esc(mentions[id] ?? "unknown-user")}</span>`))
		.replace(/&lt;#(\w{1,25})&gt;/g, (_, id: string) => vault.keep(`<span class="md-mention">#${esc(mentions[`#${id}`] ?? "unknown-channel")}</span>`))
		.replace(/@(everyone|here)\b/g, (_, which: string) => vault.keep(`<span class="md-mention">@${which}</span>`));

	// [label](url), then anything left that is plainly a link.
	out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label: string, href: string) =>
		vault.keep(`<a class="md-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`)
	);
	out = out.replace(/(^|[\s(])(https?:\/\/[^\s<]+)/g, (_, before: string, href: string) =>
		`${before}${vault.keep(`<a class="md-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(href)}</a>`)}`
	);

	// Doubles before singles, or **bold** would be read as two italics.
	out = out
		.replace(/\|\|([\s\S]+?)\|\|/g, '<span class="md-spoiler">$1</span>')
		.replace(/\*\*\*([\s\S]+?)\*\*\*/g, "<strong><em>$1</em></strong>")
		.replace(/\*\*([\s\S]+?)\*\*/g, "<strong>$1</strong>")
		.replace(/__([\s\S]+?)__/g, "<u>$1</u>")
		.replace(/~~([\s\S]+?)~~/g, "<s>$1</s>")
		.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
		.replace(/(^|[^\w_])_([^_\n]+)_/g, "$1<em>$2</em>");

	return out;
}

const HEADING = /^(#{1,3}) (.*)$/;
const BULLET = /^ *[-*] (.*)$/;
const NUMBERED = /^ *(\d{1,3})[.)] (.*)$/;

export function renderMarkdown(src: string, mentions: Mentions = {}): string {
	const vault = new Vault();

	// Fenced code blocks keep their newlines, so they are pulled out before
	// the text is split into lines at all.
	const fenced = esc(src).replace(/```(?:\w+\n)?([\s\S]*?)```/g, (_, code: string) =>
		vault.keep(`<pre class="md-pre"><code>${code.replace(/^\n/, "")}</code></pre>`)
	);

	const lines = fenced.split("\n");
	const html: string[] = [];
	let list: "ul" | "ol" | null = null;
	let quoting = false;

	const closeList = () => {
		if (list) html.push(`</${list}>`);
		list = null;
	};
	const closeQuote = () => {
		if (quoting) html.push("</blockquote>");
		quoting = false;
	};

	for (const line of lines) {
		const quoted = /^&gt; ?(.*)$/.exec(line);
		const body = quoted ? quoted[1] : line;

		if (quoted && !quoting) {
			closeList();
			html.push('<blockquote class="md-quote">');
			quoting = true;
		} else if (!quoted && quoting) {
			closeQuote();
		}

		const bullet = BULLET.exec(body);
		const numbered = NUMBERED.exec(body);
		const wanted = bullet ? "ul" : numbered ? "ol" : null;
		if (wanted !== list) {
			closeList();
			if (wanted) html.push(`<${wanted} class="md-list">`);
			list = wanted;
		}
		if (bullet || numbered) {
			html.push(`<li>${inline((bullet ?? numbered)![bullet ? 1 : 2], mentions, vault)}</li>`);
			continue;
		}

		const heading = HEADING.exec(body);
		if (heading) {
			html.push(`<div class="md-h${heading[1].length}">${inline(heading[2], mentions, vault)}</div>`);
			continue;
		}
		if (body.startsWith("-# ")) {
			html.push(`<div class="md-sub">${inline(body.slice(3), mentions, vault)}</div>`);
			continue;
		}

		// A blank line is a blank line: Discord keeps the gap.
		html.push(`<div class="md-line">${body.trim() ? inline(body, mentions, vault) : "&nbsp;"}</div>`);
	}

	closeList();
	closeQuote();
	return vault.restore(html.join(""));
}

// The plain text of a body, for places that only need a length or a summary.
export function stripMarkdown(src: string): string {
	return src
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/&lt;a?:(\w+):\d+&gt;/g, ":$1:")
		.replace(/[*_~`|#>]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}
