<script lang="ts" module>
	const COLOR_FIELDS = [
		["Background", "background_color"],
		["Accent", "accent"],
		["Big line", "text_color"],
		["Other lines", "sub_color"]
	] as const;
</script>

<script lang="ts">
	import {
		ChevronDown, ChevronUp, ExternalLink, GripVertical, Image, Link2, Minus, MousePointerClick,
		Plus, Send, Trash2, TriangleAlert, Type, UserRound
	} from "@lucide/svelte";
	import { api, type WelcomeBlock, type WelcomeButton } from "$lib/api";
	import Card from "$lib/components/Card.svelte";
	import ChannelSelect from "$lib/components/ChannelSelect.svelte";
	import RoleSelect from "$lib/components/RoleSelect.svelte";
	import Segmented from "$lib/components/Segmented.svelte";
	import Toggle from "$lib/components/Toggle.svelte";
	import { renderMarkdown } from "$lib/components/V2Preview.svelte";
	import WelcomeButtonEditor, { badEmoji, buttonProblem } from "$lib/components/WelcomeButtonEditor.svelte";
	import { Autosave, useGuild } from "$lib/guild.svelte";
	import { session } from "$lib/session.svelte";
	import { toast } from "$lib/toast.svelte";

	const MAX_BLOCKS = 12;
	const MAX_ROW_BUTTONS = 5;

	const PLACEHOLDERS: [string, string][] = [
		["Name", "{name}"],
		["Mention", "{mention}"],
		["Username", "{username}"],
		["Server", "{server}"],
		["Member count", "{count}"],
		["1st / 2nd / 3rd", "{ordinal}"],
		["Date", "{date}"]
	];
	// The image is drawn rather than sent through Discord, so a mention there
	// would only come out as raw text — it isn't offered.
	const IMAGE_PLACEHOLDERS: [string, string][] = [
		["Name", "{name}"],
		["Username", "{username}"],
		["Server", "{server}"],
		["Member count", "{count}"],
		["1st / 2nd / 3rd", "{ordinal}"]
	];

	const g = useGuild();
	const s = new Autosave(g, "welcome");
	const v = $derived(s.value);

	let testing = $state(false);

	function uid(): string {
		return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
	}

	function newButton(): WelcomeButton {
		return { id: uid(), label: "", emoji: "", kind: "channel", channel_id: null, url: "" };
	}

	function newBlock(type: WelcomeBlock["type"]): WelcomeBlock {
		return {
			id: uid(),
			type,
			text: type === "text" ? "New paragraph" : "",
			accessory: "none",
			buttons: type === "buttons" ? [newButton()] : [],
			divider: true
		};
	}

	// ---- editing blocks ---------------------------------------------------

	// Which text block is open as a textarea, and which button has its editor
	// showing. One of each at a time keeps the card readable.
	let editing_text = $state<string | null>(null);
	let editing_button = $state<string | null>(null);

	const has_image = $derived(v.blocks.some(b => b.type === "image"));

	function addBlock(type: WelcomeBlock["type"]) {
		if (v.blocks.length >= MAX_BLOCKS) return;
		const block = newBlock(type);
		s.value.blocks = [...s.value.blocks, block];
		if (type === "text") editing_text = block.id;
		if (type === "buttons") editing_button = block.buttons[0].id;
	}

	function removeBlock(id: string) {
		s.value.blocks = s.value.blocks.filter(b => b.id !== id);
	}

	function move(from: number, to: number) {
		if (to < 0 || to >= v.blocks.length || from === to) return;
		const next = [...s.value.blocks];
		const [block] = next.splice(from, 1);
		next.splice(to, 0, block);
		s.value.blocks = next;
	}

	function setAccessory(i: number, mode: WelcomeBlock["accessory"]) {
		const block = s.value.blocks[i];
		block.accessory = mode;
		if (mode === "button" && !block.buttons.length) {
			block.buttons = [newButton()];
			editing_button = block.buttons[0].id;
		}
	}

	function addRowButton(i: number) {
		const block = s.value.blocks[i];
		if (block.buttons.length >= MAX_ROW_BUTTONS) return;
		const button = newButton();
		block.buttons = [...block.buttons, button];
		editing_button = button.id;
	}

	function removeButton(i: number, id: string) {
		const block = s.value.blocks[i];
		block.buttons = block.buttons.filter(b => b.id !== id);
		// A row with nothing left in it has no reason to stay.
		if (block.type === "buttons" && !block.buttons.length) removeBlock(block.id);
		else if (block.type === "text") block.accessory = "none";
	}

	// ---- drag to reorder --------------------------------------------------

	// Only the handle arms a drag, so selecting text inside a block still
	// works normally.
	let armed = $state<string | null>(null);
	let dragging = $state<number | null>(null);
	let over = $state<number | null>(null);

	function drop(to: number) {
		if (dragging !== null) move(dragging, to);
		dragging = null;
		over = null;
		armed = null;
	}

	// ---- the drawn card ---------------------------------------------------

	let card_url = $state<string | null>(null);
	let card_error = $state("");
	let rendering = $state(false);

	// Rendering is a fetch, an image download and a rasterise on the bot's
	// box, so it waits for a pause in the typing rather than firing per key.
	const RENDER_DELAY = 500;
	let render_timer: ReturnType<typeof setTimeout> | null = null;
	// Renders can come back out of order; only the newest one may paint.
	let render_seq = 0;

	async function renderCard() {
		const seq = ++render_seq;
		rendering = true;
		try {
			const res = await fetch(`/api/guilds/${g.guild.id}/welcome/preview`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify($state.snapshot(s.value.card)),
				credentials: "same-origin"
			});
			if (!res.ok) {
				const msg = await res.json().catch(() => null);
				throw new Error(msg?.error ?? `Preview failed (${res.status})`);
			}
			const url = URL.createObjectURL(await res.blob());
			if (seq !== render_seq) {
				URL.revokeObjectURL(url);
				return;
			}
			if (card_url) URL.revokeObjectURL(card_url);
			card_url = url;
			card_error = "";
		} catch (err) {
			if (seq === render_seq) card_error = (err as Error).message;
		} finally {
			if (seq === render_seq) rendering = false;
		}
	}

	const card_json = $derived(JSON.stringify(s.value.card));

	$effect(() => {
		// Reading every field of the card registers it as a dependency, so
		// any edit at all schedules a redraw.
		void card_json;
		if (render_timer) clearTimeout(render_timer);
		render_timer = setTimeout(renderCard, RENDER_DELAY);
	});

	$effect(() => () => {
		if (render_timer) clearTimeout(render_timer);
		if (card_url) URL.revokeObjectURL(card_url);
	});

	// ---- showing the card the way Discord will ------------------------------

	const me = $derived(session.me?.user);
	const my_name = $derived(me?.global_name ?? me?.username ?? "Member");
	const ping_role = $derived(g.role(v.ping_role)?.name ?? "Members");

	function ordinal(n: number): string {
		const teens = n % 100;
		if (teens >= 11 && teens <= 13) return `${n}th`;
		return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
	}

	const vars = $derived<Record<string, string>>({
		name: my_name,
		user: my_name,
		username: me?.username ?? "member",
		mention: "<@me>",
		server: g.guild.name,
		count: String(g.guild.member_count),
		ordinal: ordinal(g.guild.member_count),
		date: new Date().toLocaleDateString("en-GB"),
		xp_name: g.settings.server.xp_name
	});

	function fill(text: string): string {
		return text.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);
	}

	// So a <#channel> in the text reads as its real name, as it would in Discord.
	const mentions = $derived({
		me: my_name,
		"&role": ping_role,
		...Object.fromEntries(g.channels.map(c => [`#${c.id}`, c.name]))
	});

	function md(text: string): string {
		return renderMarkdown(fill(text), mentions);
	}

	const footer_html = $derived(v.footer.trim() ? renderMarkdown(fill(v.footer), mentions) : "");

	// ---- actions ----------------------------------------------------------

	async function test() {
		await s.flush();
		testing = true;
		try {
			const r = await api<{ message: string }>(`/guilds/${g.guild.id}/test/welcome`, { method: "POST", body: {} });
			toast(r.message);
		} catch (err) {
			toast((err as Error).message, "error", 6000);
		} finally {
			testing = false;
		}
	}
</script>

<svelte:head><title>Welcome · {g.guild.name}</title></svelte:head>

{#snippet pill(b: WelcomeButton, onclick: () => void)}
	<button class="pill" class:ghost={Boolean(buttonProblem(b))} type="button" {onclick}>
		{#if b.emoji && !badEmoji(b.emoji)}<span>{b.emoji}</span>{/if}
		<span class="pill-label">{b.label.trim() || "Unnamed button"}</span>
		<ExternalLink size={12} />
	</button>
{/snippet}

<div class="page-head">
	<h1>Welcome</h1>
	<p>Greet everyone who joins. Build the card here the way it will look in Discord — drag the blocks around, and put buttons wherever you want them.</p>
</div>

<div class="stack">
	<Card title="Welcome System" desc="Post a message in a channel whenever somebody joins the server.">
		{#snippet aside()}<Toggle bind:checked={s.value.enabled} label="Welcome system" />{/snippet}
		{#if !v.enabled}
			<div class="hint">While this is off nothing is posted when people join. Bots never get a welcome either way.</div>
		{/if}
	</Card>

	<Card title="Welcome Channel" desc="Where the message goes.">
		{#snippet aside()}<div class="aside-select"><ChannelSelect bind:value={s.value.channel} compact /></div>{/snippet}
		{#if v.enabled && !v.channel}
			<div class="note warn"><TriangleAlert size={13} /> Nothing will be posted until a channel is picked.</div>
		{/if}
		<div class="grid grid-2" style="margin-top: 14px">
			<div>
				<span class="label">Ping the new member</span>
				<div class="row" style="height: 38px">
					<Toggle bind:checked={s.value.mention_user} label="Ping the new member" />
					<span class="muted">Notify them with {"{mention}"}</span>
				</div>
			</div>
			<div>
				<span class="label">Also ping a role</span>
				<RoleSelect bind:value={s.value.ping_role} noneLabel="Don't ping a role" />
				<div class="hint">Posted as its own line above the card, the way Discord needs it.</div>
			</div>
		</div>
	</Card>

	<Card title="The Card" desc="What you see is what gets posted. Click any text to edit it, drag a handle to move a block.">
		{#snippet aside()}
			<div class="row">
				<input type="color" class="swatch" aria-label="Accent colour" bind:value={s.value.color} />
				<input class="input mono" maxlength="7" aria-label="Accent colour hex" bind:value={s.value.color} style="width: 96px" />
			</div>
		{/snippet}

		<div class="composer">
			<img class="bot-av" src={session.me?.bot?.avatar ?? "/favicon.svg"} alt="" />
			<div class="msg-body">
				<div class="who">
					<strong>{session.me?.bot?.name ?? "Bot"}</strong>
					<span class="app">APP</span>
					<span class="time">Today</span>
				</div>
				{#if v.ping_role}
					<div class="pingline"><span class="mention">@{ping_role}</span></div>
				{/if}

				<div class="ccontainer" style:border-left-color={v.color}>
					{#each v.blocks as block, i (block.id)}
						<div
							class="block"
							class:dragging={dragging === i}
							class:over={over === i && dragging !== i}
							draggable={armed === block.id}
							ondragstart={() => (dragging = i)}
							ondragover={e => {
								e.preventDefault();
								over = i;
							}}
							ondragleave={() => over === i && (over = null)}
							ondrop={e => {
								e.preventDefault();
								drop(i);
							}}
							ondragend={() => {
								dragging = null;
								over = null;
								armed = null;
							}}
							role="group"
						>
							<button
								class="handle"
								title="Drag to move, or use the arrows"
								aria-label="Drag to move this block"
								onmousedown={() => (armed = block.id)}
								onmouseup={() => (armed = null)}
							>
								<GripVertical size={14} />
							</button>

							<div class="block-main">
								{#if block.type === "text"}
									<div class="sec">
										<div class="sec-text">
											{#if editing_text === block.id}
												<!-- svelte-ignore a11y_autofocus -->
												<textarea
													class="blocktext"
													autofocus
													rows={Math.max(2, block.text.split("\n").length)}
													maxlength="2000"
													bind:value={s.value.blocks[i].text}
													onblur={() => (editing_text = null)}
												></textarea>
											{:else}
												<button class="rendered" onclick={() => (editing_text = block.id)} title="Click to edit">
													{#if block.text.trim()}{@html md(block.text)}{:else}<span class="faint">Empty — click to write something</span>{/if}
												</button>
											{/if}
										</div>
										{#if block.accessory === "avatar"}
											<img class="thumb" src={me?.avatar ?? "/favicon.svg"} alt="" />
										{:else if block.accessory === "button" && block.buttons[0]}
											{@const acc = block.buttons[0]}
											{@render pill(acc, () => (editing_button = editing_button === acc.id ? null : acc.id))}
										{/if}
									</div>

									{#if block.accessory === "button" && block.buttons[0] && editing_button === block.buttons[0].id}
										{@const acc_id = block.buttons[0].id}
										<div class="panel">
											<WelcomeButtonEditor bind:button={s.value.blocks[i].buttons[0]} onremove={() => removeButton(i, acc_id)} />
										</div>
									{/if}
								{:else if block.type === "buttons"}
									<div class="pills">
										{#each block.buttons as b (b.id)}
											{@render pill(b, () => (editing_button = editing_button === b.id ? null : b.id))}
										{/each}
										{#if block.buttons.length < MAX_ROW_BUTTONS}
											<button class="pill add" type="button" onclick={() => addRowButton(i)}><Plus size={12} /> Button</button>
										{/if}
									</div>
									{#each block.buttons as b, bi (b.id)}
										{#if editing_button === b.id}
											<div class="panel">
												<WelcomeButtonEditor bind:button={s.value.blocks[i].buttons[bi]} onremove={() => removeButton(i, b.id)} />
											</div>
										{/if}
									{/each}
								{:else if block.type === "image"}
									{#if !v.card.enabled}
										<div class="imgoff faint">The welcome image is switched off below, so nothing is posted here.</div>
									{:else if card_error}
										<div class="warn-box">{card_error}</div>
									{:else if card_url}
										<img class="cardimg" class:stale={rendering} src={card_url} alt="The welcome card as it will be posted" />
									{:else}
										<div class="cardimg placeholder faint">Drawing…</div>
									{/if}
								{:else}
									<div class="divider" class:invisible={!block.divider}></div>
								{/if}
							</div>

							<div class="tools">
								{#if block.type === "text"}
									<div class="accbar" role="group" aria-label="What sits on the right">
										<button class:on={block.accessory === "none"} title="Nothing on the right" aria-label="Nothing on the right" onclick={() => setAccessory(i, "none")}><Minus size={12} /></button>
										<button class:on={block.accessory === "avatar"} title="Their avatar on the right" aria-label="Their avatar on the right" onclick={() => setAccessory(i, "avatar")}><UserRound size={12} /></button>
										<button class:on={block.accessory === "button"} title="A button on the right" aria-label="A button on the right" onclick={() => setAccessory(i, "button")}><MousePointerClick size={12} /></button>
									</div>
								{:else if block.type === "separator"}
									<button class="tool" title={block.divider ? "Hide the line" : "Show the line"} aria-label="Show or hide the line" onclick={() => (s.value.blocks[i].divider = !block.divider)}>
										<Minus size={13} />
									</button>
								{/if}
								<button class="tool" title="Move up" aria-label="Move up" disabled={i === 0} onclick={() => move(i, i - 1)}><ChevronUp size={13} /></button>
								<button class="tool" title="Move down" aria-label="Move down" disabled={i === v.blocks.length - 1} onclick={() => move(i, i + 1)}><ChevronDown size={13} /></button>
								<button class="tool danger" title="Remove this block" aria-label="Remove this block" onclick={() => removeBlock(block.id)}><Trash2 size={13} /></button>
							</div>
						</div>
					{/each}

					{#if !v.blocks.length}
						<div class="empty">Nothing in the card yet. Add a block below.</div>
					{/if}

					{#if footer_html}
						<div class="foot-rule"></div>
						<div class="foot">{@html footer_html}</div>
					{/if}
				</div>
			</div>
		</div>

		<div class="addbar">
			<span class="label" style="margin: 0">Add</span>
			<button class="btn sm" disabled={v.blocks.length >= MAX_BLOCKS} onclick={() => addBlock("text")}><Type size={13} /> Text</button>
			<button class="btn sm" disabled={v.blocks.length >= MAX_BLOCKS} onclick={() => addBlock("buttons")}><MousePointerClick size={13} /> Buttons</button>
			<button class="btn sm" disabled={v.blocks.length >= MAX_BLOCKS || has_image} onclick={() => addBlock("image")}><Image size={13} /> Welcome image</button>
			<button class="btn sm" disabled={v.blocks.length >= MAX_BLOCKS} onclick={() => addBlock("separator")}><Minus size={13} /> Divider</button>
			<span class="spacer"></span>
			<span class="faint">{v.blocks.length}/{MAX_BLOCKS} blocks</span>
		</div>

		<div class="note" style="margin-top: 12px">
			<Link2 size={13} /> A button on the right of a text block sits at the card's right edge on that same line. A buttons block is a row of up to five underneath. Discord only lets a button carry a link when it's styled as one, so they all come out grey with an arrow — the colour can't be changed. A channel button becomes a jump link, so renaming or moving the channel doesn't break it.
		</div>

		<div class="fields">
			<div>
				<label class="label" for="w-footer">Footer — always last, in small grey text</label>
				<input id="w-footer" class="input" maxlength="200" placeholder="Leave empty for no footer" bind:value={s.value.footer} />
			</div>
			<div>
				<span class="label">Placeholders — type these anywhere in the card</span>
				<div class="chips">
					{#each PLACEHOLDERS as [label, token] (token)}
						<span class="chip sm"><span class="mono">{token}</span> <span class="faint">{label}</span></span>
					{/each}
				</div>
				<div class="hint">
					Discord markdown works too: <span class="mono">**bold**</span>, <span class="mono">### heading</span>, <span class="mono">&gt; quote</span>, and <span class="mono">&lt;#channel-id&gt;</span> for a channel mention.
				</div>
			</div>
		</div>

		<div class="row" style="margin-top: 16px">
			<button class="btn" disabled={testing} onclick={test}><Send size={14} /> Send a test welcome</button>
			<span class="hint" style="margin: 0">Posted as though you had just joined.</span>
		</div>
	</Card>

	<Card title="Welcome Image" desc="Drawn fresh for each member: their avatar and name over your background.">
		{#snippet aside()}<Toggle bind:checked={s.value.card.enabled} label="Welcome image" />{/snippet}

		<div class="hint" style="margin-bottom: 12px">
			1000 × 350, drawn by the bot — the preview above uses your own avatar.
			{#if v.card.enabled && !has_image}
				Add a “Welcome image” block above to choose where it sits; without one it goes at the end.
			{/if}
		</div>

		<div class="grid grid-2">
			<div>
				<span class="label">Layout</span>
				<Segmented
					bind:value={s.value.card.layout}
					options={[
						{ value: "center", label: "Avatar on top" },
						{ value: "left", label: "Avatar on the left" }
					]}
				/>
			</div>
			<div>
				<span class="label">Avatar shape</span>
				<Segmented
					bind:value={s.value.card.avatar_shape}
					options={[
						{ value: "circle", label: "Circle" },
						{ value: "rounded", label: "Rounded" },
						{ value: "square", label: "Square" }
					]}
				/>
			</div>
		</div>

		<div class="grid grid-3" style="margin-top: 14px">
			<div>
				<label class="label" for="c-title">Big line</label>
				<input id="c-title" class="input" maxlength="80" bind:value={s.value.card.title} />
			</div>
			<div>
				<label class="label" for="c-sub">Second line</label>
				<input id="c-sub" class="input" maxlength="80" bind:value={s.value.card.subtitle} />
			</div>
			<div>
				<label class="label" for="c-foot">Small line</label>
				<input id="c-foot" class="input" maxlength="80" bind:value={s.value.card.footer} />
			</div>
		</div>
		<div class="chips">
			{#each IMAGE_PLACEHOLDERS as [label, token] (token)}
				<span class="chip sm"><span class="mono">{token}</span> <span class="faint">{label}</span></span>
			{/each}
		</div>
		<div class="hint">Lines left empty are skipped and the rest close the gap. Long text is shrunk to fit, then cut.</div>

		<div style="margin-top: 16px">
			<label class="label" for="c-bg">Background image URL (optional)</label>
			<input id="c-bg" class="input" placeholder="https://…" maxlength="500" bind:value={s.value.card.background} />
			<div class="hint">PNG or JPEG, roughly 1000 × 350 or any wider crop of it — scaled to cover and centred. Anything that can't be fetched falls back to the flat colour below.</div>
		</div>

		<div class="grid grid-2" style="margin-top: 14px">
			<div>
				<label class="label" for="c-dim">Darken the background · {v.card.overlay}%</label>
				<input id="c-dim" type="range" class="range" min="0" max="100" step="5" disabled={!v.card.background.trim()} bind:value={s.value.card.overlay} />
				<div class="hint">{v.card.background.trim() ? "Keeps the text readable over a busy photo." : "Only used when there's a background image."}</div>
			</div>
			<div>
				<span class="label">Avatar ring</span>
				<div class="row" style="height: 38px">
					<Toggle bind:checked={s.value.card.avatar_ring} label="Avatar ring" />
					<span class="muted">A ring in the accent colour</span>
				</div>
			</div>
		</div>

		<div class="colors">
			{#each COLOR_FIELDS as [label, key] (key)}
				<div>
					<label class="label" for="c-{key}">{label}</label>
					<div class="row">
						<input id="c-{key}" type="color" class="swatch" bind:value={s.value.card[key]} />
						<input class="input mono" maxlength="7" bind:value={s.value.card[key]} />
					</div>
				</div>
			{/each}
		</div>
	</Card>
</div>

<style>
	.aside-select {
		width: 220px;
	}
	.fields {
		display: flex;
		flex-direction: column;
		gap: 14px;
		margin-top: 16px;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 8px;
	}
	.chip.sm {
		padding: 4px 8px;
		font-size: 11.5px;
		gap: 5px;
	}
	.swatch {
		width: 42px;
		height: 38px;
		border: 1px solid var(--input-border);
		border-radius: 6px;
		background: var(--input);
		padding: 3px;
		flex: none;
	}
	.range {
		width: 100%;
		accent-color: var(--accent);
	}
	.colors {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 14px;
		margin-top: 14px;
	}
	.note {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px;
		font-size: 12px;
		color: var(--muted);
		background: rgba(255, 255, 255, 0.03);
		border-radius: 6px;
		padding: 9px 11px;
	}
	.note.warn {
		color: #ffc9c9;
		background: rgba(224, 49, 49, 0.1);
	}

	/* ---- the composer, dressed as a Discord message ---- */
	.composer {
		display: flex;
		gap: 12px;
		background: #313338;
		border-radius: 8px;
		padding: 14px;
		font-family: "gg sans", "Noto Sans", var(--font);
		font-size: 14.5px;
		color: #dbdee1;
	}
	.bot-av {
		width: 38px;
		height: 38px;
		border-radius: 50%;
		flex: none;
	}
	.msg-body {
		flex: 1;
		min-width: 0;
	}
	.who {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-bottom: 4px;
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
	.pingline {
		margin-bottom: 6px;
	}
	.mention {
		background: rgba(88, 101, 242, 0.3);
		color: #c9cdfb;
		border-radius: 3px;
		padding: 0 3px;
		font-weight: 500;
	}
	.ccontainer {
		background: #2b2d31;
		border: 1px solid #3a3c42;
		border-left: 4px solid;
		border-radius: 8px;
		padding: 10px 12px;
		max-width: 640px;
	}

	/* ---- blocks ---- */
	.block {
		display: grid;
		grid-template-columns: 18px minmax(0, 1fr) auto;
		align-items: start;
		gap: 6px;
		border-radius: 6px;
		padding: 3px 2px;
		border: 1px solid transparent;
	}
	.block:hover {
		background: rgba(255, 255, 255, 0.025);
	}
	.block.dragging {
		opacity: 0.4;
	}
	.block.over {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.handle {
		border: 0;
		background: transparent;
		color: #5c6067;
		padding: 4px 0 0;
		cursor: grab;
		opacity: 0;
		transition: opacity 0.12s;
	}
	.block:hover .handle,
	.block:focus-within .handle {
		opacity: 1;
	}
	.handle:active {
		cursor: grabbing;
	}
	.block-main {
		min-width: 0;
	}
	.sec {
		display: flex;
		align-items: flex-start;
		gap: 12px;
	}
	.sec-text {
		flex: 1;
		min-width: 0;
	}
	.rendered {
		display: block;
		width: 100%;
		text-align: left;
		background: transparent;
		border: 0;
		color: inherit;
		font: inherit;
		line-height: 1.4;
		padding: 4px 5px;
		border-radius: 5px;
		overflow-wrap: anywhere;
		cursor: text;
	}
	.rendered:hover {
		background: rgba(255, 255, 255, 0.04);
		box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.07);
	}
	.blocktext {
		width: 100%;
		background: #1e1f22;
		border: 1px solid var(--accent);
		border-radius: 5px;
		color: #dbdee1;
		font-family: inherit;
		font-size: 14px;
		line-height: 1.4;
		padding: 4px 5px;
		resize: vertical;
		outline: none;
	}
	.thumb {
		width: 68px;
		height: 68px;
		border-radius: 8px;
		object-fit: cover;
		flex: none;
	}
	.pills {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		padding: 3px 5px;
	}
	.pill {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		flex: none;
		max-width: 260px;
		background: #4e5058;
		color: #fff;
		border: 1px solid transparent;
		border-radius: 8px;
		padding: 7px 13px;
		font-size: 13px;
		font-weight: 500;
	}
	.pill:hover {
		border-color: rgba(255, 255, 255, 0.4);
	}
	.pill-label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	/* A button the bot would leave out reads as unfinished. */
	.pill.ghost {
		background: #3a3d44;
		color: #9aa0a8;
		border-style: dashed;
		border-color: #6c7079;
	}
	.pill.add {
		background: transparent;
		border: 1px dashed #5c6067;
		color: #9aa0a8;
	}
	.panel {
		margin: 8px 5px 4px;
	}
	.cardimg {
		display: block;
		width: 100%;
		max-width: 520px;
		aspect-ratio: 1000 / 350;
		border-radius: 8px;
		background: #1e1f22;
		margin: 4px 5px;
		transition: opacity 0.15s;
	}
	/* Dimmed rather than blanked while the next render is on its way, so it
	   doesn't flash on every keystroke. */
	.cardimg.stale {
		opacity: 0.55;
	}
	.placeholder {
		display: grid;
		place-items: center;
		font-size: 13px;
	}
	.imgoff {
		font-size: 12.5px;
		padding: 10px 5px;
	}
	.divider {
		border-top: 1px solid #3f4147;
		margin: 10px 5px;
	}
	.divider.invisible {
		border-top-style: dashed;
		border-top-color: #33363c;
	}
	.foot-rule {
		border-top: 1px solid #3f4147;
		margin: 10px 5px;
	}
	.foot {
		font-size: 12px;
		color: #949ba4;
		padding: 0 5px 2px;
	}

	/* ---- per-block tools ---- */
	.tools {
		display: flex;
		align-items: center;
		gap: 2px;
		opacity: 0;
		transition: opacity 0.12s;
	}
	.block:hover .tools,
	.block:focus-within .tools {
		opacity: 1;
	}
	.tool,
	.accbar button {
		border: 0;
		background: transparent;
		color: #9aa0a8;
		border-radius: 4px;
		padding: 4px;
		line-height: 0;
	}
	.tool:hover:not(:disabled),
	.accbar button:hover {
		background: rgba(255, 255, 255, 0.08);
		color: #fff;
	}
	.tool:disabled {
		opacity: 0.3;
	}
	.tool.danger:hover {
		color: #ff6b6b;
	}
	.accbar {
		display: flex;
		gap: 1px;
		background: rgba(0, 0, 0, 0.25);
		border-radius: 5px;
		margin-right: 4px;
	}
	.accbar button.on {
		background: var(--accent);
		color: #fff;
	}

	.addbar {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
		margin-top: 12px;
	}

	/* The markdown itself is styled globally, by app.css. */

	@media (max-width: 1100px) {
		.colors {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
