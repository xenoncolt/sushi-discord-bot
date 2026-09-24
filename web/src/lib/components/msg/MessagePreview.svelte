<script lang="ts">
	import { ChevronDown, ExternalLink, File as FileIcon, EyeOff } from "@lucide/svelte";
	import type { MessageDoc, MsgButton, MsgEmbed, MsgMedia, MsgNode, MsgRow } from "$lib/api";
	import { badEmoji, buttonProblem, isHttps, rowProblem } from "$lib/msgdoc";
	import { renderMarkdown, type Mentions } from "$lib/markdown";

	let {
		doc,
		mentions = {},
		bot_name = "Bot",
		bot_avatar = "/favicon.svg"
	}: {
		doc: MessageDoc;
		mentions?: Mentions;
		bot_name?: string;
		bot_avatar?: string;
	} = $props();

	function md(text: string): string {
		return renderMarkdown(text, mentions);
	}

	// Only what the bot would really post shows up here. A preview that flatters
	// the draft is worse than no preview: the whole point is to see what lands.
	const live = (b: MsgButton) => !buttonProblem(b);
	// A link-styled button is always Discord's grey; everything else is
	// whatever colour it was given.
	const coloured = (b: MsgButton) => b.kind !== "link" && b.kind !== "channel";

	function fileName(url: string): string {
		try {
			return decodeURIComponent(new URL(url).pathname.split("/").pop() || "file");
		} catch {
			return "file";
		}
	}

	// Discord packs consecutive inline fields into rows of up to three.
	function fieldRows(embed: MsgEmbed) {
		const rows: { id: string; name: string; value: string; inline: boolean }[][] = [];
		for (const f of embed.fields) {
			if (!f.name.trim() || !f.value.trim()) continue;
			const last = rows.at(-1);
			if (f.inline && last?.[0]?.inline && last.length < 3) last.push(f);
			else rows.push([f]);
		}
		return rows;
	}

	function stamp(embed: MsgEmbed): string {
		const at = embed.timestamp === "now" ? new Date() : embed.timestamp === "custom" && embed.timestamp_at ? new Date(embed.timestamp_at) : null;
		return at && !Number.isNaN(at.getTime()) ? at.toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" }) : "";
	}
</script>

{#snippet media(m: MsgMedia, klass: string)}
	{#if isHttps(m.url)}
		<div class="shot {klass}" class:spoiler={m.spoiler}>
			<img src={m.url} alt={m.alt} title={m.alt} loading="lazy" />
			{#if m.spoiler}<span class="spoiler-tag"><EyeOff size={12} /> Spoiler</span>{/if}
		</div>
	{/if}
{/snippet}

{#snippet button(b: MsgButton)}
	<span
		class="btn2"
		class:primary={coloured(b) && b.style === "primary"}
		class:success={coloured(b) && b.style === "success"}
		class:danger={coloured(b) && b.style === "danger"}
		class:off={b.disabled}
	>
		{#if b.emoji && !badEmoji(b.emoji)}<span class="bemoji">{b.emoji}</span>{/if}
		{b.label || "Button"}
		{#if b.kind === "link" || b.kind === "channel"}<ExternalLink size={11} />{/if}
	</span>
{/snippet}

{#snippet actionRow(r: MsgRow)}
	{#if !rowProblem(r)}
		{#if r.type === "buttons"}
			<div class="brow">
				{#each r.buttons.filter(live) as b (b.id)}{@render button(b)}{/each}
			</div>
		{:else}
			<div class="select" class:off={r.select.disabled}>
				<span>{r.select.placeholder || "Make a selection"}</span>
				<ChevronDown size={14} />
			</div>
		{/if}
	{/if}
{/snippet}

{#snippet fileChip(m: MsgMedia)}
	{#if isHttps(m.url)}
		<div class="file">
			<FileIcon size={18} />
			<div>
				<div class="fname">{m.spoiler ? "SPOILER_" : ""}{fileName(m.url)}</div>
				<div class="fsub">Uploaded with the message</div>
			</div>
		</div>
	{/if}
{/snippet}

{#snippet node(n: MsgNode)}
	{#if n.type === "text"}
		{#if n.text.trim()}<div class="text">{@html md(n.text)}</div>{/if}
	{:else if n.type === "section"}
		{#if n.text.trim()}
			{@const withButton = n.accessory === "button" && live(n.button)}
			{@const withThumb = n.accessory === "thumbnail" && isHttps(n.thumbnail.url)}
			<div class="section">
				<div class="text">{@html md(n.text)}</div>
				{#if withButton}
					<div class="acc">{@render button(n.button)}</div>
				{:else if withThumb}
					{@render media(n.thumbnail, "thumb")}
				{/if}
			</div>
		{/if}
	{:else if n.type === "gallery"}
		{@const shots = n.items.filter(i => isHttps(i.url))}
		{#if shots.length}
			<div class="gallery" class:one={shots.length === 1} class:two={shots.length === 2}>
				{#each shots as m (m.id)}{@render media(m, "tile")}{/each}
			</div>
		{/if}
	{:else if n.type === "separator"}
		<div class="sep" class:large={n.spacing === "large"}>{#if n.divider}<hr />{/if}</div>
	{:else if n.type === "row"}
		{@render actionRow(n.row)}
	{:else if n.type === "file"}
		{@render fileChip(n.file)}
	{:else if n.type === "container"}
		<div class="container" class:spoiler={n.spoiler} style:border-left-color={n.accent || "#3a3c42"}>
			{#each n.children as child (child.id)}{@render node(child)}{/each}
			{#if !n.children.length}<div class="faint">Empty container — it won't be posted.</div>{/if}
		</div>
	{/if}
{/snippet}

{#snippet embedCard(e: MsgEmbed)}
	<div class="embed" style:border-left-color={e.color || "#4f545c"}>
		<div class="einner">
			<div class="emain">
				{#if e.author.name}
					<div class="eauthor">
						{#if isHttps(e.author.icon_url)}<img class="eicon" src={e.author.icon_url} alt="" />{/if}
						<span class:elink={Boolean(e.author.url)}>{e.author.name}</span>
					</div>
				{/if}
				{#if e.title.trim()}
					<div class="etitle" class:elink={Boolean(e.url)}>{@html md(e.title)}</div>
				{/if}
				{#if e.description.trim()}
					<div class="edesc">{@html md(e.description)}</div>
				{/if}

				{#each fieldRows(e) as row, ri (ri)}
					<div class="efields" style:grid-template-columns="repeat({row.length}, minmax(0, 1fr))">
						{#each row as f (f.id)}
							<div class="efield">
								<div class="fname2">{@html md(f.name)}</div>
								<div class="fval">{@html md(f.value)}</div>
							</div>
						{/each}
					</div>
				{/each}

				{#if isHttps(e.image)}<img class="eimage" src={e.image} alt="" loading="lazy" />{/if}

				{#if e.footer.text || stamp(e)}
					<div class="efooter">
						{#if isHttps(e.footer.icon_url)}<img class="eicon" src={e.footer.icon_url} alt="" />{/if}
						<span>{e.footer.text}{e.footer.text && stamp(e) ? " • " : ""}{stamp(e)}</span>
					</div>
				{/if}
			</div>

			{#if isHttps(e.thumbnail)}<img class="ethumb" src={e.thumbnail} alt="" loading="lazy" />{/if}
		</div>
	</div>
{/snippet}

<div class="msg">
	<img class="avatar-bot" src={bot_avatar} alt="" />
	<div class="body">
		<div class="who">
			<strong>{bot_name}</strong>
			<span class="app">APP</span>
			<span class="time">Today at {new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
			{#if doc.silent}<span class="flagpill">silent</span>{/if}
			{#if doc.tts}<span class="flagpill">tts</span>{/if}
		</div>

		{#if doc.mode === "v2"}
			<div class="stack2">
				{#each doc.nodes as n (n.id)}{@render node(n)}{/each}
			</div>
			{#if !doc.nodes.length}<div class="faint">Nothing to post yet.</div>{/if}
		{:else}
			{#if doc.content.trim()}<div class="text content">{@html md(doc.content)}</div>{/if}
			{#each doc.embeds as e (e.id)}{@render embedCard(e)}{/each}
			{#each doc.attachments as a (a.id)}{@render fileChip(a)}{/each}
			{#each doc.rows as r (r.id)}{@render actionRow(r)}{/each}
			{#if !doc.content.trim() && !doc.embeds.length && !doc.rows.length && !doc.attachments.length}
				<div class="faint">Nothing to post yet.</div>
			{/if}
		{/if}
	</div>
</div>

<style>
	.msg {
		display: flex;
		gap: 12px;
		background: #313338;
		border-radius: 8px;
		padding: 14px;
		font-family: "gg sans", "Noto Sans", var(--font);
		font-size: 14.5px;
		line-height: 1.375;
		color: #dbdee1;
	}
	.avatar-bot {
		width: 38px;
		height: 38px;
		border-radius: 50%;
		flex: none;
		object-fit: cover;
	}
	.body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.who {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
	}
	.who strong {
		color: #f2f3f5;
	}
	.app {
		background: #5865f2;
		color: #fff;
		font-size: 10px;
		font-weight: 700;
		border-radius: 3px;
		padding: 0 4px;
	}
	.time {
		color: #949ba4;
		font-size: 12px;
	}
	.flagpill {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.4px;
		color: #949ba4;
		border: 1px solid #4a4d54;
		border-radius: 3px;
		padding: 0 4px;
	}

	.stack2 {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.text {
		overflow-wrap: anywhere;
	}
	.content {
		white-space: normal;
	}

	/* ---- components v2 ---- */
	.container {
		background: #2b2d31;
		border: 1px solid #3a3c42;
		border-left: 4px solid;
		border-radius: 8px;
		padding: 14px 16px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		max-width: 540px;
	}
	.container.spoiler {
		filter: blur(4px) brightness(0.8);
	}
	.container.spoiler:hover {
		filter: none;
	}
	.section {
		display: flex;
		gap: 14px;
		align-items: flex-start;
	}
	.section .text {
		flex: 1;
		min-width: 0;
	}
	.section .acc {
		flex: none;
		padding-top: 2px;
	}
	.shot {
		position: relative;
		border-radius: 8px;
		overflow: hidden;
		background: #1e1f22;
	}
	.shot img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.shot.thumb {
		width: 86px;
		height: 86px;
		flex: none;
	}
	.shot.tile {
		aspect-ratio: 16 / 10;
	}
	.shot.spoiler img {
		filter: blur(12px);
	}
	.shot.spoiler:hover img {
		filter: none;
	}
	.spoiler-tag {
		position: absolute;
		inset: 50% auto auto 50%;
		transform: translate(-50%, -50%);
		display: inline-flex;
		align-items: center;
		gap: 4px;
		background: rgba(0, 0, 0, 0.7);
		border-radius: 20px;
		padding: 3px 9px;
		font-size: 11px;
		white-space: nowrap;
	}
	.gallery {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 4px;
		border-radius: 8px;
		overflow: hidden;
	}
	.gallery.one {
		grid-template-columns: minmax(0, 1fr);
	}
	.gallery.two {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
	.sep {
		padding: 2px 0;
	}
	.sep.large {
		padding: 8px 0;
	}
	.sep hr {
		border: 0;
		border-top: 1px solid #3f4147;
		margin: 0;
	}
	.file {
		display: flex;
		align-items: center;
		gap: 10px;
		background: #2b2d31;
		border: 1px solid #3a3c42;
		border-radius: 8px;
		padding: 10px 12px;
		max-width: 420px;
		color: #b5bac1;
	}
	.fname {
		color: #00a8fc;
		font-size: 13px;
		word-break: break-all;
	}
	.fsub {
		font-size: 11px;
		color: #949ba4;
	}

	/* ---- buttons and menus ---- */
	.brow {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.btn2 {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		background: #4e5058;
		color: #fff;
		border-radius: 8px;
		padding: 7px 14px;
		font-size: 13.5px;
		font-weight: 500;
		max-width: 240px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.btn2.primary {
		background: #5865f2;
	}
	.btn2.success {
		background: #248046;
	}
	.btn2.danger {
		background: #da373c;
	}
	.btn2.off {
		opacity: 0.5;
	}
	.bemoji {
		font-size: 15px;
	}
	.select {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		background: #1e1f22;
		border: 1px solid #1e1f22;
		border-radius: 8px;
		padding: 9px 12px;
		color: #949ba4;
		font-size: 13.5px;
		max-width: 400px;
	}
	.select.off {
		opacity: 0.5;
	}

	/* ---- embeds ---- */
	.embed {
		background: #2b2d31;
		border-left: 4px solid;
		border-radius: 4px;
		padding: 12px 16px 14px;
		max-width: 520px;
	}
	.einner {
		display: flex;
		gap: 14px;
		align-items: flex-start;
	}
	.emain {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.eauthor {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13.5px;
		font-weight: 600;
		color: #f2f3f5;
	}
	.eicon {
		width: 20px;
		height: 20px;
		border-radius: 50%;
		object-fit: cover;
	}
	.etitle {
		font-size: 15px;
		font-weight: 600;
		color: #f2f3f5;
	}
	.elink {
		color: #00a8fc;
	}
	.edesc {
		font-size: 13.5px;
		overflow-wrap: anywhere;
	}
	.efields {
		display: grid;
		gap: 8px;
	}
	.efield {
		min-width: 0;
	}
	.fname2 {
		font-size: 13px;
		font-weight: 600;
		color: #f2f3f5;
	}
	.fval {
		font-size: 13px;
		overflow-wrap: anywhere;
	}
	.eimage {
		display: block;
		width: 100%;
		border-radius: 6px;
		margin-top: 4px;
	}
	.ethumb {
		width: 78px;
		height: 78px;
		border-radius: 6px;
		object-fit: cover;
		flex: none;
	}
	.efooter {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 11.5px;
		color: #949ba4;
		margin-top: 2px;
	}
	.efooter .eicon {
		width: 18px;
		height: 18px;
	}
</style>
